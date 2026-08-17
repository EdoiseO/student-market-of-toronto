export const OWNED_LISTING_STATUS_ACTIONS = Object.freeze({
  submitForReview: "submit_for_review",
  markSold: "mark_sold",
  reopenForReview: "reopen_for_review",
});

export function parseListingContentRevision(value) {
  const normalizedValue =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;

  return Number.isSafeInteger(normalizedValue) && normalizedValue > 0
    ? normalizedValue
    : null;
}

const LISTING_SUBMISSION_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

export function parseListingSubmissionTimestamp(value) {
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !LISTING_SUBMISSION_TIMESTAMP_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    return null;
  }

  // PostgreSQL timestamps can carry microseconds. Returning the original value
  // avoids the precision loss caused by a JavaScript Date round trip.
  return value;
}

export function isListingReviewRevisionConflict(error) {
  const message = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return error?.code === "40001" || message.includes("listing_review_revision_conflict");
}

export function isAmbiguousListingWriteError(error) {
  if (!error) {
    return false;
  }

  const status = Number(error.status ?? error.statusCode ?? 0);
  const code = String(error.code ?? "").toUpperCase();
  const name = String(error.name ?? "").toLowerCase();
  const message = String(error.message ?? "").toLowerCase();

  if (status >= 500 || (status === 0 && (name === "typeerror" || !code))) {
    return true;
  }

  return (
    code === "PGRST000" ||
    code === "PGRST001" ||
    code === "FETCH_ERROR" ||
    message.includes("failed to fetch") ||
    message.includes("network request failed") ||
    /(?:^|[\s:])load failed(?:$|[\s.])/.test(message)
  );
}

export async function replayAmbiguousListingWrite(call) {
  let firstResult;
  try {
    firstResult = await call();
  } catch (error) {
    firstResult = { data: null, error };
  }
  if (!firstResult?.error || !isAmbiguousListingWriteError(firstResult.error)) {
    return {
      ...firstResult,
      hadAmbiguousAttempt: false,
      attemptCount: 1,
    };
  }

  let secondResult;
  try {
    secondResult = await call();
  } catch (error) {
    secondResult = { data: null, error };
  }
  return {
    ...secondResult,
    hadAmbiguousAttempt: true,
    attemptCount: 2,
  };
}

export function hasConflictingUnresolvedListingWrite(pendingWrite, nextSignature) {
  return Boolean(
    pendingWrite?.unresolvedDbOperation &&
    pendingWrite.signature !== nextSignature,
  );
}

export function shouldRetainUnresolvedListingWrite(pendingWrite, operation, result) {
  return Boolean(
    result?.error &&
    (
      pendingWrite?.unresolvedDbOperation === operation ||
      result.hadAmbiguousAttempt ||
      isAmbiguousListingWriteError(result.error)
    )
  );
}

export function isStorageObjectAlreadyExistsError(error) {
  if (!error) {
    return false;
  }

  const status = Number(error.status ?? error.statusCode ?? 0);
  const code = String(error.code ?? error.error ?? "").toLowerCase();
  const message = String(error.message ?? "").toLowerCase();

  return (
    status === 409 ||
    code.includes("duplicate") ||
    code.includes("already_exists") ||
    message.includes("already exists") ||
    message.includes("duplicate")
  );
}

const LISTING_REQUIRED_FIELD_MAP = Object.freeze({
  title: "title",
  category: "category",
  price: "price",
  description: "description",
  condition: "condition",
  location: "campus",
  images: "photos",
});

export function parseListingRequiredFieldViolation(error) {
  const message = [error?.message, error?.details, error?.hint]
    .filter((value) => typeof value === "string")
    .join(" ");
  const match = message.match(/listing_required_fields_missing:([a-z,]+)/i);

  if (!match) {
    return [];
  }

  return [...new Set(
    match[1]
      .toLowerCase()
      .split(",")
      .map((field) => LISTING_REQUIRED_FIELD_MAP[field])
      .filter(Boolean),
  )];
}

export async function uploadListingImageBatch({
  bucket,
  files,
  getStoragePath,
  uploadState = {},
  verifyExistingUpload,
}) {
  uploadState.plannedImages ??= files.map((file, index) => {
    const storagePath = getStoragePath(file, index);
    const { data: publicUrlData } = bucket.getPublicUrl(storagePath);
    return {
      file,
      storagePath,
      imageUrl: publicUrlData.publicUrl,
    };
  });
  uploadState.attemptedPaths ??= [];
  uploadState.completedPaths ??= [];
  uploadState.ambiguousPaths ??= [];

  for (const image of uploadState.plannedImages) {
    if (uploadState.completedPaths.includes(image.storagePath)) {
      continue;
    }

    if (!uploadState.attemptedPaths.includes(image.storagePath)) {
      // Record the path before awaiting Storage. A committed upload whose HTTP
      // response is lost must remain discoverable and removable by the caller.
      uploadState.attemptedPaths.push(image.storagePath);
    }

    let uploadResult;
    try {
      uploadResult = await bucket.upload(image.storagePath, image.file, {
        cacheControl: "3600",
        upsert: false,
      });
    } catch (error) {
      uploadResult = { error };
    }

    let uploadError = uploadResult?.error;
    if (uploadError && isAmbiguousListingWriteError(uploadError)) {
      if (!uploadState.ambiguousPaths.includes(image.storagePath)) {
        uploadState.ambiguousPaths.push(image.storagePath);
      }
      try {
        uploadResult = await bucket.upload(image.storagePath, image.file, {
          cacheControl: "3600",
          upsert: false,
        });
      } catch (error) {
        uploadResult = { error };
      }
      uploadError = uploadResult?.error;
    }

    if (uploadError && isStorageObjectAlreadyExistsError(uploadError)) {
      // Memory is not authoritative across reloads or tabs. A duplicate is
      // safe only when the database proves the current actor owns both the
      // active operation reservation and the exact Storage object.
      const verified = typeof verifyExistingUpload === "function"
        ? await verifyExistingUpload(image.storagePath)
        : false;
      if (!verified) throw uploadError;
      uploadError = null;
    }
    if (uploadError) throw uploadError;

    if (!uploadState.completedPaths.includes(image.storagePath)) {
      uploadState.completedPaths.push(image.storagePath);
    }
  }

  return uploadState.plannedImages.map(({ storagePath, imageUrl }) => ({
    storagePath,
    imageUrl,
  }));
}

export async function cleanupAttemptedListingImageUploads({ bucket, uploadState }) {
  const attemptedPaths = [...new Set(uploadState?.attemptedPaths ?? [])];
  if (attemptedPaths.length === 0) {
    return { error: null };
  }

  let cleanupResult;
  try {
    cleanupResult = await bucket.remove(attemptedPaths);
  } catch (error) {
    cleanupResult = { error };
  }

  if (cleanupResult?.error) {
    return cleanupResult;
  }

  uploadState.attemptedPaths = [];
  uploadState.completedPaths = [];
  uploadState.ambiguousPaths = [];
  uploadState.plannedImages = null;
  return { error: null };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseListingStoragePaths(value) {
  if (!Array.isArray(value) || value.length > 10) {
    return null;
  }
  const storagePaths = value.filter((path) => (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= 1024 &&
    !path.includes("\\") &&
    !path.includes("?") &&
    !path.includes("#") &&
    path.split("/").length === 3
  ));
  return storagePaths.length === value.length ? [...new Set(storagePaths)] : null;
}

export function parseRetiredListingResult(value, expectedListingId = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const listingId = typeof value.listing_id === "string" ? value.listing_id : "";
  if (
    !UUID_PATTERN.test(listingId) ||
    (expectedListingId && listingId !== expectedListingId) ||
    !Array.isArray(value.storage_paths)
  ) {
    return null;
  }

  const storagePaths = parseListingStoragePaths(value.storage_paths);
  if (!storagePaths) {
    return null;
  }

  return {
    listingId,
    storagePaths: [...new Set(storagePaths)],
  };
}

export function parseListingImageEditResult(value, expectedListingId = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const listingId = typeof value.listing_id === "string" ? value.listing_id : "";
  const contentRevision = parseListingContentRevision(value.content_revision);
  const removedStoragePaths = parseListingStoragePaths(value.removed_storage_paths);
  if (
    !UUID_PATTERN.test(listingId) ||
    (expectedListingId && listingId !== expectedListingId) ||
    contentRevision === null ||
    !removedStoragePaths
  ) {
    return null;
  }
  return { listingId, contentRevision, removedStoragePaths };
}

export async function cleanupListingStorageObjects({ bucket, cleanupState }) {
  const storagePaths = [...new Set(cleanupState?.storagePaths ?? [])];
  if (storagePaths.length === 0) {
    if (cleanupState) cleanupState.cleanupPending = false;
    return { error: null };
  }

  let cleanupResult;
  try {
    cleanupResult = await bucket.remove(storagePaths);
  } catch (error) {
    cleanupResult = { error };
  }
  if (cleanupResult?.error) {
    return cleanupResult;
  }

  cleanupState.storagePaths = [];
  cleanupState.cleanupPending = false;
  return { error: null };
}

export async function cleanupRetiredListingImageObjects({ bucket, retirementState }) {
  return cleanupListingStorageObjects({ bucket, cleanupState: retirementState });
}
