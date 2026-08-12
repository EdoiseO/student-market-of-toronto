import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getUserModerationRole, isModerationRole } from "@/lib/moderation";
import {
  LISTING_APPROVED_NOTIFICATION_TYPE,
  LISTING_REJECTED_NOTIFICATION_TYPE,
} from "@/lib/notifications";
import {
  isListingReviewRevisionConflict,
  parseListingContentRevision,
  parseListingSubmissionTimestamp,
} from "@/lib/listing-integrity.mjs";
import { createAdminClient, getLatestAuthUser } from "@/lib/supabase-admin";
import { createClient } from "@/utils/supabase/server";

function isListingModerationHistoryMissing(error) {
  const message = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes("listing_moderation_history")
  );
}

function isListingDecisionNotificationUnsupported(error) {
  const message = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    error?.code === "23514" ||
    error?.code === "22P02" ||
    message.includes("listing_approved") ||
    message.includes("listing_rejected") ||
    (message.includes("notifications") && message.includes("type"))
  );
}

async function insertModerationHistory(admin, listingId, action, feedback, decidedBy, decidedAt) {
  const { error } = await admin.from("listing_moderation_history").insert({
    listing_id: listingId,
    action,
    feedback,
    decided_by: decidedBy,
    decided_at: decidedAt,
  });

  if (error && !isListingModerationHistoryMissing(error)) {
    throw error;
  }
}

async function insertListingDecisionNotification(admin, listing, action, feedback) {
  if (!listing?.seller_id) {
    return false;
  }

  const type = action === "approved"
    ? LISTING_APPROVED_NOTIFICATION_TYPE
    : LISTING_REJECTED_NOTIFICATION_TYPE;

  const metadata = {
    listing_title: listing.title,
    listing_slug: listing.slug,
    href: "/dashboard",
  };

  if (action === "rejected" && feedback) {
    metadata.feedback = feedback;
  }

  const { error } = await admin.from("notifications").insert({
    user_id: listing.seller_id,
    type,
    listing_id: listing.id,
    metadata,
  });

  if (error) {
    if (isListingDecisionNotificationUnsupported(error)) {
      console.error("Listing decision notification type is not enabled yet:", error.message);
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
        { error: "Listing moderation is not configured in this environment." },
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

    const moderationUser = await getLatestAuthUser(admin, user.id, "listing moderation");

    if (!moderationUser) {
      return NextResponse.json(
        { error: "Could not verify your moderation access." },
        { status: 503 },
      );
    }

    if (!isModerationRole(getUserModerationRole(moderationUser))) {
      return NextResponse.json({ error: "Moderator role required" }, { status: 403 });
    }

    const {
      action,
      feedback,
      expectedContentRevision,
      expectedSubmittedForReviewAt,
    } = await request.json();
    const listingId = resolvedParams.listingId;

    if (!listingId) {
      return NextResponse.json({ error: "Missing listing id." }, { status: 400 });
    }

    if (action !== "approved" && action !== "rejected") {
      return NextResponse.json({ error: "Unsupported moderation action." }, { status: 400 });
    }

    const sellerFeedback = typeof feedback === "string" ? feedback.trim() : "";
    const reviewedContentRevision = parseListingContentRevision(expectedContentRevision);
    const reviewedSubmissionTimestamp = parseListingSubmissionTimestamp(
      expectedSubmittedForReviewAt,
    );

    if (reviewedContentRevision === null || reviewedSubmissionTimestamp === null) {
      return NextResponse.json(
        { error: "The reviewed listing revision is missing or invalid." },
        { status: 400 },
      );
    }

    if (action === "rejected" && (!sellerFeedback || sellerFeedback.length > 3000)) {
      return NextResponse.json(
        { error: "Seller feedback is required when rejecting a listing." },
        { status: 400 },
      );
    }

    const { data: decisionResult, error: decisionError } = await admin.rpc(
      "decide_listing_moderation",
      {
        p_listing_id: listingId,
        p_expected_content_revision: reviewedContentRevision,
        p_expected_submitted_for_review_at: reviewedSubmissionTimestamp,
        p_action: action,
        p_feedback: action === "rejected" ? sellerFeedback : null,
        p_moderator_id: moderationUser.id,
      },
    );

    if (isListingReviewRevisionConflict(decisionError)) {
      return NextResponse.json(
        { error: "This listing changed after you loaded it. Reload before deciding." },
        { status: 409 },
      );
    }

    if (decisionError?.code === "P0002") {
      return NextResponse.json({ error: "Listing not found." }, { status: 404 });
    }

    if (decisionError) {
      throw decisionError;
    }

    const updatedListing = Array.isArray(decisionResult)
      ? decisionResult[0]
      : decisionResult;

    if (!updatedListing) {
      throw new Error("listing_decision_failed");
    }

    const decidedAt = updatedListing.moderation_reviewed_at;
    const nextStatus = action === "approved" ? "active" : "rejected";

    if (updatedListing.status !== nextStatus) {
      throw new Error(
        `listing_update_mismatch: expected_status=${nextStatus}; actual_status=${updatedListing.status}; submitted_for_review_at=${updatedListing.submitted_for_review_at ?? "null"}; moderation_reviewed_at=${updatedListing.moderation_reviewed_at ?? "null"}; moderation_reviewed_by=${updatedListing.moderation_reviewed_by ?? "null"}`,
      );
    }

    try {
      await insertModerationHistory(
        admin,
        listingId,
        action,
        action === "rejected" ? sellerFeedback : null,
        moderationUser.id,
        decidedAt,
      );
    } catch (error) {
      throw new Error(`listing_history_failed: ${error.message}`);
    }

    let notificationSent = false;

    try {
      notificationSent = await insertListingDecisionNotification(
        admin,
        updatedListing,
        action,
        action === "rejected" ? sellerFeedback : null,
      );
    } catch (error) {
      throw new Error(`listing_notification_failed: ${error.message}`);
    }

    return NextResponse.json({
      success: true,
      nextStatus,
      notificationSent,
    });
  } catch (error) {
    console.error("Failed to moderate listing decision:", error?.message ?? error);
    return NextResponse.json(
      { error: error?.message ?? "Could not update this listing approval right now." },
      { status: 500 },
    );
  }
}
