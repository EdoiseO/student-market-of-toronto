import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260816192910_stage6_profile_registration_required_fields.sql",
  import.meta.url,
);
const migration = await readFile(migrationUrl, "utf8");

test("profile registration migration keeps trusted functions private and exact", () => {
  assert.match(migration, /event -> 'user' -> 'user_metadata' ->> 'first_name'/);
  assert.match(migration, /pg_catalog\.char_length\(normalized_first_name\) > 100/);
  assert.match(migration, /grant execute on function public\.before_user_created_enforce_toronto_school\(jsonb\)[\s\S]*to supabase_auth_admin/);
  assert.match(migration, /profile_identity_write_scope[\s\S]*force_name_change/);
  assert.match(migration, /caller_role text := coalesce\(auth\.jwt\(\) ->> 'role', ''\)/);
  assert.doesNotMatch(migration, /auth\.role\(\)/);
  assert.match(migration, /current_user = 'postgres'/);
  assert.match(migration, /new\.first_name is null[\s\S]*new\.last_name is null/);
  assert.match(migration, /from public\.profiles profile[\s\S]*where profile\.id = new\.id[\s\S]*for key share;[\s\S]*if found then[\s\S]*return new/);
  assert.match(migration, /create trigger enforce_profile_bio_length[\s\S]*update of bio/);
  assert.match(migration, /function profile_action_private\.save_profile_identity_impl/);
  assert.match(migration, /function public\.save_profile_identity_from_server[\s\S]*security invoker/);
  assert.match(migration, /grant execute on function public\.save_profile_identity_from_server[\s\S]*to service_role/);
  assert.match(migration, /from auth\.users account[\s\S]*for update;[\s\S]*from moderation_action_private\.force_name_operations[\s\S]*for update/);
  assert.match(migration, /created_at >[\s\S]*interval '15 minutes'[\s\S]*reconciliation_required/);
  assert.match(migration, /updated_at = pg_catalog\.statement_timestamp\(\)/);
  assert.doesNotMatch(migration, /grant execute on function private\./i);
});

const postgresBin = [
  process.env.POSTGRES_BIN,
  "/opt/homebrew/opt/postgresql@16/bin",
  "/usr/local/opt/postgresql@16/bin",
]
  .filter(Boolean)
  .find((candidate) => existsSync(join(candidate, "postgres")));

test(
  "PostgreSQL enforces registration/profile names and changed bios without trapping legacy rows",
  { skip: !postgresBin, timeout: 30_000 },
  async () => {
    const cluster = await mkdtemp(join(tmpdir(), "smot-stage6-profile-"));
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
    const startSqlSession = (statement, marker) => {
      const child = spawn(
        join(postgresBin, "psql"),
        [
          "-X", "-qAt", "-h", cluster, "-p", String(port), "-d", "postgres",
          "-v", "ON_ERROR_STOP=1",
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      let resolveMarker;
      let rejectMarker;
      const markerReached = new Promise((resolve, reject) => {
        resolveMarker = resolve;
        rejectMarker = reject;
      });
      const completed = new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code) => {
          if (code === 0) {
            resolve({ stdout, stderr });
          } else {
            reject(new Error(stderr || stdout || `psql exited ${code}`));
          }
        });
      });
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
        if (stdout.includes(marker)) {
          resolveMarker();
        }
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("close", (code) => {
        if (!stdout.includes(marker)) {
          rejectMarker(new Error(stderr || `marker ${marker} not reached; exit ${code}`));
        }
      });
      child.stdin.end(statement);
      return { markerReached, completed };
    };

    const validUser = "11111111-1111-4111-8111-111111111111";
    const legacyUser = "22222222-2222-4222-8222-222222222222";
    const recoveryUser = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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
      sql(`
        insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
        values ('${legacyUser}','legacy@georgebrown.ca','{}','{}');
        insert into public.profiles(id,first_name,last_name,school,bio)
        values ('${legacyUser}','Legacy','Student','George Brown College',repeat('x',1001));
      `);
      sql(migration);
      sql(`
        create trigger on_auth_user_created
        after insert on auth.users
        for each row execute function public.handle_new_user();

        create or replace function public.test_force_name_change(p_target uuid)
        returns void language plpgsql security definer set search_path=''
        as $body$
        begin
          perform pg_catalog.set_config('smot.profile_identity_target',p_target::text,true);
          perform pg_catalog.set_config('smot.profile_identity_write_scope','force_name_change',true);
          update public.profiles set first_name=null,last_name=null where id=p_target;
          perform pg_catalog.set_config('smot.profile_identity_write_scope','',true);
          perform pg_catalog.set_config('smot.profile_identity_target','',true);
        end
        $body$;
        alter function public.test_force_name_change(uuid) owner to postgres;
        revoke all on function public.test_force_name_change(uuid) from public,anon,authenticated,service_role;
      `);

      const validHook = sql(`
        set role supabase_auth_admin;
        select public.before_user_created_enforce_toronto_school(
          '{"user":{"email":"ada@georgebrown.ca","user_metadata":{"first_name":"Ada","last_name":"Lovelace"}}}'::jsonb
        );
      `);
      assert.equal(validHook, "{}");
      assert.equal(
        sql(`set role supabase_auth_admin; select public.before_user_created_enforce_toronto_school(
          jsonb_build_object('user',jsonb_build_object('email','ada@georgebrown.ca','user_metadata',jsonb_build_object(
            'first_name',repeat('a',49)||E'\\r\\n'||repeat('b',50),'last_name','Lovelace'
          )))
        );`),
        "{}",
      );
      assert.match(
        sql(`set role supabase_auth_admin; select public.before_user_created_enforce_toronto_school(
          '{"user":{"email":"ada@georgebrown.ca","user_metadata":{"first_name":" ","last_name":"Lovelace"}}}'::jsonb
        );`),
        /first and last name/i,
      );
      assert.match(
        sql(`set role supabase_auth_admin; select public.before_user_created_enforce_toronto_school(
          jsonb_build_object('user',jsonb_build_object('email','ada@georgebrown.ca','user_metadata',jsonb_build_object('first_name',E'\t\n','last_name','Lovelace')))
        );`),
        /first and last name/i,
      );
      assert.match(
        sql(`set role supabase_auth_admin; select public.before_user_created_enforce_toronto_school(
          '{"user":{"email":"ada@georgebrown.ca","user_metadata":{"first_name":123,"last_name":"Lovelace"}}}'::jsonb
        );`),
        /first and last name/i,
      );
      assert.match(
        sql(`set role supabase_auth_admin; select public.before_user_created_enforce_toronto_school(
          jsonb_build_object('user',jsonb_build_object('email','ada@georgebrown.ca','user_metadata',jsonb_build_object('first_name',repeat('😀',101),'last_name','Lovelace')))
        );`),
        /first and last name/i,
      );
      assert.match(
        sql(`set role supabase_auth_admin; select public.before_user_created_enforce_toronto_school(
          '{"user":{"email":"ada@example.com","user_metadata":{"first_name":"Ada","last_name":"Lovelace"}}}'::jsonb
        );`),
        /Toronto school email/i,
      );

      sql(`
        insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
        values (
          '${validUser}', 'ada@georgebrown.ca',
          '{"first_name":"  Ada ","last_name":" Lovelace  "}', '{}'
        );
      `);
      assert.equal(
        sql(`select first_name||':'||last_name||':'||school from public.profiles where id='${validUser}';`),
        "Ada:Lovelace:George Brown College",
      );
      sql(`set role authenticated;
        set request.jwt.claims='{"role":"authenticated","sub":"${validUser}"}';
        insert into public.profiles(id,first_name,last_name,school,bio)
        values ('${validUser}','Ignored','Identity','Forged school','Optional bio')
        on conflict(id) do update set bio=excluded.bio;`);
      assert.equal(
        sql(`select first_name||':'||last_name||':'||school||':'||bio
          from public.profiles where id='${validUser}';`),
        "Ada:Lovelace:George Brown College:Optional bio",
      );
      assert.match(
        sql(`set role authenticated;
          set request.jwt.claims='{"role":"authenticated","sub":"${validUser}"}';
          insert into public.profiles(id,first_name,last_name,school)
          values ('${validUser}','Forged','Identity','Forged school')
          on conflict(id) do update set first_name=excluded.first_name;`, true),
        /profile_identity_requires_trusted_api/i,
      );
      assert.match(
        sql(`set role authenticated;
          set request.jwt.claims='{"role":"authenticated","sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}';
          insert into public.profiles(id,first_name,last_name,school,bio)
          values (
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Missing','Profile',
            'George Brown College','No insert'
          );`, true),
        /profile_identity_requires_trusted_api/i,
      );
      sql(`set role service_role;
        set request.jwt.claims='{"role":"service_role"}';
        update public.profiles set first_name=E'A\\r\\nB',last_name=E'King\\rMaker'
        where id='${validUser}';`);
      assert.equal(
        sql(`select
          (strpos(first_name,E'\\r')=0 and strpos(first_name,E'\\n')>0
            and strpos(last_name,E'\\r')=0 and strpos(last_name,E'\\n')>0)::text
          from public.profiles where id='${validUser}';`),
        "true",
      );
      assert.match(
        sql(`insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
          values ('33333333-3333-4333-8333-333333333333','blank@georgebrown.ca','{"first_name":" ","last_name":"Student"}','{}');`, true),
        /profile_name_required/i,
      );
      assert.match(
        sql(`insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
          values ('44444444-4444-4444-8444-444444444444','long@georgebrown.ca',jsonb_build_object('first_name',repeat('😀',101),'last_name','Student'),'{}');`, true),
        /profile_name_too_long/i,
      );
      assert.match(
        sql(`insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
          values ('55555555-5555-4555-8555-555555555555','typed@georgebrown.ca','{"first_name":123,"last_name":"Student"}','{}');`, true),
        /profile_name_required/i,
      );

      assert.match(
        sql(`set role authenticated;
          set request.jwt.claims='{"role":"authenticated","sub":"${validUser}"}';
          update public.profiles set first_name='Changed' where id='${validUser}';`, true),
        /profile_identity_requires_trusted_api/i,
      );
      sql(`set role service_role;
        set request.jwt.claims='{"role":"service_role"}';
        update public.profiles
        set first_name='  Augusta ',last_name=' King  ',school='Forged school'
        where id='${validUser}';`);
      assert.equal(
        sql(`select first_name||':'||last_name||':'||school from public.profiles where id='${validUser}';`),
        "Augusta:King:George Brown College",
      );
      assert.match(
        sql(`set role service_role;
          set request.jwt.claims='{"role":"service_role"}';
          update public.profiles set first_name=E'\t\n',last_name='King' where id='${validUser}';`, true),
        /profile_name_required/i,
      );
      assert.match(
        sql(`set role service_role;
          set request.jwt.claims='{"role":"service_role"}';
          set smot.profile_identity_target='${validUser}';
          set smot.profile_identity_write_scope='force_name_change';
          update public.profiles set first_name=null,last_name=null where id='${validUser}';`, true),
        /profile_identity_scope_origin_invalid/i,
      );

      const rejectedFingerprint = "a".repeat(64);
      const acceptedFingerprint = "b".repeat(64);
      sql(`update auth.users
        set raw_app_meta_data=jsonb_build_object(
          'force_name_change',true,
          'force_name_change_rejected_name_fingerprint','${rejectedFingerprint}',
          'force_name_change_rejected_name_fingerprints',jsonb_build_array('${rejectedFingerprint}')
        ) where id='${validUser}';`);
      assert.match(
        sql(`set role authenticated;
          set request.jwt.claims='{"role":"authenticated","sub":"${validUser}"}';
          select public.save_profile_identity_from_server(
            '${validUser}','Allowed','Student','${acceptedFingerprint}'
          );`, true),
        /permission denied/i,
      );
      assert.match(
        sql(`set role service_role;
          set request.jwt.claims='{"role":"service_role"}';
          select profile_action_private.save_profile_identity_impl(
            '${validUser}','Allowed','Student','${acceptedFingerprint}'
          );`, true),
        /permission denied for schema profile_action_private/i,
      );
      assert.match(
        sql(`set role service_role;
          set request.jwt.claims='{"role":"service_role"}';
          select public.save_profile_identity_from_server(
            '${validUser}','Rejected','Student','${rejectedFingerprint}'
          );`, true),
        /profile_name_rejected/i,
      );
      assert.equal(
        sql(`set role service_role;
          set request.jwt.claims='{"role":"service_role"}';
          select public.save_profile_identity_from_server(
            '${validUser}',E'Allowed\\r\\nName','Student','${acceptedFingerprint}'
          );`),
        "t",
      );
      assert.equal(
        sql(`select
          (first_name=E'Allowed\\nName'
            and coalesce(raw_app_meta_data ? 'force_name_change',false)=false)::text
          from public.profiles profile
          join auth.users account on account.id=profile.id
          where profile.id='${validUser}';`),
        "true",
      );
      assert.equal(
        sql(`set role service_role;
          set request.jwt.claims='{"role":"service_role"}';
          select public.save_profile_identity_from_server(
            '${validUser}',E'Allowed\\nName','Student','${acceptedFingerprint}'
          );`),
        "f",
      );

      const concurrentRejectedFingerprint = "c".repeat(64);
      const concurrentAcceptedFingerprint = "d".repeat(64);
      const operationId = "66666666-6666-4666-8666-666666666666";
      const adminSession = startSqlSession(`
        begin;
        select id from auth.users where id='${validUser}' for update;
        insert into moderation_action_private.force_name_operations(
          id,subject_user_id_snapshot,status
        ) values ('${operationId}','${validUser}','pending');
        update auth.users set raw_app_meta_data=jsonb_build_object(
          'force_name_change',true,
          'force_name_change_rejected_name_fingerprints',jsonb_build_array('${concurrentRejectedFingerprint}')
        ) where id='${validUser}';
        \\echo FORCE_NAME_AUTH_LOCKED
        select pg_sleep(0.6);
        commit;
      `, "FORCE_NAME_AUTH_LOCKED");
      await adminSession.markerReached;
      assert.equal(
        sql(`set role service_role;
          set request.jwt.claims='{"role":"service_role"}';
          select public.save_profile_identity_from_server(
            '${validUser}','Concurrent','Replacement','${concurrentAcceptedFingerprint}'
          );`),
        "",
      );
      await adminSession.completed;
      assert.equal(
        sql(`select (raw_app_meta_data->'force_name_change'='true'::jsonb)::text
          from auth.users where id='${validUser}';`),
        "true",
      );
      sql(`update moderation_action_private.force_name_operations
        set status='completed' where id='${operationId}';
        select public.test_force_name_change('${validUser}');`);
      assert.equal(
        sql(`set role service_role;
          set request.jwt.claims='{"role":"service_role"}';
          select public.save_profile_identity_from_server(
            '${validUser}','Concurrent','Replacement','${concurrentAcceptedFingerprint}'
          );`),
        "t",
      );
      assert.equal(
        sql(`select (updated_at > '2000-01-01'::timestamptz)::text
          from auth.users where id='${validUser}';`),
        "true",
      );

      const staleOperationId = "77777777-7777-4777-8777-777777777777";
      const nameBeforeStaleAttempt = sql(`select first_name||':'||last_name
        from public.profiles where id='${validUser}';`);
      sql(`insert into moderation_action_private.force_name_operations(
          id,subject_user_id_snapshot,status,created_at,desired_metadata,rollback_metadata
        ) values (
          '${staleOperationId}','${validUser}','pending',now()-interval '16 minutes',
          jsonb_build_object(
            'force_name_change',true,
            'force_name_change_rejected_name_fingerprints',jsonb_build_array('${concurrentRejectedFingerprint}')
          ),
          '{}'::jsonb
        );
        update auth.users set raw_app_meta_data=jsonb_build_object(
          'force_name_change',true,
          'force_name_change_rejected_name_fingerprints',jsonb_build_array('${concurrentRejectedFingerprint}')
        ) where id='${validUser}';`);
      assert.equal(
        sql(`set role service_role;
          set request.jwt.claims='{"role":"service_role"}';
          select public.save_profile_identity_from_server(
            '${validUser}','Stale','Replacement','${acceptedFingerprint}'
          );`),
        "",
      );
      assert.equal(
        sql(`select status||':'||(completed_at is not null)::text
          from moderation_action_private.force_name_operations
          where id='${staleOperationId}';`),
        "aborted:true",
      );
      assert.equal(
        sql(`select first_name||':'||last_name from public.profiles where id='${validUser}';`),
        nameBeforeStaleAttempt,
      );
      assert.equal(
        sql(`select coalesce((raw_app_meta_data ? 'force_name_change')::text,'false')
          from auth.users where id='${validUser}';`),
        "false",
      );
      assert.equal(
        sql(`set role service_role;
          set request.jwt.claims='{"role":"service_role"}';
          select public.save_profile_identity_from_server(
            '${validUser}','Recovered','Replacement','${acceptedFingerprint}'
          );`),
        "f",
      );

      const mismatchedStaleOperationId = "88888888-8888-4888-8888-888888888888";
      const supersedingOperationId = "99999999-9999-4999-8999-999999999999";
      const unexpectedRejectedFingerprint = "e".repeat(64);
      sql(`insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
        values (
          '${recoveryUser}','recovery@georgebrown.ca',
          '{"first_name":"Recovery","last_name":"Subject"}', '{}'
        );
        insert into moderation_action_private.force_name_operations(
          id,subject_user_id_snapshot,status,created_at,desired_metadata,rollback_metadata
        ) values (
          '${mismatchedStaleOperationId}','${recoveryUser}','pending',now()-interval '16 minutes',
          jsonb_build_object(
            'force_name_change',true,
            'force_name_change_rejected_name_fingerprints',jsonb_build_array('${concurrentRejectedFingerprint}')
          ),
          '{}'::jsonb
        );
        update auth.users set raw_app_meta_data=jsonb_build_object(
          'force_name_change',true,
          'force_name_change_rejected_name_fingerprints',jsonb_build_array('${unexpectedRejectedFingerprint}')
        ) where id='${recoveryUser}';`);
      assert.equal(
        sql(`set role service_role;
          set request.jwt.claims='{"role":"service_role"}';
          select public.save_profile_identity_from_server(
            '${recoveryUser}','Still','Blocked','${acceptedFingerprint}'
          );`),
        "",
      );
      assert.equal(
        sql(`select status from moderation_action_private.force_name_operations
          where id='${mismatchedStaleOperationId}';`),
        "reconciliation_required",
      );
      assert.equal(
        sql(`set role service_role;
          set request.jwt.claims='{"role":"service_role"}';
          select public.save_profile_identity_from_server(
            '${recoveryUser}','Still','Blocked','${acceptedFingerprint}'
          );`),
        "",
      );
      sql(`insert into moderation_action_private.force_name_operations(
          id,subject_user_id_snapshot,status,created_at,completed_at,desired_metadata,rollback_metadata
        ) values (
          '${supersedingOperationId}','${recoveryUser}','completed',now(),now(),
          jsonb_build_object(
            'force_name_change',true,
            'force_name_change_rejected_name_fingerprints',jsonb_build_array('${unexpectedRejectedFingerprint}')
          ),
          '{}'::jsonb
        );
        select public.test_force_name_change('${recoveryUser}');`);
      assert.equal(
        sql(`set role service_role;
          set request.jwt.claims='{"role":"service_role"}';
          select public.save_profile_identity_from_server(
            '${recoveryUser}','App','Recovered','${acceptedFingerprint}'
          );`),
        "t",
      );
      assert.equal(
        sql(`select (first_name='App' and last_name='Recovered'
          and not (raw_app_meta_data ? 'force_name_change'))::text
          from public.profiles profile
          join auth.users account on account.id=profile.id
          where profile.id='${recoveryUser}';`),
        "true",
      );

      sql(`insert into public.user_status(user_id,is_banned,banned_until)
        values ('${validUser}',true,now()+interval '1 day');`);
      assert.match(
        sql(`set role service_role;
          set request.jwt.claims='{"role":"service_role"}';
          select public.save_profile_identity_from_server(
            '${validUser}','Blocked','Student','${acceptedFingerprint}'
          );`, true),
        /account_is_banned/i,
      );

      sql(`update public.profiles set avatar_url='https://example.test/avatar.png' where id='${legacyUser}';`);
      assert.equal(
        sql(`select char_length(bio) from public.profiles where id='${legacyUser}';`),
        "1001",
      );
      assert.match(
        sql(`update public.profiles set bio=repeat('y',1001) where id='${validUser}';`, true),
        /profile_bio_too_long/i,
      );
      sql(`update public.profiles
        set bio=repeat('x',499)||E'\\r\\n'||repeat('y',500)
        where id='${validUser}';`);
      assert.equal(
        sql(`select (char_length(bio)=1000 and strpos(bio,E'\\r')=0 and strpos(bio,E'\\n')>0)::text
          from public.profiles where id='${validUser}';`),
        "true",
      );
      sql(`select public.test_force_name_change('${legacyUser}');`);
      assert.equal(
        sql(`select (first_name is null and last_name is null)::text from public.profiles where id='${legacyUser}';`),
        "true",
      );
      sql(`update auth.users set raw_app_meta_data=jsonb_build_object(
        'force_name_change',true,
        'force_name_change_rejected_name_fingerprints','[]'::jsonb
      ) where id='${legacyUser}';`);
      assert.equal(
        sql(`set role service_role;
          set request.jwt.claims='{"role":"service_role"}';
          select public.save_profile_identity_from_server(
            '${legacyUser}','Legacy','Recovered','${acceptedFingerprint}'
          );`),
        "t",
      );
      assert.equal(
        sql(`select (first_name='Legacy' and last_name='Recovered'
          and char_length(bio)=1001)::text
          from public.profiles where id='${legacyUser}';`),
        "true",
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
create role supabase_auth_admin nologin;
create schema auth;
create schema private;
create schema moderation_action_private;
create function auth.jwt() returns jsonb language sql stable
as $body$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $body$;
create function auth.uid() returns uuid language sql stable
as $body$ select nullif(coalesce(auth.jwt()->>'sub',''),'')::uuid $body$;
create function auth.role() returns text language sql stable
as $body$ select nullif(coalesce(auth.jwt()->>'role',''),'') $body$;
grant usage on schema auth to authenticated,service_role;
grant execute on function auth.jwt(),auth.uid(),auth.role() to authenticated,service_role;

create table auth.users(
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data jsonb default '{}'::jsonb,
  updated_at timestamptz not null default '2000-01-01'::timestamptz
);
create table public.profiles(
  id uuid primary key,
  first_name text,
  last_name text,
  school text,
  bio text,
  avatar_url text
);
create table public.user_status(
  user_id uuid primary key,
  is_banned boolean not null default false,
  banned_until timestamptz
);
create table moderation_action_private.force_name_operations(
  id uuid primary key,
  subject_user_id_snapshot uuid not null,
  status text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  desired_metadata jsonb not null default '{}'::jsonb,
  rollback_metadata jsonb not null default '{}'::jsonb
);
grant select,insert,update on public.profiles to authenticated,service_role;
grant select,insert,update on auth.users to service_role;

create function private.toronto_school_name_for_email(p_email text)
returns text language sql immutable set search_path=''
as $body$
  select case when lower(split_part(coalesce(p_email,''),'@',2))='georgebrown.ca'
    then 'George Brown College' else null end
$body$;
alter function private.toronto_school_name_for_email(text) owner to postgres;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.toronto_school_name_for_email(text) to supabase_auth_admin;

create function moderation_action_private.assert_profile_name_scope_origin()
returns trigger language plpgsql security invoker set search_path=''
as $body$
begin
  if coalesce(current_setting('smot.profile_identity_write_scope',true),'')='force_name_change'
    and current_user<>'postgres' then
    raise exception using errcode='42501',message='profile_identity_scope_origin_invalid';
  end if;
  return new;
end
$body$;
alter function moderation_action_private.assert_profile_name_scope_origin() owner to postgres;
create trigger a0_assert_profile_name_scope_origin before update on public.profiles
for each row execute function moderation_action_private.assert_profile_name_scope_origin();
`;
