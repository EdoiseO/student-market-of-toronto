"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ClientFormattedDateTime } from "@/components/client-formatted-date-time";
import { ListingDescriptionContent } from "@/components/listing-description-content";
import { ProfileAvatar } from "@/components/profile-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/context/LanguageContext";
import {
  LISTING_APPROVAL_STATUS_VALUES,
  getTranslatedListingApprovalStatus,
  isPendingListingApproval,
  isListingResubmittedAfterEdit,
} from "@/lib/listing-approval";
import {
  LISTING_APPROVED_NOTIFICATION_TYPE,
  LISTING_REJECTED_NOTIFICATION_TYPE,
} from "@/lib/notifications";
import { createClient } from "@/utils/supabase/client";

function ReviewMetadata({ label, children }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

export function AdminListingApprovalReviewContent({ listing, currentUserId }) {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const { t, language } = useLanguage();
  const [feedback, setFeedback] = React.useState(listing.moderationFeedback ?? "");
  const [isProcessing, setIsProcessing] = React.useState(false);

  const isPendingReview = isPendingListingApproval(listing);

  React.useEffect(() => {
    setFeedback(listing.moderationFeedback ?? "");
  }, [listing.id, listing.moderationFeedback]);

  async function notifySellerOfDecision(type, nextFeedback = null) {
    const sellerId = listing?.seller?.id;

    if (!sellerId || !listing?.id) {
      return;
    }

    const metadata = {
      listing_title: listing.title,
      listing_slug: listing.slug,
      href:
        type === LISTING_REJECTED_NOTIFICATION_TYPE && listing.slug
          ? `/listings/${listing.slug}/edit`
          : listing.slug
            ? `/listings/${listing.slug}`
            : "/dashboard?tab=inactive",
    };

    if (type === LISTING_REJECTED_NOTIFICATION_TYPE && nextFeedback?.trim()) {
      metadata.feedback = nextFeedback.trim();
    }

    const { error } = await supabase.from("notifications").insert({
      user_id: sellerId,
      type,
      listing_id: listing.id,
      metadata,
    });

    if (error) {
      console.error("Failed to create seller listing decision notification:", error.message);
    }
  }

  async function handleApprove() {
    if (!currentUserId || !listing?.id || isProcessing || !isPendingReview) {
      return;
    }

    setIsProcessing(true);

    const { error } = await supabase
      .from("listings")
      .update({
        status: "active",
        moderation_feedback: null,
        moderation_reviewed_at: new Date().toISOString(),
        moderation_reviewed_by: currentUserId,
      })
      .eq("id", listing.id);

    setIsProcessing(false);

    if (error) {
      console.error("Failed to approve listing:", error.message);
      toast.error(t.adminListingApprovalActionError);
      return;
    }

    await notifySellerOfDecision(LISTING_APPROVED_NOTIFICATION_TYPE);

    toast.success(t.adminListingApproved);
    router.push("/admin");
    router.refresh();
  }

  async function handleReject() {
    if (!currentUserId || !listing?.id || isProcessing || !isPendingReview) {
      return;
    }

    if (!feedback.trim()) {
      toast.error(t.adminListingRejectionFeedbackRequired);
      return;
    }

    const trimmedFeedback = feedback.trim();

    setIsProcessing(true);

    const { error } = await supabase
      .from("listings")
      .update({
        status: LISTING_APPROVAL_STATUS_VALUES.rejected,
        moderation_feedback: trimmedFeedback,
        moderation_reviewed_at: new Date().toISOString(),
        moderation_reviewed_by: currentUserId,
      })
      .eq("id", listing.id);

    setIsProcessing(false);

    if (error) {
      console.error("Failed to reject listing:", error.message);
      toast.error(t.adminListingApprovalActionError);
      return;
    }

    await notifySellerOfDecision(LISTING_REJECTED_NOTIFICATION_TYPE, trimmedFeedback);

    toast.success(t.adminListingRejected);
    router.push("/admin");
    router.refresh();
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <Card className="rounded-[2rem] border-zinc-200 bg-white py-0 shadow-sm dark:bg-card dark:ring-border">
        <CardHeader className="border-b border-zinc-200 px-6 py-5 dark:border-border">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="rounded-full border-border bg-background px-2.5 py-0.5 text-foreground">
                  {getTranslatedListingApprovalStatus(listing.status, t, listing)}
                </Badge>
                {isListingResubmittedAfterEdit(listing) ? (
                  <Badge variant="outline" className="rounded-full border-border bg-background px-2.5 py-0.5 text-foreground">
                    {t.adminListingResubmittedBadge}
                  </Badge>
                ) : null}
              </div>
              <CardTitle className="text-2xl text-zinc-950 dark:text-foreground">
                {listing.title}
              </CardTitle>
              <CardDescription>{t.adminListingApprovalReviewDescription}</CardDescription>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <p>{t.adminSubmittedForReviewAt}</p>
              <ClientFormattedDateTime value={listing.submittedForReviewAt ?? listing.createdAt} language={language} />
            </div>
          </div>
        </CardHeader>

        <CardContent className="grid gap-4 px-6 py-5 md:grid-cols-2 xl:grid-cols-4">
          <ReviewMetadata label={t.seller}>{listing.seller.name}</ReviewMetadata>
            <ReviewMetadata label={t.status}>
            {getTranslatedListingApprovalStatus(listing.status, t, listing)}
          </ReviewMetadata>
          {listing.reviewedBy ? (
            <ReviewMetadata label={t.adminReviewedBy}>{listing.reviewedBy.name}</ReviewMetadata>
          ) : null}
          {listing.moderationReviewedAt ? (
            <ReviewMetadata label={t.reviewedAt}>
              <ClientFormattedDateTime value={listing.moderationReviewedAt} language={language} />
            </ReviewMetadata>
          ) : null}
          {listing.moderationFeedback ? (
            <div className="md:col-span-2 xl:col-span-4">
              <ReviewMetadata label={t.adminFeedback}>{listing.moderationFeedback}</ReviewMetadata>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.8fr)]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-[2rem] border border-zinc-200 bg-white shadow-sm dark:border-border dark:bg-card">
          <div className="border-b border-zinc-200 px-6 py-5 dark:border-border">
            <p className="text-lg font-semibold text-zinc-950 dark:text-foreground">
              {t.adminListingApprovalContentTitle}
            </p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-muted-foreground">
              {t.adminListingApprovalContentDescription}
            </p>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-zinc-50/70 px-6 py-5 dark:bg-muted/20">
            <div className="rounded-[1.75rem] border border-zinc-200 bg-white p-5 shadow-none dark:border-border dark:bg-card">
              <div className="flex items-center gap-4">
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-zinc-100 dark:bg-muted">
                  {listing.imageUrl ? (
                    <img src={listing.imageUrl} alt={listing.title} className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full bg-zinc-100 dark:bg-muted" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-xl font-semibold text-zinc-950 dark:text-foreground">
                    {listing.title}
                  </p>
                  <p className="mt-1 text-sm text-zinc-500 dark:text-muted-foreground">
                    {listing.location || t.torontoMeetup}
                  </p>
                  <p className="mt-2 text-base font-medium text-zinc-900 dark:text-foreground">
                    {listing.price}
                  </p>
                </div>
              </div>
            </div>

            {listing.description ? (
              <Card className="rounded-[1.75rem] border-zinc-200 bg-white py-0 shadow-none dark:bg-card dark:ring-border">
                <CardHeader className="border-b border-zinc-200 px-6 py-5 dark:border-border">
                  <CardTitle className="text-2xl text-zinc-950 dark:text-foreground">
                    {t.description}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-6 py-6">
                  <ListingDescriptionContent description={listing.description} className="whitespace-normal leading-6 text-sm" />
                </CardContent>
              </Card>
            ) : null}

            <Card className="rounded-[1.75rem] border-zinc-200 bg-white py-0 shadow-none dark:bg-card dark:ring-border">
              <CardHeader className="border-b border-zinc-200 px-6 py-5 dark:border-border">
                <CardTitle className="text-2xl text-zinc-950 dark:text-foreground">
                  {t.adminListingFeedbackTitle}
                </CardTitle>
                <CardDescription>{t.adminListingFeedbackDescription}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 px-6 py-6">
                <div className="rounded-xl border border-zinc-200 bg-background p-3 shadow-sm dark:border-border dark:bg-background">
                  <Textarea
                    value={feedback}
                    onChange={(event) => setFeedback(event.target.value)}
                    placeholder={t.adminListingFeedbackPlaceholder}
                    rows={6}
                    className="min-h-28 resize-y border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0"
                    maxLength={3000}
                    disabled={!isPendingReview || isProcessing}
                  />
                </div>
                {!isPendingReview ? (
                  <p className="text-sm text-zinc-500 dark:text-muted-foreground">
                    {t.adminListingDecisionLockedDescription}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <div className="border-t border-zinc-200 bg-background px-6 py-5 dark:border-border">
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={handleReject}
                disabled={isProcessing || !isPendingReview}
              >
                {t.adminRejectListing}
              </Button>
              <Button
                type="button"
                className="rounded-xl"
                onClick={handleApprove}
                disabled={isProcessing || !isPendingReview}
              >
                {t.adminApproveListing}
              </Button>
            </div>
          </div>
        </section>

        <div className="space-y-4">
          <Card className="rounded-[2rem] border-zinc-200 bg-white py-0 shadow-sm dark:bg-card dark:ring-border">
            <CardHeader className="border-b border-zinc-200 px-6 py-5 dark:border-border">
              <CardTitle className="text-xl text-zinc-950 dark:text-foreground">
                {t.seller}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 px-6 py-5">
              <Link href={`/profile/${listing.seller.id}`} className="flex items-center gap-3 rounded-xl transition hover:bg-zinc-50/80 dark:hover:bg-muted/40">
                <ProfileAvatar
                  name={listing.seller.name}
                  avatarPresetId={listing.seller.avatarPresetId}
                  avatarUrl={listing.seller.avatarUrl}
                  className="size-10 border border-zinc-200 dark:border-border"
                />
                <div>
                  <p className="font-medium text-zinc-950 dark:text-foreground">{listing.seller.name}</p>
                  <p className="text-sm text-zinc-500 dark:text-muted-foreground">{listing.seller.school}</p>
                </div>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
