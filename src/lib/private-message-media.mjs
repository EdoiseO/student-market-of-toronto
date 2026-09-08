export const PRIVATE_MESSAGE_MEDIA_PREFIX = "/api/message-media/";
export const PRIVATE_MESSAGE_MEDIA_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie",
};

export function isMessageAttachmentId(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// Keep the gallery's existing display-URL interface shared with public listings.
// This URL conveys no authority: every byte request needs the viewer's session.
export function withPrivateMessageMediaUrl(attachment) {
  return {
    ...attachment,
    signedUrl: isMessageAttachmentId(attachment.id)
      ? `${PRIVATE_MESSAGE_MEDIA_PREFIX}${attachment.id}`
      : null,
    requiresAuthentication: true,
  };
}

export function parseMessageMediaRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return false;
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if ((first !== null && !Number.isSafeInteger(first)) ||
      (last !== null && !Number.isSafeInteger(last))) return false;
  if (first === null) {
    if (last <= 0) return false;
    return { start: Math.max(0, size - last), end: size - 1 };
  }
  if (first >= size || (last !== null && last < first)) return false;
  return { start: first, end: last === null ? size - 1 : Math.min(last, size - 1) };
}

// Storage objects are capped at 10 MiB. Stop reading a corrupt or unexpectedly
// large upstream body rather than buffering an unbounded privileged response.
export async function readMessageMediaBody(response, expectedSize) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing attachment body");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > expectedSize) throw new Error("Attachment size mismatch");
      chunks.push(value);
    }
    if (size !== expectedSize) throw new Error("Attachment size mismatch");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
