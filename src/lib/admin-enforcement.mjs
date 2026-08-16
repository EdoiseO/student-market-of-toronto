export const ADMIN_ENFORCEMENT_PAGE_SIZE = 20;
export const ADMIN_ENFORCEMENT_MAX_PAGE = 1_000_000;

export const ADMIN_ENFORCEMENT_STATUSES = Object.freeze([
  "all",
  "active",
  "review",
  "history",
]);
export const ADMIN_ENFORCEMENT_TYPES = Object.freeze([
  "all",
  "warning",
  "strike",
  "ban",
]);
export const ADMIN_ENFORCEMENT_SEVERITIES = Object.freeze([
  "all",
  "low",
  "medium",
  "high",
  "critical",
]);

// Intentionally omits internal_note, review_private_reason and metadata. These
// records cross a server-to-client boundary and must contain user-safe copy only.
export const ADMIN_ENFORCEMENT_SANCTION_SELECT = `
  id,
  subject_user_id_snapshot,
  issued_by_user_id_snapshot,
  issued_by_role,
  source_report_id,
  sanction_type,
  severity,
  reason_code,
  user_message,
  strike_points,
  restrictions,
  related_resource_type,
  related_resource_id,
  starts_at,
  expires_at,
  acknowledgement_required,
  acknowledged_at,
  revoked_at,
  revoked_by_user_id_snapshot,
  revoked_by_role,
  revocation_kind,
  revocation_reason,
  review_requested_at,
  review_status,
  reviewed_at,
  reviewed_by_user_id_snapshot,
  reviewed_by_role,
  replacement_sanction_id,
  review_outcome_message,
  created_at,
  updated_at
`;

function firstValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function fromAllowed(value, allowed, fallback = "all") {
  const normalized = typeof firstValue(value) === "string"
    ? firstValue(value).trim().toLowerCase()
    : "";
  return allowed.includes(normalized) ? normalized : fallback;
}

export function parseAdminEnforcementFilters(searchParams) {
  const parsedPage = Number.parseInt(firstValue(searchParams?.page), 10);
  const page = Number.isSafeInteger(parsedPage)
    && parsedPage > 0
    && parsedPage <= ADMIN_ENFORCEMENT_MAX_PAGE
    ? parsedPage
    : 1;

  return {
    page,
    status: fromAllowed(searchParams?.status, ADMIN_ENFORCEMENT_STATUSES),
    type: fromAllowed(searchParams?.type, ADMIN_ENFORCEMENT_TYPES),
    severity: fromAllowed(searchParams?.severity, ADMIN_ENFORCEMENT_SEVERITIES),
    query: typeof firstValue(searchParams?.q) === "string"
      ? firstValue(searchParams.q).replace(/\s+/g, " ").trim().slice(0, 100)
      : "",
  };
}

export function getAdminEnforcementHref(filters, page = filters.page) {
  const params = new URLSearchParams();
  if (page > 1) params.set("page", String(page));
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.type !== "all") params.set("type", filters.type);
  if (filters.severity !== "all") params.set("severity", filters.severity);
  if (filters.query) params.set("q", filters.query);
  const query = params.toString();
  return query ? `/admin/enforcement?${query}` : "/admin/enforcement";
}

export function isSanctionEffectivelyActive(sanction, now = Date.now()) {
  if (!sanction || sanction.revoked_at) return false;
  const startsAt = Date.parse(sanction.starts_at ?? sanction.created_at ?? "");
  const expiresAt = Date.parse(sanction.expires_at ?? "");
  if (Number.isFinite(startsAt) && startsAt > now) return false;
  return !Number.isFinite(expiresAt) || expiresAt > now;
}

export function normalizeAdminSanction(row, profilesById = new Map()) {
  const subject = profilesById.get(row.subject_user_id_snapshot) ?? null;
  const issuer = profilesById.get(row.issued_by_user_id_snapshot) ?? null;
  const reviewer = profilesById.get(row.reviewed_by_user_id_snapshot) ?? null;
  const displayName = (profile) => [profile?.first_name, profile?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim() || null;

  return {
    id: row.id,
    subjectUserId: row.subject_user_id_snapshot,
    subjectName: displayName(subject),
    subjectSchool: subject?.school ?? null,
    issuedByUserId: row.issued_by_user_id_snapshot,
    issuedByName: displayName(issuer),
    issuedByRole: row.issued_by_role,
    sourceReportId: row.source_report_id,
    sanctionType: row.sanction_type,
    severity: row.severity,
    reasonCode: row.reason_code,
    userMessage: row.user_message,
    strikePoints: row.strike_points,
    restrictions: row.restrictions ?? {},
    relatedResourceType: row.related_resource_type,
    relatedResourceId: row.related_resource_id,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    acknowledgementRequired: row.acknowledgement_required === true,
    acknowledgedAt: row.acknowledged_at,
    revokedAt: row.revoked_at,
    revokedByUserId: row.revoked_by_user_id_snapshot,
    revokedByRole: row.revoked_by_role,
    revocationKind: row.revocation_kind,
    revocationReason: row.revocation_reason,
    reviewRequestedAt: row.review_requested_at,
    reviewStatus: row.review_status,
    reviewedAt: row.reviewed_at,
    reviewedByUserId: row.reviewed_by_user_id_snapshot,
    reviewedByName: displayName(reviewer),
    reviewedByRole: row.reviewed_by_role,
    replacementSanctionId: row.replacement_sanction_id,
    reviewOutcomeMessage: row.review_outcome_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isActive: isSanctionEffectivelyActive(row),
  };
}
