import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const migrationPaths = [
  "../supabase/migrations/20260816061703_announcement_delivery_outbox_foundation.sql",
  "../supabase/migrations/20260816081757_enforce_closed_conversation_writes.sql",
  "../supabase/migrations/20260816081918_atomic_announcement_delivery_cutover.sql",
  "../supabase/migrations/20260816090221_harden_announcement_worker_lifecycle.sql",
];
const migrations = await Promise.all(
  migrationPaths.map((path) => readFile(new URL(path, import.meta.url), "utf8")),
);
const postgresBin = [
  process.env.POSTGRES_BIN,
  "/opt/homebrew/opt/postgresql@16/bin",
  "/usr/local/opt/postgresql@16/bin",
]
  .filter(Boolean)
  .find((candidate) => existsSync(join(candidate, "postgres")));

test(
  "isolated PostgreSQL atomically delivers announcements through the guarded system scope",
  { skip: !postgresBin },
  async () => {
    const cluster = await mkdtemp(join(tmpdir(), "smot-announcement-stage3-"));
    const data = join(cluster, "data");
    const port = 49_152 + Math.floor(Math.random() * 10_000);
    let started = false;

    const command = (name, args, options = {}) => {
      const result = spawnSync(join(postgresBin, name), args, {
        encoding: "utf8",
        ...options,
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      return (result.stdout ?? "").trim();
    };
    const sql = (statement, expectFailure = false) => {
      const result = spawnSync(
        join(postgresBin, "psql"),
        [
          "-X", "-qAt", "-h", cluster, "-p", String(port), "-d", "postgres",
          "-v", "ON_ERROR_STOP=1",
        ],
        { encoding: "utf8", input: statement },
      );

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
      command("initdb", ["-D", data, "-A", "trust", "--no-locale"]);
      command(
        "pg_ctl",
        [
          "-D", data, "-o", `-p ${port} -k ${cluster} -c listen_addresses=''`,
          "-w", "start",
        ],
        { stdio: "ignore" },
      );
      started = true;
      sql(BOOTSTRAP_SQL);
      for (const migration of migrations) {
        sql(migration);
      }

      const announcementId = service(
        "select id from create_announcement_draft('Campus notice','The library will close at eight tonight.','general','normal','all','{}','always_on',false,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','stage3-create');",
      );
      service(
        `select id from transition_announcement('${announcementId}',1,'start_sending','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,'stage3-send');`,
      );
      assert.equal(
        service(
          `select enqueued_count || ':' || exhausted from enqueue_announcement_audience_batch('${announcementId}',100,5);`,
        ),
        "1:true",
        "orphaned profile must not be enqueued",
      );
      const deliveryId = service("select delivery_id from claim_announcement_delivery(60);");
      const leaseToken = service(
        `select lease_token from announcement_delivery_outbox where delivery_id='${deliveryId}';`,
      );
      assert.match(
        recipient(
          `select delivery_id from deliver_announcement_in_app('${deliveryId}','${leaseToken}');`,
          true,
        ),
        /permission denied/i,
      );
      const output = service(
        `select delivery_status || ':' || queue_status || ':' || idempotent_replay from deliver_announcement_in_app('${deliveryId}','${leaseToken}');`,
      );
      assert.equal(output, "delivered:completed:false");
      assert.equal(
        service(
          `select (conversation_id_snapshot is not null and message_id_snapshot is not null and notification_id_snapshot is not null) from announcement_deliveries where id='${deliveryId}';`,
        ),
        "t",
      );
      assert.equal(
        service(
          `select notification.type from notifications notification join announcement_deliveries delivery on delivery.notification_id_snapshot=notification.id where delivery.id='${deliveryId}';`,
        ),
        "announcement",
      );
      assert.equal(
        sql(
          `select (conversation.seller_id is null and message.sender_id is null) from announcement_deliveries delivery join conversations conversation on conversation.id=delivery.conversation_id_snapshot join messages message on message.id=delivery.message_id_snapshot where delivery.id='${deliveryId}';`,
        ),
        "t",
        "announcement output must be senderless and independent of the initiating admin",
      );
      const outputConversationId = service(
        `select conversation_id_snapshot from announcement_deliveries where id='${deliveryId}';`,
      );
      assert.equal(
        recipient(
          `select unread_count from get_conversation_unread_counts(array['${outputConversationId}'::uuid]);`,
        ),
        "1",
      );
      assert.equal(
        recipient(`select mark_conversation_read('${outputConversationId}');`),
        "1",
      );
      assert.equal(
        recipient(
          `select unread_count from get_conversation_unread_counts(array['${outputConversationId}'::uuid]);`,
        ),
        "0",
      );
      assert.equal(
        service(
          `select idempotent_replay from deliver_announcement_in_app('${deliveryId}','${leaseToken}');`,
        ),
        "t",
        "same-token lost-response retry must return existing outputs",
      );
      assert.match(
        service(
          `select delivery_id from deliver_announcement_in_app('${deliveryId}','99999999-9999-4999-8999-999999999999');`,
          true,
        ),
        /announcement_delivery_is_not_processable|announcement_delivery_lease_invalid/i,
      );
      assert.equal(
        service(
          `select audience_exhausted and deliveries_terminal and not has_terminal_failure from get_announcement_terminal_state('${announcementId}');`,
        ),
        "t",
      );
      assert.match(
        service(
          `select id from transition_announcement('${announcementId}',2,'complete','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,'raw-complete');`,
          true,
        ),
        /announcement_worker_finalization_required/i,
      );

      assert.match(
        service(
          "insert into messages(conversation_id,sender_id,body) values ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','service bypass');",
          true,
        ),
        /permission denied/i,
      );
      assert.match(
        recipient(
          "insert into messages(conversation_id,sender_id,body) values ('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','closed write');",
          true,
        ),
        /conversation_write_closed/i,
      );
      assert.match(
        recipient(
          "insert into conversations(listing_id,buyer_id,seller_id) values (null,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',null);",
          true,
        ),
        /senderless_announcement_conversation_requires_atomic_worker/i,
      );
      assert.match(
        recipient(
          "insert into messages(conversation_id,sender_id,body) values ('11111111-1111-4111-8111-111111111111',null,'null sender bypass');",
          true,
        ),
        /conversation_message_sender_mismatch/i,
      );

      const operationId = "12121212-1212-4212-8212-121212121212";
      const idempotentId = service(
        `select id from create_and_start_announcement('${operationId}','Idempotent notice','One durable campaign for one client command.','general','high','all','{}','always_on',false,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');`,
      );
      assert.equal(
        service(
          `select id from create_and_start_announcement('${operationId}','Idempotent notice','One durable campaign for one client command.','general','high','all','{}','always_on',false,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');`,
        ),
        idempotentId,
      );
      assert.equal(
        service(
          `select (select count(*) from announcement_send_commands where operation_id='${operationId}') || ':' || (select count(*) from announcement_lifecycle_history where announcement_id='${idempotentId}');`,
        ),
        "1:2",
      );
      assert.match(
        service(
          `select id from create_and_start_announcement('${operationId}','Changed title','One durable campaign for one client command.','general','high','all','{}','always_on',false,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');`,
          true,
        ),
        /announcement_operation_id_conflict/i,
      );
      assert.match(
        service(
          `select id from finalize_announcement_worker('${idempotentId}');`,
          true,
        ),
        /announcement_audience_is_not_exhausted/i,
      );

      const cancelledId = service(
        "select id from create_announcement_draft('Cancelled','This delivery must never become visible.','general','normal','all','{}','always_on',false,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cancel-create');",
      );
      service(
        `select id from transition_announcement('${cancelledId}',1,'start_sending','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,'cancel-send');`,
      );
      service(`select enqueued_count from enqueue_announcement_audience_batch('${cancelledId}',100,5);`);
      const cancelledDelivery = service("select delivery_id from claim_announcement_delivery(60);");
      const cancelledLease = service(
        `select lease_token from announcement_delivery_outbox where delivery_id='${cancelledDelivery}';`,
      );
      service(
        `select id from transition_announcement('${cancelledId}',2,'cancel','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,'cancel-now');`,
      );
      assert.match(
        service(
          `select delivery_id from deliver_announcement_in_app('${cancelledDelivery}','${cancelledLease}');`,
          true,
        ),
        /announcement_is_not_sending|announcement_delivery_is_not_processable/i,
      );
      assert.equal(
        service(
          `select count(*) from messages message join announcement_deliveries delivery on delivery.message_id_snapshot=message.id where delivery.id='${cancelledDelivery}';`,
        ),
        "0",
      );

      service(
        `select enqueued_count from enqueue_announcement_audience_batch('${idempotentId}',100,5);`,
      );
      const idempotentDelivery = service(
        "select delivery_id from claim_announcement_delivery(60);",
      );
      const idempotentLease = service(
        `select lease_token from announcement_delivery_outbox where delivery_id='${idempotentDelivery}';`,
      );
      service(
        `select delivery_id from deliver_announcement_in_app('${idempotentDelivery}','${idempotentLease}');`,
      );

      const urgentId = service(
        "select id from create_and_start_announcement('90000000-0000-4000-8000-000000000006','Urgent rotation','Urgent campaign must enter the first fair worker batch.','general','urgent','all','{}','always_on',false,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');",
      );
      for (let index = 1; index <= 5; index += 1) {
        const operation = `90000000-0000-4000-8000-00000000000${index}`;
        service(
          `select id from create_and_start_announcement('${operation}','Normal rotation ${index}','Normal fair worker campaign ${index}.','general','normal','all','{}','always_on',false,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');`,
        );
      }
      assert.equal(
        service(
          `select bool_or(announcement_id='${urgentId}') from claim_announcement_worker_batch(5);`,
        ),
        "t",
        "urgent campaign must win a priority tie inside the fair rotating batch",
      );
      assert.equal(
        service(
          "select count(*) > 0 from claim_announcement_worker_batch(5);",
        ),
        "t",
        "unattempted campaigns must be selected on the next pass instead of being starved",
      );

      sql(
        "update auth.users set raw_app_meta_data='{}', banned_until=now()+interval '1 day' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';",
      );
      assert.match(
        service(
          `select id from create_and_start_announcement('${operationId}','Idempotent notice','One durable campaign for one client command.','general','high','all','{}','always_on',false,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');`,
          true,
        ),
        /active_announcement_admin_required/i,
      );
      assert.equal(
        service(
          `select status from finalize_announcement_worker('${announcementId}');`,
        ),
        "sent",
        "demotion and a later ban must not strand worker finalization",
      );

      sql(
        "delete from auth.users where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';",
      );
      assert.equal(
        service(
          `select status from finalize_announcement_worker('${idempotentId}');`,
        ),
        "sent",
        "initiating-admin deletion must not strand worker finalization",
      );
      assert.equal(
        service(
          `select (updated_by is null and updated_by_snapshot='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') from announcements where id='${idempotentId}';`,
        ),
        "t",
      );
    } finally {
      if (started) {
        spawnSync(join(postgresBin, "pg_ctl"), ["-D", data, "-m", "fast", "stop"]);
      }
      await rm(cluster, { recursive: true, force: true });
    }
  },
);

const BOOTSTRAP_SQL = String.raw`
create role postgres superuser; create role anon nologin; create role authenticated nologin;
create role service_role nologin bypassrls; create schema auth; create schema private;
create schema storage;
create table auth.users(id uuid primary key,raw_app_meta_data jsonb not null default '{}',banned_until timestamptz);
create function auth.jwt() returns jsonb language sql stable as $body$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $body$;
create function auth.uid() returns uuid language sql stable as $body$ select nullif(coalesce(auth.jwt()->>'sub',''),'')::uuid $body$;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on function auth.jwt() to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;

create table profiles(id uuid primary key,school text,created_at timestamptz not null default now());
create table listings(id uuid primary key,seller_id uuid,status text not null);
create table conversations(
  id uuid primary key default gen_random_uuid(),listing_id uuid,buyer_id uuid not null,
  seller_id uuid not null,last_message_at timestamptz,last_message_preview text,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table messages(
  id uuid primary key default gen_random_uuid(),conversation_id uuid not null references conversations(id),
  sender_id uuid not null,body text not null,read_at timestamptz,created_at timestamptz not null default now()
);
create table notifications(
  id uuid primary key default gen_random_uuid(),user_id uuid not null,type text not null,
  conversation_id uuid,message_id uuid,listing_id uuid,metadata jsonb not null default '{}',
  read_at timestamptz,created_at timestamptz not null default now()
);
create table conversation_user_state(
  conversation_id uuid not null,user_id uuid not null,hidden_at timestamptz,deleted_at timestamptz,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  primary key(conversation_id,user_id)
);
create table conversation_moderation_state(
  conversation_id uuid primary key,status text not null default 'open',closed_until timestamptz
);
create table blocked_users(blocker_user_id uuid,blocked_user_id uuid,primary key(blocker_user_id,blocked_user_id));
create table private.message_media_upload_reservations(
  storage_path text primary key,user_id uuid not null,conversation_id uuid not null,
  expires_at timestamptz not null,mime_type text not null,size_bytes bigint not null
);
create table storage.objects(
  id uuid primary key default gen_random_uuid(),bucket_id text not null,name text not null,
  owner_id text,metadata jsonb not null default '{}'
);
create table message_attachments(
  id uuid primary key default gen_random_uuid(),message_id uuid not null,
  conversation_id uuid not null,uploader_id uuid not null
);
create table message_reactions(
  message_id uuid not null,conversation_id uuid not null,user_id uuid not null,
  emoji text not null,created_at timestamptz not null default now(),removed_at timestamptz,
  primary key(message_id,user_id,emoji)
);
create table user_status(
  user_id uuid primary key,is_banned boolean not null default false,banned_until timestamptz,
  ban_reason text,created_at timestamptz default now(),updated_at timestamptz default now()
);
create table moderation_audit_events(
  id uuid primary key default gen_random_uuid(),event_type text not null,
  actor_user_id uuid references auth.users(id) on delete set null,actor_user_id_snapshot uuid,
  actor_role text,subject_user_id uuid,subject_user_id_snapshot uuid,sanction_id uuid,
  source_report_id uuid,resource_type text not null,resource_id uuid,summary text not null,
  metadata jsonb default '{}',request_id text,occurred_at timestamptz default now()
);
grant select,insert on moderation_audit_events to service_role;
grant select,insert on conversations to authenticated,service_role;
grant select,insert on messages to authenticated,service_role;
grant select on notifications to service_role;
grant select,insert on message_attachments,message_reactions to authenticated,service_role;

insert into auth.users values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{"role":"admin"}',null),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','{}',null);
insert into profiles(id,school,created_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','George Brown College',now()-interval '1 day'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','George Brown College',now()-interval '1 day'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','George Brown College',now()-interval '1 day');
insert into listings values ('10101010-1010-4010-8010-101010101010','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','active');
insert into conversations(id,listing_id,buyer_id,seller_id) values (
  '11111111-1111-4111-8111-111111111111','10101010-1010-4010-8010-101010101010',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
);
insert into conversation_moderation_state values ('11111111-1111-4111-8111-111111111111','closed',null);
`;
