import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createPostgresFixture, postgresAvailable } from "./helpers/postgres-fixture.mjs";

const migrationUrl = new URL(
  "../supabase/migrations/20260816061558_conversation_moderation_state_foundation.sql",
  import.meta.url,
);

async function migrationSource() {
  return readFile(migrationUrl, "utf8");
}

test("conversation moderation state is versioned, initialized, and audit-linked", async () => {
  const sql = await migrationSource();

  assert.match(sql, /create table public\.conversation_moderation_state/i);
  assert.match(sql, /version bigint not null default 0/i);
  assert.match(sql, /status text not null default 'open'/i);
  const stateDefinition = sql.slice(
    sql.indexOf("create table public.conversation_moderation_state"),
    sql.indexOf("comment on table public.conversation_moderation_state"),
  );
  assert.doesNotMatch(stateDefinition, /actor_id|moderation_audit_event_id/i);
  assert.match(
    sql,
    /moderation_audit_event_id uuid\s+references public\.moderation_audit_events\(id\) on delete set null/i,
  );
  assert.match(sql, /insert into public\.conversation_moderation_state \(conversation_id\)[\s\S]*from public\.conversations/i);
  assert.match(sql, /after insert on public\.conversations[\s\S]*initialize_conversation_moderation_state/i);
  assert.match(sql, /state cannot be deleted while its conversation exists/i);
});

test("close and reopen transitions use optimistic concurrency and append one history version", async () => {
  const sql = await migrationSource();

  assert.match(sql, /create or replace function public\.transition_conversation_moderation_state/i);
  assert.match(sql, /current_state\.version <> p_expected_version/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /new\.version = old\.version \+ 1/i);
  assert.match(sql, /state_version,\s+action,\s+previous_status,\s+new_status/i);
  assert.match(sql, /action in \('close', 'reopen'\)/i);
  assert.match(sql, /unique \(conversation_id, state_version\)/i);
  assert.match(sql, /temporary closure must end in the future/i);
  assert.match(sql, /when 'close' then 'conversation\.closed'/i);
  assert.match(sql, /else 'conversation\.reopened'/i);
  assert.match(sql, /insert into public\.moderation_audit_events \(/i);
  assert.match(sql, /p_actor_id,\s+p_actor_id,\s+actor_role/i);
  assert.match(sql, /'conversation',\s+p_conversation_id/i);
  assert.match(sql, /returning id into audit_event_id/i);
  assert.match(sql, /audit_event_id,\s+transitioned_at/i);
});

test("history is immutable and survives conversation and actor deletion", async () => {
  const sql = await migrationSource();
  const historyDefinition = sql.slice(
    sql.indexOf("create table public.conversation_moderation_history"),
    sql.indexOf("comment on table public.conversation_moderation_history"),
  );

  assert.match(sql, /before insert or update or delete on public\.conversation_moderation_history/i);
  assert.match(sql, /Conversation moderation history is immutable/i);
  assert.doesNotMatch(historyDefinition, /conversation_id uuid[^,]*references/i);
  assert.doesNotMatch(historyDefinition, /actor_id uuid[^,]*references/i);
  assert.doesNotMatch(sql, /grant[^;]*(update|delete|truncate)[^;]*conversation_moderation_history[^;]*service_role/i);
});

test("participants can read moderation state and history but cannot write either table", async () => {
  const sql = await migrationSource();

  assert.match(sql, /alter table public\.conversation_moderation_state enable row level security/i);
  assert.match(sql, /alter table public\.conversation_moderation_history enable row level security/i);
  assert.match(sql, /Participants can read conversation moderation state[\s\S]*conversation\.buyer_id = \(select auth\.uid\(\)\)[\s\S]*conversation\.seller_id = \(select auth\.uid\(\)\)/i);
  assert.match(sql, /Participants can read conversation moderation history[\s\S]*conversation\.buyer_id = \(select auth\.uid\(\)\)[\s\S]*conversation\.seller_id = \(select auth\.uid\(\)\)/i);
  assert.match(sql, /grant select \([\s\S]*user_message,[\s\S]*changed_at[\s\S]*\) on table public\.conversation_moderation_state to authenticated/i);
  assert.match(sql, /grant select \([\s\S]*new_closed_until,[\s\S]*user_message,[\s\S]*created_at[\s\S]*\) on table public\.conversation_moderation_history to authenticated/i);
  const participantGrantSection = sql.slice(
    sql.indexOf("grant select (\n  conversation_id"),
    sql.indexOf("grant select on table public.conversation_moderation_state to service_role"),
  );
  assert.doesNotMatch(participantGrantSection, /actor_id|moderation_audit_event_id/i);
  assert.doesNotMatch(sql, /grant[^;]*(insert|update|delete|truncate)[^;]*conversation_moderation_(state|history)[^;]*authenticated/i);
});

test("service role can inspect state but cannot bypass the transition RPC with direct DML", async () => {
  const sql = await migrationSource();

  assert.match(
    sql,
    /grant select on table public\.conversation_moderation_state to service_role/i,
  );
  assert.match(
    sql,
    /grant select on table public\.conversation_moderation_history to service_role/i,
  );
  assert.doesNotMatch(
    sql,
    /grant[^;]*\b(insert|update|delete|truncate)\b[^;]*conversation_moderation_(state|history)[^;]*service_role/i,
  );
  assert.match(
    sql,
    /set_config\('app\.conversation_moderation_write_scope', '', true\)/i,
  );
});

test("the only transition RPC boundary is service role plus a current admin or moderator", async () => {
  const sql = await migrationSource();

  assert.match(sql, /coalesce\(auth\.jwt\(\) ->> 'role', ''\) <> 'service_role'/i);
  assert.match(sql, /raw_app_meta_data ->> 'role'[\s\S]*in \('admin', 'moderator'\)/i);
  assert.match(sql, /raw_app_meta_data -> 'roles'/i);
  assert.match(sql, /actor\.banned_until is null or actor\.banned_until <= transitioned_at/i);
  assert.match(sql, /from public\.user_status status[\s\S]*status\.is_banned/i);
  assert.match(
    sql,
    /create or replace function conversation_moderation_private\.transition_conversation_moderation_state_impl[\s\S]*security definer/i,
  );
  assert.match(sql, /create or replace function public\.transition_conversation_moderation_state[\s\S]*security invoker/i);
  const publicTransitionFunction = sql.slice(
    sql.indexOf("create or replace function public.transition_conversation_moderation_state"),
    sql.indexOf("alter function public.transition_conversation_moderation_state"),
  );
  assert.doesNotMatch(publicTransitionFunction, /security definer/i);
  assert.match(sql, /revoke all on function public\.transition_conversation_moderation_state[\s\S]*from public, anon, authenticated, service_role/i);
  assert.match(sql, /grant execute on function public\.transition_conversation_moderation_state[\s\S]*to service_role/i);
  assert.match(
    publicTransitionFunction,
    /security invoker[\s\S]*begin atomic[\s\S]*from conversation_moderation_private\.transition_conversation_moderation_state_impl/i,
  );
  assert.doesNotMatch(
    sql,
    /grant usage on schema conversation_moderation_private to service_role/i,
  );
  assert.match(
    sql,
    /revoke all on schema conversation_moderation_private[\s\S]*from public, anon, authenticated, service_role/i,
  );
  assert.doesNotMatch(sql, /auth\.role\(\)/i);
});

test("moderators receive bounded temporary closures while admins may close indefinitely", async () => {
  const sql = await migrationSource();

  assert.match(
    sql,
    /actor_role = 'moderator'[\s\S]*p_closed_until is null[\s\S]*Moderators must use a temporary conversation closure/i,
  );
  assert.match(
    sql,
    /actor_role = 'moderator'[\s\S]*p_closed_until > transitioned_at \+ interval '30 days'[\s\S]*cannot exceed 30 days/i,
  );
  assert.doesNotMatch(
    sql,
    /actor_role = 'admin'[\s\S]{0,160}p_closed_until is null/i,
  );
});

test("expired temporary closures derive as open and can be closed again without rewriting history", async () => {
  const sql = await migrationSource();

  assert.match(sql, /create view public\.conversation_effective_moderation_state/i);
  assert.match(sql, /state\.status as recorded_status/i);
  assert.match(sql, /state\.closed_until is null[\s\S]*state\.closed_until > now\(\)[\s\S]*then 'closed'[\s\S]*else 'open'/i);
  assert.match(sql, /with \(security_invoker = true, security_barrier = true\)/i);
  assert.match(
    sql,
    /normalized_action = 'close'[\s\S]*current_state\.status = 'closed'[\s\S]*current_state\.closed_until is null[\s\S]*current_state\.closed_until > transitioned_at[\s\S]*Only an effectively open conversation can be closed/i,
  );
  assert.match(sql, /previous_closed_until <= created_at/i);
});

test("Realtime removal is guarded and does not alter message or reaction guards", async () => {
  const sql = await migrationSource();

  assert.match(sql, /from pg_publication publication[\s\S]*publication\.pubname = 'supabase_realtime'/i);
  assert.match(sql, /alter publication supabase_realtime drop table public\.conversation_moderation_state/i);
  assert.doesNotMatch(sql, /alter publication supabase_realtime add table public\.conversation_moderation_state/i);
  assert.doesNotMatch(sql, /alter publication supabase_realtime add table public\.conversation_moderation_history/i);
  assert.match(sql, /Stage 4 emits a participant-safe notification[\s\S]*refetch/i);
  assert.doesNotMatch(sql, /create or replace function public\.send_conversation_message/i);
  assert.doesNotMatch(sql, /on public\.message_reactions/i);
  assert.doesNotMatch(
    sql,
    /alter table public\.conversation_moderation_(state|history) replica identity full/i,
  );
});

test(
  "Realtime removal preserves unrelated publication members and is idempotent",
  { skip: !postgresAvailable },
  async (t) => {
    const sqlSource = await migrationSource();
    const publicationBlock = sqlSource.slice(
      sqlSource.indexOf("-- Keep conversation moderation state out of Postgres Changes."),
    );
    assert.match(publicationBlock, /alter publication supabase_realtime drop table/i);

    const fixture = createPostgresFixture(t);

    const query = (statement) =>
      fixture.sql(statement);

    try {

      query(`
        create table public.conversation_moderation_state (conversation_id uuid primary key);
        create table public.keep_realtime (id uuid primary key);
        create publication supabase_realtime
          for table public.conversation_moderation_state, public.keep_realtime;
      `);
      query(publicationBlock);
      assert.equal(
        query(`
          select string_agg(tablename, ',' order by tablename)
          from pg_publication_tables
          where pubname = 'supabase_realtime'
            and schemaname = 'public';
        `),
        "keep_realtime",
      );

      query(publicationBlock);
      assert.equal(
        query(`
          select string_agg(tablename, ',' order by tablename)
          from pg_publication_tables
          where pubname = 'supabase_realtime'
            and schemaname = 'public';
        `),
        "keep_realtime",
      );
    } finally {
      fixture.dispose();
    }
  },
);
