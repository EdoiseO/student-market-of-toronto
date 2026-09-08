import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { cache } from "react";

import { getUserModerationRole } from "../src/lib/moderation.js";
import { MODERATION_ACTIONS, canPerformModerationAction } from "../src/lib/moderation-policy.mjs";
import { isUserBanned } from "../src/lib/user-status.js";

const source = (await readFile(new URL("../src/lib/admin-page-access.js", import.meta.url), "utf8"))
  .replace(/^import .*;\n/gm, "")
  .replace("export async function requireAdminPageAction", "async function requireAdminPageAction");

// Exercise the real authorization helper outside a React render, where cache()
// deliberately does not memoize. Browser checks cover render request counts.
function accessFixture(overrides = {}) {
  const calls = [];
  const admin = {};
  const user = { id: "actor", app_metadata: { role: "admin" } };
  const context = vm.createContext({
    cache,
    getUserModerationRole,
    MODERATION_ACTIONS,
    canPerformModerationAction,
    isUserBanned,
    translations: { en: {}, fr: {} },
    redirect(href) { throw new Error(`redirect:${href}`); },
    async getServerSession() {
      calls.push("verify");
      return { user, supabase: {}, cookieStore: { get: () => null } };
    },
    createAdminClient() { calls.push("admin"); return admin; },
    async getLatestAuthUser(client, id) {
      assert.equal(client, admin);
      assert.equal(id, user.id);
      calls.push("role");
      return user;
    },
    async getUserStatusRow(client, id) {
      assert.equal(client, admin);
      assert.equal(id, user.id);
      calls.push("status");
      return { data: null, error: null, available: true };
    },
    ...overrides,
  });
  const requireAction = vm.runInContext(`${source}\nrequireAdminPageAction;`, context);
  return { requireAction, calls };
}

test("admin data access never begins before a user is verified", async () => {
  const { requireAction, calls } = accessFixture({
    async getServerSession() { return { user: null }; },
  });
  await assert.rejects(requireAction(MODERATION_ACTIONS.viewDashboard), /redirect:\/login$/);
  assert.deepEqual(calls, []);
});

test("a demoted actor cannot use stale admin claims and overview denial cannot loop", async () => {
  const { requireAction } = accessFixture({
    async getLatestAuthUser() { return { id: "actor", app_metadata: {} }; },
  });
  await assert.rejects(requireAction(MODERATION_ACTIONS.viewDashboard), /redirect:\/$/);
  await assert.rejects(requireAction(MODERATION_ACTIONS.readAuditLog), /redirect:\/admin$/);
});

test("each admin page still checks its own permission against the latest role", async () => {
  const { requireAction } = accessFixture({
    async getLatestAuthUser() { return { id: "actor", app_metadata: { role: "staff" } }; },
  });
  assert.equal((await requireAction(MODERATION_ACTIONS.readListings)).role, "staff");
  await assert.rejects(requireAction(MODERATION_ACTIONS.readConversations), /redirect:\/admin$/);
  await assert.rejects(requireAction(MODERATION_ACTIONS.readAuditLog), /redirect:\/admin$/);
});

test("missing current Auth or unavailable account status fails closed", async () => {
  const missingActor = accessFixture({ async getLatestAuthUser() { return null; } });
  await assert.rejects(missingActor.requireAction(MODERATION_ACTIONS.viewDashboard), /redirect:\/$/);

  for (const status of [{ available: false }, { error: new Error("unavailable"), available: true }, {}]) {
    const { requireAction } = accessFixture({ async getUserStatusRow() { return status; } });
    await assert.rejects(requireAction(MODERATION_ACTIONS.viewDashboard), /redirect:\/$/);
  }
});

test("active bans block the dashboard and expired bans do not", async () => {
  for (const banned_until of [null, "2126-01-01T00:00:00Z"]) {
    const { requireAction } = accessFixture({
      async getUserStatusRow() { return { data: { is_banned: true, banned_until }, available: true }; },
    });
    await assert.rejects(requireAction(MODERATION_ACTIONS.viewDashboard), /redirect:\/banned$/);
  }
  const expired = accessFixture({
    async getUserStatusRow() { return { data: { is_banned: true, banned_until: "2000-01-01T00:00:00Z" }, available: true }; },
  });
  assert.equal((await expired.requireAction(MODERATION_ACTIONS.viewDashboard)).role, "admin");
});

test("role and status reads both start after verification without waiting for each other", async () => {
  let resolveRole;
  const role = new Promise((resolve) => { resolveRole = resolve; });
  let statusStarted = false;
  const { requireAction, calls } = accessFixture({
    getLatestAuthUser() { assert.deepEqual(calls, ["verify", "admin"]); return role; },
    async getUserStatusRow() { statusStarted = true; return { data: null, available: true }; },
  });
  const access = requireAction(MODERATION_ACTIONS.viewDashboard);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(statusStarted, true);
  resolveRole({ id: "actor", app_metadata: { role: "admin" } });
  assert.equal((await access).role, "admin");
});
