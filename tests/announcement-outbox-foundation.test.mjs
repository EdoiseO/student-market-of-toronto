import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createPostgresFixture, postgresAvailable } from "./helpers/postgres-fixture.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const migrationPath = join(
  testDirectory,
  "../supabase/migrations/20260816061703_announcement_delivery_outbox_foundation.sql",
);
const migration = await readFile(migrationPath, "utf8");

function tableBody(name) {
  const match = migration.match(
    new RegExp(`create table public\\.${name} \\(([\\s\\S]*?)\\n\\);`, "i"),
  );
  assert.ok(match, `missing table ${name}`);
  return match[1];
}

test("content and audience filters have strict database bounds", () => {
  const announcements = tableBody("announcements");
  assert.match(announcements, /char_length\(trim\(body\)\) between 1 and 2000/i);
  assert.match(announcements, /'low', 'normal', 'high', 'urgent'/i);
  assert.match(announcements, /delivery_policy = 'always_on'/i);
  assert.match(
    announcements,
    /private\.is_valid_announcement_audience_filter\(audience_type, audience_filter\)/i,
  );
  assert.match(migration, /octet_length\(filter_value::text\) > 65536/i);
  for (const bound of [25, 4, 500]) {
    assert.match(migration, new RegExp(`item_count between 1 and ${bound}`));
  }
  assert.match(migration, /grant usage on schema private to service_role/i);
  assert.match(
    migration,
    /grant execute on function private\.is_valid_announcement_audience_filter\(text, jsonb\)[\s\S]*?to service_role/i,
  );
  assert.doesNotMatch(
    migration,
    /grant execute on function private\.is_valid_announcement_audience_filter\(text, jsonb\)[\s\S]{0,100}?to (?:anon|authenticated|public)/i,
  );
});

test("drafts and every version have durable audit-linked history", () => {
  const announcements = tableBody("announcements");
  const history = tableBody("announcement_lifecycle_history");
  assert.match(announcements, /created_by_snapshot uuid not null/i);
  assert.match(announcements, /updated_by_snapshot uuid not null/i);
  assert.match(history, /unique \(announcement_id, announcement_version\)/i);
  assert.match(history, /moderation_audit_event_id uuid not null unique/i);
  assert.doesNotMatch(history, /announcement_id uuid[^\n]*references/i);
  assert.match(history, /actor_user_id_snapshot uuid not null/i);
  assert.match(migration, /announcement_history_is_immutable/i);
  for (const event of [
    "created",
    "updated",
    "scheduled",
    "unscheduled",
    "sending",
    "completed",
    "cancelled",
  ]) {
    assert.match(migration, new RegExp(`announcement\\.${event}`));
  }
});

test("admin lifecycle writes are optimistic, atomic, and RPC-only", () => {
  assert.match(migration, /private\.require_active_announcement_admin/i);
  assert.match(migration, /auth\.jwt\(\) ->> 'role'.*'service_role'/i);
  assert.match(migration, /raw_app_meta_data ->> 'role'/i);
  assert.match(migration, /announcement_version_conflict/i);
  assert.match(migration, /insert into public\.moderation_audit_events/i);
  assert.match(migration, /insert into public\.announcement_lifecycle_history/i);
  assert.match(migration, /announcements_must_be_created_through_rpc/i);
  assert.match(migration, /announcement_must_be_changed_through_transition_rpc/i);
  for (const rpc of [
    "create_announcement_draft",
    "update_announcement_draft",
    "transition_announcement",
  ]) {
    assert.match(migration, new RegExp(`function public\\.${rpc}\\(`, "i"));
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${rpc}\\([\\s\\S]*?to service_role`, "i"),
    );
  }
  assert.doesNotMatch(
    migration,
    /grant (?:insert|update|delete|all)[^;]*public\.announcements[^;]*service_role/i,
  );
});

test("cancellation and leasing fail closed against parent state", () => {
  assert.match(
    migration,
    /next_status = 'cancelled'[\s\S]*?status in \('queued', 'processing', 'failed'\)/i,
  );
  assert.match(migration, /outbox\.queue_status in \('pending', 'leased', 'retry'\)/i);
  assert.match(
    migration,
    /announcement\.status = 'sending'[\s\S]*?for update of announcement, delivery, outbox skip locked/i,
  );
  assert.match(migration, /if parent_status <> 'sending' then/i);
  assert.match(migration, /announcement_delivery_lease_invalid/i);
  assert.match(migration, /public\.reap_expired_announcement_delivery_lease/i);
  assert.match(migration, /current_outbox\.attempt_count >= current_outbox\.max_attempts/i);
  assert.match(migration, /last_error = 'delivery_lease_expired'/i);
  assert.match(migration, /next_queue_status = 'retry' then now\(\)/i);
  assert.match(migration, /atomic_in_app_worker_required/i);
  assert.match(migration, /email_only_delivery_cannot_reference_in_app_outputs/i);
  assert.match(migration, /announcement_delivery_outbox_is_durable/i);
  assert.doesNotMatch(
    migration,
    /grant (?:insert|update|delete|all)[^;]*announcement_delivery_outbox[^;]*service_role/i,
  );
});

test("aggregate completion requires matching terminal delivery and outbox pairs", () => {
  for (const pair of [
    "delivery.status = 'delivered' and outbox.queue_status = 'completed'",
    "delivery.status = 'failed' and outbox.queue_status = 'dead'",
    "delivery.status = 'skipped' and outbox.queue_status = 'completed'",
    "delivery.status = 'cancelled' and outbox.queue_status = 'cancelled'",
  ]) {
    assert.match(migration, new RegExp(pair.replaceAll(".", "\\.")));
  }
  assert.match(migration, /announcement_deliveries_are_not_terminal/i);
  assert.match(migration, /completed_announcement_cannot_have_terminal_failures/i);
  assert.match(migration, /partially_failed_announcement_requires_terminal_failure/i);
  assert.match(
    migration,
    /order by delivery\.id\s+for update;[\s\S]*order by outbox\.delivery_id\s+for update of outbox/i,
  );
});

test("output snapshots and recipient timestamps are immutable", () => {
  const deliveries = tableBody("announcement_deliveries");
  for (const column of [
    "recipient_user_id_snapshot uuid not null",
    "conversation_id_snapshot uuid",
    "message_id_snapshot uuid",
    "notification_id_snapshot uuid",
  ]) {
    assert.match(deliveries, new RegExp(column));
  }
  assert.match(deliveries, /unique \(announcement_id, recipient_user_id_snapshot\)/i);
  assert.match(migration, /announcement_delivery_output_reference_locked/i);
  assert.match(migration, /announcement_delivery_delivered_at_is_immutable/i);
  assert.match(migration, /new\.read_at := now\(\)/i);
  assert.match(migration, /new\.dismissed_at := now\(\)/i);
  assert.match(migration, /public\.mark_announcement_delivery_read/i);
  assert.match(migration, /public\.dismiss_announcement_delivery/i);
  assert.doesNotMatch(migration, /grant update \(read_at, dismissed_at\)/i);
  assert.doesNotMatch(migration, /create policy "Recipients can update/i);
});

test("recipient visibility excludes targeting, actor, counter, and worker data", () => {
  const grant = migration.match(
    /grant select \(([\s\S]*?)\) on table public\.announcements to authenticated/i,
  )?.[1];
  assert.ok(grant);
  assert.doesNotMatch(
    grant,
    /audience_filter|created_by|updated_by|moderation_audit_event_id|recipient_count/i,
  );
  assert.doesNotMatch(
    migration,
    /create policy[\s\S]{0,180}on public\.announcement_delivery_outbox/i,
  );
  assert.match(
    migration,
    /alter publication supabase_realtime add table public\.announcement_deliveries/i,
  );
  assert.doesNotMatch(
    migration,
    /alter publication supabase_realtime add table public\.(?:announcements|announcement_delivery_outbox)/i,
  );
});

test(
  "isolated PostgreSQL roles enforce cancellation and immutable recipient state",
  { skip: !postgresAvailable },
  async (t) => {
    const fixture = createPostgresFixture(t);

    const sql = (statement, expectFailure = false) => {
      const result = fixture.result(statement);
      if (expectFailure) {
        assert.notEqual(result.status, 0, `expected failure: ${statement}`);
        return result.stderr;
      }
      assert.equal(result.status, 0, result.stderr || result.stdout);
      return result.stdout.trim();
    };
    const service = (statement, expectFailure = false) =>
      sql(
        `set role service_role; set request.jwt.claims='{"role":"service_role"}';${statement}`,
        expectFailure,
      );
    const recipient = (statement, expectFailure = false) =>
      sql(
        `set role authenticated; set request.jwt.claims='{"role":"authenticated","sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}';${statement}`,
        expectFailure,
      );

    try {
      sql(BOOTSTRAP_SQL);
      sql(migration);

      assert.match(
        service(
          "insert into public.announcements(title,body,created_by,created_by_snapshot,updated_by,updated_by_snapshot) values ('x','x','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');",
          true,
        ),
        /permission denied/i,
      );
      assert.match(
        service(
          "select id from create_announcement_draft('No','Moderator cannot create this announcement.','general','normal','all','{}','preference_aware',false,'cccccccc-cccc-4ccc-8ccc-cccccccccccc',null);",
          true,
        ),
        /active_announcement_admin_required/i,
      );

      const first = service(
        "select id from create_announcement_draft('Safety','A sufficiently detailed safety message.','safety','urgent','all','{}','always_on',true,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c1');",
      );
      service(`select id from transition_announcement('${first}',1,'start_sending','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,'s1');`);
      const firstDelivery = service(`select delivery_id from enqueue_announcement_delivery('${first}','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true,false,5);`);
      const firstLease = service("select lease_token from claim_announcement_delivery(60);");
      service(`select id from transition_announcement('${first}',2,'cancel','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,'x1');`);
      assert.equal(
        service(`select d.status='cancelled' and o.queue_status='cancelled' and o.lease_token is null from announcement_deliveries d join announcement_delivery_outbox o on o.delivery_id=d.id where d.id='${firstDelivery}';`),
        "t",
      );
      assert.equal(service("select count(*) from claim_announcement_delivery(60);"), "0");
      assert.match(
        service(`select delivery_id from finish_announcement_delivery('${firstDelivery}','${firstLease}',true,'11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',null,null);`, true),
        /announcement_delivery_lease_invalid/i,
      );

      const second = service(
        "select id from create_announcement_draft('General','A sufficiently detailed general message.','general','normal','all','{}','preference_aware',false,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c2');",
      );
      service(`select id from transition_announcement('${second}',1,'start_sending','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,'s2');`);
      const secondDelivery = service(`select delivery_id from enqueue_announcement_delivery('${second}','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true,false,5);`);
      const secondLease = service("select lease_token from claim_announcement_delivery(60);");
      assert.match(
        service(`select delivery_id from finish_announcement_delivery('${secondDelivery}','${secondLease}',true,'11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',null,null);`, true),
        /atomic_in_app_worker_required/i,
      );
      sql(`alter table announcement_delivery_outbox disable trigger enforce_announcement_outbox_lifecycle;
        update announcement_delivery_outbox set lease_expires_at=now()-interval '1 second' where delivery_id='${secondDelivery}';
        alter table announcement_delivery_outbox enable trigger enforce_announcement_outbox_lifecycle;`);
      assert.equal(
        service("select queue_status from reap_expired_announcement_delivery_lease();"),
        "retry",
      );
      assert.equal(
        service(`select d.status='failed' and o.attempt_count=1 and o.lease_token is null from announcement_deliveries d join announcement_delivery_outbox o on o.delivery_id=d.id where d.id='${secondDelivery}';`),
        "t",
      );
      assert.ok(service("select lease_token from claim_announcement_delivery(60);"));
      service(`select id from transition_announcement('${second}',2,'cancel','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,'x2');`);

      const third = service(
        "select id from create_announcement_draft('Email','A sufficiently detailed email-only message.','general','normal','all','{}','preference_aware',true,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c3');",
      );
      service(`select id from transition_announcement('${third}',1,'start_sending','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,'s3');`);
      const thirdDelivery = service(`select delivery_id from enqueue_announcement_delivery('${third}','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false,true,5);`);
      const thirdLease = service("select lease_token from claim_announcement_delivery(60);");
      assert.match(
        service(`select id from transition_announcement('${third}',2,'complete','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,'premature');`, true),
        /announcement_deliveries_are_not_terminal/i,
      );
      service(`select delivery_id from finish_announcement_delivery('${thirdDelivery}','${thirdLease}',true,null,null,null,null,null);`);
      service(`select id from transition_announcement('${third}',2,'complete','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,'done3');`);
      assert.equal(
        service(`select d.status='delivered' and o.queue_status='completed' and d.delivered_at is not null from announcement_deliveries d join announcement_delivery_outbox o on o.delivery_id=d.id where d.id='${thirdDelivery}';`),
        "t",
      );
      const readAt = recipient(`select extract(epoch from read_at) from mark_announcement_delivery_read('${thirdDelivery}');`);
      assert.equal(
        recipient(`select extract(epoch from read_at) from mark_announcement_delivery_read('${thirdDelivery}');`),
        readAt,
      );
      assert.equal(
        recipient(`select read_at is not null and dismissed_at is not null from dismiss_announcement_delivery('${thirdDelivery}');`),
        "t",
      );
      assert.match(
        recipient(`update announcement_deliveries set read_at=now()+interval '10 years' where id='${thirdDelivery}';`, true),
        /permission denied/i,
      );
      assert.match(
        service(`update announcement_deliveries set recipient_user_id_snapshot='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' where id='${thirdDelivery}';`, true),
        /permission denied/i,
      );

      const fourth = service(
        "select id from create_announcement_draft('Failure','A sufficiently detailed terminal failure message.','general','normal','all','{}','preference_aware',true,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c4');",
      );
      service(`select id from transition_announcement('${fourth}',1,'start_sending','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,'s4');`);
      const fourthDelivery = service(`select delivery_id from enqueue_announcement_delivery('${fourth}','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false,true,1);`);
      const fourthLease = service("select lease_token from claim_announcement_delivery(60);");
      service(`select delivery_id from finish_announcement_delivery('${fourthDelivery}','${fourthLease}',false,null,null,null,'provider_rejected',null);`);
      assert.match(
        service(`select id from transition_announcement('${fourth}',2,'complete','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,'wrong4');`, true),
        /completed_announcement_cannot_have_terminal_failures/i,
      );
      service(`select id from transition_announcement('${fourth}',2,'partially_fail','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,'done4');`);
    } finally {
      fixture.dispose();
    }
  },
);

const BOOTSTRAP_SQL = String.raw`
create role postgres superuser; create role anon nologin; create role authenticated nologin;
create role service_role nologin bypassrls; create schema auth; create schema private;
create table auth.users(id uuid primary key,raw_app_meta_data jsonb not null default '{}',banned_until timestamptz);
create function auth.jwt() returns jsonb language sql stable as $body$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $body$;
create function auth.uid() returns uuid language sql stable as $body$ select nullif(coalesce(auth.jwt()->>'sub',''),'')::uuid $body$;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on function auth.jwt() to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
create table profiles(id uuid primary key references auth.users(id) on delete cascade);
create table conversations(id uuid primary key); create table messages(id uuid primary key);
create table notifications(id uuid primary key);
create table user_status(user_id uuid primary key references auth.users(id),is_banned boolean not null default false,banned_until timestamptz,ban_reason text,created_at timestamptz default now(),updated_at timestamptz default now());
create table moderation_audit_events(id uuid primary key default gen_random_uuid(),event_type text not null,actor_user_id uuid references auth.users(id) on delete set null,actor_user_id_snapshot uuid,actor_role text,subject_user_id uuid,subject_user_id_snapshot uuid,sanction_id uuid,source_report_id uuid,resource_type text not null,resource_id uuid,summary text not null,metadata jsonb default '{}',request_id text,occurred_at timestamptz default now());
grant select,insert on moderation_audit_events to service_role;
insert into auth.users values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{"role":"admin"}',null),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','{}',null),('cccccccc-cccc-4ccc-8ccc-cccccccccccc','{"role":"moderator"}',null);
insert into profiles values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into conversations values ('11111111-1111-4111-8111-111111111111');
insert into messages values ('22222222-2222-4222-8222-222222222222');
insert into notifications values ('33333333-3333-4333-8333-333333333333');
`;
