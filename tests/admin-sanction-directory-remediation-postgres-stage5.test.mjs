import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createPostgresFixture, postgresAvailable } from "./helpers/postgres-fixture.mjs";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260816185025_harden_admin_sanction_actions_and_directory_search.sql",
    import.meta.url,
  ),
  "utf8",
);

test(
  "PostgreSQL replays exact sanction actions and exposes only a bounded service directory",
  { skip: !postgresAvailable, timeout: 45_000 },
  async (t) => {
    const fixture = createPostgresFixture(t, { username: "postgres" });

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
    const asService = (statement, expectFailure = false) => sql(
      `set role service_role;
       set request.jwt.claims='{"role":"service_role"}';
       ${statement}`,
      expectFailure,
    );

    const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const subject = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const fallbackModerator = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const metadataStaff = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const upholdSanction = "11111111-1111-4111-8111-111111111111";
    const revokeSanction = "22222222-2222-4222-8222-222222222222";
    const upholdOperation = "33333333-3333-4333-8333-333333333333";
    const revokeOperation = "44444444-4444-4444-8444-444444444444";

    try {
      sql(BOOTSTRAP_SQL);
      sql(`
        insert into auth.users(id,email,raw_app_meta_data,created_at,role) values
          ('${actor}','admin@georgebrown.ca','{"role":"admin"}',now(),'authenticated'),
          ('${subject}','target@georgebrown.ca','{"force_name_change":true}',now()-interval '2 days','authenticated'),
          ('${fallbackModerator}','fallback@georgebrown.ca','{}',now()-interval '3 days','moderator'),
          ('${metadataStaff}','metadata@georgebrown.ca','{"role":"staff"}',now()-interval '4 days','admin');
        insert into public.profiles(id,first_name,last_name,school) values
          ('${actor}','Admin','User','George Brown College'),
          ('${subject}','Target','Student','George Brown College');
        insert into public.user_status(user_id,is_banned) values
          ('${actor}',false),('${subject}',false);
        insert into public.moderation_sanctions(
          id,subject_user_id,subject_user_id_snapshot,issued_by_user_id,
          issued_by_user_id_snapshot,issued_by_role,source_report_id,sanction_type,
          review_status
        ) values
          ('${upholdSanction}','${subject}','${subject}','${actor}','${actor}','admin',null,'warning','pending'),
          ('${revokeSanction}','${subject}','${subject}','${actor}','${actor}','admin',null,'strike',null);
      `);
      sql(migration);

      const first = asUser(
        actor,
        `select sanction_id,audit_event_id,replayed
         from public.execute_moderation_sanction_action(
           '${upholdSanction}','uphold','The original warning remains appropriate.',null,'${upholdOperation}'
         );`,
      ).split("|");
      assert.equal(first[0], upholdSanction);
      assert.equal(first[2], "f");

      const replay = asUser(
        actor,
        `select sanction_id,audit_event_id,replayed
         from public.execute_moderation_sanction_action(
           '${upholdSanction}','uphold','The original warning remains appropriate.',null,'${upholdOperation}'
         );`,
      ).split("|");
      assert.deepEqual(replay, [upholdSanction, first[1], "t"]);
      assert.match(
        asUser(
          actor,
          `select * from public.execute_moderation_sanction_action(
             '${upholdSanction}','overturn','The warning should be overturned.',
             'The evidence no longer supports this warning.','${upholdOperation}'
           );`,
          true,
        ),
        /moderation_sanction_action_operation_conflict/,
      );
      assert.equal(
        sql(`select count(*) from public.moderation_audit_events
             where id='${first[1]}' and request_id='${upholdOperation}'
               and event_type='sanction.action_completed';`),
        "1",
      );

      const revoke = asUser(
        actor,
        `select sanction_id,audit_event_id,replayed
         from public.execute_moderation_sanction_action(
           '${revokeSanction}','revoke',null,
           'The strike was attached to the wrong account.','${revokeOperation}'
         );`,
      ).split("|");
      assert.equal(revoke[0], revokeSanction);
      assert.equal(revoke[2], "f");
      assert.equal(
        asUser(
          actor,
          `select replayed from public.execute_moderation_sanction_action(
             '${revokeSanction}','revoke',null,
             'The strike was attached to the wrong account.','${revokeOperation}'
           );`,
        ),
        "t",
      );

      assert.match(
        asUser(
          actor,
          `select public.revoke_moderation_sanction(
             '${revokeSanction}','Attempting the retired direct action path.'
           );`,
          true,
        ),
        /permission denied/i,
      );
      assert.match(
        asUser(actor, "select * from moderation_stage5_private.sanction_action_commands;", true),
        /permission denied/i,
      );

      assert.match(
        asUser(actor, "select public.list_admin_user_directory('', 'all', 1, 50);", true),
        /permission denied/i,
      );
      const directory = JSON.parse(asService(
        "select public.list_admin_user_directory('Target Student', 'standard', 1, 50);",
      ));
      assert.equal(directory.total, 1);
      assert.equal(directory.users.length, 1);
      assert.equal(directory.users[0].id, subject);
      assert.equal(directory.users[0].force_name_change, true);
      assert.equal(directory.scopeLimit, 5000);
      const fallbackDirectory = JSON.parse(asService(
        "select public.list_admin_user_directory('fallback@georgebrown.ca', 'moderator', 1, 50);",
      ));
      assert.equal(fallbackDirectory.total, 1);
      assert.equal(fallbackDirectory.users[0].id, fallbackModerator);
      assert.equal(fallbackDirectory.users[0].moderation_role, "moderator");
      const precedenceDirectory = JSON.parse(asService(
        "select public.list_admin_user_directory('metadata@georgebrown.ca', 'staff', 1, 50);",
      ));
      assert.equal(precedenceDirectory.total, 1);
      assert.equal(precedenceDirectory.users[0].id, metadataStaff);
      assert.equal(precedenceDirectory.users[0].moderation_role, "staff");
      assert.match(
        asService("select public.list_admin_user_directory('', 'all', 1, 51);", true),
        /admin_directory_query_is_invalid/,
      );
    } finally {
      fixture.dispose();
    }
  },
);

const BOOTSTRAP_SQL = String.raw`
create extension if not exists pgcrypto;
do $$ begin create role anon noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role service_role noinherit; exception when duplicate_object then null; end $$;
grant anon,authenticated,service_role to current_user;

create schema auth;
create schema moderation_action_private;
grant usage on schema auth,public to anon,authenticated,service_role;

create function auth.jwt() returns jsonb language sql stable
as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable
as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
create function auth.role() returns text language sql stable
as $$ select coalesce(nullif(auth.jwt()->>'role',''),'anon') $$;
grant execute on function auth.jwt(),auth.uid(),auth.role() to anon,authenticated,service_role;

create table auth.users(
  id uuid primary key,
  email text,
  raw_app_meta_data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz,
  banned_until timestamptz,
  role text not null default 'authenticated'
);
create table public.profiles(
  id uuid primary key,
  first_name text,
  last_name text,
  school text
);
create table public.user_status(
  user_id uuid primary key,
  is_banned boolean not null default false,
  banned_until timestamptz,
  ban_reason text,
  updated_at timestamptz not null default now()
);
create table public.moderation_sanctions(
  id uuid primary key,
  subject_user_id uuid,
  subject_user_id_snapshot uuid not null,
  issued_by_user_id uuid,
  issued_by_user_id_snapshot uuid,
  issued_by_role text,
  source_report_id uuid,
  sanction_type text not null,
  review_status text,
  revoked_at timestamptz,
  revocation_reason text,
  review_outcome_message text
);
create table public.moderation_audit_events(
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  actor_user_id uuid,
  actor_user_id_snapshot uuid,
  actor_role text,
  subject_user_id uuid,
  subject_user_id_snapshot uuid,
  sanction_id uuid,
  source_report_id uuid,
  resource_type text not null,
  resource_id uuid,
  summary text not null,
  metadata jsonb not null default '{}',
  request_id text,
  occurred_at timestamptz not null default now()
);

create function moderation_action_private.resolve_role_from_account(
  p_app_metadata jsonb,
  p_auth_role text
) returns text language plpgsql immutable security definer set search_path='' as $$
declare candidate text;
begin
  candidate:=lower(btrim(coalesce(p_app_metadata->>'role','')));
  if candidate in ('admin','moderator','staff') then return candidate; end if;
  if jsonb_typeof(p_app_metadata->'roles')='array' then
    select lower(btrim(role_value.value)) into candidate
    from jsonb_array_elements_text(p_app_metadata->'roles')
      with ordinality role_value(value,position)
    where lower(btrim(role_value.value)) in ('admin','moderator','staff')
    order by role_value.position limit 1;
    if candidate is not null then return candidate; end if;
  end if;
  candidate:=lower(btrim(coalesce(p_auth_role,'')));
  return case when candidate in ('admin','moderator','staff') then candidate else null end;
end $$;
alter function moderation_action_private.resolve_role_from_account(jsonb,text)
  owner to postgres;

create function moderation_action_private.require_sanction_actor(p_type text,p_operation text)
returns text language plpgsql security definer set search_path=''
as $$
declare actor_id uuid:=auth.uid(); actor_role text;
begin
  select lower(account.raw_app_meta_data->>'role') into actor_role
  from auth.users account where account.id=actor_id for update;
  if auth.role()<>'authenticated' or actor_role<>'admin' then
    raise exception using errcode='42501',message='moderation_actor_not_allowed';
  end if;
  return actor_role;
end $$;
create function moderation_action_private.assert_subject(p_subject uuid,p_role text,p_actor uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare target_role text;
begin
  select lower(account.raw_app_meta_data->>'role') into target_role
  from auth.users account where account.id=p_subject for update;
  if not found or p_subject=p_actor or target_role='admin' then
    raise exception using errcode='42501',message='moderation_subject_is_protected';
  end if;
end $$;
create function moderation_action_private.revoke_moderation_sanction_impl(uuid,text)
returns uuid language plpgsql security definer set search_path=''
as $$
declare result_id alias for $1;
begin
  update public.moderation_sanctions
  set revoked_at=statement_timestamp(),revocation_reason=btrim($2)
  where id=result_id and revoked_at is null;
  if not found then raise exception using errcode='P0002',message='not_revocable'; end if;
  return result_id;
end $$;
create function moderation_action_private.decide_moderation_sanction_review_impl(uuid,text,text,text,text)
returns uuid language plpgsql security definer set search_path=''
as $$
declare result_id alias for $1;
begin
  update public.moderation_sanctions
  set review_status=$2,review_outcome_message=btrim($3),
      revoked_at=case when $2='overturned' then statement_timestamp() else revoked_at end,
      revocation_reason=case when $2='overturned' then btrim($5) else revocation_reason end
  where id=result_id and review_status='pending' and revoked_at is null;
  if not found then raise exception using errcode='P0002',message='not_decidable'; end if;
  return result_id;
end $$;
alter function moderation_action_private.require_sanction_actor(text,text) owner to postgres;
alter function moderation_action_private.assert_subject(uuid,text,uuid) owner to postgres;
alter function moderation_action_private.revoke_moderation_sanction_impl(uuid,text) owner to postgres;
alter function moderation_action_private.decide_moderation_sanction_review_impl(uuid,text,text,text,text) owner to postgres;
revoke all on schema moderation_action_private from public,anon,authenticated,service_role;

create function public.revoke_moderation_sanction(uuid,text) returns uuid language sql
as $$ select moderation_action_private.revoke_moderation_sanction_impl($1,$2) $$;
create function public.decide_moderation_sanction_review(uuid,text,text,text,text) returns uuid language sql
as $$ select moderation_action_private.decide_moderation_sanction_review_impl($1,$2,$3,$4,$5) $$;
grant execute on function public.revoke_moderation_sanction(uuid,text) to authenticated;
grant execute on function public.decide_moderation_sanction_review(uuid,text,text,text,text) to authenticated;
`;
