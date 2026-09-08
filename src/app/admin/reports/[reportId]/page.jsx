import { getAdminQueueReturnHref } from "@/lib/admin-queue-navigation.mjs";
import { ArrowLeft, Flag, MessageSquareWarning } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AdminReportReviewContent } from "@/components/admin-report-review-content";
import { Button } from "@/components/ui/button";
import {
  MESSAGE_LISTING_IMAGE_LIMIT,
  getConversationDisplayName,
} from "@/lib/messages";
import {
  MODERATION_REPORT_SELECT,
  REPORT_SUBJECT_TYPES,
  getModerationDisplayName,
  getUserModerationRole,
  isModerationRole,
  isNameChangeRequired,
  isReportsTableMissing,
} from "@/lib/moderation";
import {
  MODERATION_ACTIONS,
  canPerformModerationAction,
} from "@/lib/moderation-policy.mjs";
import { createAdminClient, getLatestAuthUser } from "@/lib/supabase-admin";
import { loadReportConversationContext } from "@/lib/admin-report-context.mjs";
import { getUserStatusRow, isAuthUserBanned, isUserBanned } from "@/lib/user-status";
import { translations } from "@/lib/translations";
import { getServerSession } from "@/lib/server-session";

const MODERATOR_NOTE_HISTORY_PAGE_SIZE = 10;
const MODERATOR_NOTE_HISTORY_MAX_VISIBLE = 100;

function getPrimaryListingImageUrl(listingImages) {
  return (listingImages ?? [])
    .slice()
    .sort((firstImage, secondImage) => firstImage.position - secondImage.position)[0]?.image_url;
}

export default async function AdminReportReviewPage({ params, searchParams }) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const returnHref = getAdminQueueReturnHref(resolvedSearchParams?.returnTo, "/admin/reports");
  const requestedNoteHistoryCount = Math.min(
    MODERATOR_NOTE_HISTORY_MAX_VISIBLE,
    Math.max(
      MODERATOR_NOTE_HISTORY_PAGE_SIZE,
      Number.parseInt(resolvedSearchParams?.notes, 10) || MODERATOR_NOTE_HISTORY_PAGE_SIZE,
    ),
  );
  const { cookieStore, supabase, user } = await getServerSession();
  const language = cookieStore.get("language")?.value === "fr" ? "fr" : "en";
  const t = translations[language] || translations.en;
  const admin = createAdminClient();
  // Report data keeps the caller's RLS boundary, including role changes mid-request.
  const dataClient = supabase;

  if (!user) {
    redirect("/login");
  }

  if (!admin) redirect("/");
  const accessUser = await getLatestAuthUser(admin, user.id, "report review access");

  if (!accessUser || !isModerationRole(getUserModerationRole(accessUser))) {
    redirect("/");
  }

  const actorStatus = await getUserStatusRow(admin, user.id);
  if (actorStatus.error || actorStatus.available !== true) redirect("/");
  if (isAuthUserBanned(accessUser) || isUserBanned(actorStatus.data)) redirect("/banned");
  if (isNameChangeRequired(accessUser)) redirect("/dashboard/profile");

  const { data: reportRow, error: reportError } = await dataClient
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

  let relatedReportRows = [reportRow];

  if (reportRow.subject_type === REPORT_SUBJECT_TYPES.message && reportRow.message_id) {
    const { data: relatedRows, error: relatedError } = await dataClient
      .from("reports")
      .select(MODERATION_REPORT_SELECT)
      .eq("subject_type", REPORT_SUBJECT_TYPES.message)
      .eq("message_id", reportRow.message_id)
      .order("created_at", { ascending: false });

    if (relatedError) {
      console.error("Failed to load related message reports:", relatedError.message);
    } else if (relatedRows?.length) {
      relatedReportRows = relatedRows;
    }
  } else if (reportRow.subject_type === REPORT_SUBJECT_TYPES.listing && reportRow.listing_id) {
    const { data: relatedRows, error: relatedError } = await dataClient
      .from("reports")
      .select(MODERATION_REPORT_SELECT)
      .eq("subject_type", REPORT_SUBJECT_TYPES.listing)
      .eq("listing_id", reportRow.listing_id)
      .order("created_at", { ascending: false });

    if (relatedError) {
      console.error("Failed to load related listing reports:", relatedError.message);
    } else if (relatedRows?.length) {
      relatedReportRows = relatedRows;
    }
  } else if (reportRow.subject_type === REPORT_SUBJECT_TYPES.profile && reportRow.subject_id) {
    const { data: relatedRows, error: relatedError } = await dataClient
      .from("reports")
      .select(MODERATION_REPORT_SELECT)
      .eq("subject_type", REPORT_SUBJECT_TYPES.profile)
      .eq("subject_id", reportRow.subject_id)
      .order("created_at", { ascending: false });

    if (relatedError) {
      console.error("Failed to load related profile reports:", relatedError.message);
    } else if (relatedRows?.length) {
      relatedReportRows = relatedRows;
    }
  }

  let notesAvailable = true;
  let reportNotesRows = [];
  let moderatorNoteHistoryRows = [];
  let moderatorNoteHistoryHasMore = false;

  const [reportNotesResult, moderatorNoteHistoryResult] = await Promise.all([
    supabase.rpc(
      "get_report_moderator_notes",
      { p_report_ids: relatedReportRows.map((relatedReport) => relatedReport.id) },
    ),
    supabase.rpc("get_report_moderator_note_history", {
      p_report_id: reportRow.id,
      p_limit: requestedNoteHistoryCount + 1,
    }),
  ]);

  if (reportNotesResult.error || moderatorNoteHistoryResult.error) {
    notesAvailable = false;
    console.error(
      "Failed to load moderation report notes:",
      reportNotesResult.error?.message ?? moderatorNoteHistoryResult.error?.message,
    );
  } else {
    reportNotesRows = reportNotesResult.data ?? [];
    moderatorNoteHistoryHasMore =
      (moderatorNoteHistoryResult.data?.length ?? 0) > requestedNoteHistoryCount;
    moderatorNoteHistoryRows = (moderatorNoteHistoryResult.data ?? []).slice(
      0,
      requestedNoteHistoryCount,
    );
  }

  const reportNotesById = new Map(
    (reportNotesRows ?? []).map((notesRow) => [notesRow.report_id, notesRow]),
  );

  const profileIds = [
    ...relatedReportRows.map((report) => report.reporter_user_id),
    ...relatedReportRows.map((report) => report.reported_user_id),
    ...relatedReportRows.map((report) => report.reviewed_by),
    ...reportNotesRows.map((report) => report.moderator_notes_updated_by),
    ...moderatorNoteHistoryRows.map((note) => note.created_by_user_id),
    reportRow.subject_type === REPORT_SUBJECT_TYPES.profile ? reportRow.subject_id : null,
  ].filter(Boolean);
  const { data: reportProfiles, error: reportProfilesError } = profileIds.length
      ? await dataClient
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
  let profileReview = null;
  let reportMessage = null;

  if (reportRow.subject_type === REPORT_SUBJECT_TYPES.message) {
    reviewIcon = MessageSquareWarning;

    const context = await loadReportConversationContext(supabase, reportRow.id);
    if (!context) notFound();
    const conversationRow = context.conversation;

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
      contextLimited: true,
      canReadFullConversation: context.can_read_full_conversation === true,
      listing: {
        id: listing?.id,
        slug: listing?.slug,
        title: listing?.title ?? t.listing,
        location: listing?.location ?? t.torontoMeetup,
        imageUrl: getPrimaryListingImageUrl(listing?.listing_images),
        status: listing?.status ?? "active",
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

    messages = context.messages;
    reportMessage = messages.find((message) => message.id === reportRow.message_id) ?? null;
  } else if (reportRow.subject_type === REPORT_SUBJECT_TYPES.listing) {
    const { data: listingRow, error: listingError } = await dataClient
      .from("listings")
      .select(
        "id, seller_id, slug, title, description, price, location, status, listing_images ( image_url, position )"
      )
      .order("position", { referencedTable: "listing_images", ascending: true })
      .limit(MESSAGE_LISTING_IMAGE_LIMIT, { referencedTable: "listing_images" })
      .eq("id", reportRow.listing_id)
      .maybeSingle();

    if (listingError) {
      console.error("Failed to load moderation listing review:", listingError.message);
    }

    if (!listingRow) {
      notFound();
    }

    const { data: sellerProfile, error: sellerError } = listingRow.seller_id
      ? await dataClient
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
        images: (listingRow.listing_images ?? []).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((image) => image.image_url).filter(Boolean),
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
  } else if (reportRow.subject_type === REPORT_SUBJECT_TYPES.profile) {
    const { data: profileRow, error: profileError } = await dataClient
      .from("profiles")
      .select("id, first_name, last_name, school, avatar_preset_id, avatar_url, bio, created_at")
      .eq("id", reportRow.subject_id)
      .maybeSingle();

    if (profileError) {
      console.error("Failed to load moderation profile review:", profileError.message);
    }

    if (!profileRow) {
      notFound();
    }

    profileReview = {
      profile: {
        id: profileRow.id,
        name: getConversationDisplayName(profileRow, t),
        school: profileRow.school ?? t.torontoStudent,
        avatarPresetId: profileRow.avatar_preset_id ?? null,
        avatarUrl: profileRow.avatar_url ?? null,
        bio: profileRow.bio ?? "",
        createdAt: profileRow.created_at ?? null,
      },
    };
  }

  const report = {
    id: reportRow.id,
    subjectType: reportRow.subject_type,
    reason: reportRow.reason,
    details: reportRow.details,
    status: reportRow.status,
    createdAt: reportRow.created_at,
    reviewedAt: reportRow.reviewed_at,
    reporter: {
      id: reportRow.reporter_user_id,
      name: getModerationDisplayName(reportProfilesById.get(reportRow.reporter_user_id), t),
    },
    reportedUser: {
      id: reportRow.reported_user_id,
      name: getModerationDisplayName(reportProfilesById.get(reportRow.reported_user_id), t),
    },
    reviewedBy: reportRow.reviewed_by
      ? {
          id: reportRow.reviewed_by,
          name: getModerationDisplayName(reportProfilesById.get(reportRow.reviewed_by), t),
        }
      : null,
    moderatorNotes: reportNotesById.get(reportRow.id)?.moderator_notes ?? null,
    moderatorNotesUpdatedAt: reportNotesById.get(reportRow.id)?.moderator_notes_updated_at ?? null,
    moderatorNotesUpdatedBy: reportNotesById.get(reportRow.id)?.moderator_notes_updated_by
      ? {
          id: reportNotesById.get(reportRow.id).moderator_notes_updated_by,
          name: getModerationDisplayName(
            reportProfilesById.get(reportNotesById.get(reportRow.id).moderator_notes_updated_by),
            t,
          ),
        }
      : null,
    message: reportMessage,
  };

  const relatedReports = relatedReportRows.map((relatedReport) => ({
    id: relatedReport.id,
    subjectType: relatedReport.subject_type,
    reason: relatedReport.reason,
    details: relatedReport.details,
    status: relatedReport.status,
    createdAt: relatedReport.created_at,
    reviewedAt: relatedReport.reviewed_at,
    reporter: {
      id: relatedReport.reporter_user_id,
      name: getModerationDisplayName(reportProfilesById.get(relatedReport.reporter_user_id), t),
    },
    reviewedBy: relatedReport.reviewed_by
      ? {
          id: relatedReport.reviewed_by,
          name: getModerationDisplayName(reportProfilesById.get(relatedReport.reviewed_by), t),
        }
      : null,
    moderatorNotes: reportNotesById.get(relatedReport.id)?.moderator_notes ?? null,
    moderatorNotesUpdatedAt: reportNotesById.get(relatedReport.id)?.moderator_notes_updated_at ?? null,
    moderatorNotesUpdatedBy: reportNotesById.get(relatedReport.id)?.moderator_notes_updated_by
      ? {
          id: reportNotesById.get(relatedReport.id).moderator_notes_updated_by,
          name: getModerationDisplayName(
            reportProfilesById.get(reportNotesById.get(relatedReport.id).moderator_notes_updated_by),
            t,
          ),
        }
      : null,
  }));

  const moderatorNoteHistory = moderatorNoteHistoryRows.map((note) => ({
    id: note.note_id,
    body: note.moderator_note,
    createdAt: note.created_at,
    createdBy: {
      id: note.created_by_user_id,
      name: getModerationDisplayName(reportProfilesById.get(note.created_by_user_id), t),
    },
  }));
  const moderatorNoteHistoryNextHref = moderatorNoteHistoryHasMore
    && requestedNoteHistoryCount < MODERATOR_NOTE_HISTORY_MAX_VISIBLE
    ? `/admin/reports/${reportRow.id}?notes=${Math.min(
        MODERATOR_NOTE_HISTORY_MAX_VISIBLE,
        requestedNoteHistoryCount + MODERATOR_NOTE_HISTORY_PAGE_SIZE,
      )}&returnTo=${encodeURIComponent(returnHref)}#moderator-notes`
    : null;

  const ReviewIcon = reviewIcon;

  return (
    <main className="bg-zinc-100 px-4 pt-3 pb-5 dark:bg-background md:px-6 md:pt-3 md:pb-6 lg:px-7 lg:pt-4 lg:pb-7">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button asChild variant="ghost" className="min-h-11 rounded-full px-3">
            <Link href={returnHref}>
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
        relatedReports={relatedReports}
        conversation={conversation}
        messages={messages}
        listingReview={listingReview}
        profileReview={profileReview}
        notesAvailable={notesAvailable}
        moderatorNoteHistory={moderatorNoteHistory}
        moderatorNoteHistoryNextHref={moderatorNoteHistoryNextHref}
        currentUserId={user.id}
        returnHref={returnHref}
        canDecide={canPerformModerationAction(getUserModerationRole(accessUser), MODERATION_ACTIONS.decideReports)}
        canForceProfileNameChange={getUserModerationRole(accessUser) === "admin"}
      />
      </div>
    </main>
  );
}
