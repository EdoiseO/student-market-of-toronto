#!/usr/bin/env node
// Explicit frozen inventory only. No .env loading, bucket scans, or local media files.
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, parse } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
const PRODUCTION = "bmnfynufuqjwjmtlfdxf";
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 100;
export const UPLOAD_OPTIONS = Object.freeze({ upsert: false, cacheControl: "0", headers: Object.freeze({ "Cache-Control": "private, no-store, max-age=0" }) });
const hash = (value) => createHash("sha256").update(value).digest("hex");
class RelocationError extends Error {
  constructor(code) { super(code); this.name = "RelocationError"; this.code = code; }
}
const need = (condition, code) => { if (!condition) throw new RelocationError(code); };
const checked = async (request, code) => {
  const result = await request;
  need(!result.error, code);
  return result.data;
};
const validPath = (path) => typeof path === "string" && path.length < 1024 && !/[\\%\s]/.test(path) &&
  path.split("/").length === 3 && path.split("/").every((part) => part && part !== "." && part !== "..") &&
  UUID.test(path.split("/")[0]) && UUID.test(path.split("/")[1]);
export const planDigest = (plan) => hash(JSON.stringify(plan));

export function validateTarget(args, env) {
  const [command, input, output] = args;
  need((command === "plan" && args.length === 3 && isAbsolute(input || "") && isAbsolute(output || "") && input !== output) ||
    (command === "apply" && args.length === 2 && isAbsolute(input || "")), "usage_plan_inventory_ledger_or_apply_ledger");
  let url;
  try { url = new URL(env.SMOT_MEDIA_URL); } catch { throw new RelocationError("invalid_target_url"); }
  need(url.protocol === "https:" && /^[a-z0-9]+\.supabase\.co$/.test(url.hostname) && !url.port &&
    url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash, "exact_hosted_supabase_origin_required");
  const project = url.hostname.split(".")[0];
  need(env.SMOT_MEDIA_TARGET_ACK === (project === PRODUCTION ? "production:" : "disposable:") + project, "exact_target_ack_required");
  need(Boolean(env.SMOT_MEDIA_SERVICE_ROLE_KEY), "service_key_required");
  return { command, input, ledgerPath: command === "plan" ? output : input, project, origin: url.origin };
}

export function assertPrivateOutsideGit(path, { mustExist = true } = {}) {
  need(isAbsolute(path), "absolute_private_path_required");
  const parent = realpathSync(dirname(path));
  need(parent === dirname(path), "canonical_private_directory_required");
  const directory = lstatSync(parent);
  need(directory.isDirectory() && (directory.mode & 0o077) === 0 &&
    (typeof process.getuid !== "function" || directory.uid === process.getuid()), "owner_only_directory_required");
  for (let ancestor = parent; ; ancestor = dirname(ancestor)) {
    need(!existsSync(join(ancestor, ".git")), "private_artifacts_must_be_outside_git");
    if (ancestor === parse(ancestor).root) break;
  }
  if (mustExist || existsSync(path)) {
    const file = lstatSync(path);
    need(file.isFile() && (file.mode & 0o077) === 0 && file.size <= 1_048_576 &&
      (typeof process.getuid !== "function" || file.uid === process.getuid()), "owner_only_regular_file_required");
  }
}

export function validateInventory(inventory, target) {
  need(inventory?.version === 1 && inventory.project === target.project && inventory.url === target.origin, "inventory_target_mismatch");
  const ids = inventory.attachmentIds;
  need(Array.isArray(ids) && ids.length > 0 && ids.length <= MAX_ATTACHMENTS && ids.every((id) => UUID.test(id)) && new Set(ids).size === ids.length, "bounded_distinct_attachment_ids_required");
  return [...ids].sort();
}

export function validatePlan(ledger, target, workerHash) {
  const plan = ledger?.plan;
  need(ledger?.version === 1 && plan?.version === 1 && plan.project === target.project && plan.url === target.origin, "ledger_target_mismatch");
  need(plan.workerSha256 === workerHash && ledger.planSha256 === planDigest(plan), "frozen_plan_digest_mismatch");
  need(SHA.test(plan.inventorySha256 || "") && Array.isArray(plan.attachments) && plan.attachments.length > 0 && plan.attachments.length <= MAX_ATTACHMENTS, "frozen_plan_invalid");
  const ids = new Set();
  const paths = new Set();
  for (const item of plan.attachments) {
    need(UUID.test(item.attachmentId || "") && !ids.has(item.attachmentId) && validPath(item.sourcePath) && !paths.has(item.sourcePath) &&
      SHA.test(item.sha256 || "") && Number.isInteger(item.sizeBytes) && item.sizeBytes > 0 && item.sizeBytes <= MAX_BYTES &&
      typeof item.mimeType === "string" && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(item.mimeType), "frozen_attachment_invalid");
    ids.add(item.attachmentId); paths.add(item.sourcePath);
  }
  need(ledger.progress && Object.keys(ledger.progress).every((id) => ids.has(id)), "ledger_progress_invalid");
  return plan;
}

export function assertNoStore(value) {
  const directives = String(value || "").toLowerCase().split(",").map((part) => part.trim());
  need(directives.includes("private") && directives.includes("no-store") && directives.includes("max-age=0") &&
    !directives.includes("public") && !directives.includes("immutable") && !directives.some((part) => /^(?:s-maxage|max-age)=/.test(part) && !/^(?:s-maxage|max-age)=0$/.test(part)), "target_cache_control_not_private_no_store");
}

export async function boundedBytes(response, limit) {
  const declared = response.headers.get("content-length");
  if (declared !== null && !(/^\d+$/.test(declared) && Number(declared) <= limit)) {
    await response.body?.cancel().catch(() => {});
    throw new RelocationError("response_exceeds_size_bound");
  }
  need(response.body, "response_body_missing");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      need(size <= limit, "response_exceeds_size_bound");
      chunks.push(Buffer.from(next.value));
    }
    return Buffer.concat(chunks, size);
  } finally { await reader.cancel().catch(() => {}); }
}

export function assertContent(content, item) {
  need(content && content.bytes.length === item.sizeBytes && content.mimeType === item.mimeType && hash(content.bytes) === item.sha256, "frozen_content_mismatch");
}

export function assertTargetMetadata(metadata, item, path) {
  need(metadata && metadata.name === path && metadata.bucketId === "message-media" &&
    UUID.test(metadata.id || "") && Number(metadata.size) === item.sizeBytes && metadata.contentType === item.mimeType,
  "target_storage_metadata_mismatch");
  assertNoStore(metadata.cacheControl);
}

// Dependency injection keeps resume/delete ordering testable without a network.
// The real driver below uses only exact service RPCs and ordinary Storage APIs.
export async function relocateOne(item, progress, driver, save) {
  await driver.describe(item);
  const relocation = await driver.begin(item.attachmentId);
  need(relocation.attachment_id === item.attachmentId && relocation.source_path === item.sourcePath &&
    relocation.mime_type === item.mimeType && Number(relocation.size_bytes) === item.sizeBytes &&
    ["prepared", "active", "retired"].includes(relocation.state), "relocation_receipt_mismatch");
  const targetPath = relocation.target_path;
  need(validPath(targetPath) && targetPath !== item.sourcePath && UUID.test(targetPath.split("/")[2]) &&
    targetPath.split("/").slice(0, 2).join("/") === item.sourcePath.split("/").slice(0, 2).join("/"), "relocation_target_path_invalid");
  need(!progress.targetPath || progress.targetPath === targetPath, "relocation_target_changed");
  progress.targetPath = targetPath;
  progress.state = relocation.state;
  save(); // Persist the server-selected target before any upload attempt.
  let target = await driver.download(targetPath, item.sizeBytes, true);
  if (relocation.state === "prepared") {
    const source = await driver.download(item.sourcePath, item.sizeBytes, false);
    assertContent(source, item);
    if (!target) {
      progress.uploadAttemptedAt = new Date().toISOString(); save();
      // Upload from ArrayBuffer, not Blob/FormData: explicit headers must win.
      await driver.upload(targetPath, source.bytes.buffer.slice(source.bytes.byteOffset, source.bytes.byteOffset + source.bytes.byteLength), item.mimeType);
      target = await driver.download(targetPath, item.sizeBytes, false);
    }
  }
  assertContent(target, item);
  const metadata = await driver.info(targetPath);
  // Hosted Storage can prepend "public" and report HIT even when its persisted
  // cacheControl is private/no-store. The authenticated application gateway is
  // the browser response boundary; never relabel these service bytes as an
  // uncached origin response or use their headers as proof of legacy revocation.
  progress.targetStorage = {
    observedAt: new Date().toISOString(),
    objectId: metadata?.id ?? null,
    metadataCacheControl: metadata?.cacheControl ?? null,
    responseCacheControl: target.cacheControl,
    responseCacheStatus: target.cacheStatus,
    persistedMetadataVerified: false,
  };
  save();
  assertTargetMetadata(metadata, item, targetPath);
  progress.targetStorage.persistedMetadataVerified = true;
  save();
  const verified = await driver.verify(item.attachmentId, item.sha256, hash(target.bytes));
  need(["active", "retired"].includes(verified), "activation_receipt_invalid");
  const resolved = await driver.resolve(item.attachmentId);
  need(resolved.storage_path === targetPath && resolved.mime_type === item.mimeType && Number(resolved.size_bytes) === item.sizeBytes, "active_mapping_mismatch");
  progress.state = verified; progress.verifiedAt = new Date().toISOString(); save();
  const source = await driver.download(item.sourcePath, item.sizeBytes, true);
  if (source) {
    need(verified === "active", "retired_source_reappeared");
    assertContent(source, item);
    progress.sourceDeleteAttemptedAt = new Date().toISOString(); save();
    // Never a bucket sweep, prefix search, or target deletion. Activation and
    // exact source hash verification are mandatory before this single removal.
    await driver.removeSource(item.sourcePath);
  }
  need(await driver.finish(item.attachmentId) === "retired", "retirement_receipt_invalid");
  progress.state = "retired"; progress.finishedAt = new Date().toISOString(); save();
}

function atomicSave(path, value) {
  const temporary = path + "." + randomUUID() + ".tmp";
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, JSON.stringify(value, null, 2) + "\n");
    fsyncSync(descriptor); closeSync(descriptor); descriptor = undefined;
    renameSync(temporary, path);
    const directory = openSync(dirname(path), "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function makeDriver(target, key, signal) {
  const fetchWithDeadline = (input, init = {}) => fetch(input, { ...init, redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000), ...(init.signal ? [init.signal] : [])]) });
  const client = createClient(target.origin, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fetchWithDeadline } });
  const rpc = (name, args) => checked(client.rpc(name, args), "rpc_" + name + "_failed");
  const single = (rows) => { need(Array.isArray(rows) && rows.length === 1, "exact_one_rpc_row_required"); return rows[0]; };
  const driver = {
    readAttachment: (id) => checked(client.from("message_attachments").select("id,storage_path,mime_type,size_bytes").eq("id", id).single(), "attachment_read_failed"),
    async describe(item) {
      const row = await driver.readAttachment(item.attachmentId);
      need(row.id === item.attachmentId && row.storage_path === item.sourcePath && row.mime_type === item.mimeType && Number(row.size_bytes) === item.sizeBytes, "frozen_attachment_changed");
    },
    begin: async (id) => single(await rpc("begin_message_media_relocation", { p_attachment_id: id })),
    resolve: async (id) => single(await rpc("resolve_message_media_attachment", { p_attachment_id: id })),
    verify: (id, sourceHash, targetHash) => rpc("verify_message_media_relocation", { p_attachment_id: id, p_source_sha256: sourceHash, p_target_sha256: targetHash }),
    finish: (id) => rpc("finish_message_media_relocation", { p_attachment_id: id }),
    info: (path) => checked(client.storage.from("message-media").info(path), "target_storage_metadata_read_failed"),
    async download(path, size, allowMissing) {
      need(validPath(path) && Number.isInteger(size) && size > 0 && size <= MAX_BYTES, "bounded_download_input_required");
      // SDK's ordinary /object route, with its supported cacheNonce parameter.
      // This verifies bytes at the selected location, not an origin-cache bypass
      // or a claim about old cached URLs. Hosted Storage may still report HIT.
      const url = new URL("/storage/v1/object/message-media/" + path.split("/").map(encodeURIComponent).join("/"), target.origin);
      url.searchParams.set("cacheNonce", randomUUID());
      const response = await fetchWithDeadline(url, { headers: { apikey: key, Authorization: "Bearer " + key }, cache: "no-store" });
      if (!response.ok) {
        const bytes = await boundedBytes(response, 65_536);
        let error;
        try { error = JSON.parse(bytes.toString("utf8")); } catch { throw new RelocationError("storage_download_failed"); }
        const missing = [400, 404].includes(response.status) && (String(error.statusCode) === "404" || ["NoSuchKey", "not_found"].includes(error.code || error.error));
        need(allowMissing && missing, "storage_download_failed");
        return null;
      }
      return { bytes: await boundedBytes(response, size), mimeType: (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase(),
        cacheControl: response.headers.get("cache-control"), cacheStatus: (response.headers.get("cf-cache-status") || "").toUpperCase() };
    },
    upload: async (path, bytes, mimeType) => {
      need(bytes instanceof ArrayBuffer && bytes.byteLength > 0 && bytes.byteLength <= MAX_BYTES, "bounded_arraybuffer_upload_required");
      await checked(client.storage.from("message-media").upload(path, bytes, { ...UPLOAD_OPTIONS, contentType: mimeType }), "storage_upload_failed_resume_without_overwrite");
    },
    removeSource: (path) => checked(client.storage.from("message-media").remove([path]), "exact_source_removal_failed"),
  };
  return driver;
}

async function main() {
  let target;
  let ledger;
  let lock;
  let lockDescriptor;
  let stage = "local_preflight";
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  const deadline = setTimeout(interrupt, 15 * 60_000);
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  try {
    target = validateTarget(process.argv.slice(2), process.env);
    assertPrivateOutsideGit(target.input);
    assertPrivateOutsideGit(target.ledgerPath, { mustExist: target.command === "apply" });
    if (target.command === "plan") need(!existsSync(target.ledgerPath), "never_overwrite_existing_ledger");
    const workerHash = hash(readFileSync(fileURLToPath(import.meta.url)));
    const inputBytes = readFileSync(target.input);
    const input = JSON.parse(inputBytes.toString("utf8"));
    const ids = target.command === "plan" ? validateInventory(input, target) : null;
    if (target.command === "apply") {
      ledger = input;
      validatePlan(ledger, target, workerHash);
      need(process.env.SMOT_MEDIA_PLAN_ACK === "sha256:" + ledger.planSha256, "reviewed_plan_digest_ack_required");
    }
    lock = target.ledgerPath + ".lock";
    lockDescriptor = openSync(lock, "wx", 0o600);
    writeFileSync(lockDescriptor, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n");
    const driver = makeDriver(target, process.env.SMOT_MEDIA_SERVICE_ROLE_KEY, controller.signal);
    if (target.command === "plan") {
      stage = "read_only_plan";
      const attachments = [];
      for (const id of ids) {
        const row = await driver.readAttachment(id);
        need(row.id === id && validPath(row.storage_path) && Number.isInteger(Number(row.size_bytes)) && Number(row.size_bytes) > 0 && Number(row.size_bytes) <= MAX_BYTES, "attachment_metadata_invalid");
        const resolved = await driver.resolve(id);
        need(resolved.storage_path === row.storage_path && resolved.mime_type === row.mime_type && Number(resolved.size_bytes) === Number(row.size_bytes), "already_relocated_or_metadata_changed_use_existing_ledger");
        const source = await driver.download(row.storage_path, Number(row.size_bytes), false);
        const item = { attachmentId: id, sourcePath: row.storage_path, mimeType: row.mime_type, sizeBytes: Number(row.size_bytes), sha256: hash(source.bytes) };
        assertContent(source, item);
        attachments.push(item);
      }
      const plan = { version: 1, project: target.project, url: target.origin, workerSha256: workerHash,
        inventorySha256: hash(inputBytes), createdAt: new Date().toISOString(), attachments };
      ledger = { version: 1, plan, planSha256: planDigest(plan), progress: {} };
      validatePlan(ledger, target, workerHash);
      atomicSave(target.ledgerPath, ledger);
      console.log(JSON.stringify({ result: "planned", mutations: 0, project: target.project, attachments: attachments.length,
        totalBytes: attachments.reduce((sum, item) => sum + item.sizeBytes, 0), planSha256: ledger.planSha256 }));
    } else {
      stage = "apply_exact_plan";
      for (const item of ledger.plan.attachments) {
        need(!controller.signal.aborted, "interrupted_or_deadline_resume_ledger");
        ledger.progress[item.attachmentId] ??= {};
        await relocateOne(item, ledger.progress[item.attachmentId], driver, () => atomicSave(target.ledgerPath, ledger));
      }
      console.log(JSON.stringify({ result: "retired", project: target.project, attachments: ledger.plan.attachments.length,
        planSha256: ledger.planSha256, remainingBoundary: "Storage may cache service responses; browser delivery requires the authenticated no-store gateway. Prior cached URLs need separate exact-URL revocation evidence." }));
    }
  } catch (error) {
    console.error(JSON.stringify({ result: "failed", stage, code: error instanceof RelocationError ? error.code : "unexpected_failure_redacted",
      retired: Object.values(ledger?.progress || {}).filter((item) => item.state === "retired").length,
      action: "Retain the private ledger. Resolve the error, then resume the same reviewed plan." }));
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
    if (lockDescriptor !== undefined) { closeSync(lockDescriptor); unlinkSync(lock); }
    process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
