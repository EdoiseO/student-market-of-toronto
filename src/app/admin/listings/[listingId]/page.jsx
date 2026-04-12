import { ArrowLeft, ClipboardCheck } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AdminListingApprovalReviewContent } from "@/components/admin-listing-approval-review-content";
import { Button } from "@/components/ui/button";
import { getModerationDisplayName, getUserModerationRole, isModerationRole } from "@/lib/moderation";
import { createAdminClient } from "@/lib/supabase-admin";
import { translations } from "@/lib/translations";
import { createClient } from "@/utils/supabase/server";

function getPrimaryListingImageUrl(listingImages) {
  return (listingImages ?? [])
    .slice()
    .sort((firstImage, secondImage) => (firstImage.position ?? 0) - (secondImage.position ?? 0))[0]?.image_url;
}

export default async function AdminListingApprovalReviewPage({ params }) {
  const resolvedParams = await params;
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

  if (!isModerationRole(getUserModerationRole(user))) {
    redirect("/");
  }

  const { data: listingRow, error: listingError } = await dataClient
    .from("listings")
    .select(
      "id, seller_id, slug, title, description, price, location, status, created_at, submitted_for_review_at, moderation_feedback, moderation_reviewed_at, moderation_reviewed_by, listing_images ( image_url, position )"
    )
    .eq("id", resolvedParams.listingId)
    .maybeSingle();

  if (listingError) {
    console.error("Failed to load listing approval review:", listingError.message);
  }

  if (!listingRow) {
    notFound();
  }

  const { data: historyRows, error: historyError } = await dataClient
    .from("listing_moderation_history")
    .select("id, action, feedback, decided_by, decided_at")
    .eq("listing_id", listingRow.id)
    .order("decided_at", { ascending: false })
    .limit(12);

  if (historyError) {
    console.error("Failed to load listing moderation history:", historyError.message);
  }

  const profileIds = [
    listingRow.seller_id,
    listingRow.moderation_reviewed_by,
    ...((historyRows ?? []).map((entry) => entry.decided_by)),
  ].filter(Boolean);
  const { data: profiles, error: profilesError } = profileIds.length
    ? await dataClient
        .from("profiles")
        .select("id, first_name, last_name, school, avatar_preset_id, avatar_url")
        .in("id", profileIds)
    : { data: [], error: null };

  if (profilesError) {
    console.error("Failed to load listing approval profiles:", profilesError.message);
  }

  const profilesById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const sellerProfile = profilesById.get(listingRow.seller_id);
  const reviewerProfile = profilesById.get(listingRow.moderation_reviewed_by);

  const listing = {
    id: listingRow.id,
    slug: listingRow.slug,
    title: listingRow.title ?? t.listing,
    description: listingRow.description ?? "",
    price: new Intl.NumberFormat(language === "fr" ? "fr-CA" : "en-CA", {
      style: "currency",
      currency: "CAD",
      maximumFractionDigits: 0,
    }).format(Number(listingRow.price ?? 0)),
    location: listingRow.location ?? t.torontoMeetup,
    imageUrl: getPrimaryListingImageUrl(listingRow.listing_images),
    status: listingRow.status,
    createdAt: listingRow.created_at,
    submittedForReviewAt: listingRow.submitted_for_review_at,
    moderationFeedback: listingRow.moderation_feedback ?? null,
    moderationReviewedAt: listingRow.moderation_reviewed_at ?? null,
    history: (historyRows ?? []).map((entry) => ({
      id: entry.id,
      action: entry.action,
      feedback: entry.feedback ?? null,
      decidedAt: entry.decided_at,
      decidedByName: getModerationDisplayName(profilesById.get(entry.decided_by), t),
    })),
    reviewedBy: reviewerProfile
      ? {
          id: reviewerProfile.id,
          name: getModerationDisplayName(reviewerProfile, t),
        }
      : null,
    seller: sellerProfile
      ? {
          id: sellerProfile.id,
          name: getModerationDisplayName(sellerProfile, t),
          school: sellerProfile.school ?? t.torontoStudent,
          avatarPresetId: sellerProfile.avatar_preset_id ?? null,
          avatarUrl: sellerProfile.avatar_url ?? null,
        }
      : {
          id: listingRow.seller_id,
          name: t.student,
          school: t.torontoStudent,
          avatarPresetId: null,
          avatarUrl: null,
        },
  };

  return (
    <main className="h-[calc(100svh-var(--header-height))] min-h-0 overflow-hidden bg-zinc-100 px-5 pt-3 pb-5 dark:bg-background md:px-6 md:pt-3 md:pb-6 lg:px-7 lg:pt-4 lg:pb-7">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1280px] flex-col gap-3 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button asChild variant="ghost" className="h-9 rounded-full px-3">
            <Link href="/admin">
              <ArrowLeft className="size-4" />
              <span>{t.backToAdminReports}</span>
            </Link>
          </Button>
          <div className="flex items-center gap-2 rounded-full bg-background px-3 py-1.5 text-sm text-muted-foreground shadow-sm">
            <ClipboardCheck className="size-4" />
            <span>{t.adminListingApprovalReviewTitle}</span>
          </div>
        </div>

        <AdminListingApprovalReviewContent listing={listing} currentUserId={user.id} />
      </div>
    </main>
  );
}
