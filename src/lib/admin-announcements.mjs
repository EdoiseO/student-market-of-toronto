import {
  ANNOUNCEMENT_MESSAGE_MAX_LENGTH,
  validateAnnouncementMessage,
} from "./moderation-policy.mjs";

export const ANNOUNCEMENT_TITLE_MAX_LENGTH = 160;
export const ANNOUNCEMENT_PAGE_SIZE = 20;
export const ANNOUNCEMENT_CATEGORIES = Object.freeze([
  "general",
  "maintenance",
  "safety",
  "policy",
  "moderation",
]);
export const ANNOUNCEMENT_PRIORITIES = Object.freeze([
  "low",
  "normal",
  "high",
  "urgent",
]);
export const ANNOUNCEMENT_AUDIENCE_TYPES = Object.freeze([
  "all",
  "school",
  "role",
  "selected",
]);
export const ANNOUNCEMENT_AUDIENCE_ROLES = Object.freeze([
  "member",
  "staff",
  "moderator",
  "admin",
]);
export const ANNOUNCEMENT_DELIVERY_POLICIES = Object.freeze([
  "preference_aware",
  "always_on",
]);
export const ANNOUNCEMENT_STATUSES = Object.freeze([
  "draft",
  "scheduled",
  "sending",
  "sent",
  "partially_failed",
  "cancelled",
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeEnum(value, allowedValues) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return allowedValues.includes(normalized) ? normalized : null;
}

function uniqueStrings(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .filter((value) => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean),
  )];
}

export function isAnnouncementOperationId(value) {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

export function normalizeAnnouncementTitle(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function buildAnnouncementTitle(message) {
  const title = normalizeAnnouncementTitle(message);
  const characters = Array.from(title);

  return characters.length > 80
    ? `${characters.slice(0, 79).join("")}\u2026`
    : title;
}

export function buildAnnouncementAudienceFilter(audienceType, rawFilter) {
  switch (audienceType) {
    case "school": {
      const schools = uniqueStrings(rawFilter?.schools);
      return schools.length >= 1 && schools.length <= 25
        ? { ok: true, value: { schools } }
        : { ok: false, error: "audience" };
    }
    case "role": {
      const roles = uniqueStrings(rawFilter?.roles).map((role) => role.toLowerCase());
      if (
        roles.length < 1 ||
        roles.length > ANNOUNCEMENT_AUDIENCE_ROLES.length ||
        roles.some((role) => !ANNOUNCEMENT_AUDIENCE_ROLES.includes(role))
      ) {
        return { ok: false, error: "audience" };
      }
      return { ok: true, value: { roles } };
    }
    case "selected": {
      const userIds = uniqueStrings(rawFilter?.user_ids).map((id) => id.toLowerCase());
      if (
        userIds.length < 1 ||
        userIds.length > 500 ||
        userIds.some((id) => !UUID_PATTERN.test(id))
      ) {
        return { ok: false, error: "audience" };
      }
      return { ok: true, value: { user_ids: userIds } };
    }
    case "all":
      return { ok: true, value: {} };
    default:
      return { ok: false, error: "audience" };
  }
}

export function validateAnnouncementPayload(input, { titleRequired = true } = {}) {
  const bodyValidation = validateAnnouncementMessage(input?.body ?? input?.message);
  if (!bodyValidation.ok) {
    return { ok: false, error: "body" };
  }

  const title = normalizeAnnouncementTitle(input?.title);
  const titleLength = Array.from(title).length;
  if (titleRequired && (titleLength < 1 || titleLength > ANNOUNCEMENT_TITLE_MAX_LENGTH)) {
    return { ok: false, error: "title" };
  }

  const category = normalizeEnum(input?.category ?? "general", ANNOUNCEMENT_CATEGORIES);
  const priority = normalizeEnum(input?.priority ?? "normal", ANNOUNCEMENT_PRIORITIES);
  const audienceType = normalizeEnum(
    input?.audienceType ?? "all",
    ANNOUNCEMENT_AUDIENCE_TYPES,
  );
  const deliveryPolicy = normalizeEnum(
    input?.deliveryPolicy ?? "always_on",
    ANNOUNCEMENT_DELIVERY_POLICIES,
  );

  if (!category || !priority || !audienceType || !deliveryPolicy) {
    return { ok: false, error: "selection" };
  }
  if (["safety", "policy", "moderation"].includes(category) && deliveryPolicy !== "always_on") {
    return { ok: false, error: "delivery_policy" };
  }

  const audience = buildAnnouncementAudienceFilter(audienceType, input?.audienceFilter);
  if (!audience.ok) {
    return audience;
  }

  return {
    ok: true,
    value: {
      title: title || buildAnnouncementTitle(bodyValidation.message),
      body: bodyValidation.message,
      category,
      priority,
      audienceType,
      audienceFilter: audience.value,
      deliveryPolicy,
      // Email stays off until a tracked provider worker is deployed.
      emailEnabled: false,
    },
  };
}

export function normalizeAnnouncementRow(row) {
  const recipientCount = Number(row?.recipient_count ?? 0);
  const deliveredCount = Number(row?.delivered_count ?? 0);
  const failedCount = Number(row?.failed_count ?? 0);
  const skippedCount = Number(row?.skipped_count ?? 0);
  const cancelledCount = Number(row?.cancelled_count ?? 0);
  const terminalCount = deliveredCount + failedCount + skippedCount + cancelledCount;

  return {
    id: row?.id ?? null,
    title: row?.title ?? "",
    body: row?.body ?? "",
    category: row?.category ?? "general",
    priority: row?.priority ?? "normal",
    audienceType: row?.audience_type ?? "all",
    audienceFilter: row?.audience_filter ?? {},
    deliveryPolicy: row?.delivery_policy ?? "preference_aware",
    emailEnabled: Boolean(row?.email_enabled),
    status: row?.status ?? "draft",
    scheduledFor: row?.scheduled_for ?? null,
    sendingStartedAt: row?.sending_started_at ?? null,
    sentAt: row?.sent_at ?? null,
    cancelledAt: row?.cancelled_at ?? null,
    recipientCount,
    deliveredCount,
    failedCount,
    skippedCount,
    cancelledCount,
    readCount: Number(row?.read_count ?? 0),
    dismissedCount: Number(row?.dismissed_count ?? 0),
    terminalCount,
    progressPercent:
      recipientCount > 0
        ? Math.min(100, Math.round((terminalCount / recipientCount) * 100))
        : 0,
    version: Number(row?.version ?? 1),
    createdAt: row?.created_at ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

export function parseAnnouncementPage(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function parseAnnouncementStatus(value) {
  return normalizeEnum(value, ANNOUNCEMENT_STATUSES);
}

export { ANNOUNCEMENT_MESSAGE_MAX_LENGTH };
