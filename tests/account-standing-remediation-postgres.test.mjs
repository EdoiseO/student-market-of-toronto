import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createPostgresFixture, postgresAvailable } from "./helpers/postgres-fixture.mjs";

const migrationUrl = new URL(
  "../supabase/migrations/20260816171400_harden_account_standing_lifecycle.sql",
  import.meta.url,
);
const migration = await readFile(migrationUrl, "utf8");

test("standing remediation keeps actions lifecycle-bounded and summary RLS-invoker scoped", () => {
  assert.match(migration, /moderation_action_private\.acknowledge_moderation_sanction_impl/);
  assert.match(migration, /sanction\.revoked_at is null/);
  assert.match(migration, /sanction\.expires_at is null or sanction\.expires_at > action_at/);
  assert.match(migration, /sanction\.review_status is null[\s\S]*sanction\.review_status = 'pending'/);
  assert.match(migration, /create function public\.get_account_standing_summary\(\)/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /from public\.user_moderation_notices notice/);
  assert.match(migration, /from public\.user_status status/);
  assert.match(
    migration,
    /revoke all on function public\.get_account_standing_summary\(\)[\s\S]*public, anon, authenticated, service_role/,
  );
  assert.match(
    migration,
    /grant execute on function public\.get_account_standing_summary\(\)[\s\S]*to authenticated/,
  );
  const summaryFunction = migration.slice(
    migration.indexOf("create function public.get_account_standing_summary()"),
  );
  assert.doesNotMatch(summaryFunction, /security definer/i);
});

test(
  "PostgreSQL rejects non-effective sanction actions and returns complete own-only summaries",
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
    const asUser = (userId, statement, expectFailure = false) => sql(
      `set role authenticated;
       set request.jwt.claims='{"role":"authenticated","sub":"${userId}"}';
       ${statement}`,
      expectFailure,
    );

    const subject = "11111111-1111-4111-8111-111111111111";
    const other = "22222222-2222-4222-8222-222222222222";
    const ids = {
      active: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      expired: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
      revoked: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
      terminal: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
      reviewable: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5",
      expiredReview: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6",
      revokedReview: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7",
    };

    try {
      sql(BOOTSTRAP_SQL);
      sql(migration);

      sql(`
        insert into auth.users(id) values ('${subject}'), ('${other}');
        insert into public.user_status(user_id,is_banned) values
          ('${subject}',false),('${other}',false);

        insert into public.moderation_sanctions(
          id,subject_user_id,subject_user_id_snapshot,sanction_type,strike_points,
          restrictions,starts_at,expires_at,acknowledgement_required,
          acknowledged_at,revoked_at,review_requested_at,review_status
        ) values
          ('${ids.active}','${subject}','${subject}','strike',2,'{"messaging":"blocked"}',now()-interval '1 day',now()+interval '1 day',true,null,null,null,null),
          ('${ids.expired}','${subject}','${subject}','warning',null,'{}',now()-interval '2 days',now()-interval '1 day',true,null,null,null,null),
          ('${ids.revoked}','${subject}','${subject}','warning',null,'{}',now()-interval '1 day',null,true,null,now(),null,null),
          ('${ids.terminal}','${subject}','${subject}','warning',null,'{}',now()-interval '1 day',null,true,null,null,now()-interval '1 hour','upheld'),
          ('${ids.reviewable}','${subject}','${subject}','warning',null,'{}',now()-interval '1 day',null,true,null,null,null,null),
          ('${ids.expiredReview}','${subject}','${subject}','warning',null,'{}',now()-interval '2 days',now()-interval '1 day',false,null,null,null,null),
          ('${ids.revokedReview}','${subject}','${subject}','warning',null,'{}',now()-interval '1 day',null,false,null,now(),null,null);

        insert into public.moderation_sanctions(
          id,subject_user_id,subject_user_id_snapshot,sanction_type,strike_points,
          restrictions,starts_at,expires_at,acknowledgement_required
        )
        select gen_random_uuid(),'${subject}','${subject}','warning',null,'{}',
          now()-interval '1 day',null,false
        from generate_series(1,24);

        insert into public.moderation_sanctions(
          id,subject_user_id,subject_user_id_snapshot,sanction_type,strike_points,
          restrictions,starts_at,expires_at,acknowledgement_required
        ) values (
          gen_random_uuid(),'${other}','${other}','strike',3,
          '{"listings":"blocked"}',now()-interval '1 day',null,true
        );
      `);

      assert.equal(
        asUser(subject, `select acknowledge_moderation_sanction('${ids.active}');`),
        "t",
      );
      assert.match(
        asUser(subject, `select acknowledge_moderation_sanction('${ids.expired}');`, true),
        /moderation_sanction_not_acknowledgeable/i,
      );
      assert.match(
        asUser(subject, `select acknowledge_moderation_sanction('${ids.revoked}');`, true),
        /moderation_sanction_not_acknowledgeable/i,
      );
      assert.match(
        asUser(subject, `select acknowledge_moderation_sanction('${ids.terminal}');`, true),
        /moderation_sanction_not_acknowledgeable/i,
      );
      assert.match(
        asUser(other, `select acknowledge_moderation_sanction('${ids.reviewable}');`, true),
        /moderation_sanction_not_acknowledgeable/i,
      );

      assert.equal(
        asUser(subject, `select request_moderation_sanction_review('${ids.reviewable}');`),
        "t",
      );
      assert.match(
        asUser(subject, `select request_moderation_sanction_review('${ids.expiredReview}');`, true),
        /moderation_sanction_review_not_requestable/i,
      );
      assert.match(
        asUser(subject, `select request_moderation_sanction_review('${ids.revokedReview}');`, true),
        /moderation_sanction_review_not_requestable/i,
      );

      const summary = asUser(
        subject,
        "select active_notice_count||':'||strike_points||':'||needs_acknowledgement||':'||pending_reviews||':'||has_active_restrictions||':'||has_active_ban from get_account_standing_summary();",
      );
      assert.equal(summary, "27:2:1:1:true:false");
      assert.equal(
        asUser(
          other,
          "select active_notice_count||':'||strike_points||':'||needs_acknowledgement||':'||has_active_restrictions from get_account_standing_summary();",
        ),
        "1:3:1:true",
        "the invoker summary must remain scoped to the authenticated subject",
      );
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
create schema moderation_action_private;
create table auth.users(id uuid primary key);
create function auth.jwt() returns jsonb language sql stable
as $body$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $body$;
create function auth.uid() returns uuid language sql stable
as $body$ select nullif(coalesce(auth.jwt()->>'sub',''),'')::uuid $body$;
create function auth.role() returns text language sql stable
as $body$ select nullif(coalesce(auth.jwt()->>'role',''),'') $body$;
grant usage on schema auth to authenticated;
grant execute on function auth.jwt() to authenticated;
grant execute on function auth.uid() to authenticated;
grant execute on function auth.role() to authenticated;

create table public.user_status(
  user_id uuid primary key references auth.users(id),
  is_banned boolean not null default false,
  banned_until timestamptz
);
create table public.moderation_sanctions(
  id uuid primary key,
  subject_user_id uuid references auth.users(id),
  subject_user_id_snapshot uuid not null,
  sanction_type text not null,
  strike_points smallint,
  restrictions jsonb not null default '{}'::jsonb,
  starts_at timestamptz not null,
  expires_at timestamptz,
  acknowledgement_required boolean not null default true,
  acknowledged_at timestamptz,
  acknowledged_by_user_id uuid,
  acknowledged_by_user_id_snapshot uuid,
  revoked_at timestamptz,
  review_requested_at timestamptz,
  review_status text,
  replacement_sanction_id uuid
);
alter table public.user_status enable row level security;
alter table public.moderation_sanctions enable row level security;
create policy user_status_select_own on public.user_status for select to authenticated
  using(user_id=auth.uid());
create policy moderation_sanctions_select_own on public.moderation_sanctions for select to authenticated
  using(subject_user_id=auth.uid());
grant select on public.user_status to authenticated;
grant select on public.moderation_sanctions to authenticated;

create view public.user_moderation_notices
with (security_invoker=true, security_barrier=true)
as select
  sanction_type,strike_points,restrictions,acknowledgement_required,
  acknowledged_at,review_status,
  case
    when revoked_at is not null then 'revoked'
    when expires_at is not null and expires_at <= now() then 'expired'
    when acknowledged_at is not null then 'acknowledged'
    else 'active'
  end as lifecycle_state
from public.moderation_sanctions;
grant select on public.user_moderation_notices to authenticated;

create function moderation_action_private.acknowledge_moderation_sanction_impl(uuid)
returns boolean language sql security definer set search_path=''
as $body$ select false $body$;
create function moderation_action_private.request_moderation_sanction_review_impl(uuid)
returns boolean language sql security definer set search_path=''
as $body$ select false $body$;
alter function moderation_action_private.acknowledge_moderation_sanction_impl(uuid) owner to postgres;
alter function moderation_action_private.request_moderation_sanction_review_impl(uuid) owner to postgres;
grant execute on function moderation_action_private.acknowledge_moderation_sanction_impl(uuid) to authenticated;
grant execute on function moderation_action_private.request_moderation_sanction_review_impl(uuid) to authenticated;
revoke all on schema moderation_action_private from public,anon,authenticated,service_role;

create function public.acknowledge_moderation_sanction(p_sanction_id uuid)
returns boolean language sql security invoker set search_path=''
begin atomic
  select moderation_action_private.acknowledge_moderation_sanction_impl(p_sanction_id);
end;
create function public.request_moderation_sanction_review(p_sanction_id uuid)
returns boolean language sql security invoker set search_path=''
begin atomic
  select moderation_action_private.request_moderation_sanction_review_impl(p_sanction_id);
end;
grant execute on function public.acknowledge_moderation_sanction(uuid) to authenticated;
grant execute on function public.request_moderation_sanction_review(uuid) to authenticated;
`;
