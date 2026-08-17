import { replayAmbiguousListingWrite } from "./listing-integrity.mjs";

export const LISTING_WRITE_ACTIONS = Object.freeze({
  create: "create_listing",
  edit: "edit_listing",
  retire: "retire_listing",
});

const JOURNAL_VERSION = 1;
const JOURNAL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export function listingWriteJournalKey(action, listingId = null) {
  if (action === LISTING_WRITE_ACTIONS.create) {
    return "smot:listing-write:create";
  }
  if (!UUID_PATTERN.test(listingId ?? "")) {
    throw new Error("listing_write_journal_listing_invalid");
  }
  return `smot:listing-write:${action}:${listingId}`;
}

export async function hashListingWriteSignature(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function normalizeJournalEntry(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  const updatedAt = Number(candidate.updatedAt);
  if (
    candidate.version !== JOURNAL_VERSION ||
    !Object.values(LISTING_WRITE_ACTIONS).includes(candidate.action) ||
    !UUID_PATTERN.test(candidate.operationId ?? "") ||
    !HASH_PATTERN.test(candidate.signatureHash ?? "") ||
    !Number.isFinite(updatedAt) ||
    updatedAt < Date.now() - JOURNAL_MAX_AGE_MS ||
    updatedAt > Date.now() + 60_000
  ) {
    return null;
  }
  if (candidate.listingId !== null && candidate.listingId !== undefined
    && !UUID_PATTERN.test(candidate.listingId)) {
    return null;
  }
  return {
    version: JOURNAL_VERSION,
    action: candidate.action,
    operationId: candidate.operationId,
    signatureHash: candidate.signatureHash,
    listingId: candidate.listingId ?? null,
    isPublishing: Boolean(candidate.isPublishing),
    updatedAt,
  };
}

export function readListingWriteJournal(storage, key) {
  if (!storage) return null;
  try {
    const entry = normalizeJournalEntry(JSON.parse(storage.getItem(key)));
    if (!entry) storage.removeItem(key);
    return entry;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function writeListingWriteJournal(storage, key, entry) {
  const canonical = normalizeJournalEntry({
    ...entry,
    version: JOURNAL_VERSION,
    updatedAt: Date.now(),
  });
  if (!canonical) throw new Error("listing_write_journal_invalid");
  storage?.setItem(key, JSON.stringify(canonical));
  return canonical;
}

export function clearListingWriteJournal(storage, key, operationId = null) {
  if (!storage) return;
  if (operationId) {
    const current = readListingWriteJournal(storage, key);
    if (current && current.operationId !== operationId) return;
  }
  storage.removeItem(key);
}

export async function getOwnedListingWriteIntent(supabase, operationId) {
  return replayAmbiguousListingWrite(() => supabase.rpc(
    "get_owned_listing_write_intent",
    { p_operation_id: operationId },
  ));
}

export async function beginOwnedListingWriteIntent({
  supabase,
  operationId,
  action,
  signatureHash,
  listingId = null,
  expectedContentRevision = null,
  isPublishing = false,
}) {
  return replayAmbiguousListingWrite(() => supabase.rpc(
    "begin_owned_listing_write_intent",
    {
      p_operation_id: operationId,
      p_action: action,
      p_signature_hash: signatureHash,
      p_listing_id: listingId,
      p_expected_content_revision: expectedContentRevision,
      p_is_publishing: isPublishing,
    },
  ));
}

export async function abortOwnedListingWriteIntent(
  supabase,
  operationId,
  signatureHash,
) {
  return replayAmbiguousListingWrite(() => supabase.rpc(
    "abort_owned_listing_write_intent",
    { p_operation_id: operationId, p_signature_hash: signatureHash },
  ));
}

export async function verifyOwnedListingReservedUpload({
  supabase,
  operationId,
  signatureHash,
  storagePath,
}) {
  return replayAmbiguousListingWrite(() => supabase.rpc(
    "verify_owned_listing_reserved_upload",
    {
      p_operation_id: operationId,
      p_signature_hash: signatureHash,
      p_storage_path: storagePath,
    },
  ));
}

async function settleCleanupTask({ supabase, bucket, task }) {
  let removeError = null;
  try {
    const removal = await bucket.remove([task.storage_path]);
    removeError = removal.error ?? null;
  } catch (error) {
    removeError = error;
  }

  // Even a lost Storage response may have committed. The database is the
  // authoritative proof: completion succeeds only when both object and
  // metadata reference are absent, and exact completion replay is idempotent.
  const completion = await replayAmbiguousListingWrite(() => supabase.rpc(
    "complete_owned_listing_image_cleanup_task",
    { p_task_id: task.task_id, p_lease_token: task.lease_token },
  ));
  if (!completion.error && completion.data === true) return null;

  await replayAmbiguousListingWrite(() => supabase.rpc(
    "release_owned_listing_image_cleanup_task",
    {
      p_task_id: task.task_id,
      p_lease_token: task.lease_token,
      p_retry_after_seconds: 30,
    },
  ));
  return completion.error ?? removeError ?? new Error("listing_cleanup_incomplete");
}

export async function drainOwnedListingImageCleanup({
  supabase,
  bucket,
  limit = 20,
  maxBatches = 5,
}) {
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const claimed = await replayAmbiguousListingWrite(() => supabase.rpc(
      "claim_owned_listing_image_cleanup_tasks",
      { p_limit: limit },
    ));
    if (claimed.error) return { error: claimed.error, pending: true };
    const tasks = Array.isArray(claimed.data) ? claimed.data : [];
    if (tasks.length === 0) return { error: null, pending: false };
    for (const task of tasks) {
      const error = await settleCleanupTask({ supabase, bucket, task });
      if (error) return { error, pending: true };
    }
    if (tasks.length < limit) return { error: null, pending: false };
  }
  return { error: new Error("listing_cleanup_batch_limit"), pending: true };
}

export function isTerminalListingWriteIntent(intent) {
  return intent?.state === "committed" || intent?.state === "aborted";
}

export async function prepareListingWriteJournal({
  supabase,
  bucket,
  storage,
  key,
  action,
  signatureHash,
  listingId = null,
  expectedContentRevision = null,
  isPublishing = false,
}) {
  let existing = readListingWriteJournal(storage, key);
  let existingIntent = null;

  if (existing) {
    const fetched = await getOwnedListingWriteIntent(supabase, existing.operationId);
    if (fetched.error) return { error: fetched.error };
    existingIntent = fetched.data;

    const samePayload = existing.action === action
      && existing.signatureHash === signatureHash
      && existing.listingId === listingId
      && existing.isPublishing === Boolean(isPublishing);

    if (samePayload && existingIntent?.stage === "committed") {
      const cleanup = await drainOwnedListingImageCleanup({ supabase, bucket });
      if (cleanup.error) return { error: cleanup.error };
      clearListingWriteJournal(storage, key, existing.operationId);
      return { previousCompleted: existingIntent, error: null };
    }

    if (!samePayload || existingIntent?.stage === "aborted" || !existingIntent) {
      if (existingIntent && ["begun", "in_progress"].includes(existingIntent.state)) {
        const aborted = await abortOwnedListingWriteIntent(
          supabase,
          existing.operationId,
          existing.signatureHash,
        );
        if (aborted.error) return { error: aborted.error };
      }
      const cleanup = await drainOwnedListingImageCleanup({ supabase, bucket });
      if (cleanup.error) return { error: cleanup.error };
      clearListingWriteJournal(storage, key, existing.operationId);
      existing = null;
      existingIntent = null;
    }
  }

  const entry = existing ?? writeListingWriteJournal(storage, key, {
    action,
    operationId: globalThis.crypto.randomUUID(),
    signatureHash,
    listingId,
    isPublishing,
  });
  const begun = await beginOwnedListingWriteIntent({
    supabase,
    operationId: entry.operationId,
    action,
    signatureHash,
    listingId,
    expectedContentRevision,
    isPublishing,
  });
  if (begun.error) return { entry, error: begun.error };
  return { entry, intent: begun.data, error: null };
}
