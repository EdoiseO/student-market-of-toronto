import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server.js";
import * as recovery from "../src/lib/password-recovery.mjs";

// Resolve only module boundaries, as in password-recovery.test.mjs. The route,
// server cookie adapter, recovery protocol, Next cookies, and SDK run unchanged.
async function loadSource(path, dependencies) {
  const binding = `recoveryRoute_${randomUUID().replaceAll("-", "")}`;
  globalThis[binding] = dependencies;
  let source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  for (const [specifier, exports] of Object.entries(dependencies)) {
    const shim = Object.keys(exports).map((name) =>
      `export const ${name} = globalThis[${JSON.stringify(binding)}][${JSON.stringify(specifier)}][${JSON.stringify(name)}];`,
    ).join("\n");
    assert.ok(source.includes(JSON.stringify(specifier)), `Missing import ${specifier}`);
    source = source.replace(JSON.stringify(specifier), JSON.stringify(
      "data:text/javascript;base64," + Buffer.from(shim).toString("base64"),
    ));
  }
  try {
    return await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
  } finally {
    delete globalThis[binding];
  }
}

const recoveredUser = {
  id: "11111111-1111-4111-8111-111111111111", email: "recovery@utoronto.ca",
  aud: "authenticated", role: "authenticated",
};
const otherUser = { ...recoveredUser, id: "22222222-2222-4222-8222-222222222222", email: "other@utoronto.ca" };
const authCookieName = "sb-fixture-auth-token";
const recoveryCookieName = "__Host-smt-recovery";
const verifier = "a".repeat(112) + "/recovery";
const tokenFor = (user, sessionId) => [
  { alg: "HS256", typ: "JWT" },
  { sub: user.id, email: user.email, aud: user.aud, role: user.role,
    session_id: sessionId, exp: Math.floor(Date.now() / 1000) + 3600 },
].map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".") + ".fixture-signature";

async function runCompletion(t, ordinaryUser, { updateRejected = false } = {}) {
  const envNames = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY"];
  const priorEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  t.after(() => {
    for (const name of envNames) {
      if (priorEnv[name] === undefined) delete process.env[name];
      else process.env[name] = priorEnv[name];
    }
  });
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fixture.supabase.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY = "fixture-publishable-key";
  const ordinaryToken = tokenFor(ordinaryUser, "ordinary-session");
  const isolatedToken = tokenFor(recoveredUser, "isolated-recovery-session");
  const authCookie = "base64-" + Buffer.from(JSON.stringify({
    access_token: ordinaryToken, refresh_token: "ordinary-refresh-token", token_type: "bearer",
    expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: ordinaryUser,
  })).toString("base64url");
  const browserSecret = recovery.createRecoveryBrowserSecret();
  const payload = {
    action: "complete", state: randomUUID(), code: "fixture-pkce-code", email: recoveredUser.email,
    password: "New-password-123!", confirmPassword: "New-password-123!",
  };
  const request = new NextRequest("https://market.invalid/api/auth/recovery", {
    method: "POST", headers: {
      origin: "https://market.invalid", "content-type": "application/json",
      cookie: `${authCookieName}=${authCookie}; ${recoveryCookieName}=${browserSecret}; language=fr`,
    }, body: JSON.stringify(payload),
  });
  const cookieWrites = NextResponse.next();
  const cookieStore = {
    getAll: () => request.cookies.getAll(),
    set(name, value, options) {
      request.cookies.set(name, value);
      cookieWrites.cookies.set(name, value, options);
    },
  };
  const calls = [];
  const fixtureErrors = [];
  const handleFetch = async (input, init = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://fixture.supabase.invalid");
    const method = init.method ?? "GET";
    const authorization = new Headers(init.headers).get("authorization");
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: url.pathname, search: url.search, method, authorization });
    if (url.pathname === "/auth/v1/token") {
      assert.equal(url.searchParams.get("grant_type"), "pkce");
      assert.deepEqual(body, { auth_code: payload.code, code_verifier: verifier.split("/")[0] });
      return Response.json({ access_token: isolatedToken, refresh_token: "isolated-refresh-token",
        token_type: "bearer", expires_in: 3600, user: recoveredUser });
    }
    if (url.pathname === "/auth/v1/user") {
      if (method === "PUT") {
        assert.equal(authorization, `Bearer ${isolatedToken}`);
        assert.deepEqual(body, { password: payload.password, code_challenge: null, code_challenge_method: null });
        return updateRejected
          ? Response.json({ msg: "Password policy rejected" }, { status: 422 })
          : Response.json(recoveredUser);
      }
      assert.equal(method, "GET");
      assert.ok([`Bearer ${ordinaryToken}`, `Bearer ${isolatedToken}`].includes(authorization));
      return Response.json(authorization === `Bearer ${ordinaryToken}` ? ordinaryUser : recoveredUser);
    }
    if (url.pathname === "/auth/v1/logout") {
      assert.equal(method, "POST");
      if (authorization === `Bearer ${isolatedToken}`) {
        assert.equal(url.searchParams.get("scope"), updateRejected ? "local" : "global");
        return new Response(null, { status: 204 });
      }
      assert.equal(authorization, `Bearer ${ordinaryToken}`);
      assert.equal(ordinaryUser.id, recoveredUser.id, "Must never revoke a different ordinary identity");
      assert.equal(url.searchParams.get("scope"), "local");
      // Global recovery revocation can already have removed this session.
      // The real SDK must still clear its ordinary cookies after this response.
      return Response.json({ msg: "Session already revoked" }, { status: 403 });
    }
    assert.fail(`Unexpected Auth request: ${method} ${url.pathname}`);
  };
  const fetch = async (...args) => {
    try { return await handleFetch(...args); }
    catch (error) { fixtureErrors.push(error); throw error; }
  };
  const server = await loadSource("src/utils/supabase/server.js", {
    "@supabase/ssr": { createServerClient: (url, key, options) =>
      createServerClient(url, key, { ...options, global: { fetch } }) },
  });
  let claims = 0;
  const { POST } = await loadSource("src/app/api/auth/recovery/route.js", {
    "next/headers": { cookies: async () => cookieStore },
    "next/server": { NextResponse },
    "@/utils/supabase/server": server,
    "@/lib/supabase-admin": { createAdminClient: () => ({ rpc: async (name, params) => {
      assert.equal(name, "claim_password_recovery_intent");
      assert.deepEqual(params, { p_id: payload.state, p_email: recoveredUser.email,
        p_browser_hash: recovery.hashRecoveryBrowserSecret(browserSecret) });
      assert.equal(++claims, 1);
      return { data: [{ email: recoveredUser.email, verifier }], error: null };
    } }) },
    "@/lib/password-recovery.mjs": { ...recovery,
      createIsolatedRecoveryClient: (options) => recovery.createIsolatedRecoveryClient({ ...options, fetch }) },
  });
  const response = await POST(request);
  assert.deepEqual(fixtureErrors, [], "Auth fixture expectations must not be hidden by route error handling");
  assert.equal(claims, 1);
  assert.equal(calls[0].authorization, `Bearer ${ordinaryToken}`, "Read the ordinary identity before recovery revocation");
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(request.cookies.get(recoveryCookieName).value, browserSecret);
  assert.equal(request.cookies.get("language").value, "fr");
  assert.ok(request.cookies.getAll().every(({ value }) => !value.includes("isolated-refresh-token")));
  return { response, body: await response.json(), request, cookieWrites, authCookie, calls, ordinaryToken, isolatedToken };
}

test("completion clears the recovered account's ordinary cookies and reports preservedSession false", async (t) => {
  const result = await runCompletion(t, recoveredUser);
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, { updated: true, sessionsRevoked: true, preservedSession: false });
  assert.equal(result.request.cookies.get(authCookieName).value, "");
  assert.equal(result.cookieWrites.cookies.get(authCookieName).value, "");
  assert.equal(result.cookieWrites.cookies.get(authCookieName).maxAge, 0);
  assert.match(result.cookieWrites.headers.get("set-cookie"), /Max-Age=0/);
  assert.deepEqual(result.calls.filter(({ path }) => path === "/auth/v1/logout").map(({ search, authorization }) =>
    [search, authorization]), [["?scope=global", `Bearer ${result.isolatedToken}`], ["?scope=local", `Bearer ${result.ordinaryToken}`]]);
});

test("completion preserves a different ordinary account's identity and cookies without signing it out", async (t) => {
  const result = await runCompletion(t, otherUser);
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, { updated: true, sessionsRevoked: true, preservedSession: true });
  assert.equal(result.request.cookies.get(authCookieName).value, result.authCookie);
  assert.equal(result.cookieWrites.headers.get("set-cookie"), null);
  const session = JSON.parse(Buffer.from(result.request.cookies.get(authCookieName).value.slice("base64-".length), "base64url").toString());
  assert.equal(session.user.id, otherUser.id);
  assert.equal(session.refresh_token, "ordinary-refresh-token");
  assert.deepEqual(result.calls.filter(({ path }) => path === "/auth/v1/logout").map(({ search, authorization }) =>
    [search, authorization]), [["?scope=global", `Bearer ${result.isolatedToken}`]]);
});

test("a rejected password update preserves even the recovered account's ordinary cookies", async (t) => {
  const result = await runCompletion(t, recoveredUser, { updateRejected: true });
  assert.equal(result.response.status, 400);
  assert.deepEqual(result.body, { error: "password_rejected" });
  assert.equal(result.request.cookies.get(authCookieName).value, result.authCookie);
  assert.equal(result.cookieWrites.headers.get("set-cookie"), null);
  assert.deepEqual(result.calls.filter(({ path }) => path === "/auth/v1/logout").map(({ search, authorization }) =>
    [search, authorization]), [["?scope=local", `Bearer ${result.isolatedToken}`]]);
});
