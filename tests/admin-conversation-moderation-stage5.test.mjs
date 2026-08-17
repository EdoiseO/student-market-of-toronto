import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  normalizeAdminConversationFilter,
  normalizeAdminConversationMessagePage,
  normalizeAdminConversationPage,
  validateAdminConversationCommand,
} from "../src/lib/admin-conversations.mjs";

const migrationUrl = new URL(
  "../supabase/migrations/20260816181128_admin_conversation_moderation_stage5.sql",
  import.meta.url,
);
const foundationMigrationUrl = new URL(
  "../supabase/migrations/20260816061558_conversation_moderation_state_foundation.sql",
  import.meta.url,
);
const notificationMigrationUrl = new URL(
  "../supabase/migrations/20260816165529_conversation_moderation_participant_notifications.sql",
  import.meta.url,
);
const safeParticipantMessageMigrationUrl = new URL(
  "../supabase/migrations/20260816184707_participant_safe_conversation_moderation_messages_stage5.sql",
  import.meta.url,
);

const postgresCandidates = [
  process.env.POSTGRES_BIN,
  "/opt/homebrew/opt/postgresql@16/bin",
  "/opt/homebrew/opt/postgresql@17/bin",
  "/usr/local/opt/postgresql@16/bin",
  "/usr/lib/postgresql/16/bin",
].filter(Boolean);

function getPostgresBin() {
  return postgresCandidates.find((candidate) => existsSync(join(candidate, "postgres"))) ?? null;
}

function run(binary, args, options = {}) {
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(
      `${binary} ${args.join(" ")} failed:\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }

  return result.stdout;
}

test("conversation command validation is strict, role-aware, and retry-stable", () => {
  const valid = {
    action: "close",
    reasonCode: "harassment",
    userMessage: "This conversation is closed while the report is reviewed.",
    duration: "7d",
    internalNote: "Internal evidence reviewed.",
    sourceReportId: "55555555-5555-4555-8555-555555555555",
    resolveSourceReport: true,
    operationId: "66666666-6666-4666-8666-666666666666",
    expectedVersion: 0,
  };

  assert.equal(validateAdminConversationCommand(valid, "moderator").ok, true);
  assert.equal(
    validateAdminConversationCommand({ ...valid, duration: "permanent" }, "admin").ok,
    true,
  );
  assert.equal(
    validateAdminConversationCommand({ ...valid, duration: "permanent" }, "moderator").error,
    "permanent_forbidden",
  );
  assert.equal(
    validateAdminConversationCommand({ ...valid, sourceReportId: null }, "admin").error,
    "resolve_source_report",
  );
  assert.equal(
    validateAdminConversationCommand({ ...valid, userMessage: "short" }, "admin").error,
    "user_message",
  );
  assert.equal(
    validateAdminConversationCommand(
      { ...valid, action: "reopen", duration: "7d" },
      "admin",
    ).error,
    "reopen_duration",
  );
  assert.equal(normalizeAdminConversationFilter("REPORTED"), "reported");
  assert.equal(normalizeAdminConversationFilter("unknown"), "all");
  assert.equal(normalizeAdminConversationPage("99999"), 1000);
});

test("message evidence normalization caps the client window and exposes an older cursor", () => {
  const rows = Array.from({ length: 41 }, (_, index) => ({
    id: `message-${index}`,
    conversation_id: "conversation",
    sender_id: "sender",
    body: String(index),
    created_at: new Date(2026, 0, 1, 0, index).toISOString(),
    sender_first_name: "Student",
    sender_last_name: String(index),
    attachments: [],
    reactions: [],
    report_count: index === 0 ? 1 : 0,
  }));
  const page = normalizeAdminConversationMessagePage(rows);

  assert.equal(page.messages.length, 40);
  assert.equal(page.hasOlderMessages, true);
  assert.equal(page.messages[0].body, "39");
  assert.equal(page.messages.at(-1).body, "0");
});

test("Stage 5 surfaces use only bounded trusted RPCs and stable operation IDs", async () => {
  const [sql, safeNotificationSql, route, registryPage, detailPage, detailComponent] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(safeParticipantMessageMigrationUrl, "utf8"),
    readFile(
      new URL(
        "../src/app/api/admin/conversations/[conversationId]/moderation/route.js",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../src/app/admin/conversations/page.jsx", import.meta.url), "utf8"),
    readFile(
      new URL("../src/app/admin/conversations/[conversationId]/page.jsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/components/admin-conversation-detail.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(sql, /least\(greatest\(coalesce\(p_page_size, 25\), 1\), 50\)/i);
  assert.match(sql, /least\(greatest\(coalesce\(p_limit, 41\), 1\), 51\)/i);
  assert.match(sql, /candidate_rows as materialized[\s\S]*limit 2001/i);
  assert.match(sql, /moderation_action_private\.resolve_role_from_account/i);
  assert.match(sql, /security invoker[\s\S]*conversation_admin_private\.moderate_conversation_impl/i);
  assert.match(sql, /revoke all on schema conversation_admin_private[\s\S]*service_role/i);
  assert.match(sql, /unique \(actor_user_id_snapshot, operation_id\)/i);
  assert.match(sql, /transition_conversation_moderation_state_impl/i);
  assert.match(sql, /p_resolve_source_report[\s\S]*status = 'resolved'/i);
  assert.match(sql, /p_resolve_source_report[\s\S]*'decide_reports'/i);
  assert.match(sql, /insert into public\.moderation_audit_events/i);
  assert.match(route, /canPerformModerationAction/);
  assert.match(route, /MODERATION_ACTIONS\.decideReports/);
  assert.match(route, /catch \{[\s\S]*moderation request is invalid/i);
  assert.match(route, /admin\.rpc\("admin_moderate_conversation"/);
  assert.doesNotMatch(route, /\.from\(["'](?:conversations|conversation_moderation_state|reports)["']\).*\.(?:insert|update|delete)/s);
  assert.match(registryPage, /admin\.rpc\("admin_list_conversations"/);
  assert.match(detailPage, /admin\.rpc\("admin_get_conversation_message_page"/);
  assert.match(detailPage, /createSignedUrls\(attachmentPaths, 60 \* 30\)/);
  assert.match(detailComponent, /crypto\.randomUUID\(\)/);
  assert.match(detailComponent, /resolveSourceReport/);
  assert.match(safeNotificationSql, /'user_message', new\.user_message/i);
  assert.doesNotMatch(
    safeNotificationSql,
    /new\.(?:internal_note|actor_user_id|source_report_id|reason_code|audit_event_id)/i,
  );
  assert.doesNotMatch(safeNotificationSql, /supabase_realtime|notification_realtime_signals/i);
});

test("conversation navigation and search controls are visible and ordered", async () => {
  const [navigation, registry, translations] = await Promise.all([
    readFile(new URL("../src/components/admin-navigation.jsx", import.meta.url), "utf8"),
    readFile(
      new URL("../src/components/admin-conversation-registry.jsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/lib/translations.js", import.meta.url), "utf8"),
  ]);

  assert.ok(
    navigation.indexOf('key: "conversations"') < navigation.indexOf('key: "enforcement"'),
    "Conversations must appear before Enforcement",
  );
  assert.match(registry, /\{t\.adminConversationsSearchAction\}/);
  assert.doesNotMatch(registry, /\{t\.search\}/);
  assert.match(registry, /sm:grid-cols-\[minmax\(0,1fr\)_auto\]/);
  assert.equal(
    (translations.match(/\badminConversationsSearchAction:/g) ?? []).length,
    2,
    "the conversation search action must have EN and FR copy",
  );
});

test("admin back links use destination-specific copy and registry routes", async () => {
  const [conversationRegistry, enforcement, users, listingReview, reportReview, translations] =
    await Promise.all([
      readFile(new URL("../src/components/admin-conversation-registry.jsx", import.meta.url), "utf8"),
      readFile(new URL("../src/components/admin-enforcement-content.jsx", import.meta.url), "utf8"),
      readFile(new URL("../src/app/admin/users/page.jsx", import.meta.url), "utf8"),
      readFile(new URL("../src/app/admin/listings/[listingId]/page.jsx", import.meta.url), "utf8"),
      readFile(new URL("../src/app/admin/reports/[reportId]/page.jsx", import.meta.url), "utf8"),
      readFile(new URL("../src/lib/translations.js", import.meta.url), "utf8"),
    ]);

  for (const overviewSurface of [conversationRegistry, enforcement, users]) {
    assert.match(overviewSurface, /href="\/admin"/);
    assert.match(overviewSurface, /backToAdminOverview/);
    assert.doesNotMatch(overviewSurface, /backToAdminReports/);
  }

  assert.match(listingReview, /<Link href="\/admin\/listings">[\s\S]*?backToAdminListings/);
  assert.match(reportReview, /<Link href="\/admin\/reports">[\s\S]*?backToAdminReports/);
  assert.equal((translations.match(/\bbackToAdminOverview:/g) ?? []).length, 2);
  assert.equal((translations.match(/\bbackToAdminReports:/g) ?? []).length, 2);
  assert.equal((translations.match(/\bbackToAdminListings:/g) ?? []).length, 2);
});

test("PostgreSQL enforces bounded reads, exact replay, report atomicity, and role limits", { timeout: 120_000 }, async (t) => {
  const postgresBin = getPostgresBin();

  if (!postgresBin) {
    t.skip("PostgreSQL 16+ binaries are unavailable in this environment.");
    return;
  }

  const cluster = await mkdtemp(join(tmpdir(), "smot-admin-conversation5-"));
  const dataDirectory = join(cluster, "data");
  const socketDirectory = join(cluster, "socket");
  const logPath = join(cluster, "postgres.log");
  const port = String(56_000 + (process.pid % 1000));
  const initdb = join(postgresBin, "initdb");
  const pgCtl = join(postgresBin, "pg_ctl");
  const psql = join(postgresBin, "psql");
  let started = false;

  try {
    run(initdb, ["-D", dataDirectory, "-A", "trust", "--no-locale"]);
    await import("node:fs/promises").then(({ mkdir }) => mkdir(socketDirectory));
    run(pgCtl, [
      "-D",
      dataDirectory,
      "-l",
      logPath,
      "-o",
      `-k ${socketDirectory} -p ${port}`,
      "-w",
      "start",
    ]);
    started = true;

    const env = {
      ...process.env,
      PGHOST: socketDirectory,
      PGPORT: port,
      PGDATABASE: "postgres",
      PGUSER: process.env.USER,
    };
    const query = (sql, extra = []) =>
      run(psql, ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", ...extra, "-c", sql], { env });
    const apply = (url) =>
      run(psql, ["-X", "-v", "ON_ERROR_STOP=1", "-f", url.pathname], { env });

    query(`
      create extension if not exists pgcrypto;
      create role postgres superuser nologin;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema auth;
      create schema moderation_action_private;
      create table auth.users (
        id uuid primary key,
        raw_app_meta_data jsonb not null default '{}'::jsonb,
        banned_until timestamptz,
        role text not null default 'authenticated'
      );
      create function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
      $$;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(auth.jwt() ->> 'sub', '')::uuid
      $$;
      grant usage on schema auth to authenticated;
      grant execute on function auth.jwt(), auth.uid() to authenticated;
      create function moderation_action_private.resolve_role_from_account(
        p_app_metadata jsonb,
        p_auth_role text
      ) returns text language plpgsql immutable security definer set search_path='' as $$
      declare
        candidate text;
      begin
        candidate := lower(btrim(coalesce(p_app_metadata ->> 'role', '')));
        if candidate in ('admin', 'moderator', 'staff') then
          return candidate;
        end if;
        if jsonb_typeof(p_app_metadata -> 'roles') = 'array' then
          select lower(btrim(role_value.value))
          into candidate
          from jsonb_array_elements_text(p_app_metadata -> 'roles')
            with ordinality role_value(value, position)
          where lower(btrim(role_value.value)) in ('admin', 'moderator', 'staff')
          order by role_value.position
          limit 1;
          if candidate is not null then
            return candidate;
          end if;
        end if;
        candidate := lower(btrim(coalesce(p_auth_role, '')));
        return case when candidate in ('admin', 'moderator', 'staff') then candidate else null end;
      end
      $$;
      alter function moderation_action_private.resolve_role_from_account(jsonb, text)
        owner to postgres;

      create table public.profiles (
        id uuid primary key,
        first_name text,
        last_name text,
        school text,
        avatar_preset_id text,
        avatar_url text
      );
      create table public.listings (
        id uuid primary key,
        slug text,
        title text,
        status text,
        location text
      );
      create table public.conversations (
        id uuid primary key,
        listing_id uuid references public.listings(id),
        buyer_id uuid,
        seller_id uuid,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        last_message_at timestamptz,
        last_message_preview text
      );
      create table public.reports (
        id uuid primary key,
        reporter_user_id uuid,
        subject_type text not null,
        subject_id uuid,
        listing_id uuid,
        message_id uuid,
        conversation_id uuid,
        reported_user_id uuid,
        reason text,
        details text,
        status text not null default 'open',
        reviewed_by uuid,
        reviewed_at timestamptz,
        created_at timestamptz not null default now()
      );
      create table public.moderation_audit_events (
        id uuid primary key default gen_random_uuid(),
        event_type text not null,
        actor_user_id uuid,
        actor_user_id_snapshot uuid,
        actor_role text,
        subject_user_id uuid,
        subject_user_id_snapshot uuid,
        sanction_id uuid,
        source_report_id uuid,
        resource_type text,
        resource_id uuid,
        summary text,
        metadata jsonb not null default '{}'::jsonb,
        request_id text,
        occurred_at timestamptz not null default now()
      );
      create table public.user_status (
        user_id uuid primary key,
        is_banned boolean not null default false,
        banned_until timestamptz
      );
      create table public.messages (
        id uuid primary key default gen_random_uuid(),
        conversation_id uuid not null,
        sender_id uuid not null,
        body text,
        created_at timestamptz not null default now(),
        read_at timestamptz
      );
      create table public.message_attachments (
        id uuid primary key default gen_random_uuid(),
        message_id uuid not null,
        conversation_id uuid not null,
        uploader_id uuid,
        storage_path text not null,
        file_name text not null,
        mime_type text not null,
        size_bytes bigint not null,
        created_at timestamptz not null default now()
      );
      create table public.message_reactions (
        message_id uuid not null,
        conversation_id uuid not null,
        user_id uuid not null,
        emoji text not null,
        created_at timestamptz not null default now(),
        removed_at timestamptz
      );
      create table public.notifications (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null,
        type text not null,
        conversation_id uuid,
        message_id uuid,
        listing_id uuid,
        metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      );
      alter table public.notifications enable row level security;
      grant select on public.notifications to authenticated;
      create policy notifications_select_own
        on public.notifications
        for select
        to authenticated
        using (user_id = auth.uid());
    `);

    apply(foundationMigrationUrl);
    apply(notificationMigrationUrl);
    apply(migrationUrl);
    apply(safeParticipantMessageMigrationUrl);

    query(`
      insert into auth.users(id, raw_app_meta_data) values
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{"role":"admin"}'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '{"role":"moderator"}'),
        ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '{"role":"staff"}'),
        ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '{"role":"moderator","roles":["admin"]}'),
        ('11111111-1111-4111-8111-111111111111', '{}'),
        ('22222222-2222-4222-8222-222222222222', '{}'),
        ('33333333-aaaa-4aaa-8aaa-333333333333', '{}');
      insert into public.profiles(id, first_name, last_name, school) values
        ('11111111-1111-4111-8111-111111111111', 'Buyer', 'Student', 'George Brown College'),
        ('22222222-2222-4222-8222-222222222222', 'Seller', 'Student', 'George Brown College');
      insert into public.listings(id, slug, title, status, location) values
        ('44444444-4444-4444-8444-444444444444', 'test-listing', 'Test listing', 'active', 'Toronto');
      insert into public.conversations(
        id, listing_id, buyer_id, seller_id, last_message_at, last_message_preview
      ) values (
        '33333333-3333-4333-8333-333333333333',
        '44444444-4444-4444-8444-444444444444',
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        now(),
        'Latest message preview'
      );
      insert into public.reports(
        id, reporter_user_id, subject_type, subject_id, listing_id,
        conversation_id, reported_user_id, reason, details
      ) values (
        '55555555-5555-4555-8555-555555555555',
        '11111111-1111-4111-8111-111111111111',
        'listing',
        '44444444-4444-4444-8444-444444444444',
        '44444444-4444-4444-8444-444444444444',
        '33333333-3333-4333-8333-333333333333',
        '22222222-2222-4222-8222-222222222222',
        'harassment',
        'Reported conversation evidence.'
      );
      insert into public.messages(
        id, conversation_id, sender_id, body, created_at
      ) values (
        '99999999-9999-4999-8999-999999999999',
        '33333333-3333-4333-8333-333333333333',
        '11111111-1111-4111-8111-111111111111',
        'Message with attachment, reaction, and report evidence.',
        statement_timestamp() + interval '1 hour'
      );
      update public.reports
      set message_id = '99999999-9999-4999-8999-999999999999'
      where id = '55555555-5555-4555-8555-555555555555';
      insert into public.message_attachments(
        message_id, conversation_id, uploader_id, storage_path,
        file_name, mime_type, size_bytes
      ) values (
        '99999999-9999-4999-8999-999999999999',
        '33333333-3333-4333-8333-333333333333',
        '11111111-1111-4111-8111-111111111111',
        'conversation/evidence/photo.jpg',
        'photo.jpg',
        'image/jpeg',
        1024
      );
      insert into public.message_reactions(
        message_id, conversation_id, user_id, emoji
      ) values (
        '99999999-9999-4999-8999-999999999999',
        '33333333-3333-4333-8333-333333333333',
        '22222222-2222-4222-8222-222222222222',
        '👍'
      );
      insert into public.messages(conversation_id, sender_id, body, created_at)
      select
        '33333333-3333-4333-8333-333333333333',
        case when ordinal % 2 = 0
          then '11111111-1111-4111-8111-111111111111'::uuid
          else '22222222-2222-4222-8222-222222222222'::uuid
        end,
        'Message ' || ordinal,
        now() - make_interval(mins => 70 - ordinal)
      from generate_series(1, 59) ordinal;
    `);

    const serviceClaims = (actorId) =>
      `set request.jwt.claims='{"role":"service_role","sub":"${actorId}"}';`;

    assert.equal(
      query(`
        ${serviceClaims("dddddddd-dddd-4ddd-8ddd-dddddddddddd")}
        select conversation_admin_private.resolve_actor_role(
          'dddddddd-dddd-4ddd-8ddd-dddddddddddd','close_chat_temporarily'
        );
      `).trim(),
      "moderator",
    );
    assert.throws(
      () => query(`
        ${serviceClaims("dddddddd-dddd-4ddd-8ddd-dddddddddddd")}
        select conversation_admin_private.resolve_actor_role(
          'dddddddd-dddd-4ddd-8ddd-dddddddddddd','close_chat_permanently'
        );
      `),
      /action_not_permitted/i,
    );
    assert.equal(
      query(`
        set role service_role;
        ${serviceClaims("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")}
        select count(*)
        from public.admin_list_conversations(
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','reported','',1,25
        );
      `).trim(),
      "1",
    );
    const closeResult = query(`
      set role service_role;
      ${serviceClaims("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")}
      select public.admin_moderate_conversation(
        p_actor_id => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        p_conversation_id => '33333333-3333-4333-8333-333333333333',
        p_expected_version => 0,
        p_action => 'close',
        p_reason_code => 'harassment',
        p_user_message => 'This conversation is closed while the report is reviewed.',
        p_duration => '7d',
        p_internal_note => 'Evidence reviewed.',
        p_source_report_id => '55555555-5555-4555-8555-555555555555',
        p_resolve_source_report => true,
        p_operation_id => '66666666-6666-4666-8666-666666666666'
      );
    `);
    assert.match(closeResult, /"recordedStatus": "closed"/);
    assert.match(closeResult, /"resolvedReportCount": 1/);

    const firstCounts = query(`
      select
        (select version from public.conversation_moderation_state),
        (select count(*) from public.conversation_moderation_history),
        (select count(*) from public.moderation_audit_events),
        (select count(*) from public.notifications),
        (select status from public.reports),
        (select count(*) from conversation_admin_private.moderation_commands);
    `).trim();
    assert.equal(firstCounts, "1|1|2|2|resolved|1");
    assert.equal(
      query(`
        set role service_role;
        ${serviceClaims("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")}
        select count(*)
        from public.admin_list_conversations(
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','closed','',1,25
        );
      `).trim(),
      "1",
    );

    const replayResult = query(`
      set role service_role;
      ${serviceClaims("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")}
      select public.admin_moderate_conversation(
        p_actor_id => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        p_conversation_id => '33333333-3333-4333-8333-333333333333',
        p_expected_version => 0,
        p_action => 'close',
        p_reason_code => 'harassment',
        p_user_message => 'This conversation is closed while the report is reviewed.',
        p_duration => '7d',
        p_internal_note => 'Evidence reviewed.',
        p_source_report_id => '55555555-5555-4555-8555-555555555555',
        p_resolve_source_report => true,
        p_operation_id => '66666666-6666-4666-8666-666666666666'
      );
    `);
    assert.match(replayResult, /"idempotentReplay": true/);
    assert.equal(
      query(`select
        (select count(*) from public.conversation_moderation_history),
        (select count(*) from public.moderation_audit_events),
        (select count(*) from public.notifications);`).trim(),
      "1|2|2",
    );

    assert.throws(
      () =>
        query(`
          set role service_role;
          ${serviceClaims("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")}
          select public.admin_moderate_conversation(
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            '33333333-3333-4333-8333-333333333333',0,'close','spam',
            'A different payload must not replay.','7d',null,null,false,
            '66666666-6666-4666-8666-666666666666'
          );
        `),
      /operation_payload_conflict/i,
    );

    assert.throws(
      () =>
        query(`
          set role service_role;
          ${serviceClaims("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")}
          select public.admin_moderate_conversation(
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            '33333333-3333-4333-8333-333333333333',1,'close','spam',
            'Moderators cannot close this permanently.','permanent',null,null,false,
            '77777777-7777-4777-8777-777777777777'
          );
        `),
      /action_not_permitted/i,
    );

    query(`
      set role service_role;
      ${serviceClaims("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")}
      select public.admin_moderate_conversation(
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        '33333333-3333-4333-8333-333333333333',1,'reopen','other',
        'The conversation may resume after moderator review.','',null,null,false,
        '88888888-8888-4888-8888-888888888888'
      );
    `);
    assert.equal(
      query("select version || '|' || status from public.conversation_moderation_state;").trim(),
      "2|open",
    );
    assert.equal(query("select count(*) from public.notifications;").trim(), "4");
    assert.equal(
      query(`
        set role authenticated;
        set request.jwt.claims='{"role":"authenticated","sub":"11111111-1111-4111-8111-111111111111"}';
        select metadata ->> 'user_message'
        from public.notifications
        where type = 'conversation_reopened';
      `).trim(),
      "The conversation may resume after moderator review.",
    );
    assert.equal(
      query(`
        set role authenticated;
        set request.jwt.claims='{"role":"authenticated","sub":"22222222-2222-4222-8222-222222222222"}';
        select metadata ->> 'user_message'
        from public.notifications
        where type = 'conversation_reopened';
      `).trim(),
      "The conversation may resume after moderator review.",
    );
    assert.equal(
      query(`
        set role authenticated;
        set request.jwt.claims='{"role":"authenticated","sub":"33333333-aaaa-4aaa-8aaa-333333333333"}';
        select count(*)
        from public.notifications
        where type = 'conversation_reopened';
      `).trim(),
      "0",
    );

    const registry = query(`
      set role service_role;
      ${serviceClaims("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")}
      select conversation_id || '|' || total_count
      from public.admin_list_conversations(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','reopened','Buyer',1,25
      );
    `).trim();
    assert.equal(registry, "33333333-3333-4333-8333-333333333333|1");

    assert.equal(
      query(`
        set role service_role;
        ${serviceClaims("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")}
        select count(*) from public.admin_get_conversation_message_page(
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          '33333333-3333-4333-8333-333333333333',null,null,1000
        );
      `).trim(),
      "51",
    );
    assert.match(
      query(`
        set role service_role;
        ${serviceClaims("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")}
        select attachments::text || '|' || reactions::text || '|' || report_count
        from public.admin_get_conversation_message_page(
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          '33333333-3333-4333-8333-333333333333',null,null,51
        )
        where id = '99999999-9999-4999-8999-999999999999';
      `).trim(),
      /conversation\/evidence\/photo\.jpg[\s\S]*👍[\s\S]*\|1/,
    );

    const permanentCloseResult = query(`
      set role service_role;
      ${serviceClaims("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")}
      select public.admin_moderate_conversation(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '33333333-3333-4333-8333-333333333333',2,'close','prohibited',
        'An administrator closed this conversation permanently.','permanent',null,null,false,
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
      );
    `);
    assert.match(permanentCloseResult, /"effectiveStatus": "closed"/);
    assert.match(permanentCloseResult, /"closedUntil": null/);

    query(`
      insert into public.conversations(id, listing_id, buyer_id, seller_id, updated_at)
      select
        gen_random_uuid(),
        '44444444-4444-4444-8444-444444444444',
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        statement_timestamp() + make_interval(secs => ordinal)
      from generate_series(1, 2005) ordinal;
    `);
    assert.equal(
      query(`
        set role service_role;
        ${serviceClaims("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")}
        select total_count || '|' || registry_truncated
        from public.admin_list_conversations(
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','all','',1,1
        );
      `).trim(),
      "2000|true",
    );

    assert.throws(
      () =>
        query(`
          set role service_role;
          ${serviceClaims("cccccccc-cccc-4ccc-8ccc-cccccccccccc")}
          select count(*) from public.admin_list_conversations(
            'cccccccc-cccc-4ccc-8ccc-cccccccccccc','all','',1,25
          );
        `),
      /action_not_permitted/i,
    );
    assert.throws(
      () =>
        query(`
          set role service_role;
          ${serviceClaims("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")}
          select conversation_admin_private.get_conversation_detail_impl(
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            '33333333-3333-4333-8333-333333333333'
          );
        `),
      /permission denied for schema conversation_admin_private/i,
    );
  } finally {
    if (started) {
      spawnSync(pgCtl, ["-D", dataDirectory, "-m", "fast", "stop"], {
        encoding: "utf8",
      });
    }
    await rm(cluster, { recursive: true, force: true });
  }
});
