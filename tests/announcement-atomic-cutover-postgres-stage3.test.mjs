import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createPostgresFixture, postgresAvailable } from "./helpers/postgres-fixture.mjs";

const migrationPaths = [
  "../supabase/migrations/20260816061703_announcement_delivery_outbox_foundation.sql",
  "../supabase/migrations/20260816081757_enforce_closed_conversation_writes.sql",
  "../supabase/migrations/20260816081918_atomic_announcement_delivery_cutover.sql",
  "../supabase/migrations/20260816090221_harden_announcement_worker_lifecycle.sql",
  "../supabase/migrations/20260816181148_admin_announcement_operations_stage5.sql",
];
const migrations = await Promise.all(
  migrationPaths.map((path) => readFile(new URL(path, import.meta.url), "utf8")),
);
const lifecycleHardeningMigration = await readFile(
  new URL(
    "../supabase/migrations/20260816190243_harden_announcement_lifecycle_idempotency_and_fairness.sql",
    import.meta.url,
  ),
  "utf8",
);

test(
  "isolated PostgreSQL atomically delivers announcements through the guarded system scope",
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

      const draftOperationId = "34343434-3434-4434-8434-343434343434";
      const durableDraftId = service(
        `select id from create_announcement_draft_idempotent('${draftOperationId}','Durable draft','A saved Stage 5 announcement draft.','general','normal','all','{}','always_on',false,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');`,
      );
      assert.equal(
        service(
          `select id from create_announcement_draft_idempotent('${draftOperationId}','Durable draft','A saved Stage 5 announcement draft.','general','normal','all','{}','always_on',false,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');`,
        ),
        durableDraftId,
        "an exact saved-draft retry must return the canonical announcement",
      );
      assert.match(
        service(
          `select id from create_announcement_draft_idempotent('${draftOperationId}','Changed draft','A saved Stage 5 announcement draft.','general','normal','all','{}','always_on',false,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');`,
          true,
        ),
        /announcement_operation_id_conflict/i,
      );

      const scheduledId = service(
        "select id from create_announcement_draft_idempotent('45454545-4545-4454-8454-454545454545','Scheduled notice','This scheduled notice remains deliverable after admin demotion.','general','urgent','all','{}','always_on',false,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');",
      );
      service(
        `select id from transition_announcement('${scheduledId}',1,'schedule','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now()+interval '1 millisecond','stage5-schedule');`,
      );

      const failedCampaignId = service(
        "select id from create_and_start_announcement('56565656-5656-4565-8565-565656565656','Retry notice','This campaign proves terminal failures retry without duplicating delivery.','general','normal','all','{}','always_on',false,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');",
      );
      service(`select enqueued_count from enqueue_announcement_audience_batch('${failedCampaignId}',100,1);`);
      const failedDeliveryId = service("select delivery_id from claim_announcement_delivery(60);");
      const failedLease = service(`select lease_token from announcement_delivery_outbox where delivery_id='${failedDeliveryId}';`);
      service(`select delivery_id from finish_announcement_delivery('${failedDeliveryId}','${failedLease}',false,null,null,null,'provider_failed',null);`);
      assert.equal(
        service(`select status from finalize_announcement_worker('${failedCampaignId}');`),
        "partially_failed",
      );
      assert.equal(
        service(`select status from retry_failed_announcement('${failedCampaignId}',3,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','stage5-retry');`),
        "sending",
      );
      assert.equal(
        service(`select delivery.status || ':' || outbox.queue_status || ':' || outbox.attempt_count from announcement_deliveries delivery join announcement_delivery_outbox outbox on outbox.delivery_id=delivery.id where delivery.announcement_id='${failedCampaignId}';`),
        "failed:pending:0",
        "retry resets only the dead outbox pair and preserves the durable delivery identity",
      );

      sql(lifecycleHardeningMigration);

      const updateOperationId = "67676767-6767-4676-8676-676767676767";
      const updatePayload = `jsonb_build_object(
        'title','Durable draft updated',
        'body','A replay-safe Stage 5 announcement draft update.',
        'category','general',
        'priority','normal',
        'audience_type','all',
        'audience_filter','{}'::jsonb,
        'delivery_policy','always_on',
        'email_enabled',false
      )`;
      assert.equal(
        service(
          `select (announcement->>'version') || ':' || replayed
           from execute_announcement_lifecycle_command(
             '${updateOperationId}','${durableDraftId}',1,'update_draft',
             'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',${updatePayload}
           );`,
        ),
        "2:false",
      );
      assert.equal(
        service(
          `select (announcement->>'version') || ':' || replayed
           from execute_announcement_lifecycle_command(
             '${updateOperationId}','${durableDraftId}',1,'update_draft',
             'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',${updatePayload}
           );`,
        ),
        "2:true",
        "an ambiguous response retry returns the exact stored result snapshot",
      );
      assert.match(
        service(
          `select announcement
           from execute_announcement_lifecycle_command(
             '${updateOperationId}','${durableDraftId}',1,'cancel',
             'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{}'::jsonb
           );`,
          true,
        ),
        /announcement_operation_id_conflict/i,
      );
      assert.match(
        service(
          `select id from update_announcement_draft(
             '${durableDraftId}',2,'Bypass','A bypass attempt must fail.',
             'general','normal','all','{}','always_on',false,
             'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bypass'
           );`,
          true,
        ),
        /permission denied/i,
      );
      assert.equal(
        service(
          `select count(*) from announcement_lifecycle_commands
           where operation_id='${updateOperationId}'
             and audit_event_id=(result_snapshot->>'moderation_audit_event_id')::uuid;`,
        ),
        "1",
      );

      const lifecycleDraftId = service(
        "select id from create_announcement_draft_idempotent('92929292-9292-4929-8929-929292929292','Lifecycle replay notice','Every lifecycle operation must replay its exact successful result.','general','normal','all','{}','always_on',false,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');",
      );
      const scheduledReplayAt = service("select (now()+interval '10 minutes')::text;");
      const scheduledReplayPayload = `jsonb_build_object('scheduled_for','${scheduledReplayAt}')`;
      const scheduledCommand = "93939393-9393-4939-8939-939393939393";
      assert.equal(
        service(
          `select (announcement->>'version') || ':' || replayed
           from execute_announcement_lifecycle_command(
             '${scheduledCommand}','${lifecycleDraftId}',1,'schedule',
             'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',${scheduledReplayPayload}
           );`,
        ),
        "2:false",
      );
      assert.equal(
        service(
          `select (announcement->>'version') || ':' || replayed
           from execute_announcement_lifecycle_command(
             '${scheduledCommand}','${lifecycleDraftId}',1,'schedule',
             'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',${scheduledReplayPayload}
           );`,
        ),
        "2:true",
      );
      for (const [action, expectedVersion, operationIdValue, expectedResultVersion] of [
        ["unschedule", 2, "94949494-9494-4949-8949-949494949494", 3],
        ["send", 3, "95959595-9595-4959-8959-959595959595", 4],
        ["cancel", 4, "96969696-9696-4969-8969-969696969696", 5],
      ]) {
        const statement = `select (announcement->>'version') || ':' || replayed
          from execute_announcement_lifecycle_command(
            '${operationIdValue}','${lifecycleDraftId}',${expectedVersion},'${action}',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{}'::jsonb
          );`;
        assert.equal(service(statement), `${expectedResultVersion}:false`);
        assert.equal(service(statement), `${expectedResultVersion}:true`);
      }

      const retryDeliveryId = service("select delivery_id from claim_announcement_delivery(60);");
      const retryLeaseToken = service(
        `select lease_token from announcement_delivery_outbox where delivery_id='${retryDeliveryId}';`,
      );
      service(
        `select delivery_id from finish_announcement_delivery(
          '${retryDeliveryId}','${retryLeaseToken}',false,null,null,null,
          'provider_failed_again',null
        );`,
      );
      const retryVersion = service(
        `select version from finalize_announcement_worker('${failedCampaignId}');`,
      );
      const retryCommand = "97979797-9797-4979-8979-979797979797";
      const retryStatement = `select (announcement->>'version') || ':' || replayed
        from execute_announcement_lifecycle_command(
          '${retryCommand}','${failedCampaignId}',${retryVersion},'retry',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{}'::jsonb
        );`;
      assert.equal(service(retryStatement), `${Number(retryVersion) + 1}:false`);
      assert.equal(service(retryStatement), `${Number(retryVersion) + 1}:true`);

      const oldestLowId = service(
        "select id from create_announcement_draft_idempotent('78787878-7878-4787-8787-787878787878','Oldest low notice','The oldest due campaign must not be starved.','general','low','all','{}','always_on',false,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');",
      );
      service(
        `select announcement->>'status'
         from execute_announcement_lifecycle_command(
           '89898989-8989-4898-8989-898989898989','${oldestLowId}',1,'schedule',
           'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
           jsonb_build_object('scheduled_for',(now()+interval '100 milliseconds')::text)
         );`,
      );
      service(`
        do $fairness$
        declare index_value integer; campaign_id uuid;
        begin
          for index_value in 1..21 loop
            select id into campaign_id
            from create_announcement_draft_idempotent(
              gen_random_uuid(),
              'New urgent notice ' || index_value,
              'New urgent work must not starve an older low-priority campaign.',
              'general','urgent','all','{}','always_on',false,
              'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
            );
            perform execute_announcement_lifecycle_command(
              gen_random_uuid(),campaign_id,1,'schedule',
              'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              jsonb_build_object('scheduled_for',(now()+interval '200 milliseconds')::text)
            );
          end loop;
        end
        $fairness$;
      `);
      sql("select pg_sleep(0.3);");
      assert.equal(service("select count(*) from activate_due_scheduled_announcements(10);"), "10");
      assert.equal(
        service(`select status from announcements where id='${oldestLowId}';`),
        "sending",
        "oldest due low-priority campaign must activate in the first bounded pass",
      );
      assert.equal(service("select count(*) from activate_due_scheduled_announcements(10);"), "10");
      assert.equal(service("select count(*) from activate_due_scheduled_announcements(10);"), "3");
      assert.equal(
        service("select count(*) from announcements where status='scheduled' and scheduled_for<=now();"),
        "0",
        "multiple bounded passes must drain more than one activation limit",
      );

      const demotionScheduledId = service(
        "select id from create_announcement_draft_idempotent('90909090-9090-4909-8909-909090909090','Delayed worker notice','The independent worker may activate this after the initiating admin is demoted.','general','normal','all','{}','always_on',false,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');",
      );
      service(
        `select announcement->>'status'
         from execute_announcement_lifecycle_command(
           '91919191-9191-4919-8919-919191919191','${demotionScheduledId}',1,'schedule',
           'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
           jsonb_build_object('scheduled_for',(now()+interval '100 milliseconds')::text)
         );`,
      );
      sql(
        "update auth.users set raw_app_meta_data='{}', banned_until=now()+interval '1 day' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';",
      );
      sql("select pg_sleep(0.2);");
      assert.equal(
        service("select count(*) from activate_due_scheduled_announcements(10);"),
        "1",
        "the worker activates due schedules after the initiating admin is demoted and banned",
      );
      assert.equal(service(`select status from announcements where id='${demotionScheduledId}';`), "sending");
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
      fixture.dispose();
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
