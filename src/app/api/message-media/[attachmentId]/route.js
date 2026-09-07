import { cookies } from "next/headers";

import { isOwnedMessageMediaStoragePath } from "@/lib/message-media-reservations.mjs";
import {
  MAX_MESSAGE_ATTACHMENT_BYTES,
  MESSAGE_ATTACHMENT_MIME_TYPES,
  sanitizeMessageAttachmentFileName,
} from "@/lib/messages";
import {
  isMessageAttachmentId,
  parseMessageMediaRange,
  PRIVATE_MESSAGE_MEDIA_HEADERS,
  readMessageMediaBody,
} from "@/lib/private-message-media.mjs";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function failure(request, status, message, extraHeaders = {}) {
  return new Response(request.method === "HEAD" ? null : JSON.stringify({ error: message }), {
    status,
    headers: {
      ...PRIVATE_MESSAGE_MEDIA_HEADERS,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

async function serveAttachment(request, { params }) {
  try {
    const { attachmentId } = await params;
    if (!isMessageAttachmentId(attachmentId)) {
      return failure(request, 404, "Attachment not available.");
    }

    const supabase = createClient(await cookies());
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return failure(request, 401, "Sign in to view this attachment.");

    // This query uses the viewer's JWT, never the service client. Attachment
    // RLS checks current database moderation authority even for retained JWTs.
    const { data: attachment, error } = await supabase
      .from("message_attachments")
      .select("id, uploader_id, storage_path")
      .eq("id", attachmentId)
      .maybeSingle();
    if (error) return failure(request, 503, "Attachment access could not be verified.");
    if (!attachment) return failure(request, 404, "Attachment not available.");

    const admin = createAdminClient();
    if (!admin) return failure(request, 503, "Attachment access is temporarily unavailable.");
    const { data: locations, error: locationError } = await admin.rpc(
      "resolve_message_media_attachment", { p_attachment_id: attachment.id },
    );
    const location = Array.isArray(locations) && locations.length === 1 ? locations[0] : null;
    if (locationError) return failure(request, 503, "Attachment access is temporarily unavailable.");
    if (!location) return failure(request, 404, "Attachment not available.");

    const size = Number(location.size_bytes);
    if (!isOwnedMessageMediaStoragePath(location.storage_path, attachment.uploader_id) ||
        location.storage_path.split("/")[0] !== attachment.storage_path.split("/")[0] ||
        !MESSAGE_ATTACHMENT_MIME_TYPES.has(location.mime_type) ||
        !Number.isSafeInteger(size) || size <= 0 || size > MAX_MESSAGE_ATTACHMENT_BYTES) {
      return failure(request, 502, "Attachment data is unavailable.");
    }

    // There are deliberately no reusable validators. If-Range therefore cannot
    // match; conditional requests receive a newly authorized full response.
    const range = request.headers.has("if-range") ? null
      : parseMessageMediaRange(request.headers.get("range"), size);
    if (range === false) {
      return failure(request, 416, "The requested range is not available.", {
        "Content-Range": `bytes */${size}`,
      });
    }
    const headers = {
      ...PRIVATE_MESSAGE_MEDIA_HEADERS,
      "Content-Type": location.mime_type,
      "Content-Disposition": `inline; filename="${sanitizeMessageAttachmentFileName(location.file_name)}"`,
      "Accept-Ranges": "bytes",
      "Content-Length": String(range ? range.end - range.start + 1 : size),
      ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${size}` } : {}),
    };
    if (request.method === "HEAD") {
      return new Response(null, { status: range ? 206 : 200, headers });
    }

    const storageUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
    storageUrl.pathname = `/storage/v1/object/authenticated/message-media/${location.storage_path.split("/").map(encodeURIComponent).join("/")}`;
    storageUrl.search = "";
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    // Do not redirect the browser or forward its conditional/range headers to
    // Storage. Privileged bytes are bounded and never enter the Next fetch cache.
    const upstream = await fetch(storageUrl, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
    });
    if (upstream.status !== 200) {
      await upstream.body?.cancel();
      return failure(request, 502, "Attachment data is temporarily unavailable.");
    }
    const bytes = await readMessageMediaBody(upstream, size);
    return new Response(range ? bytes.subarray(range.start, range.end + 1) : bytes, {
      status: range ? 206 : 200, headers,
    });
  } catch {
    // Do not put signed capabilities, object locations or credentials in logs.
    return failure(request, 503, "Attachment access is temporarily unavailable.");
  }
}

export const GET = serveAttachment;
export const HEAD = serveAttachment;
