#!/usr/bin/env node
// Opt-in hosted gate; importing this module performs no requests or env reads.
import { createHash } from "node:crypto";
import { readFile, realpath, stat, writeFile, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { createServerClient, serializeCookieHeader } from "@supabase/ssr";
import { isOwnedMessageMediaStoragePath } from "../src/lib/message-media-reservations.mjs";

export const MAX_BYTES = 10 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actors = ["buyer", "seller", "staff", "moderator"];
const productionHosts = new Set(["bmnfynufuqjwjmtlfdxf.supabase.co", "student-market-of-toronto.vercel.app"]);
class GateError extends Error {}
const ensure = (condition, code) => { if (!condition) throw new GateError(code); };
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function isolatedOrigin(value, database = false) {
  let url;
  try { url = new URL(value); } catch { throw new GateError("INVALID_TARGET_ORIGIN"); }
  ensure(url.origin === value && !productionHosts.has(url.hostname), "INVALID_OR_PRODUCTION_TARGET");
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  ensure((local && ["http:", "https:"].includes(url.protocol)) ||
    (url.protocol === "https:" && (!database || /^[a-z0-9]+\.supabase\.co$/.test(url.hostname))), "ISOLATED_HTTPS_OR_LOCAL_REQUIRED");
  return url;
}

export function validateConfiguration(env, manifest) {
  const database = isolatedOrigin(env.SMOT_STAGING_URL, true);
  const app = isolatedOrigin(env.SMOT_PRIVATE_MEDIA_APP_ORIGIN);
  ensure(app.origin !== database.origin, "APP_AND_DATABASE_TARGETS_MUST_DIFFER");
  const project = database.hostname.endsWith(".supabase.co") ? database.hostname.split(".")[0] : "local";
  ensure(env.SMOT_AUTHORITY_STAGING_ACK === `disposable:${project}` &&
    env.SMOT_PRIVATE_MEDIA_APP_ACK === `isolated:${app.origin}`, "EXACT_TARGET_ACK_REQUIRED");
  ensure(env.SMOT_STAGING_ANON_KEY && env.SMOT_STAGING_SERVICE_ROLE_KEY, "STAGING_KEYS_REQUIRED");
  ensure(!env.SMOT_PRIVATE_MEDIA_VERCEL_BYPASS || env.SMOT_PRIVATE_MEDIA_BYPASS_ORIGIN === app.origin, "BYPASS_ORIGIN_MISMATCH");
  ensure(!env.SMOT_PRIVATE_MEDIA_VERCEL_BYPASS || !/[\r\n]/.test(env.SMOT_PRIVATE_MEDIA_VERCEL_BYPASS), "INVALID_BYPASS_HEADER");
  ensure(manifest.version === 1 && manifest.project === project && manifest.url === database.origin && UUID.test(manifest.runId), "MANIFEST_TARGET_MISMATCH");
  ensure(isDeepStrictEqual(Object.keys(manifest.users || {}).sort(), [...actors].sort()), "EXACT_FOUR_FIXTURES_REQUIRED");
  const ids = new Set();
  for (const actor of actors) {
    const user = manifest.users[actor];
    ensure(UUID.test(user?.id) && user.email === `authority-${manifest.runId}-${actor}@mail.utoronto.ca` &&
      typeof user.password === "string" && user.password.length > 0 && !ids.has(user.id), "INVALID_OWNED_FIXTURE");
    ids.add(user.id);
  }
  ensure(UUID.test(manifest.fixture?.conversationId) &&
    [manifest.users.buyer.id, manifest.users.seller.id].some((id) => isOwnedMessageMediaStoragePath(manifest.fixture.mediaPath, id)) &&
    manifest.fixture.mediaPath.split("/")[0] === manifest.fixture.conversationId &&
    !/[?#\r\n]/.test(manifest.fixture.mediaPath), "INVALID_MEDIA_FIXTURE");
  return { database: database.origin, app: app.origin, project,
    anonKey: env.SMOT_STAGING_ANON_KEY, serviceKey: env.SMOT_STAGING_SERVICE_ROLE_KEY,
    bypass: env.SMOT_PRIVATE_MEDIA_VERCEL_BYPASS || "" };
}

export async function boundedBody(response, maximum = MAX_BYTES) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum) {
    await response.body?.cancel();
    throw new GateError("RESPONSE_EXCEEDS_LIMIT");
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      ensure(length <= maximum, "RESPONSE_EXCEEDS_LIMIT");
      chunks.push(value);
    }
    return Buffer.concat(chunks, length);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function metadataPatch(current, desired) {
  return Object.fromEntries([...new Set([...Object.keys(current), ...Object.keys(desired)])]
    .filter((key) => Object.hasOwn(current, key) !== Object.hasOwn(desired, key) || !isDeepStrictEqual(current[key], desired[key]))
    .map((key) => [key, Object.hasOwn(desired, key) ? desired[key] : null]));
}

export async function verifyPrivateMedia(config, manifest, {
  fetchImpl = fetch, saveRestore, clearRestore, stopSignal,
} = {}) {
  const report = { result: "FAIL", project: config.project, runId: manifest.runId,
    scope: "HTTP authorization with real SDK cookie serialization; no browser/device or delivered-email claim",
    checks: [], error: null, metadataRestored: null, fixedSessions: false };
  let originalMetadata;
  let roleTouched = false;
  let restoring = false;
  const runDeadline = AbortSignal.timeout(180_000);
  const transport = async (input, init = {}) => {
    const target = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    ensure([config.database, config.app].includes(target.origin), "UNEXPECTED_REQUEST_ORIGIN");
    const signals = [AbortSignal.timeout(20_000), init.signal];
    if (!restoring) signals.push(runDeadline, stopSignal);
    const headers = new Headers(init.headers);
    // SDK clients are restricted to the database. The bypass is added here only
    // for the exact app origin and never survives an HTTP redirect.
    if (target.origin === config.app && config.bypass) headers.set("x-vercel-protection-bypass", config.bypass);
    const response = await fetchImpl(input, { ...init, headers, redirect: "manual", signal: AbortSignal.any(signals.filter(Boolean)) });
    const bytes = await boundedBody(response);
    return new Response([204, 205, 304].includes(response.status) || init.method === "HEAD" ? null : bytes,
      { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  const databaseFetch = (input, init) => {
    const target = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    ensure(target.origin === config.database, "SDK_REQUEST_LEFT_DATABASE");
    return transport(input, init);
  };
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: databaseFetch } };
  const admin = createClient(config.database, config.serviceKey, options);
  const ordinaryAuth = createClient(config.database, config.anonKey, options);
  const dataOrFail = (result, code) => { ensure(!result.error && result.data, code); return result.data; };
  const readUser = async (actor) => {
    const { user } = dataOrFail(await admin.auth.admin.getUserById(manifest.users[actor].id), "FIXTURE_LOOKUP_FAILED");
    ensure(user?.id === manifest.users[actor].id && user.email === manifest.users[actor].email &&
      user.app_metadata?.fixture_run === manifest.runId, "FIXTURE_OWNERSHIP_MISMATCH");
    return user;
  };
  const setMetadata = async (desired) => {
    const current = (await readUser("moderator")).app_metadata;
    dataOrFail(await admin.auth.admin.updateUserById(manifest.users.moderator.id,
      { app_metadata: metadataPatch(current, desired) }), "FIXTURE_ROLE_WRITE_FAILED");
    ensure(isDeepStrictEqual((await readUser("moderator")).app_metadata, desired), "FIXTURE_ROLE_READBACK_MISMATCH");
  };
  const readOne = async (table, columns, key, value) => dataOrFail(
    await admin.from(table).select(columns).eq(key, value).single(), "FIXTURE_ROW_LOOKUP_FAILED");
  const request = async (origin, path, headers = {}, method = "GET", body) => {
    const response = await transport(new URL(path, origin), { method, headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { response, bytes: await boundedBody(response) };
  };
  const recordHeaders = (response) => {
    const h = response.headers;
    ensure(/(?:^|,)\s*no-store\s*(?:,|$)/i.test(h.get("cache-control") || ""), "PRIVATE_CACHE_CONTROL_MISSING");
    ensure(!h.has("etag") && !h.has("last-modified") && !h.has("location") && response.status !== 304, "PRIVATE_REUSABLE_VALIDATOR_OR_REDIRECT");
    for (const key of ["cdn-cache-control", "vercel-cdn-cache-control"]) {
      if (h.has(key)) ensure(/(?:^|,)\s*no-store\s*(?:,|$)/i.test(h.get(key)), "CDN_CACHE_CONTROL_UNSAFE");
    }
    ensure(!h.has("age") || Number(h.get("age")) === 0, "PRIVATE_RESPONSE_HAS_CACHE_AGE");
    for (const key of ["x-vercel-cache", "cf-cache-status"]) ensure(!/^(?:HIT|STALE|REVALIDATED|UPDATING)$/i.test(h.get(key) || ""), "PRIVATE_CDN_CACHE_HIT");
    return { noStore: true, etag: false, location: false,
      cdnNoStoreVisible: h.has("cdn-cache-control"), vercelCdnNoStoreVisible: h.has("vercel-cdn-cache-control"),
      cdnCacheStatus: /^(?:MISS|BYPASS|DYNAMIC|PRERENDER)$/i.test(h.get("x-vercel-cache") || h.get("cf-cache-status") || "")
        ? (h.get("x-vercel-cache") || h.get("cf-cache-status")).toUpperCase() : "not-visible-or-unrecognized" };
  };
  try {
    ensure(typeof saveRestore === "function" && typeof clearRestore === "function", "PRIVATE_RESTORE_JOURNAL_REQUIRED");
    for (const actor of actors) {
      const user = await readUser(actor);
      ensure(!user.app_metadata.force_name_change && (!user.banned_until || Date.parse(user.banned_until) < Date.now()), "FIXTURE_RESTRICTED");
      if (actor === "moderator") {
        originalMetadata = structuredClone(user.app_metadata);
        // Auth's merge API uses null to remove a key; do not start a role probe
        // that cannot restore a pre-existing explicit null value exactly.
        ensure(!["role", "roles"].some((key) => Object.hasOwn(originalMetadata, key) && originalMetadata[key] === null), "NULL_ROLE_METADATA_NOT_RESTORABLE");
      }
      if (actor === "staff") ensure(user.app_metadata.role === "staff" &&
        !(user.app_metadata.roles || []).some((role) => ["admin", "moderator"].includes(role)), "STAFF_FIXTURE_NOT_LIMITED");
      if (["buyer", "seller"].includes(actor)) ensure(!["admin", "moderator", "staff"].includes(user.app_metadata.role) &&
        !(user.app_metadata.roles || []).some((role) => ["admin", "moderator", "staff"].includes(role)), "PARTICIPANT_FIXTURE_NOT_ORDINARY");
    }
    const conversation = await readOne("conversations", "id,buyer_id,seller_id", "id", manifest.fixture.conversationId);
    ensure(conversation.buyer_id === manifest.users.buyer.id && conversation.seller_id === manifest.users.seller.id, "CONVERSATION_NOT_OWNED");
    const messages = dataOrFail(await admin.from("messages").select("id,body").eq("conversation_id", conversation.id), "MESSAGE_FIXTURE_LOOKUP_FAILED");
    ensure(messages.length > 0 && messages.every((message) => message.body?.startsWith(`[authority-${manifest.runId}]`)), "NON_FIXTURE_CONVERSATION_CONTENT");
    const attachment = await readOne("message_attachments", "id,conversation_id,storage_path,uploader_id", "storage_path", manifest.fixture.mediaPath);
    ensure(UUID.test(attachment.id) && attachment.conversation_id === conversation.id &&
      [conversation.buyer_id, conversation.seller_id].includes(attachment.uploader_id), "ATTACHMENT_NOT_OWNED");
    const locations = dataOrFail(await admin.rpc("resolve_message_media_attachment", { p_attachment_id: attachment.id }), "PRIVATE_RESOLVER_UNAVAILABLE");
    ensure(Array.isArray(locations) && locations.length === 1, "PRIVATE_RESOLVER_MISSING_OBJECT");
    const location = locations[0];
    ensure(isOwnedMessageMediaStoragePath(location.storage_path, attachment.uploader_id) &&
      location.storage_path.split("/")[0] === conversation.id &&
      /^image\/(?:jpeg|png|webp|gif|avif)$/.test(location.mime_type) && Number.isSafeInteger(Number(location.size_bytes)) &&
      Number(location.size_bytes) > 0 && Number(location.size_bytes) <= MAX_BYTES, "BOUNDED_IMAGE_FIXTURE_REQUIRED");
    const media = location.storage_path.split("/").map(encodeURIComponent).join("/");
    const serviceHeaders = { apikey: config.serviceKey, authorization: `Bearer ${config.serviceKey}` };
    const serviceObject = await request(config.database, `/storage/v1/object/authenticated/message-media/${media}`, serviceHeaders);
    ensure(serviceObject.response.status === 200 && serviceObject.bytes.length === Number(location.size_bytes), "SERVICE_OBJECT_POSITIVE_CONTROL_FAILED");
    const expectedHash = digest(serviceObject.bytes);
    report.imageBytes = serviceObject.bytes.length;
    report.imageSha256 = expectedHash;
    await saveRestore({ version: 1, project: config.project, runId: manifest.runId,
      userId: manifest.users.moderator.id, originalAppMetadata: originalMetadata });
    roleTouched = true; // An uncertain update still requires restoration.
    await setMetadata({ ...originalMetadata, role: "moderator", roles: [] });
    const sessions = {};
    for (const actor of actors) {
      const jar = new Map();
      const client = createServerClient(config.database, config.anonKey, {
        global: { fetch: databaseFetch },
        cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })),
          setAll: (values) => values.forEach(({ name, value }) => value ? jar.set(name, value) : jar.delete(name)) },
      });
      const { session, user } = dataOrFail(await client.auth.signInWithPassword({
        email: manifest.users[actor].email, password: manifest.users[actor].password,
      }), "FIXTURE_LOGIN_FAILED");
      ensure(user.id === manifest.users[actor].id && session?.access_token &&
        session.expires_at > Date.now() / 1000 + 240 && jar.size > 0, "FRESH_FIXED_SESSION_REQUIRED");
      const claims = JSON.parse(Buffer.from(session.access_token.split(".")[1], "base64url").toString("utf8"));
      ensure(claims.sub === user.id && claims.exp > Date.now() / 1000 + 240 &&
        (actor !== "moderator" || claims.app_metadata?.role === "moderator"), "EXPECTED_ISSUED_TOKEN_CLAIMS_MISSING");
      sessions[actor] = Object.freeze({ token: session.access_token,
        cookie: [...jar].map(([name, value]) => serializeCookieHeader(name, value).split(";")[0]).join("; ") });
    }
    const active = async (actor) => {
      const { user } = dataOrFail(await ordinaryAuth.auth.getUser(sessions[actor].token), "FIXED_SESSION_NO_LONGER_ACTIVE");
      ensure(user?.id === manifest.users[actor].id, "FIXED_SESSION_IDENTITY_MISMATCH");
    };
    const gatewayPath = `/api/message-media/${attachment.id}`;
    const gateway = async (actor, label, expectedStatus, method = "GET", headers = {}) => {
      const { response, bytes } = await request(config.app, gatewayPath,
        { ...(actor ? { cookie: sessions[actor].cookie } : {}), ...headers }, method);
      ensure(response.status === expectedStatus, `GATEWAY_${label}_STATUS`);
      const cache = recordHeaders(response);
      if (expectedStatus === 200 && method === "GET") ensure(digest(bytes) === expectedHash, `GATEWAY_${label}_BYTE_MISMATCH`);
      if (expectedStatus === 206) ensure(bytes.equals(serviceObject.bytes.subarray(0, 1)) &&
        response.headers.get("content-range") === `bytes 0-0/${serviceObject.bytes.length}`, "PARTICIPANT_RANGE_BYTES_MISMATCH");
      if (expectedStatus >= 400) ensure(digest(bytes) !== expectedHash && !/^image\//i.test(response.headers.get("content-type") || ""), "DENIAL_RETURNED_MEDIA");
      if (method === "HEAD") ensure(bytes.length === 0, "HEAD_RETURNED_BODY");
      report.checks.push({ check: label, status: response.status, ...cache });
    };
    const storageDenied = async (actor, phase) => {
      const headers = { apikey: config.anonKey, ...(actor ? { authorization: `Bearer ${sessions[actor].token}` } : {}) };
      for (const [kind, path, method, body] of [
        ["authenticated", `/storage/v1/object/authenticated/message-media/${media}`, "GET"],
        ["download", `/storage/v1/object/message-media/${media}`, "GET"],
        ["sign", `/storage/v1/object/sign/message-media/${media}`, "POST", { expiresIn: 60 }],
      ]) {
        const { response, bytes } = await request(config.database, path, { ...headers, "content-type": "application/json" }, method, body);
        ensure([400, 401, 403, 404].includes(response.status) && digest(bytes) !== expectedHash &&
          !/^image\//i.test(response.headers.get("content-type") || "") &&
          !(kind === "sign" && /"signed_?url"\s*:/i.test(bytes.toString("utf8"))), `DIRECT_STORAGE_${kind.toUpperCase()}_NOT_DENIED`);
        report.checks.push({ check: `${phase}_${actor || "anonymous"}_storage_${kind}_denied`, status: response.status });
      }
    };
    for (const actor of actors) await active(actor);
    for (const actor of ["buyer", "seller", "moderator"]) await gateway(actor, `${actor}_warm`, 200);
    await gateway("buyer", "participant_head", 200, "HEAD");
    await gateway("buyer", "participant_range", 206, "GET", { Range: "bytes=0-0" });
    await gateway("moderator", "moderator_same_url_repeated", 200);
    await gateway("staff", "staff_nonparticipant", 404);
    await gateway(null, "anonymous", 401);
    for (const actor of [...actors, null]) await storageDenied(actor, "before_demotion");
    await setMetadata({ ...originalMetadata, role: "student", roles: [] });
    await active("moderator");
    for (const [label, method, headers] of [
      ["get", "GET", {}], ["head", "HEAD", {}],
      ["range", "GET", { Range: "bytes=0-0" }], ["head_range", "HEAD", { Range: "bytes=0-0" }],
      ["conditional", "GET", { "If-None-Match": "*" }],
      ["conditional_range", "GET", { Range: "bytes=0-0", "If-None-Match": "*" }],
    ]) await gateway("moderator", `demoted_same_cookie_${label}`, 404, method, headers);
    await active("moderator");
    await storageDenied("moderator", "after_demotion");
    for (const actor of ["buyer", "seller"]) { await active(actor); await gateway(actor, `${actor}_continues`, 200); }
    const optimizer = await request(config.app, `/_next/image?url=${encodeURIComponent(gatewayPath)}&w=640&q=75`);
    ensure(optimizer.response.status === 400 && !optimizer.response.headers.has("location") &&
      !/^image\//i.test(optimizer.response.headers.get("content-type") || "") && digest(optimizer.bytes) !== expectedHash, "ANONYMOUS_PRIVATE_OPTIMIZER_NOT_REJECTED");
    report.checks.push({ check: "anonymous_private_optimizer", status: 400 });
    report.fixedSessions = true;
    report.result = "PASS";
  } catch (error) {
    report.error = error instanceof GateError ? error.message : "NETWORK_PROVIDER_OR_LOCAL_FAILURE";
  } finally {
    if (roleTouched) {
      restoring = true; // Fresh bounded requests, even after the probe deadline/interrupt.
      try {
        await setMetadata(originalMetadata);
        report.metadataRestored = true;
        await clearRestore();
      } catch {
        report.metadataRestored = false;
        report.result = "FAIL";
        report.restorationError = "EXACT_METADATA_RESTORATION_UNVERIFIED_KEEP_PRIVATE_JOURNAL";
      }
    }
  }
  report.notCovered = ["physical devices", "browser image/video rendering", "Realtime", "email recovery", "previously issued Storage URLs before their retirement"];
  return report;
}

async function main() {
  const [command, manifestPath, receiptPath] = process.argv.slice(2);
  ensure(command === "verify" && isAbsolute(manifestPath || "") && isAbsolute(receiptPath || ""), "USAGE_VERIFY_ABSOLUTE_PRIVATE_MANIFEST_AND_RECEIPT");
  const repository = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  const outputRelative = relative(repository, await realpath(dirname(receiptPath)));
  ensure(outputRelative === ".." || outputRelative.startsWith("../"), "RECEIPT_MUST_BE_OUTSIDE_REPOSITORY");
  const info = await stat(manifestPath);
  ensure(info.isFile() && (info.mode & 0o077) === 0 && info.size <= MAX_BYTES, "PRIVATE_MANIFEST_PERMISSIONS_REQUIRED");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const config = validateConfiguration(process.env, manifest);
  const privateRestorePath = receiptPath + ".restore-private.json";
  await writeFile(receiptPath, JSON.stringify({ result: "STARTED", project: config.project }) + "\n", { flag: "wx", mode: 0o600 });
  const stop = new AbortController();
  const interrupt = () => stop.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    const report = await verifyPrivateMedia(config, manifest, { stopSignal: stop.signal,
      saveRestore: (value) => writeFile(privateRestorePath, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 }),
      clearRestore: () => unlink(privateRestorePath),
    });
    await writeFile(receiptPath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify({ result: report.result, checks: report.checks.length,
      error: report.error, metadataRestored: report.metadataRestored }));
    if (report.result !== "PASS") process.exitCode = 1;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof GateError ? error.message : "LOCAL_CONFIGURATION_OR_PROVIDER_FAILURE");
    process.exitCode = 1;
  });
}
