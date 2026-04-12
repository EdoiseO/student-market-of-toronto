import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";

import {
  isModerationRole,
  getUserModerationRole,
  REPORT_STATUS_VALUES,
} from "@/lib/moderation";
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

function isReportNotesColumnsMissing(error) {
  const message = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    message.includes("moderator_notes") ||
    message.includes("moderator_notes_updated_at") ||
    message.includes("moderator_notes_updated_by")
  );
}

async function requireModerationUser() {
  const admin = createAdminClient();

  if (!admin) {
    return {
      errorResponse: NextResponse.json(
        { error: "Moderation actions are not configured in this environment." },
        { status: 503 },
      ),
    };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      errorResponse: NextResponse.json({ error: "You must be signed in." }, { status: 401 }),
    };
  }

  if (!isModerationRole(getUserModerationRole(user))) {
    return {
      errorResponse: NextResponse.json(
        { error: "Only moderation users can perform this action." },
        { status: 403 },
      ),
    };
  }

  return { admin, user };
}

export async function POST(request) {
  try {
    const moderationContext = await requireModerationUser();

    if (moderationContext.errorResponse) {
      return moderationContext.errorResponse;
    }

    const { admin, user } = moderationContext;
    const payload = await request.json();
    const action = payload?.action;

    if (action === "update_status") {
      const reportIds = Array.isArray(payload?.reportIds)
        ? payload.reportIds.filter(Boolean)
        : [];
      const nextStatus = payload?.status;

      if (!reportIds.length) {
        return NextResponse.json({ error: "Missing report ids." }, { status: 400 });
      }

      if (
        nextStatus !== REPORT_STATUS_VALUES.resolved &&
        nextStatus !== REPORT_STATUS_VALUES.dismissed
      ) {
        return NextResponse.json({ error: "Unsupported report status." }, { status: 400 });
      }

      const reviewedAt = new Date().toISOString();
      const { error } = await admin
        .from("reports")
        .update({
          status: nextStatus,
          reviewed_by: user.id,
          reviewed_at: reviewedAt,
        })
        .in("id", reportIds);

      if (error) {
        throw error;
      }

      return NextResponse.json({ success: true, updatedCount: reportIds.length });
    }

    if (action === "remove_listing") {
      const reportIds = Array.isArray(payload?.reportIds)
        ? payload.reportIds.filter(Boolean)
        : [];
      const listingId = payload?.listingId;

      if (!reportIds.length || !listingId) {
        return NextResponse.json({ error: "Missing listing moderation payload." }, { status: 400 });
      }

      const reviewedAt = new Date().toISOString();
      const { error: listingError } = await admin
        .from("listings")
        .update({
          status: "inactive",
          moderation_reviewed_at: reviewedAt,
          moderation_reviewed_by: user.id,
        })
        .eq("id", listingId);

      if (listingError) {
        throw listingError;
      }

      const { error: reportsError } = await admin
        .from("reports")
        .update({
          status: REPORT_STATUS_VALUES.resolved,
          reviewed_by: user.id,
          reviewed_at: reviewedAt,
        })
        .in("id", reportIds);

      if (reportsError) {
        throw reportsError;
      }

      return NextResponse.json({ success: true, updatedCount: reportIds.length });
    }

    if (action === "save_notes") {
      const reportId = payload?.reportId;
      const moderatorNotes = typeof payload?.moderatorNotes === "string" ? payload.moderatorNotes : "";

      if (!reportId) {
        return NextResponse.json({ error: "Missing report id." }, { status: 400 });
      }

      const { error } = await admin
        .from("reports")
        .update({
          moderator_notes: moderatorNotes.trim() || null,
          moderator_notes_updated_at: new Date().toISOString(),
          moderator_notes_updated_by: user.id,
        })
        .eq("id", reportId);

      if (error) {
        if (isReportNotesColumnsMissing(error)) {
          return NextResponse.json(
            { error: "Moderator notes are not configured in this environment yet." },
            { status: 400 },
          );
        }

        throw error;
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unsupported moderation action." }, { status: 400 });
  } catch (error) {
    console.error("Failed to perform moderation action:", error?.message ?? error);
    return NextResponse.json(
      { error: error?.message ?? "Could not complete the moderation action right now." },
      { status: 500 },
    );
  }
}
