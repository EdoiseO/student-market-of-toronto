export const ANNOUNCEMENT_ENQUEUE_BATCH_SIZE = 100;
export const ANNOUNCEMENT_ROUTE_MAX_ENQUEUE_BATCHES = 5;
export const ANNOUNCEMENT_WORKER_MAX_DELIVERIES = 100;
export const ANNOUNCEMENT_WORKER_MAX_LEASE_REAPS = 100;
export const ANNOUNCEMENT_WORKER_LEASE_SECONDS = 60;
export const ANNOUNCEMENT_WORKER_MAX_ANNOUNCEMENTS = 5;

function firstRow(data) {
  return Array.isArray(data) ? (data[0] ?? null) : (data ?? null);
}

async function callRpc(admin, name, args = {}) {
  const { data, error } = await admin.rpc(name, args);

  if (error) {
    throw error;
  }

  return data;
}

function clampInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, parsed));
}

export async function enqueueAnnouncementAudience({
  admin,
  announcementId,
  batchSize = ANNOUNCEMENT_ENQUEUE_BATCH_SIZE,
  maxBatches = ANNOUNCEMENT_ROUTE_MAX_ENQUEUE_BATCHES,
  maxAttempts = 5,
}) {
  const boundedBatchSize = clampInteger(batchSize, ANNOUNCEMENT_ENQUEUE_BATCH_SIZE, 1, 100);
  const boundedMaxBatches = clampInteger(
    maxBatches,
    ANNOUNCEMENT_ROUTE_MAX_ENQUEUE_BATCHES,
    1,
    20,
  );
  const boundedMaxAttempts = clampInteger(maxAttempts, 5, 1, 20);
  let cursor = null;
  let enqueuedCount = 0;
  let exhausted = false;

  for (let batch = 0; batch < boundedMaxBatches && !exhausted; batch += 1) {
    const data = await callRpc(admin, "enqueue_announcement_audience_batch", {
      p_announcement_id: announcementId,
      p_batch_size: boundedBatchSize,
      p_max_attempts: boundedMaxAttempts,
    });
    const result = firstRow(data);

    if (!result) {
      exhausted = true;
      break;
    }

    enqueuedCount += Number(result.enqueued_count ?? 0);
    exhausted = Boolean(result.exhausted);
    cursor = result.next_cursor ?? null;

    if (!exhausted && !cursor) {
      throw new Error("announcement_enqueue_cursor_missing");
    }
  }

  return { enqueuedCount, exhausted, nextCursor: exhausted ? null : cursor };
}

async function claimAnnouncementWorkerBatch(admin, limit) {
  const data = await callRpc(admin, "claim_announcement_worker_batch", {
    p_limit: limit,
  });

  return (data ?? []).map(({ announcement_id: id }) => id).filter(Boolean);
}

export async function finalizeAnnouncementIfTerminal({ admin, announcementId }) {
  try {
    const transitioned = firstRow(
      await callRpc(admin, "finalize_announcement_worker", {
        p_announcement_id: announcementId,
      }),
    );

    return {
      finalized: Boolean(transitioned),
      status: transitioned?.status ?? "sending",
    };
  } catch (error) {
    if (
      /announcement_(?:audience_is_not_exhausted|deliveries_are_not_terminal)/.test(
        error?.message ?? "",
      )
    ) {
      return { finalized: false, status: "sending" };
    }

    throw error;
  }
}

export async function getAnnouncementTerminalState({ admin, announcementId }) {
  return firstRow(
    await callRpc(admin, "get_announcement_terminal_state", {
      p_announcement_id: announcementId,
    }),
  );
}

export async function runAnnouncementDeliveryWorker({
  admin,
  maxDeliveries = ANNOUNCEMENT_WORKER_MAX_DELIVERIES,
  maxLeaseReaps = ANNOUNCEMENT_WORKER_MAX_LEASE_REAPS,
  leaseSeconds = ANNOUNCEMENT_WORKER_LEASE_SECONDS,
}) {
  const boundedMaxDeliveries = clampInteger(
    maxDeliveries,
    ANNOUNCEMENT_WORKER_MAX_DELIVERIES,
    1,
    250,
  );
  const boundedMaxLeaseReaps = clampInteger(
    maxLeaseReaps,
    ANNOUNCEMENT_WORKER_MAX_LEASE_REAPS,
    0,
    250,
  );
  const boundedLeaseSeconds = clampInteger(
    leaseSeconds,
    ANNOUNCEMENT_WORKER_LEASE_SECONDS,
    15,
    900,
  );
  const summary = {
    reapedCount: 0,
    claimedCount: 0,
    deliveredCount: 0,
    failedCount: 0,
    replayCount: 0,
    deliveryErrorCount: 0,
  };

  for (let index = 0; index < boundedMaxLeaseReaps; index += 1) {
    const recovered = firstRow(
      await callRpc(admin, "reap_expired_announcement_delivery_lease"),
    );

    if (!recovered) {
      break;
    }

    summary.reapedCount += 1;
  }

  for (let index = 0; index < boundedMaxDeliveries; index += 1) {
    const claimed = firstRow(
      await callRpc(admin, "claim_announcement_delivery", {
        p_lease_seconds: boundedLeaseSeconds,
      }),
    );

    if (!claimed) {
      break;
    }

    summary.claimedCount += 1;

    try {
      if (!claimed.send_in_app || claimed.send_email) {
        throw new Error("announcement_delivery_channel_not_supported");
      }

      const delivered = firstRow(
        await callRpc(admin, "deliver_announcement_in_app", {
          p_delivery_id: claimed.delivery_id,
          p_lease_token: claimed.lease_token,
        }),
      );

      if (!delivered || delivered.delivery_status !== "delivered") {
        throw new Error("announcement_delivery_result_invalid");
      }

      summary.deliveredCount += 1;
      if (delivered.idempotent_replay) {
        summary.replayCount += 1;
      }
    } catch (deliveryError) {
      summary.failedCount += 1;
      summary.deliveryErrorCount += 1;

      try {
        await callRpc(admin, "finish_announcement_delivery", {
          p_delivery_id: claimed.delivery_id,
          p_lease_token: claimed.lease_token,
          p_succeeded: false,
          p_conversation_id: null,
          p_message_id: null,
          p_notification_id: null,
          p_error: "announcement_in_app_delivery_failed",
          p_retry_at: null,
        });
      } catch {
        // A lost lease or concurrent cancellation is resolved by the bounded
        // lease reaper on the next worker pass. Do not leak internal errors or
        // make an unvalidated direct table write here.
      }
    }
  }

  return summary;
}

export async function runAnnouncementWorkerPass({
  admin,
  maxAnnouncements = ANNOUNCEMENT_WORKER_MAX_ANNOUNCEMENTS,
  enqueueBatchSize = ANNOUNCEMENT_ENQUEUE_BATCH_SIZE,
  maxDeliveries = ANNOUNCEMENT_WORKER_MAX_DELIVERIES,
  maxLeaseReaps = ANNOUNCEMENT_WORKER_MAX_LEASE_REAPS,
  leaseSeconds = ANNOUNCEMENT_WORKER_LEASE_SECONDS,
}) {
  const boundedMaxAnnouncements = clampInteger(
    maxAnnouncements,
    ANNOUNCEMENT_WORKER_MAX_ANNOUNCEMENTS,
    1,
    20,
  );
  const initialAnnouncementIds = await claimAnnouncementWorkerBatch(
    admin,
    boundedMaxAnnouncements,
  );
  let enqueuedCount = 0;
  let campaignErrorCount = 0;

  for (const announcementId of initialAnnouncementIds) {
    try {
      const result = await enqueueAnnouncementAudience({
        admin,
        announcementId,
        batchSize: enqueueBatchSize,
        maxBatches: 1,
      });
      enqueuedCount += result.enqueuedCount;
    } catch {
      campaignErrorCount += 1;
    }
  }

  const delivery = await runAnnouncementDeliveryWorker({
    admin,
    maxDeliveries,
    maxLeaseReaps,
    leaseSeconds,
  });
  let finalizedCount = 0;
  let partiallyFailedCount = 0;

  for (const announcementId of initialAnnouncementIds) {
    try {
      const result = await finalizeAnnouncementIfTerminal({ admin, announcementId });

      if (result.finalized) {
        finalizedCount += 1;
        if (result.status === "partially_failed") {
          partiallyFailedCount += 1;
        }
      }
    } catch {
      campaignErrorCount += 1;
    }
  }

  return {
    announcementsScanned: initialAnnouncementIds.length,
    enqueuedCount,
    finalizedCount,
    partiallyFailedCount,
    campaignErrorCount,
    ...delivery,
  };
}
