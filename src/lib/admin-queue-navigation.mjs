// Keep review return links inside the queue they came from.
export function getAdminQueueReturnHref(value, queuePath) {
  if (typeof value !== "string" || value.length > 1800 || /[\\\r\n]/.test(value)) return queuePath;
  try {
    const url = new URL(value, "https://queue.invalid");
    if (!value.startsWith("/") || url.origin !== "https://queue.invalid" || url.pathname !== queuePath) return queuePath;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return queuePath;
  }
}

export function adminReviewHref(detailPath, queueHref, recordId) {
  return `${detailPath}?${new URLSearchParams({ returnTo: `${queueHref}#record-${recordId}` })}`;
}
