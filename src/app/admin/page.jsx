import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AdminAnnouncementSheet } from "@/components/admin-announcement-sheet";
import { AdminModerationDashboard } from "@/components/admin-moderation-dashboard";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  MODERATION_REPORT_SELECT,
  REPORT_SUBJECT_TYPES,
  getModerationDisplayName,
  getUserModerationRole,
  isModerationRole,
  isReportsTableMissing,
} from "@/lib/moderation";
import {
  LISTING_APPROVAL_STATUS_VALUES,
  isPendingListingApproval,
  isListingApprovalSetupMissing,
} from "@/lib/listing-approval";
import { createAdminClient } from "@/lib/supabase-admin";
import { translations } from "@/lib/translations";
import { createClient } from "@/utils/supabase/server";

function buildIdList(values) {
  return [...new Set(values.filter(Boolean))];
}

function buildProfileMap(rows) {
  return new Map((rows ?? []).map((row) => [row.id, row]));
}

function buildListingMap(rows) {
  return new Map((rows ?? []).map((row) => [row.id, row]));
}

function buildMessageMap(rows) {
  return new Map((rows ?? []).map((row) => [row.id, row]));
}

export default async function AdminPage() {
  const cookieStore = await cookies();
  const language = cookieStore.get("language")?.value === "fr" ? "fr" : "en";
  const t = translations[language] || translations.en;
  const supabase = createClient(cookieStore);
  const admin = createAdminClient();
  const dataClient = admin ?? supabase;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const userRole = getUserModerationRole(user);

  if (!isModerationRole(userRole)) {
    redirect("/");
  }

  const { data: reportRows, error: reportsError } = await dataClient
    .from("reports")
    .select(MODERATION_REPORT_SELECT)
    .order("created_at", { ascending: false })
    .limit(80);

  if (reportsError && !isReportsTableMissing(reportsError)) {
    console.error("Failed to load moderation reports:", reportsError.message);
  }

  const reportsAvailable = !isReportsTableMissing(reportsError);

  const profileIds = buildIdList([
    ...(reportRows ?? []).map((report) => report.reporter_user_id),
    ...(reportRows ?? []).map((report) => report.reported_user_id),
    ...(reportRows ?? []).map((report) => report.reviewed_by),
    ...(reportRows ?? [])
      .filter((report) => report.subject_type === REPORT_SUBJECT_TYPES.profile)
      .map((report) => report.subject_id),
  ]);
  const listingIds = buildIdList((reportRows ?? []).map((report) => report.listing_id));
  const messageIds = buildIdList((reportRows ?? []).map((report) => report.message_id));

  const [profilesResult, listingsResult, messagesResult] = reportsAvailable
    ? await Promise.all([
        profileIds.length > 0
          ? dataClient
              .from("profiles")
              .select("id, first_name, last_name")
              .in("id", profileIds)
          : Promise.resolve({ data: [], error: null }),
        listingIds.length > 0
          ? dataClient
              .from("listings")
              .select("id, title, slug, status")
              .in("id", listingIds)
          : Promise.resolve({ data: [], error: null }),
        messageIds.length > 0
          ? dataClient
              .from("messages")
              .select("id, body, sender_id, created_at")
              .in("id", messageIds)
          : Promise.resolve({ data: [], error: null }),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ];

  if (profilesResult.error) {
    console.error("Failed to load moderation profiles:", profilesResult.error.message);
  }

  if (listingsResult.error) {
    console.error("Failed to load moderation listings:", listingsResult.error.message);
  }

  if (messagesResult.error) {
    console.error("Failed to load moderation messages:", messagesResult.error.message);
  }

  const profilesById = buildProfileMap(profilesResult.data ?? []);
  const listingsById = buildListingMap(listingsResult.data ?? []);
  const messagesById = buildMessageMap(messagesResult.data ?? []);

  const reports = (reportRows ?? []).map((report) => ({
    id: report.id,
    subjectType: report.subject_type,
    conversationId: report.conversation_id,
    reason: report.reason,
    details: report.details,
    status: report.status,
    createdAt: report.created_at,
    reviewedAt: report.reviewed_at,
    reporter: {
      id: report.reporter_user_id,
      name: getModerationDisplayName(profilesById.get(report.reporter_user_id), t),
    },
    reportedUser: {
      id: report.reported_user_id,
      name: getModerationDisplayName(profilesById.get(report.reported_user_id), t),
    },
    reviewedBy: report.reviewed_by
      ? {
          id: report.reviewed_by,
          name: getModerationDisplayName(profilesById.get(report.reviewed_by), t),
        }
      : null,
    profile:
      report.subject_type === REPORT_SUBJECT_TYPES.profile
        ? {
            id: report.subject_id,
            name: getModerationDisplayName(profilesById.get(report.subject_id), t),
          }
        : null,
    listing: report.listing_id
      ? listingsById.get(report.listing_id)
        ? {
            id: report.listing_id,
            title: listingsById.get(report.listing_id).title,
            slug: listingsById.get(report.listing_id).slug,
            status: listingsById.get(report.listing_id).status,
          }
        : null
      : null,
    message: report.message_id
      ? messagesById.get(report.message_id)
        ? {
            id: report.message_id,
            body: messagesById.get(report.message_id).body,
            createdAt: messagesById.get(report.message_id).created_at,
          }
        : null
      : null,
  }));

  let listingApprovalAvailable = true;
  let pendingListingRows = [];
  let recentListingDecisionRows = [];

  const [pendingListingResult, recentListingDecisionResult] = await Promise.all([
    dataClient
      .from("listings")
      .select(
        `
          id,
          seller_id,
          slug,
          title,
          status,
          location,
          submitted_for_review_at,
          moderation_feedback,
          moderation_reviewed_at,
          moderation_reviewed_by
        `,
      )
      .eq("status", LISTING_APPROVAL_STATUS_VALUES.pendingReview)
      .not("submitted_for_review_at", "is", null)
      .order("submitted_for_review_at", { ascending: false })
      .limit(40),
    dataClient
      .from("listings")
      .select(
        `
          id,
          seller_id,
          slug,
          title,
          status,
          location,
          submitted_for_review_at,
          moderation_feedback,
          moderation_reviewed_at,
          moderation_reviewed_by
        `,
      )
      .in("status", ["active", LISTING_APPROVAL_STATUS_VALUES.rejected])
      .not("moderation_reviewed_at", "is", null)
      .order("moderation_reviewed_at", { ascending: false })
      .limit(20),
  ]);

  if (pendingListingResult.error || recentListingDecisionResult.error) {
    const listingApprovalError = pendingListingResult.error ?? recentListingDecisionResult.error;

    if (isListingApprovalSetupMissing(listingApprovalError)) {
      listingApprovalAvailable = false;
    } else if (listingApprovalError) {
      console.error("Failed to load listing approval queue:", listingApprovalError.message);
    }
  } else {
    pendingListingRows = pendingListingResult.data ?? [];
    recentListingDecisionRows = recentListingDecisionResult.data ?? [];
  }

  const listingApprovalProfileIds = buildIdList([
    ...pendingListingRows.map((listing) => listing.seller_id),
    ...pendingListingRows.map((listing) => listing.moderation_reviewed_by),
    ...recentListingDecisionRows.map((listing) => listing.seller_id),
    ...recentListingDecisionRows.map((listing) => listing.moderation_reviewed_by),
  ]);

  const { data: listingApprovalProfiles, error: listingApprovalProfilesError } =
    listingApprovalAvailable && listingApprovalProfileIds.length > 0
      ? await dataClient
          .from("profiles")
          .select("id, first_name, last_name")
          .in("id", listingApprovalProfileIds)
      : { data: [], error: null };

  if (listingApprovalProfilesError) {
    console.error(
      "Failed to load listing approval profiles:",
      listingApprovalProfilesError.message,
    );
  }

  const listingApprovalProfilesById = buildProfileMap(listingApprovalProfiles ?? []);

  function normalizeApprovalListing(listing) {
    const isPendingReview = isPendingListingApproval({
      status: listing.status,
      submitted_for_review_at: listing.submitted_for_review_at,
      moderation_reviewed_at: listing.moderation_reviewed_at,
    });

    return {
      id: listing.id,
      slug: listing.slug,
      title: listing.title ?? t.listing,
      status: listing.status,
      queueAt:
        isPendingReview
          ? listing.submitted_for_review_at ?? listing.moderation_reviewed_at
          : listing.moderation_reviewed_at ?? listing.submitted_for_review_at,
      moderationFeedback: listing.moderation_feedback ?? null,
      submittedForReviewAt: listing.submitted_for_review_at ?? null,
      moderationReviewedAt: listing.moderation_reviewed_at ?? null,
      isPendingReview,
      seller: {
        id: listing.seller_id,
        name: getModerationDisplayName(listingApprovalProfilesById.get(listing.seller_id), t),
      },
      reviewedBy: listing.moderation_reviewed_by
        ? {
            id: listing.moderation_reviewed_by,
            name: getModerationDisplayName(
              listingApprovalProfilesById.get(listing.moderation_reviewed_by),
              t,
            ),
          }
        : null,
    };
  }

  const pendingListingApprovals = pendingListingRows.map(normalizeApprovalListing);
  const recentListingDecisions = recentListingDecisionRows.map(normalizeApprovalListing);

  return (
    <main className="min-h-screen bg-zinc-100 p-5 dark:bg-background md:p-6 lg:p-7">
      <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-6 @container/main">
        <Card className="rounded-[2rem] border-zinc-200 bg-white py-0 shadow-sm dark:bg-card dark:ring-border">
          <CardHeader className="border-b border-zinc-200 px-6 py-5 dark:border-border lg:px-7">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-3xl font-bold tracking-tight text-zinc-950 dark:text-foreground lg:text-4xl">
                  {t.adminDashboard}
                </CardTitle>
                <CardDescription className="mt-2 max-w-3xl text-base text-zinc-600 dark:text-muted-foreground">
                  {t.adminReportsDescription}
                </CardDescription>
              </div>

              <div className="flex flex-wrap gap-2">
                {userRole === "admin" && <AdminAnnouncementSheet />}
                <Button asChild variant="outline" className="rounded-xl">
                  <Link href="/admin/users">{t.adminUsers}</Link>
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-6 p-8 pt-6">
            <AdminModerationDashboard
              initialReports={reports}
              reportsAvailable={reportsAvailable}
              pendingListingApprovals={pendingListingApprovals}
              recentListingDecisions={recentListingDecisions}
              listingApprovalAvailable={listingApprovalAvailable}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
