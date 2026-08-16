import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260816090221_harden_announcement_worker_lifecycle.sql",
    import.meta.url,
  ),
  "utf8",
);
const [route, composer] = await Promise.all([
  readFile(new URL("../src/app/api/admin/announcements/route.js", import.meta.url), "utf8"),
  readFile(new URL("../src/components/admin-announcement-sheet.jsx", import.meta.url), "utf8"),
]);

test("senderless announcement output is narrow and remains readable", () => {
  assert.match(migration, /alter table public\.conversations alter column seller_id drop not null/i);
  assert.match(migration, /alter table public\.messages alter column sender_id drop not null/i);
  assert.match(migration, /listing_conversation_seller_required/);
  assert.match(migration, /senderless_announcement_conversation_requires_atomic_worker/);
  assert.match(migration, /output_conversation_id, null,[\s\S]*?recipient_user_id_snapshot, null/i);
  assert.match(migration, /output_message_id, output_conversation_id, null/);
  assert.match(migration, /message\.sender_id is distinct from current_user_id/);
  assert.match(migration, /sender_id is distinct from \(select auth\.uid\(\)\)/);
});

test("client command idempotency is durable and the route uses one atomic RPC", () => {
  assert.match(migration, /create table public\.announcement_send_commands/);
  assert.match(migration, /operation_id uuid primary key/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /announcement_operation_id_conflict/);
  assert.match(migration, /function public\.create_and_start_announcement/);
  assert.match(route, /create_and_start_announcement/);
  assert.doesNotMatch(route, /create_announcement_draft|transition_announcement/);
  assert.match(route, /UUID_PATTERN\.test\(operationId\)/);
  assert.match(composer, /operationIdRef/);
  assert.match(composer, /crypto\.randomUUID\(\)/);
  assert.match(composer, /operationId:\s*operationIdRef\.current/);
});

test("only the atomic worker finalizer can complete an exhausted campaign", () => {
  assert.match(migration, /function public\.finalize_announcement_worker/);
  assert.match(migration, /announcement_audience_is_not_exhausted/);
  assert.match(migration, /announcement_deliveries_are_not_terminal/);
  assert.match(migration, /announcement_worker_finalization_required/);
  assert.match(
    migration,
    /for update;[\s\S]*?announcement_deliveries[\s\S]*?for update;[\s\S]*?announcement_delivery_outbox[\s\S]*?for update of outbox/i,
  );
  assert.match(migration, /updated_by_snapshot, 'admin'/);
  assert.match(migration, /worker_finalized', true/);
});

test("worker selection rotates fairly and private implementations stay hidden", () => {
  assert.match(migration, /last_worker_attempt_at timestamptz/);
  assert.match(migration, /last_delivery_claimed_at timestamptz/);
  assert.match(migration, /coalesce\(dispatch\.last_worker_attempt_at, '-infinity'/);
  assert.match(migration, /when 'urgent' then 4/);
  assert.match(migration, /coalesce\(dispatch\.last_delivery_claimed_at, '-infinity'/);
  assert.match(migration, /revoke all on schema announcement_worker_private/);
  assert.match(migration, /language sql[\s\S]*?security invoker[\s\S]*?begin atomic/i);
  assert.doesNotMatch(migration, /grant usage on schema announcement_worker_private/);
});
