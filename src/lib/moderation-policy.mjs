export const MODERATION_ROLES = Object.freeze({
  admin: "admin",
  moderator: "moderator",
  staff: "staff",
});

export const MODERATION_ACTIONS = Object.freeze({
  viewDashboard: "view_dashboard",
  readReports: "read_reports",
  triageReports: "triage_reports",
  assignReports: "assign_reports",
  decideReports: "decide_reports",
  readListings: "read_listings",
  decideListings: "decide_listings",
  readUsers: "read_users",
  readConversations: "read_conversations",
  readAuditLog: "read_audit_log",
  issueWarning: "issue_warning",
  issueStandardStrike: "issue_standard_strike",
  closeChatTemporarily: "close_chat_temporarily",
  reopenChat: "reopen_chat",
  banUser: "ban_user",
  unbanUser: "unban_user",
  manageRoles: "manage_roles",
  manageAnnouncements: "manage_announcements",
});

const STAFF_ACTIONS = Object.freeze([
  MODERATION_ACTIONS.viewDashboard,
  MODERATION_ACTIONS.readReports,
  MODERATION_ACTIONS.triageReports,
  MODERATION_ACTIONS.assignReports,
  MODERATION_ACTIONS.readListings,
]);

const MODERATOR_ACTIONS = Object.freeze([
  ...STAFF_ACTIONS,
  MODERATION_ACTIONS.decideReports,
  MODERATION_ACTIONS.decideListings,
  MODERATION_ACTIONS.readUsers,
  MODERATION_ACTIONS.readConversations,
  MODERATION_ACTIONS.issueWarning,
  MODERATION_ACTIONS.issueStandardStrike,
  MODERATION_ACTIONS.closeChatTemporarily,
  MODERATION_ACTIONS.reopenChat,
]);

export const MODERATION_ROLE_ACTIONS = Object.freeze({
  [MODERATION_ROLES.admin]: Object.freeze(Object.values(MODERATION_ACTIONS)),
  [MODERATION_ROLES.moderator]: MODERATOR_ACTIONS,
  [MODERATION_ROLES.staff]: STAFF_ACTIONS,
});

const KNOWN_MODERATION_ACTIONS = new Set(Object.values(MODERATION_ACTIONS));

export function normalizeModerationRole(value) {
  if (typeof value !== "string") {
    return null;
  }

  const role = value.trim().toLowerCase();
  return Object.values(MODERATION_ROLES).includes(role) ? role : null;
}

export function normalizeModerationAction(value) {
  if (typeof value !== "string") {
    return null;
  }

  const action = value.trim().toLowerCase();
  return KNOWN_MODERATION_ACTIONS.has(action) ? action : null;
}

export function canPerformModerationAction(role, action) {
  const normalizedRole = normalizeModerationRole(role);
  const normalizedAction = normalizeModerationAction(action);

  if (!normalizedRole || !normalizedAction) {
    return false;
  }

  return MODERATION_ROLE_ACTIONS[normalizedRole].includes(normalizedAction);
}

export const BAN_DURATIONS = Object.freeze({
  "24h": "24h",
  "7d": "168h",
  "30d": "720h",
  permanent: "876000h",
});

export const BAN_DURATION_VALUES = Object.freeze(Object.keys(BAN_DURATIONS));
export const SUPABASE_UNBAN_DURATION = "none";

export function normalizeBanDuration(value) {
  if (typeof value !== "string") {
    return null;
  }

  const duration = value.trim().toLowerCase();
  return BAN_DURATION_VALUES.includes(duration) ? duration : null;
}

export function getSupabaseBanDuration(value) {
  const duration = normalizeBanDuration(value);
  return duration ? BAN_DURATIONS[duration] : null;
}

export const BAN_REASON_CODES = Object.freeze({
  spam: "spam",
  scam: "scam",
  misleading: "misleading",
  prohibited: "prohibited",
  harassment: "harassment",
  inappropriate: "inappropriate",
  other: "other",
});

export const BAN_REASON_CODE_VALUES = Object.freeze(Object.values(BAN_REASON_CODES));
export const BAN_REASON_MESSAGE_MIN_LENGTH = 10;
export const BAN_REASON_MESSAGE_MAX_LENGTH = 1000;

export function normalizeBanReasonCode(value) {
  if (typeof value !== "string") {
    return null;
  }

  const reasonCode = value.trim().toLowerCase();
  return BAN_REASON_CODE_VALUES.includes(reasonCode) ? reasonCode : null;
}

export function normalizeUserFacingBanReason(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\r\n?/g, "\n").trim();
}

function getTextLength(value) {
  return Array.from(value).length;
}

export function validateBanReason(input) {
  const reasonCode = normalizeBanReasonCode(input?.reasonCode);
  const userMessage = normalizeUserFacingBanReason(input?.userMessage);

  if (!reasonCode) {
    return {
      ok: false,
      reasonCode: null,
      userMessage,
      error: "reason_code",
    };
  }

  const messageLength = getTextLength(userMessage);

  if (
    messageLength < BAN_REASON_MESSAGE_MIN_LENGTH ||
    messageLength > BAN_REASON_MESSAGE_MAX_LENGTH
  ) {
    return {
      ok: false,
      reasonCode,
      userMessage,
      error: "user_message",
    };
  }

  return {
    ok: true,
    reasonCode,
    userMessage,
  };
}

export const ANNOUNCEMENT_MESSAGE_MIN_LENGTH = 1;
export const ANNOUNCEMENT_MESSAGE_MAX_LENGTH = 2000;

export function normalizeAnnouncementMessage(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\r\n?/g, "\n").trim();
}

export function validateAnnouncementMessage(value) {
  const message = normalizeAnnouncementMessage(value);
  const messageLength = getTextLength(message);

  if (
    messageLength < ANNOUNCEMENT_MESSAGE_MIN_LENGTH ||
    messageLength > ANNOUNCEMENT_MESSAGE_MAX_LENGTH
  ) {
    return { ok: false, message, error: "message" };
  }

  return { ok: true, message };
}
