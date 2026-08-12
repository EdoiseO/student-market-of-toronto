import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  addMessageReaction,
  applyMessageReactionChange,
  countAdditionalMessageReactions,
  groupMessageReactions,
  removeMessageReaction,
  replaceMessageReactions,
  subscribeToMessageReactionUpdates,
} from "../src/lib/message-reactions.mjs";

const migrationUrl = new URL(
  "../supabase/migrations/20260812212037_add_message_reactions.sql",
  import.meta.url,
);
const hardeningMigrationUrl = new URL(
  "../supabase/migrations/20260812212850_tighten_message_reactions.sql",
  import.meta.url,
);
const updatePolicyMigrationUrl = new URL(
  "../supabase/migrations/20260812213549_consolidate_message_reaction_update_policy.sql",
  import.meta.url,
);

function createRealtimeDouble() {
  const channels = [];
  const removedChannels = [];

  return {
    channels,
    removedChannels,
    channel(topic) {
      const channel = {
        topic,
        bindings: [],
        subscribed: false,
        on(type, filter, callback) {
          assert.equal(this.subscribed, false, "callbacks must be registered before subscribe");
          this.bindings.push({ type, filter, callback });
          return this;
        },
        subscribe() {
          this.subscribed = true;
          return this;
        },
      };
      channels.push(channel);
      return channel;
    },
    async removeChannel(channel) {
      removedChannels.push(channel);
      return "ok";
    },
  };
}

test("reaction reducers remain idempotent across optimistic and realtime updates", () => {
  const messages = [{ id: "message-1", body: "Hello", reactions: [] }];
  const reaction = { message_id: "message-1", user_id: "user-1", emoji: "👍" };
  const once = addMessageReaction(messages, reaction);
  const twice = addMessageReaction(once, reaction);

  assert.equal(twice[0].reactions.length, 1);
  assert.equal(removeMessageReaction(twice, reaction)[0].reactions.length, 0);
  assert.equal(
    applyMessageReactionChange(twice, { ...reaction, removed_at: new Date().toISOString() })[0]
      .reactions.length,
    0,
  );
});

test("reaction groups aggregate counts and current-user state in palette order", () => {
  const groups = groupMessageReactions(
    [
      { message_id: "message-1", user_id: "user-2", emoji: "❤️" },
      { message_id: "message-1", user_id: "user-1", emoji: "👍" },
      { message_id: "message-1", user_id: "user-3", emoji: "👍" },
    ],
    "user-1",
  );

  assert.deepEqual(groups, [
    { emoji: "👍", count: 2, reactedByCurrentUser: true },
    { emoji: "❤️", count: 1, reactedByCurrentUser: false },
  ]);
});

test("reaction summaries count additional people beyond each displayed emoji", () => {
  assert.equal(
    countAdditionalMessageReactions([
      { emoji: "👍", count: 3 },
      { emoji: "❤️", count: 1 },
      { emoji: "😂", count: 2 },
    ]),
    3,
  );
});

test("replacing reactions preserves message content and attachments", () => {
  const messages = [{ id: "message-1", body: "Hello", attachments: [{ id: "file-1" }] }];
  const nextMessages = replaceMessageReactions(messages, [
    { message_id: "message-1", user_id: "user-1", emoji: "🎉" },
  ]);

  assert.equal(nextMessages[0].body, "Hello");
  assert.equal(nextMessages[0].attachments[0].id, "file-1");
  assert.equal(nextMessages[0].reactions[0].emoji, "🎉");
});

test("realtime listeners use unique topics and subscribe only after both callbacks", async () => {
  const supabase = createRealtimeDouble();
  const options = {
    supabase,
    conversationId: "conversation-1",
    onInsert() {},
    onUpdate() {},
  };

  const removeFirst = subscribeToMessageReactionUpdates(options);
  const removeSecond = subscribeToMessageReactionUpdates(options);

  assert.equal(supabase.channels.length, 2);
  assert.notEqual(supabase.channels[0].topic, supabase.channels[1].topic);
  assert.ok(supabase.channels.every((channel) => channel.subscribed));
  assert.deepEqual(
    supabase.channels.map((channel) =>
      channel.bindings.map((binding) => [binding.filter.event, binding.filter.table]),
    ),
    [
      [["INSERT", "message_reactions"], ["UPDATE", "message_reactions"]],
      [["INSERT", "message_reactions"], ["UPDATE", "message_reactions"]],
    ],
  );

  removeFirst();
  removeFirst();
  removeSecond();
  await Promise.resolve();
  assert.equal(supabase.removedChannels.length, 2);
});

test("reaction migration keeps writes participant-bound and publishes realtime changes", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const hardeningSql = await readFile(hardeningMigrationUrl, "utf8");
  const updatePolicySql = await readFile(updatePolicyMigrationUrl, "utf8");

  assert.match(sql, /alter table public\.message_reactions enable row level security/i);
  assert.match(sql, /user_id = \(select auth\.uid\(\)\)/i);
  assert.match(sql, /message\.conversation_id = message_reactions\.conversation_id/i);
  assert.match(sql, /listing\.status = 'active'/i);
  assert.match(sql, /from public\.blocked_users blocked/i);
  assert.match(sql, /grant select, insert on table public\.message_reactions to authenticated/i);
  assert.match(sql, /grant update \(removed_at\) on table public\.message_reactions to authenticated/i);
  assert.match(sql, /alter publication supabase_realtime add table public\.message_reactions/i);
  assert.doesNotMatch(sql, /grant\s+delete[^;]*authenticated/i);
  assert.match(hardeningSql, /and removed_at is null/i);
  assert.match(
    hardeningSql,
    /grant insert \(message_id, conversation_id, user_id, emoji\)[\s\S]*to authenticated/i,
  );
  assert.equal((updatePolicySql.match(/for update/gi) ?? []).length, 1);
  assert.match(updatePolicySql, /removed_at is not null[\s\S]*listing\.status = 'active'/i);
});
