import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";

import { getUserModerationRole, isModerationRole } from "@/lib/moderation";
import {
  LISTING_APPROVED_NOTIFICATION_TYPE,
  LISTING_REJECTED_NOTIFICATION_TYPE,
} from "@/lib/notifications";
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

    const {
      data: { session },
    } = await supabase.auth.getSession();

    const requestUser = user ?? session?.user ?? null;

    if ((authError && !requestUser) || !requestUser) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }

    const {
      data: { user: latestAuthUser },
      error: latestAuthUserError,
    } = await admin.auth.admin.getUserById(requestUser.id);

    if (latestAuthUserError || !latestAuthUser) {
      console.error(
        "Falling back to session role check for listing moderation:",
        latestAuthUserError?.message ?? "Missing latest auth user",
      );
    }

    const moderationUser = latestAuthUser ?? requestUser;

    if (!isModerationRole(getUserModerationRole(moderationUser))) {
      return NextResponse.json({ error: "Moderator role required" }, { status: 403 });
    }

    const { action, feedback } = await request.json();
    const listingId = resolvedParams.listingId;

    if (!listingId) {
      return NextResponse.json({ error: "Missing listing id." }, { status: 400 });
    }

    if (action !== "approved" && action !== "rejected") {
      return NextResponse.json({ error: "Unsupported moderation action." }, { status: 400 });
    }

    const sellerFeedback = typeof feedback === "string" ? feedback.trim() : "";

    if (action === "rejected" && !sellerFeedback) {
      return NextResponse.json(
        { error: "Seller feedback is required when rejecting a listing." },
        { status: 400 },
      );
    }

    const { data: listing, error: listingError } = await admin
      .from("listings")
      .select("id, seller_id, slug, title, status")
      .eq("id", listingId)
      .maybeSingle();

    if (listingError || !listing) {
      throw listingError ?? new Error("listing_lookup_failed");
    }

    const decidedAt = new Date().toISOString();
    const nextStatus = action === "approved" ? "active" : "rejected";
    const listingUpdatePayload = {
      status: nextStatus,
      moderation_feedback: action === "rejected" ? sellerFeedback : null,
      moderation_reviewed_at: decidedAt,
      moderation_reviewed_by: moderationUser.id,
    };

    let updateError = null;

    const { error: sessionUpdateError } = await supabase
      .from("listings")
      .update(listingUpdatePayload)
      .eq("id", listingId);

    if (sessionUpdateError) {
      console.error(
        "Listing moderation session update failed, retrying with admin client:",
        sessionUpdateError.message,
      );

      const { error: adminUpdateError } = await admin
        .from("listings")
        .update(listingUpdatePayload)
        .eq("id", listingId);

      updateError = adminUpdateError ?? sessionUpdateError;
    }

    if (updateError) {
      throw new Error(`listing_update_failed: ${updateError.message}`);
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
        listing,
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
