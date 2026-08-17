import assert from "node:assert/strict";
import test from "node:test";

import {
  enqueueAnnouncementAudience,
  finalizeAnnouncementIfTerminal,
  runAnnouncementDeliveryWorker,
  runAnnouncementWorkerPass,
} from "../src/lib/announcement-delivery-worker.mjs";

function createRpcClient(responsesByName) {
  const calls = [];

  return {
    calls,
    admin: {
      async rpc(name, args = {}) {
        calls.push({ name, args });
        const queue = responsesByName[name] ?? [];
        const response = queue.shift();

        if (response instanceof Error) {
          return { data: null, error: { message: response.message } };
        }

        return response ?? { data: [], error: null };
      },
    },
  };
}

test("audience enqueue follows bounded cursors and stops when exhausted", async () => {
  const { admin, calls } = createRpcClient({
    enqueue_announcement_audience_batch: [
      {
        data: [{ enqueued_count: 100, next_cursor: "cursor-1", exhausted: false }],
        error: null,
      },
      {
        data: [{ enqueued_count: 7, next_cursor: null, exhausted: true }],
        error: null,
      },
    ],
  });

  const result = await enqueueAnnouncementAudience({
    admin,
    announcementId: "announcement-1",
  });

  assert.deepEqual(result, { enqueuedCount: 107, exhausted: true, nextCursor: null });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].args.p_batch_size, 100);
  assert.equal("p_after_recipient_id" in calls[1].args, false);
});

test("terminalization delegates status choice to the atomic worker RPC", async () => {
  const { admin, calls } = createRpcClient({
    finalize_announcement_worker: [
      { data: [{ id: "announcement-failed", status: "partially_failed" }], error: null },
    ],
  });

  const result = await finalizeAnnouncementIfTerminal({
    admin,
    announcementId: "announcement-failed",
  });
  const finalize = calls.find(({ name }) => name === "finalize_announcement_worker");

  assert.deepEqual(result, { finalized: true, status: "partially_failed" });
  assert.equal(finalize.args.p_announcement_id, "announcement-failed");
});

test("nonterminal work is never finalized", async () => {
  const { admin, calls } = createRpcClient({
    finalize_announcement_worker: [
      new Error("announcement_deliveries_are_not_terminal"),
    ],
  });

  assert.deepEqual(
    await finalizeAnnouncementIfTerminal({
      admin,
      announcementId: "announcement-pending",
    }),
    { finalized: false, status: "sending" },
  );
  assert.equal(calls.some(({ name }) => name === "transition_announcement"), false);
});

test("worker reaps, claims, and uses only the atomic in-app RPC", async () => {
  const { admin, calls } = createRpcClient({
    reap_expired_announcement_delivery_lease: [
      { data: [{ delivery_id: "expired" }], error: null },
      { data: [], error: null },
    ],
    claim_announcement_delivery: [
      {
        data: [
          {
            delivery_id: "delivery-1",
            lease_token: "lease-1",
            send_in_app: true,
            send_email: false,
          },
        ],
        error: null,
      },
      { data: [], error: null },
    ],
    deliver_announcement_in_app: [
      {
        data: [
          {
            delivery_id: "delivery-1",
            delivery_status: "delivered",
            queue_status: "completed",
            idempotent_replay: false,
          },
        ],
        error: null,
      },
    ],
  });

  const result = await runAnnouncementDeliveryWorker({ admin });

  assert.deepEqual(result, {
    reapedCount: 1,
    claimedCount: 1,
    deliveredCount: 1,
    failedCount: 0,
    replayCount: 0,
    deliveryErrorCount: 0,
  });
  assert.deepEqual(
    calls.map(({ name }) => name),
    [
      "reap_expired_announcement_delivery_lease",
      "reap_expired_announcement_delivery_lease",
      "claim_announcement_delivery",
      "deliver_announcement_in_app",
      "claim_announcement_delivery",
    ],
  );
});

test("worker records a generic retry without leaking an internal RPC error", async () => {
  const { admin, calls } = createRpcClient({
    reap_expired_announcement_delivery_lease: [{ data: [], error: null }],
    claim_announcement_delivery: [
      {
        data: [
          {
            delivery_id: "delivery-2",
            lease_token: "lease-2",
            send_in_app: true,
            send_email: false,
          },
        ],
        error: null,
      },
      { data: [], error: null },
    ],
    deliver_announcement_in_app: [new Error("sensitive database detail")],
    finish_announcement_delivery: [{ data: [{ delivery_id: "delivery-2" }], error: null }],
  });

  const result = await runAnnouncementDeliveryWorker({ admin });
  const finishCall = calls.find(({ name }) => name === "finish_announcement_delivery");

  assert.equal(result.failedCount, 1);
  assert.equal(result.deliveryErrorCount, 1);
  assert.equal(finishCall.args.p_error, "announcement_in_app_delivery_failed");
  assert.doesNotMatch(JSON.stringify(finishCall.args), /sensitive database detail/);
});

test("one campaign failure does not abort later enqueue or finalization work", async () => {
  const { admin, calls } = createRpcClient({
    claim_announcement_worker_batch: [
      {
        data: [
          { announcement_id: "announcement-stuck" },
          { announcement_id: "announcement-urgent" },
        ],
        error: null,
      },
    ],
    enqueue_announcement_audience_batch: [
      new Error("first campaign failed"),
      { data: [{ enqueued_count: 2, next_cursor: null, exhausted: true }], error: null },
    ],
    reap_expired_announcement_delivery_lease: [{ data: [], error: null }],
    claim_announcement_delivery: [{ data: [], error: null }],
    finalize_announcement_worker: [
      new Error("announcement_audience_is_not_exhausted"),
      { data: [{ id: "announcement-urgent", status: "sent" }], error: null },
    ],
  });

  const result = await runAnnouncementWorkerPass({ admin, maxAnnouncements: 2 });

  assert.equal(result.campaignErrorCount, 1);
  assert.equal(result.enqueuedCount, 2);
  assert.equal(result.finalizedCount, 1);
  assert.equal(
    calls.filter(({ name }) => name === "enqueue_announcement_audience_batch").length,
    2,
  );
  assert.equal(
    calls.filter(({ name }) => name === "finalize_announcement_worker").length,
    2,
  );
});

test("worker fails closed for unsupported email or mixed-channel jobs", async () => {
  const { admin, calls } = createRpcClient({
    reap_expired_announcement_delivery_lease: [{ data: [], error: null }],
    claim_announcement_delivery: [
      {
        data: [
          {
            delivery_id: "delivery-email",
            lease_token: "lease-email",
            send_in_app: true,
            send_email: true,
          },
        ],
        error: null,
      },
      { data: [], error: null },
    ],
    finish_announcement_delivery: [{ data: [{ delivery_id: "delivery-email" }], error: null }],
  });

  const result = await runAnnouncementDeliveryWorker({ admin });

  assert.equal(result.deliveredCount, 0);
  assert.equal(result.failedCount, 1);
  assert.equal(
    calls.filter(({ name }) => name === "deliver_announcement_in_app").length,
    0,
  );
});
