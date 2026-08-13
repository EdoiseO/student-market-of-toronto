import { createHash } from "node:crypto";

export const REJECTED_PROFILE_NAME_FINGERPRINT_KEY =
  "force_name_change_rejected_name_fingerprint";
export const REJECTED_PROFILE_NAME_FINGERPRINT_HISTORY_KEY =
  "force_name_change_rejected_name_fingerprints";
const MAX_REJECTED_PROFILE_NAME_FINGERPRINTS = 20;

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

export function getRejectedProfileNameFingerprints(appMetadata) {
  const history = Array.isArray(
    appMetadata?.[REJECTED_PROFILE_NAME_FINGERPRINT_HISTORY_KEY],
  )
    ? appMetadata[REJECTED_PROFILE_NAME_FINGERPRINT_HISTORY_KEY]
    : [];
  const legacyFingerprint = appMetadata?.[REJECTED_PROFILE_NAME_FINGERPRINT_KEY];

  return [legacyFingerprint, ...history]
    .filter((fingerprint) => typeof fingerprint === "string" && fingerprint.length > 0)
    .filter((fingerprint, index, fingerprints) => fingerprints.indexOf(fingerprint) === index)
    .slice(-MAX_REJECTED_PROFILE_NAME_FINGERPRINTS);
}

export function appendRejectedProfileNameFingerprint(appMetadata, fingerprint) {
  const history = getRejectedProfileNameFingerprints(appMetadata);

  if (typeof fingerprint === "string" && fingerprint.length > 0) {
    history.push(fingerprint);
  }

  return history
    .filter((candidate, index, fingerprints) => fingerprints.indexOf(candidate) === index)
    .slice(-MAX_REJECTED_PROFILE_NAME_FINGERPRINTS);
}

export function matchesRejectedProfileName(firstName, lastName, rejectedFingerprints) {
  const fingerprints = Array.isArray(rejectedFingerprints)
    ? rejectedFingerprints
    : [rejectedFingerprints];
  const nextFingerprint = getProfileNameFingerprint(firstName, lastName);

  return Boolean(nextFingerprint) && fingerprints.includes(nextFingerprint);
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
