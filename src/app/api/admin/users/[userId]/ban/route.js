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
import { isUserStatusTableMissing } from "@/lib/user-status";
import { createClient } from "@/utils/supabase/server";

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

async function syncAppBanState(admin, userId, isBanned, bannedUntil, banReason = null) {
  const { error } = await admin.from("user_status").upsert(
    {
      user_id: userId,
      is_banned: isBanned,
      banned_until: bannedUntil,
      ban_reason: isBanned ? banReason : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    if (isUserStatusTableMissing(error)) {
      throw new Error("Ban state table is not configured in Supabase yet.", { cause: error });
    }

    throw error;
  }
}

async function updateBanStateWithCompensation(
  admin,
  targetUser,
  nextBanDuration,
  nextIsBanned,
  banReason = null,
) {
  const previousBanDuration = getRestorableBanDuration(targetUser.banned_until);
  const {
    data: { user: updatedUser },
    error: authUpdateError,
  } = await admin.auth.admin.updateUserById(targetUser.id, {
    ban_duration: nextBanDuration,
  });

  if (authUpdateError) {
    throw authUpdateError;
  }

  try {
    await syncAppBanState(
      admin,
      targetUser.id,
      nextIsBanned,
      nextIsBanned ? updatedUser?.banned_until ?? null : null,
      banReason,
    );
  } catch (syncError) {
    const { error: rollbackError } = await admin.auth.admin.updateUserById(targetUser.id, {
      ban_duration: previousBanDuration,
    });

    if (rollbackError) {
      console.error("Auth ban rollback failed after app-state sync error:", rollbackError.message);
      throw new Error("Ban state could not be synchronized or safely rolled back.", {
        cause: syncError,
      });
    }

    throw syncError;
  }

  return updatedUser;
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
      const updatedUser = await updateBanStateWithCompensation(
        admin,
        targetUser,
        "none",
        false,
      );

      return NextResponse.json({
        success: true,
        isBanned: false,
        bannedUntil: updatedUser?.banned_until ?? null,
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

      const updatedUser = await updateBanStateWithCompensation(
        admin,
        targetUser,
        banDuration,
        true,
        validatedReason.userMessage,
      );

      return NextResponse.json({
        success: true,
        isBanned: true,
        bannedUntil: updatedUser?.banned_until ?? null,
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
