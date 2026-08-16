import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  getConversationClosureExpiryDelay,
  isConversationClosedWriteError,
  isConversationEffectivelyClosed,
  normalizeConversationModerationState,
} from "../src/lib/conversation-moderation.mjs";

const migrationUrl = new URL(
  "../supabase/migrations/20260816165529_conversation_moderation_participant_notifications.sql",
  import.meta.url,
);
const notificationLifecycleMigrationUrl = new URL(
  "../supabase/migrations/20260816165454_enforcement_notification_lifecycle.sql",
  import.meta.url,
);
const inboxPageUrl = new URL("../src/app/messages/page.jsx", import.meta.url);
const threadPageUrl = new URL("../src/app/messages/[conversationId]/page.jsx", import.meta.url);
const threadUrl = new URL("../src/components/messages-thread.jsx", import.meta.url);
const listUrl = new URL("../src/components/conversation-list.jsx", import.meta.url);
const listItemUrl = new URL("../src/components/conversation-list-item.jsx", import.meta.url);
const reactionsUrl = new URL("../src/components/message-reactions.jsx", import.meta.url);
const listSkeletonUrl = new URL(
  "../src/components/skeletons/message-list-skeleton.jsx",
  import.meta.url,
);
const threadSkeletonUrl = new URL(
  "../src/components/skeletons/message-thread-skeleton.jsx",
  import.meta.url,
);

test("effective closure helpers treat indefinite, temporary, expired, and reopened state correctly", () => {
  const now = Date.parse("2026-08-16T12:00:00.000Z");
  const indefinite = normalizeConversationModerationState({
    conversation_id: "11111111-1111-4111-8111-111111111111",
    version: 1,
    recorded_status: "closed",
    effective_status: "closed",
    closed_until: null,
    user_message: "  Safety review in progress.  ",
  });
  const temporary = {
    ...indefinite,
    closedUntil: "2026-08-16T12:30:00.000Z",
  };

  assert.equal(indefinite.userMessage, "Safety review in progress.");
  assert.equal(isConversationEffectivelyClosed(indefinite, now), true);
  assert.equal(getConversationClosureExpiryDelay(indefinite, now), null);
  assert.equal(isConversationEffectivelyClosed(temporary, now), true);
  assert.equal(getConversationClosureExpiryDelay(temporary, now), 30 * 60 * 1000);
  assert.equal(isConversationEffectivelyClosed(temporary, Date.parse(temporary.closedUntil)), false);
  assert.equal(getConversationClosureExpiryDelay(temporary, Date.parse(temporary.closedUntil)), 0);
  assert.equal(
    isConversationEffectivelyClosed({ ...indefinite, recordedStatus: "open" }, now),
    false,
  );
});

test("closed-write errors remain recognizable without inspecting realtime signal content", () => {
  assert.equal(
    isConversationClosedWriteError({ message: "conversation_write_closed" }),
    true,
  );
});

test("loaded inbox and thread use the participant-safe view and notification refetch path", async () => {
  const [inboxPage, threadPage, thread, list] = await Promise.all([
    readFile(inboxPageUrl, "utf8"),
    readFile(threadPageUrl, "utf8"),
    readFile(threadUrl, "utf8"),
    readFile(listUrl, "utf8"),
  ]);

  assert.match(inboxPage, /from\("conversation_effective_moderation_state"\)/);
  assert.match(threadPage, /from\("conversation_effective_moderation_state"\)/);
  assert.match(threadPage, /initialModerationState=/);
  assert.match(thread, /subscribeToNotificationUpdates\(\{/);
  assert.match(thread, /onChange:\s*\(\) => refreshConversationModerationState\(\)/);
  assert.match(list, /subscribeToNotificationUpdates\(\{/);
  assert.match(list, /onChange:\s*\(\) => router\.refresh\(\)/);
  assert.doesNotMatch(thread + list, /payload\.(?:new|old)/);
  assert.doesNotMatch(thread + list, /table:\s*["']conversation_moderation_(?:state|history)/);
});

test("closed UI preserves history/media while replacing writes across responsive surfaces", async () => {
  const [thread, listItem, reactions, listSkeleton, threadSkeleton] = await Promise.all([
    readFile(threadUrl, "utf8"),
    readFile(listItemUrl, "utf8"),
    readFile(reactionsUrl, "utf8"),
    readFile(listSkeletonUrl, "utf8"),
    readFile(threadSkeletonUrl, "utf8"),
  ]);

  assert.match(listItem, /conversationClosedBadge/);
  assert.match(listItem, /LockKeyhole/);
  assert.match(thread, /conversationClosedTitle/);
  assert.match(thread, /conversationClosedReasonLabel/);
  assert.match(thread, /conversationClosedUntilLabel/);
  assert.match(thread, /mailto:support@studentmarketoftoronto\.ca/);
  assert.match(thread, /isConversationClosed \? \([\s\S]*conversationClosedComposerLabel[\s\S]*\) : \(\s*<form/);
  assert.match(thread, /<MessageMediaGallery attachments=\{message\.attachments\}/);
  assert.match(thread, /handleLoadOlderMessages/);
  assert.match(thread, /isInteractionDisabled=\{isConversationClosed\}/);
  assert.match(reactions, /!isInteractionDisabled/);
  assert.match(thread, /overflow-x-hidden/);
  assert.match(thread, /max-w-4xl min-w-0/);
  assert.match(listSkeleton, /showStatus/);
  assert.match(threadSkeleton, /border-amber-200/);
});

test("conversation transition notification trigger emits safe recipient-only signals", async () => {
  const [sql, lifecycleSql] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(notificationLifecycleMigrationUrl, "utf8"),
  ]);

  assert.ok(
    notificationLifecycleMigrationUrl.pathname < migrationUrl.pathname,
    "notification types must be installed before the conversation trigger",
  );
  assert.match(lifecycleSql, /'conversation_closed',[\s\S]*'conversation_reopened'/i);
  assert.match(sql, /after insert on public\.conversation_moderation_history/i);
  assert.match(sql, /security definer[\s\S]*set search_path = ''/i);
  assert.match(sql, /values \(conversation\.buyer_id\), \(conversation\.seller_id\)/i);
  assert.match(sql, /recipient\.user_id is not null/i);
  assert.match(sql, /when new\.action = 'close' then 'conversation_closed'/i);
  assert.match(sql, /else 'conversation_reopened'/i);
  assert.match(sql, /'state_version', new\.state_version/i);
  assert.match(sql, /'closed_until', new\.new_closed_until/i);
  assert.doesNotMatch(sql, /new\.(actor_id|moderation_audit_event_id|user_message|reason_code)/i);
  assert.doesNotMatch(sql, /alter publication|grant select|grant insert|grant update|grant delete/i);
  assert.match(
    sql,
    /revoke all on function private\.emit_conversation_moderation_notification\(\)[\s\S]*authenticated, service_role/i,
  );
});

const postgresBin = [
  process.env.POSTGRES_BIN,
  "/opt/homebrew/opt/postgresql@16/bin",
  "/usr/local/opt/postgresql@16/bin",
]
  .filter(Boolean)
  .find((candidate) => existsSync(join(candidate, "postgres")));

test(
  "conversation notification trigger emits one safe signal per distinct surviving participant",
  { skip: !postgresBin },
  async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const cluster = await mkdtemp(join(tmpdir(), "smot-conversation-ux-"));
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
    const query = (statement) =>
      command("psql", [
        "-X",
        "-qAt",
        "-h",
        cluster,
        "-p",
        String(port),
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        statement,
      ]);

    try {
      command("initdb", ["-D", data, "-A", "trust", "--no-locale"]);
      command(
        "pg_ctl",
        [
          "-D",
          data,
          "-o",
          `-p ${port} -k ${cluster} -c listen_addresses=''`,
          "-w",
          "start",
        ],
        { stdio: "ignore" },
      );
      started = true;

      query(`
        create extension if not exists pgcrypto;
        create role postgres superuser nologin;
        create role anon nologin;
        create role authenticated nologin;
        create role service_role nologin;
        create table public.conversations (
          id uuid primary key,
          buyer_id uuid,
          seller_id uuid
        );
        create table public.conversation_moderation_history (
          id uuid primary key default gen_random_uuid(),
          conversation_id uuid not null,
          state_version bigint not null,
          action text not null check (action in ('close', 'reopen')),
          new_closed_until timestamptz,
          created_at timestamptz not null default now()
        );
        create table public.notifications (
          id uuid primary key default gen_random_uuid(),
          user_id uuid not null,
          type text not null check (type in ('conversation_closed', 'conversation_reopened')),
          conversation_id uuid,
          message_id uuid,
          listing_id uuid,
          metadata jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now()
        );
      `);
      query(migration);

      query(`
        insert into public.conversations(id, buyer_id, seller_id) values
          ('11111111-1111-4111-8111-111111111111',
           '22222222-2222-4222-8222-222222222222',
           '33333333-3333-4333-8333-333333333333'),
          ('44444444-4444-4444-8444-444444444444',
           '22222222-2222-4222-8222-222222222222',
           '22222222-2222-4222-8222-222222222222'),
          ('55555555-5555-4555-8555-555555555555',
           '33333333-3333-4333-8333-333333333333', null);
        insert into public.conversation_moderation_history(
          conversation_id, state_version, action, new_closed_until
        ) values
          ('11111111-1111-4111-8111-111111111111', 1, 'close', now() + interval '1 day'),
          ('11111111-1111-4111-8111-111111111111', 2, 'reopen', null),
          ('44444444-4444-4444-8444-444444444444', 1, 'close', null),
          ('55555555-5555-4555-8555-555555555555', 1, 'close', null);
      `);

      assert.equal(query("select count(*) from public.notifications;"), "6");
      assert.equal(
        query("select count(*) from public.notifications where type='conversation_closed';"),
        "4",
      );
      assert.equal(
        query("select count(*) from public.notifications where type='conversation_reopened';"),
        "2",
      );
      assert.equal(
        query(`
          select bool_and(
            metadata ? 'action'
            and metadata ? 'state_version'
            and not metadata ? 'actor_id'
            and not metadata ? 'moderation_audit_event_id'
            and not metadata ? 'user_message'
            and not metadata ? 'reason_code'
          ) from public.notifications;
        `),
        "t",
      );
      assert.equal(
        query(`
          select has_function_privilege(
            'authenticated',
            'private.emit_conversation_moderation_notification()',
            'execute'
          );
        `),
        "f",
      );
    } finally {
      if (started) {
        spawnSync(join(postgresBin, "pg_ctl"), ["-D", data, "-m", "fast", "stop"]);
      }
      await rm(cluster, { recursive: true, force: true });
    }
  },
);
