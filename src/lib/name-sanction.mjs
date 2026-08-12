import { createHash } from "node:crypto";

export const REJECTED_PROFILE_NAME_FINGERPRINT_KEY =
  "force_name_change_rejected_name_fingerprint";

function normalizeProfileNamePart(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .normalize("NFKC")
    .replace(/\p{Default_Ignorable_Code_Point}+/gu, "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-CA");
}

export function getProfileNameFingerprint(firstName, lastName) {
  const normalizedName = [
    normalizeProfileNamePart(firstName),
    normalizeProfileNamePart(lastName),
  ];

  if (normalizedName.every((part) => !part)) {
    return null;
  }

  return createHash("sha256").update(JSON.stringify(normalizedName)).digest("hex");
}

export function matchesRejectedProfileName(firstName, lastName, rejectedFingerprint) {
  if (typeof rejectedFingerprint !== "string" || !rejectedFingerprint) {
    return false;
  }

  return getProfileNameFingerprint(firstName, lastName) === rejectedFingerprint;
}

export function areOpenProfileReportsBoundToUser(reportRows, reportIds, targetUserId) {
  if (!Array.isArray(reportRows) || !Array.isArray(reportIds) || !targetUserId) {
    return false;
  }

  const expectedReportIds = new Set(reportIds);

  return (
    expectedReportIds.size > 0 &&
    reportRows.length === expectedReportIds.size &&
    reportRows.every(
      (report) =>
        expectedReportIds.has(report?.id) &&
        report?.subject_type === "profile" &&
        report?.status === "open" &&
        report?.subject_id === targetUserId &&
        (!report?.reported_user_id || report.reported_user_id === targetUserId),
    )
  );
}
