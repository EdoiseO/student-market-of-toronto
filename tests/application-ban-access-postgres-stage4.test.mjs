import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const migrationUrls = [
  "../supabase/migrations/20260816061431_moderation_enforcement_foundation.sql",
  "../supabase/migrations/20260816081857_trusted_moderation_action_rpcs.sql",
  "../supabase/migrations/20260816165454_enforcement_notification_lifecycle.sql",
  "../supabase/migrations/20260816171400_harden_account_standing_lifecycle.sql",
  "../supabase/migrations/20260816171825_application_enforced_ban_access.sql",
];
const migrations = await Promise.all(
  migrationUrls.map((url) => readFile(new URL(url, import.meta.url), "utf8")),
);

const postgresBin = [
  process.env.POSTGRES_BIN,
  "/opt/homebrew/opt/postgresql@16/bin",
  "/usr/local/opt/postgresql@16/bin",
]
  .filter(Boolean)
  .find((candidate) => existsSync(join(candidate, "postgres")));

test(
  "PostgreSQL preserves authenticated standing access while application bans fail marketplace writes closed",
  { skip: !postgresBin, timeout: 60_000 },
  async () => {
    const cluster = await mkdtemp(join(tmpdir(), "smot-application-ban4-"));
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
    const asUser = (userId, statement, expectFailure = false) => sql(
      `set role authenticated;
       set request.jwt.claims='{"role":"authenticated","sub":"${userId}"}';
       ${statement}`,
      expectFailure,
    );
    const service = (statement, expectFailure = false) => sql(
      `set role service_role;
       set request.jwt.claims='{"role":"service_role"}';
       ${statement}`,
      expectFailure,
    );

    const admin = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const legacyTemporary = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const legacyPermanent = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const legacyAdmin = "99999999-9999-4999-8999-999999999999";
    const temporary = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const permanent = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const genericRevoke = "11111111-1111-4111-8111-111111111111";
    const genericOverturn = "22222222-2222-4222-8222-222222222222";
    const genericModify = "33333333-3333-4333-8333-333333333333";
    const cleanup = "44444444-4444-4444-8444-444444444444";
    const escalation = "55555555-5555-4555-8555-555555555555";

    const requestIds = {
      temporaryBan: "10000000-0000-4000-8000-000000000001",
      temporaryUnban: "10000000-0000-4000-8000-000000000002",
      permanentBan: "10000000-0000-4000-8000-000000000003",
      permanentUnban: "10000000-0000-4000-8000-000000000004",
      genericRevoke: "10000000-0000-4000-8000-000000000005",
      genericOverturn: "10000000-0000-4000-8000-000000000006",
      genericModify: "10000000-0000-4000-8000-000000000007",
      legacyAdminUnban: "10000000-0000-4000-8000-000000000008",
    };

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
      sql(migrations[0]);
      sql(migrations[1]);
      sql(migrations[2]);
      sql(migrations[3]);

      // Legacy GoTrue bans and representative user-owned rows must predate the
      // cutover so the migration proves both import and trigger installation.
      sql(`
        insert into auth.users(id,email,raw_app_meta_data,banned_until) values
          ('${admin}','admin@georgebrown.ca','{"role":"admin"}',null),
          ('${legacyTemporary}','temporary@georgebrown.ca','{}',now()+interval '7 days'),
          ('${legacyPermanent}','permanent@georgebrown.ca','{}',now()+interval '100 years'),
          ('${legacyAdmin}','legacy-admin@georgebrown.ca','{"role":"admin"}',now()+interval '7 days'),
          ('${temporary}','new-temporary@georgebrown.ca','{}',null),
          ('${permanent}','new-permanent@georgebrown.ca','{}',null),
          ('${genericRevoke}','revoke@georgebrown.ca','{}',null),
          ('${genericOverturn}','overturn@georgebrown.ca','{}',null),
          ('${genericModify}','modify@georgebrown.ca','{}',null),
          ('${escalation}','escalation@georgebrown.ca','{}',null),
          ('${cleanup}','cleanup@georgebrown.ca','{}',null);

        insert into public.profiles(id,school) values
          ('${legacyTemporary}','School'),('${cleanup}','School');
        insert into public.listings(id,seller_id,slug,title,status) values
          ('50000000-0000-4000-8000-000000000001','${legacyTemporary}','legacy-listing','Legacy listing','active'),
          ('50000000-0000-4000-8000-000000000002','${cleanup}','cleanup-listing','Cleanup listing','active');
        insert into public.reports(id,reported_user_id,subject_type,subject_id,status) values
          ('50000000-0000-4000-8000-000000000003','${legacyTemporary}','profile','${legacyTemporary}','open');

        insert into public.listing_images(id) values ('51000000-0000-4000-8000-000000000001');
        insert into public.listing_favourites(id) values ('51000000-0000-4000-8000-000000000002');
        insert into public.conversations(id) values ('51000000-0000-4000-8000-000000000003');
        insert into public.conversation_user_state(id) values ('51000000-0000-4000-8000-000000000004');
        insert into public.messages(id) values ('51000000-0000-4000-8000-000000000005');
        insert into public.message_attachments(id) values ('51000000-0000-4000-8000-000000000006');
        insert into public.message_reactions(id) values ('51000000-0000-4000-8000-000000000007');
        insert into public.blocked_users(id) values ('51000000-0000-4000-8000-000000000008');
        insert into public.notification_preferences(id) values ('51000000-0000-4000-8000-000000000009');
        insert into private.message_media_upload_reservations(id)
          values ('51000000-0000-4000-8000-000000000010');
        insert into storage.objects(id,bucket_id,name) values
          ('52000000-0000-4000-8000-000000000001','profile-images','legacy/profile.jpg'),
          ('52000000-0000-4000-8000-000000000002','listing-images','legacy/listing.jpg'),
          ('52000000-0000-4000-8000-000000000003','message-media','legacy/message.jpg');
      `);

      sql(migrations[4]);
      sql(`
        grant select,insert,update,delete on all tables in schema public
          to authenticated,service_role;
        grant usage on schema private,storage to authenticated,service_role;
        grant select,insert,update,delete
          on private.message_media_upload_reservations to authenticated,service_role;
        grant select,insert,update,delete on storage.objects to authenticated,service_role;
      `);

      assert.equal(
        sql(`select banned_until is null from auth.users where id='${legacyTemporary}';`),
        "t",
        "a matched temporary legacy Auth ban must be cleared after durable import",
      );
      assert.equal(
        sql(`select is_banned and banned_until is not null from user_status where user_id='${legacyTemporary}';`),
        "t",
      );
      assert.equal(
        sql(`select banned_until is null from auth.users where id='${legacyPermanent}';`),
        "t",
      );
      assert.equal(
        sql(`select is_banned and banned_until is null from user_status where user_id='${legacyPermanent}';`),
        "t",
        "a 100-year legacy ban must become a permanent NULL application expiry",
      );
      assert.equal(
        sql(`select expires_at is null from moderation_sanctions where subject_user_id_snapshot='${legacyPermanent}' and metadata->>'origin'='legacy_auth_ban_cutover';`),
        "t",
      );
      assert.equal(
        sql(`select count(*) from moderation_audit_events where subject_user_id_snapshot in ('${legacyTemporary}','${legacyPermanent}') and event_type='sanction_issued';`),
        "2",
        "legacy imports must be audited by the canonical lifecycle trigger",
      );
      assert.equal(
        sql(`select is_banned and banned_until is not null from user_status where user_id='${legacyAdmin}';`),
        "t",
      );
      assert.equal(
        asUser(
          admin,
          `select not is_banned from set_application_moderation_ban(
            '${legacyAdmin}','unban','','','','Legacy administrator restriction removed after review.',
            '${requestIds.legacyAdminUnban}'
          );`,
        ),
        "t",
        "a different active administrator can recover a legacy-banned administrator",
      );
      assert.match(
        asUser(
          admin,
          `select * from set_application_moderation_ban(
            '${legacyAdmin}','ban','24h','spam','Administrators remain protected from new bans.','',
            '10000000-0000-4000-8000-000000000009'
          );`,
          true,
        ),
        /moderation_subject_is_protected/i,
      );

      const temporaryBan = asUser(
        admin,
        `select sanction_id||':'||is_banned||':'||(banned_until between now()+interval '23 hours' and now()+interval '25 hours')||':'||replayed
           from set_application_moderation_ban(
             '${temporary}','ban','24h','spam','Repeated prohibited marketplace spam.','',
             '${requestIds.temporaryBan}'
           );`,
      );
      const [temporarySanctionId] = temporaryBan.split(":");
      assert.match(temporaryBan, /^[0-9a-f-]+:true:true:false$/);
      assert.equal(
        sql(`select banned_until is null from auth.users where id='${temporary}';`),
        "t",
        "application bans must leave the Auth session sign-in capable",
      );
      assert.equal(
        asUser(
          admin,
          `select sanction_id='${temporarySanctionId}' and replayed
             from set_application_moderation_ban(
               '${temporary}','ban','24h','spam','Repeated prohibited marketplace spam.','',
               '${requestIds.temporaryBan}'
             );`,
        ),
        "t",
      );
      assert.match(
        asUser(
          admin,
          `select * from set_application_moderation_ban(
             '${temporary}','ban','7d','spam','Repeated prohibited marketplace spam.','',
             '${requestIds.temporaryBan}'
           );`,
          true,
        ),
        /moderation_request_id_payload_conflict/i,
      );
      assert.equal(
        asUser(
          temporary,
          "select has_active_ban from get_account_standing_summary();",
        ),
        "t",
      );
      assert.equal(
        asUser(temporary, `select acknowledge_moderation_sanction('${temporarySanctionId}');`),
        "t",
      );
      assert.equal(
        asUser(temporary, `select request_moderation_sanction_review('${temporarySanctionId}');`),
        "t",
      );

      const temporaryNotification = asUser(
        temporary,
        "select id from notifications where type='moderation_ban' order by created_at desc limit 1;",
      );
      assert.ok(temporaryNotification);
      asUser(
        temporary,
        `update notifications set read_at='2099-01-01',dismissed_at='2099-01-01' where id='${temporaryNotification}';`,
      );
      assert.equal(
        asUser(
          temporary,
          `select read_at is not null and read_at<'2099-01-01' and dismissed_at is not null and dismissed_at<'2099-01-01' from notifications where id='${temporaryNotification}';`,
        ),
        "t",
        "banned recipients retain server-timestamped notification lifecycle access",
      );

      assert.equal(
        asUser(
          admin,
          `select not is_banned and banned_until is null and not replayed
             from set_application_moderation_ban(
               '${temporary}','unban','','','','Restriction removed after administrator review.',
               '${requestIds.temporaryUnban}'
             );`,
        ),
        "t",
      );
      assert.equal(
        asUser(
          admin,
          `select not is_banned and replayed
             from set_application_moderation_ban(
               '${temporary}','unban','','','','Restriction removed after administrator review.',
               '${requestIds.temporaryUnban}'
             );`,
        ),
        "t",
      );

      const permanentSanctionId = asUser(
        admin,
        `select sanction_id from set_application_moderation_ban(
          '${permanent}','ban','permanent','scam','Permanent restriction for repeated marketplace scams.','',
          '${requestIds.permanentBan}'
        );`,
      );
      assert.equal(
        sql(`select is_banned and banned_until is null from user_status where user_id='${permanent}';`),
        "t",
      );
      assert.equal(
        asUser(
          admin,
          `select sanction_id='${permanentSanctionId}' and replayed from set_application_moderation_ban(
            '${permanent}','ban','permanent','scam','Permanent restriction for repeated marketplace scams.','',
            '${requestIds.permanentBan}'
          );`,
        ),
        "t",
      );
      assert.equal(
        asUser(
          admin,
          `select not is_banned from set_application_moderation_ban(
            '${permanent}','unban','','','','Permanent restriction removed after administrator review.',
            '${requestIds.permanentUnban}'
          );`,
        ),
        "t",
      );

      // Generic ban lifecycle paths remain safe: every path that can end or
      // replace a ban clears the application projection in the same SQL call.
      const revokeSanction = asUser(
        admin,
        `select sanction_id from set_application_moderation_ban(
          '${genericRevoke}','ban','7d','spam','Temporary restriction for repeated marketplace spam.','',
          '${requestIds.genericRevoke}'
        );`,
      );
      asUser(
        admin,
        `select revoke_moderation_sanction('${revokeSanction}','Restriction revoked after administrator review.');`,
      );
      assert.equal(
        sql(`select not is_banned and banned_until is null from user_status where user_id='${genericRevoke}';`),
        "t",
      );

      const overturnSanction = asUser(
        admin,
        `select sanction_id from set_application_moderation_ban(
          '${genericOverturn}','ban','7d','spam','Temporary restriction pending a user appeal.','',
          '${requestIds.genericOverturn}'
        );`,
      );
      asUser(genericOverturn, `select request_moderation_sanction_review('${overturnSanction}');`);
      asUser(
        admin,
        `select decide_moderation_sanction_review(
          '${overturnSanction}','overturned','The appeal was accepted after review.',null,
          'Restriction overturned after administrator review.'
        );`,
      );
      assert.equal(
        sql(`select not is_banned from user_status where user_id='${genericOverturn}';`),
        "t",
      );

      const modifySanction = asUser(
        admin,
        `select sanction_id from set_application_moderation_ban(
          '${genericModify}','ban','7d','spam','Temporary restriction pending a modified outcome.','',
          '${requestIds.genericModify}'
        );`,
      );
      asUser(genericModify, `select request_moderation_sanction_review('${modifySanction}');`);
      const replacementId = asUser(
        admin,
        `select modify_moderation_sanction_review(
          '${modifySanction}','warning','medium','spam','A warning replaces the account restriction.',
          'The appeal resulted in a warning.','Restriction replaced after administrator review.',
          null,null,'{}',null,null,null,true,null,'application-ban-modify-1'
        );`,
      );
      assert.equal(
        sql(`select sanction_type='warning' from moderation_sanctions where id='${replacementId}';`),
        "t",
      );
      assert.equal(
        sql(`select not is_banned from user_status where user_id='${genericModify}';`),
        "t",
      );

      const escalationWarning = asUser(
        admin,
        `select issue_moderation_warning(
          '${escalation}','medium','spam','Warning pending a possible escalation.',
          null,null,'{}',null,null,null,true,'application-ban-escalation-warning'
        );`,
      );
      asUser(escalation, `select request_moderation_sanction_review('${escalationWarning}');`);
      assert.match(
        asUser(
          admin,
          `select modify_moderation_sanction_review(
            '${escalationWarning}','ban','critical','spam','This must use the separate application ban command.',
            'Escalation was considered after review.','Original warning replaced after review.',
            null,null,'{}',null,null,null,true,null,'application-ban-escalation-1'
          );`,
          true,
        ),
        /application_ban_replacement_requires_separate_action/i,
      );
      assert.equal(
        sql(`select review_status='pending' and replacement_sanction_id is null from moderation_sanctions where id='${escalationWarning}';`),
        "t",
        "a rejected escalation must leave the reviewed warning and projection unchanged",
      );

      for (const [table, id] of [
        ["profiles", legacyTemporary],
        ["listings", "50000000-0000-4000-8000-000000000001"],
        ["reports", "50000000-0000-4000-8000-000000000003"],
        ["listing_images", "51000000-0000-4000-8000-000000000001"],
        ["listing_favourites", "51000000-0000-4000-8000-000000000002"],
        ["conversations", "51000000-0000-4000-8000-000000000003"],
        ["conversation_user_state", "51000000-0000-4000-8000-000000000004"],
        ["messages", "51000000-0000-4000-8000-000000000005"],
        ["message_attachments", "51000000-0000-4000-8000-000000000006"],
        ["message_reactions", "51000000-0000-4000-8000-000000000007"],
        ["blocked_users", "51000000-0000-4000-8000-000000000008"],
        ["notification_preferences", "51000000-0000-4000-8000-000000000009"],
      ]) {
        assert.match(
          asUser(legacyTemporary, `delete from public.${table} where id='${id}';`, true),
          /account_is_banned/i,
          `${table} must reject authenticated writes while banned`,
        );
      }
      assert.match(
        asUser(
          legacyTemporary,
          "delete from private.message_media_upload_reservations where id='51000000-0000-4000-8000-000000000010';",
          true,
        ),
        /account_is_banned/i,
      );
      for (const bucket of ["profile-images", "listing-images", "message-media"]) {
        assert.match(
          asUser(
            legacyTemporary,
            `delete from storage.objects where bucket_id='${bucket}';`,
            true,
          ),
          /account_is_banned/i,
          `${bucket} must reject authenticated storage writes while banned`,
        );
      }

      assert.equal(
        sql(`select count(*) from pg_trigger where not tgisinternal and tgname='reject_banned_authenticated_write';`),
        "13",
        "every guarded public/private relation must receive the ban trigger",
      );
      assert.equal(
        service("delete from public.listing_images where id='51000000-0000-4000-8000-000000000001' returning id;"),
        "51000000-0000-4000-8000-000000000001",
        "service-owned cleanup bypasses only the authenticated-user guard",
      );
      assert.equal(
        service("delete from storage.objects where bucket_id='profile-images' returning bucket_id;"),
        "profile-images",
      );
      service(`delete from auth.users where id='${cleanup}';`);
      assert.equal(sql(`select count(*) from auth.users where id='${cleanup}';`), "0");
      assert.equal(sql(`select count(*) from profiles where id='${cleanup}';`), "0");
      assert.equal(sql(`select count(*) from listings where seller_id='${cleanup}';`), "0");

      for (const signature of [
        "public.begin_auth_ban_operation(uuid,text,text,jsonb,text)",
        "public.complete_auth_ban_operation(uuid,timestamptz)",
        "public.abort_auth_ban_operation(uuid)",
        "public.issue_moderation_ban(uuid,text,text,text,text,uuid,text,uuid,text)",
        "public.revoke_active_moderation_ban(uuid,text)",
      ]) {
        assert.equal(
          sql(`select has_function_privilege('authenticated','${signature}','EXECUTE');`),
          "f",
          `${signature} must be retired for stale authenticated clients`,
        );
      }
      assert.match(
        asUser(
          admin,
          `select * from moderation_action_private.set_application_moderation_ban_impl(
            '${temporary}','ban','24h','spam','Direct private invocation is forbidden.','',
            '10000000-0000-4000-8000-000000000099'
          );`,
          true,
        ),
        /permission denied for schema moderation_action_private/i,
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
create extension if not exists pgcrypto;
create role postgres superuser;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema private;
create schema storage;

create function auth.jwt() returns jsonb language sql stable
as $body$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $body$;
create function auth.uid() returns uuid language sql stable
as $body$ select nullif(coalesce(auth.jwt()->>'sub',''),'')::uuid $body$;
create function auth.role() returns text language sql stable
as $body$ select coalesce(auth.jwt()->>'role','') $body$;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on function auth.jwt() to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
grant execute on function auth.role() to anon,authenticated,service_role;

create table auth.users(
  id uuid primary key,
  email text,
  raw_app_meta_data jsonb not null default '{}',
  raw_user_meta_data jsonb not null default '{}',
  role text,
  banned_until timestamptz,
  updated_at timestamptz not null default now()
);
grant select,insert,update,delete on auth.users to service_role;
create table public.reports(
  id uuid primary key,
  reported_user_id uuid references auth.users(id) on delete set null,
  subject_type text,
  subject_id uuid,
  listing_id uuid,
  message_id uuid,
  status text default 'open',
  reviewed_by uuid,
  reviewed_at timestamptz
);
create table public.listings(
  id uuid primary key,
  seller_id uuid not null references auth.users(id) on delete cascade,
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
create table public.notifications(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  conversation_id uuid,
  message_id uuid,
  listing_id uuid references public.listings(id) on delete set null,
  metadata jsonb not null default '{}',
  constraint notifications_type_check check(type in (
    'message','messages','announcement','favourite_sold','favourite_unavailable',
    'favourite_price_change','listing_sold','listing_approved','listing_rejected',
    'moderator_role_granted'
  ))
);
create table public.listing_moderation_history(
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  action text not null,
  feedback text,
  decided_by uuid,
  decided_at timestamptz not null
);
create table public.profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  school text
);
create function private.toronto_school_name_for_email(text) returns text
language sql immutable as $body$ select 'School'::text $body$;

create table public.listing_images(id uuid primary key);
create table public.listing_favourites(id uuid primary key);
create table public.conversations(id uuid primary key);
create table public.conversation_user_state(id uuid primary key);
create table public.messages(id uuid primary key);
create table public.message_attachments(id uuid primary key);
create table public.message_reactions(id uuid primary key);
create table public.blocked_users(id uuid primary key);
create table public.notification_preferences(id uuid primary key);
create table private.message_media_upload_reservations(id uuid primary key);
create table storage.objects(id uuid primary key,bucket_id text not null,name text not null);

alter table public.notifications enable row level security;
create policy notifications_select_own on public.notifications for select to authenticated
  using(user_id=auth.uid());
create policy notifications_update_own on public.notifications for update to authenticated
  using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy notifications_delete_own on public.notifications for delete to authenticated
  using(user_id=auth.uid());
grant select,update,delete on public.notifications to authenticated;
grant select,insert,update,delete on public.notifications to service_role;
`;
