import { ArrowLeft, Flag, MessageSquareWarning } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AdminReportReviewContent } from "@/components/admin-report-review-content";
import { Button } from "@/components/ui/button";
import { MESSAGE_CONVERSATION_SELECT, getConversationDisplayName } from "@/lib/messages";
import {
  MODERATION_REPORT_SELECT,
  REPORT_SUBJECT_TYPES,
  getModerationDisplayName,
  getUserModerationRole,
  isModerationRole,
  isReportsTableMissing,
} from "@/lib/moderation";
import { translations } from "@/lib/translations";
import { createClient } from "@/utils/supabase/server";

function getPrimaryListingImageUrl(listingImages) {
  return (listingImages ?? [])
    .slice()
    .sort((firstImage, secondImage) => firstImage.position - secondImage.position)[0]?.image_url;
}

export default async function AdminReportReviewPage({ params }) {
  const resolvedParams = await params;
  const cookieStore = await cookies();
  const language = cookieStore.get("language")?.value === "fr" ? "fr" : "en";
  const t = translations[language] || translations.en;
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  if (!isModerationRole(getUserModerationRole(user))) {
    redirect("/");
  }

  const { data: reportRow, error: reportError } = await supabase
    .from("reports")
    .select(MODERATION_REPORT_SELECT)
    .eq("id", resolvedParams.reportId)
    .maybeSingle();

  if (reportError && !isReportsTableMissing(reportError)) {
    console.error("Failed to load moderation report review:", reportError.message);
  }

  if (!reportRow) {
    notFound();
  }

  const profileIds = [reportRow.reporter_user_id, reportRow.reported_user_id].filter(Boolean);
  const { data: reportProfiles, error: reportProfilesError } = profileIds.length
    ? await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .in("id", profileIds)
    : { data: [], error: null };

  if (reportProfilesError) {
    console.error("Failed to load moderation report profiles:", reportProfilesError.message);
  }

  const reportProfilesById = new Map((reportProfiles ?? []).map((profile) => [profile.id, profile]));

  let reviewIcon = Flag;
  let conversation = null;
  let messages = [];
  let listingReview = null;
  let reportMessage = null;

  if (reportRow.subject_type === REPORT_SUBJECT_TYPES.message) {
    reviewIcon = MessageSquareWarning;

    const { data: conversationRow, error: conversationError } = await supabase
      .from("conversations")
      .select(MESSAGE_CONVERSATION_SELECT)
      .eq("id", reportRow.conversation_id)
      .maybeSingle();

    if (conversationError) {
      console.error("Failed to load moderation conversation review:", conversationError.message);
    }

    if (!conversationRow) {
      notFound();
    }

    const { data: messageRows, error: messagesError } = await supabase
      .from("messages")
      .select("id, sender_id, body, created_at")
      .eq("conversation_id", conversationRow.id)
      .order("created_at", { ascending: true });

    if (messagesError) {
      console.error("Failed to load moderation conversation messages:", messagesError.message);
    }

    const listing = Array.isArray(conversationRow.listings)
      ? conversationRow.listings[0]
      : conversationRow.listings;
    const buyerProfile = Array.isArray(conversationRow.buyer_profile)
      ? conversationRow.buyer_profile[0]
      : conversationRow.buyer_profile;
    const sellerProfile = Array.isArray(conversationRow.seller_profile)
      ? conversationRow.seller_profile[0]
      : conversationRow.seller_profile;

    conversation = {
      id: conversationRow.id,
      listing: {
        id: listing?.id,
        slug: listing?.slug,
        title: listing?.title ?? t.listing,
        location: listing?.location ?? t.torontoMeetup,
        imageUrl: getPrimaryListingImageUrl(listing?.listing_images),
        status: "active",
      },
      buyer: {
        id: buyerProfile?.id,
        name: getConversationDisplayName(buyerProfile, t),
        school: buyerProfile?.school ?? t.torontoStudent,
        avatarPresetId: buyerProfile?.avatar_preset_id ?? null,
        avatarUrl: buyerProfile?.avatar_url ?? null,
      },
      seller: {
        id: sellerProfile?.id,
        name: getConversationDisplayName(sellerProfile, t),
        school: sellerProfile?.school ?? t.torontoStudent,
        avatarPresetId: sellerProfile?.avatar_preset_id ?? null,
        avatarUrl: sellerProfile?.avatar_url ?? null,
      },
    };

    messages = messageRows ?? [];
    reportMessage = messages.find((message) => message.id === reportRow.message_id) ?? null;
  } else {
    const { data: listingRow, error: listingError } = await supabase
      .from("listings")
      .select(
        "id, seller_id, slug, title, description, price, location, status, listing_images ( image_url, position )"
      )
      .eq("id", reportRow.listing_id)
      .maybeSingle();

    if (listingError) {
      console.error("Failed to load moderation listing review:", listingError.message);
    }

    if (!listingRow) {
      notFound();
    }

    const { data: sellerProfile, error: sellerError } = listingRow.seller_id
      ? await supabase
          .from("profiles")
          .select("id, first_name, last_name, school, avatar_preset_id, avatar_url")
          .eq("id", listingRow.seller_id)
          .maybeSingle()
      : { data: null, error: null };

    if (sellerError) {
      console.error("Failed to load moderation listing seller profile:", sellerError.message);
    }

    listingReview = {
      listing: {
        id: listingRow.id,
        slug: listingRow.slug,
        title: listingRow.title ?? t.listing,
        description: listingRow.description ?? "",
        location: listingRow.location ?? t.torontoMeetup,
        imageUrl: getPrimaryListingImageUrl(listingRow.listing_images),
        status: listingRow.status,
      },
      seller: sellerProfile
        ? {
            id: sellerProfile.id,
            name: getConversationDisplayName(sellerProfile, t),
            school: sellerProfile.school ?? t.torontoStudent,
            avatarPresetId: sellerProfile.avatar_preset_id ?? null,
            avatarUrl: sellerProfile.avatar_url ?? null,
          }
        : null,
    };
  }

  const report = {
    id: reportRow.id,
    subjectType: reportRow.subject_type,
    reason: reportRow.reason,
    details: reportRow.details,
    status: reportRow.status,
    createdAt: reportRow.created_at,
    reporter: {
      id: reportRow.reporter_user_id,
      name: getModerationDisplayName(reportProfilesById.get(reportRow.reporter_user_id), t),
    },
    reportedUser: {
      id: reportRow.reported_user_id,
      name: getModerationDisplayName(reportProfilesById.get(reportRow.reported_user_id), t),
    },
    message: reportMessage,
  };

  const ReviewIcon = reviewIcon;

  return (
    <main className="h-full min-h-0 overflow-hidden bg-zinc-100 px-5 pt-3 pb-5 dark:bg-background md:px-6 md:pt-3 md:pb-6 lg:px-7 lg:pt-4 lg:pb-7">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1280px] flex-col gap-3 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button asChild variant="ghost" className="h-9 rounded-full px-3">
            <Link href="/admin">
              <ArrowLeft className="size-4" />
              <span>{t.backToAdminReports}</span>
            </Link>
          </Button>
          <div className="flex items-center gap-2 rounded-full bg-background px-3 py-1.5 text-sm text-muted-foreground shadow-sm">
            <ReviewIcon className="size-4" />
            <span>{t.adminReportReviewTitle}</span>
          </div>
        </div>

        <AdminReportReviewContent
          report={report}
          conversation={conversation}
          messages={messages}
          listingReview={listingReview}
          currentUserId={user.id}
        />
      </div>
    </main>
  );
}
