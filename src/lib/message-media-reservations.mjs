export const MESSAGE_MEDIA_RESERVATION_BUCKET = "message-media";

export function isOwnedMessageMediaStoragePath(storagePath, userId) {
  if (typeof storagePath !== "string" || typeof userId !== "string" || !userId) {
    return false;
  }

  if (storagePath.includes("\\") || storagePath.includes("%")) {
    return false;
  }

  const segments = storagePath.split("/");

  return (
    segments.length === 3 &&
    segments[0] !== "" &&
    segments[0] !== "." &&
    segments[0] !== ".." &&
    segments[1] === userId &&
    segments[2] !== "" &&
    segments[2] !== "." &&
    segments[2] !== ".."
  );
}

export function buildMessageMediaUploadPlan({
  attachments,
  conversationId,
  randomUUID,
  sanitizeFileName,
  userId,
}) {
  if (!conversationId || !userId || typeof randomUUID !== "function") {
    throw new Error("Message media upload context is incomplete.");
  }

  return attachments.map((attachment) => {
    const fileName = sanitizeFileName(attachment.file.name);
    const storagePath = `${conversationId}/${userId}/${randomUUID()}-${fileName}`;

    return {
      ...attachment,
      storagePath,
      payload: {
        storage_path: storagePath,
        file_name: fileName,
        mime_type: attachment.file.type,
        size_bytes: attachment.file.size,
      },
    };
  });
}

export async function reserveMessageMediaUploadsIdempotent(
  supabase,
  { operationId, conversationId, body, uploadPlan },
) {
  return supabase.rpc("reserve_message_media_uploads_idempotent", {
    p_operation_id: operationId,
    p_conversation_id: conversationId,
    p_body: body,
    p_attachments: uploadPlan.map((item) => item.payload),
  });
}

export async function releaseMessageMediaUploadReservations(supabase, storagePaths) {
  const uniquePaths = [...new Set(storagePaths.filter(Boolean))];

  if (uniquePaths.length === 0) {
    return { data: 0, error: null };
  }

  return supabase.rpc("release_message_media_upload_reservations", {
    p_storage_paths: uniquePaths,
  });
}

export async function cleanupExpiredMessageMediaUploads(supabase) {
  const { data, error } = await supabase.rpc("list_expired_message_media_uploads");

  if (error) {
    return { error, removedPaths: [] };
  }

  const storagePaths = [...new Set((data ?? []).map((row) => row.storage_path).filter(Boolean))];

  if (storagePaths.length === 0) {
    return { error: null, removedPaths: [] };
  }

  const { error: removeError } = await supabase.storage
    .from(MESSAGE_MEDIA_RESERVATION_BUCKET)
    .remove(storagePaths);

  if (removeError) {
    return { error: removeError, removedPaths: [] };
  }

  const { error: releaseError } = await releaseMessageMediaUploadReservations(
    supabase,
    storagePaths,
  );

  return {
    error: releaseError ?? null,
    removedPaths: releaseError ? [] : storagePaths,
  };
}
