import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createNotificationFeed } from "../src/lib/notification-feed.mjs";
import { isEnforcementNotificationType, isMessageNotificationType, MESSAGE_NOTIFICATION_ROW_TYPES } from "../src/lib/notifications.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function createClientDouble(rows = []) {
  const calls = [];
  const channels = new Set();
  const authCallbacks = new Set();
  const client = {
    rows,
    preferences: [],
    calls,
    channels,
    authCallbacks,
    intercept: null,
    auth: {
      onAuthStateChange(callback) {
        authCallbacks.add(callback);
        return { data: { subscription: { unsubscribe: () => authCallbacks.delete(callback) } } };
      },
    },
    changeAccount(userId) {
      [...authCallbacks].forEach((callback) => callback(
        userId ? "SIGNED_IN" : "SIGNED_OUT", userId ? { user: { id: userId } } : null,
      ));
    },
    channel() {
      const channel = {
        on() { return this; },
        subscribe() { channels.add(this); return this; },
      };
      return channel;
    },
    removeChannel(channel) { channels.delete(channel); return Promise.resolve(); },
    from(table) {
      const query = {
        table,
        filters: [],
        select(columns, options) { this.columns = columns; this.options = options; return this; },
        update(values) { this.updatedValues = values; return this; },
        delete() { this.deleted = true; return this; },
        eq(column, value) { this.filters.push((row) => row[column] === value); return this; },
        not(column, _operator, value) { this.filters.push((row) => row[column] !== value); return this; },
        in(column, values) { this.filters.push((row) => values.includes(row[column])); return this; },
        is(column, value) { return this.eq(column, value); },
        order() { return this; },
        limit(value) { this.rowLimit = value; return this; },
        then(resolve, reject) {
          calls.push(this);
          const filtered = (table === "notification_preferences" ? client.preferences : client.rows)
            .filter((row) => this.filters.every((filter) => filter(row)));
          if (this.updatedValues) filtered.forEach((entry) => Object.assign(entry, this.updatedValues));
          if (this.deleted) client.rows = client.rows.filter((entry) => !filtered.includes(entry));
          const result = this.options?.head
            ? { count: filtered.length, error: null }
            : { data: filtered.slice(0, this.rowLimit).map((entry) => ({ ...entry })), error: null };
          return Promise.resolve(client.intercept?.(this, result) ?? result).then(resolve, reject);
        },
      };
      return query;
    },
  };
  return client;
}

function row(id, type = "messages", userId = "user-a", extra = {}) {
  return { id, type, user_id: userId, read_at: null, dismissed_at: null, ...extra };
}

test("shared badges count the full matching set while the joined preview stays lazy and bounded", async () => {
  const client = createClientDouble([
    ...Array.from({ length: 30 }, (_, i) => row(i)),
    row(31, "moderation_warning"),
    row(32, "messages", "user-b"),
    row(33, "messages", "user-a", { read_at: "2026-09-08" }),
    row(34, "moderation_warning", "user-a", { dismissed_at: "2026-09-08" }),
  ]);
  const feed = createNotificationFeed({ supabase: client, userId: "user-a" });
  const stop = feed.start();
  try {
    await feed.refresh();
    assert.equal(client.calls.length, 3);
    assert.equal(client.channels.size, 1);
    assert.equal(feed.getSnapshot().unreadCount, 31);
    assert.equal(feed.getSnapshot().hasUnreadMessages, true);
    assert.equal(feed.getSnapshot().previewLoaded, false);
    assert.equal(client.calls.some((query) => query.rowLimit), false);

    const close = feed.retainPreview();
    await feed.refresh();
    assert.equal(feed.getSnapshot().rows.length, 24);
    assert.equal(feed.getSnapshot().unreadCount, 31);
    close();
    const callsBeforeRefresh = client.calls.length;
    await feed.refresh();
    assert.equal(client.calls.length - callsBeforeRefresh, 3);
    assert.equal(client.calls.slice(callsBeforeRefresh).some((query) => query.rowLimit), false);
  } finally { stop(); }
});

test("disabled message preferences do not suppress always-on notices or reuse the total badge as the sidebar badge", async () => {
  const client = createClientDouble([row(1), row(2, "moderation_warning"), row(3, "announcement")]);
  client.preferences = [{ user_id: "user-a", notification_type: "messages", in_app_enabled: false }];
  const feed = createNotificationFeed({ supabase: client, userId: "user-a" });
  const stop = feed.start();
  try {
    await feed.refresh();
    assert.equal(feed.getSnapshot().unreadCount, 2);
    assert.equal(feed.getSnapshot().hasUnreadMessages, false);
    assert.equal(client.calls.length, 2);
  } finally { stop(); }
});

test("concurrent refreshes share a request and updates during it produce one trailing refresh", async () => {
  const client = createClientDouble([row(1)]);
  const gate = deferred();
  const countStarted = deferred();
  let held = false;
  client.intercept = (query, result) => {
    if (query.options?.head && !held) {
      held = true;
      countStarted.resolve();
      return gate.promise.then(() => result);
    }
  };
  const feed = createNotificationFeed({ supabase: client, userId: "user-a" });
  const stop = feed.start();
  try {
    const first = feed.refresh();
    assert.equal(first, feed.refresh());
    await countStarted.promise;
    client.rows.push(row(2, "moderation_warning"));
    for (let i = 0; i < 10; i += 1) feed.invalidate();
    gate.resolve();
    await first;
    assert.equal(client.calls.filter((query) => query.table === "notification_preferences").length, 2);
    assert.equal(feed.getSnapshot().unreadCount, 2);
  } finally { stop(); }
});

test("idle update bursts are coalesced and account cleanup cancels a queued refresh", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const client = createClientDouble([row(1)]);
  const feed = createNotificationFeed({ supabase: client, userId: "user-a" });
  const stop = feed.start();
  await feed.refresh();
  for (let i = 0; i < 10; i += 1) feed.invalidate();
  t.mock.timers.tick(49);
  assert.equal(client.calls.length, 3);
  t.mock.timers.tick(1);
  await feed.refresh();
  assert.equal(client.calls.length, 6);
  feed.invalidate();
  stop();
  t.mock.timers.tick(100);
  assert.equal(client.calls.length, 6);
});

test("an invalidation between data publication and request cleanup still refreshes", async () => {
  const client = createClientDouble([row(1)]);
  const feed = createNotificationFeed({ supabase: client, userId: "user-a" });
  let queued = false;
  const unsubscribe = feed.subscribe(() => {
    if (!queued && feed.getSnapshot().unreadCount === 1) {
      queued = true;
      queueMicrotask(() => {
        client.rows.push(row(2));
        feed.invalidate();
      });
    }
  });
  const stop = feed.start();
  try {
    await feed.refresh();
    assert.equal(feed.getSnapshot().unreadCount, 2);
    assert.equal(client.calls.filter((query) => query.table === "notification_preferences").length, 2);
  } finally { unsubscribe(); stop(); }
});

test("background refresh keeps the loaded preview visible and cannot restore a dismissed notification", async () => {
  const client = createClientDouble([row(1)]);
  const feed = createNotificationFeed({ supabase: client, userId: "user-a" });
  const stop = feed.start();
  const close = feed.retainPreview();
  await feed.refresh();
  const gate = deferred();
  const started = deferred();
  let held = false;
  client.intercept = (query, result) => {
    if (query.rowLimit && !held) {
      held = true;
      started.resolve();
      return gate.promise.then(() => result);
    }
  };
  const request = feed.refresh();
  await started.promise;
  assert.equal(feed.getSnapshot().isLoading, false);
  assert.deepEqual(feed.getSnapshot().rows.map((entry) => entry.id), [1]);

  client.rows = [];
  await feed.removeNotification({ id: 1, type: "messages" }, { data: [row(1)], error: null });
  assert.deepEqual(feed.getSnapshot().rows, []);
  const subsequentRows = [];
  const unsubscribe = feed.subscribe(() => subsequentRows.push(feed.getSnapshot().rows));
  try {
    gate.resolve();
    await request;
    assert.ok(subsequentRows.every((rows) => rows.length === 0));
    assert.equal(feed.getSnapshot().unreadCount, 0);
    assert.equal(feed.getSnapshot().hasUnreadMessages, false);
  } finally { unsubscribe(); close(); stop(); }
});

test("successful mark-all-read clears visible data and both badges immediately", async () => {
  const client = createClientDouble([row(1), row(2, "moderation_warning")]);
  const feed = createNotificationFeed({ supabase: client, userId: "user-a" });
  const stop = feed.start();
  const close = feed.retainPreview();
  try {
    await feed.refresh();
    assert.equal(feed.getSnapshot().unreadCount, 2);
    client.rows = client.rows.map((entry) => ({ ...entry, read_at: "2026-09-08" }));
    await feed.markAllRead({ error: null });
    assert.deepEqual(feed.getSnapshot().rows, []);
    assert.equal(feed.getSnapshot().unreadCount, 0);
    assert.equal(feed.getSnapshot().hasUnreadMessages, false);
    await feed.refresh();
    assert.equal(feed.getSnapshot().unreadCount, 0);
  } finally { close(); stop(); }
});

test("sign-out clears private preview state and late responses cannot repopulate it or a new account", async () => {
  const client = createClientDouble([row(1), row(2, "messages", "user-b")]);
  const feed = createNotificationFeed({ supabase: client, userId: "user-a" });
  const stop = feed.start();
  const close = feed.retainPreview();
  await feed.refresh();
  assert.deepEqual(feed.getSnapshot().rows.map((entry) => entry.id), [1]);

  const gate = deferred();
  const started = deferred();
  client.intercept = (query, result) => {
    if (query.rowLimit) {
      started.resolve();
      return gate.promise.then(() => result);
    }
  };
  const oldRequest = feed.refresh();
  await started.promise;
  client.changeAccount(null);
  assert.equal(client.channels.size, 0);
  assert.equal(client.authCallbacks.size, 0);
  assert.deepEqual(feed.getSnapshot().rows, []);
  assert.equal(feed.getSnapshot().unreadCount, 0);

  client.intercept = null;
  const nextFeed = createNotificationFeed({ supabase: client, userId: "user-b" });
  const stopNext = nextFeed.start();
  const closeNext = nextFeed.retainPreview();
  try {
    await nextFeed.refresh();
    gate.resolve();
    await oldRequest;
    assert.deepEqual(feed.getSnapshot().rows, []);
    assert.deepEqual(nextFeed.getSnapshot().rows.map((entry) => entry.id), [2]);
  } finally { close(); stop(); closeNext(); stopNext(); }
});

test("account change during preferences stops follow-up reads and disposes the old subscription", async () => {
  const gate = deferred();
  const client = createClientDouble([row(1)]);
  client.intercept = (_query, result) => gate.promise.then(() => result);
  const feed = createNotificationFeed({ supabase: client, userId: "user-a" });
  const stop = feed.start();
  const request = feed.refresh();
  await Promise.resolve();
  client.changeAccount("user-b");
  gate.resolve();
  await request;
  assert.equal(client.calls.length, 1);
  assert.equal(client.channels.size, 0);
  assert.equal(feed.getSnapshot().unreadCount, 0);
  stop();
});

test("a failed refresh retains verified counts and exposes preview failure for retry", async () => {
  const client = createClientDouble([row(1)]);
  const errors = [];
  const feed = createNotificationFeed({ supabase: client, userId: "user-a", onError: (...args) => errors.push(args) });
  const stop = feed.start();
  await feed.refresh();
  client.intercept = (query) => query.table === "notifications" ? { error: { message: "unavailable" } } : undefined;
  const close = feed.retainPreview();
  try {
    await feed.refresh();
    assert.equal(feed.getSnapshot().unreadCount, 1);
    assert.equal(feed.getSnapshot().hasUnreadMessages, true);
    assert.equal(feed.getSnapshot().previewError, true);
    assert.equal(feed.getSnapshot().isLoading, false);
    assert.equal(errors.length, 3);
    client.intercept = null;
    await feed.refresh();
    assert.equal(feed.getSnapshot().previewError, false);
    assert.deepEqual(feed.getSnapshot().rows.map((entry) => entry.id), [1]);
  } finally { close(); stop(); }
});


test("confirmed removal updates both badges even when every subsequent count request fails", async () => {
  const client = createClientDouble([row(1)]);
  const feed = createNotificationFeed({ supabase: client, userId: "user-a", onError: () => {} });
  const stop = feed.start();
  const close = feed.retainPreview();
  try {
    await feed.refresh();
    client.rows = [];
    client.intercept = (query) => query.options?.head ? { error: { message: "offline" } } : undefined;
    await feed.removeNotification({ id: 1, type: "messages" }, { data: [row(1)], error: null });
    assert.equal(feed.getSnapshot().unreadCount, 0);
    assert.equal(feed.getSnapshot().hasUnreadMessages, false);
    await feed.refresh();
    assert.equal(feed.getSnapshot().unreadCount, 0);
    assert.equal(feed.getSnapshot().hasUnreadMessages, false);
  } finally { close(); stop(); }
});

test("a conversation removal uses all affected rows and preserves other unread messages outside the preview", async () => {
  const removed = [
    ...Array.from({ length: 30 }, (_, i) => row(i, "messages", "user-a", { conversation_id: "conversation-a" })),
    row(31, "message", "user-a", { conversation_id: "conversation-a", dismissed_at: "2026-09-08" }),
    row(32, "messages", "user-a", { conversation_id: "conversation-a", read_at: "2026-09-08" }),
  ];
  const remaining = [
    row(33, "announcement", "user-a", { conversation_id: "conversation-b" }),
    row(34, "conversation_closed", "user-a", { conversation_id: "conversation-a" }),
  ];
  const client = createClientDouble([...removed, ...remaining]);
  const feed = createNotificationFeed({ supabase: client, userId: "user-a", onError: () => {} });
  const stop = feed.start();
  const close = feed.retainPreview();
  try {
    await feed.refresh();
    assert.equal(feed.getSnapshot().rows.length, 24);
    assert.equal(feed.getSnapshot().unreadCount, 32);
    assert.equal(feed.getSnapshot().unreadMessageCount, 32);
    client.rows = remaining;
    client.intercept = (query) => query.options?.head ? { error: { message: "offline" } } : undefined;
    await feed.removeNotification(
      { id: 0, type: "messages", conversationId: "conversation-a", unreadCount: 24 },
      { data: removed, error: null },
    );
    assert.equal(feed.getSnapshot().unreadCount, 2);
    assert.equal(feed.getSnapshot().unreadMessageCount, 1);
    assert.equal(feed.getSnapshot().hasUnreadMessages, true);
    await feed.refresh();
    assert.equal(feed.getSnapshot().unreadCount, 2);
    assert.equal(feed.getSnapshot().hasUnreadMessages, true);
    assert.deepEqual(feed.getSnapshot().rows.map((entry) => entry.id), [33, 34]);
  } finally { close(); stop(); }
});

test("deleting a mixed group respects disabled messages and always-on announcements", async () => {
  const removed = [row(1), row(2, "announcement"), row(3, "message")];
  const client = createClientDouble([...removed, row(4, "moderation_warning")]);
  client.preferences = [{ user_id: "user-a", notification_type: "messages", in_app_enabled: false }];
  const feed = createNotificationFeed({ supabase: client, userId: "user-a", onError: () => {} });
  const stop = feed.start();
  try {
    await feed.refresh();
    assert.equal(feed.getSnapshot().unreadCount, 2);
    client.rows = [row(4, "moderation_warning")];
    client.intercept = (query) => query.options?.head ? { error: { message: "offline" } } : undefined;
    await feed.removeNotification({ id: 2, type: "announcement" }, { data: removed, error: null });
    await feed.refresh();
    assert.equal(feed.getSnapshot().unreadCount, 1);
    assert.equal(feed.getSnapshot().hasUnreadMessages, false);
  } finally { stop(); }
});

test("reading an enforcement notice updates only the bell from the confirmed unread transition", async () => {
  const notice = row(2, "moderation_warning");
  const client = createClientDouble([notice, row(1)]);
  const feed = createNotificationFeed({ supabase: client, userId: "user-a", onError: () => {} });
  const stop = feed.start();
  const close = feed.retainPreview();
  try {
    await feed.refresh();
    client.rows[0] = { ...notice, read_at: "2026-09-08" };
    client.intercept = (query) => query.options?.head ? { error: { message: "offline" } } : undefined;
    await feed.removeNotification(
      { id: notice.id, type: notice.type },
      { data: [{ id: notice.id, type: notice.type }], error: null },
      { markRead: true },
    );
    assert.equal(feed.getSnapshot().unreadCount, 1);
    assert.equal(feed.getSnapshot().hasUnreadMessages, true);
    await feed.refresh();
    assert.equal(feed.getSnapshot().unreadCount, 1);
    assert.deepEqual(feed.getSnapshot().rows.map((entry) => entry.id), [1]);
  } finally { close(); stop(); }
});

test("Realtime reads cannot publish post-write counts before the confirmed removal delta", async () => {
  const removed = row(1);
  const client = createClientDouble([removed, row(2)]);
  const feed = createNotificationFeed({ supabase: client, userId: "user-a", onError: () => {} });
  const stop = feed.start();
  await feed.refresh();
  const countGate = deferred();
  const started = deferred();
  let held = false;
  client.intercept = (query, result) => {
    if (query.options?.head && !held) {
      held = true;
      started.resolve();
      return countGate.promise.then(() => result);
    }
  };
  const read = feed.refresh();
  await started.promise;
  const writeGate = deferred();
  const write = feed.removeNotification({ id: 1, type: "messages" }, writeGate.promise);
  client.rows = [row(2)];
  feed.invalidate();
  countGate.resolve();
  try {
    await read;
    const requestsBefore = client.calls.length;
    await feed.refresh();
    assert.equal(client.calls.length, requestsBefore);
    assert.equal(feed.getSnapshot().unreadCount, 2);
    writeGate.resolve({ data: [removed], error: null });
    await write;
    assert.equal(feed.getSnapshot().unreadCount, 1);
    client.intercept = (query) => query.options?.head ? { error: { message: "offline" } } : undefined;
    await feed.refresh();
    assert.equal(feed.getSnapshot().unreadCount, 1);
    assert.equal(feed.getSnapshot().hasUnreadMessages, true);
  } finally { stop(); }
});

test("overlapping successful removals apply each delta once, including a zero-row duplicate", async () => {
  const client = createClientDouble([row(1), row(2), row(3)]);
  const feed = createNotificationFeed({ supabase: client, userId: "user-a", onError: () => {} });
  const stop = feed.start();
  await feed.refresh();
  const firstGate = deferred();
  const secondGate = deferred();
  const first = feed.removeNotification({ id: 1, type: "messages" }, firstGate.promise);
  const second = feed.removeNotification({ id: 2, type: "messages" }, secondGate.promise);
  try {
    secondGate.resolve({ data: [row(2)], error: null });
    await second;
    assert.equal(feed.getSnapshot().unreadCount, 2);
    const callsBefore = client.calls.length;
    await feed.refresh();
    assert.equal(client.calls.length, callsBefore);
    firstGate.resolve({ data: [row(1)], error: null });
    await first;
    await feed.removeNotification({ id: 1, type: "messages" }, { data: [], error: null });
    assert.equal(feed.getSnapshot().unreadCount, 1);
    assert.equal(feed.getSnapshot().hasUnreadMessages, true);
    client.rows = [row(3)];
    client.intercept = (query) => query.options?.head ? { error: { message: "offline" } } : undefined;
    await feed.refresh();
    assert.equal(feed.getSnapshot().unreadCount, 1);
  } finally { stop(); }
});

test("failed writes preserve badges and release the refresh hold", async () => {
  const client = createClientDouble([row(1)]);
  const feed = createNotificationFeed({ supabase: client, userId: "user-a" });
  const stop = feed.start();
  try {
    await feed.refresh();
    const result = await feed.removeNotification({ id: 1, type: "messages" }, { error: { message: "denied" } });
    assert.equal(result.error.message, "denied");
    assert.equal(feed.getSnapshot().unreadCount, 1);
    await assert.rejects(feed.removeNotification({ id: 1, type: "messages" }, Promise.reject(new Error("network"))), /network/);
    client.rows.push(row(2));
    await feed.refresh();
    assert.equal(feed.getSnapshot().unreadCount, 2);
    assert.equal(feed.getSnapshot().hasUnreadMessages, true);
  } finally { stop(); }
});

test("sign-out during a write rejects late counter changes and leaves the next account independent", async () => {
  const client = createClientDouble([row(1), row(2, "messages", "user-b")]);
  const feed = createNotificationFeed({ supabase: client, userId: "user-a" });
  const stop = feed.start();
  await feed.refresh();
  const gate = deferred();
  const write = feed.removeNotification({ id: 1, type: "messages" }, gate.promise);
  client.changeAccount("user-b");
  const nextFeed = createNotificationFeed({ supabase: client, userId: "user-b" });
  const stopNext = nextFeed.start();
  try {
    await nextFeed.refresh();
    gate.resolve({ data: [row(1)], error: null });
    await write;
    assert.equal(feed.getSnapshot().unreadCount, 0);
    assert.equal(feed.getSnapshot().hasUnreadMessages, false);
    assert.equal(nextFeed.getSnapshot().unreadCount, 1);
    assert.equal(nextFeed.getSnapshot().hasUnreadMessages, true);
    const callsBefore = client.calls.length;
    const result = await feed.removeNotification({ id: 1 }, client.from("notifications").select("id"));
    assert.ok(result.error);
    assert.equal(client.calls.length, callsBefore);
  } finally { stopNext(); stop(); }
});


// Run the actual event handler without mounting React; its database writes and
// shared-feed updates remain intact, while rendering and toasts are irrelevant.
const buttonSource = await readFile(new URL("../src/components/notifications-button.jsx", import.meta.url), "utf8");
const dismissalSource = buttonSource.slice(
  buttonSource.indexOf("async function deleteNotificationGroup("),
  buttonSource.indexOf("async function handleNotificationClick("),
);
function dismissThroughButton(client, feed, notification) {
  const context = vm.createContext({
    supabase: client,
    feed,
    user: { id: "user-a" },
    dismissingNotificationKey: null,
    setDismissingNotificationKey() {},
    isEnforcementNotificationType,
    isMessageNotificationType,
    MESSAGE_NOTIFICATION_ROW_TYPES,
    t: { notificationDismissError: "dismiss failed" },
    toast: { error() {} },
    console: { error() {} },
  });
  return vm.runInContext(`${dismissalSource}\ndeleteNotificationGroup;`, context)(notification);
}

test("the dismissal handler persists an enforcement dismissal after another tab has read it", async () => {
  const notice = row(1, "moderation_warning");
  const client = createClientDouble([notice, row(2)]);
  const feed = createNotificationFeed({ supabase: client, userId: "user-a", onError: () => {} });
  const stop = feed.start();
  const close = feed.retainPreview();
  try {
    await feed.refresh();
    // Refresh counts after the other tab reads the notice, with the preview
    // closed so the original notice can still be the target of a queued click.
    close();
    notice.read_at = "2026-09-08T10:00:00Z";
    await feed.refresh();
    assert.equal(feed.getSnapshot().unreadCount, 1);
    client.intercept = (query) => query.options?.head ? { error: { message: "offline" } } : undefined;
    assert.equal(await dismissThroughButton(client, feed, { id: 1, type: notice.type, groupKey: 1 }), true);
    assert.equal(notice.read_at, "2026-09-08T10:00:00Z");
    assert.ok(notice.dismissed_at);
    assert.equal(feed.getSnapshot().unreadCount, 1);
    assert.equal(feed.getSnapshot().hasUnreadMessages, true);
    assert.equal(client.calls.filter((query) => query.updatedValues).length, 2);
    await feed.refresh();
    assert.equal(feed.getSnapshot().unreadCount, 1);
  } finally { stop(); }
});

test("the dismissal handler returns the full conversation deletion and keeps enforcement history", async () => {
  const removed = Array.from({ length: 30 }, (_, i) => row(i, "messages", "user-a", { conversation_id: "a" }));
  const client = createClientDouble([...removed, row(31, "conversation_closed", "user-a", { conversation_id: "a" })]);
  const feed = createNotificationFeed({ supabase: client, userId: "user-a", onError: () => {} });
  const stop = feed.start();
  const close = feed.retainPreview();
  try {
    await feed.refresh();
    client.intercept = (query) => query.options?.head ? { error: { message: "offline" } } : undefined;
    assert.equal(await dismissThroughButton(client, feed, { id: 0, type: "messages", conversationId: "a", groupKey: "a" }), true);
    assert.deepEqual(client.rows.map((entry) => entry.id), [31]);
    assert.equal(feed.getSnapshot().unreadCount, 1);
    assert.equal(feed.getSnapshot().hasUnreadMessages, false);
    await feed.refresh();
    assert.equal(feed.getSnapshot().unreadCount, 1);
    assert.equal(feed.getSnapshot().hasUnreadMessages, false);
  } finally { close(); stop(); }
});

test("the dismissal handler counts an unread enforcement transition without a fallback write", async () => {
  const notice = row(1, "moderation_warning");
  const client = createClientDouble([notice]);
  const feed = createNotificationFeed({ supabase: client, userId: "user-a", onError: () => {} });
  const stop = feed.start();
  try {
    await feed.refresh();
    client.intercept = (query) => query.options?.head ? { error: { message: "offline" } } : undefined;
    assert.equal(await dismissThroughButton(client, feed, { id: 1, type: notice.type, groupKey: 1 }), true);
    assert.ok(notice.read_at);
    assert.ok(notice.dismissed_at);
    assert.equal(client.calls.filter((query) => query.updatedValues).length, 1);
    assert.equal(feed.getSnapshot().unreadCount, 0);
    await feed.refresh();
    assert.equal(feed.getSnapshot().unreadCount, 0);
  } finally { stop(); }
});
