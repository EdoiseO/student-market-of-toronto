import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

const foundation = await readFile(
  new URL(
    "../supabase/migrations/20260816061431_moderation_enforcement_foundation.sql",
    import.meta.url,
  ),
  "utf8",
);
const migration = await readFile(
  new URL(
    "../supabase/migrations/20260816081857_trusted_moderation_action_rpcs.sql",
    import.meta.url,
  ),
  "utf8",
);
const stage6ModerationFoundation = await readFile(
  new URL(
    "../supabase/migrations/20260816193317_moderation_decision_requirements_foundation.sql",
    import.meta.url,
  ),
  "utf8",
);
const moderatorNoteTimelineMigration = await readFile(
  new URL(
    "../supabase/migrations/20260817121744_append_only_report_moderator_notes.sql",
    import.meta.url,
  ),
  "utf8",
);

test("trusted moderation RPCs resolve live actors and remove broad service writes", () => {
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /from auth\.users account/);
  assert.match(migration, /moderation_action_not_permitted/);
  assert.match(migration, /moderation_actor_is_banned/);
  assert.match(migration, /moderation_subject_is_protected/);
  assert.match(migration, /moderation_auth_ban_must_be_applied_first/);
  assert.match(migration, /moderation_auth_ban_must_be_cleared_first/);
  assert.match(migration, /insert into public\.moderation_sanctions/);
  assert.match(migration, /insert into public\.user_status/);
  assert.match(
    migration,
    /revoke insert, update, delete, truncate\s+on table public\.moderation_sanctions from service_role/i,
  );
  assert.match(
    migration,
    /revoke insert, update, delete, truncate\s+on table public\.user_status from service_role/i,
  );
  assert.match(
    migration,
    /revoke insert, update, delete, truncate\s+on table public\.moderation_audit_events from service_role/i,
  );
});

test("review modification creates and links its replacement in one database function", () => {
  const start = migration.indexOf("create or replace function public.modify_moderation_sanction_review");
  const end = migration.indexOf("alter function public.issue_moderation_warning", start);
  const body = migration.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(body, /for update/);
  assert.match(body, /supersedes_sanction_id/);
  assert.match(body, /returning id into replacement_id/);
  assert.match(body, /review_status = 'modified'/);
  assert.match(body, /replacement_sanction_id = replacement_id/);
  assert.match(body, /revocation_kind = 'revoked'/);
});

test("admin routes use explicit action permissions and trusted RPC attribution", async () => {
  const [
    banRoute,
    reportsRoute,
    listingRoute,
    usersClient,
    reportsClient,
    listingClient,
  ] = await Promise.all([
    readFile(new URL("../src/app/api/admin/users/[userId]/ban/route.js", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/admin/reports/actions/route.js", import.meta.url), "utf8"),
    readFile(
      new URL("../src/app/api/admin/listings/[listingId]/decision/route.js", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/components/admin-users-management.jsx", import.meta.url), "utf8"),
    readFile(
      new URL("../src/components/admin-report-review-content.jsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/components/admin-listing-approval-review-content.jsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(banRoute, /rpc\(\s*"set_application_moderation_ban"/);
  assert.match(banRoute, /UUID_PATTERN\.test\(operationId\)/);
  assert.match(banRoute, /requestId = operationId/);
  assert.match(usersClient, /banOperationRef/);
  assert.match(usersClient, /operationId: crypto\.randomUUID\(\)/);
  assert.match(usersClient, /operationId: banOperationRef\.current\.operationId/);
  assert.match(banRoute, /body\.revocationReason/);
  assert.match(banRoute, /p_revocation_reason: input\.revocationReason/);
  assert.doesNotMatch(banRoute, /from\("user_status"\)\.upsert/);
  assert.doesNotMatch(banRoute, /updateUserById[\s\S]*ban_duration/);
  assert.match(reportsRoute, /MODERATION_ACTIONS\.decideReports/);
  assert.match(reportsRoute, /MODERATION_ACTIONS\.decideListings/);
  assert.match(reportsRoute, /MODERATION_ACTIONS\.triageReports/);
  assert.match(reportsRoute, /supabase\.rpc\("decide_report_set_with_summary"/);
  assert.match(reportsRoute, /"remove_reported_listing_with_rationale"/);
  assert.match(reportsRoute, /"begin_force_name_operation_with_rationale"/);
  assert.match(reportsRoute, /"complete_force_name_operation_with_rationale"/);
  assert.match(reportsRoute, /"abort_force_name_operation"/);
  assert.match(reportsRoute, /UUID_PATTERN\.test\(operationId\)/);
  assert.match(reportsClient, /forceNameOperationRef/);
  assert.match(reportsClient, /operationId: crypto\.randomUUID\(\)/);
  assert.match(reportsClient, /reportStatusOperationRef/);
  assert.match(reportsClient, /removeListingOperationRef/);
  assert.match(migration, /create (?:or replace )?function public\.decide_report_set/);
  assert.match(migration, /create (?:or replace )?function public\.remove_reported_listing/);
  assert.match(migration, /for update/);
  assert.match(migration, /'reports\.decided'/);
  assert.match(migration, /'listing\.removed_after_reports'/);
  assert.match(listingRoute, /MODERATION_ACTIONS\.decideListings/);
  assert.match(listingRoute, /UUID_PATTERN\.test\(operationId\.trim\(\)\)/);
  assert.doesNotMatch(listingRoute, /from\("notifications"\)\.insert/);
  assert.doesNotMatch(listingRoute, /insertListingDecisionNotification/);
  assert.match(migration, /listing_decision_notification_id/);
  assert.match(migration, /insert into public\.notifications/);
  assert.match(migration, /moderation_operation_id/);
  assert.match(listingClient, /decisionOperationRef/);
  assert.match(listingClient, /operationId: crypto\.randomUUID\(\)/);
  assert.match(listingRoute, /supabase\.rpc\(/);
  assert.doesNotMatch(listingRoute, /p_moderator_id/);
  assert.match(migration, /drop function if exists public\.decide_listing_moderation\([\s\S]*uuid\s*\);/i);
  assert.match(migration, /create function public\.decide_listing_moderation[\s\S]*security invoker/);
  assert.match(migration, /begin atomic/);
  assert.match(migration, /listing_moderation_history/);
  assert.match(migration, /'listing\.moderation_decided'/);
  assert.doesNotMatch(listingRoute, /insertModerationHistory/);
});

const postgresBin = [
  process.env.POSTGRES_BIN,
  "/opt/homebrew/opt/postgresql@16/bin",
  "/usr/local/opt/postgresql@16/bin",
]
  .filter(Boolean)
  .find((candidate) => existsSync(join(candidate, "postgres")));

const BOOTSTRAP_SQL = String.raw`
create role postgres superuser;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema private;
create function auth.jwt() returns jsonb language sql stable
  as $body$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $body$;
create function auth.uid() returns uuid language sql stable
  as $body$ select nullif(coalesce(auth.jwt() ->> 'sub', ''), '')::uuid $body$;
create function auth.role() returns text language sql stable
  as $body$ select coalesce(auth.jwt() ->> 'role', '') $body$;
grant usage on schema auth to authenticated, service_role;
grant execute on function auth.jwt() to authenticated, service_role;
grant execute on function auth.uid() to authenticated, service_role;
grant execute on function auth.role() to authenticated, service_role;

create table auth.users (
  id uuid primary key,
  raw_app_meta_data jsonb not null default '{}',
  role text,
  banned_until timestamptz
);
create table public.reports (
  id uuid primary key,
  reported_user_id uuid references auth.users(id),
  subject_type text,
  subject_id uuid,
  listing_id uuid,
  message_id uuid,
  status text default 'open',
  reviewed_by uuid,
  reviewed_at timestamptz
);
create table public.listings (
  id uuid primary key,
  seller_id uuid not null references auth.users(id),
  slug text not null,
  title text not null,
  description text not null default '',
  price numeric not null default 0,
  previous_price numeric,
  category text,
  condition text,
  location text,
  is_negotiable boolean not null default false,
  status text not null,
  submitted_for_review_at timestamptz,
  moderation_feedback text,
  moderation_reviewed_at timestamptz,
  moderation_reviewed_by uuid,
  content_revision bigint not null default 1,
  retired_at timestamptz
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  type text not null,
  listing_id uuid references public.listings(id),
  metadata jsonb not null default '{}'::jsonb
);
create table public.listing_moderation_history(
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id),
  action text not null,
  feedback text,
  decided_by uuid,
  decided_at timestamptz not null
);
create table public.profiles(
  id uuid primary key references auth.users(id),
  first_name text,
  last_name text,
  school text
);
create function private.toronto_school_name_for_email(text) returns text
language sql immutable as $$ select 'School'::text $$;
`;

test(
  "PostgreSQL enforces actor roles, Auth-first bans, atomic reviews, and trusted listing decisions",
  { skip: !postgresBin, timeout: 40_000 },
  async () => {
    const cluster = await mkdtemp(join(tmpdir(), "smot-moderation-stage3-"));
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
    const asUser = (userId, statement, expectFailure = false) =>
      sql(
        `set role authenticated; set request.jwt.claims='{"role":"authenticated","sub":"${userId}"}';${statement}`,
        expectFailure,
      );
    const service = (statement, expectFailure = false) =>
      sql(
        `set role service_role; set request.jwt.claims='{"role":"service_role"}';${statement}`,
        expectFailure,
      );
    const asyncAsUser = (userId, statement) =>
      new Promise((resolve, reject) => {
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
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.on("error", reject);
        child.on("close", (code) => {
          if (code === 0) {
            resolve(stdout.trim());
          } else {
            reject(new Error(stderr || stdout));
          }
        });
        child.stdin.end(
          `set role authenticated; set request.jwt.claims='{"role":"authenticated","sub":"${userId}"}';${statement}`,
        );
      });
    const delay = (milliseconds) => new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });

    const admin = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const moderator = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const staff = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const subject = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const protectedAdmin = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const report = "11111111-1111-4111-8111-111111111111";
    const listing = "22222222-2222-4222-8222-222222222222";
    const secondListing = "22222222-2222-4222-8222-222222222223";
    const failedNotificationListing = "22222222-2222-4222-8222-222222222224";
    const listingReportOne = "33333333-3333-4333-8333-333333333333";
    const listingReportTwo = "44444444-4444-4444-8444-444444444444";
    const profileReportOne = "55555555-5555-4555-8555-555555555555";
    const profileReportTwo = "66666666-6666-4666-8666-666666666666";
    const sagaSubject = "77777777-7777-4777-8777-777777777777";
    const forceSubject = "88888888-8888-4888-8888-888888888888";
    const forceReportOne = "99999999-9999-4999-8999-999999999991";
    const forceReportTwo = "99999999-9999-4999-8999-999999999992";
    const mixedRoleActor = "99999999-9999-4999-8999-999999999993";
    const promotedSubject = "99999999-9999-4999-8999-999999999994";
    const demotionSubject = "99999999-9999-4999-8999-999999999995";
    const banCompleteRaceSubject = "99999999-9999-4999-8999-999999999996";
    const banAbortRaceSubject = "99999999-9999-4999-8999-999999999997";
    const forceCompleteRaceSubject = "99999999-9999-4999-8999-999999999998";
    const forceAbortRaceSubject = "99999999-9999-4999-8999-999999999999";
    const forceCompleteRaceReport = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
    const forceAbortRaceReport = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb";
    const stage6DecisionReport = "cccccccc-1111-4111-8111-cccccccccccc";
    const stage6DecisionRequest = "dddddddd-1111-4111-8111-dddddddddddd";
    const stage6NoteRequest = "eeeeeeee-1111-4111-8111-eeeeeeeeeeee";
    const stage8NoteRequestOne = "22222222-3333-4333-8333-222222222221";
    const stage8NoteRequestTwo = "22222222-3333-4333-8333-222222222222";
    const stage6RejectedListing = "ffffffff-1111-4111-8111-ffffffffffff";
    const stage6ApprovedListing = "12121212-1111-4111-8111-121212121212";
    const stage6RejectRequest = "13131313-1111-4111-8111-131313131313";
    const stage6ApproveRequest = "14141414-1111-4111-8111-141414141414";
    const stage6LegacyForceSubject = "15151515-1111-4111-8111-151515151515";
    const stage6LegacyForceReport = "16161616-1111-4111-8111-161616161616";
    const stage6LegacyForceRequest = "17171717-1111-4111-8111-171717171717";
    const stage6ForceRaceSubject = "18181818-1111-4111-8111-181818181818";
    const stage6ForceRaceReport = "19191919-1111-4111-8111-191919191919";
    const stage6ForceRaceRequest = "20202020-1111-4111-8111-202020202020";
    const stage6ForceRacePeerRequest = "21212121-1111-4111-8111-212121212121";

    try {
      command("initdb", ["-D", data, "-A", "trust", "--no-locale"]);
      command(
        "pg_ctl",
        ["-D", data, "-o", `-p ${port} -k ${cluster} -c listen_addresses=''`, "-w", "start"],
        { stdio: "ignore" },
      );
      started = true;
      sql(BOOTSTRAP_SQL);
      sql(foundation);
      sql(migration);
      sql(stage6ModerationFoundation);
      sql(moderatorNoteTimelineMigration);

      // These test-only definers create the exact historical deadlock shape:
      // one session holds the actor row before retrying begin, while another
      // session enters complete/abort. Production code is unchanged by these
      // helpers; they only make lock acquisition deterministic in this cluster.
      sql(`create function public.test_hold_actor_then_begin_auth_ban(
          p_subject uuid,p_action text,p_duration text,p_payload jsonb,p_request text
        ) returns uuid language plpgsql security definer set search_path=''
        as $body$
        declare result_id uuid;
        begin
          perform 1 from auth.users account where account.id=auth.uid() for update;
          perform pg_sleep(0.3);
          select operation_id into result_id
          from moderation_action_private.begin_auth_ban_operation_impl(
            p_subject,p_action,p_duration,p_payload,p_request
          );
          return result_id;
        end
        $body$;
        alter function public.test_hold_actor_then_begin_auth_ban(uuid,text,text,jsonb,text)
          owner to postgres;
        revoke all on function public.test_hold_actor_then_begin_auth_ban(uuid,text,text,jsonb,text)
          from public,anon,authenticated,service_role;
        grant execute on function public.test_hold_actor_then_begin_auth_ban(uuid,text,text,jsonb,text)
          to authenticated;

        create function public.test_hold_actor_then_complete_auth_ban(
          p_operation uuid,p_expected timestamptz
        ) returns uuid language plpgsql security definer set search_path=''
        as $body$
        declare result_id uuid;
        begin
          perform 1 from auth.users account where account.id=auth.uid() for update;
          perform pg_sleep(0.3);
          result_id:=moderation_action_private.complete_auth_ban_operation_impl(
            p_operation,p_expected
          );
          return result_id;
        end
        $body$;
        alter function public.test_hold_actor_then_complete_auth_ban(uuid,timestamptz)
          owner to postgres;
        revoke all on function public.test_hold_actor_then_complete_auth_ban(uuid,timestamptz)
          from public,anon,authenticated,service_role;
        grant execute on function public.test_hold_actor_then_complete_auth_ban(uuid,timestamptz)
          to authenticated;

        create function public.test_hold_actor_then_begin_force_name(
          p_reports uuid[],p_subject uuid,p_desired jsonb,p_rollback jsonb,p_request text
        ) returns uuid language plpgsql security definer set search_path=''
        as $body$
        declare result_id uuid;
        begin
          perform 1 from auth.users account where account.id=auth.uid() for update;
          perform pg_sleep(0.3);
          select operation_id into result_id
          from moderation_action_private.begin_force_name_operation_impl(
            p_reports,p_subject,p_desired,p_rollback,p_request
          );
          return result_id;
        end
        $body$;
        alter function public.test_hold_actor_then_begin_force_name(uuid[],uuid,jsonb,jsonb,text)
          owner to postgres;
        revoke all on function public.test_hold_actor_then_begin_force_name(uuid[],uuid,jsonb,jsonb,text)
          from public,anon,authenticated,service_role;
        grant execute on function public.test_hold_actor_then_begin_force_name(uuid[],uuid,jsonb,jsonb,text)
          to authenticated;

        create function public.test_hold_actor_subject_then_begin_force_name_rationale(
          p_reports uuid[],p_subject uuid,p_desired jsonb,p_rollback jsonb,
          p_policy_reason text,p_user_message text,p_private_note text,p_request uuid
        ) returns uuid language plpgsql security definer set search_path=''
        as $body$
        declare result_id uuid;
        begin
          perform 1 from auth.users account where account.id=auth.uid() for update;
          perform 1 from auth.users account where account.id=p_subject for update;
          perform pg_sleep(0.3);
          select operation_id into result_id
          from moderation_decision_private.begin_force_name_operation_with_rationale_impl(
            p_reports,p_subject,p_desired,p_rollback,p_policy_reason,
            p_user_message,p_private_note,p_request
          );
          return result_id;
        end
        $body$;
        alter function public.test_hold_actor_subject_then_begin_force_name_rationale(
          uuid[],uuid,jsonb,jsonb,text,text,text,uuid
        ) owner to postgres;
        revoke all on function public.test_hold_actor_subject_then_begin_force_name_rationale(
          uuid[],uuid,jsonb,jsonb,text,text,text,uuid
        ) from public,anon,authenticated,service_role;
        grant execute on function public.test_hold_actor_subject_then_begin_force_name_rationale(
          uuid[],uuid,jsonb,jsonb,text,text,text,uuid
        ) to authenticated;`);

      sql(`insert into auth.users(id,raw_app_meta_data) values
        ('${admin}','{"role":"admin"}'),
        ('${moderator}','{"role":"moderator"}'),
        ('${staff}','{"role":"staff"}'),
        ('${subject}','{}'),
        ('${protectedAdmin}','{"role":"admin"}'),
        ('${sagaSubject}','{}'),
        ('${forceSubject}','{}'),
        ('${mixedRoleActor}','{"role":"staff","roles":["admin"]}'),
        ('${promotedSubject}','{}'),
        ('${demotionSubject}','{}'),
        ('${banCompleteRaceSubject}','{}'),
        ('${banAbortRaceSubject}','{}'),
        ('${forceCompleteRaceSubject}','{}'),
        ('${forceAbortRaceSubject}','{}'),
        ('${stage6ForceRaceSubject}','{}');
        insert into auth.users(id,raw_app_meta_data)
          values ('${stage6LegacyForceSubject}','{}');
        update auth.users set role='admin' where id='${mixedRoleActor}';
        insert into reports(id,reported_user_id,subject_type,subject_id,status)
          values ('${report}','${subject}','profile','${subject}','open');
        insert into listings(id,seller_id,slug,title,status,submitted_for_review_at)
          values
            ('${listing}','${subject}','listing','Listing','inactive','2026-08-16T10:00:00Z'),
            ('${secondListing}','${subject}','listing-two','Listing Two','inactive','2026-08-16T10:00:00Z'),
            ('${failedNotificationListing}','${subject}','listing-failed','Listing Failed','inactive','2026-08-16T10:00:00Z'),
            ('${stage6RejectedListing}','${subject}','stage6-reject','Stage 6 reject','inactive','2026-08-16T12:00:00Z'),
            ('${stage6ApprovedListing}','${subject}','stage6-approve','Stage 6 approve','inactive','2026-08-16T12:30:00Z');
        insert into reports(id,reported_user_id,subject_type,subject_id,listing_id,status) values
          ('${listingReportOne}','${subject}','listing','${listing}','${listing}','open'),
          ('${listingReportTwo}','${subject}','listing','${listing}','${listing}','open');
        insert into reports(id,reported_user_id,subject_type,subject_id,status) values
          ('${profileReportOne}','${subject}','profile','${subject}','open'),
          ('${profileReportTwo}','${subject}','profile','${subject}','open'),
          ('${forceReportOne}','${forceSubject}','profile','${forceSubject}','open'),
          ('${forceReportTwo}','${forceSubject}','profile','${forceSubject}','open'),
          ('${forceCompleteRaceReport}','${forceCompleteRaceSubject}','profile','${forceCompleteRaceSubject}','open'),
          ('${forceAbortRaceReport}','${forceAbortRaceSubject}','profile','${forceAbortRaceSubject}','open');
        insert into reports(id,reported_user_id,subject_type,subject_id,status)
          values ('${stage6DecisionReport}','${subject}','profile','${subject}','open');
        insert into reports(id,reported_user_id,subject_type,subject_id,status)
          values ('${stage6LegacyForceReport}','${stage6LegacyForceSubject}',
            'profile','${stage6LegacyForceSubject}','open');
        insert into reports(id,reported_user_id,subject_type,subject_id,status)
          values ('${stage6ForceRaceReport}','${stage6ForceRaceSubject}',
            'profile','${stage6ForceRaceSubject}','open');
        insert into profiles(id,first_name,last_name,school)
          values
            ('${forceSubject}','Unsafe','Name','School'),
            ('${forceCompleteRaceSubject}','Unsafe','Complete','School'),
            ('${forceAbortRaceSubject}','Unsafe','Abort','School');`);
      sql(`insert into profiles(id,first_name,last_name,school)
        values
          ('${stage6LegacyForceSubject}','Legacy','Unsafe','School'),
          ('${stage6ForceRaceSubject}','Race','Unsafe','School');`);

      assert.match(
        asUser(
          admin,
          `select issue_moderation_ban('${subject}','critical','spam','Repeated prohibited marketplace spam.',null,'${report}',null,null,'ban-1');`,
          true,
        ),
        /moderation_auth_ban_must_be_applied_first/,
      );
      sql(`update auth.users set banned_until=now()+interval '24 hours' where id='${subject}';`);
      const banId = asUser(
        admin,
        `select issue_moderation_ban('${subject}','critical','spam','Repeated prohibited marketplace spam.',null,'${report}',null,null,'ban-1');`,
      );
      assert.ok(banId);
      assert.equal(
        sql(`select is_banned and banned_until is not null from user_status where user_id='${subject}';`),
        "t",
      );
      assert.equal(
        sql(`select count(*) from moderation_audit_events
          where sanction_id='${banId}' and event_type='sanction_issued';`),
        "1",
      );
      assert.equal(
        sql(`select count(*) from moderation_audit_events
          where sanction_id='${banId}' and event_type='sanction.request_recorded'
            and request_id='ban-1';`),
        "1",
      );

      assert.match(
        asUser(
          moderator,
          `select issue_moderation_ban('${subject}','critical','spam','Moderator must not issue account bans.');`,
          true,
        ),
        /moderation_action_not_permitted/,
      );
      assert.match(
        asUser(
          staff,
          `select issue_moderation_warning('${subject}','low','spam','Staff must not issue warnings.',
            null,null,'{}',null,null,null,true,'staff-warning-1');`,
          true,
        ),
        /moderation_action_not_permitted/,
      );
      assert.match(
        asUser(
          moderator,
          `select issue_moderation_warning('${protectedAdmin}','low','spam','Protected accounts cannot be sanctioned.',
            null,null,'{}',null,null,null,true,'protected-warning-1');`,
          true,
        ),
        /moderation_subject_is_protected/,
      );

      const warningId = asUser(
        moderator,
        `select issue_moderation_warning('${subject}','medium','spam','Please stop posting repeated marketplace spam.',
          null,null,'{}',null,null,null,true,'warning-1');`,
      );
      assert.equal(
        asUser(subject, `select acknowledge_moderation_sanction('${warningId}');`),
        "t",
      );
      assert.equal(
        asUser(subject, `select request_moderation_sanction_review('${warningId}');`),
        "t",
      );
      const replacementId = asUser(
        moderator,
        `select modify_moderation_sanction_review(
          '${warningId}','strike','medium','spam','A one-point strike replaces this warning.',
          'The warning was replaced with a one-point strike.',
          'Original warning replaced after review.',1::smallint,
          null,'{}',null,null,null,true,null,'review-mod-1'
        );`,
      );
      assert.equal(
        sql(`select review_status='modified' and replacement_sanction_id='${replacementId}'
          from moderation_sanctions where id='${warningId}';`),
        "t",
      );
      assert.equal(
        sql(`select supersedes_sanction_id='${warningId}' from moderation_sanctions where id='${replacementId}';`),
        "t",
      );

      sql(`update auth.users set banned_until=null where id='${subject}';`);
      assert.equal(
        asUser(
          admin,
          `select revoke_active_moderation_ban('${subject}','Ban revoked after administrator review.');`,
        ),
        banId,
      );
      assert.equal(sql(`select not is_banned from user_status where user_id='${subject}';`), "t");

      assert.match(
        service(
          `update user_status set is_banned=true,ban_reason='Direct service writes stay forbidden.' where user_id='${subject}';`,
          true,
        ),
        /permission denied/i,
      );

      assert.equal(
        asUser(
          moderator,
          `select status || ':' || moderation_reviewed_by::text
             from decide_listing_moderation('${listing}',1,'2026-08-16T10:00:00Z','approved',null,'listing-1');`,
        ),
        `active:${moderator}`,
      );
      assert.equal(
        asUser(
          moderator,
          `select status || ':' || moderation_reviewed_by::text
             from decide_listing_moderation('${listing}',1,'2026-08-16T10:00:00Z','approved',null,'listing-1');`,
        ),
        `active:${moderator}`,
      );
      // Simulate a lost HTTP response by replaying the exact command after its
      // transaction committed. The output is part of that same transaction,
      // so replay produces neither a gap nor a duplicate notification.
      assert.equal(
        sql(`select count(*) from notifications
          where listing_id='${listing}'
            and type='listing_approved'
            and metadata->>'moderation_operation_id'='listing-1';`),
        "1",
      );
      for (const whitespaceExpression of [
        "E'\\t\\r\\n'",
        "convert_from(decode('c2a0','hex'),'UTF8')",
        "convert_from(decode('e28083','hex'),'UTF8')",
        "convert_from(decode('efbbbf','hex'),'UTF8')",
      ]) {
        assert.match(
          asUser(
            admin,
            `select decide_report_set_with_summary(
              array['${stage6DecisionReport}'::uuid],
              'dismissed',${whitespaceExpression},gen_random_uuid()
            );`,
            true,
          ),
          /report_decision_summary_invalid/,
        );
      }
      assert.equal(
        sql(`select user_id='${subject}'
            and metadata->>'listing_slug'='listing'
            and metadata->>'href'='/dashboard'
          from notifications where listing_id='${listing}';`),
        "t",
      );

      // Request IDs are actor-scoped in the command ledger and in the
      // deterministic notification namespace, so a second moderator can use
      // the same transport UUID without colliding with the first output.
      assert.equal(
        asUser(
          admin,
          `select status from decide_listing_moderation(
            '${secondListing}',1,'2026-08-16T10:00:00Z','approved',null,'listing-1'
          );`,
        ),
        "active",
      );
      assert.equal(
        sql(`select count(*)=2 and count(distinct id)=2 from notifications
          where metadata->>'moderation_operation_id'='listing-1';`),
        "t",
      );

      // Any output failure rolls back the listing, history, audit, and command
      // ledger together; there is no commit-to-notification crash window.
      sql(`create function public.test_reject_listing_notification()
        returns trigger language plpgsql as $body$
        begin
          if new.metadata->>'moderation_operation_id'='listing-notification-failure' then
            raise exception 'test_listing_notification_rejected';
          end if;
          return new;
        end
        $body$;
        create trigger test_reject_listing_notification
          before insert on public.notifications for each row
          execute function public.test_reject_listing_notification();`);
      assert.match(
        asUser(
          moderator,
          `select * from decide_listing_moderation(
            '${failedNotificationListing}',1,'2026-08-16T10:00:00Z','approved',null,
            'listing-notification-failure'
          );`,
          true,
        ),
        /test_listing_notification_rejected/,
      );
      assert.equal(
        sql(`select status='inactive' and moderation_reviewed_at is null
          from listings where id='${failedNotificationListing}';`),
        "t",
      );
      assert.equal(
        sql(`select
          (select count(*) from listing_moderation_history
            where listing_id='${failedNotificationListing}')=0
          and (select count(*) from moderation_audit_events
            where event_type='listing.moderation_decided'
              and resource_id='${failedNotificationListing}')=0
          and (select count(*) from moderation_action_private.moderation_command_results
            where action='listing_decision'
              and request_id='listing-notification-failure')=0;`),
        "t",
      );
      assert.match(
        asUser(
          moderator,
          `select * from decide_listing_moderation(
            '${listing}',1,'2026-08-16T10:00:00Z','approved',null,'listing-new-intent'
          );`,
          true,
        ),
        /listing_review_revision_conflict/,
      );

      assert.match(
        asUser(
          staff,
          `select decide_report_set(array['${profileReportOne}'::uuid,'${profileReportTwo}'::uuid],'dismissed');`,
          true,
        ),
        /moderation_action_not_permitted/,
      );
      assert.equal(
        asUser(
          moderator,
          `select decide_report_set(array['${profileReportOne}'::uuid,'${profileReportTwo}'::uuid],'dismissed','reports-1');`,
        ),
        "2",
      );
      assert.equal(
        asUser(
          moderator,
          `select decide_report_set(array['${profileReportTwo}'::uuid,
            '${profileReportOne}'::uuid],'dismissed','reports-1');`,
        ),
        "2",
      );
      assert.match(
        asUser(
          moderator,
          `select decide_report_set(array['${profileReportOne}'::uuid,
            '${profileReportTwo}'::uuid],'dismissed','reports-new-intent');`,
          true,
        ),
        /moderation_report_set_conflict/,
      );
      assert.equal(
        sql(`select count(*) from reports where id in ('${profileReportOne}','${profileReportTwo}')
          and status='dismissed' and reviewed_by='${moderator}';`),
        "2",
      );
      assert.equal(
        asUser(
          moderator,
          `select remove_reported_listing(
            array['${listingReportOne}'::uuid,'${listingReportTwo}'::uuid],
            '${listing}',
            'remove-1'
          );`,
        ),
        "2",
      );
      assert.equal(
        asUser(
          moderator,
          `select remove_reported_listing(
            array['${listingReportTwo}'::uuid,'${listingReportOne}'::uuid],
            '${listing}','remove-1'
          );`,
        ),
        "2",
      );
      assert.match(
        asUser(
          moderator,
          `select remove_reported_listing(
            array['${listingReportOne}'::uuid,'${listingReportTwo}'::uuid],
            '${listing}','remove-new-intent'
          );`,
          true,
        ),
        /moderation_report_set_conflict/,
      );
      assert.equal(
        sql(`select status='inactive' and moderation_reviewed_by='${moderator}'
          from listings where id='${listing}';`),
        "t",
      );
      assert.equal(
        sql(`select count(*) from reports where id in ('${listingReportOne}','${listingReportTwo}')
          and status='resolved' and reviewed_by='${moderator}';`),
        "2",
      );
      assert.equal(
        sql(`select count(*) from moderation_audit_events
          where event_type in ('reports.decided','listing.removed_after_reports');`),
        "2",
      );

      // A durable pending operation survives both crash windows: after begin,
      // and after Auth changed but before the database projection completed.
      const banPayload = `jsonb_build_object(
        'severity','critical','reason_code','spam',
        'user_message','Repeated prohibited marketplace spam.'
      )`;

      // Complete and abort acquire actor -> subject -> operation, just like
      // begin. These races deterministically formed a deadlock when the
      // terminal paths locked the operation first.
      const banCompleteRaceOperation = asUser(
        admin,
        `select operation_id from begin_auth_ban_operation(
          '${banCompleteRaceSubject}','ban','24h',${banPayload},'ban-lock-complete'
        );`,
      );
      sql(`update auth.users set banned_until=now()+interval '24 hours'
        where id='${banCompleteRaceSubject}';`);
      const banCompleteRaceUntil = sql(
        `select banned_until::text from auth.users where id='${banCompleteRaceSubject}';`,
      );
      const heldBanCompleteBegin = asyncAsUser(
        admin,
        `select test_hold_actor_then_begin_auth_ban(
          '${banCompleteRaceSubject}','ban','24h',${banPayload},'ban-lock-complete'
        );`,
      );
      await delay(60);
      const [heldBanCompleteId, completedBanRace] = await Promise.all([
        heldBanCompleteBegin,
        asyncAsUser(
          admin,
          `select complete_auth_ban_operation('${banCompleteRaceOperation}',
            '${banCompleteRaceUntil}'::timestamptz);`,
        ),
      ]);
      assert.equal(heldBanCompleteId, banCompleteRaceOperation);
      assert.ok(completedBanRace);

      const nestedUnbanOperation = asUser(
        admin,
        `select operation_id from begin_auth_ban_operation(
          '${banCompleteRaceSubject}','unban','none',
          jsonb_build_object('revocation_reason','Ban revoked after administrator review.'),
          'ban-lock-nested-revoke'
        );`,
      );
      sql(`update auth.users set banned_until=null
        where id='${banCompleteRaceSubject}';`);
      const heldNestedUnban = asyncAsUser(
        admin,
        `select test_hold_actor_then_complete_auth_ban(
          '${nestedUnbanOperation}',null
        );`,
      );
      await delay(60);
      const nestedRevokeRace = await Promise.allSettled([
        heldNestedUnban,
        asyncAsUser(
          admin,
          `select revoke_moderation_sanction(
            '${completedBanRace}','A concurrent redundant revocation is rejected safely.'
          );`,
        ),
      ]);
      assert.equal(nestedRevokeRace[0].status, "fulfilled");
      assert.equal(nestedRevokeRace[0].value, completedBanRace);
      assert.ok(
        nestedRevokeRace.every((result) => (
          result.status === "fulfilled"
          || !/40P01|deadlock detected/i.test(result.reason?.message ?? "")
        )),
      );
      assert.equal(
        sql(`select count(*) from moderation_sanctions
          where id='${completedBanRace}' and revoked_at is not null;`),
        "1",
      );

      const banAbortRaceOperation = asUser(
        admin,
        `select operation_id from begin_auth_ban_operation(
          '${banAbortRaceSubject}','ban','24h',${banPayload},'ban-lock-abort'
        );`,
      );
      const heldBanAbortBegin = asyncAsUser(
        admin,
        `select test_hold_actor_then_begin_auth_ban(
          '${banAbortRaceSubject}','ban','24h',${banPayload},'ban-lock-abort'
        );`,
      );
      await delay(60);
      const [heldBanAbortId, abortedBanRace] = await Promise.all([
        heldBanAbortBegin,
        asyncAsUser(
          admin,
          `select abort_auth_ban_operation('${banAbortRaceOperation}');`,
        ),
      ]);
      assert.equal(heldBanAbortId, banAbortRaceOperation);
      assert.equal(abortedBanRace, "t");

      const [banBeginOne, banBeginTwo] = await Promise.all([
        asyncAsUser(
          admin,
          `select * from begin_auth_ban_operation(
            '${sagaSubject}','ban','24h',${banPayload},'saga-ban-a'
          );`,
        ),
        asyncAsUser(
          admin,
          `select * from begin_auth_ban_operation(
            '${sagaSubject}','ban','24h',${banPayload},'saga-ban-b'
          );`,
        ),
      ]);
      const banOperationId = banBeginOne.split("|")[0];
      assert.equal(banBeginTwo.split("|")[0], banOperationId);
      assert.equal(banBeginOne.split("|")[1], "pending");
      const storedBanRequestId = sql(
        `select request_id from moderation_action_private.auth_ban_operations
          where id='${banOperationId}';`,
      );
      assert.equal(
        asUser(
          admin,
          `select operation_id from begin_auth_ban_operation(
            '${sagaSubject}','ban','24h',${banPayload},'saga-ban-crash-retry'
          );`,
        ),
        banOperationId,
      );
      sql(`update auth.users set banned_until=now()+interval '24 hours'
        where id='${sagaSubject}';`);
      const sagaBannedUntil = sql(
        `select banned_until::text from auth.users where id='${sagaSubject}';`,
      );
      assert.ok(
        asUser(
          admin,
          `select complete_auth_ban_operation('${banOperationId}',
            '${sagaBannedUntil}'::timestamptz);`,
        ),
      );
      assert.equal(
        asUser(
          admin,
          `select operation_status from begin_auth_ban_operation(
            '${sagaSubject}','ban','24h',${banPayload},'${storedBanRequestId}'
          );`,
        ),
        "completed",
      );

      const unbanPayload = `jsonb_build_object(
        'revocation_reason','Ban revoked after administrator review.'
      )`;
      const [unbanBeginOne, unbanBeginTwo] = await Promise.all([
        asyncAsUser(
          admin,
          `select * from begin_auth_ban_operation(
            '${sagaSubject}','unban','none',${unbanPayload},'saga-unban-a'
          );`,
        ),
        asyncAsUser(
          admin,
          `select * from begin_auth_ban_operation(
            '${sagaSubject}','unban','none',${unbanPayload},'saga-unban-b'
          );`,
        ),
      ]);
      const unbanOperationId = unbanBeginOne.split("|")[0];
      assert.equal(unbanBeginTwo.split("|")[0], unbanOperationId);
      sql(`update auth.users set banned_until=null where id='${sagaSubject}';`);
      assert.equal(
        asUser(
          admin,
          `select operation_id from begin_auth_ban_operation(
            '${sagaSubject}','unban','none',${unbanPayload},'saga-unban-crash-retry'
          );`,
        ),
        unbanOperationId,
      );
      assert.ok(
        asUser(
          admin,
          `select complete_auth_ban_operation('${unbanOperationId}',null);`,
        ),
      );
      assert.match(
        asUser(
          admin,
          `select * from begin_auth_ban_operation(
            '${sagaSubject}','ban','24h',${banPayload},'${storedBanRequestId}'
          );`,
          true,
        ),
        /moderation_auth_ban_completed_state_changed/,
      );
      const laterBanOperationId = asUser(
        admin,
        `select operation_id from begin_auth_ban_operation(
          '${sagaSubject}','ban','24h',${banPayload},'saga-ban-later-intent'
        );`,
      );
      assert.notEqual(laterBanOperationId, banOperationId);
      assert.equal(
        asUser(admin, `select abort_auth_ban_operation('${laterBanOperationId}');`),
        "t",
      );

      const promotionOperationId = asUser(
        admin,
        `select operation_id from begin_auth_ban_operation(
          '${promotedSubject}','ban','24h',${banPayload},'promotion-between-steps'
        );`,
      );
      sql(`update auth.users set raw_app_meta_data='{"role":"admin"}',
        banned_until=now()+interval '24 hours' where id='${promotedSubject}';`);
      const promotedBannedUntil = sql(
        `select banned_until::text from auth.users where id='${promotedSubject}';`,
      );
      assert.match(
        asUser(
          admin,
          `select complete_auth_ban_operation('${promotionOperationId}',
            '${promotedBannedUntil}'::timestamptz);`,
          true,
        ),
        /moderation_subject_is_protected/,
      );
      sql(`update auth.users set raw_app_meta_data='{}',banned_until=null
        where id='${promotedSubject}';`);
      assert.equal(
        asUser(admin, `select abort_auth_ban_operation('${promotionOperationId}');`),
        "t",
      );

      const demotionOperationId = asUser(
        admin,
        `select operation_id from begin_auth_ban_operation(
          '${demotionSubject}','ban','24h',${banPayload},'demotion-between-steps'
        );`,
      );
      sql(`update auth.users set raw_app_meta_data='{}' where id='${admin}';`);
      assert.match(
        asUser(
          admin,
          `select complete_auth_ban_operation('${demotionOperationId}',null);`,
          true,
        ),
        /moderation_action_not_permitted/,
      );
      sql(`update auth.users set raw_app_meta_data='{"role":"admin"}' where id='${admin}';`);
      assert.equal(
        asUser(admin, `select abort_auth_ban_operation('${demotionOperationId}');`),
        "t",
      );

      // Two simultaneous force-name requests converge on one operation. Once
      // Auth is changed, completing either token commits the exact report set,
      // profile reset, and audit row; the peer replays the canonical result.
      const desiredNameMetadata = `'${JSON.stringify({
        force_name_change: true,
        force_name_change_rejected_name_fingerprint: "fingerprint-1",
        force_name_change_rejected_name_fingerprints: ["fingerprint-1"],
      })}'::jsonb`;

      const forceCompleteRaceOperation = asUser(
        admin,
        `select operation_id from begin_force_name_operation(
          array['${forceCompleteRaceReport}'::uuid],
          '${forceCompleteRaceSubject}',${desiredNameMetadata},'{}'::jsonb,
          'force-lock-complete'
        );`,
      );
      sql(`update auth.users set raw_app_meta_data=${desiredNameMetadata}
        where id='${forceCompleteRaceSubject}';`);
      const heldForceCompleteBegin = asyncAsUser(
        admin,
        `select test_hold_actor_then_begin_force_name(
          array['${forceCompleteRaceReport}'::uuid],
          '${forceCompleteRaceSubject}',${desiredNameMetadata},'{}'::jsonb,
          'force-lock-complete'
        );`,
      );
      await delay(60);
      const [heldForceCompleteId, completedForceRace] = await Promise.all([
        heldForceCompleteBegin,
        asyncAsUser(
          admin,
          `select complete_force_name_operation('${forceCompleteRaceOperation}');`,
        ),
      ]);
      assert.equal(heldForceCompleteId, forceCompleteRaceOperation);
      assert.equal(completedForceRace, "1");

      const forceAbortRaceOperation = asUser(
        admin,
        `select operation_id from begin_force_name_operation(
          array['${forceAbortRaceReport}'::uuid],
          '${forceAbortRaceSubject}',${desiredNameMetadata},'{}'::jsonb,
          'force-lock-abort'
        );`,
      );
      const heldForceAbortBegin = asyncAsUser(
        admin,
        `select test_hold_actor_then_begin_force_name(
          array['${forceAbortRaceReport}'::uuid],
          '${forceAbortRaceSubject}',${desiredNameMetadata},'{}'::jsonb,
          'force-lock-abort'
        );`,
      );
      await delay(60);
      const [heldForceAbortId, abortedForceRace] = await Promise.all([
        heldForceAbortBegin,
        asyncAsUser(
          admin,
          `select abort_force_name_operation('${forceAbortRaceOperation}');`,
        ),
      ]);
      assert.equal(heldForceAbortId, forceAbortRaceOperation);
      assert.equal(abortedForceRace, "t");

      const forceBeginSql = (requestId) => `select * from begin_force_name_operation(
        array['${forceReportOne}'::uuid,'${forceReportTwo}'::uuid],
        '${forceSubject}',${desiredNameMetadata},'{}'::jsonb,'${requestId}'
      );`;
      const [forceBeginOne, forceBeginTwo] = await Promise.all([
        asyncAsUser(admin, forceBeginSql("force-name-a")),
        asyncAsUser(admin, forceBeginSql("force-name-b")),
      ]);
      const forceOperationId = forceBeginOne.split("|")[0];
      assert.equal(forceBeginTwo.split("|")[0], forceOperationId);
      const storedForceRequestId = sql(
        `select request_id from moderation_action_private.force_name_operations
          where id='${forceOperationId}';`,
      );
      sql(`update auth.users set raw_app_meta_data=${desiredNameMetadata}
        where id='${forceSubject}';`);
      const [forceCompleteOne, forceCompleteTwo] = await Promise.all([
        asyncAsUser(
          admin,
          `select complete_force_name_operation('${forceOperationId}');`,
        ),
        asyncAsUser(
          admin,
          `select complete_force_name_operation('${forceOperationId}');`,
        ),
      ]);
      assert.equal(forceCompleteOne, "2");
      assert.equal(forceCompleteTwo, "2");
      assert.equal(
        asUser(
          admin,
          `select operation_status from ${forceBeginSql(storedForceRequestId).slice(14)}`,
        ),
        "completed",
      );
      assert.equal(
        sql(`select count(*) from reports where id in ('${forceReportOne}','${forceReportTwo}')
          and status='resolved';`),
        "2",
      );
      assert.equal(
        sql(`select first_name is null and last_name is null from profiles
          where id='${forceSubject}';`),
        "t",
      );
      assert.equal(
        sql(`select count(*) from moderation_audit_events
          where event_type='profile.name_change_required'
            and request_id in ('force-name-a','force-name-b');`),
        "1",
      );
      sql(`update profiles set first_name='Changed later' where id='${forceSubject}';`);
      assert.match(
        asUser(admin, forceBeginSql(storedForceRequestId), true),
        /force_name_change_completed_state_changed/,
      );

      // Live Auth bans/demotions and mixed-role precedence are evaluated from
      // locked auth.users rows rather than stale client claims.
      sql(`update auth.users set banned_until=now()+interval '1 hour'
        where id='${moderator}';`);
      assert.match(
        asUser(
          moderator,
          `select issue_moderation_warning('${sagaSubject}','low','spam',
            'A currently banned moderator cannot issue warnings.',null,null,'{}',
            null,null,null,true,'actor-banned-warning');`,
          true,
        ),
        /moderation_actor_is_banned/,
      );
      sql(`update auth.users set banned_until=null,raw_app_meta_data='{}'::jsonb
        where id='${moderator}';`);
      assert.match(
        asUser(
          moderator,
          `select issue_moderation_warning('${sagaSubject}','low','spam',
            'A demoted moderator cannot issue warnings.',null,null,'{}',
            null,null,null,true,'actor-demoted-warning');`,
          true,
        ),
        /moderation_action_not_permitted/,
      );
      assert.match(
        asUser(
          mixedRoleActor,
          `select issue_moderation_warning('${sagaSubject}','low','spam',
            'The scalar staff role must win over an admin roles array.',null,null,'{}',
            null,null,null,true,'mixed-role-warning');`,
          true,
        ),
        /moderation_action_not_permitted/,
      );

      assert.equal(
        sql(`select count(*) from listing_moderation_history where listing_id='${listing}';`),
        "1",
      );
      assert.equal(
        sql(`select count(*) from moderation_audit_events
          where event_type='listing.moderation_decided' and resource_id='${listing}';`),
        "1",
      );
      assert.equal(
        asUser(
          admin,
          `select decide_report_set_with_summary(
            array['${stage6DecisionReport}'::uuid],
            'dismissed',
            convert_from(decode('efbbbf','hex'),'UTF8')
              ||E'Private line one\rPrivate line two'
              ||convert_from(decode('e28083','hex'),'UTF8'),
            '${stage6DecisionRequest}'
          );`,
        ),
        "1",
      );
      assert.equal(
        asUser(
          admin,
          `select decide_report_set_with_summary(
            array['${stage6DecisionReport}'::uuid],
            'dismissed',
            E'Private line one\nPrivate line two',
            '${stage6DecisionRequest}'
          );`,
        ),
        "1",
      );
      assert.match(
        asUser(
          admin,
          `select decide_report_set_with_summary(
            array['${stage6DecisionReport}'::uuid],
            'dismissed',
            'A conflicting private decision summary',
            '${stage6DecisionRequest}'
          );`,
          true,
        ),
        /moderation_request_id_payload_conflict/,
      );
      const stage6DecisionAuditId = sql(`select id from moderation_audit_events
        where request_id='${stage6DecisionRequest}' order by occurred_at desc limit 1;`);
      assert.equal(
        asUser(
          admin,
          `select action='report_dismissed'
             and private_note=E'Private line one\nPrivate line two'
           from get_moderation_decision_records(array['${stage6DecisionAuditId}'::uuid]);`,
        ),
        "t",
      );
      sql(`update auth.users set banned_until=now()+interval '1 hour' where id='${admin}';`);
      assert.match(
        asUser(
          admin,
          `select * from get_moderation_decision_records(
            array['${stage6DecisionAuditId}'::uuid]
          );`,
          true,
        ),
        /moderation_actor_is_banned/,
      );
      sql(`update auth.users set banned_until=null where id='${admin}';`);
      sql(`update auth.users set raw_app_meta_data='{"role":"moderator"}'::jsonb,
        banned_until=null where id='${moderator}';`);
      assert.match(
        asUser(
          moderator,
          `select * from get_moderation_decision_records(
            array['${stage6DecisionAuditId}'::uuid]
          );`,
          true,
        ),
        /moderation_audit_access_required/,
      );
      assert.match(
        asUser(
          subject,
          `select * from get_moderation_decision_records(
            array['${stage6DecisionAuditId}'::uuid]
          );`,
          true,
        ),
        /moderation_audit_access_required|moderation_action_not_permitted/,
      );
      assert.match(
        sql(`update moderation_decision_private.records
          set private_note='tampered' where audit_event_id='${stage6DecisionAuditId}';`, true),
        /moderation_decision_record_is_immutable/,
      );
      assert.equal(
        asUser(
          admin,
          `select save_report_moderator_note(
            '${stage6DecisionReport}',E'Case note line one\r\nCase note line two','${stage6NoteRequest}'
          );`,
        ),
        "t",
      );
      assert.equal(
        asUser(
          admin,
          `select save_report_moderator_note(
            '${stage6DecisionReport}',E'Case note line one\nCase note line two','${stage6NoteRequest}'
          );`,
        ),
        "t",
      );
      assert.equal(
        asUser(
          admin,
          `select moderator_notes=E'Case note line one\nCase note line two'
           from get_report_moderator_notes(array['${stage6DecisionReport}'::uuid]);`,
        ),
        "t",
      );
      assert.equal(
        sql(`select not (metadata ? 'private_note')
          and position('Case note' in summary)=0
          from moderation_audit_events where request_id='${stage6NoteRequest}';`),
        "t",
      );
      const firstTimelineNoteId = asUser(
        admin,
        `select note_id from append_report_moderator_note(
          '${stage6DecisionReport}',E'Timeline note one\r\nwith context','${stage8NoteRequestOne}'
        );`,
      );
      assert.match(firstTimelineNoteId, /^[0-9a-f-]{36}$/);
      assert.equal(
        asUser(
          admin,
          `select note_id from append_report_moderator_note(
            '${stage6DecisionReport}',E'Timeline note one\nwith context','${stage8NoteRequestOne}'
          );`,
        ),
        firstTimelineNoteId,
      );
      assert.equal(
        sql(`select count(*) from moderation_decision_private.records
          where request_id='${stage8NoteRequestOne}';`),
        "1",
      );
      assert.equal(
        asUser(
          moderator,
          `select moderator_note from append_report_moderator_note(
            '${stage6DecisionReport}','Timeline note two','${stage8NoteRequestTwo}'
          );`,
        ),
        "Timeline note two",
      );
      assert.equal(
        asUser(
          moderator,
          `select count(*)=3
            and (array_agg(moderator_note order by created_at desc,note_id desc))[1]
              ='Timeline note two'
           from get_report_moderator_note_history('${stage6DecisionReport}',101);`,
        ),
        "t",
      );
      assert.equal(
        asUser(
          admin,
          `select moderator_notes='Timeline note two'
           from get_report_moderator_notes(array['${stage6DecisionReport}'::uuid]);`,
        ),
        "t",
      );
      assert.match(
        asUser(
          subject,
          `select * from get_report_moderator_note_history('${stage6DecisionReport}',10);`,
          true,
        ),
        /moderation_action_not_permitted/,
      );
      for (const invalidLimit of ["null", "0", "102"]) {
        assert.match(
          asUser(
            admin,
            `select * from get_report_moderator_note_history(
              '${stage6DecisionReport}',${invalidLimit}
            );`,
            true,
          ),
          /moderator_note_history_request_invalid/,
        );
      }
      assert.match(
        asUser(
          admin,
          `select * from append_report_moderator_note(
            '${stage6DecisionReport}',E'\t\r\n','22222222-3333-4333-8333-222222222223'
          );`,
          true,
        ),
        /moderator_note_invalid/,
      );
      assert.match(
        asUser(
          admin,
          `select * from append_report_moderator_note(
            '${stage6DecisionReport}','Conflicting note','${stage8NoteRequestOne}'
          );`,
          true,
        ),
        /moderation_request_id_payload_conflict/,
      );
      assert.equal(
        sql(`select not (metadata ? 'private_note')
          and position('Timeline note' in metadata::text)=0
          and position('Timeline note' in summary)=0
          from moderation_audit_events where request_id='${stage8NoteRequestTwo}';`),
        "t",
      );
      assert.equal(
        sql(`select count(*) from notifications
          where metadata::text like '%Timeline note%';`),
        "0",
      );
      assert.match(
        sql(`update moderation_decision_private.records set private_note='tampered'
          where request_id='${stage8NoteRequestOne}';`, true),
        /moderation_decision_record_is_immutable/,
      );
      assert.match(
        asUser(
          subject,
          `select * from get_report_moderator_notes(
            array['${stage6DecisionReport}'::uuid]
          );`,
          true,
        ),
        /moderation_action_not_permitted/,
      );
      assert.match(
        service(
          `select * from moderation_decision_private.report_notes;`,
          true,
        ),
        /permission denied for schema moderation_decision_private/,
      );
      assert.equal(
        asUser(
          admin,
          `select status||':'||moderation_feedback
          from decide_listing_moderation_with_rationale(
            '${stage6RejectedListing}',1,'2026-08-16T12:00:00Z',
            'rejected',E'Seller feedback line one\r\nSeller feedback line two','${stage6RejectRequest}'
          );`,
        ),
        "rejected:Seller feedback line one\nSeller feedback line two",
      );
      for (const whitespaceExpression of [
        "E'\\t\\r\\n'",
        "convert_from(decode('c2a0','hex'),'UTF8')",
        "convert_from(decode('e28083','hex'),'UTF8')",
        "convert_from(decode('efbbbf','hex'),'UTF8')",
      ]) {
        assert.match(
          asUser(
            admin,
            `select status from decide_listing_moderation_with_rationale(
              '${stage6RejectedListing}',1,'2026-08-16T12:00:00Z',
              'rejected',${whitespaceExpression},gen_random_uuid()
            );`,
            true,
          ),
          /listing_moderation_rationale_invalid/,
        );
      }
      assert.equal(
        asUser(
          admin,
          `select status||':'||moderation_feedback
          from decide_listing_moderation_with_rationale(
            '${stage6RejectedListing}',1,'2026-08-16T12:00:00Z',
            'rejected',E'Seller feedback line one\nSeller feedback line two','${stage6RejectRequest}'
          );`,
        ),
        "rejected:Seller feedback line one\nSeller feedback line two",
      );
      assert.equal(
        sql(`select metadata->>'feedback'=E'Seller feedback line one\nSeller feedback line two'
          from notifications where listing_id='${stage6RejectedListing}';`),
        "t",
      );
      assert.equal(
        asUser(
          admin,
          `select status from decide_listing_moderation_with_rationale(
            '${stage6ApprovedListing}',1,'2026-08-16T12:30:00Z',
            'approved',E'Private approval\r\nreviewed','${stage6ApproveRequest}'
          );`,
        ),
        "active",
      );
      const stage6ApprovalAuditId = sql(`select id from moderation_audit_events
        where request_id='${stage6ApproveRequest}' order by occurred_at desc limit 1;`);
      assert.equal(
        asUser(
          admin,
          `select action='listing_approved'
            and user_message=E'Private approval\nreviewed'
          from get_moderation_decision_records(array['${stage6ApprovalAuditId}'::uuid]);`,
        ),
        "t",
      );
      assert.equal(
        sql(`select not (metadata ? 'feedback')
          from notifications where listing_id='${stage6ApprovedListing}';`),
        "t",
      );

      // Cross-actor regression for the Stage 6 rationale completion wrapper.
      // The peer holds actor B -> subject, then tries to begin while actor A
      // completes the already-pending operation. Completion must wait on the
      // subject without holding the operation row, preserving the canonical
      // actor -> subject -> operation order and avoiding a 40P01 cycle.
      assert.match(
        asUser(
          admin,
          `select operation_id from begin_force_name_operation_with_rationale(
            array['${stage6ForceRaceReport}'::uuid],
            '${stage6ForceRaceSubject}',
            ${desiredNameMetadata},
            '{}'::jsonb,
            convert_from(decode('c2a0e28083efbbbf','hex'),'UTF8')||E'\t\n',
            'Choose a real name before continuing to use marketplace features.',
            null,
            gen_random_uuid()
          );`,
          true,
        ),
        /force_name_decision_rationale_invalid/,
      );
      const stage6ForceRaceOperationId = asUser(
        admin,
        `select operation_id from begin_force_name_operation_with_rationale(
          array['${stage6ForceRaceReport}'::uuid],
          '${stage6ForceRaceSubject}',
          ${desiredNameMetadata},
          '{}'::jsonb,
          'The profile name violates the student identity policy.',
          'Choose a real name before continuing to use marketplace features.',
          'Cross-actor lock-order regression.',
          '${stage6ForceRaceRequest}'
        );`,
      );
      sql(`update auth.users set raw_app_meta_data=${desiredNameMetadata}
        where id='${stage6ForceRaceSubject}';`);
      const heldStage6ForceRaceBegin = asyncAsUser(
        protectedAdmin,
        `select test_hold_actor_subject_then_begin_force_name_rationale(
          array['${stage6ForceRaceReport}'::uuid],
          '${stage6ForceRaceSubject}',
          ${desiredNameMetadata},
          '{}'::jsonb,
          'The profile name violates the student identity policy.',
          'Choose a real name before continuing to use marketplace features.',
          'Peer operation must serialize behind the pending decision.',
          '${stage6ForceRacePeerRequest}'
        );`,
      );
      await delay(60);
      const stage6ForceRaceResults = await Promise.allSettled([
        heldStage6ForceRaceBegin,
        asyncAsUser(
          admin,
          `select complete_force_name_operation_with_rationale(
            '${stage6ForceRaceOperationId}'
          );`,
        ),
      ]);
      assert.equal(stage6ForceRaceResults[1].status, "fulfilled");
      assert.equal(stage6ForceRaceResults[1].value, "1");
      assert.equal(stage6ForceRaceResults[0].status, "rejected");
      assert.match(
        stage6ForceRaceResults[0].reason.message,
        /force_name_change_operation_in_progress/,
      );
      for (const result of stage6ForceRaceResults) {
        if (result.status === "rejected") {
          assert.doesNotMatch(result.reason.message, /deadlock detected|40P01/i);
        }
      }
      assert.equal(
        sql(`select count(*) from moderation_decision_private.records
          where request_id='${stage6ForceRaceRequest}'
            and action='profile_name_change_required';`),
        "1",
      );
      assert.equal(
        sql(`select count(*) from notifications
          where user_id='${stage6ForceRaceSubject}'
            and type='profile_name_change_required';`),
        "1",
      );

      const legacyForceOperationId = asUser(
        admin,
        `select operation_id from begin_force_name_operation(
          array['${stage6LegacyForceReport}'::uuid],
          '${stage6LegacyForceSubject}',
          '{"force_name_change":true}'::jsonb,
          '{}'::jsonb,
          '${stage6LegacyForceRequest}'
        );`,
      );
      sql(`update auth.users set raw_app_meta_data='{"force_name_change":true}'::jsonb
        where id='${stage6LegacyForceSubject}';`);
      assert.equal(
        asUser(admin, `select complete_force_name_operation('${legacyForceOperationId}');`),
        "1",
      );
      const legacyForceReplayRows = asUser(
        admin,
        `select operation_id||':'||operation_status
        from begin_force_name_operation_with_rationale(
          array['${stage6LegacyForceReport}'::uuid],
          '${stage6LegacyForceSubject}',
          '{"force_name_change":true}'::jsonb,
          '{}'::jsonb,
          'The profile name violates the student identity policy.',
          'Choose a real name before continuing to use marketplace features.',
          E'Legacy operation\r\nbackfilled after completion.',
          '${stage6LegacyForceRequest}'
        );`,
      );
      assert.equal(legacyForceReplayRows, `${legacyForceOperationId}:completed`);
      assert.equal(
        asUser(
          admin,
          `select complete_force_name_operation_with_rationale('${legacyForceOperationId}');`,
        ),
        "1",
      );
      assert.equal(
        sql(`select count(*) from moderation_decision_private.records
          where request_id='${stage6LegacyForceRequest}'
            and action='profile_name_change_required';`),
        "1",
      );
      assert.equal(
        sql(`select count(*) from notifications
          where user_id='${stage6LegacyForceSubject}'
            and type='profile_name_change_required'
            and metadata->>'user_message'=
              'Choose a real name before continuing to use marketplace features.';`),
        "1",
      );
      assert.equal(
        sql(`select bool_and(not prosecdef) from pg_proc procedure
          join pg_namespace namespace on namespace.oid=procedure.pronamespace
          where namespace.nspname='public' and procedure.proname in (
            'issue_moderation_warning','issue_moderation_strike','issue_moderation_ban',
            'decide_listing_moderation','decide_report_set','remove_reported_listing',
            'begin_auth_ban_operation','complete_auth_ban_operation',
            'begin_force_name_operation','complete_force_name_operation'
          );`),
        "t",
      );
      assert.match(
        asUser(
          admin,
          `select moderation_action_private.begin_auth_ban_operation_impl(
            '${sagaSubject}','ban','24h',${banPayload},'hidden-call'
          );`,
          true,
        ),
        /permission denied for schema moderation_action_private/,
      );
      assert.match(
        asUser(
          admin,
          `select set_config('app.listing_integrity_context','trusted_moderation_decision',true);
           update listings set moderation_feedback=null where id='${listing}';`,
          true,
        ),
        /listing_moderation_scope_origin_invalid|permission denied/,
      );
    } finally {
      if (started) {
        spawnSync(join(postgresBin, "pg_ctl"), ["-D", data, "-m", "fast", "stop"]);
      }
      await rm(cluster, { recursive: true, force: true });
    }
  },
);
