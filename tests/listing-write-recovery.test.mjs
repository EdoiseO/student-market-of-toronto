import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  LISTING_WRITE_ACTIONS,
  clearListingWriteJournal,
  drainOwnedListingImageCleanup,
  hashListingWriteSignature,
  listingWriteJournalKey,
  prepareListingWriteJournal,
  readListingWriteJournal,
  writeListingWriteJournal,
} from "../src/lib/listing-write-recovery.mjs";

const recoveryMigrationUrl = new URL(
  "../supabase/migrations/20260816224214_stage6_listing_write_intent_recovery_foundation.sql",
  import.meta.url,
);

test("recovery SQL keeps global cleanup small and account retirement separately bounded", async () => {
  const sql = await readFile(recoveryMigrationUrl, "utf8");

  assert.match(sql, /p_actor_user_id is null and p_limit > 20/);
  assert.match(sql, /p_actor_user_id is not null and p_limit > 100/);
  assert.match(
    sql,
    /create or replace function public\.claim_listing_image_cleanup_tasks[\s\S]*security invoker/,
  );
  assert.match(
    sql,
    /create or replace function public\.claim_listing_account_cleanup_tasks[\s\S]*security invoker/,
  );
  assert.match(
    sql,
    /revoke all on function listing_action_private\.claim_listing_image_cleanup_tasks_impl[\s\S]*from public, anon, authenticated, service_role/,
  );
  assert.match(sql, /request_listing_id uuid/);
  assert.match(sql, /request_expected_content_revision bigint/);
  assert.match(
    sql,
    /intent_row\.request_listing_id is distinct from p_listing_id[\s\S]*intent_row\.request_expected_content_revision/,
  );
  assert.match(
    sql,
    /function public\.verify_owned_listing_reserved_upload[\s\S]*security invoker/,
  );
  assert.match(
    sql,
    /reservation_row\.state <> 'reserved'[\s\S]*object\.owner_id = actor_id::text[\s\S]*for key share/,
  );
  assert.match(sql, /function listing_action_private\.rearm_listing_image_cleanup_task/);
  assert.match(sql, /interval '24 hours'/);
  assert.match(sql, /interval '30 days'/);
  assert.match(sql, /interval '90 days'/);
});

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    snapshot: () => [...values.entries()],
  };
}

test("listing journal persists only opaque bounded recovery identifiers", async () => {
  const storage = memoryStorage();
  const key = listingWriteJournalKey(LISTING_WRITE_ACTIONS.create);
  const signatureHash = await hashListingWriteSignature(JSON.stringify({
    title: "Sensitive title",
    location: "Private pickup spot",
  }));
  const entry = writeListingWriteJournal(storage, key, {
    action: LISTING_WRITE_ACTIONS.create,
    operationId: "11111111-1111-4111-8111-111111111111",
    signatureHash,
    listingId: null,
    isPublishing: true,
  });

  assert.equal(readListingWriteJournal(storage, key).operationId, entry.operationId);
  const serialized = storage.snapshot()[0][1];
  assert.doesNotMatch(serialized, /Sensitive title|Private pickup spot|storage_path/i);
  assert.match(serialized, /^[{].*operationId.*signatureHash.*[}]$/);
  clearListingWriteJournal(storage, key, "22222222-2222-4222-8222-222222222222");
  assert.ok(readListingWriteJournal(storage, key));
  clearListingWriteJournal(storage, key, entry.operationId);
  assert.equal(readListingWriteJournal(storage, key), null);
});

test("changed payload reconciles and aborts the durable old intent before replacement", async () => {
  const storage = memoryStorage();
  const key = listingWriteJournalKey(LISTING_WRITE_ACTIONS.create);
  const oldHash = "a".repeat(64);
  const nextHash = "b".repeat(64);
  const oldOperation = "33333333-3333-4333-8333-333333333333";
  writeListingWriteJournal(storage, key, {
    action: LISTING_WRITE_ACTIONS.create,
    operationId: oldOperation,
    signatureHash: oldHash,
  });
  const calls = [];
  const supabase = {
    async rpc(name, payload) {
      calls.push([name, payload]);
      if (name === "get_owned_listing_write_intent") {
        return { data: { state: "in_progress", stage: "draft_created" }, error: null };
      }
      if (name === "abort_owned_listing_write_intent") {
        return { data: { state: "aborted", stage: "aborted" }, error: null };
      }
      if (name === "claim_owned_listing_image_cleanup_tasks") {
        return { data: [], error: null };
      }
      if (name === "begin_owned_listing_write_intent") {
        return { data: { state: "begun", stage: "begun" }, error: null };
      }
      throw new Error(`unexpected ${name}`);
    },
  };
  const prepared = await prepareListingWriteJournal({
    supabase,
    bucket: { remove: async () => ({ error: null }) },
    storage,
    key,
    action: LISTING_WRITE_ACTIONS.create,
    signatureHash: nextHash,
  });

  assert.equal(prepared.error, null);
  assert.notEqual(prepared.entry.operationId, oldOperation);
  assert.deepEqual(calls.map(([name]) => name), [
    "get_owned_listing_write_intent",
    "abort_owned_listing_write_intent",
    "claim_owned_listing_image_cleanup_tasks",
    "begin_owned_listing_write_intent",
  ]);
});

test("a completed intent is replayed only for the exact same payload", async () => {
  const storage = memoryStorage();
  const key = listingWriteJournalKey(LISTING_WRITE_ACTIONS.create);
  const oldOperation = "88888888-8888-4888-8888-888888888888";
  writeListingWriteJournal(storage, key, {
    action: LISTING_WRITE_ACTIONS.create,
    operationId: oldOperation,
    signatureHash: "c".repeat(64),
    isPublishing: false,
  });
  const calls = [];
  const supabase = {
    async rpc(name, payload) {
      calls.push([name, payload]);
      if (name === "get_owned_listing_write_intent") {
        return { data: { state: "committed", stage: "committed" }, error: null };
      }
      if (name === "claim_owned_listing_image_cleanup_tasks") {
        return { data: [], error: null };
      }
      if (name === "begin_owned_listing_write_intent") {
        return { data: { state: "begun", stage: "begun" }, error: null };
      }
      throw new Error(`unexpected ${name}`);
    },
  };
  const prepared = await prepareListingWriteJournal({
    supabase,
    bucket: { remove: async () => ({ error: null }) },
    storage,
    key,
    action: LISTING_WRITE_ACTIONS.create,
    signatureHash: "d".repeat(64),
    isPublishing: true,
  });

  assert.equal(prepared.error, null);
  assert.equal(prepared.previousCompleted, undefined);
  assert.notEqual(prepared.entry.operationId, oldOperation);
  assert.deepEqual(calls.map(([name]) => name), [
    "get_owned_listing_write_intent",
    "claim_owned_listing_image_cleanup_tasks",
    "begin_owned_listing_write_intent",
  ]);
});

test("cleanup treats lost Storage responses as committed only after DB proof", async () => {
  const task = {
    task_id: "44444444-4444-4444-8444-444444444444",
    storage_path: "owner/listing/attempt.webp",
    lease_token: "55555555-5555-4555-8555-555555555555",
  };
  let claimCount = 0;
  const calls = [];
  const supabase = {
    async rpc(name) {
      calls.push(name);
      if (name === "claim_owned_listing_image_cleanup_tasks") {
        claimCount += 1;
        return { data: claimCount === 1 ? [task] : [], error: null };
      }
      if (name === "complete_owned_listing_image_cleanup_task") {
        return { data: true, error: null };
      }
      throw new Error(`unexpected ${name}`);
    },
  };
  const result = await drainOwnedListingImageCleanup({
    supabase,
    bucket: {
      async remove() {
        throw new TypeError("Failed to fetch");
      },
    },
  });

  assert.deepEqual(result, { error: null, pending: false });
  assert.deepEqual(calls, [
    "claim_owned_listing_image_cleanup_tasks",
    "complete_owned_listing_image_cleanup_task",
  ]);
});

test("cleanup releases a lease when the object is still present", async () => {
  const calls = [];
  const supabase = {
    async rpc(name) {
      calls.push(name);
      if (name === "claim_owned_listing_image_cleanup_tasks") {
        return {
          data: [{
            task_id: "66666666-6666-4666-8666-666666666666",
            storage_path: "owner/listing/present.webp",
            lease_token: "77777777-7777-4777-8777-777777777777",
          }],
          error: null,
        };
      }
      if (name === "complete_owned_listing_image_cleanup_task") {
        return { data: null, error: { code: "55000", message: "still present" } };
      }
      if (name === "release_owned_listing_image_cleanup_task") {
        return { data: true, error: null };
      }
      throw new Error(`unexpected ${name}`);
    },
  };
  const result = await drainOwnedListingImageCleanup({
    supabase,
    bucket: { remove: async () => ({ error: { message: "remove denied" } }) },
  });

  assert.equal(result.pending, true);
  assert.equal(result.error.message, "still present");
  assert.deepEqual(calls, [
    "claim_owned_listing_image_cleanup_tasks",
    "complete_owned_listing_image_cleanup_task",
    "release_owned_listing_image_cleanup_task",
  ]);
});
