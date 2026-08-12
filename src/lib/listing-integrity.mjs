export const OWNED_LISTING_STATUS_ACTIONS = Object.freeze({
  submitForReview: "submit_for_review",
  markSold: "mark_sold",
  reopenForReview: "reopen_for_review",
});

export function parseListingContentRevision(value) {
  const normalizedValue =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;

  return Number.isSafeInteger(normalizedValue) && normalizedValue > 0
    ? normalizedValue
    : null;
}

export function isListingReviewRevisionConflict(error) {
  const message = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return error?.code === "40001" || message.includes("listing_review_revision_conflict");
}
