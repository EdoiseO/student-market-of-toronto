import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260816081918_atomic_announcement_delivery_cutover.sql",
    import.meta.url,
  ),
  "utf8",
);

test("atomic delivery uses the canonical lock and lease boundary", () => {
  assert.match(migration, /function private\.deliver_announcement_in_app_impl/);
  assert.match(
    migration,
    /for update of announcement[\s\S]*?announcement_deliveries[\s\S]*?for update[\s\S]*?announcement_delivery_outbox[\s\S]*?for update/i,
  );
  assert.match(migration, /current_announcement\.status <> 'sending'/);
  assert.match(migration, /current_outbox\.lease_token is distinct from p_lease_token/);
  assert.match(migration, /current_outbox\.lease_expires_at <= delivered_at_value/);
  assert.match(migration, /current_delivery\.recipient_user_id is null/);
});

test("compatibility outputs and durable finalization share one transaction", () => {
  for (const table of [
    "conversations",
    "messages",
    "notifications",
    "conversation_user_state",
    "announcement_deliveries",
    "announcement_delivery_outbox",
  ]) {
    assert.match(migration, new RegExp(`(?:insert into|update) public\\.${table}`));
  }
  assert.match(
    migration,
    /set_config\('smot\.conversation_write_scope', 'announcement_delivery', true\)/,
  );
  assert.match(
    migration,
    /set_config\('smot\.conversation_write_scope', '', true\)/,
  );
  assert.match(migration, /listing_id[\s\S]*?null/);
  assert.match(migration, /completed_lease_token = p_lease_token/);
  assert.match(migration, /idempotent_replay/);
  assert.match(migration, /'announcement', output_conversation_id, output_message_id/);
  assert.match(migration, /announcement is an always-on in-app system notice/i);
});

test("service wrappers are narrow and recipient roles cannot call them", () => {
  for (const rpc of [
    "enqueue_announcement_audience_batch",
    "deliver_announcement_in_app",
  ]) {
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${rpc}\\([\\s\\S]*?to service_role`, "i"),
    );
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${rpc}\\([\\s\\S]*?from public, anon, authenticated, service_role`, "i"),
    );
  }
  assert.doesNotMatch(
    migration,
    /grant (?:insert|update|delete|all)[^;]*announcement_delivery_outbox[^;]*service_role/i,
  );
});

test("audience and worker activation are bounded and email fails closed", () => {
  assert.match(migration, /p_batch_size not between 1 and 100/);
  assert.match(migration, /limit p_batch_size \+ 1/);
  assert.match(migration, /create table public\.announcement_dispatch_state/);
  assert.match(migration, /audience_cutoff_at timestamptz not null/);
  assert.match(migration, /current_announcement\.sending_started_at/);
  assert.match(migration, /join auth\.users auth_user on auth_user\.id = profile\.id/);
  assert.doesNotMatch(migration, /left join auth\.users auth_user/);
  assert.match(migration, /profile\.created_at <= dispatch_state\.audience_cutoff_at/);
  assert.match(migration, /announcement_email_worker_not_configured/);
  assert.match(migration, /announcement_mixed_channel_worker_not_configured/);
  assert.match(migration, /announcement_case_audience_not_configured/);
});

test("terminal state requires exhausted audience and canonical terminal pairs", () => {
  assert.match(migration, /function public\.get_announcement_terminal_state/);
  assert.match(migration, /coalesce\(dispatch\.audience_exhausted, false\)/);
  for (const pair of [
    "delivery.status = 'delivered' and outbox.queue_status = 'completed'",
    "delivery.status = 'failed' and outbox.queue_status = 'dead'",
    "delivery.status = 'skipped' and outbox.queue_status = 'completed'",
    "delivery.status = 'cancelled' and outbox.queue_status = 'cancelled'",
  ]) {
    assert.match(migration, new RegExp(pair.replace(/[()]/g, "\\$&")));
  }
});
