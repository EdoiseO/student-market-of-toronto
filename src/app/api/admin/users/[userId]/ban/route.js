import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";

import { getUserModerationRole } from "@/lib/moderation";
import { isUserStatusTableMissing } from "@/lib/user-status";
import { createClient } from "@/utils/supabase/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const BAN_DURATIONS = {
  "24h": "24h",
  "7d": "168h",
  "30d": "720h",
  permanent: "876000h",
};

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

async function syncAppBanState(admin, userId, isBanned, bannedUntil) {
  const { error } = await admin.from("user_status").upsert(
    {
      user_id: userId,
      is_banned: isBanned,
      banned_until: bannedUntil,
      ban_reason: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    if (isUserStatusTableMissing(error)) {
      console.error("Ban state table is not configured in Supabase yet:", error.message);
      return;
    }

    throw error;
  }
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

    if (getUserModerationRole(user) !== "admin") {
      return NextResponse.json({ error: "Only admins can manage bans." }, { status: 403 });
    }

    const { action, duration } = await request.json();
    const targetUserId = resolvedParams.userId;

    if (!targetUserId) {
      return NextResponse.json({ error: "Missing target user." }, { status: 400 });
    }

    if (targetUserId === user.id) {
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
      const {
        data: { user: updatedUser },
        error,
      } = await admin.auth.admin.updateUserById(targetUserId, {
        ban_duration: "none",
      });

      if (error) {
        throw error;
      }

      await syncAppBanState(admin, targetUserId, false, null);

      return NextResponse.json({
        success: true,
        isBanned: false,
        bannedUntil: updatedUser?.banned_until ?? null,
      });
    }

    if (action === "ban") {
      const banDuration = BAN_DURATIONS[duration];

      if (!banDuration) {
        return NextResponse.json({ error: "Unsupported ban duration." }, { status: 400 });
      }

      const {
        data: { user: updatedUser },
        error,
      } = await admin.auth.admin.updateUserById(targetUserId, {
        ban_duration: banDuration,
      });

      if (error) {
        throw error;
      }

      await syncAppBanState(admin, targetUserId, true, updatedUser?.banned_until ?? null);

      return NextResponse.json({
        success: true,
        isBanned: true,
        bannedUntil: updatedUser?.banned_until ?? null,
      });
    }

    return NextResponse.json({ error: "Unsupported ban action." }, { status: 400 });
  } catch (error) {
    console.error("Failed to update ban state:", error?.message ?? error);
    return NextResponse.json(
      { error: error?.message ?? "Could not update the ban state right now." },
      { status: 500 },
    );
  }
}
