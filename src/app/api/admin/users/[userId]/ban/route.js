import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getUserModerationRole } from "@/lib/moderation";
import { getRestorableBanDuration } from "@/lib/admin-moderation-integrity.mjs";
import {
  BAN_REASON_MESSAGE_MAX_LENGTH,
  BAN_REASON_MESSAGE_MIN_LENGTH,
  MODERATION_ACTIONS,
  canPerformModerationAction,
  getSupabaseBanDuration,
  validateBanReason,
} from "@/lib/moderation-policy.mjs";
import { createAdminClient, getLatestAuthUser } from "@/lib/supabase-admin";
import { createClient } from "@/utils/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeRevocationReason(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\r\n?/g, "\n").trim();
}

async function getTargetUser(admin, userId) {
  const {
    data: { user },
    error,
  } = await admin.auth.admin.getUserById(userId);

  if (error || !user) {
    throw error ?? new Error("Target user not found.");
  }

  return user;
}

async function updateBanStateWithCompensation(
  admin,
  moderationClient,
  targetUser,
  nextBanDuration,
  nextIsBanned,
  sanction,
) {
  const { data: operationRows, error: beginError } = await moderationClient.rpc(
    "begin_auth_ban_operation",
    {
      p_subject_user_id: targetUser.id,
      p_action: nextIsBanned ? "ban" : "unban",
      p_ban_duration: nextBanDuration,
      p_payload: nextIsBanned
        ? {
            severity: "critical",
            reason_code: sanction.reasonCode,
            user_message: sanction.userMessage,
          }
        : { revocation_reason: sanction.revocationReason },
      p_request_id: sanction.requestId,
    },
  );

  if (beginError) {
    throw beginError;
  }

  const operation = Array.isArray(operationRows) ? operationRows[0] : operationRows;

  if (!operation?.operation_id) {
    throw new Error("Moderation Auth operation could not be started.");
  }

  if (operation.operation_status === "completed") {
    return {
      user: null,
      bannedUntil: operation.result_banned_until ?? null,
    };
  }

  if (operation.operation_status !== "pending") {
    throw new Error("Ban state requires administrator reconciliation.");
  }

  const previousBanDuration = getRestorableBanDuration(
    operation.previous_banned_until,
  );
  let authMutationApplied = false;
  let updatedUser = null;

  try {
    const { data, error: authUpdateError } = await admin.auth.admin.updateUserById(
      targetUser.id,
      { ban_duration: nextBanDuration },
    );

    if (authUpdateError) {
      throw authUpdateError;
    }

    updatedUser = data.user;
    authMutationApplied = true;

    const { error: durableStateError } = await moderationClient.rpc(
      "complete_auth_ban_operation",
      {
        p_operation_id: operation.operation_id,
        p_expected_banned_until: updatedUser?.banned_until ?? null,
      },
    );

    if (durableStateError) {
      throw durableStateError;
    }
  } catch (syncError) {
    if (authMutationApplied) {
      const { error: replayError } = await moderationClient.rpc(
        "complete_auth_ban_operation",
        {
          p_operation_id: operation.operation_id,
          p_expected_banned_until: updatedUser?.banned_until ?? null,
        },
      );

      if (!replayError) {
        return {
          user: updatedUser,
          bannedUntil: updatedUser?.banned_until ?? null,
        };
      }
    }

    if (authMutationApplied) {
      const latestUser = await getTargetUser(admin, targetUser.id);

      if (
        (latestUser?.banned_until ?? null) !==
        (updatedUser?.banned_until ?? null)
      ) {
        console.error(
          "Auth ban state changed before compensation; reconciliation required.",
        );
        throw new Error("Ban state requires administrator reconciliation.", {
          cause: syncError,
        });
      }

      const { error: rollbackError } = await admin.auth.admin.updateUserById(
        targetUser.id,
        { ban_duration: previousBanDuration },
      );

      if (rollbackError) {
        console.error(
          "Auth ban rollback failed; durable operation requires reconciliation:",
          rollbackError.message,
        );
        throw new Error("Ban state requires administrator reconciliation.", {
          cause: syncError,
        });
      }
    }

    const { data: safelyAborted, error: abortError } = await moderationClient.rpc(
      "abort_auth_ban_operation",
      { p_operation_id: operation.operation_id },
    );

    if (abortError || safelyAborted !== true) {
      console.error(
        "Auth ban operation could not verify rollback:",
        abortError?.message ?? "live Auth state changed",
      );
      throw new Error("Ban state requires administrator reconciliation.", {
        cause: syncError,
      });
    }

    throw syncError;
  }

  return {
    user: updatedUser,
    bannedUntil: updatedUser?.banned_until ?? null,
  };
}

export async function POST(request, { params }) {
  try {
    const resolvedParams = await params;
    const admin = createAdminClient();

    if (!admin) {
      return NextResponse.json(
        { error: "Ban management is not configured in this environment." },
        { status: 503 },
      );
    }

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }

    const accessUser = await getLatestAuthUser(admin, user.id, "admin ban management");

    if (!accessUser) {
      return NextResponse.json(
        { error: "Could not verify your current admin access." },
        { status: 503 },
      );
    }

    const body = await request.json().catch(() => null);

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const { action, duration, reasonCode, userMessage } = body;
    const operationId =
      typeof body.operationId === "string" ? body.operationId.trim() : "";

    if (!UUID_PATTERN.test(operationId)) {
      return NextResponse.json(
        { error: "A valid moderation operation id is required." },
        { status: 400 },
      );
    }
    const requiredPermission =
      action === "ban"
        ? MODERATION_ACTIONS.banUser
        : action === "unban"
          ? MODERATION_ACTIONS.unbanUser
          : null;

    if (!requiredPermission) {
      return NextResponse.json({ error: "Unsupported ban action." }, { status: 400 });
    }

    if (!canPerformModerationAction(getUserModerationRole(accessUser), requiredPermission)) {
      return NextResponse.json({ error: "Only admins can manage bans." }, { status: 403 });
    }

    const targetUserId = resolvedParams.userId;

    if (!targetUserId) {
      return NextResponse.json({ error: "Missing target user." }, { status: 400 });
    }

    if (targetUserId === accessUser.id) {
      return NextResponse.json({ error: "You cannot ban your own account." }, { status: 400 });
    }

    const targetUser = await getTargetUser(admin, targetUserId);

    if (getUserModerationRole(targetUser) === "admin") {
      return NextResponse.json(
        { error: "Admin accounts cannot be banned from this screen." },
        { status: 400 },
      );
    }

    if (action === "unban") {
      const revocationReason = normalizeRevocationReason(body.revocationReason);
      const requestId = operationId;

      if (
        revocationReason &&
        (Array.from(revocationReason).length < 10 ||
          Array.from(revocationReason).length > 1000)
      ) {
        return NextResponse.json(
          { error: "Explain the unban reason in 10-1000 characters." },
          { status: 400 },
        );
      }

      const operationResult = await updateBanStateWithCompensation(
        admin,
        supabase,
        targetUser,
        "none",
        false,
        {
          revocationReason: revocationReason || "Ban revoked by an administrator.",
          requestId,
        },
      );

      return NextResponse.json({
        success: true,
        isBanned: Boolean(
          operationResult.bannedUntil &&
            new Date(operationResult.bannedUntil).getTime() > Date.now(),
        ),
        bannedUntil: operationResult.bannedUntil,
      });
    }

    if (action === "ban") {
      const banDuration = getSupabaseBanDuration(duration);

      if (!banDuration) {
        return NextResponse.json({ error: "Unsupported ban duration." }, { status: 400 });
      }

      const validatedReason = validateBanReason({ reasonCode, userMessage });

      if (!validatedReason.ok) {
        const error =
          validatedReason.error === "reason_code"
            ? "Choose a supported ban reason."
            : `Explain the ban reason in ${BAN_REASON_MESSAGE_MIN_LENGTH}-${BAN_REASON_MESSAGE_MAX_LENGTH} characters.`;

        return NextResponse.json({ error }, { status: 400 });
      }

      const operationResult = await updateBanStateWithCompensation(
        admin,
        supabase,
        targetUser,
        banDuration,
        true,
        {
          ...validatedReason,
          requestId: operationId,
        },
      );

      return NextResponse.json({
        success: true,
        isBanned: Boolean(
          operationResult.bannedUntil &&
            new Date(operationResult.bannedUntil).getTime() > Date.now(),
        ),
        bannedUntil: operationResult.bannedUntil,
        reasonCode: validatedReason.reasonCode,
      });
    }
  } catch (error) {
    console.error("Failed to update ban state:", error?.message ?? error);
    return NextResponse.json(
      { error: "Could not update the ban state right now." },
      { status: 500 },
    );
  }
}
