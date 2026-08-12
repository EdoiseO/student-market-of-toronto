import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import {
  isModerationRole,
  getUserModerationRole,
  REPORT_STATUS_VALUES,
} from "@/lib/moderation";
import { createAdminClient, getLatestAuthUser } from "@/lib/supabase-admin";
import { createClient } from "@/utils/supabase/server";

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

  const moderationUser = await getLatestAuthUser(admin, user.id, "moderation actions");

  if (!moderationUser) {
    return {
      errorResponse: NextResponse.json(
        { error: "Could not verify your moderation access." },
        { status: 503 },
      ),
    };
  }

  if (!isModerationRole(getUserModerationRole(moderationUser))) {
    return {
      errorResponse: NextResponse.json(
        { error: "Only moderation users can perform this action." },
        { status: 403 },
      ),
    };
  }

  return { admin, user: moderationUser };
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
        ? [...new Set(payload.reportIds.filter(Boolean))]
        : [];
      const listingId = payload?.listingId;

      if (!reportIds.length || !listingId) {
        return NextResponse.json({ error: "Missing listing moderation payload." }, { status: 400 });
      }

      const { data: reportRows, error: reportLookupError } = await admin
        .from("reports")
        .select("id, subject_type, subject_id, listing_id, status")
        .in("id", reportIds);

      if (reportLookupError) {
        throw reportLookupError;
      }

      const everyReportMatchesListing =
        reportRows?.length === reportIds.length &&
        reportRows.every((report) => {
          const reportTargetIds = [report.listing_id, report.subject_id].filter(Boolean);

          return (
            report.subject_type === "listing" &&
            report.status === REPORT_STATUS_VALUES.open &&
            reportTargetIds.length > 0 &&
            reportTargetIds.every((reportTargetId) => reportTargetId === listingId)
          );
        });

      if (!everyReportMatchesListing) {
        return NextResponse.json(
          { error: "Every selected open report must belong to this listing." },
          { status: 409 },
        );
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
        .in("id", reportIds)
        .eq("status", REPORT_STATUS_VALUES.open);

      if (reportsError) {
        throw reportsError;
      }

      return NextResponse.json({ success: true, updatedCount: reportIds.length });
    }

    if (action === "force_name_change") {
      if (getUserModerationRole(user) !== "admin") {
        return NextResponse.json(
          { error: "Only admins can require a name change." },
          { status: 403 },
        );
      }

      const reportIds = Array.isArray(payload?.reportIds)
        ? payload.reportIds.filter(Boolean)
        : [];
      const targetUserId = payload?.userId;

      if (!reportIds.length || !targetUserId) {
        return NextResponse.json(
          { error: "Missing name change moderation payload." },
          { status: 400 },
        );
      }

      const {
        data: { user: targetUser },
        error: targetUserError,
      } = await admin.auth.admin.getUserById(targetUserId);

      if (targetUserError || !targetUser) {
        throw targetUserError ?? new Error("Target user not found.");
      }

      if (getUserModerationRole(targetUser) === "admin") {
        return NextResponse.json(
          { error: "Admin accounts cannot be forced to change their name from this screen." },
          { status: 400 },
        );
      }

      const reviewedAt = new Date().toISOString();
      const nextUserMetadata = {
        ...(targetUser.user_metadata ?? {}),
        first_name: null,
        last_name: null,
      };
      delete nextUserMetadata.force_name_change;

      const { error: authUpdateError } = await admin.auth.admin.updateUserById(targetUserId, {
        user_metadata: nextUserMetadata,
        app_metadata: {
          ...(targetUser.app_metadata ?? {}),
          force_name_change: true,
        },
      });

      if (authUpdateError) {
        throw authUpdateError;
      }

      const { error: profileError } = await admin
        .from("profiles")
        .update({
          first_name: null,
          last_name: null,
        })
        .eq("id", targetUserId);

      if (profileError) {
        throw profileError;
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
