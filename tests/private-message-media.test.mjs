import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as media from "../src/lib/private-message-media.mjs";
import * as reservations from "../src/lib/message-media-reservations.mjs";

const attachmentId = randomUUID();
const uploaderId = randomUUID();
const conversationId = randomUUID();
const originalPath = `${conversationId}/${uploaderId}/original.png`;
const physicalPath = `${conversationId}/${uploaderId}/relocated.png`;
const payload = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);

async function loadRoute(t) {
  const fixture = {
    authenticated: true, allowed: true, lookupError: null, resolvedError: null,
    reads: 0, resolutions: 0, downloads: 0, configured: true,
    location: { storage_path: physicalPath, mime_type: "image/png", size_bytes: payload.length,
      file_name: 'photo\r\n".png' },
    upstream: () => new Response(payload),
  };
  const dependencies = {
    "next/headers": { cookies: async () => ({}) },
    "@/lib/message-media-reservations.mjs": reservations,
    "@/lib/messages": await import("data:text/javascript;base64," + Buffer.from(
      await readFile(new URL("../src/lib/messages.js", import.meta.url), "utf8"),
    ).toString("base64")),
    "@/lib/private-message-media.mjs": media,
    "@/utils/supabase/server": { createClient: () => ({
      auth: { getUser: async () => ({ data: { user: fixture.authenticated ? { id: randomUUID() } : null } }) },
      from(table) {
        assert.equal(table, "message_attachments");
        return { select: () => ({ eq(column, id) {
          assert.equal(column, "id"); assert.equal(id, attachmentId);
          return { maybeSingle: async () => {
            fixture.reads++;
            return { data: fixture.allowed ? { id, uploader_id: uploaderId, storage_path: originalPath } : null,
              error: fixture.lookupError };
          } };
        } }) };
      },
    }) },
    "@/lib/supabase-admin": { createAdminClient: () => fixture.configured ? {
      rpc: async (name, args) => {
        assert.equal(name, "resolve_message_media_attachment");
        assert.deepEqual(args, { p_attachment_id: attachmentId });
        fixture.resolutions++;
        return { data: [fixture.location], error: fixture.resolvedError };
      },
    } : null },
  };
  const binding = `privateMedia_${randomUUID().replaceAll("-", "")}`;
  globalThis[binding] = dependencies;
  let source = await readFile(new URL("../src/app/api/message-media/[attachmentId]/route.js", import.meta.url), "utf8");
  for (const [specifier, exports] of Object.entries(dependencies)) {
    const shim = Object.keys(exports).map((key) =>
      `export const ${key} = globalThis[${JSON.stringify(binding)}][${JSON.stringify(specifier)}][${JSON.stringify(key)}];`,
    ).join("\n");
    assert.ok(source.includes(JSON.stringify(specifier)), `Missing import: ${specifier}`);
    source = source.replace(JSON.stringify(specifier), JSON.stringify("data:text/javascript;base64," + Buffer.from(shim).toString("base64")));
  }
  const priorFetch = globalThis.fetch;
  const envKeys = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const priorEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fixture.supabase.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-service-key";
  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://fixture.supabase.invalid");
    assert.equal(url.pathname, `/storage/v1/object/authenticated/message-media/${physicalPath}`);
    assert.equal(url.search, "");
    assert.equal(init.headers.Authorization, "Bearer fixture-service-key");
    assert.equal(init.headers.apikey, "fixture-service-key");
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
    assert.equal(new Headers(init.headers).get("range"), null);
    assert.equal(new Headers(init.headers).get("if-none-match"), null);
    fixture.downloads++;
    return fixture.upstream();
  };
  t.after(() => {
    globalThis.fetch = priorFetch;
    delete globalThis[binding];
    for (const key of envKeys) {
      if (priorEnv[key] === undefined) delete process.env[key];
      else process.env[key] = priorEnv[key];
    }
  });
  const route = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
  fixture.request = async (method = "GET", headers = {}, id = attachmentId) => {
    const response = await route[method](new Request(`https://market.invalid/api/message-media/${id}`, { method, headers }),
      { params: Promise.resolve({ attachmentId: id }) });
    for (const [name, value] of Object.entries(media.PRIVATE_MESSAGE_MEDIA_HEADERS)) {
      assert.equal(response.headers.get(name), value, `${name} on ${response.status}`);
    }
    assert.equal(response.headers.get("etag"), null);
    assert.equal(response.headers.get("last-modified"), null);
    assert.equal(response.headers.get("location"), null);
    return response;
  };
  return fixture;
}

test("private media rechecks authorization on exact URL replay, HEAD and ranges", async (t) => {
  const f = await loadRoute(t);
  const first = await f.request();
  assert.equal(first.status, 200);
  assert.deepEqual(new Uint8Array(await first.arrayBuffer()), payload);
  assert.equal(first.headers.get("content-type"), "image/png");
  assert.match(first.headers.get("content-disposition"), /^inline; filename="[a-zA-Z0-9._-]+"$/);
  f.allowed = false; // Models committed RLS denial with an otherwise valid retained session.
  for (const [method, headers] of [["GET", {}], ["HEAD", {}], ["GET", { range: "bytes=0-3" }],
    ["GET", { "if-none-match": '"previous-cache-tag"' }]]) {
    const denied = await f.request(method, headers);
    assert.equal(denied.status, 404);
    assert.doesNotMatch(await denied.text(), /relocated|original|fixture-service/);
  }
  assert.equal(f.reads, 5);
  assert.equal(f.resolutions, 1);
  assert.equal(f.downloads, 1);
  f.allowed = true; // Legitimate viewer continues to use the identical URL.
  assert.equal((await f.request()).status, 200);
});

test("private video ranges, suffixes, HEAD and conditional requests retain usable semantics", async (t) => {
  const f = await loadRoute(t);
  f.location.mime_type = "video/mp4";
  for (const [range, expected, contentRange] of [
    ["bytes=2-4", [2, 3, 4], "bytes 2-4/8"],
    ["bytes=5-", [5, 6, 7], "bytes 5-7/8"],
    ["bytes=-2", [6, 7], "bytes 6-7/8"],
    ["bytes=6-999", [6, 7], "bytes 6-7/8"],
  ]) {
    const response = await f.request("GET", { range });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), contentRange);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], expected);
  }
  const count = f.downloads;
  const head = await f.request("HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "8");
  assert.equal(await head.text(), "");
  assert.equal(f.downloads, count);
  const conditional = await f.request("GET", { "if-none-match": "*", "if-modified-since": new Date().toUTCString(),
    range: "bytes=2-4", "if-range": '"stale"' });
  assert.equal(conditional.status, 200);
  assert.deepEqual(new Uint8Array(await conditional.arrayBuffer()), payload);
  for (const range of ["bytes=8-", "bytes=-0", "bytes=4-2", "bytes=0-1,4-5", "bytes=", "bytes=9007199254740992-"]) {
    const response = await f.request("GET", { range });
    assert.equal(response.status, 416, range);
    assert.equal(response.headers.get("content-range"), "bytes */8");
  }
});

test("private media fails closed before privileged fetch for missing auth, invalid IDs and RLS outages", async (t) => {
  const f = await loadRoute(t);
  f.authenticated = false;
  assert.equal((await f.request()).status, 401);
  assert.equal((await f.request("HEAD")).status, 401);
  f.authenticated = true;
  for (const id of ["../secret", "signed-token", `${attachmentId}/other`, "%2e%2e"]) {
    assert.equal((await f.request("GET", {}, id)).status, 404);
  }
  f.lookupError = { code: "unavailable" };
  assert.equal((await f.request()).status, 503);
  assert.equal(f.resolutions, 0);
  assert.equal(f.downloads, 0);
});

test("private media rejects unsafe locations and unbounded or incomplete upstream data", async (t) => {
  const f = await loadRoute(t);
  for (const patch of [{ storage_path: `other/${uploaderId}/image` },
    { storage_path: `${conversationId}/${randomUUID()}/image` },
    { storage_path: `${conversationId}/${uploaderId}/%2e%2e` },
    { mime_type: "image/svg+xml" }, { size_bytes: 10 * 1024 * 1024 + 1 }, { size_bytes: 0 }]) {
    const original = { ...f.location };
    Object.assign(f.location, patch);
    assert.equal((await f.request()).status, 502);
    f.location = original;
  }
  assert.equal(f.downloads, 0);
  for (const body of [new Uint8Array(9), new Uint8Array(7)]) {
    f.upstream = () => new Response(body);
    assert.equal((await f.request()).status, 503);
  }
  f.upstream = () => new Response(null, { status: 304 });
  assert.equal((await f.request()).status, 502);
  f.resolvedError = { message: "fixture" };
  assert.equal((await f.request()).status, 503);
  f.resolvedError = null;
  f.configured = false;
  assert.equal((await f.request()).status, 503);
});

test("optimizer rejects private local routes and legacy signed aliases while retaining public assets", async () => {
  const { default: nextConfig } = await import("../next.config.mjs");
  const { hasLocalMatch } = await import("next/dist/shared/lib/match-local-pattern.js");
  const { hasRemoteMatch } = await import("next/dist/shared/lib/match-remote-pattern.js");
  const patterns = nextConfig.images;
  const hostname = patterns.remotePatterns[0].hostname;
  for (const src of [`/api/message-media/${attachmentId}`, `/api/message-media/${attachmentId}?w=640`,
    `/api/message-media/%31${attachmentId.slice(1)}`]) {
    assert.equal(hasLocalMatch(patterns.localPatterns, src), false);
  }
  for (const kind of ["sign", "authenticated"]) {
    assert.equal(hasRemoteMatch([], patterns.remotePatterns,
      new URL(`https://${hostname}/storage/v1/object/${kind}/message-media/${originalPath}?token=old`)), false);
  }
  assert.equal(hasLocalMatch(patterns.localPatterns, "/SMT_logo.png"), true);
  assert.equal(hasRemoteMatch([], patterns.remotePatterns,
    new URL(`https://${hostname}/storage/v1/object/public/listing-images/example.png`)), true);
  const displayed = media.withPrivateMessageMediaUrl({ id: attachmentId, storage_path: originalPath });
  assert.equal(displayed.signedUrl, `/api/message-media/${attachmentId}`);
  assert.equal(displayed.requiresAuthentication, true);
  assert.equal(media.withPrivateMessageMediaUrl({ id: `${attachmentId}-0` }).signedUrl, null);
});
