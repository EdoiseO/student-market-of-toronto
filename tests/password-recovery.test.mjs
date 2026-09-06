import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server.js";
import {
  completePasswordRecovery, createIsolatedRecoveryClient, createRecoveryBrowserSecret,
  hashRecoveryBrowserSecret, hasRecoveryOrigin, isRecoveryVerifier, validateRecoverySubmission,
} from "../src/lib/password-recovery.mjs";
import { createPostgresFixture, postgresAvailable } from "./helpers/postgres-fixture.mjs";

const email = "student@utoronto.ca";
const user = { id: "11111111-1111-4111-8111-111111111111", email, aud: "authenticated", role: "authenticated" };
const payload = { state: randomUUID(), code: "valid-pkce-auth-code", email, password: "New-password-123!", confirmPassword: "New-password-123!" };
const browserHash = hashRecoveryBrowserSecret(createRecoveryBrowserSecret());
const verifier = "a".repeat(112) + "/recovery";
const token = [
  { alg: "HS256", typ: "JWT" },
  { sub: user.id, email, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 },
].map((value) => Buffer.from(JSON.stringify(value)).toString("base64url")).join(".") + ".test-signature";

function provider({ wrongUser = false, updateStatus = 200, logoutStatus = 204, exchangeStatus = 200 } = {}) {
  const calls = [];
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: url.pathname, search: url.search, method, body, authorization: new Headers(init.headers).get("authorization") });
    if (url.pathname === "/auth/v1/recover") return Response.json({});
    if (url.pathname === "/auth/v1/token") {
      if (exchangeStatus !== 200) return Response.json({ msg: "Invalid PKCE verifier" }, { status: exchangeStatus });
      assert.equal(url.searchParams.get("grant_type"), "pkce");
      assert.equal(body.auth_code, payload.code);
      assert.ok(body.code_verifier);
      return Response.json({ access_token: token, refresh_token: "isolated-refresh-token", token_type: "bearer", expires_in: 3600, user });
    }
    if (url.pathname === "/auth/v1/user") {
      if (method === "PUT") {
        if (updateStatus !== 200) return Response.json({ msg: "Update rejected" }, { status: updateStatus });
        return Response.json(user);
      }
      return Response.json(wrongUser ? { ...user, email: "other@utoronto.ca" } : user);
    }
    if (url.pathname === "/auth/v1/logout") {
      return logoutStatus === 204 ? new Response(null, { status: 204 }) : Response.json({ msg: "Revocation unavailable" }, { status: logoutStatus });
    }
    throw new Error(`Unexpected local Auth fixture request: ${method} ${url.pathname}`);
  };
  return { calls, fetch };
}

const makeClient = (mock, value) => createIsolatedRecoveryClient({ url: "https://auth.invalid", key: "test-publishable-key", verifier: value, fetch: mock.fetch });

test("installed SDK produces the recovery-purpose PKCE challenge without ordinary session storage", async () => {
  const mock = provider();
  const isolated = makeClient(mock);
  const redirectTo = `https://market.invalid/reset-password?state=${payload.state}`;
  const sent = await isolated.client.auth.resetPasswordForEmail(email, { redirectTo });
  assert.equal(sent.error, null);
  const captured = isolated.readVerifier();
  assert.ok(isRecoveryVerifier(captured));
  const challenge = createHash("sha256").update(captured.split("/")[0]).digest("base64url");
  assert.equal(mock.calls[0].body.code_challenge, challenge);
  assert.equal(mock.calls[0].body.code_challenge_method, "s256");
  assert.equal(new URLSearchParams(mock.calls[0].search).get("redirect_to"), redirectTo);
  assert.equal(mock.calls.length, 1);
  isolated.clear();
  assert.equal(isolated.readVerifier(), null);
});

test("installed SDK exchanges only the claimed verifier, updates intended identity, and revokes globally", async () => {
  const mock = provider();
  let consumed = false;
  const claim = async (input) => {
    assert.deepEqual(input, { state: payload.state, browserHash, email });
    if (consumed) return null;
    consumed = true;
    return { email, verifier };
  };
  const result = await completePasswordRecovery({ payload, browserHash, claim, createIsolatedClient: (value) => makeClient(mock, value) });
  assert.deepEqual(result, { status: 200, updated: true, userId: user.id, sessionsRevoked: true });
  assert.equal(mock.calls[0].body.code_verifier, verifier.split("/")[0]);
  assert.equal(mock.calls.find((call) => call.method === "PUT").body.password, payload.password);
  assert.equal(mock.calls.at(-1).search, "?scope=global");
  const beforeReplay = mock.calls.length;
  const replay = await completePasswordRecovery({ payload, browserHash, claim, createIsolatedClient: () => assert.fail("Replay must not create an Auth client") });
  assert.equal(replay.error, "invalid_link");
  assert.equal(mock.calls.length, beforeReplay);
});

test("raw credentials, missing state, non-recovery purpose, other browser and email fail before exchange", async () => {
  for (const malicious of [
    { access_token: token, refresh_token: "attacker-refresh", type: "recovery" },
    { ...payload, token_hash: "attacker-token-hash", type: "recovery" },
    { ...payload, state: null },
    { ...payload, session: { access_token: token } },
  ]) {
    assert.ok(validateRecoverySubmission(malicious));
    const result = await completePasswordRecovery({ payload: malicious, browserHash, claim: () => assert.fail("Invalid shape must not claim"), createIsolatedClient: () => assert.fail() });
    assert.equal(result.error, "invalid_link");
  }
  for (const intent of [null, { email: "other@utoronto.ca", verifier }, { email, verifier: "a".repeat(112) }]) {
    const result = await completePasswordRecovery({ payload, browserHash, claim: async () => intent, createIsolatedClient: () => assert.fail("Missing bound purpose must not exchange") });
    assert.equal(result.error, "invalid_link");
  }
});

test("wrong Auth identity or verifier cannot update a password and never revokes unrelated sessions", async () => {
  for (const options of [{ wrongUser: true }, { exchangeStatus: 400 }]) {
    const mock = provider(options);
    const result = await completePasswordRecovery({ payload, browserHash, claim: async () => ({ email, verifier }), createIsolatedClient: (value) => makeClient(mock, value) });
    assert.equal(result.error, "invalid_link");
    assert.ok(mock.calls.every((call) => call.method !== "PUT"));
    assert.ok(mock.calls.every((call) => call.search !== "?scope=global"));
    if (options.wrongUser) assert.equal(mock.calls.at(-1).search, "?scope=local");
  }
});

test("update rejection, ambiguous update, and revocation failure have distinct truthful outcomes", async () => {
  for (const [options, expected] of [
    [{ updateStatus: 422 }, { error: "password_rejected", status: 400 }],
    [{ updateStatus: 503 }, { error: "outcome_unknown", status: 503 }],
    [{ logoutStatus: 503 }, { updated: true, sessionsRevoked: false, status: 200 }],
  ]) {
    const mock = provider(options);
    const result = await completePasswordRecovery({ payload, browserHash, claim: async () => ({ email, verifier }), createIsolatedClient: (value) => makeClient(mock, value) });
    for (const [key, value] of Object.entries(expected)) assert.equal(result[key], value);
  }
});

test("sensitive POST requires exact same origin and JSON; local password validation precedes consumption", () => {
  const request = (origin, type = "application/json") => new Request("https://market.invalid/api/auth/recovery", { method: "POST", headers: { ...(origin ? { origin } : {}), "content-type": type } });
  assert.equal(hasRecoveryOrigin(request("https://market.invalid")), true);
  for (const origin of [null, "null", "https://evil.invalid", "https://market.invalid.evil.invalid"]) assert.equal(hasRecoveryOrigin(request(origin)), false);
  assert.equal(hasRecoveryOrigin(request("https://market.invalid", "text/plain")), false);
  assert.equal(validateRecoverySubmission({ ...payload, password: "short" }), "password_policy");
  assert.equal(validateRecoverySubmission({ ...payload, confirmPassword: "different" }), "password_mismatch");
});

test("entry points have no session-adoption fallback and keep recovery out of the generic callback", async () => {
  const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const [page, browser, callback, register, route, proxy] = await Promise.all([
    read("src/app/reset-password/page.jsx"), read("src/utils/supabase/client.js"),
    read("src/app/auth/callback/route.js"), read("src/components/register-form.jsx"),
    read("src/app/api/auth/recovery/route.js"), read("src/proxy.js"),
  ]);
  assert.doesNotMatch(page, /auth\.(setSession|verifyOtp|getSession|exchangeCodeForSession|updateUser)/);
  assert.match(browser, /detectSessionInUrl: false/);
  assert.match(page, /history\.replaceState/);
  assert.match(callback, /data\.redirectType === "recovery"/);
  assert.match(register, /emailRedirectTo:.*\/auth\/callback/);
  assert.doesNotMatch(route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST")), /exchangeCode|setSession|\.update\(|\.insert\(|cookies\.set/);
  assert.ok(proxy.indexOf("if (isRecoveryRoute)") > proxy.indexOf("auth.getUser()"));
  assert.ok(proxy.indexOf("if (isRecoveryRoute)") < proxy.indexOf("getUserStatusRow(supabase"));
});

async function loadProxy(dependencies) {
  // Run the production proxy unchanged apart from resolving its imports to
  // controlled fixtures, including the real NextResponse implementation.
  const binding = `recoveryProxy_${randomUUID().replaceAll("-", "")}`;
  globalThis[binding] = { ...dependencies, NextResponse };
  const moduleUrl = (exports) => "data:text/javascript;base64," + Buffer.from(
    exports.map((name) => `export const ${name} = globalThis[${JSON.stringify(binding)}].${name};`).join("\n"),
  ).toString("base64");
  const replacements = {
    "@supabase/ssr": moduleUrl(["createServerClient"]),
    "next/server": moduleUrl(["NextResponse"]),
    "@/lib/moderation": moduleUrl(["isNameChangeRequired"]),
    "@/lib/user-status": moduleUrl(["getUserStatusRow", "isUserBanned"]),
  };
  let source = await readFile(new URL("../src/proxy.js", import.meta.url), "utf8");
  for (const [specifier, replacement] of Object.entries(replacements)) source = source.replace(JSON.stringify(specifier), JSON.stringify(replacement));
  try {
    return (await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"))).proxy;
  } finally {
    delete globalThis[binding];
  }
}

test("recovery refreshes an expired ordinary session into both browser and layout cookies while preserving restrictions", async () => {
  const expiredToken = [
    { alg: "HS256", typ: "JWT" },
    { sub: user.id, email, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) - 60 },
  ].map((value) => Buffer.from(JSON.stringify(value)).toString("base64url")).join(".") + ".test-signature";
  const cookieName = "sb-fixture-auth-token";
  const expiredCookie = "base64-" + Buffer.from(JSON.stringify({
    access_token: expiredToken, refresh_token: "expired-ordinary-refresh", token_type: "bearer",
    expires_at: Math.floor(Date.now() / 1000) - 60, expires_in: 3600, user,
  })).toString("base64url");
  let refreshes = 0;
  let statusReads = 0;
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/token") {
      assert.equal(url.searchParams.get("grant_type"), "refresh_token");
      assert.equal(JSON.parse(init.body).refresh_token, "expired-ordinary-refresh");
      refreshes++;
      return Response.json({ access_token: token, refresh_token: "rotated-ordinary-refresh", token_type: "bearer", expires_in: 3600, user });
    }
    assert.equal(url.pathname, "/auth/v1/user");
    return Response.json(user);
  };
  const sdk = (_url, _key, options) => createServerClient("https://fixture.supabase.invalid", "test-key", { ...options, global: { fetch } });
  const proxy = await loadProxy({
    createServerClient: sdk,
    isNameChangeRequired: () => true,
    getUserStatusRow: async () => { statusReads++; return { available: true, data: { banned: true } }; },
    isUserBanned: (data) => data?.banned === true,
  });
  const request = new NextRequest("https://market.invalid/reset-password", { headers: { cookie: `${cookieName}=${expiredCookie}` } });
  const response = await proxy(request);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(statusReads, 0);
  assert.equal(refreshes, 1);
  const freshCookie = request.cookies.get(cookieName).value;
  assert.notEqual(freshCookie, expiredCookie);
  assert.equal(response.cookies.get(cookieName).value, freshCookie);
  assert.ok(response.headers.get("x-middleware-request-cookie").includes(`${cookieName}=${freshCookie}`));
  const stored = JSON.parse(Buffer.from(freshCookie.slice("base64-".length), "base64url").toString());
  assert.equal(stored.user.id, user.id);
  assert.equal(stored.refresh_token, "rotated-ordinary-refresh");
  const downstream = sdk(null, null, { cookies: {
    getAll: () => request.cookies.getAll(),
    setAll: () => assert.fail("Layout must not repeat the expired-session refresh"),
  } });
  assert.equal((await downstream.auth.getUser()).data.user.id, user.id);
  assert.equal(refreshes, 1);
  const protectedResponse = await proxy(new NextRequest("https://market.invalid/dashboard", { headers: { cookie: `${cookieName}=${freshCookie}` } }));
  assert.equal(protectedResponse.headers.get("location"), "https://market.invalid/banned");
  assert.equal(statusReads, 1);
});

test("exact recovery methods bypass name/status gates without exempting sibling routes", async () => {
  let statusReads = 0;
  const proxy = await loadProxy({
    createServerClient: () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
    isNameChangeRequired: () => true,
    getUserStatusRow: async () => { statusReads++; return { available: false, error: new Error("Unavailable") }; },
    isUserBanned: () => false,
  });
  for (const [path, method] of [["/reset-password", "GET"], ["/forget-password", "GET"], ["/api/auth/recovery", "GET"], ["/api/auth/recovery", "POST"]]) {
    assert.equal((await proxy(new NextRequest(`https://market.invalid${path}`, { method }))).status, 200);
  }
  assert.equal(statusReads, 0);
  for (const [path, method] of [["/api/auth/recovery/other", "POST"], ["/api/auth/recovery", "DELETE"], ["/dashboard", "GET"]]) {
    assert.equal((await proxy(new NextRequest(`https://market.invalid${path}`, { method }))).status, 503);
  }
  assert.equal(statusReads, 3);
});

test("native PostgreSQL enforces recovery ACL, binding, expiry, rate limits and concurrent one-use consumption", { skip: !postgresAvailable, timeout: 40_000 }, async (t) => {
  const fixture = createPostgresFixture(t, { prefix: "smot-rec-" });
  fixture.sql("create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role;");
  fixture.apply(new URL("../supabase/migrations/20260906150000_browser_bound_password_recovery.sql", import.meta.url));
  const state = randomUUID();
  const reserve = (id = state, address = email, browser = browserHash) => `select public.reserve_password_recovery_intent('${id}','${browser}','${address}');`;
  const claim = (id = state, address = email, browser = browserHash) => `select * from public.claim_password_recovery_intent('${id}','${browser}','${address}');`;
  for (const role of ["anon", "authenticated"]) {
    assert.notEqual(fixture.result(`set role ${role}; ${reserve()}`).status, 0);
    assert.notEqual(fixture.result(`set role ${role}; select * from public.password_recovery_intents;`).status, 0);
    assert.notEqual(fixture.result(`set role ${role}; ${claim()}`).status, 0);
  }
  assert.equal(fixture.sql(`set role service_role; ${reserve()}`), "t");
  assert.equal(fixture.sql(`set role service_role; ${reserve(randomUUID())}`), "f");
  fixture.sql(`update public.password_recovery_intents set verifier='${verifier}' where id='${state}';`);
  assert.equal(fixture.sql(claim(state, "other@utoronto.ca")), "");
  assert.equal(fixture.sql(claim(state, email, "b".repeat(64))), "");
  assert.equal(fixture.sql("select count(*) from public.password_recovery_intents where consumed_at is null;"), "1");
  const first = fixture.spawnSql(`begin; set role service_role; ${claim()} select 'claimed'; select pg_sleep(0.3); commit;`);
  await first.waitForOutput("claimed");
  const second = fixture.spawnSql(`set role service_role; ${claim()}`);
  const outcomes = await Promise.all([first.completion, second.completion]);
  for (const outcome of outcomes) assert.equal(outcome.status, 0, outcome.stderr);
  assert.ok(outcomes[0].stdout.includes(email));
  assert.equal(outcomes[1].stdout.trim(), "");
  assert.equal(fixture.sql(`select verifier is null and consumed_at is not null from public.password_recovery_intents where id='${state}';`), "t");
  const expired = randomUUID();
  fixture.sql(`insert into public.password_recovery_intents(id,browser_hash,email,verifier,expires_at) values ('${expired}','${browserHash}','${email}','${verifier}',now()-interval '1 second');`);
  assert.equal(fixture.sql(claim(expired)), "");
  for (let index = 0; index < 5; index++) fixture.sql(`insert into public.password_recovery_intents(id,browser_hash,email,created_at) values ('${randomUUID()}','${browserHash}','limit@utoronto.ca',now()-interval '2 minutes');`);
  assert.equal(fixture.sql(reserve(randomUUID(), "limit@utoronto.ca")), "f");
  for (let index = 0; index < 20; index++) fixture.sql(`insert into public.password_recovery_intents(id,browser_hash,email,created_at) values ('${randomUUID()}','${"c".repeat(64)}','browser${index}@utoronto.ca',now()-interval '2 minutes');`);
  assert.equal(fixture.sql(reserve(randomUUID(), "new@utoronto.ca", "c".repeat(64))), "f");
});
