import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createPostgresFixture, postgresAvailable } from "./helpers/postgres-fixture.mjs";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260816171600_notification_realtime_safe_invalidation.sql",
    import.meta.url,
  ),
  "utf8",
);
const publicationCleanupMigration = await readFile(
  new URL(
    "../supabase/migrations/20260907180439_remove_notifications_from_realtime.sql",
    import.meta.url,
  ),
  "utf8",
);
const realtimeClient = await readFile(
  new URL("../src/lib/notification-realtime.mjs", import.meta.url),
  "utf8",
);

test("notification realtime subscribes only to recipient-safe signal inserts and updates", () => {
  assert.match(realtimeClient, /table: "notification_realtime_signals"/);
  assert.match(realtimeClient, /event: "INSERT"/);
  assert.match(realtimeClient, /event: "UPDATE"/);
  assert.match(realtimeClient, /filter: `recipient_user_id=eq\.\$\{userId\}`/);
  assert.doesNotMatch(realtimeClient, /table: "notifications"/);
  assert.doesNotMatch(realtimeClient, /table: "notification_preferences"/);
  assert.doesNotMatch(realtimeClient, /event: "\*"/);
});

test("migration publishes only the bounded content-free signal projection", () => {
  const signalDefinition = migration.slice(
    migration.indexOf("create table if not exists public.notification_realtime_signals"),
    migration.indexOf(");", migration.indexOf(
      "create table if not exists public.notification_realtime_signals",
    )) + 2,
  );

  assert.match(signalDefinition, /recipient_user_id uuid primary key/i);
  assert.match(signalDefinition, /version bigint not null default 1/i);
  assert.match(signalDefinition, /change_kind text not null/i);
  assert.match(signalDefinition, /emitted_at timestamptz not null/i);
  assert.doesNotMatch(
    signalDefinition,
    /notification_id|conversation_id|listing_id|message_id|metadata|reason|actor|content/i,
  );
  assert.match(migration, /on conflict \(recipient_user_id\) do update/i);
  assert.match(migration, /version = public\.notification_realtime_signals\.version \+ 1/i);
  assert.match(migration, /after insert or update or delete on public\.notifications/i);
  assert.match(migration, /after insert or update or delete on public\.notification_preferences/i);
  assert.match(migration, /grant select on table public\.notification_realtime_signals to authenticated/i);
  assert.match(migration, /revoke all on table public\.notification_realtime_signals[\s\S]*service_role/i);
  assert.match(migration, /alter publication supabase_realtime[\s\S]*add table public\.notification_realtime_signals/i);
  assert.doesNotMatch(migration, /add table public\.notifications\b/i);
  assert.doesNotMatch(migration, /add table public\.notification_preferences\b/i);
});

test(
  "PostgreSQL removes legacy notification publication while preserving recipient-safe invalidations",
  { skip: !postgresAvailable, timeout: 30_000 },
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
    const recipient = (userId, statement, expectFailure = false) => sql(
      `set role authenticated; set request.jwt.claims='{"role":"authenticated","sub":"${userId}"}';${statement}`,
      expectFailure,
    );
    const service = (statement, expectFailure = false) => sql(
      `set role service_role; set request.jwt.claims='{"role":"service_role"}';${statement}`,
      expectFailure,
    );

    const recipientA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const recipientB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const recipientC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

    try {
      sql(BOOTSTRAP_SQL);
      sql(migration);
      sql(migration, false);

      // Reproduce the live legacy membership that the signal migration alone retains.
      const publicationMembers = () => sql(`
        select string_agg(tablename, ',' order by tablename)
        from pg_publication_tables
        where pubname='supabase_realtime' and schemaname='public';
      `);
      assert.equal(
        publicationMembers(),
        "announcement_deliveries,message_reactions,messages,notification_realtime_signals,notifications,unrelated_realtime_member",
      );
      sql(publicationCleanupMigration);
      sql(publicationCleanupMigration);
      assert.equal(
        publicationMembers(),
        "announcement_deliveries,message_reactions,messages,notification_realtime_signals,unrelated_realtime_member",
      );
      assert.equal(
        service("select id || ':' || type from notifications where id=0;"),
        "0:messages",
      );
      assert.equal(
        sql("select tablename from pg_publication_tables where pubname='unrelated_publication';"),
        "notifications",
      );

      service(`insert into notifications(id,user_id,type) values (1,'${recipientA}','messages');`);
      service("update notifications set read_at=now() where id=1;");
      service(`update notifications set user_id='${recipientB}' where id=1;`);
      service("delete from notifications where id=1;");
      service(`insert into notification_preferences(user_id,notification_type) values ('${recipientA}','messages');`);
      service(`update notification_preferences set in_app_enabled=false where user_id='${recipientA}';`);
      service(`delete from notification_preferences where user_id='${recipientA}';`);

      assert.equal(
        recipient(
          recipientA,
          "select version || ':' || change_kind from notification_realtime_signals;",
        ),
        "6:delete",
      );
      assert.equal(
        recipient(
          recipientB,
          "select version || ':' || change_kind from notification_realtime_signals;",
        ),
        "2:delete",
      );
      assert.equal(
        recipient(recipientC, "select count(*) from notification_realtime_signals;"),
        "0",
      );

      assert.match(
        recipient(
          recipientA,
          `insert into notification_realtime_signals(recipient_user_id,change_kind) values ('${recipientA}','insert');`,
          true,
        ),
        /permission denied/i,
      );
      assert.match(
        recipient(
          recipientA,
          "update notification_realtime_signals set version=999;",
          true,
        ),
        /permission denied/i,
      );
      assert.match(
        service(
          `insert into notification_realtime_signals(recipient_user_id,change_kind) values ('${recipientC}','insert');`,
          true,
        ),
        /permission denied/i,
      );
      assert.match(
        sql(`delete from notification_realtime_signals where recipient_user_id='${recipientA}';`, true),
        /notification_realtime_signals_are_never_deleted/i,
      );
      assert.match(
        recipient(
          recipientA,
          `select private.bump_notification_realtime_signal('${recipientA}','insert');`,
          true,
        ),
        /permission denied/i,
      );

      sql("drop publication supabase_realtime;");
      sql(publicationCleanupMigration);
      assert.equal(sql("select count(*) from pg_publication where pubname='supabase_realtime';"), "0");
    } finally {
      fixture.dispose();
    }
  },
);

const BOOTSTRAP_SQL = String.raw`
create role postgres superuser;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema private;
create function auth.jwt() returns jsonb language sql stable
as $body$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $body$;
create function auth.uid() returns uuid language sql stable
as $body$ select nullif(coalesce(auth.jwt()->>'sub',''),'')::uuid $body$;
grant usage on schema auth to authenticated,service_role;
grant execute on function auth.jwt() to authenticated,service_role;
grant execute on function auth.uid() to authenticated,service_role;

create table public.notifications(
  id bigint primary key,
  user_id uuid not null,
  type text not null,
  read_at timestamptz
);
create table public.notification_preferences(
  user_id uuid not null,
  notification_type text not null,
  in_app_enabled boolean not null default true,
  primary key(user_id,notification_type)
);
create table public.unrelated_realtime_member(id bigint primary key);
create table public.messages(id bigint primary key);
create table public.message_reactions(id bigint primary key);
create table public.announcement_deliveries(id bigint primary key);
insert into public.notifications(id,user_id,type)
values (0,'cccccccc-cccc-4ccc-8ccc-cccccccccccc','messages');
create publication supabase_realtime for table public.notifications, public.messages,
  public.message_reactions, public.announcement_deliveries, public.unrelated_realtime_member;
create publication unrelated_publication for table public.notifications;
grant select,insert,update,delete on notifications to service_role;
grant select,insert,update,delete on notification_preferences to service_role;
`;
