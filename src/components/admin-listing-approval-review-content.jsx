"use client";

import * as React from "react";
import { ListingReviewImages } from "@/components/listing-review-images";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ClientFormattedDateTime } from "@/components/client-formatted-date-time";
import { ListingDescriptionContent } from "@/components/listing-description-content";
import { ProfileAvatar } from "@/components/profile-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/context/LanguageContext";
import {
  getTranslatedListingApprovalStatus,
  isPendingListingApproval,
  isListingResubmittedAfterEdit,
} from "@/lib/listing-approval";
import {
  REPORTED_LISTING_FEEDBACK_MAX_LENGTH,
  countUnicodeCodePoints,
  normalizeWriteText,
} from "@/lib/write-field-contracts.mjs";
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

function getHistoryActionLabel(action, t) {
  return action === "approved"
    ? t.adminListingDecisionApprovedLabel
    : t.adminListingDecisionRejectedLabel;
}

function getInitialSellerFeedbackValue(listing) {
  return isPendingListingApproval(listing) ? "" : (listing?.moderationFeedback ?? "");
}

function getListingFeedbackResetValue(listing) {
  return getInitialSellerFeedbackValue({
    status: listing.status,
    moderationFeedback: listing.moderationFeedback,
    submittedForReviewAt: listing.submittedForReviewAt,
    moderationReviewedAt: listing.moderationReviewedAt,
  });
}

export function AdminListingApprovalReviewContent({ listing, currentUserId, canDecide = true, returnHref = "/admin/listings" }) {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const { t, language } = useLanguage();
  const listingId = listing.id;
  const listingStatus = listing.status;
  const listingModerationFeedback = listing.moderationFeedback;
  const listingSubmittedForReviewAt = listing.submittedForReviewAt;
  const listingModerationReviewedAt = listing.moderationReviewedAt;
  const [feedback, setFeedback] = React.useState(() => getListingFeedbackResetValue(listing));
  const [feedbackError, setFeedbackError] = React.useState("");
  const [isProcessing, setIsProcessing] = React.useState(false);
  const decisionOperationRef = React.useRef(null);
  const decisionPendingRef = React.useRef(false);
  const feedbackRef = React.useRef(null);

  const isPendingReview = isPendingListingApproval(listing);

  React.useEffect(() => {
    setFeedback(
      getInitialSellerFeedbackValue({
        status: listingStatus,
        moderationFeedback: listingModerationFeedback,
        submittedForReviewAt: listingSubmittedForReviewAt,
        moderationReviewedAt: listingModerationReviewedAt,
      }),
    );
    setFeedbackError("");
  }, [
    listingId,
    listingStatus,
    listingModerationFeedback,
    listingSubmittedForReviewAt,
    listingModerationReviewedAt,
  ]);

  async function handleModerationDecision(action, nextFeedback = null) {
    if (decisionPendingRef.current) return false;
    decisionPendingRef.current = true;
    setIsProcessing(true);
    try {
      const operationPayloadKey = JSON.stringify({
        action,
        feedback: nextFeedback,
        expectedContentRevision: listing.contentRevision,
        expectedSubmittedForReviewAt: listing.submittedForReviewAt,
      });
      if (decisionOperationRef.current?.payloadKey !== operationPayloadKey) {
        decisionOperationRef.current = {
          payloadKey: operationPayloadKey,
          operationId: crypto.randomUUID(),
        };
      }

      const { error: refreshSessionError } = await supabase.auth.refreshSession();

      if (refreshSessionError) {
        console.error("Failed to refresh moderation session before listing decision:", refreshSessionError.message);
      }

      const response = await fetch(`/api/admin/listings/${listing.id}/decision`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          operationId: decisionOperationRef.current.operationId,
          action,
          feedback: nextFeedback,
          expectedContentRevision: listing.contentRevision,
          expectedSubmittedForReviewAt: listing.submittedForReviewAt,
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        console.error("Failed to moderate listing decision:", payload?.error);
        toast.error(payload?.error || t.adminListingApprovalActionError);
        return false;
      }

      decisionOperationRef.current = null;
      return true;
    } catch {
      toast.error(t.adminListingApprovalActionError);
      return false;
    } finally {
      decisionPendingRef.current = false;
      setIsProcessing(false);
    }
  }

  async function handleApprove() {
    if (!currentUserId || !listing?.id || isProcessing || !isPendingReview || !canDecide) {
      return;
    }

    const normalizedFeedback = normalizeWriteText(feedback);

    if (countUnicodeCodePoints(normalizedFeedback) > REPORTED_LISTING_FEEDBACK_MAX_LENGTH) {
      setFeedbackError(t.adminListingFeedbackTooLong);
      feedbackRef.current?.focus();
      return;
    }

    setFeedbackError("");
    const wasSuccessful = await handleModerationDecision("approved", normalizedFeedback || null);

    if (!wasSuccessful) {
      return;
    }

    toast.success(t.adminListingApproved);
    router.push(returnHref);
    router.refresh();
  }

  async function handleReject() {
    if (!currentUserId || !listing?.id || isProcessing || !isPendingReview || !canDecide) {
      return;
    }

    const normalizedFeedback = normalizeWriteText(feedback);
    const feedbackLength = countUnicodeCodePoints(normalizedFeedback);

    if (!normalizedFeedback) {
      setFeedbackError(t.adminListingRejectionFeedbackRequired);
      toast.error(t.adminListingRejectionFeedbackRequired);
      feedbackRef.current?.focus();
      return;
    }

    if (feedbackLength > REPORTED_LISTING_FEEDBACK_MAX_LENGTH) {
      setFeedbackError(t.adminListingFeedbackTooLong);
      feedbackRef.current?.focus();
      return;
    }

    setFeedbackError("");
    const wasSuccessful = await handleModerationDecision("rejected", normalizedFeedback);

    if (!wasSuccessful) {
      return;
    }

    toast.success(t.adminListingRejected);
    router.push(returnHref);
    router.refresh();
  }

  return (
    <div className="min-w-0 space-y-4">
      <header className="min-w-0 space-y-2 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="rounded-md bg-card">{getTranslatedListingApprovalStatus(listing.status, t, listing)}</Badge>
          {isListingResubmittedAfterEdit(listing) ? <Badge variant="outline" className="rounded-md">{t.adminListingResubmittedBadge}</Badge> : null}
        </div>
        <h1 className="break-words text-2xl font-bold leading-tight tracking-tight sm:text-3xl [overflow-wrap:anywhere]">{listing.title}</h1>
        <p className="text-xs text-muted-foreground">{t.adminSubmittedForReviewAt}{" · "}<ClientFormattedDateTime value={listing.submittedForReviewAt ?? listing.createdAt} language={language} /></p>
      </header>
      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,0.8fr)]">
        <section aria-labelledby="listing-review-evidence" className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-6">
          <h2 id="listing-review-evidence" className="text-lg font-semibold">{t.adminListingApprovalContentTitle}</h2>
          <div className="mt-4 flex min-w-0 items-start gap-4">
            <ListingReviewImages images={listing.images} imageUrl={listing.imageUrl} title={listing.title} />
            <div className="min-w-0 space-y-2"><p className="break-words text-xl font-semibold">{listing.price}</p><p className="break-words text-sm text-muted-foreground">{listing.location || t.torontoMeetup}</p></div>
          </div>
          {listing.description ? <div className="mt-5 border-t border-border pt-5"><h3 className="mb-2 text-sm font-semibold">{t.description}</h3><ListingDescriptionContent description={listing.description} className="break-words whitespace-normal text-sm leading-6" /></div> : null}
        </section>
        <details className="group min-w-0 rounded-2xl border border-border bg-card">
          <summary className="min-h-11 cursor-pointer rounded-2xl p-4 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5">{t.adminQueueContext}</summary>
          <div className="min-w-0 space-y-5 border-t border-border p-4 sm:p-5">
            <Link href={`/profile/${listing.seller.id}`} className="flex min-h-11 min-w-0 items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ProfileAvatar name={listing.seller.name} avatarPresetId={listing.seller.avatarPresetId} avatarUrl={listing.seller.avatarUrl} className="size-10 shrink-0" />
              <div className="min-w-0"><p className="break-words font-medium">{listing.seller.name}</p><p className="break-words text-sm text-muted-foreground">{listing.seller.school}</p></div>
            </Link>
            {listing.reviewedBy ? <ReviewMetadata label={t.adminReviewedBy}>{listing.reviewedBy.name}</ReviewMetadata> : null}
            {listing.moderationReviewedAt ? <ReviewMetadata label={t.reviewedAt}><ClientFormattedDateTime value={listing.moderationReviewedAt} language={language} /></ReviewMetadata> : null}
            {listing.moderationFeedback ? <ReviewMetadata label={t.adminFeedback}><p className="break-words whitespace-pre-wrap">{listing.moderationFeedback}</p></ReviewMetadata> : null}
            <div className="border-t border-border pt-4"><h2 className="text-sm font-semibold">{t.adminListingHistoryTitle}</h2>
              {listing.history?.length > 0 ? <ol className="mt-3 divide-y divide-border">{listing.history.map((entry) => <li key={entry.id} className="space-y-2 py-3 first:pt-0"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{getHistoryActionLabel(entry.action, t)}</Badge><ClientFormattedDateTime value={entry.decidedAt} language={language} className="text-xs text-muted-foreground" /></div><p className="break-words text-sm">{t.adminReviewedBy}: {entry.decidedByName}</p>{entry.feedback ? <p className="break-words whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{entry.feedback}</p> : null}</li>)}</ol> : <p className="mt-2 text-sm text-muted-foreground">{t.adminListingHistoryEmpty}</p>}
            </div>
          </div>
        </details>
        {canDecide ? <section aria-labelledby="listing-review-decision" aria-busy={isProcessing} className="min-w-0 rounded-2xl border border-border bg-card xl:col-span-2">
          <div className="space-y-3 p-4 sm:p-6">
            <h2 id="listing-review-decision" className="text-lg font-semibold">{t.adminListingFeedbackTitle}</h2>
            <p id="listing-moderation-feedback-description" className="max-w-3xl text-sm leading-6 text-muted-foreground">{t.adminListingFeedbackDescription}</p>
            <label htmlFor="listing-moderation-feedback" className="block text-sm font-medium">{t.adminListingFeedbackTitle} <span className="text-muted-foreground">({t.adminListingFeedbackRequiredMarker})</span></label>
            <Textarea ref={feedbackRef} id="listing-moderation-feedback" value={feedback} onChange={(event) => { setFeedback(event.target.value); if (feedbackError) setFeedbackError(""); }} placeholder={t.adminListingFeedbackPlaceholder} rows={4} className="min-h-28 resize-y text-base" disabled={!isPendingReview || isProcessing} aria-invalid={Boolean(feedbackError)} aria-describedby="listing-moderation-feedback-description listing-moderation-feedback-error" />
            <p id="listing-moderation-feedback-error" role={feedbackError ? "alert" : undefined} className="text-sm text-destructive">{feedbackError}</p>
            {!isPendingReview ? <p className="text-sm text-muted-foreground">{t.adminListingDecisionLockedDescription}</p> : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-border p-4 sm:px-6">
            <Button type="button" variant="outline" className="min-h-11 flex-1 whitespace-normal sm:flex-none" onClick={handleReject} disabled={isProcessing || !isPendingReview}>{t.adminRejectListing}</Button>
            <Button type="button" className="min-h-11 flex-1 whitespace-normal sm:flex-none" onClick={handleApprove} disabled={isProcessing || !isPendingReview}>{isProcessing ? t.saving : t.adminApproveListing}</Button>
          </div>
        </section> : null}
      </div>
    </div>
  );
}
