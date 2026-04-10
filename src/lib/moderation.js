export const MODERATION_ROLE_VALUES = ["admin", "moderator", "staff"];

export const REPORT_SUBJECT_TYPES = {
  listing: "listing",
  message: "message",
  profile: "profile",
};

export const REPORT_STATUS_VALUES = {
  open: "open",
  resolved: "resolved",
  dismissed: "dismissed",
};

export const REPORT_REASON_VALUES = {
  spam: "spam",
  scam: "scam",
  misleading: "misleading",
  prohibited: "prohibited",
  harassment: "harassment",
  inappropriate: "inappropriate",
  other: "other",
};

export const REPORT_REASON_VALUES_BY_SUBJECT = {
  [REPORT_SUBJECT_TYPES.listing]: [
    REPORT_REASON_VALUES.spam,
    REPORT_REASON_VALUES.scam,
    REPORT_REASON_VALUES.misleading,
    REPORT_REASON_VALUES.prohibited,
    REPORT_REASON_VALUES.harassment,
    REPORT_REASON_VALUES.other,
  ],
  [REPORT_SUBJECT_TYPES.message]: [
    REPORT_REASON_VALUES.spam,
    REPORT_REASON_VALUES.scam,
    REPORT_REASON_VALUES.harassment,
    REPORT_REASON_VALUES.inappropriate,
    REPORT_REASON_VALUES.other,
  ],
  [REPORT_SUBJECT_TYPES.profile]: [
    REPORT_REASON_VALUES.spam,
    REPORT_REASON_VALUES.scam,
    REPORT_REASON_VALUES.harassment,
    REPORT_REASON_VALUES.inappropriate,
    REPORT_REASON_VALUES.other,
  ],
};

export const MODERATION_REPORT_SELECT = `
  id,
  reporter_user_id,
  subject_type,
  subject_id,
  listing_id,
  message_id,
  conversation_id,
  reported_user_id,
  reason,
  details,
  status,
  reviewed_by,
  reviewed_at,
  created_at
`;

function normalizeRoleValue(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim().toLowerCase();
  return normalizedValue.length > 0 ? normalizedValue : null;
}

export function getUserModerationRole(user) {
  const roleCandidates = [
    user?.app_metadata?.role,
    ...(Array.isArray(user?.app_metadata?.roles) ? user.app_metadata.roles : []),
    user?.role,
  ];

  for (const candidate of roleCandidates) {
    const normalizedCandidate = normalizeRoleValue(candidate);

    if (normalizedCandidate && MODERATION_ROLE_VALUES.includes(normalizedCandidate)) {
      return normalizedCandidate;
    }
  }

  return null;
}

export function isModerationRole(role) {
  return MODERATION_ROLE_VALUES.includes(normalizeRoleValue(role));
}

export function isModerationUser(user) {
  return isModerationRole(getUserModerationRole(user));
}

export function isReportsTableMissing(error) {
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    error?.message?.includes("Could not find the table 'public.reports'")
  );
}

export function isReportsSubjectTypeUnsupported(error) {
  const message = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    (error?.code === "23514" || error?.code === "22P02") &&
    message.includes("subject_type")
  );
}

export function getTranslatedReportReason(reason, t, subjectType = null) {
  if (subjectType === REPORT_SUBJECT_TYPES.profile) {
    switch (reason) {
      case REPORT_REASON_VALUES.spam:
        return t.reportReasonProfileSpam;
      case REPORT_REASON_VALUES.scam:
        return t.reportReasonProfileScam;
      case REPORT_REASON_VALUES.harassment:
        return t.reportReasonProfileHarassment;
      case REPORT_REASON_VALUES.inappropriate:
        return t.reportReasonProfileInappropriate;
      case REPORT_REASON_VALUES.other:
        return t.reportReasonOther;
      default:
        return reason ?? t.unknown;
    }
  }

  switch (reason) {
    case REPORT_REASON_VALUES.spam:
      return t.reportReasonSpam;
    case REPORT_REASON_VALUES.scam:
      return t.reportReasonScam;
    case REPORT_REASON_VALUES.misleading:
      return t.reportReasonMisleading;
    case REPORT_REASON_VALUES.prohibited:
      return t.reportReasonProhibited;
    case REPORT_REASON_VALUES.harassment:
      return t.reportReasonHarassment;
    case REPORT_REASON_VALUES.inappropriate:
      return t.reportReasonInappropriate;
    case REPORT_REASON_VALUES.other:
      return t.reportReasonOther;
    default:
      return reason ?? t.unknown;
  }
}

export function getTranslatedReportStatus(status, t) {
  switch (status) {
    case REPORT_STATUS_VALUES.resolved:
      return t.adminResolvedStatus;
    case REPORT_STATUS_VALUES.dismissed:
      return t.adminDismissedStatus;
    case REPORT_STATUS_VALUES.open:
    default:
      return t.adminOpenStatus;
  }
}

export function getTranslatedReportSubjectType(subjectType, t) {
  switch (subjectType) {
    case REPORT_SUBJECT_TYPES.message:
      return t.messages;
    case REPORT_SUBJECT_TYPES.profile:
      return t.profile;
    case REPORT_SUBJECT_TYPES.listing:
    default:
      return t.listing;
  }
}

export function getReportReasonOptions(subjectType, t) {
  return (REPORT_REASON_VALUES_BY_SUBJECT[subjectType] ?? []).map((reason) => ({
    value: reason,
    label: getTranslatedReportReason(reason, t, subjectType),
  }));
}

export function getModerationReportTargetId(report) {
  if (!report) {
    return null;
  }

  switch (report.subjectType ?? report.subject_type) {
    case REPORT_SUBJECT_TYPES.message:
      return report.message?.id ?? report.message_id ?? report.subjectId ?? report.subject_id ?? null;
    case REPORT_SUBJECT_TYPES.profile:
      return report.profile?.id ?? report.subjectId ?? report.subject_id ?? report.reported_user_id ?? null;
    case REPORT_SUBJECT_TYPES.listing:
    default:
      return report.listing?.id ?? report.listing_id ?? report.subjectId ?? report.subject_id ?? null;
  }
}

export function getModerationReportGroupKey(report) {
  const subjectType = report?.subjectType ?? report?.subject_type ?? REPORT_SUBJECT_TYPES.listing;
  const targetId = getModerationReportTargetId(report);

  return `${subjectType}:${targetId ?? report?.id ?? "unknown"}`;
}

export function getModerationDisplayName(profile, t) {
  return [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() || t.student;
}
