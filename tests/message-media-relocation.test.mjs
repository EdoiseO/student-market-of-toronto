import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { UPLOAD_OPTIONS, assertNoStore, assertPrivateOutsideGit, assertTargetMetadata, boundedBytes, planDigest, relocateOne, validateInventory, validatePlan, validateTarget } from "../scripts/relocate-message-media.mjs";

const id = "10000000-0000-4000-8000-000000000001";
const directory = "20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/";
const sourcePath = directory + "original.png";
const targetPath = directory + "40000000-0000-4000-8000-000000000001";
const bytes = Buffer.from("synthetic exact image bytes");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const item = { attachmentId: id, sourcePath, sizeBytes: bytes.length, mimeType: "image/png", sha256 };
const content = () => ({ bytes, mimeType: item.mimeType, cacheControl: "private, no-store, max-age=0", cacheStatus: "BYPASS" });
const metadata = () => ({ id, name: targetPath, bucketId: "message-media", size: item.sizeBytes, contentType: item.mimeType, cacheControl: "private, no-store, max-age=0" });
const env = { SMOT_MEDIA_URL: "https://disposablefixture.supabase.co", SMOT_MEDIA_TARGET_ACK: "disposable:disposablefixture", SMOT_MEDIA_SERVICE_ROLE_KEY: "unused-private-fixture-key" };
const target = validateTarget(["plan", "/unused/inventory.json", "/unused/ledger.json"], env);
const inventory = { version: 1, project: target.project, url: target.origin, attachmentIds: [id] };

function simulation({ state = "prepared", targetContent = null, sourceContent = content(), targetMetadata = metadata(), failAt } = {}) {
  const calls = [];
  let physical = state === "prepared" ? sourcePath : targetPath;
  const driver = {
    async describe() { calls.push("describe"); },
    async begin() { calls.push("begin"); return { attachment_id: id, source_path: sourcePath, target_path: targetPath, mime_type: item.mimeType, size_bytes: item.sizeBytes, state }; },
    async download(path) { calls.push(path === targetPath ? "read-target" : "read-source"); return path === targetPath ? targetContent : sourceContent; },
    async info(path) { calls.push("info"); assert.equal(path, targetPath); if (failAt === "info") throw new Error("metadata unavailable"); return targetMetadata; },
    async upload(path, buffer, mimeType) {
      calls.push("upload"); assert.equal(path, targetPath); assert.ok(buffer instanceof ArrayBuffer);
      assert.deepEqual(Buffer.from(buffer), bytes); assert.equal(mimeType, item.mimeType);
      targetContent = content();
      if (failAt === "upload") throw new Error("uncertain upload");
    },
    async verify(attachmentId, sourceHash, targetHash) {
      calls.push("verify"); assert.equal(attachmentId, id); assert.equal(sourceHash, sha256); assert.equal(targetHash, sha256);
      if (failAt === "verify") throw new Error("activation rejected");
      physical = targetPath; state = state === "retired" ? "retired" : "active"; return state;
    },
    async resolve() { calls.push("resolve"); return { storage_path: physical, mime_type: item.mimeType, size_bytes: item.sizeBytes }; },
    async removeSource(path) {
      calls.push("remove-source"); assert.equal(path, sourcePath); assert.equal(physical, targetPath);
      sourceContent = null;
      if (failAt === "remove") throw new Error("uncertain removal");
    },
    async finish(attachmentId) { calls.push("finish"); assert.equal(attachmentId, id); assert.equal(sourceContent, null); state = "retired"; return state; },
  };
  return { calls, driver, clearFailure: () => { failAt = undefined; } };
}

test("relocation uploads exact ArrayBuffer, verifies and activates before deleting only the source", async () => {
  const { driver, calls } = simulation();
  const progress = {};
  const snapshots = [];
  await relocateOne(item, progress, driver, () => snapshots.push({ ...progress }));
  assert.equal(progress.state, "retired");
  assert.ok(calls.indexOf("verify") < calls.indexOf("remove-source"));
  assert.ok(calls.indexOf("info") < calls.indexOf("verify"));
  assert.ok(calls.indexOf("resolve") < calls.indexOf("remove-source"));
  assert.equal(calls.filter((call) => call === "upload").length, 1);
  assert.equal(snapshots[0].targetPath, targetPath);
  assert.ok(snapshots.some((snapshot) => snapshot.uploadAttemptedAt));
  assert.ok(snapshots.some((snapshot) => snapshot.sourceDeleteAttemptedAt));
  assert.deepEqual(UPLOAD_OPTIONS, { upsert: false, cacheControl: "0", headers: { "Cache-Control": "private, no-store, max-age=0" } });
});

test("relocation resumes an uncertain upload without uploading or overwriting a valid existing target", async () => {
  const simulationRun = simulation({ failAt: "upload" });
  const progress = {};
  await assert.rejects(relocateOne(item, progress, simulationRun.driver, () => {}), /uncertain upload/);
  assert.equal(simulationRun.calls.includes("remove-source"), false);
  simulationRun.clearFailure();
  await relocateOne(item, progress, simulationRun.driver, () => {});
  assert.equal(simulationRun.calls.filter((call) => call === "upload").length, 1);
  assert.equal(progress.state, "retired");
});

test("relocation resumes activation after source removal and permits an idempotent retired rerun", async () => {
  for (const state of ["active", "retired"]) {
    const { driver, calls } = simulation({ state, sourceContent: null, targetContent: content() });
    const progress = { targetPath };
    await relocateOne(item, progress, driver, () => {});
    assert.equal(progress.state, "retired");
    assert.equal(calls.includes("upload"), false);
    assert.equal(calls.includes("remove-source"), false);
    assert.ok(calls.includes("verify") && calls.includes("finish"));
  }
  const simulationRun = simulation({ failAt: "remove" });
  const progress = {};
  await assert.rejects(relocateOne(item, progress, simulationRun.driver, () => {}), /uncertain removal/);
  simulationRun.clearFailure();
  await relocateOne(item, progress, simulationRun.driver, () => {});
  assert.equal(simulationRun.calls.filter((call) => call === "remove-source").length, 1);
  assert.equal(progress.state, "retired");
});

test("wrong bytes, unsafe stored metadata, metadata outage and activation failure preserve the source", async () => {
  const wrong = { ...content(), bytes: Buffer.from("different bytes") };
  for (const options of [
    { sourceContent: wrong }, { targetContent: wrong },
    { targetMetadata: { ...metadata(), cacheControl: "public, max-age=3600" } },
    { targetMetadata: { ...metadata(), cacheControl: "public, private, no-store, max-age=0" } },
    { targetMetadata: { ...metadata(), name: sourcePath } },
    { targetMetadata: { ...metadata(), size: item.sizeBytes + 1 } },
    { targetMetadata: { ...metadata(), contentType: "video/mp4" } },
    { failAt: "info" }, { failAt: "verify" },
  ]) {
    const { driver, calls } = simulation(options);
    await assert.rejects(relocateOne(item, {}, driver, () => {}));
    assert.equal(calls.includes("remove-source"), false);
    if (options.targetContent) assert.equal(calls.includes("upload"), false);
  }
});

test("provider cache headers and HIT are recorded separately from verified persisted no-store metadata", async () => {
  const targetContent = { ...content(), cacheControl: "public, private, no-store, max-age=0", cacheStatus: "HIT" };
  const { driver, calls } = simulation({ targetContent });
  const progress = {};
  const snapshots = [];
  await relocateOne(item, progress, driver, () => snapshots.push(structuredClone(progress)));
  assert.equal(progress.state, "retired");
  assert.equal(calls.includes("upload"), false, "Reuse the exact previously prepared target");
  assert.equal(progress.targetStorage.metadataCacheControl, "private, no-store, max-age=0");
  assert.equal(progress.targetStorage.responseCacheControl, targetContent.cacheControl);
  assert.equal(progress.targetStorage.responseCacheStatus, "HIT");
  assert.equal(progress.targetStorage.persistedMetadataVerified, true);
  assert.ok(snapshots.some((snapshot) => snapshot.targetStorage?.persistedMetadataVerified === false));
  assert.ok(calls.indexOf("info") < calls.indexOf("verify") && calls.indexOf("verify") < calls.indexOf("remove-source"));
  for (const changed of [{ bucketId: "public-bucket" }, { id: "missing" }, { cacheControl: null }]) {
    assert.throws(() => assertTargetMetadata({ ...metadata(), ...changed }, item, targetPath));
  }
});

test("changed target and mismatched active mapping cannot trigger source deletion", async () => {
  const first = simulation();
  await assert.rejects(relocateOne(item, { targetPath: directory + "50000000-0000-4000-8000-000000000001" }, first.driver, () => {}), /relocation_target_changed/);
  assert.equal(first.calls.includes("upload"), false);
  const second = simulation();
  second.driver.resolve = async () => ({ storage_path: sourcePath, mime_type: item.mimeType, size_bytes: item.sizeBytes });
  await assert.rejects(relocateOne(item, {}, second.driver, () => {}), /active_mapping_mismatch/);
  assert.equal(second.calls.includes("remove-source"), false);
});

test("body reads reject oversized Content-Length and chunked streams", async () => {
  await assert.rejects(boundedBytes(new Response("oversize", { headers: { "content-length": "800" } }), 4), /response_exceeds_size_bound/);
  await assert.rejects(boundedBytes(new Response("oversize"), 4), /response_exceeds_size_bound/);
  assert.deepEqual(await boundedBytes(new Response(bytes), bytes.length), bytes);
  for (const value of ["max-age=0", "private, max-age=0", "private, no-store, max-age=0, s-maxage=300", "public, private, no-store, max-age=0"]) {
    assert.throws(() => assertNoStore(value), /target_cache_control_not_private_no_store/);
  }
});

test("frozen plans bind exact IDs, paths, byte hashes, worker bytes and target", () => {
  assert.deepEqual(validateInventory(inventory, target), [id]);
  assert.throws(() => validateInventory({ ...inventory, attachmentIds: [id, id] }, target), /bounded_distinct/);
  const workerSha256 = "a".repeat(64);
  const plan = { version: 1, project: target.project, url: target.origin, workerSha256, inventorySha256: "b".repeat(64), attachments: [item] };
  const ledger = { version: 1, plan, planSha256: planDigest(plan), progress: {} };
  assert.equal(validatePlan(ledger, target, workerSha256), plan);
  assert.throws(() => validatePlan(ledger, target, "c".repeat(64)), /frozen_plan_digest_mismatch/);
  assert.throws(() => validatePlan({ ...ledger, plan: { ...plan, attachments: [{ ...item, sourcePath: directory + "other.png" }] } }, target, workerSha256), /frozen_plan_digest_mismatch/);
});

test("private artifacts require owner-only directories and files outside Git", () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "smot-media-private-")));
  try {
    const path = join(directory, "inventory.json");
    writeFileSync(path, "{}", { mode: 0o600 });
    assert.doesNotThrow(() => assertPrivateOutsideGit(path));
    chmodSync(directory, 0o755);
    assert.throws(() => assertPrivateOutsideGit(path), /owner_only_directory/);
    chmodSync(directory, 0o700);
    chmodSync(path, 0o644);
    assert.throws(() => assertPrivateOutsideGit(path), /owner_only_regular_file/);
    chmodSync(path, 0o600);
    mkdirSync(join(directory, ".git"));
    assert.throws(() => assertPrivateOutsideGit(path), /outside_git/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("CLI production and apply plan guards reject unsafe invocation without network", () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "smot-media-offline-")));
  try {
    const preload = join(directory, "offline.mjs");
    writeFileSync(preload, 'globalThis.fetch = () => { console.error("UNEXPECTED_NETWORK_ATTEMPT"); throw new Error("offline"); };\n');
    const script = new URL("../scripts/relocate-message-media.mjs", import.meta.url);
    const result = spawnSync(process.execPath, ["--import", preload, script.pathname, "apply", "/does-not-exist/ledger.json"], {
      encoding: "utf8", timeout: 5000, env: { ...env, SMOT_MEDIA_URL: "https://bmnfynufuqjwjmtlfdxf.supabase.co", SMOT_MEDIA_TARGET_ACK: "disposable:bmnfynufuqjwjmtlfdxf" },
    });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stderr).code, "exact_target_ack_required");
    assert.doesNotMatch(result.stderr, /UNEXPECTED_NETWORK_ATTEMPT|unused-private-fixture-key/);
    const workerSha256 = createHash("sha256").update(readFileSync(script)).digest("hex");
    const plan = { version: 1, project: target.project, url: target.origin, workerSha256, inventorySha256: "b".repeat(64), attachments: [item] };
    const ledgerPath = join(directory, "ledger.json");
    writeFileSync(ledgerPath, JSON.stringify({ version: 1, plan, planSha256: planDigest(plan), progress: {} }), { mode: 0o600 });
    const noPlanAck = spawnSync(process.execPath, ["--import", preload, script.pathname, "apply", ledgerPath], {
      encoding: "utf8", timeout: 5000, env,
    });
    assert.equal(noPlanAck.status, 1);
    assert.equal(JSON.parse(noPlanAck.stderr).code, "reviewed_plan_digest_ack_required");
    assert.doesNotMatch(noPlanAck.stderr, /UNEXPECTED_NETWORK_ATTEMPT|unused-private-fixture-key/);
    assert.throws(() => validateTarget(["apply", "/private/ledger.json"], { ...env, SMOT_MEDIA_URL: "https://example.com" }), /exact_hosted/);
    assert.throws(() => validateTarget(["plan", "/private/ledger.json", "/private/ledger.json"], env), /usage/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
