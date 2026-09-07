import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { evaluatePhase, retainedTokenOptions, validateManifest, validateTarget } from "../scripts/verify-moderation-realtime-staging.mjs";

const script = new URL("../scripts/verify-moderation-realtime-staging.mjs", import.meta.url);
const userId = "10000000-0000-4000-8000-000000000001";
const conversationId = "20000000-0000-4000-8000-000000000001";
const messageId = "30000000-0000-4000-8000-000000000001";
const runId = "40000000-0000-4000-8000-000000000001";
const env = {
  SMOT_STAGING_URL: "https://disposablefixture.supabase.co",
  SMOT_AUTHORITY_STAGING_ACK: "disposable:disposablefixture",
  SMOT_STAGING_ANON_KEY: "unused-public-fixture-key",
  SMOT_STAGING_SERVICE_ROLE_KEY: "unused-private-fixture-key",
};
const target = validateTarget(["verify", "/unused/private-manifest.json"], env);
const manifest = () => ({
  version: 1, project: target.project, url: target.origin, runId,
  users: Object.fromEntries(["buyer", "seller", "staff", "moderator"].map((name, index) => [name, {
    id: `10000000-0000-4000-8000-00000000000${index + 1}`,
    email: `authority-${runId}-${name}@mail.utoronto.ca`, password: "synthetic-unused-password",
  }])),
  fixture: { conversationId, reportId: "50000000-0000-4000-8000-000000000001", mediaPath: `${conversationId}/${userId}/synthetic.png` },
});

// A subprocess-level tripwire proves invalid inputs never reach fetch or a socket,
// even if main's ordering is accidentally changed. All credentials are invented.
function preflight({ overrides = {}, edit, mode = 0o600, command = "verify" } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "smot-realtime-guards-"));
  try {
    const path = join(directory, "manifest.json");
    const fixture = manifest();
    edit?.(fixture);
    writeFileSync(path, JSON.stringify(fixture), { mode });
    chmodSync(path, mode);
    const preload = join(directory, "no-network.mjs");
    writeFileSync(preload, `const blocked = () => { console.error("UNEXPECTED_NETWORK_ATTEMPT"); throw new Error("offline test"); }; globalThis.fetch = blocked; globalThis.WebSocket = class { constructor() { blocked(); } };\n`);
    const result = spawnSync(process.execPath, ["--import", preload, script.pathname, command, path], {
      encoding: "utf8", timeout: 5000, env: { ...env, ...overrides },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /UNEXPECTED_NETWORK_ATTEMPT|synthetic-unused-password|unused-private-fixture-key/);
    return JSON.parse(result.stderr.trim()).code;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test("Realtime gate refuses production even with matching acknowledgement, without network", () => {
  assert.equal(preflight({ overrides: { SMOT_STAGING_URL: "https://bmnfynufuqjwjmtlfdxf.supabase.co", SMOT_AUTHORITY_STAGING_ACK: "disposable:bmnfynufuqjwjmtlfdxf" } }), "production_project_forbidden");
});

test("Realtime gate requires acknowledgement for the exact isolated origin", () => {
  for (const ack of ["", "disposable:differentproject"]) {
    assert.equal(preflight({ overrides: { SMOT_AUTHORITY_STAGING_ACK: ack } }), "target_ack_required");
  }
});

test("Realtime gate rejects arbitrary destinations, credentials, paths, queries, and provision mode offline", () => {
  for (const url of ["https://example.com", "https://example.supabase.co.evil.test", "http://disposablefixture.supabase.co", "https://disposablefixture.supabase.co:8443"]) {
    assert.equal(preflight({ overrides: { SMOT_STAGING_URL: url } }), "isolated_supabase_target_required");
  }
  for (const suffix of ["/rest/v1", "/?key=synthetic", "/#synthetic"]) {
    assert.equal(preflight({ overrides: { SMOT_STAGING_URL: env.SMOT_STAGING_URL + suffix } }), "bare_target_origin_required");
  }
  assert.equal(preflight({ overrides: { SMOT_STAGING_URL: "https://user:synthetic@disposablefixture.supabase.co" } }), "bare_target_origin_required");
  assert.equal(preflight({ command: "provision" }), "usage_verify_absolute_manifest");
});

test("Realtime gate requires a private manifest and complete, distinct, synthetic account IDs offline", () => {
  assert.equal(preflight({ mode: 0o644 }), "private_regular_manifest_required");
  assert.equal(preflight({ edit: (value) => { value.project = "other"; } }), "manifest_target_mismatch");
  assert.equal(preflight({ edit: (value) => { value.users.staff.id = value.users.buyer.id; } }), "distinct_fixture_ids_required");
  assert.equal(preflight({ edit: (value) => { value.users.staff.email = "real-user@example.com"; } }), "fixture_identity_invalid");
  assert.equal(preflight({ edit: (value) => { value.users.extra = value.users.buyer; } }), "exact_four_fixture_accounts_required");
  assert.equal(preflight({ edit: (value) => { value.fixture.reportId = ""; } }), "complete_fixture_ids_required");
  assert.equal(preflight({ edit: (value) => { value.fixture.mediaPath = "../foreign.png"; } }), "fixture_media_path_invalid");
});

test("Realtime guard accepts the existing authority manifest shape and explicit local stacks", () => {
  assert.equal(validateManifest(manifest(), target).runId, runId);
  assert.equal(validateTarget(["verify", "/private/fixture.json"], {
    ...env, SMOT_STAGING_URL: "http://127.0.0.1:54321", SMOT_AUTHORITY_STAGING_ACK: "disposable:local",
  }).origin, "http://127.0.0.1:54321");
});

const expectation = (canRead) => ({ userId, conversationId, messageId, signalVersion: "7", canRead });
function receipts({ messages = true, reactions = true, version = 7 } = {}) {
  return ["scoped", "broad"].flatMap((stream) => [
    { stream, table: "notification_realtime_signals", type: "UPDATE", row: { recipient_user_id: userId, version, change_kind: "update", emitted_at: "2026-09-07T00:00:00Z" } },
    ...(messages ? [{ stream, table: "messages", type: "INSERT", row: { id: messageId, conversation_id: conversationId } }] : []),
    ...(reactions ? [
      { stream, table: "message_reactions", type: "INSERT", row: { message_id: messageId, conversation_id: conversationId, removed_at: null } },
      { stream, table: "message_reactions", type: "UPDATE", row: { message_id: messageId, conversation_id: conversationId, removed_at: "2026-09-07T00:00:01Z" } },
    ] : []),
  ]);
}

test("Realtime oracle requires message, reaction INSERT/UPDATE, and own signals on both streams", () => {
  assert.equal(evaluatePhase(receipts(), expectation(true)).ready, true);
  for (const events of [[], receipts({ messages: false }), receipts({ reactions: false }), receipts({ version: 6 }), receipts().filter((event) => event.stream === "scoped")]) {
    assert.equal(evaluatePhase(events, expectation(true)).ready, false);
  }
});

test("Realtime denial requires fresh own-signal positives and rejects any forbidden fixture event", () => {
  const signals = receipts({ messages: false, reactions: false });
  assert.equal(evaluatePhase(signals, expectation(false)).ready, true);
  assert.equal(evaluatePhase([], expectation(false)).ready, false);
  for (const leaked of receipts().filter((event) => event.table !== "notification_realtime_signals")) {
    assert.throws(() => evaluatePhase([...signals, leaked], expectation(false)), /forbidden_conversation_event_delivered/);
  }
});

test("Realtime oracle rejects notifications publication and foreign-recipient raw/filter payloads", () => {
  for (const type of ["INSERT", "UPDATE", "DELETE"]) {
    assert.throws(() => evaluatePhase([...receipts(), { stream: "broad", table: "notifications", type, row: { id: messageId } }], expectation(true)), /unexpected_published_table_event/);
  }
  for (const stream of ["broad", "foreign-filter"]) {
    const event = { ...receipts()[0], stream, row: { ...receipts()[0].row, recipient_user_id: "10000000-0000-4000-8000-000000000002" } };
    assert.throws(() => evaluatePhase([event], expectation(true)), /foreign_recipient_signal_delivered/);
  }
  const event = { ...receipts()[0], row: { ...receipts()[0].row, metadata: { title: "must never be streamed" } } };
  assert.throws(() => evaluatePhase([event], expectation(true)), /signal_contains_unexpected_fields/);
});

test("Realtime observer token callback retains the original bytes across repeated reconnect lookups", async () => {
  let callerToken = "original-synthetic-jwt";
  const options = retainedTokenOptions(callerToken, () => { throw new Error("Network forbidden"); });
  callerToken = "new-claims-after-demotion";
  for (let attempt = 0; attempt < 3; attempt += 1) assert.equal(await options.accessToken(), "original-synthetic-jwt");
  assert.notEqual(await options.accessToken(), callerToken);
  assert.deepEqual(options.auth, { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
});
