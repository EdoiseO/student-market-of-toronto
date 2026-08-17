import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const cutover = await readFile(
  new URL(
    "../supabase/migrations/20260816235109_stage6_trusted_writer_cutover.sql",
    import.meta.url,
  ),
  "utf8",
);
const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);
const fullChainMigrationNames = (await readdir(migrationDirectory))
  .filter(
    (name) =>
      name.endsWith(".sql") &&
      name <= "20260816235109_stage6_trusted_writer_cutover.sql",
  )
  .sort();
const fullChainMigrations = await Promise.all(
  fullChainMigrationNames.map(async (name) => ({
    name,
    sql: await readFile(new URL(name, migrationDirectory), "utf8"),
  })),
);
const accountDeleteRoute = await readFile(
  new URL("../src/app/api/account/delete/route.js", import.meta.url),
  "utf8",
);
const conversationModerationRoute = await readFile(
  new URL(
    "../src/app/api/admin/conversations/[conversationId]/moderation/route.js",
    import.meta.url,
  ),
  "utf8",
);
const announcementWorker = await readFile(
  new URL("../src/lib/announcement-delivery-worker.mjs", import.meta.url),
  "utf8",
);

const retiredPublicFunctions = [
  "public.save_owned_listing_draft(text,uuid,bigint,text,numeric,text,text,text,boolean)",
  "public.discard_owned_listing_draft(uuid)",
  "public.discard_owned_listing_draft_if_unchanged(uuid,bigint)",
  "public.replace_owned_listing_images(uuid,bigint,jsonb)",
  "public.save_owned_listing_draft_with_images(uuid,bigint,jsonb,text,text,numeric,text,text,text,boolean)",
  "public.transition_owned_listing_status(uuid,text)",
  "public.retire_owned_listing(uuid)",
  "public.save_owned_listing_draft_idempotent(uuid,text,uuid,bigint,text,numeric,text,text,text,boolean)",
  "public.discard_owned_listing_draft_if_unchanged_idempotent(uuid,uuid,bigint)",
  "public.replace_owned_listing_images_idempotent(uuid,uuid,bigint,jsonb)",
  "public.save_owned_listing_draft_with_images_idempotent(uuid,uuid,bigint,jsonb,text,text,numeric,text,text,text,boolean)",
  "public.retire_owned_listing_idempotent(uuid,uuid)",
  "public.reserve_message_media_uploads(uuid,jsonb)",
  "public.send_conversation_message_with_attachments(uuid,text,jsonb)",
  "public.decide_listing_moderation(uuid,bigint,timestamptz,text,text,text)",
  "public.decide_report_set(uuid[],text,text)",
  "public.remove_reported_listing(uuid[],uuid,text)",
  "public.begin_force_name_operation(uuid[],uuid,jsonb,jsonb,text)",
  "public.complete_force_name_operation(uuid)",
  "public.force_profile_name_change(uuid[],uuid,text)",
  "public.transition_conversation_moderation_state(uuid,bigint,text,text,text,uuid,timestamptz,text,uuid,text)",
];

const retiredHiddenFunctions = [
  "listing_action_private.save_owned_listing_draft_impl(text,uuid,bigint,text,numeric,text,text,text,boolean)",
  "listing_action_private.discard_owned_listing_draft_impl(uuid,bigint)",
  "listing_action_private.discard_owned_listing_draft_idempotent_impl(uuid,uuid,bigint)",
  "listing_action_private.replace_owned_listing_images_impl(uuid,bigint,jsonb,boolean,text,text,numeric,text,text,text,boolean)",
  "listing_action_private.save_owned_listing_draft_idempotent_impl(uuid,text,uuid,bigint,text,numeric,text,text,text,boolean)",
  "listing_action_private.replace_owned_listing_images_idempotent_impl(uuid,uuid,bigint,jsonb,boolean,text,text,numeric,text,text,text,boolean)",
  "listing_action_private.transition_owned_listing_status_impl(uuid,text)",
  "listing_action_private.retire_owned_listing_idempotent_impl(uuid,uuid)",
  "moderation_action_private.decide_listing_moderation_impl(uuid,bigint,timestamptz,text,text,text)",
  "moderation_action_private.decide_listing_moderation_legacy_impl(uuid,bigint,timestamptz,text,text)",
  "moderation_action_private.decide_report_set_impl(uuid[],text,text)",
  "moderation_action_private.remove_reported_listing_impl(uuid[],uuid,text)",
  "moderation_action_private.force_profile_name_change_impl(uuid[],uuid,text)",
  "moderation_action_private.begin_force_name_operation_impl(uuid[],uuid,jsonb,jsonb,text)",
  "moderation_action_private.complete_force_name_operation_impl(uuid)",
  "conversation_moderation_private.transition_conversation_moderation_state_impl(uuid,bigint,text,text,text,uuid,timestamptz,text,uuid,text)",
];

const retainedAuthenticatedFunctions = [
  "public.begin_owned_listing_write_intent(uuid,text,text,uuid,bigint,boolean)",
  "public.list_owned_listing_write_intents(integer)",
  "public.get_owned_listing_write_intent(uuid)",
  "public.commit_owned_listing_create_draft_intent(uuid,text,text,text,numeric,text,text,text,boolean)",
  "public.reserve_owned_listing_image_uploads(uuid,text,uuid,jsonb)",
  "public.verify_owned_listing_reserved_upload(uuid,text,text)",
  "public.commit_owned_listing_create_intent(uuid,text,jsonb,boolean)",
  "public.commit_owned_listing_edit_intent(uuid,text,jsonb,text,text,numeric,text,text,text,boolean)",
  "public.commit_owned_listing_retire_intent(uuid,text)",
  "public.abort_owned_listing_write_intent(uuid,text)",
  "public.claim_owned_listing_image_cleanup_tasks(integer)",
  "public.complete_owned_listing_image_cleanup_task(uuid,uuid)",
  "public.release_owned_listing_image_cleanup_task(uuid,uuid,integer)",
  "public.transition_owned_listing_status_idempotent(uuid,uuid,text)",
  "public.submit_marketplace_report(text,uuid,text,text,uuid)",
  "public.reserve_message_media_uploads_idempotent(uuid,uuid,text,jsonb)",
  "public.send_conversation_message_idempotent(uuid,uuid,text,jsonb)",
  "public.abort_message_send_operation(uuid,uuid,text,jsonb)",
  "public.list_expired_message_media_uploads()",
  "public.release_message_media_upload_reservations(text[])",
  "public.decide_listing_moderation_with_rationale(uuid,bigint,timestamptz,text,text,uuid)",
  "public.decide_report_set_with_summary(uuid[],text,text,uuid)",
  "public.remove_reported_listing_with_rationale(uuid[],uuid,text,text,uuid)",
  "public.save_report_moderator_note(uuid,text,uuid)",
  "public.begin_force_name_operation_with_rationale(uuid[],uuid,jsonb,jsonb,text,text,text,uuid)",
  "public.complete_force_name_operation_with_rationale(uuid)",
  "public.abort_force_name_operation(uuid)",
];

const retainedServiceFunctions = [
  "public.claim_listing_image_cleanup_tasks(integer)",
  "public.claim_listing_account_cleanup_tasks(uuid,uuid,integer)",
  "public.complete_listing_image_cleanup_task(uuid,uuid)",
  "public.release_listing_image_cleanup_task(uuid,uuid,integer)",
  "public.prepare_listing_account_retirement(uuid,uuid)",
  "public.finalize_listing_account_retirement(uuid,uuid)",
  "public.maintain_listing_write_recovery(integer)",
  "public.prepare_message_media_account_cleanup(uuid)",
  "public.retire_message_media_account_reservations(uuid,text[])",
  "public.admin_moderate_conversation(uuid,uuid,bigint,text,text,text,text,text,uuid,boolean,uuid)",
];

const retainedHiddenAuthenticatedFunctions = [
  "moderation_action_private.abort_force_name_operation_impl(uuid)",
];

test("cutover retires only superseded writers and preserves current trusted paths", () => {
  const compactCutover = cutover.replace(/\s+/g, "").toLowerCase();
  assert.match(
    cutover,
    /revoke insert, update, delete, truncate on table public\.listings[\s\S]*public\.listing_images[\s\S]*public\.reports/i,
  );

  for (const signature of retiredPublicFunctions) {
    assert.ok(
      compactCutover.includes(`revokeexecuteonfunction${signature.toLowerCase()}`),
      `missing public cutover for ${signature}`,
    );
  }
  for (const signature of retiredHiddenFunctions) {
    assert.ok(
      compactCutover.includes(`revokeexecuteonfunction${signature.toLowerCase()}`),
      `missing hidden cutover for ${signature}`,
    );
  }

  for (const signature of retainedAuthenticatedFunctions) {
    assert.ok(
      compactCutover.includes(`grantexecuteonfunction${signature.toLowerCase()}toauthenticated`),
      `authenticated trusted path must be re-granted: ${signature}`,
    );
  }
  for (const signature of retainedServiceFunctions) {
    assert.ok(
      compactCutover.includes(`grantexecuteonfunction${signature.toLowerCase()}toservice_role`),
      `service trusted path must be re-granted: ${signature}`,
    );
  }
  for (const signature of retainedHiddenAuthenticatedFunctions) {
    assert.equal(
      compactCutover.includes(`revokeexecuteonfunction${signature.toLowerCase()}`),
      false,
      `hidden rollback path must not be retired: ${signature}`,
    );
  }
  assert.match(accountDeleteRoute, /retireListingMediaForAccount/);
  assert.match(accountDeleteRoute, /retireOutstandingMessageMediaReservations/);
  assert.match(conversationModerationRoute, /admin\.rpc\("admin_moderate_conversation"/);
  assert.doesNotMatch(
    conversationModerationRoute,
    /transition_conversation_moderation_state/,
  );
  assert.doesNotMatch(announcementWorker, /transition_conversation_moderation_state/);
  assert.match(
    cutover,
    /to_regprocedure\('public\.force_profile_name_change\(uuid\[\],uuid,text\)'\)/i,
  );
});

const postgresBin = [
  process.env.POSTGRES_BIN,
  "/opt/homebrew/opt/postgresql@16/bin",
  "/usr/local/opt/postgresql@16/bin",
]
  .filter(Boolean)
  .find((candidate) => existsSync(join(candidate, "postgres")));

function createFunctionSql(signature) {
  return `create function ${signature} returns text language sql as $$ select 'ok'::text $$;`;
}

test(
  "PostgreSQL cutover denies direct writes and exact old RPCs while retained flows still execute",
  { skip: !postgresBin, timeout: 30_000 },
  async () => {
    const cluster = await mkdtemp(join(tmpdir(), "smot-stage6-cutover-"));
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

    try {
      command("initdb", ["-D", data, "-A", "trust", "--no-locale", "--encoding=UTF8"]);
      command(
        "pg_ctl",
        ["-D", data, "-o", `-p ${port} -k ${cluster} -c listen_addresses=''`, "-w", "start"],
        { stdio: "ignore" },
      );
      started = true;
      sql(`
        create role postgres superuser;
        create role anon nologin;
        create role authenticated nologin;
        create role service_role nologin bypassrls;
        create schema listing_action_private;
        create schema moderation_action_private;
        create schema conversation_moderation_private;
        create table public.listings(
          id uuid primary key,
          seller_id uuid,
          slug text,
          title text,
          description text,
          price numeric,
          category text,
          condition text,
          location text,
          status text,
          is_negotiable boolean
        );
        create table public.listing_images(
          id uuid primary key,
          listing_id uuid references public.listings(id) on delete cascade
        );
        create table public.reports(id uuid primary key);
        grant select, insert, update, delete, truncate on
          public.listings, public.listing_images, public.reports
          to anon, authenticated, service_role;
        grant insert (
          seller_id, slug, title, description, price, category, condition,
          location, status, is_negotiable
        ) on public.listings to authenticated;
        grant update (
          slug, title, description, price, category, condition, location,
          is_negotiable
        ) on public.listings to authenticated;
        ${retiredPublicFunctions.map(createFunctionSql).join("\n")}
        ${retiredHiddenFunctions.map(createFunctionSql).join("\n")}
        ${retainedAuthenticatedFunctions.map(createFunctionSql).join("\n")}
        ${retainedServiceFunctions.map(createFunctionSql).join("\n")}
        ${retainedHiddenAuthenticatedFunctions.map(createFunctionSql).join("\n")}
        grant usage on schema listing_action_private, moderation_action_private,
          conversation_moderation_private
          to authenticated, service_role;
        grant execute on all functions in schema public, listing_action_private,
          moderation_action_private, conversation_moderation_private
          to authenticated, service_role;
      `);

      sql(cutover);

      for (const table of ["listings", "listing_images", "reports"]) {
        for (const role of ["anon", "authenticated", "service_role"]) {
          assert.equal(
            sql(`select has_table_privilege('${role}','public.${table}','insert,update,delete,truncate');`),
            "f",
          );
          assert.equal(
            sql(`select has_table_privilege('${role}','public.${table}','select');`),
            "t",
          );
        }
      }
      for (const column of [
        "seller_id", "slug", "title", "description", "price", "category",
        "condition", "location", "status", "is_negotiable",
      ]) {
        assert.equal(
          sql(`select has_column_privilege('authenticated','public.listings','${column}','insert');`),
          "f",
          `authenticated retained listing INSERT(${column})`,
        );
        assert.equal(
          sql(`select has_column_privilege('authenticated','public.listings','${column}','update');`),
          "f",
          `authenticated retained listing UPDATE(${column})`,
        );
      }

      for (const signature of retiredPublicFunctions.concat(retiredHiddenFunctions)) {
        for (const role of ["authenticated", "service_role"]) {
          assert.equal(
            sql(`select has_function_privilege('${role}','${signature}','execute');`),
            "f",
            `${role} still executes ${signature}`,
          );
        }
      }
      for (const signature of retainedAuthenticatedFunctions) {
        assert.equal(
          sql(`select has_function_privilege('authenticated','${signature}','execute');`),
          "t",
          `authenticated lost ${signature}`,
        );
      }
      for (const signature of retainedServiceFunctions) {
        assert.equal(
          sql(`select has_function_privilege('service_role','${signature}','execute');`),
          "t",
          `service_role lost ${signature}`,
        );
        assert.equal(
          sql(`select has_function_privilege('authenticated','${signature}','execute');`),
          "f",
          `authenticated gained service-only path ${signature}`,
        );
      }
      for (const signature of retainedHiddenAuthenticatedFunctions) {
        assert.equal(
          sql(`select has_function_privilege('authenticated','${signature}','execute');`),
          "t",
          `authenticated lost hidden rollback path ${signature}`,
        );
      }

      assert.match(
        sql(
          "\\set VERBOSITY verbose\nset role authenticated; insert into public.listings values (gen_random_uuid());",
          true,
        ),
        /42501|permission denied/i,
      );
      assert.match(
        sql(
          "\\set VERBOSITY verbose\nset role authenticated; select public.retire_owned_listing(gen_random_uuid());",
          true,
        ),
        /42501|permission denied/i,
      );
      assert.match(
        sql(
          "\\set VERBOSITY verbose\nset role authenticated; select public.send_conversation_message_with_attachments(gen_random_uuid(),'x','[]');",
          true,
        ),
        /42501|permission denied/i,
      );
      assert.match(
        sql(
          "\\set VERBOSITY verbose\nset role authenticated; select public.complete_force_name_operation(gen_random_uuid());",
          true,
        ),
        /42501|permission denied/i,
      );
      assert.match(
        sql(
          "\\set VERBOSITY verbose\nset role service_role; select public.force_profile_name_change('{}',gen_random_uuid(),'request');",
          true,
        ),
        /42501|permission denied/i,
      );
      assert.match(
        sql(
          "\\set VERBOSITY verbose\nset role service_role; select public.transition_conversation_moderation_state(gen_random_uuid(),0,'close','policy','user message',gen_random_uuid(),null,null,null,'request');",
          true,
        ),
        /42501|permission denied/i,
      );

      assert.equal(
        sql("set role authenticated; select public.begin_owned_listing_write_intent(gen_random_uuid(),'edit','hash',null,null,false);"),
        "ok",
      );
      assert.equal(
        sql("set role authenticated; select public.transition_owned_listing_status_idempotent(gen_random_uuid(),gen_random_uuid(),'mark_sold');"),
        "ok",
      );
      assert.equal(
        sql("set role authenticated; select public.submit_marketplace_report('listing',gen_random_uuid(),'other','details',gen_random_uuid());"),
        "ok",
      );
      assert.equal(
        sql("set role authenticated; select public.send_conversation_message_idempotent(gen_random_uuid(),gen_random_uuid(),'hello','[]');"),
        "ok",
      );
      assert.equal(
        sql("set role authenticated; select public.decide_report_set_with_summary('{}','resolved','valid summary',gen_random_uuid());"),
        "ok",
      );
      assert.equal(
        sql("set role authenticated; select public.abort_force_name_operation(gen_random_uuid());"),
        "ok",
      );
      assert.equal(
        sql("set role service_role; select public.prepare_listing_account_retirement(gen_random_uuid(),gen_random_uuid());"),
        "ok",
      );
      assert.equal(
        sql("set role service_role; select public.prepare_message_media_account_cleanup(gen_random_uuid());"),
        "ok",
      );
      assert.equal(
        sql("set role service_role; select public.admin_moderate_conversation(gen_random_uuid(),gen_random_uuid(),0,'close','policy','user message','day',null,null,false,gen_random_uuid());"),
        "ok",
      );

      const parent = "11111111-1111-4111-8111-111111111111";
      const child = "22222222-2222-4222-8222-222222222222";
      sql(`reset role; insert into public.listings values ('${parent}');
        insert into public.listing_images values ('${child}','${parent}');
        delete from public.listings where id='${parent}';`);
      assert.equal(sql(`select count(*) from public.listing_images where id='${child}';`), "0");
    } finally {
      if (started) {
        spawnSync(join(postgresBin, "pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"], {
          stdio: "ignore",
        });
      }
      await rm(cluster, { recursive: true, force: true });
    }
  },
);

const FULL_CHAIN_BOOTSTRAP_SQL = String.raw`
create extension if not exists pgcrypto;
create role postgres superuser;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;
create schema auth;
create schema private;
create schema storage;

create function auth.jwt() returns jsonb language sql stable
as $body$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $body$;
create function auth.uid() returns uuid language sql stable
as $body$ select nullif(auth.jwt() ->> 'sub', '')::uuid $body$;
create function auth.role() returns text language sql stable
as $body$ select coalesce(auth.jwt() ->> 'role', '') $body$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key,
  email text unique,
  raw_app_meta_data jsonb not null default '{}',
  raw_user_meta_data jsonb not null default '{}',
  role text,
  banned_until timestamptz,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on auth.users to service_role;

create function storage.foldername(text) returns text[] language sql immutable
as $body$ select string_to_array($1, '/') $body$;
create function storage.allow_only_operation(text) returns boolean language sql stable
as $body$ select true $body$;
grant usage on schema storage to anon, authenticated, service_role;
grant execute on all functions in schema storage to anon, authenticated, service_role;

create table storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  owner_id text,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null,
  owner uuid,
  owner_id text,
  metadata jsonb not null default '{}',
  user_metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_accessed_at timestamptz,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select, insert, update, delete on storage.buckets to service_role;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  school text,
  bio text,
  description text,
  avatar_url text,
  avatar_preset_id text,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  slug text not null unique,
  title text not null,
  description text not null default '',
  price numeric not null default 0,
  previous_price numeric,
  category text,
  condition text,
  location text,
  status text not null default 'draft',
  is_negotiable boolean not null default false,
  is_featured boolean not null default false,
  view_count bigint not null default 0,
  submitted_for_review_at timestamptz,
  moderation_feedback text,
  moderation_reviewed_at timestamptz,
  moderation_reviewed_by uuid,
  content_revision bigint not null default 1,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.listing_images (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  image_url text not null,
  storage_path text unique,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create table public.listing_favourites (
  listing_id uuid not null references public.listings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (listing_id, user_id)
);
create table public.listing_moderation_history (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  action text not null,
  feedback text,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz not null default now()
);
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.listings(id) on delete set null,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  last_message_at timestamptz,
  last_message_preview text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint messages_body_length_check check (char_length(body) between 1 and 2000)
);
create table public.conversation_user_state (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  hidden_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create table public.blocked_users (
  blocker_user_id uuid not null references public.profiles(id) on delete cascade,
  blocked_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_user_id, blocked_user_id)
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  conversation_id uuid references public.conversations(id) on delete cascade,
  message_id uuid references public.messages(id) on delete cascade,
  listing_id uuid references public.listings(id) on delete set null,
  metadata jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_type_check check (char_length(type) between 1 and 80)
);
create table public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  email_messages boolean not null default true,
  email_listing_updates boolean not null default true,
  email_announcements boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid references public.profiles(id) on delete set null,
  reported_user_id uuid references public.profiles(id) on delete set null,
  subject_type text,
  subject_id uuid,
  listing_id uuid references public.listings(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  reason text not null default 'other',
  details text,
  status text not null default 'open',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_moderation_role() returns boolean
language sql stable security definer set search_path = ''
as $body$
  select exists (
    select 1 from auth.users account where account.id = auth.uid()
      and lower(coalesce(account.raw_app_meta_data ->> 'role', '')) in ('admin', 'moderator')
  )
$body$;
create or replace function private.toronto_school_name_for_email(text) returns text
language sql immutable as $body$ select 'Toronto School'::text $body$;
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $body$ begin
  insert into public.profiles(id, first_name, last_name, school)
  values (new.id, new.raw_user_meta_data ->> 'first_name', new.raw_user_meta_data ->> 'last_name',
    private.toronto_school_name_for_email(new.email));
  return new;
end $body$;
create trigger on_auth_user_created
after insert on auth.users for each row execute function public.handle_new_user();
create or replace function public.before_user_created_validate_school_email(event jsonb)
returns jsonb language sql stable as $body$ select event $body$;

alter table public.profiles enable row level security;
alter table public.listings enable row level security;
alter table public.listing_images enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.conversation_user_state enable row level security;
alter table public.blocked_users enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.reports enable row level security;

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant select on public.listings, public.listing_images, public.profiles to anon;
grant execute on all functions in schema public to authenticated, service_role;

create publication supabase_realtime;
`;

test(
  "fresh PostgreSQL applies the actual repository migration chain through the trusted-writer cutover",
  { skip: !postgresBin, timeout: 120_000 },
  async () => {
    const cluster = await mkdtemp(join(tmpdir(), "smot-stage6-full-chain-"));
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
    const sql = (statement, label = "SQL") => {
      const result = spawnSync(
        join(postgresBin, "psql"),
        [
          "-X", "-qAt", "-h", cluster, "-p", String(port), "-d", "postgres",
          "-v", "ON_ERROR_STOP=1",
        ],
        { encoding: "utf8", input: statement },
      );
      assert.equal(result.status, 0, `${label}: ${result.stderr || result.stdout}`);
      return result.stdout.trim();
    };

    try {
      command("initdb", ["-D", data, "-A", "trust", "--no-locale", "--encoding=UTF8"]);
      command(
        "pg_ctl",
        ["-D", data, "-o", `-p ${port} -k ${cluster} -c listen_addresses=''`, "-w", "start"],
        { stdio: "ignore" },
      );
      started = true;
      sql(FULL_CHAIN_BOOTSTRAP_SQL, "full-chain bootstrap");
      for (const migration of fullChainMigrations) {
        sql(migration.sql, migration.name);
      }

      assert.equal(fullChainMigrationNames.at(-1), "20260816235109_stage6_trusted_writer_cutover.sql");
      assert.equal(
        sql("select has_function_privilege('service_role','public.transition_conversation_moderation_state(uuid,bigint,text,text,text,uuid,timestamptz,text,uuid,text)','execute');"),
        "f",
      );
      assert.equal(
        sql("select has_function_privilege('service_role','public.admin_moderate_conversation(uuid,uuid,bigint,text,text,text,text,text,uuid,boolean,uuid)','execute');"),
        "t",
      );
      assert.equal(
        sql("select has_function_privilege('authenticated','public.transition_owned_listing_status_idempotent(uuid,uuid,text)','execute');"),
        "t",
      );
      assert.equal(
        sql("select has_function_privilege('authenticated','public.send_conversation_message_with_attachments(uuid,text,jsonb)','execute');"),
        "f",
      );
      assert.equal(
        sql("select has_table_privilege('authenticated','public.listings','insert,update,delete,truncate');"),
        "f",
      );

      const admin = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const seller = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      const buyer = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
      const reporter = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
      const listing = "11111111-1111-4111-8111-111111111111";
      const conversation = "22222222-2222-4222-8222-222222222222";
      const reportOperation = "33333333-3333-4333-8333-333333333333";
      const moderationOperation = "44444444-4444-4444-8444-444444444444";
      sql(`
        insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,role)
        values
          ('${admin}','admin@georgebrown.ca','{"role":"admin"}',
            '{"first_name":"Admin","last_name":"User"}','authenticated'),
          ('${seller}','seller@georgebrown.ca','{}',
            '{"first_name":"Seller","last_name":"User"}','authenticated'),
          ('${buyer}','buyer@georgebrown.ca','{}',
            '{"first_name":"Buyer","last_name":"User"}','authenticated'),
          ('${reporter}','reporter@georgebrown.ca','{}',
            '{"first_name":"Reporter","last_name":"User"}','authenticated');
        insert into public.listings(
          id,seller_id,slug,title,description,price,category,condition,location,
          status,is_negotiable,is_featured,view_count
        ) values (
          '${listing}','${seller}','full-chain-listing','Full chain listing',
          'A complete listing used by the full migration-chain verification.',10,
          'books','used','George Brown College','active',false,false,0
        );
        insert into public.conversations(id,listing_id,buyer_id,seller_id)
        values ('${conversation}','${listing}','${buyer}','${seller}');
      `, "full-chain operational fixtures");

      sql(`
        set role authenticated;
        set request.jwt.claims = '{"role":"authenticated","sub":"${reporter}"}';
        select public.submit_marketplace_report(
          'listing','${listing}','other','A clear report detail.','${reportOperation}'
        );
      `, "retained trusted report submission");
      assert.equal(
        sql(`select count(*) from public.reports where reporter_user_id='${reporter}' and listing_id='${listing}';`),
        "1",
      );

      sql(`
        set role service_role;
        set request.jwt.claims = '{"role":"service_role"}';
        select public.admin_moderate_conversation(
          '${admin}','${conversation}',0,'close','policy_violation',
          'This conversation was closed by moderation.','permanent',null,null,
          false,'${moderationOperation}'
        );
      `, "retained Stage 5 conversation moderation");
      assert.equal(
        sql(`select status || ':' || version from public.conversation_moderation_state where conversation_id='${conversation}';`),
        "closed:1",
      );
    } finally {
      if (started) {
        spawnSync(join(postgresBin, "pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"], {
          stdio: "ignore",
        });
      }
      await rm(cluster, { recursive: true, force: true });
    }
  },
);
