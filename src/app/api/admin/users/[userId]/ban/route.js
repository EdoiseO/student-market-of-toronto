import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getUserModerationRole } from "@/lib/moderation";
import {
  BAN_REASON_MESSAGE_MAX_LENGTH,
  BAN_REASON_MESSAGE_MIN_LENGTH,
  MODERATION_ACTIONS,
  canPerformModerationAction,
  normalizeBanDuration,
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

async function setApplicationBan(moderationClient, input) {
  const { data, error } = await moderationClient.rpc(
    "set_application_moderation_ban",
    {
      p_subject_user_id: input.subjectUserId,
      p_action: input.action,
      p_duration: input.duration ?? null,
      p_reason_code: input.reasonCode ?? null,
      p_user_message: input.userMessage ?? null,
      p_revocation_reason: input.revocationReason ?? null,
      p_request_id: input.requestId,
    },
  );

  if (error) {
    throw error;
  }

  const result = Array.isArray(data) ? data[0] : data;

  if (!result?.sanction_id || typeof result.is_banned !== "boolean") {
    throw new Error("Application ban command returned an invalid result.");
  }

  return result;
}

async function getBanAuditResult(admin, sanctionId, actorId) {
  const { data, error } = await admin
    .from("moderation_audit_events")
    .select("id, event_type, occurred_at")
    .eq("sanction_id", sanctionId)
    .eq("actor_user_id_snapshot", actorId)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Could not load the application-ban audit result:", error.code ?? "unknown_error");
  }

  return data ?? null;
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
      return NextResponse.json({ error: "You cannot change your own ban state." }, { status: 400 });
    }

    const targetUser = await getTargetUser(admin, targetUserId);

    if (action === "ban" && getUserModerationRole(targetUser) === "admin") {
      return NextResponse.json(
        { error: "Admin accounts cannot be banned from this screen." },
        { status: 400 },
      );
    }

    if (action === "unban") {
      const revocationReason = normalizeRevocationReason(body.revocationReason);
      const requestId = operationId;

      if (
        Array.from(revocationReason).length < 10 ||
        Array.from(revocationReason).length > 1000
      ) {
        return NextResponse.json(
          { error: "Explain the unban reason in 10-1000 characters." },
          { status: 400 },
        );
      }

      const operationResult = await setApplicationBan(supabase, {
        subjectUserId: targetUser.id,
        action: "unban",
        revocationReason,
        requestId,
      });
      const audit = await getBanAuditResult(
        admin,
        operationResult.sanction_id,
        accessUser.id,
      );

      return NextResponse.json({
        success: true,
        isBanned: operationResult.is_banned,
        bannedUntil: operationResult.banned_until ?? null,
        sanctionId: operationResult.sanction_id,
        replayed: operationResult.replayed === true,
        auditEventId: audit?.id ?? null,
        auditEventType: audit?.event_type ?? null,
        auditOccurredAt: audit?.occurred_at ?? null,
        notificationQueued: true,
      });
    }

    if (action === "ban") {
      const banDuration = normalizeBanDuration(duration);

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

      const operationResult = await setApplicationBan(supabase, {
        subjectUserId: targetUser.id,
        action: "ban",
        duration: banDuration,
        reasonCode: validatedReason.reasonCode,
        userMessage: validatedReason.userMessage,
        requestId: operationId,
      });
      const audit = await getBanAuditResult(
        admin,
        operationResult.sanction_id,
        accessUser.id,
      );

      return NextResponse.json({
        success: true,
        isBanned: operationResult.is_banned,
        bannedUntil: operationResult.banned_until ?? null,
        reasonCode: validatedReason.reasonCode,
        sanctionId: operationResult.sanction_id,
        replayed: operationResult.replayed === true,
        auditEventId: audit?.id ?? null,
        auditEventType: audit?.event_type ?? null,
        auditOccurredAt: audit?.occurred_at ?? null,
        notificationQueued: true,
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
