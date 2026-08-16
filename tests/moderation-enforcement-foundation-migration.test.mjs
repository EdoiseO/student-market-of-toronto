import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260816061431_moderation_enforcement_foundation.sql",
    import.meta.url,
  ),
  "utf8",
);

function section(start, end) {
  const startIndex = migration.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  const endIndex = migration.indexOf(end, startIndex);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return migration.slice(startIndex, endIndex);
}

test("moderation sanctions preserve durable actors, subjects, evidence, and review state", () => {
  assert.match(migration, /create table public\.moderation_sanctions/);
  assert.match(migration, /subject_user_id uuid references auth\.users\(id\) on delete set null/);
  assert.match(migration, /subject_user_id_snapshot uuid not null/);
  assert.match(migration, /issued_by_user_id_snapshot uuid/);
  assert.match(
    migration,
    /issued_by_role = 'system'[\s\S]*issued_by_user_id is null[\s\S]*issued_by_user_id_snapshot is null/,
  );
  assert.match(
    migration,
    /issued_by_role = any \(array\['admin', 'moderator'\][\s\S]*issued_by_user_id_snapshot is not null/,
  );
  assert.doesNotMatch(migration, /issued_by_role = any \(array\[[^\]]*'staff'/);
  assert.match(
    migration,
    /sanction_type = 'ban'[\s\S]*issued_by_role = any \(array\['admin', 'system'\]/,
  );
  assert.match(
    migration,
    /sanction_type = any \(array\['warning', 'strike'\][\s\S]*issued_by_role = any \(array\['admin', 'moderator', 'system'\]/,
  );
  assert.match(migration, /revoked_by_role text/);
  assert.match(migration, /reviewed_by_role text/);
  assert.match(migration, /severity = any \(array\['low', 'medium', 'high', 'critical'\]/);
  assert.match(migration, /jsonb_typeof\(restrictions\) = 'object'/);
  assert.match(migration, /related_resource_type text/);
  assert.match(migration, /related_resource_id uuid/);
  assert.match(
    migration,
    /supersedes_sanction_id uuid\s+references public\.moderation_sanctions\(id\) on delete restrict/,
  );
  assert.match(
    migration,
    /replacement_sanction_id uuid\s+references public\.moderation_sanctions\(id\) on delete restrict/,
  );
  assert.match(migration, /revocation_kind = any \(array\['revoked', 'overturned'\]/);
  assert.match(migration, /review_status = any \(array\['pending', 'upheld', 'modified', 'overturned'\]/);
  assert.match(migration, /review_outcome_message text/);
  assert.match(migration, /review_private_reason text/);
  assert.match(
    migration,
    /review_status = 'modified'[\s\S]*replacement_sanction_id is not null[\s\S]*revoked_at is not null[\s\S]*revocation_kind = 'revoked'/,
  );
  assert.match(migration, /create unique index moderation_sanctions_supersedes_uidx/);
  assert.match(migration, /create unique index moderation_sanctions_replacement_uidx/);
});

test("sanction lifecycle facts are immutable and review transitions advance once", () => {
  const lifecycle = section(
    "create or replace function private.enforce_moderation_sanction_lifecycle()",
    "create or replace function private.prevent_moderation_audit_event_mutation()",
  );

  assert.match(lifecycle, /before insert or update or delete/);
  assert.match(lifecycle, /moderation_sanctions_are_durable/);
  assert.match(lifecycle, /moderation_sanction_core_is_immutable/);
  assert.match(lifecycle, /moderation_sanction_lifecycle_must_start_empty/);
  assert.match(lifecycle, /moderation_sanction_human_issuer_is_required/);
  assert.match(lifecycle, /moderation_sanction_supersession_is_invalid/);
  assert.match(lifecycle, /moderation_sanction_modified_review_requires_replacement/);
  assert.match(lifecycle, /from auth\.users issuer/);
  assert.match(lifecycle, /moderation_sanction_acknowledgement_is_immutable/);
  assert.match(lifecycle, /moderation_sanction_revocation_is_immutable/);
  assert.match(lifecycle, /moderation_sanction_review_must_start_pending/);
  assert.match(lifecycle, /moderation_sanction_review_outcome_is_immutable/);
  assert.match(lifecycle, /old\.review_status = 'pending'/);
  assert.match(lifecycle, /new\.reviewed_by_role is distinct from old\.reviewed_by_role/);
});

test("moderation audit history is append-only and supports namespaced event types", () => {
  assert.match(migration, /create table public\.moderation_audit_events/);
  assert.match(
    migration,
    /event_type ~ '\^\[a-z\]\[a-z0-9_\]\*\(\\\.\[a-z\]\[a-z0-9_\]\*\)\*\$'/,
  );
  assert.match(migration, /moderation_audit_events_are_append_only/);
  assert.match(migration, /sanction_review_requested/);
  assert.match(migration, /sanction_review_decided/);
  assert.match(migration, /new\.reviewed_by_role/);
  assert.match(migration, /new\.revoked_by_role/);
  assert.match(migration, /revocation_kind', new\.revocation_kind/);
  assert.match(migration, /'supersedes_sanction_id', new\.supersedes_sanction_id/);
  assert.match(migration, /'replacement_sanction_id', new\.replacement_sanction_id/);
  assert.match(
    migration,
    /grant select, insert\s+on public\.moderation_audit_events to service_role/,
  );
  assert.doesNotMatch(migration, /grant[^;]*update[^;]*moderation_audit_events/i);
  assert.doesNotMatch(migration, /grant[^;]*delete[^;]*moderation_audit_events/i);
});

test("legacy bans are imported before expired current state is normalized", () => {
  const importIndex = migration.indexOf("insert into public.moderation_sanctions");
  const normalizeIndex = migration.indexOf("update public.user_status", importIndex);

  assert.ok(importIndex >= 0);
  assert.ok(normalizeIndex > importIndex);
  assert.match(migration.slice(importIndex, normalizeIndex), /'legacy'/);
  assert.match(migration.slice(importIndex, normalizeIndex), /'critical'/);
  assert.match(
    migration.slice(importIndex, normalizeIndex),
    /null,\s+null,\s+'system',\s+'ban'/,
  );
  assert.match(migration.slice(importIndex, normalizeIndex), /'account_access', 'blocked'/);
  assert.match(
    migration.slice(importIndex, normalizeIndex),
    /Legacy account restriction imported without a user-facing explanation\./,
  );
  assert.match(
    migration,
    /where is_banned\s+and banned_until is not null\s+and banned_until <= now\(\)/,
  );
});

test("authenticated users receive only their own user-safe moderation projection", () => {
  const grants = section(
    "revoke all on table public.user_status",
    "create view public.user_moderation_notices",
  );
  const view = section(
    "create view public.user_moderation_notices",
    "alter view public.user_moderation_notices owner to postgres",
  );

  assert.match(migration, /create policy moderation_sanctions_select_own/);
  assert.match(migration, /subject_user_id = \(select auth\.uid\(\)\)/);
  assert.match(grants, /grant select \([\s\S]*?\) on public\.moderation_sanctions to authenticated/);
  assert.doesNotMatch(grants, /internal_note/);
  assert.doesNotMatch(grants, /review_private_reason/);
  assert.doesNotMatch(grants, /issued_by_user_id/);
  assert.match(view, /security_invoker = true/);
  assert.match(view, /security_barrier = true/);
  assert.doesNotMatch(view, /internal_note/);
  assert.doesNotMatch(view, /review_private_reason/);
  assert.doesNotMatch(view, /metadata/);
  assert.match(view, /sanction\.supersedes_sanction_id/);
  assert.match(view, /sanction\.replacement_sanction_id/);
});

test("legacy broad grants are replaced and moderation tables stay out of Realtime", () => {
  assert.match(
    migration,
    /revoke all on table public\.user_status from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /grant select \(user_id, is_banned, banned_until, ban_reason, updated_at\)\s+on public\.user_status to authenticated/,
  );
  assert.doesNotMatch(
    migration,
    /grant[^;]*\b(insert|update|delete)\b[^;]*user_status to authenticated/i,
  );
  assert.match(migration, /alter publication supabase_realtime drop table public\.user_status/);
  assert.doesNotMatch(migration, /alter publication supabase_realtime add table public\.user_status/);
  assert.doesNotMatch(
    migration,
    /alter publication supabase_realtime add table public\.moderation_sanctions/,
  );
});
