import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getUserModerationRole } from "@/lib/moderation";
import {
  MODERATION_ACTIONS,
  canPerformModerationAction,
} from "@/lib/moderation-policy.mjs";
import {
  isListingReviewRevisionConflict,
  parseListingContentRevision,
  parseListingSubmissionTimestamp,
} from "@/lib/listing-integrity.mjs";
import { createAdminClient, getLatestAuthUser } from "@/lib/supabase-admin";
import { createClient } from "@/utils/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

    if (
      !canPerformModerationAction(
        getUserModerationRole(moderationUser),
        MODERATION_ACTIONS.decideListings,
      )
    ) {
      return NextResponse.json({ error: "Listing decision permission required." }, { status: 403 });
    }

    const {
      action,
      feedback,
      operationId,
      expectedContentRevision,
      expectedSubmittedForReviewAt,
    } = await request.json();
    const listingId = resolvedParams.listingId;

    if (!listingId) {
      return NextResponse.json({ error: "Missing listing id." }, { status: 400 });
    }

    if (typeof operationId !== "string" || !UUID_PATTERN.test(operationId.trim())) {
      return NextResponse.json(
        { error: "A valid moderation operation id is required." },
        { status: 400 },
      );
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

    const { data: decisionResult, error: decisionError } = await supabase.rpc(
      "decide_listing_moderation",
      {
        p_listing_id: listingId,
        p_expected_content_revision: reviewedContentRevision,
        p_expected_submitted_for_review_at: reviewedSubmissionTimestamp,
        p_action: action,
        p_feedback: action === "rejected" ? sellerFeedback : null,
        p_request_id: operationId.trim(),
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

    const nextStatus = action === "approved" ? "active" : "rejected";

    if (updatedListing.status !== nextStatus) {
      throw new Error(
        `listing_update_mismatch: expected_status=${nextStatus}; actual_status=${updatedListing.status}; submitted_for_review_at=${updatedListing.submitted_for_review_at ?? "null"}; moderation_reviewed_at=${updatedListing.moderation_reviewed_at ?? "null"}; moderation_reviewed_by=${updatedListing.moderation_reviewed_by ?? "null"}`,
      );
    }

    return NextResponse.json({
      success: true,
      nextStatus,
      // The trusted RPC inserts this notification in the same transaction as
      // the listing decision. A successful response therefore means the
      // durable output exists, including on exact operation replay.
      notificationSent: true,
    });
  } catch (error) {
    console.error("Failed to moderate listing decision:", error?.message ?? error);
    return NextResponse.json(
      { error: "Could not update this listing approval right now." },
      { status: 500 },
    );
  }
}
