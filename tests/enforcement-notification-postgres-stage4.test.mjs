import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260816165454_enforcement_notification_lifecycle.sql",
    import.meta.url,
  ),
  "utf8",
);
const postgresBin = [
  process.env.POSTGRES_BIN,
  "/opt/homebrew/opt/postgresql@16/bin",
  "/usr/local/opt/postgresql@16/bin",
]
  .filter(Boolean)
  .find((candidate) => existsSync(join(candidate, "postgres")));

test(
  "PostgreSQL keeps enforcement notifications recipient-safe and durable",
  { skip: !postgresBin, timeout: 30_000 },
  async () => {
    const cluster = await mkdtemp(join(tmpdir(), "smot-en4-"));
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
    const recipient = (statement, expectFailure = false) =>
      sql(
        `set role authenticated; set request.jwt.claims='{"role":"authenticated","sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}';${statement}`,
        expectFailure,
      );
    const service = (statement, expectFailure = false) =>
      sql(
        `set role service_role; set request.jwt.claims='{"role":"service_role"}';${statement}`,
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
      sql(migration);

      sql(`
        insert into public.moderation_sanctions(
          id, subject_user_id, sanction_type, severity
        ) values (
          '11111111-1111-4111-8111-111111111111',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          'warning',
          'high'
        );
      `);

      assert.equal(
        recipient(
          "select type || ':' || (metadata->>'event') || ':' || (select count(*) from jsonb_object_keys(metadata)) from notifications;",
        ),
        "moderation_warning:issued:4",
      );
      assert.equal(
        recipient(
          "select metadata ?| array['internal_note','reason_code','user_message','issued_by_user_id'] from notifications;",
        ),
        "f",
      );

      const notificationId = recipient("select id from notifications;");
      recipient(
        `update notifications set read_at='2099-01-01', dismissed_at='2099-01-01' where id='${notificationId}';`,
      );
      assert.equal(
        recipient(
          `select read_at < '2099-01-01' and dismissed_at < '2099-01-01' and read_at is not null and dismissed_at is not null from notifications where id='${notificationId}';`,
        ),
        "t",
        "recipient-provided timestamps must be replaced by database time",
      );
      assert.match(
        recipient(
          `update notifications set dismissed_at=null where id='${notificationId}';`,
          true,
        ),
        /enforcement_notification_dismissal_is_one_way/i,
      );
      assert.match(
        recipient(
          `update notifications set metadata='{"event":"tampered"}' where id='${notificationId}';`,
          true,
        ),
        /enforcement_notification_core_is_immutable/i,
      );
      assert.match(
        recipient(`delete from notifications where id='${notificationId}';`, true),
        /enforcement_notifications_are_not_deleted_on_dismiss/i,
      );

      sql(`
        update moderation_sanctions
        set review_status='upheld'
        where id='11111111-1111-4111-8111-111111111111';
      `);
      assert.equal(
        recipient(
          "select count(*) from notifications where type='moderation_review_update' and metadata->>'event'='review_upheld';",
        ),
        "1",
      );
      assert.match(
        sql(
          `insert into notifications(user_id,type,read_at) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','moderation_strike',now());`,
          true,
        ),
        /enforcement_notification_lifecycle_must_start_empty/i,
      );

      assert.equal(
        service(`delete from notifications where id='${notificationId}' returning type;`),
        "moderation_warning",
        "service-owned account cleanup remains possible",
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
create role postgres superuser;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema private;
create table auth.users(id uuid primary key);
create function auth.jwt() returns jsonb language sql stable
as $body$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $body$;
create function auth.uid() returns uuid language sql stable
as $body$ select nullif(coalesce(auth.jwt()->>'sub',''),'')::uuid $body$;
create function auth.role() returns text language sql stable
as $body$ select nullif(coalesce(auth.jwt()->>'role',''),'') $body$;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on function auth.jwt() to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
grant execute on function auth.role() to anon,authenticated,service_role;

create table public.notifications(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  conversation_id uuid,
  message_id uuid,
  listing_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  constraint notifications_type_check check(type in (
    'message','messages','announcement','favourite_sold','favourite_unavailable',
    'favourite_price_change','listing_sold','listing_approved','listing_rejected',
    'moderator_role_granted'
  ))
);
create table public.moderation_sanctions(
  id uuid primary key,
  subject_user_id uuid references auth.users(id) on delete set null,
  sanction_type text not null,
  severity text not null,
  review_status text,
  revoked_at timestamptz
);
insert into auth.users(id) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

alter table notifications enable row level security;
create policy notifications_select_own on notifications for select to authenticated
  using(user_id=auth.uid());
create policy notifications_update_own on notifications for update to authenticated
  using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy notifications_delete_own on notifications for delete to authenticated
  using(user_id=auth.uid());
grant select,update,delete on notifications to authenticated;
grant select,insert,update,delete on notifications to service_role;
`;
