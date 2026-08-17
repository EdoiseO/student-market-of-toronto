export const LISTING_IMAGE_CLEANUP_BUCKET = "listing-images";
export const LISTING_IMAGE_CLEANUP_BATCH_SIZE = 20;
export const LISTING_IMAGE_CLEANUP_RETRY_SECONDS = 60;
export const LISTING_WRITE_MAINTENANCE_LIMIT = 100;
export const LISTING_ACCOUNT_CLEANUP_BATCH_SIZE = 100;
export const LISTING_ACCOUNT_CLEANUP_MAX_BATCHES = 10;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLEANUP_REASONS = new Set([
  "abandoned_upload",
  "edit_removed",
  "listing_retired",
  "account_deleted",
]);

function clampInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, parsed));
}

function asRows(data) {
  if (data == null) {
    return [];
  }

  return Array.isArray(data) ? data : [data];
}

async function callRpc(admin, name, args = {}) {
  const { data, error } = await admin.rpc(name, args);

  if (error) {
    throw error;
  }

  return data;
}

function getSafeStoragePathSegments(storagePath) {
  if (
    typeof storagePath !== "string" ||
    storagePath.length < 3 ||
    storagePath.length > 1024 ||
    storagePath.includes("\\") ||
    storagePath.includes("%") ||
    storagePath.includes("?") ||
    storagePath.includes("#") ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(storagePath)
  ) {
    return null;
  }

  const segments = storagePath.split("/");

  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment.trim().length === 0 ||
        segment.trim() === "." ||
        segment.trim() === "..",
    )
  ) {
    return null;
  }

  return segments;
}

function isSafeListingImagePath(storagePath, actorUserId) {
  const segments = getSafeStoragePathSegments(storagePath);

  return (
    segments?.length === 3 &&
    segments[0] === actorUserId &&
    UUID_PATTERN.test(segments[0]) &&
    UUID_PATTERN.test(segments[1]) &&
    segments[2].length > 0
  );
}

function isSafeHistoricalAccountImagePath(storagePath, actorUserId) {
  const segments = getSafeStoragePathSegments(storagePath);

  return (
    segments?.length >= 2 &&
    UUID_PATTERN.test(actorUserId) &&
    segments[0] === actorUserId
  );
}

function normalizeCleanupClaim(row, expectedAccountActorId = null) {
  const leaseExpiresAt = Date.parse(row?.lease_expires_at ?? "");
  const actorUserId = row?.actor_user_id_snapshot;
  const reason = row?.reason;
  const pathIsSafe =
    reason === "account_deleted"
      ? isSafeHistoricalAccountImagePath(row?.storage_path, actorUserId)
      : isSafeListingImagePath(row?.storage_path, actorUserId);

  if (
    !row ||
    !UUID_PATTERN.test(row.task_id ?? "") ||
    !UUID_PATTERN.test(actorUserId ?? "") ||
    !UUID_PATTERN.test(row.lease_token ?? "") ||
    !pathIsSafe ||
    !CLEANUP_REASONS.has(reason) ||
    (expectedAccountActorId !== null && actorUserId !== expectedAccountActorId) ||
    !Number.isFinite(leaseExpiresAt) ||
    leaseExpiresAt <= Date.now()
  ) {
    return null;
  }

  return {
    taskId: row.task_id,
    actorUserId,
    storagePath: row.storage_path,
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at,
    reason: row.reason,
  };
}

async function releaseCleanupClaim(admin, claim, retryAfterSeconds) {
  const released = await callRpc(admin, "release_listing_image_cleanup_task", {
    p_task_id: claim.taskId,
    p_lease_token: claim.leaseToken,
    p_retry_after_seconds: retryAfterSeconds,
  });

  if (released !== true) {
    throw new Error("listing_cleanup_release_result_invalid");
  }
}

async function releaseCleanupClaims(admin, claims, retryAfterSeconds) {
  const results = await Promise.allSettled(
    claims.map((claim) => releaseCleanupClaim(admin, claim, retryAfterSeconds)),
  );

  return results.reduce(
    (summary, result) => {
      if (result.status === "fulfilled") {
        summary.releasedCount += 1;
      } else {
        summary.releaseErrorCount += 1;
      }

      return summary;
    },
    { releasedCount: 0, releaseErrorCount: 0 },
  );
}

export async function processListingImageCleanupClaims({
  admin,
  claims,
  retryAfterSeconds = LISTING_IMAGE_CLEANUP_RETRY_SECONDS,
  expectedAccountActorId = null,
}) {
  if (
    expectedAccountActorId !== null &&
    !UUID_PATTERN.test(expectedAccountActorId)
  ) {
    throw new Error("listing_account_retirement_identity_invalid");
  }

  const boundedRetryAfterSeconds = clampInteger(
    retryAfterSeconds,
    LISTING_IMAGE_CLEANUP_RETRY_SECONDS,
    15,
    3600,
  );
  const rows = asRows(claims);
  const taskCounts = new Map();
  const pathCounts = new Map();

  for (const row of rows) {
    if (typeof row?.task_id === "string") {
      taskCounts.set(row.task_id, (taskCounts.get(row.task_id) ?? 0) + 1);
    }
    if (typeof row?.storage_path === "string") {
      pathCounts.set(row.storage_path, (pathCounts.get(row.storage_path) ?? 0) + 1);
    }
  }

  const safeClaims = [];
  const releasableInvalidClaims = [];
  let invalidCount = 0;

  for (const row of rows) {
    const claim = normalizeCleanupClaim(row, expectedAccountActorId);
    const duplicate =
      (taskCounts.get(row?.task_id) ?? 0) !== 1 ||
      (pathCounts.get(row?.storage_path) ?? 0) !== 1;

    if (!claim || duplicate) {
      invalidCount += 1;
      if (
        UUID_PATTERN.test(row?.task_id ?? "") &&
        UUID_PATTERN.test(row?.lease_token ?? "")
      ) {
        releasableInvalidClaims.push({
          taskId: row.task_id,
          leaseToken: row.lease_token,
        });
      }
      continue;
    }

    safeClaims.push(claim);
  }

  const invalidRelease = await releaseCleanupClaims(
    admin,
    releasableInvalidClaims,
    boundedRetryAfterSeconds,
  );
  const summary = {
    claimedCount: rows.length,
    cleanedCount: 0,
    failedCount: invalidCount,
    invalidCount,
    releasedCount: invalidRelease.releasedCount,
    releaseErrorCount: invalidRelease.releaseErrorCount,
  };

  if (safeClaims.length === 0) {
    return summary;
  }

  let removalError = null;

  try {
    const { error } = await admin.storage
      .from(LISTING_IMAGE_CLEANUP_BUCKET)
      .remove(safeClaims.map((claim) => claim.storagePath));
    removalError = error ?? null;
  } catch (error) {
    removalError = error;
  }

  if (removalError) {
    const released = await releaseCleanupClaims(
      admin,
      safeClaims,
      boundedRetryAfterSeconds,
    );
    summary.failedCount += safeClaims.length;
    summary.releasedCount += released.releasedCount;
    summary.releaseErrorCount += released.releaseErrorCount;
    return summary;
  }

  const completionResults = await Promise.allSettled(
    safeClaims.map(async (claim) => {
      const completed = await callRpc(admin, "complete_listing_image_cleanup_task", {
        p_task_id: claim.taskId,
        p_lease_token: claim.leaseToken,
      });

      if (completed !== true) {
        throw new Error("listing_cleanup_completion_result_invalid");
      }

      return claim;
    }),
  );
  const failedCompletions = [];

  completionResults.forEach((result, index) => {
    if (result.status === "fulfilled") {
      summary.cleanedCount += 1;
    } else {
      summary.failedCount += 1;
      failedCompletions.push(safeClaims[index]);
    }
  });

  const released = await releaseCleanupClaims(
    admin,
    failedCompletions,
    boundedRetryAfterSeconds,
  );
  summary.releasedCount += released.releasedCount;
  summary.releaseErrorCount += released.releaseErrorCount;
  return summary;
}

function normalizeMaintenanceResult(data) {
  const row = Array.isArray(data) ? data[0] : data;
  const toCount = (value) => {
    const count = Number(value ?? 0);
    return Number.isSafeInteger(count) && count >= 0 ? count : 0;
  };

  return {
    expiredReservationsEnqueued: toCount(row?.expired_reservations_enqueued),
    scrubbedIntents: toCount(row?.scrubbed_intents),
    compactedCommands: toCount(row?.compacted_commands),
  };
}

export async function runListingImageCleanupWorkerPass({
  admin,
  cleanupLimit = LISTING_IMAGE_CLEANUP_BATCH_SIZE,
  maintenanceLimit = LISTING_WRITE_MAINTENANCE_LIMIT,
  retryAfterSeconds = LISTING_IMAGE_CLEANUP_RETRY_SECONDS,
}) {
  const boundedCleanupLimit = clampInteger(
    cleanupLimit,
    LISTING_IMAGE_CLEANUP_BATCH_SIZE,
    1,
    20,
  );
  const boundedMaintenanceLimit = clampInteger(
    maintenanceLimit,
    LISTING_WRITE_MAINTENANCE_LIMIT,
    1,
    100,
  );
  let maintenance = {
    expiredReservationsEnqueued: 0,
    scrubbedIntents: 0,
    compactedCommands: 0,
  };
  let maintenanceErrorCount = 0;

  try {
    maintenance = normalizeMaintenanceResult(
      await callRpc(admin, "maintain_listing_write_recovery", {
        p_limit: boundedMaintenanceLimit,
      }),
    );
  } catch {
    // Cleanup work already queued remains safe to process. The next pass can
    // retry bounded reservation expiry and command compaction independently.
    maintenanceErrorCount = 1;
  }

  const claims = await callRpc(admin, "claim_listing_image_cleanup_tasks", {
    p_limit: boundedCleanupLimit,
  });
  const cleanup = await processListingImageCleanupClaims({
    admin,
    claims,
    retryAfterSeconds,
  });

  return {
    ...maintenance,
    maintenanceErrorCount,
    ...cleanup,
  };
}

function validateAccountRetirementResult(data, userId, operationId, expectedState) {
  const row = Array.isArray(data) ? data[0] : data;
  const cleanupTaskCount = row?.cleanup_task_count;
  const stateDetailsAreValid =
    (row?.state === "ready" && cleanupTaskCount === 0) ||
    (row?.state === "cleanup_pending" &&
      Number.isSafeInteger(cleanupTaskCount) &&
      cleanupTaskCount > 0) ||
    (row?.state === "complete" &&
      Number.isFinite(Date.parse(row?.completed_at ?? "")));

  if (
    !row ||
    row.actor_user_id !== userId ||
    row.operation_id !== operationId ||
    !expectedState.has(row.state) ||
    !stateDetailsAreValid
  ) {
    throw new Error("listing_account_retirement_result_invalid");
  }

  return row;
}

export async function retireListingMediaForAccount({
  admin,
  userId,
  operationId = userId,
  maxBatches = LISTING_ACCOUNT_CLEANUP_MAX_BATCHES,
  batchSize = LISTING_ACCOUNT_CLEANUP_BATCH_SIZE,
}) {
  if (!UUID_PATTERN.test(userId ?? "") || !UUID_PATTERN.test(operationId ?? "")) {
    throw new Error("listing_account_retirement_identity_invalid");
  }

  const boundedMaxBatches = clampInteger(
    maxBatches,
    LISTING_ACCOUNT_CLEANUP_MAX_BATCHES,
    1,
    10,
  );
  const boundedBatchSize = clampInteger(
    batchSize,
    LISTING_ACCOUNT_CLEANUP_BATCH_SIZE,
    1,
    100,
  );
  const prepared = validateAccountRetirementResult(
    await callRpc(admin, "prepare_listing_account_retirement", {
      p_actor_user_id: userId,
      p_operation_id: operationId,
    }),
    userId,
    operationId,
    new Set(["cleanup_pending", "ready"]),
  );
  let claimedCount = 0;
  let cleanedCount = 0;

  for (
    let batch = 0;
    prepared.state === "cleanup_pending" && batch < boundedMaxBatches;
    batch += 1
  ) {
    const claims = asRows(
      await callRpc(admin, "claim_listing_account_cleanup_tasks", {
        p_actor_user_id: userId,
        p_operation_id: operationId,
        p_limit: boundedBatchSize,
      }),
    );

    if (claims.length === 0) {
      break;
    }

    const cleanup = await processListingImageCleanupClaims({
      admin,
      claims,
      expectedAccountActorId: userId,
    });
    claimedCount += cleanup.claimedCount;
    cleanedCount += cleanup.cleanedCount;

    if (
      cleanup.failedCount > 0 ||
      cleanup.releaseErrorCount > 0 ||
      cleanup.cleanedCount !== cleanup.claimedCount
    ) {
      throw new Error("listing_account_cleanup_worker_failed");
    }
  }

  const completed = validateAccountRetirementResult(
    await callRpc(admin, "finalize_listing_account_retirement", {
      p_actor_user_id: userId,
      p_operation_id: operationId,
    }),
    userId,
    operationId,
    new Set(["complete"]),
  );

  return {
    preparedState: prepared.state,
    claimedCount,
    cleanedCount,
    completedAt: completed.completed_at ?? null,
  };
}
