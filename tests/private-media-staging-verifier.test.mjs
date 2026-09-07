import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { parseCookieHeader } from "@supabase/ssr";
import { boundedBody, MAX_BYTES, metadataPatch, validateConfiguration, verifyPrivateMedia } from "../scripts/verify-private-media-staging.mjs";

function fixture() {
  const runId = randomUUID();
  const users = Object.fromEntries(["buyer", "seller", "staff", "moderator"].map((name) => [name,
    { id: randomUUID(), email: `authority-${runId}-${name}@mail.utoronto.ca`, password: "Synthetic-local-only-password" }]));
  const conversationId = randomUUID();
  const manifest = { version: 1, project: "fixture", url: "https://fixture.supabase.co", runId, users,
    fixture: { conversationId, mediaPath: `${conversationId}/${users.buyer.id}/fixture.png` } };
  const env = { SMOT_STAGING_URL: manifest.url, SMOT_STAGING_ANON_KEY: "local-publishable-key",
    SMOT_STAGING_SERVICE_ROLE_KEY: "local-service-key", SMOT_AUTHORITY_STAGING_ACK: "disposable:fixture",
    SMOT_PRIVATE_MEDIA_APP_ORIGIN: "https://stage.example.invalid", SMOT_PRIVATE_MEDIA_APP_ACK: "isolated:https://stage.example.invalid",
    SMOT_PRIVATE_MEDIA_VERCEL_BYPASS: "local-bypass-value", SMOT_PRIVATE_MEDIA_BYPASS_ORIGIN: "https://stage.example.invalid" };
  return { manifest, env };
}

test("target, bypass and manifest guards reject production or ambiguous credentials before requests", () => {
  const { manifest, env } = fixture();
  assert.equal(validateConfiguration(env, manifest).project, "fixture");
  for (const patch of [
    { SMOT_STAGING_URL: "https://bmnfynufuqjwjmtlfdxf.supabase.co" },
    { SMOT_PRIVATE_MEDIA_APP_ORIGIN: "https://student-market-of-toronto.vercel.app" },
    { SMOT_PRIVATE_MEDIA_APP_ORIGIN: "http://stage.example.invalid" },
    { SMOT_PRIVATE_MEDIA_APP_ORIGIN: "https://stage.example.invalid/path" },
    { SMOT_PRIVATE_MEDIA_APP_ACK: "isolated:some-other-origin" },
    { SMOT_PRIVATE_MEDIA_BYPASS_ORIGIN: "https://other.example.invalid" },
  ]) assert.throws(() => validateConfiguration({ ...env, ...patch }, manifest));
  assert.throws(() => validateConfiguration(env, { ...manifest, users: { ...manifest.users, extra: manifest.users.buyer } }));
  assert.throws(() => validateConfiguration(env, { ...manifest, fixture: { ...manifest.fixture, mediaPath: "../private.png" } }));
  assert.throws(() => validateConfiguration(env, { ...manifest, fixture: { ...manifest.fixture, mediaPath: `${manifest.users.buyer.id}/fixture.png` } }));
});

test("body limits reject both advertised and streamed oversize before accepting media", async () => {
  await assert.rejects(boundedBody(new Response("x", { headers: { "content-length": String(MAX_BYTES + 1) } })), /RESPONSE_EXCEEDS_LIMIT/);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5)); controller.enqueue(new Uint8Array(5)); controller.close(); } });
  await assert.rejects(boundedBody(new Response(stream), 8), /RESPONSE_EXCEEDS_LIMIT/);
  assert.equal((await boundedBody(new Response("12345678"), 8)).length, 8);
});

test("metadata restoration patch removes temporary keys and leaves unchanged nulls alone", () => {
  assert.deepEqual(metadataPatch({ fixture_run: "local", untouched: null, role: "student", roles: [] },
    { fixture_run: "local", untouched: null }), { role: null, roles: null });
});

async function simulatedHostedRun({ staleAccess = false, inactiveAfterDemotion = false, restorationFailure = false, redirect = false, nonFixtureMessage = false } = {}) {
  const { manifest, env } = fixture();
  const config = validateConfiguration(env, manifest);
  const attachmentId = randomUUID();
  const physicalMediaPath = `${manifest.fixture.conversationId}/${manifest.users.buyer.id}/relocated-${randomUUID()}.png`;
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRxoAAAAASUVORK5CYII=", "base64");
  const records = Object.fromEntries(Object.entries(manifest.users).map(([actor, user]) => [actor, {
    id: user.id, email: user.email, aud: "authenticated", role: "authenticated",
    app_metadata: { fixture_run: manifest.runId, untouched_null: null, ...(actor === "staff" ? { role: "staff" } : {}) },
  }]));
  const original = structuredClone(records.moderator.app_metadata);
  const tokens = new Map();
  const logins = [];
  const appRequests = [];
  const capturedHeaders = [];
  const metadataWrites = [];
  let snapshot;
  let cleared = false;
  const json = (value, status = 200) => Response.json(value, { status });
  const actorForToken = (token) => tokens.get(token);
  const actorForCookie = (cookie) => {
    const parts = parseCookieHeader(cookie).filter(({ name }) => name.startsWith("sb-fixture-auth-token"))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!parts.length) return null;
    const value = parts.map((part) => part.value).join("");
    const session = JSON.parse(Buffer.from(value.slice("base64-".length), "base64url").toString("utf8"));
    return actorForToken(session.access_token);
  };
  const privateHeaders = { "cache-control": "private, no-store, max-age=0", "cdn-cache-control": "no-store",
    "vercel-cdn-cache-control": "no-store", "x-vercel-cache": "MISS" };
  const fakeFetch = async (input, init) => {
    const url = new URL(input);
    const h = new Headers(init.headers);
    const method = init.method || "GET";
    const token = (h.get("authorization") || "").replace(/^Bearer /, "");
    capturedHeaders.push({ origin: url.origin, bypass: h.get("x-vercel-protection-bypass") });
    assert.equal(init.redirect, "manual", "Credentials must never follow redirects");
    assert.ok(init.signal instanceof AbortSignal);
    if (url.origin === config.app) {
      assert.equal(h.get("x-vercel-protection-bypass"), config.bypass);
      if (url.pathname === "/_next/image") {
        assert.equal(h.has("cookie"), false);
        return new Response("not allowed", { status: 400 });
      }
      assert.equal(url.pathname, `/api/message-media/${attachmentId}`);
      assert.equal(url.search, "", "Do not defeat cache-retirement probes with cache-busting URLs");
      const actor = actorForCookie(h.get("cookie") || "");
      appRequests.push({ actor, cookie: h.get("cookie"), method, range: h.get("range"), conditional: h.get("if-none-match") });
      if (redirect) return new Response(null, { status: 307, headers: { location: "https://other.example.invalid/" } });
      const allowed = ["buyer", "seller"].includes(actor) || (actor === "moderator" &&
        (records.moderator.app_metadata.role === "moderator" || staleAccess));
      const isRange = allowed && h.get("range") === "bytes=0-0";
      const status = allowed ? isRange ? 206 : 200 : actor ? 404 : 401;
      return new Response(method === "HEAD" ? null : allowed ? isRange ? bytes.subarray(0, 1) : bytes : JSON.stringify({ error: "not available" }),
        { status, headers: { ...privateHeaders, "content-type": allowed ? "image/png" : "application/json",
          ...(isRange ? { "content-range": `bytes 0-0/${bytes.length}` } : {}),
          // Deliberately attempt cookie replacement: the verifier must ignore it.
          "set-cookie": "sb-fixture-auth-token=replacement-must-not-be-used; Path=/" } });
    }
    assert.equal(url.origin, config.database);
    assert.equal(h.has("x-vercel-protection-bypass"), false);
    if (url.pathname.startsWith("/auth/v1/admin/users/")) {
      assert.equal(token, config.serviceKey);
      const actor = Object.keys(records).find((name) => url.pathname.endsWith(records[name].id));
      assert.ok(actor);
      if (method === "PUT") {
        assert.equal(actor, "moderator", "Only this exact fixture can be changed");
        const body = JSON.parse(init.body);
        assert.deepEqual(Object.keys(body), ["app_metadata"]);
        if (restorationFailure && body.app_metadata.role === null) return json({ msg: "restore unavailable" }, 503);
        for (const [key, value] of Object.entries(body.app_metadata)) {
          if (value === null) delete records[actor].app_metadata[key]; else records[actor].app_metadata[key] = value;
        }
        metadataWrites.push(structuredClone(body.app_metadata));
      }
      return json(records[actor]);
    }
    if (url.pathname === "/auth/v1/token") {
      assert.equal(method, "POST");
      assert.equal(url.searchParams.get("grant_type"), "password", "No refresh-token exchanges are allowed");
      const body = JSON.parse(init.body);
      const actor = Object.keys(manifest.users).find((name) => manifest.users[name].email === body.email);
      assert.equal(body.password, manifest.users[actor].password);
      logins.push(actor);
      const payload = { sub: records[actor].id, exp: Math.floor(Date.now() / 1000) + 3600, app_metadata: records[actor].app_metadata };
      const jwt = [Buffer.from('{"alg":"HS256"}').toString("base64url"), Buffer.from(JSON.stringify(payload)).toString("base64url"), "localtestsignature"].join(".");
      tokens.set(jwt, actor);
      return json({ access_token: jwt, refresh_token: `local-refresh-${actor}`, token_type: "bearer", expires_in: 3600, user: records[actor] });
    }
    if (url.pathname === "/auth/v1/user") {
      assert.equal(h.get("apikey"), config.anonKey, "Session liveness must use the ordinary client");
      const actor = actorForToken(token);
      assert.ok(actor);
      if (inactiveAfterDemotion && actor === "moderator" && records.moderator.app_metadata.role !== "moderator") return json({ msg: "session ended" }, 401);
      return json(records[actor]);
    }
    if (url.pathname === "/rest/v1/conversations") return json({ id: manifest.fixture.conversationId, buyer_id: records.buyer.id, seller_id: records.seller.id });
    if (url.pathname === "/rest/v1/messages") return json([{ id: randomUUID(), body: nonFixtureMessage ? "Unrelated content" : `[authority-${manifest.runId}] Synthetic image` }]);
    if (url.pathname === "/rest/v1/message_attachments") return json({ id: attachmentId, conversation_id: manifest.fixture.conversationId,
      storage_path: manifest.fixture.mediaPath, uploader_id: records.buyer.id });
    if (url.pathname === "/rest/v1/rpc/resolve_message_media_attachment") return json([{ storage_path: physicalMediaPath,
      mime_type: "image/png", size_bytes: bytes.length }]);
    if (url.pathname.startsWith("/storage/v1/object/")) {
      assert.ok(url.pathname.endsWith(`/message-media/${physicalMediaPath}`), "Probe the existing resolved physical object, not the retired logical upload key");
      if (token === config.serviceKey) return new Response(bytes, { headers: { "content-type": "image/png" } });
      assert.ok(!token || actorForToken(token));
      return json({ error: "not authorized" }, 403);
    }
    assert.fail("Unexpected synthetic HTTP request");
  };
  const fixtureErrors = [];
  const report = await verifyPrivateMedia(config, manifest, {
    fetchImpl: async (...args) => { try { return await fakeFetch(...args); } catch (error) { fixtureErrors.push(error); throw error; } },
    saveRestore: async (value) => { snapshot = structuredClone(value); },
    clearRestore: async () => { cleared = true; },
  });
  assert.deepEqual(fixtureErrors, [], "HTTP fixture mistakes must not be hidden by provider error handling");
  return { report, original, records, logins, appRequests, capturedHeaders, metadataWrites, snapshot, cleared, tokens };
}

test("complete protocol reuses actual SDK cookies across demotion, ignores Set-Cookie, and restores exact metadata", async () => {
  const r = await simulatedHostedRun();
  assert.equal(r.report.result, "PASS", JSON.stringify(r.report));
  assert.equal(r.report.checks.length, 35);
  assert.deepEqual(r.logins.sort(), ["buyer", "moderator", "seller", "staff"]);
  const mod = r.appRequests.filter(({ actor }) => actor === "moderator");
  assert.equal(new Set(mod.map(({ cookie }) => cookie)).size, 1);
  assert.ok(mod.some(({ method }) => method === "HEAD"));
  assert.ok(mod.some(({ range, conditional }) => range && conditional));
  assert.deepEqual(r.records.moderator.app_metadata, r.original);
  assert.deepEqual(r.snapshot.originalAppMetadata, r.original);
  assert.equal(r.cleared, true);
  assert.equal(r.report.metadataRestored, true);
  const receipt = JSON.stringify(r.report);
  for (const token of r.tokens.keys()) assert.ok(!receipt.includes(token));
  assert.ok(!receipt.includes("local-refresh") && !receipt.includes("local-bypass") && !receipt.includes("Synthetic-local-only-password"));
});

test("a stale-cookie media exposure fails the gate and still restores the original role", async () => {
  const r = await simulatedHostedRun({ staleAccess: true });
  assert.equal(r.report.result, "FAIL");
  assert.equal(r.report.error, "GATEWAY_demoted_same_cookie_get_STATUS");
  assert.deepEqual(r.records.moderator.app_metadata, r.original);
  assert.equal(r.cleared, true);
});

test("an inactive demoted session cannot serve as evidence of authorization enforcement", async () => {
  const r = await simulatedHostedRun({ inactiveAfterDemotion: true });
  assert.equal(r.report.result, "FAIL");
  assert.equal(r.report.error, "FIXED_SESSION_NO_LONGER_ACTIVE");
  assert.equal(r.report.metadataRestored, true);
});

test("restoration failure keeps the private recovery record and prevents a passing receipt", async () => {
  const r = await simulatedHostedRun({ restorationFailure: true });
  assert.equal(r.report.result, "FAIL");
  assert.equal(r.report.metadataRestored, false);
  assert.equal(r.cleared, false);
  assert.ok(r.snapshot);
});

test("app redirects are rejected without following credentials and role restoration still runs", async () => {
  const r = await simulatedHostedRun({ redirect: true });
  assert.equal(r.report.result, "FAIL");
  assert.equal(r.report.error, "GATEWAY_buyer_warm_STATUS");
  assert.equal(r.report.metadataRestored, true);
});

test("mixed fixture content is rejected before any login, role write or private journal mutation", async () => {
  const r = await simulatedHostedRun({ nonFixtureMessage: true });
  assert.equal(r.report.error, "NON_FIXTURE_CONVERSATION_CONTENT");
  assert.deepEqual(r.logins, []);
  assert.deepEqual(r.metadataWrites, []);
  assert.equal(r.snapshot, undefined);
});
