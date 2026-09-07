# Exact-inventory private media relocation

`scripts/relocate-message-media.mjs` moves only an explicitly reviewed set of legacy `message-media` attachments to the database-selected physical paths. It uses the relocation migration's service-only RPCs and ordinary Storage upload/download/remove APIs. It never writes `storage.objects`, changes attachment logical identities, scans a bucket, seeds rows, or deletes targets. It loads no `.env` files.

Apply the matching migration and application resolver changes before using the worker. Validate the process on the isolated staging project first. The service key must belong to the exact target and have no signed-in user session. The operator must already be authorized to relocate these exact production attachments; an environment acknowledgement is an execution guard, not a replacement for approval.

## Freeze and review a dry run

Create a canonical absolute directory **outside every Git checkout**, owned by the operator and mode `0700`. Both the inventory and resulting progress ledger must be regular owner-only files (`0600`). Do not put keys or file bytes in either file. The worker writes only paths, attachment IDs, byte hashes, metadata and progress; media bytes exist only in bounded process memory.

The input inventory is explicit, target-bound JSON, capped at 100 distinct attachment UUIDs:

```json
{
  "version": 1,
  "project": "the-exact-project-ref",
  "url": "https://the-exact-project-ref.supabase.co",
  "attachmentIds": ["the-exact-attachment-uuid"]
}
```

Supply `SMOT_MEDIA_URL`, `SMOT_MEDIA_SERVICE_ROLE_KEY` and `SMOT_MEDIA_TARGET_ACK` through the existing private runner. Staging requires `disposable:<ref>`. The known production project requires **`production:<ref>`**, and rejects a disposable acknowledgement. Origins with extra paths, credentials, queries, redirects or custom hosts are rejected.

```sh
node scripts/relocate-message-media.mjs plan /absolute/private/inventory.json /absolute/private/ledger.json
```

`plan` is read-only against Supabase. For each exact ID it reads attachment metadata, resolves the current physical path and downloads at most the expected size (maximum 10 MiB per object). It requires the resolver still to point at the original source and hashes the complete bytes with SHA-256. No `begin` RPC, upload, activation or deletion runs. It refuses to overwrite a ledger. Already activated attachments require their existing ledger to resume, not a newly invented source snapshot.

Review the complete private plan against the authorized inventory, plus the nonsecret receipt's count, total size, target and plan SHA. Record the candidate Git revision and SQL migration receipts separately. The plan binds the exact worker file hash, original inventory hash, source paths, MIME types, sizes and byte hashes. A changed worker or plan requires another explicit review; do not silently edit an active ledger to bypass its digest guard.

## Apply and resume

Set `SMOT_MEDIA_PLAN_ACK` to `sha256:<the-reviewed-plan-sha256>`, retain the target acknowledgement, and run:

```sh
node scripts/relocate-message-media.mjs apply /absolute/private/ledger.json
```

The worker processes one attachment at a time. `begin_message_media_relocation` returns a stable database-generated target and renews a prepared upload lease. The worker persists that exact target before attempting an upload. It rechecks the attachment's frozen logical metadata and source hash, then uploads an `ArrayBuffer` with `upsert:false`, `cacheControl:"0"`, the original MIME type and explicit `Cache-Control: private, no-store, max-age=0`. Blob/FormData defaults cannot replace those headers.

Before activation, it downloads the target again and requires the exact original size, MIME and SHA-256 plus a response containing `private`, `no-store` and `max-age=0`; an explicitly cached `HIT`, `STALE`, `UPDATING` or `REVALIDATED` fails. `verify_message_media_relocation` independently checks the durable objects/ownership/metadata and records the equal hashes. The normal resolver must then return the verified target. Only afterward may the worker remove the **one exact original source path**, after rehashing it once more. `finish_message_media_relocation` must confirm the old object is absent and the verified target remains, returning `retired`.

Every progress update uses an owner-only temporary file, fsync and atomic rename. A per-ledger exclusive lock prevents two workers from using the same ledger. Preserve the ledger after any failure. Re-running the same reviewed `apply` rechecks server state: it reuses a correctly hashed target without uploading again, resumes active relocations after uncertain source deletion, and verifies retired entries idempotently. Uncertain uploads are not blindly retried. A wrong existing target, changed source, unexpected path, unsafe caching, activation failure or failed cleanup stops the run. The source is preserved until activation succeeds; the worker never repairs a mismatched target by overwriting/deleting it.

Requests have 30-second deadlines and the run has a 15-minute deadline. SIGINT/SIGTERM stop subsequent network work and retain the resumable ledger. After SIGKILL or machine loss, the exact ledger `.lock` can remain: verify the recorded worker process is no longer running before the operator removes that one lock. Do not launch a second ledger for the same attachment set while the first is active. No automated global sign-out, schema rollback, or generic Storage cleanup is performed.

## Verification and remaining limits

Offline tests cover byte and header mismatches, response size bounds, upload/delete interruptions, stable target reuse, activation-before-delete ordering, retired reruns, digest guards and production acknowledgement. Run:

```sh
node --test tests/message-media-relocation.test.mjs
npx eslint scripts/relocate-message-media.mjs tests/message-media-relocation.test.mjs
```

The final receipt covers exact origin bytes, mapping activation and old-object retirement. It does **not** revoke bytes already downloaded, guarantee immediate purge of old CDN/browser caches, or invalidate a previously issued bearer capability retroactively. Keep the original same-URL hosted cache test as a separate gate. Downloads here use the SDK-supported `cacheNonce` query to verify origin state; a fresh-origin success must never be relabeled as proof that the previously cached URL has become inaccessible. Keep application participant access, retained-token demotion, old-path access and the actual new-path cache headers in the coordinated hosted evidence.
