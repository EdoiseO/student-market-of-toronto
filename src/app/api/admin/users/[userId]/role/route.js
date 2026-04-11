import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";

import { getUserModerationRole } from "@/lib/moderation";
import { MODERATOR_ROLE_GRANTED_NOTIFICATION_TYPE } from "@/lib/notifications";
import { createClient } from "@/utils/supabase/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function createAdminClient() {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return null;
  }

  return createSupabaseAdminClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function buildAppMetadata(currentAppMetadata, nextRole) {
  const nextAppMetadata = { ...(currentAppMetadata ?? {}) };

  if (!nextRole) {
    delete nextAppMetadata.role;
    delete nextAppMetadata.roles;
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

async function updateUserRole(admin, userId, nextRole) {
  const {
    data: { user },
    error: getUserError,
  } = await admin.auth.admin.getUserById(userId);

  if (getUserError || !user) {
    throw getUserError ?? new Error("Target user not found.");
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
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

  if (getUserModerationRole(user) !== "admin") {
    return NextResponse.json({ error: "Only admins can update moderation roles." }, { status: 403 });
  }

  const { action } = await request.json();
  const targetUserId = resolvedParams.userId;

  if (!targetUserId) {
    return NextResponse.json({ error: "Missing target user." }, { status: 400 });
  }

  if (action === "make_moderator") {
    await updateUserRole(admin, targetUserId, "moderator");
    const notificationSent = await createModeratorGrantedNotification(admin, targetUserId);
    return NextResponse.json({ success: true, nextRole: "moderator", notificationSent });
  }

  if (action === "remove_moderator") {
    await updateUserRole(admin, targetUserId, null);
    return NextResponse.json({ success: true, nextRole: null });
  }

  if (action === "transfer_admin") {
    if (targetUserId === user.id) {
      return NextResponse.json({ error: "You already have the admin role." }, { status: 400 });
    }

    await updateUserRole(admin, targetUserId, "admin");
    await updateUserRole(admin, user.id, "moderator");

    return NextResponse.json({
      success: true,
      nextRole: "admin",
      currentUserNextRole: "moderator",
    });
  }

  return NextResponse.json({ error: "Unsupported role action." }, { status: 400 });
}
