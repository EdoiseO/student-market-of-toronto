export const ACCOUNT_STANDING_NOTICE_SELECT = `
  id,
  sanction_type,
  severity,
  reason_code,
  user_message,
  strike_points,
  restrictions,
  starts_at,
  expires_at,
  acknowledgement_required,
  acknowledged_at,
  revoked_at,
  revocation_kind,
  revocation_reason,
  review_requested_at,
  review_status,
  reviewed_at,
  supersedes_sanction_id,
  replacement_sanction_id,
  review_outcome_message,
  lifecycle_state,
  created_at,
  updated_at
`;

const ACTIVE_LIFECYCLE_STATES = new Set(["active", "acknowledged"]);
const SANCTION_TYPES = new Set(["warning", "strike", "ban"]);
const SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const REVIEW_STATES = new Set(["pending", "upheld", "modified", "overturned"]);
const HISTORY_STATES = new Set([
  "active",
  "acknowledged",
  "expired",
  "revoked",
  "overturned",
]);

function normalizeNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeTimestamp(value) {
  const normalized = normalizeString(value);
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : null;
}

function normalizeRestrictions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value).slice(0, 20));
}

export function normalizeModerationNotice(row) {
  const rawSanctionType = row?.sanctionType ?? row?.sanction_type;
  const rawSeverity = row?.severity;
  const rawLifecycleState = row?.lifecycleState ?? row?.lifecycle_state;
  const rawReviewStatus = row?.reviewStatus ?? row?.review_status;
  const sanctionType = SANCTION_TYPES.has(rawSanctionType)
    ? rawSanctionType
    : "warning";
  const severity = SEVERITIES.has(rawSeverity) ? rawSeverity : "low";
  const lifecycleState = HISTORY_STATES.has(rawLifecycleState)
    ? rawLifecycleState
    : "active";
  const reviewStatus = REVIEW_STATES.has(rawReviewStatus)
    ? rawReviewStatus
    : null;

  return {
    id: normalizeString(row?.id),
    sanctionType,
    severity,
    reasonCode: normalizeString(row?.reasonCode ?? row?.reason_code) ?? "other",
    userMessage: normalizeString(row?.userMessage ?? row?.user_message) ?? "",
    strikePoints: Number.isInteger(row?.strikePoints ?? row?.strike_points)
      ? (row.strikePoints ?? row.strike_points)
      : null,
    restrictions: normalizeRestrictions(row?.restrictions),
    startsAt: normalizeTimestamp(row?.startsAt ?? row?.starts_at),
    expiresAt: normalizeTimestamp(row?.expiresAt ?? row?.expires_at),
    acknowledgementRequired: (row?.acknowledgementRequired ?? row?.acknowledgement_required) === true,
    acknowledgedAt: normalizeTimestamp(row?.acknowledgedAt ?? row?.acknowledged_at),
    revokedAt: normalizeTimestamp(row?.revokedAt ?? row?.revoked_at),
    revocationKind: normalizeString(row?.revocationKind ?? row?.revocation_kind),
    revocationReason: normalizeString(row?.revocationReason ?? row?.revocation_reason),
    reviewRequestedAt: normalizeTimestamp(row?.reviewRequestedAt ?? row?.review_requested_at),
    reviewStatus,
    reviewedAt: normalizeTimestamp(row?.reviewedAt ?? row?.reviewed_at),
    supersedesSanctionId: normalizeString(row?.supersedesSanctionId ?? row?.supersedes_sanction_id),
    replacementSanctionId: normalizeString(row?.replacementSanctionId ?? row?.replacement_sanction_id),
    reviewOutcomeMessage: normalizeString(row?.reviewOutcomeMessage ?? row?.review_outcome_message),
    lifecycleState,
    createdAt: normalizeTimestamp(row?.createdAt ?? row?.created_at),
    updatedAt: normalizeTimestamp(row?.updatedAt ?? row?.updated_at),
  };
}

export function normalizeAccountStandingSummary(row) {
  return {
    activeNoticeCount: normalizeNonNegativeInteger(
      row?.activeNoticeCount ?? row?.active_notice_count,
    ),
    strikePoints: normalizeNonNegativeInteger(row?.strikePoints ?? row?.strike_points),
    needsAcknowledgement: normalizeNonNegativeInteger(
      row?.needsAcknowledgement ?? row?.needs_acknowledgement,
    ),
    pendingReviews: normalizeNonNegativeInteger(
      row?.pendingReviews ?? row?.pending_reviews,
    ),
    hasActiveRestrictions:
      (row?.hasActiveRestrictions ?? row?.has_active_restrictions) === true,
    hasActiveBan: (row?.hasActiveBan ?? row?.has_active_ban) === true,
  };
}

export function isModerationNoticeActive(notice, now = Date.now()) {
  if (!notice || !ACTIVE_LIFECYCLE_STATES.has(notice.lifecycleState)) {
    return false;
  }

  const expiry = notice.expiresAt ? Date.parse(notice.expiresAt) : null;
  return expiry === null || (Number.isFinite(expiry) && expiry > now);
}

function isCurrentBanActive(currentStatus, now) {
  if (currentStatus?.isBanned !== true) {
    return false;
  }

  if (!currentStatus.bannedUntil) {
    return true;
  }

  const expiry = Date.parse(currentStatus.bannedUntil);
  return !Number.isFinite(expiry) || expiry > now;
}

export function deriveAccountStanding(
  notices,
  currentStatus = null,
  now = Date.now(),
  authoritativeSummary = null,
) {
  const normalizedNotices = (Array.isArray(notices) ? notices : [])
    .filter((notice) => notice?.id)
    .map((notice) => normalizeModerationNotice(notice));
  const activeNotices = normalizedNotices.filter((notice) => (
    isModerationNoticeActive(notice, now)
  ));
  const summary = authoritativeSummary
    ? normalizeAccountStandingSummary(authoritativeSummary)
    : null;
  const activeNoticeCount = summary?.activeNoticeCount ?? activeNotices.length;
  const hasActiveBan = isCurrentBanActive(currentStatus, now)
    || (summary?.hasActiveBan ?? activeNotices.some(
      (notice) => notice.sanctionType === "ban",
    ));
  const hasRestrictions = summary?.hasActiveRestrictions ?? activeNotices.some((notice) => (
    Object.keys(notice.restrictions).length > 0
  ));
  const needsAcknowledgement = summary?.needsAcknowledgement ?? activeNotices.filter((notice) => (
    notice.acknowledgementRequired && !notice.acknowledgedAt
  )).length;
  const pendingReviews = summary?.pendingReviews ?? activeNotices.filter((notice) => (
    notice.reviewStatus === "pending"
  )).length;
  const strikePoints = summary?.strikePoints ?? activeNotices.reduce((total, notice) => (
    total + (notice.strikePoints ?? 0)
  ), 0);

  let status = "good";

  if (hasActiveBan) {
    status = "banned";
  } else if (hasRestrictions) {
    status = "restricted";
  } else if (activeNoticeCount > 0) {
    status = "action_needed";
  }

  return {
    status,
    notices: normalizedNotices,
    activeNotices,
    metrics: {
      activeNotices: activeNoticeCount,
      strikePoints,
      needsAcknowledgement,
      pendingReviews,
    },
  };
}

export function isAccountStandingSetupMissing(error) {
  const message = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    error?.code === "42P01"
    || error?.code === "PGRST205"
    || error?.code === "42883"
    || error?.code === "PGRST202"
    || message.includes("user_moderation_notices")
    || message.includes("get_account_standing_summary")
  );
}
