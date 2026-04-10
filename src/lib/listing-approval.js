export const LISTING_APPROVAL_STATUS_VALUES = {
  pendingReview: "inactive",
  rejected: "rejected",
};

const DISABLED_FLAG_VALUES = new Set(["0", "false", "off", "no"]);

function parseFeatureFlag(value, defaultValue = true) {
  if (typeof value !== "string") {
    return defaultValue;
  }

  return !DISABLED_FLAG_VALUES.has(value.trim().toLowerCase());
}

export function isActiveListingEditReviewEnabled() {
  return parseFeatureFlag(process.env.NEXT_PUBLIC_LISTING_EDIT_REVIEW_REQUIRED, true);
}

export function isListingResubmittedAfterEdit(listing) {
  const submittedForReviewAt = listing?.submitted_for_review_at ?? listing?.submittedForReviewAt;
  const moderationReviewedAt = listing?.moderation_reviewed_at ?? listing?.moderationReviewedAt;

  if (!submittedForReviewAt || !moderationReviewedAt) {
    return false;
  }

  return new Date(submittedForReviewAt).getTime() > new Date(moderationReviewedAt).getTime();
}

export function isPendingListingApproval(listing) {
  const status = listing?.status;
  const submittedForReviewAt = listing?.submitted_for_review_at ?? listing?.submittedForReviewAt;
  const moderationReviewedAt = listing?.moderation_reviewed_at ?? listing?.moderationReviewedAt;

  return (
    status === LISTING_APPROVAL_STATUS_VALUES.pendingReview &&
    Boolean(submittedForReviewAt) &&
    (!moderationReviewedAt || isListingResubmittedAfterEdit(listing))
  );
}

export function isListingApprovalSetupMissing(error) {
  const message = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    message.includes("rejected") ||
    message.includes("submitted_for_review_at") ||
    message.includes("moderation_feedback") ||
    message.includes("moderation_reviewed_at") ||
    message.includes("moderation_reviewed_by")
  );
}

export function getTranslatedListingApprovalStatus(status, t, listing = null) {
  switch (status) {
    case LISTING_APPROVAL_STATUS_VALUES.rejected:
      return t.rejected;
    case "active":
      return t.live;
    case "inactive":
      return isPendingListingApproval(listing) ? t.pendingReview : t.inactive;
    case "sold":
      return t.sold;
    case "draft":
    default:
      return t.draft;
  }
}
