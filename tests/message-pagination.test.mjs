import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CONVERSATION_INBOX_LIMIT,
  keepNewestMessageWindow,
  mergeOlderMessageWindow,
  MESSAGE_CLIENT_WINDOW_LIMIT,
  MESSAGE_PAGE_REQUEST_LIMIT,
  MESSAGE_PAGE_SIZE,
  normalizeMessagePageRows,
} from "../src/lib/message-pagination.mjs";

const migrationUrl = new URL(
  "../supabase/migrations/20260812233357_bound_message_history_and_guard_media_deletes.sql",
  import.meta.url,
);
const inboxPageUrl = new URL("../src/app/messages/page.jsx", import.meta.url);
const threadPageUrl = new URL("../src/app/messages/[conversationId]/page.jsx", import.meta.url);
const threadComponentUrl = new URL("../src/components/messages-thread.jsx", import.meta.url);

function message(index) {
  return {
    id: String(index).padStart(4, "0"),
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
  };
}

test("newest-first database pages expose one bounded page in chronological UI order", () => {
  const newestFirstRows = Array.from(
    { length: MESSAGE_PAGE_REQUEST_LIMIT },
    (_, index) => message(MESSAGE_PAGE_REQUEST_LIMIT - index),
  );
  const page = normalizeMessagePageRows(newestFirstRows);

  assert.equal(page.messages.length, MESSAGE_PAGE_SIZE);
  assert.equal(page.hasOlderMessages, true);
  assert.equal(page.messages[0].id, "0002");
  assert.equal(page.messages.at(-1).id, "0041");
});

test("older-history navigation slides a bounded window and records when newer rows were dropped", () => {
  const currentMessages = Array.from(
    { length: MESSAGE_CLIENT_WINDOW_LIMIT },
    (_, index) => message(index + 1000),
  );
  const olderMessages = Array.from({ length: MESSAGE_PAGE_SIZE }, (_, index) => message(index + 900));
  const result = mergeOlderMessageWindow(currentMessages, olderMessages);

  assert.equal(result.messages.length, MESSAGE_CLIENT_WINDOW_LIMIT);
  assert.equal(result.droppedNewerMessages, true);
  assert.equal(result.messages[0].id, "0900");
  assert.equal(result.messages.at(-1).id, "1119");
});

test("realtime additions retain only the newest bounded client window", () => {
  const messages = Array.from(
    { length: MESSAGE_CLIENT_WINDOW_LIMIT + 20 },
    (_, index) => message(index),
  );
  const boundedMessages = keepNewestMessageWindow(messages);

  assert.equal(boundedMessages.length, MESSAGE_CLIENT_WINDOW_LIMIT);
  assert.equal(boundedMessages[0].id, "0020");
  assert.equal(boundedMessages.at(-1).id, "0179");
});

test("message read paths are bounded and related rows are scoped to page message IDs", async () => {
  const [migration, inboxPage, threadPage, threadComponent] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(inboxPageUrl, "utf8"),
    readFile(threadPageUrl, "utf8"),
    readFile(threadComponentUrl, "utf8"),
  ]);

  assert.equal(CONVERSATION_INBOX_LIMIT, 100);
  assert.match(inboxPage, /rpc\(\s*"get_message_inbox_conversation_ids"/);
  assert.match(inboxPage, /p_limit: CONVERSATION_INBOX_LIMIT \+ 1/);
  assert.match(inboxPage, /hasOlderConversations/);
  assert.match(inboxPage, /beforeId: oldestConversationCursor\.conversation_id/);
  assert.match(
    inboxPage,
    /boundedConversationIds\.length[\s\S]*?\.in\("conversation_id", boundedConversationIds\)[\s\S]*?: \{ data: \[\], error: null \}/,
  );
  assert.match(inboxPage, /rpc\("get_conversation_unread_counts"/);
  assert.doesNotMatch(inboxPage, /\.from\("messages"\)[\s\S]*\.is\("read_at", null\)/);
  assert.match(threadPage, /rpc\("get_conversation_message_page"/);
  assert.match(threadPage, /\.in\("message_id", visibleMessageIds\)/);
  assert.match(threadComponent, /\.in\("message_id", messageIds\)/);
  assert.match(threadComponent, /handleLoadOlderMessages/);
  assert.match(migration, /coalesce\(array_ndims\(requested_ids\), 0\) > 1/i);
  assert.match(migration, /cardinality\(requested_ids\) > 100/i);
  assert.doesNotMatch(migration, /array_length\(requested_ids, 1\)/i);
  assert.match(migration, /create or replace function public\.get_message_inbox_conversation_ids/i);
  assert.match(migration, /conversations_buyer_updated_id_idx/i);
  assert.match(migration, /conversations_seller_updated_id_idx/i);
  assert.match(migration, /\(conversation\.updated_at, conversation\.id\) < \(/i);
  assert.match(migration, /state\.hidden_at is null[\s\S]*conversation\.last_message_at > state\.hidden_at/i);
  assert.match(migration, /order by message\.created_at desc, message\.id desc[\s\S]*limit page_limit/i);
  assert.match(migration, /conversation\.buyer_id = current_user_id[\s\S]*conversation\.seller_id = current_user_id/i);
});
