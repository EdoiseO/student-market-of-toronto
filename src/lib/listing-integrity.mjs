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

const LISTING_SUBMISSION_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

export function parseListingSubmissionTimestamp(value) {
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !LISTING_SUBMISSION_TIMESTAMP_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    return null;
  }

  // PostgreSQL timestamps can carry microseconds. Returning the original value
  // avoids the precision loss caused by a JavaScript Date round trip.
  return value;
}

export function isListingReviewRevisionConflict(error) {
  const message = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return error?.code === "40001" || message.includes("listing_review_revision_conflict");
}
