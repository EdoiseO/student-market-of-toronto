const OPEN_REPORT_STATUS = "open";

function normalizeId(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function requireMatchingIds(values) {
  const ids = values.map(normalizeId).filter(Boolean);

  if (ids.length === 0 || new Set(ids).size !== 1) {
    return null;
  }

  return ids[0];
}

export function getReportSubjectBinding(report) {
  switch (report?.subject_type) {
    case "listing": {
      const targetId = requireMatchingIds([report.listing_id, report.subject_id]);
      return targetId ? `listing:${targetId}` : null;
    }
    case "message": {
      const targetId = requireMatchingIds([report.message_id, report.subject_id]);
      return targetId ? `message:${targetId}` : null;
    }
    case "profile": {
      const targetId = requireMatchingIds([report.reported_user_id, report.subject_id]);
      return targetId ? `profile:${targetId}` : null;
    }
    default:
      return null;
  }
}

export function areOpenReportsBoundToOneSubject(reportRows, requestedReportIds) {
  const requestedIds = [...new Set((requestedReportIds ?? []).map(normalizeId).filter(Boolean))];
  const rows = Array.isArray(reportRows) ? reportRows : [];

  if (requestedIds.length === 0 || rows.length !== requestedIds.length) {
    return false;
  }

  const requestedIdSet = new Set(requestedIds);
  const rowIds = rows.map((report) => normalizeId(report?.id));

  if (
    rowIds.some((id) => !id || !requestedIdSet.has(id)) ||
    new Set(rowIds).size !== requestedIds.length ||
    rows.some((report) => report?.status !== OPEN_REPORT_STATUS)
  ) {
    return false;
  }

  const bindings = rows.map(getReportSubjectBinding);
  return bindings.every(Boolean) && new Set(bindings).size === 1;
}

export function getRestorableBanDuration(bannedUntil, now = Date.now()) {
  if (!bannedUntil) {
    return "none";
  }

  const remainingMilliseconds = new Date(bannedUntil).getTime() - now;

  if (!Number.isFinite(remainingMilliseconds) || remainingMilliseconds <= 0) {
    return "none";
  }

  return `${Math.max(1, Math.ceil(remainingMilliseconds / 1000))}s`;
}
