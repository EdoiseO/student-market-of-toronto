import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  callMessageMutationWithReplay,
  getMessageOperationOutcome,
  isAmbiguousMessageMutationError,
  isStorageObjectAlreadyPresent,
} from "../src/lib/message-send-idempotency.mjs";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260816205747_message_send_idempotency_foundation.sql",
    import.meta.url,
  ),
  "utf8",
);
const thread = await readFile(
  new URL("../src/components/messages-thread.jsx", import.meta.url),
  "utf8",
);
const starter = await readFile(
  new URL("../src/components/start-conversation-button.jsx", import.meta.url),
  "utf8",
);

test("message foundation exposes only invoker wrappers over a fully revoked immutable ledger", () => {
  assert.match(migration, /create table message_send_private\.operations/i);
  assert.match(migration, /primary key \(sender_user_id_snapshot, operation_id\)/i);
  assert.match(migration, /status in \('pending', 'completed', 'aborted'\)/i);
  assert.match(migration, /revoke all on table message_send_private\.operations[\s\S]*service_role/i);
  assert.match(migration, /guard_message_send_operation_mutation/i);
  assert.match(migration, /message_send_operation_history_is_immutable/i);
  assert.match(migration, /function public\.send_conversation_message_idempotent[\s\S]*security invoker[\s\S]*begin atomic/i);
  assert.match(migration, /function public\.reserve_message_media_uploads_idempotent[\s\S]*security invoker[\s\S]*begin atomic/i);
  assert.match(migration, /function public\.abort_message_send_operation[\s\S]*security invoker[\s\S]*begin atomic/i);
  for (const implementation of ["reserve_uploads_impl", "send_impl", "abort_impl"]) {
    assert.match(
      migration,
      new RegExp(`grant execute on function message_send_private\\.${implementation}\\(uuid, uuid, text, jsonb\\)[\\s\\S]*to authenticated`, "i"),
    );
  }
  assert.doesNotMatch(migration, /grant usage on schema message_send_private/i);
  assert.match(migration, /if operation\.status = 'completed' then[\s\S]*return operation\.result/i);
  assert.match(migration, /message_send_operation_payload_conflict/i);
  assert.match(migration, /send_operation_sender_snapshot/i);
  assert.match(migration, /public\.send_conversation_message_with_attachments\(/i);
  assert.doesNotMatch(
    migration,
    /revoke execute on function public\.send_conversation_message_with_attachments/i,
  );
  assert.doesNotMatch(
    migration,
    /revoke execute on function public\.reserve_message_media_uploads\(uuid, jsonb\)/i,
  );
});

test("client retries only ambiguous responses and recognizes exact replay outcomes", async () => {
  let calls = 0;
  const result = await callMessageMutationWithReplay(async () => {
    calls += 1;
    return calls === 1
      ? { data: null, error: new TypeError("Failed to fetch") }
      : { data: { id: "message-1" }, error: null };
  });

  assert.equal(calls, 2);
  assert.equal(result.ambiguous, false);
  assert.deepEqual(getMessageOperationOutcome(result.data), {
    status: "completed",
    message: { id: "message-1" },
  });
  assert.equal(isAmbiguousMessageMutationError({ code: "23514", message: "check" }), false);
  assert.equal(isAmbiguousMessageMutationError({ status: 503, message: "gateway" }), true);
  assert.equal(isStorageObjectAlreadyPresent({ statusCode: 409 }), true);
  assert.deepEqual(
    getMessageOperationOutcome({
      status: "aborted",
      result: { status: "aborted", storage_paths: ["one"] },
    }),
    { status: "aborted", message: null, storagePaths: ["one"] },
  );
});

test("message UI preserves one intent across retries and never cleans up an ambiguous result", () => {
  for (const source of [thread, starter]) {
    assert.match(source, /createMessageSendOperationId/);
    assert.match(source, /callMessageMutationWithReplay/);
    assert.match(source, /send_conversation_message_idempotent/);
    assert.match(source, /abort_message_send_operation/);
  }

  assert.match(thread, /reserveMessageMediaUploadsIdempotent/);
  assert.match(thread, /setUnresolvedSendIntent\(intent\)/);
  assert.match(thread, /if \(sendResult\.ambiguous\)[\s\S]*setUnresolvedSendIntent\(intent\)/);
  assert.doesNotMatch(
    thread,
    /if \(sendResult\.ambiguous\)[\s\S]{0,300}\.remove\(/,
  );
  assert.match(thread, /cleanupAbortedSendIntent/);
  assert.match(thread, /outcome\.status === "completed"[\s\S]*commitCompletedSendIntent/);
  assert.match(starter, /setUnresolvedFirstMessageIntent\(intent\)/);
  assert.match(
    starter,
    /if \(sendResult\.ambiguous\)[\s\S]*setUnresolvedFirstMessageIntent\(intent\)[\s\S]*return;/,
  );
  assert.match(
    starter,
    /outcome\.status === "completed"[\s\S]*completeFirstMessageIntent/,
  );
  assert.match(
    starter,
    /from\("conversations"\)[\s\S]*\.delete\(\)[\s\S]*\.is\("last_message_at", null\)/,
  );
});
