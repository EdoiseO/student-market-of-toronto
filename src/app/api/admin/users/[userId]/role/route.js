import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getUserModerationRole } from "@/lib/moderation";
import { MODERATOR_ROLE_GRANTED_NOTIFICATION_TYPE } from "@/lib/notifications";
import { createAdminClient, getLatestAuthUser } from "@/lib/supabase-admin";
import { getUserStatusRow, isUserBanned } from "@/lib/user-status";
import { createClient } from "@/utils/supabase/server";

function buildAppMetadata(currentAppMetadata, nextRole) {
  const nextAppMetadata = { ...(currentAppMetadata ?? {}) };

  if (!nextRole) {
    nextAppMetadata.role = null;
    nextAppMetadata.roles = [];
    return nextAppMetadata;
  }

  nextAppMetadata.role = nextRole;
  nextAppMetadata.roles = [nextRole];
  return nextAppMetadata;
}

function isModeratorRoleNotificationUnsupported(error) {
  const message = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    error?.code === "23514" ||
    error?.code === "22P02" ||
    message.includes("moderator_role_granted") ||
    (message.includes("notifications") && message.includes("type"))
  );
}

async function getTargetUser(admin, userId) {
  const {
    data: { user },
    error: getUserError,
  } = await admin.auth.admin.getUserById(userId);

  if (getUserError || !user) {
    throw getUserError ?? new Error("Target user not found.");
  }

  return user;
}

async function updateUserRole(admin, user, nextRole) {
  const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: buildAppMetadata(user.app_metadata, nextRole),
  });

  if (updateError) {
    throw updateError;
  }
}

async function createModeratorGrantedNotification(admin, userId) {
  const { error } = await admin.from("notifications").insert({
    user_id: userId,
    type: MODERATOR_ROLE_GRANTED_NOTIFICATION_TYPE,
    metadata: {
      title: "Moderator role granted",
      href: "/admin/users",
    },
  });

  if (error) {
    if (isModeratorRoleNotificationUnsupported(error)) {
      console.error(
        "Moderator role notification type is not enabled in Supabase yet:",
        error.message,
      );
      return false;
    }

    throw error;
  }

  return true;
}

export async function POST(request, { params }) {
  try {
    const resolvedParams = await params;
    const admin = createAdminClient();

    if (!admin) {
      return NextResponse.json(
        { error: "Role management is not configured in this environment." },
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

    const accessUser = await getLatestAuthUser(admin, user.id, "admin role management");

    if (!accessUser) {
      return NextResponse.json(
        { error: "Could not verify your current admin access." },
        { status: 503 },
      );
    }

    const actorStatusResult = await getUserStatusRow(supabase, accessUser.id);

    if (actorStatusResult.available !== true || actorStatusResult.error) {
      return NextResponse.json(
        { error: "Could not verify your current account standing." },
        { status: 503 },
      );
    }

    if (isUserBanned(actorStatusResult.data)) {
      return NextResponse.json(
        { error: "Restricted accounts cannot manage moderation roles." },
        { status: 403 },
      );
    }

    if (getUserModerationRole(accessUser) !== "admin") {
      return NextResponse.json({ error: "Only admins can update moderation roles." }, { status: 403 });
    }

    const { action } = await request.json();
    const targetUserId = resolvedParams.userId;

    if (!targetUserId) {
      return NextResponse.json({ error: "Missing target user." }, { status: 400 });
    }

    const targetStatusResult = await getUserStatusRow(admin, targetUserId);

    if (targetStatusResult.available !== true || targetStatusResult.error) {
      return NextResponse.json(
        { error: "Could not verify the target account standing." },
        { status: 503 },
      );
    }

    if (isUserBanned(targetStatusResult.data) && action !== "remove_moderator") {
      return NextResponse.json(
        { error: "Unban this account before granting or transferring moderation access." },
        { status: 409 },
      );
    }

    const targetUser = await getTargetUser(admin, targetUserId);
    const targetRole = getUserModerationRole(targetUser);

    if (action === "make_moderator") {
      if (targetUserId === accessUser.id || targetRole === "admin") {
        return NextResponse.json(
          { error: "Admin roles can only be changed through an admin transfer." },
          { status: 400 },
        );
      }

      if (targetRole === "moderator") {
        return NextResponse.json({ error: "This user is already a moderator." }, { status: 409 });
      }

      await updateUserRole(admin, targetUser, "moderator");
      const notificationSent = await createModeratorGrantedNotification(admin, targetUserId);
      return NextResponse.json({ success: true, nextRole: "moderator", notificationSent });
    }

    if (action === "remove_moderator") {
      if (targetUserId === accessUser.id || targetRole === "admin") {
        return NextResponse.json(
          { error: "Admin roles can only be changed through an admin transfer." },
          { status: 400 },
        );
      }

      if (targetRole !== "moderator") {
        return NextResponse.json({ error: "This user is not a moderator." }, { status: 409 });
      }

      await updateUserRole(admin, targetUser, null);
      return NextResponse.json({ success: true, nextRole: null });
    }

    if (action === "transfer_admin") {
      if (targetUserId === accessUser.id) {
        return NextResponse.json({ error: "You already have the admin role." }, { status: 400 });
      }

      if (targetRole === "admin") {
        return NextResponse.json({ error: "This user is already an admin." }, { status: 409 });
      }

      await updateUserRole(admin, targetUser, "admin");

      try {
        await updateUserRole(admin, accessUser, "moderator");
      } catch (transferError) {
        const { error: rollbackError } = await admin.auth.admin.updateUserById(targetUser.id, {
          app_metadata: targetUser.app_metadata ?? {},
        });

        if (rollbackError) {
          console.error(
            "Admin transfer rollback failed after demotion error:",
            rollbackError.message,
          );
          throw new Error("Admin transfer could not be completed or safely rolled back.", {
            cause: transferError,
          });
        }

        throw transferError;
      }

      return NextResponse.json({
        success: true,
        nextRole: "admin",
        currentUserNextRole: "moderator",
      });
    }

    return NextResponse.json({ error: "Unsupported role action." }, { status: 400 });
  } catch (error) {
    console.error("Failed to update moderation role:", error?.message ?? error);
    return NextResponse.json(
      { error: error?.message ?? "Could not update moderation roles right now." },
      { status: 500 },
    );
  }
}
