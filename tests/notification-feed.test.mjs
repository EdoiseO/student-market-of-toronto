import assert from "node:assert/strict";
import test from "node:test";
import { createNotificationFeed } from "../src/lib/notification-feed.mjs";

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
        eq(column, value) { this.filters.push((row) => row[column] === value); return this; },
        in(column, values) { this.filters.push((row) => values.includes(row[column])); return this; },
        is(column, value) { return this.eq(column, value); },
        order() { return this; },
        limit(value) { this.rowLimit = value; return this; },
        then(resolve, reject) {
          calls.push(this);
          const filtered = (table === "notification_preferences" ? client.preferences : client.rows)
            .filter((row) => this.filters.every((filter) => filter(row)));
          const result = this.options?.head
            ? { count: filtered.length, error: null }
            : { data: filtered.slice(0, this.rowLimit), error: null };
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
  feed.removeNotification({ id: 1, type: "messages" });
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
    feed.markAllRead();
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
