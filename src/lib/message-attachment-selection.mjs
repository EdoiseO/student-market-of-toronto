export function getMessageAttachmentFingerprint(file) {
  return [
    String(file?.name ?? ""),
    String(file?.type ?? ""),
    Number(file?.size ?? 0),
    Number(file?.lastModified ?? 0),
  ].join("\u0000");
}

export function selectMessageAttachmentFiles({
  files,
  currentAttachments = [],
  allowedMimeTypes,
  maxBytes,
  maxCount,
}) {
  const selectedFingerprints = new Set(
    currentAttachments.map((attachment) =>
      getMessageAttachmentFingerprint(attachment?.file ?? attachment),
    ),
  );
  const acceptedFiles = [];
  const duplicateFiles = [];
  const unsupportedFiles = [];
  const invalidSizeFiles = [];
  let limitExceeded = false;

  for (const file of Array.from(files ?? [])) {
    const fingerprint = getMessageAttachmentFingerprint(file);

    if (selectedFingerprints.has(fingerprint)) {
      duplicateFiles.push(file);
      continue;
    }

    if (!allowedMimeTypes.has(file?.type)) {
      unsupportedFiles.push(file);
      continue;
    }

    if (!Number.isFinite(file?.size) || file.size <= 0 || file.size > maxBytes) {
      invalidSizeFiles.push(file);
      continue;
    }

    if (currentAttachments.length + acceptedFiles.length >= maxCount) {
      limitExceeded = true;
      continue;
    }

    selectedFingerprints.add(fingerprint);
    acceptedFiles.push(file);
  }

  return {
    acceptedFiles,
    duplicateFiles,
    unsupportedFiles,
    invalidSizeFiles,
    limitExceeded,
  };
}
