import assert from "node:assert/strict";
import test from "node:test";

import {
  processListingImageCleanupClaims,
  retireListingMediaForAccount,
  runListingImageCleanupWorkerPass,
} from "../src/lib/listing-image-cleanup-worker.mjs";

const actorId = "11111111-1111-4111-8111-111111111111";
const otherActorId = "55555555-5555-4555-8555-555555555555";
const listingId = "22222222-2222-4222-8222-222222222222";
const operationId = actorId;

function claim(index = 1, overrides = {}) {
  return {
    task_id: `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`,
    actor_user_id_snapshot: actorId,
    storage_path: `${actorId}/${listingId}/image-${index}.webp`,
    lease_token: `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`,
    lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    reason: "abandoned_upload",
    ...overrides,
  };
}

function createAdmin({ responses = {}, removeError = null } = {}) {
  const calls = [];
  const removedBatches = [];

  return {
    calls,
    removedBatches,
    admin: {
      async rpc(name, args = {}) {
        calls.push({ name, args });
        const queue = responses[name] ?? [];
        const response = queue.shift();

        if (response instanceof Error) {
          return { data: null, error: { message: response.message } };
        }

        return response ?? { data: null, error: null };
      },
      storage: {
        from(bucket) {
          assert.equal(bucket, "listing-images");
          return {
            async remove(paths) {
              removedBatches.push(paths);
              return removeError
                ? { data: null, error: { message: removeError } }
                : { data: paths.map((name) => ({ name })), error: null };
            },
          };
        },
      },
    },
  };
}

test("worker maintenance, claim, Storage deletion, and completion stay bounded", async () => {
  const firstClaim = claim();
  const { admin, calls, removedBatches } = createAdmin({
    responses: {
      maintain_listing_write_recovery: [
        {
          data: {
            expired_reservations_enqueued: 2,
            scrubbed_intents: 1,
            compacted_commands: 3,
          },
          error: null,
        },
      ],
      maintain_stage7_security_ledgers: [
        {
          data: {
            message_scrubbed: 4,
            message_deleted: 1,
            report_scrubbed: 2,
            report_deleted: 1,
          },
          error: null,
        },
      ],
      claim_listing_image_cleanup_tasks: [{ data: [firstClaim], error: null }],
      complete_listing_image_cleanup_task: [{ data: true, error: null }],
    },
  });

  const result = await runListingImageCleanupWorkerPass({
    admin,
    cleanupLimit: 999,
    maintenanceLimit: 999,
  });

  assert.deepEqual(result, {
    expiredReservationsEnqueued: 2,
    scrubbedIntents: 1,
    compactedCommands: 3,
    securityLedgerMaintenance: {
      message_scrubbed: 4,
      message_deleted: 1,
      report_scrubbed: 2,
      report_deleted: 1,
    },
    maintenanceErrorCount: 0,
    claimedCount: 1,
    cleanedCount: 1,
    failedCount: 0,
    invalidCount: 0,
    releasedCount: 0,
    releaseErrorCount: 0,
  });
  assert.deepEqual(removedBatches, [[firstClaim.storage_path]]);
  assert.deepEqual(calls.slice(0, 3), [
    { name: "maintain_listing_write_recovery", args: { p_limit: 100 } },
    { name: "maintain_stage7_security_ledgers", args: { p_limit: 100 } },
    { name: "claim_listing_image_cleanup_tasks", args: { p_limit: 20 } },
  ]);
  assert.deepEqual(calls[3], {
    name: "complete_listing_image_cleanup_task",
    args: {
      p_task_id: firstClaim.task_id,
      p_lease_token: firstClaim.lease_token,
    },
  });
});

test("a Storage failure releases every lease without completing a task", async () => {
  const claims = [claim(1), claim(2)];
  const { admin, calls } = createAdmin({
    removeError: "provider unavailable",
    responses: {
      release_listing_image_cleanup_task: [
        { data: true, error: null },
        { data: true, error: null },
      ],
    },
  });

  const result = await processListingImageCleanupClaims({ admin, claims });

  assert.equal(result.cleanedCount, 0);
  assert.equal(result.failedCount, 2);
  assert.equal(result.releasedCount, 2);
  assert.equal(
    calls.some(({ name }) => name === "complete_listing_image_cleanup_task"),
    false,
  );
  assert.deepEqual(
    calls.filter(({ name }) => name === "release_listing_image_cleanup_task").map(
      ({ args }) => args.p_retry_after_seconds,
    ),
    [60, 60],
  );
});

test("unsafe or duplicate claimed paths are never sent to Storage", async () => {
  const duplicateA = claim(1);
  const duplicateB = claim(2, { storage_path: duplicateA.storage_path });
  const unsafe = claim(3, { storage_path: `${actorId}/${listingId}/../victim.webp` });
  const expired = claim(4, { lease_expires_at: "2000-01-01T00:00:00.000Z" });
  const { admin, removedBatches } = createAdmin({
    responses: {
      release_listing_image_cleanup_task: [
        { data: true, error: null },
        { data: true, error: null },
        { data: true, error: null },
        { data: true, error: null },
      ],
    },
  });

  const result = await processListingImageCleanupClaims({
    admin,
    claims: [duplicateA, duplicateB, unsafe, expired],
  });

  assert.equal(result.invalidCount, 4);
  assert.equal(result.failedCount, 4);
  assert.equal(result.releasedCount, 4);
  assert.deepEqual(removedBatches, []);
});

test("account deletion accepts a safe historical owned path outside the modern layout", async () => {
  const historical = claim(7, {
    reason: "account_deleted",
    storage_path: `${actorId}/legacy-cover.webp`,
  });
  const { admin, calls, removedBatches } = createAdmin({
    responses: {
      complete_listing_image_cleanup_task: [{ data: true, error: null }],
    },
  });

  const result = await processListingImageCleanupClaims({
    admin,
    claims: [historical],
    expectedAccountActorId: actorId,
  });

  assert.equal(result.cleanedCount, 1);
  assert.deepEqual(removedBatches, [[historical.storage_path]]);
  assert.equal(calls.at(-1).name, "complete_listing_image_cleanup_task");
});

test("account deletion denies a historical path outside the claimed actor namespace", async () => {
  const unrelated = claim(8, {
    reason: "account_deleted",
    storage_path: `${otherActorId}/legacy-cover.webp`,
  });
  const foreignClaim = claim(9, {
    actor_user_id_snapshot: otherActorId,
    reason: "account_deleted",
    storage_path: `${otherActorId}/owned-by-someone-else.webp`,
  });
  const { admin, removedBatches } = createAdmin({
    responses: {
      release_listing_image_cleanup_task: [
        { data: true, error: null },
        { data: true, error: null },
      ],
    },
  });

  const result = await processListingImageCleanupClaims({
    admin,
    claims: [unrelated, foreignClaim],
    expectedAccountActorId: actorId,
  });

  assert.equal(result.invalidCount, 2);
  assert.equal(result.releasedCount, 2);
  assert.deepEqual(removedBatches, []);
});

test("historical cleanup rejects traversal, empty, query, encoded, and control ambiguity", async () => {
  const unsafePaths = [
    `${actorId}/../victim.webp`,
    `${actorId}//victim.webp`,
    `${actorId}/folder\\victim.webp`,
    `${actorId}/victim.webp?download=1`,
    `${actorId}/victim%2Fnested.webp`,
    `${actorId}/victim.webp#fragment`,
    `${actorId}/victim\n.webp`,
    `${actorId}/legacy-two-segment.webp`,
  ];
  const unsafeClaims = unsafePaths.map((storagePath, index) =>
    claim(index + 10, {
      reason: index === unsafePaths.length - 1 ? "edit_removed" : "account_deleted",
      storage_path: storagePath,
    }),
  );
  const { admin, removedBatches } = createAdmin({
    responses: {
      release_listing_image_cleanup_task: unsafeClaims.map(() => ({
        data: true,
        error: null,
      })),
    },
  });

  const result = await processListingImageCleanupClaims({
    admin,
    claims: unsafeClaims,
    expectedAccountActorId: actorId,
  });

  assert.equal(result.invalidCount, unsafeClaims.length);
  assert.equal(result.releasedCount, unsafeClaims.length);
  assert.deepEqual(removedBatches, []);
});

test("maintenance errors do not strand cleanup work already queued", async () => {
  const firstClaim = claim();
  const { admin } = createAdmin({
    responses: {
      maintain_listing_write_recovery: [new Error("maintenance failed")],
      claim_listing_image_cleanup_tasks: [{ data: [firstClaim], error: null }],
      complete_listing_image_cleanup_task: [{ data: true, error: null }],
    },
  });

  const result = await runListingImageCleanupWorkerPass({ admin });

  assert.equal(result.maintenanceErrorCount, 1);
  assert.equal(result.cleanedCount, 1);
});

test("account retirement drains only its scoped queue and finalizes exact replay key", async () => {
  const firstClaim = claim(1, { reason: "account_deleted" });
  const { admin, calls } = createAdmin({
    responses: {
      prepare_listing_account_retirement: [
        {
          data: {
            actor_user_id: actorId,
            operation_id: operationId,
            state: "cleanup_pending",
            cleanup_task_count: 1,
          },
          error: null,
        },
      ],
      claim_listing_account_cleanup_tasks: [
        { data: [firstClaim], error: null },
        { data: [], error: null },
      ],
      complete_listing_image_cleanup_task: [{ data: true, error: null }],
      finalize_listing_account_retirement: [
        {
          data: {
            actor_user_id: actorId,
            operation_id: operationId,
            state: "complete",
            completed_at: "2026-08-16T23:00:00.000Z",
          },
          error: null,
        },
      ],
    },
  });

  const result = await retireListingMediaForAccount({ admin, userId: actorId });

  assert.deepEqual(result, {
    preparedState: "cleanup_pending",
    claimedCount: 1,
    cleanedCount: 1,
    completedAt: "2026-08-16T23:00:00.000Z",
  });
  assert.deepEqual(calls[0], {
    name: "prepare_listing_account_retirement",
    args: { p_actor_user_id: actorId, p_operation_id: actorId },
  });
  assert.equal(
    calls.filter(({ name }) => name === "claim_listing_account_cleanup_tasks").length,
    2,
  );
  assert.deepEqual(calls.at(-1), {
    name: "finalize_listing_account_retirement",
    args: { p_actor_user_id: actorId, p_operation_id: actorId },
  });
});

test("account retirement refuses to finalize after partial cleanup", async () => {
  const { admin, calls } = createAdmin({
    removeError: "provider unavailable",
    responses: {
      prepare_listing_account_retirement: [
        {
          data: {
            actor_user_id: actorId,
            operation_id: operationId,
            state: "cleanup_pending",
            cleanup_task_count: 1,
          },
          error: null,
        },
      ],
      claim_listing_account_cleanup_tasks: [{ data: [claim()], error: null }],
      release_listing_image_cleanup_task: [{ data: true, error: null }],
    },
  });

  await assert.rejects(
    retireListingMediaForAccount({ admin, userId: actorId }),
    /listing_account_cleanup_worker_failed/,
  );
  assert.equal(
    calls.some(({ name }) => name === "finalize_listing_account_retirement"),
    false,
  );
});

test("a completed retirement replay skips the cleanup claim boundary", async () => {
  const { admin, calls } = createAdmin({
    responses: {
      prepare_listing_account_retirement: [
        {
          data: {
            actor_user_id: actorId,
            operation_id: operationId,
            state: "ready",
            cleanup_task_count: 0,
          },
          error: null,
        },
      ],
      finalize_listing_account_retirement: [
        {
          data: {
            actor_user_id: actorId,
            operation_id: operationId,
            state: "complete",
            completed_at: "2026-08-16T23:00:00.000Z",
          },
          error: null,
        },
      ],
    },
  });

  const result = await retireListingMediaForAccount({ admin, userId: actorId });

  assert.equal(result.preparedState, "ready");
  assert.equal(result.claimedCount, 0);
  assert.equal(
    calls.some(({ name }) => name === "claim_listing_account_cleanup_tasks"),
    false,
  );
  assert.equal(calls.at(-1).name, "finalize_listing_account_retirement");
});
