import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  cleanupAttemptedListingImageUploads,
  cleanupListingStorageObjects,
  cleanupRetiredListingImageObjects,
  hasConflictingUnresolvedListingWrite,
  isAmbiguousListingWriteError,
  parseListingRequiredFieldViolation,
  parseListingImageEditResult,
  parseRetiredListingResult,
  replayAmbiguousListingWrite,
  shouldRetainUnresolvedListingWrite,
  uploadListingImageBatch,
} from "../src/lib/listing-integrity.mjs";
import {
  validateListingPublishFields,
} from "../src/lib/write-field-contracts.mjs";

const migrationUrl = new URL(
  "../supabase/migrations/20260816192729_stage6_listing_required_field_foundation.sql",
  import.meta.url,
);
const migration = await readFile(migrationUrl, "utf8");
const recoveryMigration = await readFile(
  new URL(
    "../supabase/migrations/20260816224214_stage6_listing_write_intent_recovery_foundation.sql",
    import.meta.url,
  ),
  "utf8",
);
const createForm = await readFile(
  new URL("../src/components/create-listing-form.jsx", import.meta.url),
  "utf8",
);
const editForm = await readFile(
  new URL("../src/components/edit-listing-form.jsx", import.meta.url),
  "utf8",
);
const dashboardActions = await readFile(
  new URL("../src/components/dashboard-listing-actions.jsx", import.meta.url),
  "utf8",
);

test("listing foundation keeps one row-locked readiness contract behind invoker wrappers", () => {
  assert.match(migration, /alter column description drop not null/);
  assert.match(migration, /alter column price drop not null/);
  assert.match(migration, /function private\.normalize_listing_write_text/);
  assert.match(migration, /replace\(coalesce\(p_value, ''\), E'\\r\\n', E'\\n'\)/);
  assert.match(migration, /\\00A0[\s\S]*\\FEFF/);
  assert.match(migration, /function private\.assert_listing_publishable\(p_listing_id uuid\)[\s\S]*for update;[\s\S]*from public\.listing_images/);
  assert.match(migration, /p_image_count[\s\S]*not between 1 and 10/);
  assert.match(
    migration,
    /function private\.listing_draft_field_violations[\s\S]*p_category is not null[\s\S]*p_price is not null[\s\S]*p_description is not null[\s\S]*p_condition is not null[\s\S]*p_location is not null/,
  );
  assert.match(migration, /listing_required_fields_missing:/);
  assert.match(migration, /function listing_action_private\.save_owned_listing_draft_impl/);
  assert.match(migration, /function public\.save_owned_listing_draft[\s\S]*security invoker[\s\S]*begin atomic/);
  assert.match(migration, /function listing_action_private\.transition_owned_listing_status_impl/);
  assert.match(migration, /function public\.transition_owned_listing_status[\s\S]*security invoker[\s\S]*begin atomic/);
  assert.match(migration, /function listing_action_private\.replace_owned_listing_images_impl/);
  assert.match(migration, /function public\.replace_owned_listing_images[\s\S]*security invoker[\s\S]*begin atomic/);
  assert.match(migration, /function public\.save_owned_listing_draft_with_images[\s\S]*security invoker[\s\S]*begin atomic/);
  assert.match(migration, /listing_action_private\.write_command_results/);
  assert.match(migration, /function public\.save_owned_listing_draft_idempotent[\s\S]*security invoker/);
  assert.match(migration, /function public\.save_owned_listing_draft_with_images_idempotent[\s\S]*security invoker/);
  assert.match(migration, /function public\.transition_owned_listing_status_idempotent[\s\S]*security invoker/);
  assert.match(migration, /function public\.retire_owned_listing_idempotent[\s\S]*security invoker/);
  assert.match(
    migration,
    /retire_owned_listing_idempotent_impl[\s\S]*jsonb_agg\(image\.storage_path order by image\.position, image\.id\)[\s\S]*'storage_paths', storage_paths[\s\S]*'retire_listing'/,
  );
  assert.match(migration, /function public\.discard_owned_listing_draft_if_unchanged[\s\S]*security invoker/);
  assert.match(migration, /function public\.discard_owned_listing_draft_if_unchanged_idempotent[\s\S]*security invoker/);
  assert.match(migration, /function private\.prevent_referenced_listing_image_object_delete/);
  assert.match(migration, /for key share/);
  assert.match(
    migration,
    /function private\.enforce_listing_image_write_contract[\s\S]*object\.name = new\.storage_path[\s\S]*for key share;[\s\S]*if not found then/,
  );
  assert.match(migration, /trusted_draft_image_replace/);
  assert.match(migration, /function private\.allow_listing_image_replace_origin[\s\S]*security invoker/);
  assert.match(migration, /function private\.listing_image_url_matches_path/);
  assert.doesNotMatch(migration, /function public\.transition_owned_listing_status[\s\S]{0,180}security definer/);
  assert.match(migration, /p_action = 'submit_for_review'[\s\S]*perform private\.assert_listing_publishable/);
  assert.match(migration, /trusted_moderation_decision'[\s\S]*new\.status = 'active'[\s\S]*assert_listing_publishable/);
  assert.match(migration, /new\.status not in \('draft', 'inactive'\)/);
  assert.match(
    migration,
    /new\.status = 'inactive'[\s\S]*listing_required_field_violations\([\s\S]*new\.location,[\s\S]*1,[\s\S]*1[\s\S]*listing_required_fields_missing:/,
  );
  assert.match(
    migration,
    /integrity_context = 'trusted_draft_save'[\s\S]*new\.status := 'draft';[\s\S]*new\.submitted_for_review_at := null;/,
  );
  assert.match(
    migration,
    /integrity_context in \('seller_transition', 'retirement', 'image_change', 'trusted_draft_save'\)[\s\S]*old\.status in \('active', 'sold', 'inactive'\)[\s\S]*new\.status := 'inactive';[\s\S]*new\.submitted_for_review_at := statement_timestamp\(\);/,
  );
  assert.doesNotMatch(migration, /revoke insert .*public\.listings/i);
});

test("listing forms use durable intent, reservation, commit, and cleanup RPCs", () => {
  assert.match(createForm, /prepareListingWriteJournal/);
  assert.match(createForm, /commit_owned_listing_create_draft_intent/);
  assert.match(createForm, /reserve_owned_listing_image_uploads/);
  assert.match(createForm, /commit_owned_listing_create_intent/);
  assert.doesNotMatch(createForm, /\.from\("listings"\)\s*\.insert/);
  assert.match(createForm, /uploadListingImageBatch\(/);
  assert.match(createForm, /verifyOwnedListingReservedUpload/);
  assert.match(createForm, /drainOwnedListingImageCleanup/);
  assert.doesNotMatch(createForm, /\.from\("listing_images"\)/);
  assert.ok(
    createForm.indexOf("uploadListingImageBatch(") <
      createForm.indexOf('"commit_owned_listing_create_intent"'),
  );

  assert.match(editForm, /prepareListingWriteJournal/);
  assert.match(editForm, /reserve_owned_listing_image_uploads/);
  assert.match(editForm, /commit_owned_listing_edit_intent/);
  assert.match(editForm, /verifyOwnedListingReservedUpload/);
  assert.doesNotMatch(editForm, /\.from\("listing_images"\)/);
  assert.ok(
    editForm.indexOf("uploadListingImageBatch({") <
    editForm.indexOf('"commit_owned_listing_edit_intent"'),
  );
  assert.match(
    editForm,
    /expectedContentRevision: parseListingContentRevision\(listing\.content_revision\)/,
  );
  assert.doesNotMatch(editForm, /\.from\("listings"\)\s*\.update/);
  assert.match(editForm, /listingSavedAsDraftAfterEdit/);
  assert.match(
    editForm,
    /if \(!hasMeaningfulFieldChanges && !hasMeaningfulPhotoChanges\) \{\s*return;\s*\}[\s\S]*prepareListingWriteJournal/,
  );
  assert.match(createForm, /pendingWriteRef/);
  assert.match(editForm, /pendingWriteRef/);
  assert.match(createForm, /uploadState: \{\}/);
  assert.match(editForm, /uploadState: \{\}/);
  assert.match(createForm, /abortOwnedListingWriteIntent/);
  assert.match(editForm, /abortOwnedListingWriteIntent/);
  assert.match(createForm, /clearListingWriteJournal/);
  assert.match(editForm, /clearListingWriteJournal/);
  assert.match(createForm, /p_description: normalizedDescription/);
  assert.match(editForm, /normalizeWriteText\(description, \{ emptyToNull: true \}\)/);
  assert.match(createForm, /aria-required="true"[\s\S]*aria-invalid=\{Boolean\(fieldErrors\.photos\)\}/);
  assert.match(editForm, /aria-required="true"[\s\S]*aria-invalid=\{Boolean\(fieldErrors\.photos\)\}/);
  assert.match(createForm, /\{t\.addPhotos\}[\s\S]*\{t\.requiredFieldLabel\}/);
  assert.match(editForm, /\{t\.addPhotos\}[\s\S]*\{t\.requiredFieldLabel\}/);
  assert.match(createForm, /t\.listingShowFewerPhotoPreviews/);
  assert.match(createForm, /t\.listingAdditionalPhotosSelected/);
  assert.match(createForm, /t\.listingShowLess/);
  assert.match(createForm, /t\.listingMorePhotos/);
  assert.match(editForm, /t\.listingShowFewerPhotoPreviews/);
  assert.match(editForm, /t\.listingAdditionalPhotosSelected/);
  assert.match(editForm, /t\.listingShowLess/);
  assert.match(editForm, /t\.listingMorePhotos/);
  assert.doesNotMatch(createForm, /Show fewer photo previews|additional photos selected|Show less/);
  assert.doesNotMatch(editForm, /Show fewer photo previews|additional photos selected|Show less/);
  assert.match(dashboardActions, /transition_owned_listing_status_idempotent/);
  assert.match(dashboardActions, /commit_owned_listing_retire_intent/);
  assert.doesNotMatch(dashboardActions, /\.from\("listing_images"\)/);
  assert.match(dashboardActions, /pendingRetirementOperationRef/);
  assert.match(dashboardActions, /drainOwnedListingImageCleanup/);
  assert.match(
    dashboardActions,
    /if \(pendingRetirementOperationRef\.current\) \{[\s\S]*toast\.error\(t\.errorGeneric\)[\s\S]*return[\s\S]*transition_owned_listing_status_idempotent/,
  );
  assert.match(
    dashboardActions,
    /if \(pendingStatusOperationRef\.current\) \{[\s\S]*toast\.error\(t\.errorGeneric\)[\s\S]*prepareListingWriteJournal/,
  );
});

test("legacy in-memory conflict helper still blocks unresolved pre-foundation writes", () => {
  assert.equal(hasConflictingUnresolvedListingWrite({
    signature: "create-v1",
    unresolvedDbOperation: "draft",
  }, "create-v2"), true);
  assert.equal(hasConflictingUnresolvedListingWrite({
    signature: "edit-v1",
    unresolvedDbOperation: "edit",
    uploadState: { attemptedPaths: ["owner/listing/staged.webp"] },
  }, "edit-v2"), true);
  assert.equal(hasConflictingUnresolvedListingWrite({
    signature: "create-v1",
    unresolvedDbOperation: "draft",
  }, "create-v1"), false);

});

test("an abandoned create upload records every attempted path before cleanup", async () => {
  const uploadCalls = [];
  const removeCalls = [];
  const uploadState = {};
  const bucket = {
    async upload(path) {
      uploadCalls.push(path);
      return uploadCalls.length === 2
        ? { error: { statusCode: 400, message: "second upload failed" } }
        : { error: null };
    },
    getPublicUrl(path) {
      return { data: { publicUrl: `https://project.test/${path}` } };
    },
    async remove(paths) {
      removeCalls.push(paths);
      if (removeCalls.length === 1) {
        throw new TypeError("Load failed");
      }
      return { error: null };
    },
  };

  await assert.rejects(
    uploadListingImageBatch({
      bucket,
      files: [{ name: "one.webp" }, { name: "two.webp" }],
      uploadState,
      getStoragePath: (file) => file.name,
    }),
    (error) => error?.message === "second upload failed",
  );
  assert.deepEqual(uploadCalls, ["one.webp", "two.webp"]);
  assert.deepEqual(uploadState.attemptedPaths, ["one.webp", "two.webp"]);
  assert.deepEqual(removeCalls, []);

  const ambiguousCleanup = await cleanupAttemptedListingImageUploads({ bucket, uploadState });
  assert.match(ambiguousCleanup.error.message, /Load failed/);
  assert.deepEqual(uploadState.attemptedPaths, ["one.webp", "two.webp"]);

  assert.deepEqual(
    await cleanupAttemptedListingImageUploads({ bucket, uploadState }),
    { error: null },
  );
  assert.deepEqual(removeCalls, [
    ["one.webp", "two.webp"],
    ["one.webp", "two.webp"],
  ]);
  assert.deepEqual(uploadState.attemptedPaths, []);
});

test("create upload safely accepts an exact retry after a committed response is lost", async () => {
  const uploadState = {};
  const objects = new Set();
  let calls = 0;
  const bucket = {
    async upload(path) {
      calls += 1;
      assert.equal(uploadState.plannedImages.length, 1);
      assert.deepEqual(uploadState.attemptedPaths, [path]);
      if (calls === 1) {
        objects.add(path);
        throw new TypeError("Failed to fetch");
      }
      assert.equal(objects.has(path), true);
      return { error: { statusCode: 409, message: "The resource already exists" } };
    },
    getPublicUrl(path) {
      return { data: { publicUrl: `https://project.test/${path}` } };
    },
  };

  const images = await uploadListingImageBatch({
    bucket,
    files: [{ name: "committed.webp" }],
    uploadState,
    getStoragePath: () => "owner/listing/stable-committed.webp",
    verifyExistingUpload: async (path) => objects.has(path),
  });

  assert.equal(calls, 2);
  assert.deepEqual(uploadState.completedPaths, ["owner/listing/stable-committed.webp"]);
  assert.deepEqual(images, [{
    storagePath: "owner/listing/stable-committed.webp",
    imageUrl: "https://project.test/owner/listing/stable-committed.webp",
  }]);
});

test("a reload or second tab accepts only a server-verified reserved object", async () => {
  const path = "owner/listing/stable-reload.webp";
  const verifierCalls = [];
  const bucket = {
    async upload() {
      return { error: { statusCode: 409, message: "The resource already exists" } };
    },
    getPublicUrl(storagePath) {
      return { data: { publicUrl: `https://project.test/${storagePath}` } };
    },
  };
  for (const tabState of [{}, {}]) {
    const images = await uploadListingImageBatch({
      bucket,
      files: [{ name: "reload.webp" }],
      uploadState: tabState,
      getStoragePath: () => path,
      verifyExistingUpload: async (storagePath) => {
        verifierCalls.push(storagePath);
        return true;
      },
    });
    assert.equal(images[0].storagePath, path);
  }
  assert.deepEqual(verifierCalls, [path, path]);
  await assert.rejects(
    uploadListingImageBatch({
      bucket,
      files: [{ name: "unverified.webp" }],
      uploadState: {},
      getStoragePath: () => "owner/listing/unverified.webp",
      verifyExistingUpload: async () => false,
    }),
    (error) => error?.statusCode === 409,
  );
});

test("edit cleanup ambiguity retains attempted paths for an exact retry", async () => {
  const uploadState = {};
  let uploadCalls = 0;
  let cleanupCalls = 0;
  const bucket = {
    async upload(path) {
      uploadCalls += 1;
      assert.equal(path, "owner/listing/edit-attempt.webp");
      // Model Storage committing the object while both transport responses
      // are lost. The abandoned edit must still know the path to remove.
      throw new TypeError("Failed to fetch");
    },
    getPublicUrl(path) {
      return { data: { publicUrl: `https://project.test/${path}` } };
    },
    async remove(paths) {
      cleanupCalls += 1;
      assert.deepEqual(paths, ["owner/listing/edit-attempt.webp"]);
      if (cleanupCalls === 1) {
        throw new TypeError("Load failed");
      }
      return { error: null };
    },
  };

  await assert.rejects(
    uploadListingImageBatch({
      bucket,
      files: [{ name: "edit.webp" }],
      uploadState,
      getStoragePath: () => "owner/listing/edit-attempt.webp",
    }),
    /Failed to fetch/,
  );
  assert.equal(uploadCalls, 2);
  assert.deepEqual(uploadState.attemptedPaths, ["owner/listing/edit-attempt.webp"]);

  const ambiguous = await cleanupAttemptedListingImageUploads({ bucket, uploadState });
  assert.match(ambiguous.error.message, /Load failed/);
  assert.deepEqual(uploadState.attemptedPaths, ["owner/listing/edit-attempt.webp"]);

  const retried = await cleanupAttemptedListingImageUploads({ bucket, uploadState });
  assert.equal(retried.error, null);
  assert.equal(cleanupCalls, 2);
  assert.deepEqual(uploadState.attemptedPaths, []);
});

test("ambiguous listing writes replay once while definitive database errors do not", async () => {
  let ambiguousCalls = 0;
  const replayed = await replayAmbiguousListingWrite(async () => {
    ambiguousCalls += 1;
    return ambiguousCalls === 1
      ? { data: null, error: new Error("Failed to fetch") }
      : { data: { id: "canonical" }, error: null };
  });
  assert.equal(ambiguousCalls, 2);
  assert.deepEqual(replayed.data, { id: "canonical" });
  assert.equal(isAmbiguousListingWriteError({ code: "40001" }), false);
  assert.equal(isAmbiguousListingWriteError({ code: "PGRST000" }), true);
  assert.equal(isAmbiguousListingWriteError({ code: "PGRST001" }), true);
  assert.equal(isAmbiguousListingWriteError({ code: "FETCH_ERROR" }), true);

  let thrownCalls = 0;
  const thrownReplay = await replayAmbiguousListingWrite(async () => {
    thrownCalls += 1;
    if (thrownCalls === 1) {
      throw new TypeError("Load failed");
    }
    return { data: { id: "after-throw" }, error: null };
  });
  assert.equal(thrownCalls, 2);
  assert.equal(thrownReplay.data.id, "after-throw");

  let definitiveCalls = 0;
  await replayAmbiguousListingWrite(async () => {
    definitiveCalls += 1;
    return { data: null, error: { code: "23514", message: "invalid" } };
  });
  assert.equal(definitiveCalls, 1);
});

test("an authorization retry cannot erase an earlier ambiguous database outcome", async () => {
  let calls = 0;
  const result = await replayAmbiguousListingWrite(async () => {
    calls += 1;
    return calls === 1
      ? { data: null, error: { code: "PGRST000", message: "database unavailable" } }
      : { data: null, error: { status: 403, message: "session expired" } };
  });
  const pendingCreate = {
    signature: "create-v1",
    unresolvedDbOperation: null,
  };

  assert.equal(result.hadAmbiguousAttempt, true);
  assert.equal(result.attemptCount, 2);
  assert.equal(
    shouldRetainUnresolvedListingWrite(pendingCreate, "draft", result),
    true,
  );
  pendingCreate.unresolvedDbOperation = "draft";
  assert.equal(hasConflictingUnresolvedListingWrite(pendingCreate, "create-v2"), true);

  const laterAuthorizationError = await replayAmbiguousListingWrite(async () => ({
    data: null,
    error: { status: 401, message: "signed out" },
  }));
  assert.equal(laterAuthorizationError.hadAmbiguousAttempt, false);
  assert.equal(
    shouldRetainUnresolvedListingWrite(
      pendingCreate,
      "draft",
      laterAuthorizationError,
    ),
    true,
  );
});

test("two ambiguous discards block changed create data until exact replay succeeds", async () => {
  const pendingCreate = {
    signature: "create-v1",
    unresolvedDbOperation: "discard",
    listing: { id: "listing-id" },
    discardExpectedRevision: 2,
  };
  let ambiguousCalls = 0;
  const ambiguousDiscard = await replayAmbiguousListingWrite(async () => {
    ambiguousCalls += 1;
    return { data: null, error: new TypeError("Failed to fetch") };
  });

  assert.equal(ambiguousCalls, 2);
  assert.equal(ambiguousDiscard.hadAmbiguousAttempt, true);
  assert.equal(hasConflictingUnresolvedListingWrite(pendingCreate, "create-v2"), true);

  const canonicalDiscard = await replayAmbiguousListingWrite(async () => ({
    data: true,
    error: null,
  }));
  assert.equal(canonicalDiscard.data, true);
  pendingCreate.unresolvedDbOperation = null;
  assert.equal(hasConflictingUnresolvedListingWrite(pendingCreate, "create-v2"), false);
});

test("retirement replays a lost response and retains exact cleanup paths until removal succeeds", async () => {
  const listingId = "22222222-2222-4222-8222-222222222222";
  const canonical = {
    listing_id: listingId,
    storage_paths: [
      `11111111-1111-4111-8111-111111111111/${listingId}/cover.webp`,
      `11111111-1111-4111-8111-111111111111/${listingId}/back.webp`,
    ],
  };
  let retireCalls = 0;
  const retirement = await replayAmbiguousListingWrite(async () => {
    retireCalls += 1;
    return retireCalls === 1
      ? { data: null, error: new TypeError("Failed to fetch") }
      : { data: canonical, error: null };
  });
  assert.equal(retireCalls, 2);
  assert.equal(retirement.hadAmbiguousAttempt, true);
  assert.deepEqual(parseRetiredListingResult(retirement.data, listingId), {
    listingId,
    storagePaths: canonical.storage_paths,
  });
  assert.equal(parseRetiredListingResult({
    ...canonical,
    storage_paths: ["https://evil.example/not-a-path"],
  }, listingId), null);

  const retirementState = {
    storagePaths: [...canonical.storage_paths],
    cleanupPending: true,
  };
  let cleanupCalls = 0;
  const bucket = {
    async remove(paths) {
      cleanupCalls += 1;
      assert.deepEqual(paths, canonical.storage_paths);
      return cleanupCalls === 1
        ? { error: new TypeError("Load failed") }
        : { error: null };
    },
  };
  assert.ok((await cleanupRetiredListingImageObjects({
    bucket,
    retirementState,
  })).error);
  assert.equal(retirementState.cleanupPending, true);
  assert.deepEqual(retirementState.storagePaths, canonical.storage_paths);
  assert.equal((await cleanupRetiredListingImageObjects({
    bucket,
    retirementState,
  })).error, null);
  assert.equal(retirementState.cleanupPending, false);
  assert.deepEqual(retirementState.storagePaths, []);
});

test("edit post-commit cleanup uses canonical replay paths and blocks until remove is confirmed", async () => {
  const listingId = "22222222-2222-4222-8222-222222222222";
  const removedPath = `11111111-1111-4111-8111-111111111111/${listingId}/removed.webp`;
  let rpcCalls = 0;
  const replayedEdit = await replayAmbiguousListingWrite(async () => {
    rpcCalls += 1;
    return rpcCalls === 1
      ? { data: null, error: { code: "PGRST000", message: "connection lost" } }
      : {
          data: {
            listing_id: listingId,
            content_revision: 9,
            removed_storage_paths: [removedPath],
          },
          error: null,
        };
  });
  const canonicalEdit = parseListingImageEditResult(replayedEdit.data, listingId);
  assert.equal(replayedEdit.hadAmbiguousAttempt, true);
  assert.deepEqual(canonicalEdit, {
    listingId,
    contentRevision: 9,
    removedStoragePaths: [removedPath],
  });

  const cleanupState = { storagePaths: canonicalEdit.removedStoragePaths, cleanupPending: true };
  let removeCalls = 0;
  const bucket = {
    async remove(paths) {
      removeCalls += 1;
      assert.deepEqual(paths, [removedPath]);
      return removeCalls === 1
        ? { error: { code: "PGRST001", message: "response lost" } }
        : { error: null };
    },
  };
  assert.ok((await cleanupListingStorageObjects({ bucket, cleanupState })).error);
  assert.equal(cleanupState.cleanupPending, true);
  assert.deepEqual(cleanupState.storagePaths, [removedPath]);
  assert.equal((await cleanupListingStorageObjects({ bucket, cleanupState })).error, null);
  assert.equal(cleanupState.cleanupPending, false);
  assert.deepEqual(cleanupState.storagePaths, []);
});

test("listing required-field parsing is bounded and Unicode limits count code points", () => {
  assert.deepEqual(
    parseListingRequiredFieldViolation({
      message: "listing_required_fields_missing:title,location,images,unknown",
    }),
    ["title", "campus", "photos"],
  );
  assert.deepEqual(parseListingRequiredFieldViolation({ message: "internal error" }), []);

  const valid = validateListingPublishFields({
    title: "😀".repeat(120),
    category: "Books",
    price: "0",
    description: "Complete",
    condition: "New",
    campus: "Casa Loma",
    photoCount: 1,
  });
  assert.equal(valid.ok, true);
  assert.equal(validateListingPublishFields({
    ...valid.values,
    title: "😀".repeat(121),
  }).errors.title, "too_long");
  assert.doesNotMatch(createForm, /maxLength=/);
  assert.doesNotMatch(editForm, /maxLength=/);
});

const postgresBin = [
  process.env.POSTGRES_BIN,
  "/opt/homebrew/opt/postgresql@16/bin",
  "/usr/local/opt/postgresql@16/bin",
]
  .filter(Boolean)
  .find((candidate) => existsSync(join(candidate, "postgres")));

test(
  "PostgreSQL foundation enforces draft, publish, image, revision, moderator, and ban invariants",
  { skip: !postgresBin, timeout: 45_000 },
  async () => {
    const cluster = await mkdtemp(join(tmpdir(), "smot-stage6-listing-"));
    const data = join(cluster, "data");
    const port = 49_152 + Math.floor(Math.random() * 10_000);
    let started = false;

    const command = (name, args, options = {}) => {
      const result = spawnSync(join(postgresBin, name), args, {
        encoding: "utf8",
        ...options,
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      return (result.stdout ?? "").trim();
    };
    const sql = (statement, expectFailure = false) => {
      const result = spawnSync(
        join(postgresBin, "psql"),
        [
          "-X", "-qAt", "-h", cluster, "-p", String(port), "-d", "postgres",
          "-v", "ON_ERROR_STOP=1",
        ],
        { encoding: "utf8", input: statement },
      );

      if (expectFailure) {
        assert.notEqual(result.status, 0, `expected failure: ${statement}`);
        return result.stderr;
      }

      assert.equal(result.status, 0, result.stderr || result.stdout);
      return result.stdout.trim();
    };
    const sqlAsync = (statement) => new Promise((resolve) => {
      const child = spawn(
        join(postgresBin, "psql"),
        [
          "-X", "-qAt", "-h", cluster, "-p", String(port), "-d", "postgres",
          "-v", "ON_ERROR_STOP=1",
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("close", (status) => resolve({ status, stdout, stderr }));
      child.stdin.end(statement);
    });

    const owner = "11111111-1111-4111-8111-111111111111";
    const otherOwner = "99999999-9999-4999-8999-999999999999";
    const cleanupOwner = "12121212-1212-4212-8212-121212121212";
    const legacyListing = "22222222-2222-4222-8222-222222222222";
    const imageId = "33333333-3333-4333-8333-333333333333";
    const incompleteLegacyListing = "44444444-4444-4444-8444-444444444444";
    const partialDraftListing = "55555555-5555-4555-8555-555555555555";
    const raceImageA = "66666666-6666-4666-8666-666666666666";
    const raceImageB = "77777777-7777-4777-8777-777777777777";
    const createOperation = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const imageOperation = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const transitionOperation = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const discardOperation = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const retireListing = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const retireOperation = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const claims = `set role authenticated; set request.jwt.claims='{"role":"authenticated","sub":"${owner}"}';`;
    const otherClaims = `set role authenticated; set request.jwt.claims='{"role":"authenticated","sub":"${otherOwner}"}';`;
    const serviceClaims = `set role service_role;
      set request.jwt.claims='{"role":"service_role"}';`;

    try {
      command("initdb", ["-D", data, "-A", "trust", "--no-locale", "--encoding=UTF8"]);
      command(
        "pg_ctl",
        [
          "-D", data, "-o", `-p ${port} -k ${cluster} -c listen_addresses=''`,
          "-w", "start",
        ],
        { stdio: "ignore" },
      );
      started = true;
      sql(BOOTSTRAP_SQL);
      sql(migration);
      sql(recoveryMigration);
      sql(`insert into auth.users(id) values
        ('${owner}'),('${otherOwner}'),('${cleanupOwner}');`);
      assert.equal(
        sql(`select has_function_privilege('authenticated',
          'public.discard_owned_listing_draft(uuid)','execute');`),
        "t",
      );

      assert.match(
        sql(`${claims} select * from listing_action_private.save_owned_listing_draft_impl('Nope');`, true),
        /permission denied for schema listing_action_private/i,
      );
      assert.match(
        sql(`${claims} select listing_action_private.replace_owned_listing_images_impl(
          '${legacyListing}',1,'[]'::jsonb,false,null,null,null,null,null,null,false
        );`, true),
        /permission denied for schema listing_action_private/i,
      );
      const draftId = sql(`${claims}
        select id from public.save_owned_listing_draft(repeat('😀',120));`);
      assert.match(draftId, /^[0-9a-f-]{36}$/i);
      assert.equal(
        sql(`select status||':'||content_revision from public.listings where id='${draftId}';`),
        "draft:1",
      );
      assert.match(
        sql(`${claims} select id from public.save_owned_listing_draft(repeat('😀',121));`, true),
        /listing_required_fields_missing:title/i,
      );
      assert.match(
        sql(`${claims} select id from public.save_owned_listing_draft(E' \t\r\n ');`, true),
        /listing_required_fields_missing:title/i,
      );
      for (const invisibleTitle of [
        "U&'\\FEFF'",
        "U&'\\2003'",
        "U&'\\00A0'",
        "U&'\\FEFF\\2003\\00A0'",
      ]) {
        assert.match(
          sql(`${claims} select id from public.save_owned_listing_draft(${invisibleTitle});`, true),
          /listing_required_fields_missing:title/i,
        );
      }
      assert.match(
        sql(`${claims} select id from public.save_owned_listing_draft(
          'Bounded draft',null,null,null,null,repeat('c',81)
        );`, true),
        /listing_category_too_long/i,
      );
      const normalizedDraftId = sql(`${claims}
        select id from public.save_owned_listing_draft(
          E'  Windows\\r\\nTitle  ',null,null,E'  Line one\\r\\nLine two\\rLine three  '
        );`);
      assert.equal(
        sql(`select title || E'\\x1f' || description
          from public.listings where id='${normalizedDraftId}';`),
        "Windows\nTitle\u001fLine one\nLine two\nLine three",
      );

      // Lost-response replay: the same actor/operation/payload returns the
      // exact generated row, while payload reuse conflicts and creates no
      // duplicate draft.
      const replayDraftId = sql(`${claims}
        select id from public.save_owned_listing_draft_idempotent(
          '${createOperation}','Replay draft'
        );`);
      assert.equal(
        sql(`${claims} select id from public.save_owned_listing_draft_idempotent(
          '${createOperation}','Replay draft'
        );`),
        replayDraftId,
      );
      assert.equal(
        sql(`select count(*) from public.listings where title='Replay draft';`),
        "1",
      );
      assert.match(
        sql(`${claims} select id from public.save_owned_listing_draft_idempotent(
          '${createOperation}','Different payload'
        );`, true),
        /listing_operation_payload_conflict/i,
      );

      const concurrentCreateOperation = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
      const concurrentCreateSql = `${claims}
        select id from public.save_owned_listing_draft_idempotent(
          '${concurrentCreateOperation}','Concurrent replay'
        );`;
      const [concurrentCreateA, concurrentCreateB] = await Promise.all([
        sqlAsync(concurrentCreateSql),
        sqlAsync(concurrentCreateSql),
      ]);
      assert.equal(concurrentCreateA.status, 0, concurrentCreateA.stderr);
      assert.equal(concurrentCreateB.status, 0, concurrentCreateB.stderr);
      assert.equal(concurrentCreateA.stdout.trim(), concurrentCreateB.stdout.trim());
      assert.equal(
        sql(`select count(*) from public.listings where title='Concurrent replay';`),
        "1",
      );

      // Direct Data API drafts may remain partial, but any optional field that
      // is supplied is bounded at the database boundary on both INSERT and
      // UPDATE. This keeps the compatibility surface from becoming an
      // unbounded or invalid-value bypass around the trusted draft RPC.
      for (const [column, expression, expectedField] of [
        ["category", "repeat('c',81)", "category"],
        ["price", "-1", "price"],
        ["description", "repeat('d',5001)", "description"],
        ["condition", "repeat('o',81)", "condition"],
        ["location", "repeat('l',201)", "location"],
      ]) {
        assert.match(
          sql(`${claims}
            insert into public.listings(
              id,seller_id,slug,title,status,${column}
            ) values (
              '${partialDraftListing}','${owner}','bad-direct-draft',
              'Partial draft','draft',${expression}
            );`, true),
          new RegExp(`listing_required_fields_missing:${expectedField}`, "i"),
        );
      }
      sql(`${claims}
        insert into public.listings(id,seller_id,slug,title,status)
        values (
          '${partialDraftListing}','${owner}','partial-direct-draft',
          'Partial draft','draft'
        );`);
      for (const [column, expression, expectedField] of [
        ["category", "repeat('c',81)", "category"],
        ["price", "1000001", "price"],
        ["description", "repeat('d',5001)", "description"],
        ["condition", "repeat('o',81)", "condition"],
        ["location", "repeat('l',201)", "location"],
      ]) {
        assert.match(
          sql(`${claims} update public.listings set ${column}=${expression}
            where id='${partialDraftListing}';`, true),
          new RegExp(`listing_required_fields_missing:${expectedField}`, "i"),
        );
      }
      sql(`insert into storage.objects(bucket_id,name,owner_id)
        select
          'listing-images',
          '${owner}/${partialDraftListing}/limit-'||position||'.webp',
          '${owner}'
        from generate_series(0,10) position;`);
      assert.match(
        sql(`${claims}
          insert into public.listing_images(
            id,listing_id,image_url,storage_path,position
          )
          select
            gen_random_uuid(),
            '${partialDraftListing}',
            'https://bmnfynufuqjwjmtlfdxf.supabase.co/storage/v1/object/public/listing-images/'
              ||'${owner}/${partialDraftListing}/limit-'||ordinal||'.webp',
            '${owner}/${partialDraftListing}/limit-'||ordinal||'.webp',
            ordinal % 10
          from generate_series(0,10) ordinal;`, true),
        /listing_image_limit_exceeded/i,
      );
      assert.equal(
        sql(`select count(*) from public.listing_images
          where listing_id='${partialDraftListing}';`),
        "0",
      );

      // Foundation compatibility: the previously deployed app can still
      // create a complete inactive row before it uploads image metadata.
      assert.match(
        sql(`${claims}
          insert into public.listings(
            id,seller_id,slug,title,description,price,category,condition,location,status
          ) values (
            '${incompleteLegacyListing}','${owner}','legacy-incomplete','Legacy incomplete',
            null,null,null,null,null,'inactive'
          );`, true),
        /listing_required_fields_missing:category,price,description,condition,location/i,
      );
      assert.equal(
        sql(`select count(*) from public.listings where id='${incompleteLegacyListing}';`),
        "0",
      );
      sql(`${claims}
        insert into public.listings(
          id,seller_id,slug,title,description,price,category,condition,location,status,is_negotiable
        ) values (
          '${legacyListing}','${owner}','legacy-complete','Legacy complete','Ready',10,
          'Books','Used','Casa Loma','inactive',false
        );`);
      assert.equal(
        sql(`select status from public.listings where id='${legacyListing}';`),
        "inactive",
      );
      sql(`begin;
        set local app.listing_integrity_context='listing_contract_migration';
        update public.listings set status='draft' where id='${legacyListing}';
        commit;`);
      assert.match(
        sql(`${claims} select (public.transition_owned_listing_status('${legacyListing}','submit_for_review')).id;`, true),
        /listing_required_fields_missing:images/i,
      );

      const storagePath = `${owner}/${legacyListing}/cover.webp`;
      const wrongOwnerPath = `${owner}/${legacyListing}/wrong-owner.webp`;
      sql(`insert into storage.objects(bucket_id,name,owner_id)
        values
          ('listing-images','${storagePath}','${owner}'),
          ('listing-images','${wrongOwnerPath}','${otherOwner}');`);
      assert.match(
        sql(`${claims}
          insert into public.listing_images(id,listing_id,image_url,storage_path,position)
          values (
            '${imageId}','${legacyListing}',
            'https://evil.example/storage/v1/object/public/listing-images/${storagePath}',
            '${storagePath}',0
          );`, true),
        /listing_image_url_path_mismatch/i,
      );
      assert.match(
        sql(`${claims}
          insert into public.listing_images(id,listing_id,image_url,storage_path,position)
          values (
            '${imageId}','${legacyListing}',
            'https://bmnfynufuqjwjmtlfdxf.supabase.co/storage/v1/object/public/listing-images/${storagePath}?redirect=${storagePath}',
            '${storagePath}',0
          );`, true),
        /listing_image_url_path_mismatch/i,
      );
      assert.match(
        sql(`${claims}
          insert into public.listing_images(id,listing_id,image_url,storage_path,position)
          values (
            '${imageId}','${legacyListing}',
            'https://bmnfynufuqjwjmtlfdxf.supabase.co/storage/v1/object/public/listing-images/${wrongOwnerPath}',
            '${wrongOwnerPath}',0
          );`, true),
        /listing_image_storage_object_not_found_or_owned/i,
      );
      assert.match(
        sql(`${claims}
          set app.listing_integrity_context='trusted_draft_image_replace';
          insert into public.listing_images(id,listing_id,image_url,storage_path,position)
          values (
            '${imageId}','${legacyListing}',
            'https://bmnfynufuqjwjmtlfdxf.supabase.co/storage/v1/object/public/listing-images/${storagePath}',
            '${storagePath}',0
          );`, true),
        /listing_image_replace_scope_is_not_trusted/i,
      );

      const legacyAttachPath = `${owner}/${legacyListing}/legacy-attach.webp`;
      const legacyAttachUrl = `https://bmnfynufuqjwjmtlfdxf.supabase.co/storage/v1/object/public/listing-images/${legacyAttachPath}`;
      const legacyAttachImage = "34343434-3434-4343-8343-343434343434";
      sql(`insert into storage.objects(bucket_id,name,owner_id)
        values ('listing-images','${legacyAttachPath}','${owner}');`);
      const legacyAttach = sqlAsync(`begin;
        ${claims}
        insert into public.listing_images(id,listing_id,image_url,storage_path,position)
        values (
          '${legacyAttachImage}','${legacyListing}','${legacyAttachUrl}',
          '${legacyAttachPath}',0
        );
        select pg_sleep(1);
        commit;`);
      const deleteLegacyAttach = sqlAsync(`select pg_sleep(0.2);
        delete from storage.objects
        where bucket_id='listing-images' and name='${legacyAttachPath}';`);
      const [legacyAttachResult, deleteLegacyAttachResult] = await Promise.all([
        legacyAttach,
        deleteLegacyAttach,
      ]);
      assert.equal(legacyAttachResult.status, 0, legacyAttachResult.stderr);
      assert.notEqual(deleteLegacyAttachResult.status, 0);
      assert.match(
        deleteLegacyAttachResult.stderr,
        /listing_image_storage_object_is_referenced/i,
      );
      assert.equal(
        sql(`select (select count(*) from public.listing_images
          where id='${legacyAttachImage}')::text || ':' ||
          (select count(*) from storage.objects where bucket_id='listing-images'
            and name='${legacyAttachPath}')::text;`),
        "1:1",
      );
      sql(`${claims} delete from public.listing_images where id='${legacyAttachImage}';`);
      sql(`delete from storage.objects
        where bucket_id='listing-images' and name='${legacyAttachPath}';`);

      sql(`${claims}
        insert into public.listing_images(id,listing_id,image_url,storage_path,position)
        values (
          '${imageId}','${legacyListing}',
          'https://bmnfynufuqjwjmtlfdxf.supabase.co/storage/v1/object/public/listing-images/${storagePath}',
          '${storagePath}',0
        );`);
      assert.match(
        sql(`delete from storage.objects
          where bucket_id='listing-images' and name='${storagePath}';`, true),
        /listing_image_storage_object_is_referenced/i,
      );
      assert.equal(
        sql(`${claims} select (public.transition_owned_listing_status('${legacyListing}','submit_for_review')).status;`),
        "inactive",
      );

      sql(`select public.test_moderator_approve('${legacyListing}');`);
      assert.equal(sql(`select status from public.listings where id='${legacyListing}';`), "active");

      // Additive-foundation compatibility: old clients still update listing
      // fields directly. Active, sold, and already-pending rows must keep the
      // deployed inactive + fresh submission projection until cutover.
      for (const legacyStatus of ["active", "sold", "inactive"]) {
        sql(`begin;
          set local app.listing_integrity_context='listing_contract_migration';
          update public.listings
          set status='${legacyStatus}', submitted_for_review_at='2000-01-01T00:00:00Z'
          where id='${legacyListing}';
          commit;`);
        const beforeRevision = Number(sql(
          `select content_revision from public.listings where id='${legacyListing}';`,
        ));
        sql(`${claims} update public.listings
          set title=title||' ${legacyStatus}' where id='${legacyListing}';`);
        assert.equal(
          sql(`select status||':'||(submitted_for_review_at>'2020-01-01T00:00:00Z')::text
            ||':'||(content_revision>${beforeRevision})::text
            from public.listings where id='${legacyListing}';`),
          "inactive:true:true",
        );
      }
      sql(`begin;
        set local app.listing_integrity_context='listing_contract_migration';
        update public.listings set status='active' where id='${legacyListing}';
        commit;`);
      assert.match(
        sql(`${claims} update public.listings set category=E' \t\r\n '
          where id='${legacyListing}';`, true),
        /listing_required_fields_missing:category/i,
      );
      assert.equal(
        sql(`select status||':'||(category is not null)::text
          from public.listings where id='${legacyListing}';`),
        "active:true",
      );

      // The legacy image trigger has the same compatibility contract. Test a
      // photo-only metadata update from every deployed seller-visible status.
      let nextPosition = 1;
      for (const legacyStatus of ["active", "sold", "inactive"]) {
        sql(`begin;
          set local app.listing_integrity_context='listing_contract_migration';
          update public.listings
          set status='${legacyStatus}', submitted_for_review_at='2000-01-01T00:00:00Z'
          where id='${legacyListing}';
          commit;`);
        const beforeRevision = Number(sql(
          `select content_revision from public.listings where id='${legacyListing}';`,
        ));
        sql(`${claims} update public.listing_images
          set position=${nextPosition} where id='${imageId}';`);
        nextPosition += 1;
        assert.equal(
          sql(`select status||':'||(submitted_for_review_at>'2020-01-01T00:00:00Z')::text
            ||':'||(content_revision>${beforeRevision})::text
            from public.listings where id='${legacyListing}';`),
          "inactive:true:true",
        );
      }

      // Scalar-only draft saves still claim a revision even when normalized
      // values are unchanged, so stale non-photo edits fail deterministically.
      const photoIntentRevision = Number(sql(
        `select content_revision from public.listings where id='${legacyListing}';`,
      ));
      const claimedPhotoIntentRevision = Number(sql(`${claims}
        select content_revision from public.save_owned_listing_draft(
          (select title from public.listings where id='${legacyListing}'),
          '${legacyListing}',${photoIntentRevision},
          (select description from public.listings where id='${legacyListing}'),
          (select price from public.listings where id='${legacyListing}'),
          (select category from public.listings where id='${legacyListing}'),
          (select condition from public.listings where id='${legacyListing}'),
          (select location from public.listings where id='${legacyListing}'),
          (select is_negotiable from public.listings where id='${legacyListing}')
        );`));
      assert.ok(claimedPhotoIntentRevision > photoIntentRevision);
      assert.match(
        sql(`${claims}
          select content_revision from public.save_owned_listing_draft(
            (select title from public.listings where id='${legacyListing}'),
            '${legacyListing}',${photoIntentRevision},
            (select description from public.listings where id='${legacyListing}'),
            (select price from public.listings where id='${legacyListing}'),
            (select category from public.listings where id='${legacyListing}'),
            (select condition from public.listings where id='${legacyListing}'),
            (select location from public.listings where id='${legacyListing}'),
            (select is_negotiable from public.listings where id='${legacyListing}')
          );`, true),
        /listing_review_revision_conflict/i,
      );

      sql(`begin;
        set local app.listing_integrity_context='listing_contract_migration';
        update public.listings
        set status='active', submitted_for_review_at=null
        where id='${legacyListing}';
        commit;`);
      sql(`${claims} delete from public.listing_images where id='${imageId}';`);
      assert.equal(
        sql(`select status||':'||(submitted_for_review_at is not null)::text
          from public.listings where id='${legacyListing}';`),
        "inactive:true",
      );
      assert.match(
        sql(`select public.test_moderator_approve('${legacyListing}');`, true),
        /listing_required_fields_missing:images/i,
      );

      const revision = sql(`select content_revision from public.listings where id='${legacyListing}';`);
      assert.equal(
        sql(`${claims}
          select status from public.save_owned_listing_draft(
            'Edited title','${legacyListing}',${revision},'Ready',10,'Books','Used','Casa Loma',false
          );`),
        "draft",
      );
      assert.match(
        sql(`${claims}
          select id from public.save_owned_listing_draft(
            'Stale','${legacyListing}',${revision},'Ready',10,'Books','Used','Casa Loma',false
          );`, true),
        /listing_review_revision_conflict/i,
      );
      assert.match(
        sql(`${claims}
          set app.listing_integrity_context='seller_transition';
          update public.listings set status='sold' where id='${legacyListing}';`, true),
        /listing_draft_scope_is_not_trusted/i,
      );

      sql(`${claims}
        insert into public.listing_images(listing_id,image_url,storage_path,position)
        values (
          '${legacyListing}',
          'https://bmnfynufuqjwjmtlfdxf.supabase.co/storage/v1/object/public/listing-images/${storagePath}',
          '${storagePath}',0
        );`);

      const racePathA = `${owner}/${legacyListing}/atomic-a.webp`;
      const racePathB = `${owner}/${legacyListing}/atomic-b.webp`;
      const raceUrlA = `https://bmnfynufuqjwjmtlfdxf.supabase.co/storage/v1/object/public/listing-images/${racePathA}`;
      const raceUrlB = `https://bmnfynufuqjwjmtlfdxf.supabase.co/storage/v1/object/public/listing-images/${racePathB}`;
      sql(`insert into storage.objects(bucket_id,name,owner_id) values
        ('listing-images','${racePathA}','${owner}'),
        ('listing-images','${racePathB}','${owner}');`);
      const raceRevision = Number(sql(
        `select content_revision from public.listings where id='${legacyListing}';`,
      ));
      const raceManifestBefore = sql(
        `select storage_path from public.listing_images where listing_id='${legacyListing}';`,
      );
      assert.match(
        sql(`${claims} select public.replace_owned_listing_images(
          '${legacyListing}',${raceRevision},
          jsonb_build_array(jsonb_build_object(
            'id','${raceImageA}',
            'image_url','https://evil.example/storage/v1/object/public/listing-images/${racePathA}',
            'storage_path','${racePathA}',
            'position',0
          ))
        );`, true),
        /listing_image_url_path_mismatch/i,
      );
      assert.match(
        sql(`${claims} select public.replace_owned_listing_images(
          '${legacyListing}',${raceRevision},
          (select jsonb_agg(jsonb_build_object(
            'id',gen_random_uuid(),
            'image_url','${raceUrlA}',
            'storage_path','${racePathA}',
            'position',position
          )) from generate_series(0,10) position)
        );`, true),
        /listing_image_limit_exceeded/i,
      );

      const atomicWrite = ({ title, imageId: atomicImageId, imageUrl, storagePath: path }) => `${claims}
        select public.save_owned_listing_draft_with_images(
          '${legacyListing}',
          ${raceRevision},
          jsonb_build_array(jsonb_build_object(
            'id','${atomicImageId}',
            'image_url','${imageUrl}',
            'storage_path','${path}',
            'position',0
          )),
          '${title}','Ready',10,'Books','Used','Casa Loma',false
        );`;
      const firstWriter = sqlAsync(`begin;
        ${atomicWrite({
          title: "Atomic A",
          imageId: raceImageA,
          imageUrl: raceUrlA,
          storagePath: racePathA,
        })}
        select pg_sleep(1);
        commit;`);
      const secondWriter = sqlAsync(`select pg_sleep(0.2);
        ${atomicWrite({
          title: "Atomic B",
          imageId: raceImageB,
          imageUrl: raceUrlB,
          storagePath: racePathB,
        })}`);

      await new Promise((resolve) => setTimeout(resolve, 400));
      assert.equal(
        sql(`select content_revision||':'||(
          select storage_path from public.listing_images
          where listing_id='${legacyListing}' limit 1
        ) from public.listings where id='${legacyListing}';`),
        `${raceRevision}:${raceManifestBefore}`,
      );

      const [firstResult, secondResult] = await Promise.all([firstWriter, secondWriter]);
      assert.equal(firstResult.status, 0, firstResult.stderr || firstResult.stdout);
      assert.notEqual(secondResult.status, 0, "second same-revision image swap must fail");
      assert.match(secondResult.stderr, /listing_review_revision_conflict/i);
      assert.equal(
        sql(`select listing.content_revision||':'||listing.title||':'||count(image.id)
          ||':'||min(image.storage_path)
          from public.listings listing
          left join public.listing_images image on image.listing_id=listing.id
          where listing.id='${legacyListing}'
          group by listing.id;`),
        `${raceRevision + 1}:Atomic A:1:${racePathA}`,
      );

      // Mixed legacy DELETE and atomic replacement share image-row -> parent
      // lock order. The replacement waits and then fails its revision check;
      // neither session can form a parent/image deadlock.
      const mixedDelete = sqlAsync(`begin;
        ${claims}
        delete from public.listing_images where id='${raceImageA}';
        select pg_sleep(1);
        commit;`);
      const mixedAtomic = sqlAsync(`select pg_sleep(0.2);
        ${claims}
        select public.replace_owned_listing_images(
          '${legacyListing}',${raceRevision + 1},
          jsonb_build_array(jsonb_build_object(
            'id','${raceImageB}',
            'image_url','${raceUrlB}',
            'storage_path','${racePathB}',
            'position',0
          ))
        );`);
      const [mixedDeleteResult, mixedAtomicResult] = await Promise.all([
        mixedDelete,
        mixedAtomic,
      ]);
      assert.equal(mixedDeleteResult.status, 0, mixedDeleteResult.stderr);
      assert.notEqual(mixedAtomicResult.status, 0);
      assert.match(mixedAtomicResult.stderr, /listing_review_revision_conflict/i);
      sql(`delete from storage.objects
        where bucket_id='listing-images' and name='${racePathA}';`);
      assert.equal(
        sql(`select count(*) from storage.objects
          where bucket_id='listing-images' and name='${racePathA}';`),
        "0",
      );

      // Attach locks the Storage object until metadata commits. A concurrent
      // object deletion blocks, then the reference guard rejects it.
      const guardedPath = `${owner}/${legacyListing}/guarded.webp`;
      const guardedUrl = `https://bmnfynufuqjwjmtlfdxf.supabase.co/storage/v1/object/public/listing-images/${guardedPath}`;
      const guardedImage = "12121212-1212-4121-8121-121212121212";
      sql(`insert into storage.objects(bucket_id,name,owner_id)
        values ('listing-images','${guardedPath}','${owner}');`);
      const guardedRevision = Number(sql(
        `select content_revision from public.listings where id='${legacyListing}';`,
      ));
      const attachGuarded = sqlAsync(`begin;
        ${claims}
        select public.replace_owned_listing_images(
          '${legacyListing}',${guardedRevision},
          jsonb_build_array(jsonb_build_object(
            'id','${guardedImage}',
            'image_url','${guardedUrl}',
            'storage_path','${guardedPath}',
            'position',0
          ))
        );
        select pg_sleep(1);
        commit;`);
      const deleteDuringAttach = sqlAsync(`select pg_sleep(0.2);
        delete from storage.objects
        where bucket_id='listing-images' and name='${guardedPath}';`);
      const [attachGuardedResult, deleteDuringAttachResult] = await Promise.all([
        attachGuarded,
        deleteDuringAttach,
      ]);
      assert.equal(attachGuardedResult.status, 0, attachGuardedResult.stderr);
      assert.notEqual(deleteDuringAttachResult.status, 0);
      assert.match(
        deleteDuringAttachResult.stderr,
        /listing_image_storage_object_is_referenced/i,
      );

      // Exact image and transition operation replay returns the original
      // result even though the expected revision is now stale. Reusing the
      // operation for another manifest is rejected.
      const idempotentImageRevision = Number(sql(
        `select content_revision from public.listings where id='${legacyListing}';`,
      ));
      const idempotentImageSql = `${claims}
        select public.replace_owned_listing_images_idempotent(
          '${imageOperation}','${legacyListing}',${idempotentImageRevision},
          jsonb_build_array(jsonb_build_object(
            'id','${guardedImage}',
            'image_url','${guardedUrl}',
            'storage_path','${guardedPath}',
            'position',0
          ))
        );`;
      const idempotentImageA = sqlAsync(`begin;
        ${idempotentImageSql}
        select pg_sleep(1);
        commit;`);
      const idempotentImageB = sqlAsync(`select pg_sleep(0.2);
        ${idempotentImageSql}`);
      const [idempotentImageAResult, idempotentImageBResult] = await Promise.all([
        idempotentImageA,
        idempotentImageB,
      ]);
      assert.equal(idempotentImageAResult.status, 0, idempotentImageAResult.stderr);
      assert.equal(idempotentImageBResult.status, 0, idempotentImageBResult.stderr);
      const idempotentImageResult = idempotentImageBResult.stdout.trim();
      assert.match(idempotentImageAResult.stdout, new RegExp(`^${idempotentImageResult}`, "m"));
      assert.equal(sql(idempotentImageSql), idempotentImageResult);
      assert.match(
        sql(`${claims} select public.replace_owned_listing_images_idempotent(
          '${imageOperation}','${legacyListing}',${idempotentImageRevision},'[]'::jsonb
        );`, true),
        /listing_operation_payload_conflict/i,
      );

      const transitionSql = `${claims}
        select (public.transition_owned_listing_status_idempotent(
          '${transitionOperation}','${legacyListing}','submit_for_review'
        )).status;`;
      assert.equal(sql(transitionSql), "inactive");
      assert.equal(sql(transitionSql), "inactive");
      sql(`begin;
        set local app.listing_integrity_context='listing_contract_migration';
        update public.listings set status='active' where id='${legacyListing}';
        commit;`);
      assert.equal(sql(transitionSql), "inactive");
      assert.equal(
        sql(`select status from public.listings where id='${legacyListing}';`),
        "active",
      );

      // Failed-create cleanup is revision conditional. A concurrent draft edit
      // wins first; cleanup observes the new revision and preserves the row.
      const discardBaseRevision = Number(sql(
        `select content_revision from public.listings where id='${replayDraftId}';`,
      ));
      const concurrentDraftEdit = sqlAsync(`begin;
        ${claims}
        select id from public.save_owned_listing_draft_idempotent(
          '${discardOperation}','Replay draft','${replayDraftId}',${discardBaseRevision}
        );
        select pg_sleep(1);
        commit;`);
      const staleDiscard = sqlAsync(`select pg_sleep(0.2);
        ${claims}
        select public.discard_owned_listing_draft_if_unchanged(
          '${replayDraftId}',${discardBaseRevision}
        );`);
      const [concurrentDraftEditResult, staleDiscardResult] = await Promise.all([
        concurrentDraftEdit,
        staleDiscard,
      ]);
      assert.equal(concurrentDraftEditResult.status, 0, concurrentDraftEditResult.stderr);
      assert.notEqual(staleDiscardResult.status, 0);
      assert.match(staleDiscardResult.stderr, /listing_review_revision_conflict/i);
      assert.equal(
        sql(`select count(*) from public.listings where id='${replayDraftId}';`),
        "1",
      );

      const disposableDraftId = sql(`${claims}
        select id from public.save_owned_listing_draft_idempotent(
          'abababab-abab-4bab-8bab-abababababab','Disposable draft'
        );`);
      const discardReplaySql = `${claims}
        select public.discard_owned_listing_draft_if_unchanged_idempotent(
          'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd','${disposableDraftId}',1
        );`;
      assert.equal(sql(discardReplaySql), "t");
      assert.equal(sql(discardReplaySql), "t");
      assert.equal(
        sql(`select count(*) from public.listings where id='${disposableDraftId}';`),
        "0",
      );

      // Retirement snapshots the exact ordered Storage paths in the same
      // transaction that removes their metadata. An exact replay after the row
      // is scrubbed returns that immutable cleanup result; operation reuse and
      // cross-actor access fail closed.
      const retirePathA = `${owner}/${retireListing}/front.webp`;
      const retirePathB = `${owner}/${retireListing}/back.webp`;
      sql(`begin;
        set local app.listing_integrity_context='listing_contract_migration';
        insert into public.listings(
          id,seller_id,slug,title,description,price,category,condition,location,status
        ) values (
          '${retireListing}','${owner}','retire-me','Retire me','Complete',20,
          'Books','Used','Casa Loma','draft'
        );
        commit;
        insert into storage.objects(bucket_id,name,owner_id) values
          ('listing-images','${retirePathA}','${owner}'),
          ('listing-images','${retirePathB}','${owner}');`);
      sql(`${claims} insert into public.listing_images(
          listing_id,image_url,storage_path,position
        ) values
          ('${retireListing}','https://bmnfynufuqjwjmtlfdxf.supabase.co/storage/v1/object/public/listing-images/${retirePathB}','${retirePathB}',1),
          ('${retireListing}','https://bmnfynufuqjwjmtlfdxf.supabase.co/storage/v1/object/public/listing-images/${retirePathA}','${retirePathA}',0);`);
      const retireSql = `${claims}
        select public.retire_owned_listing_idempotent(
          '${retireOperation}','${retireListing}'
        );`;
      const firstRetireResult = JSON.parse(sql(retireSql));
      assert.deepEqual(firstRetireResult.storage_paths, [retirePathA, retirePathB]);
      assert.equal(firstRetireResult.listing_id, retireListing);
      assert.deepEqual(JSON.parse(sql(retireSql)), firstRetireResult);
      assert.equal(
        sql(`select (retired_at is not null)::text||':'||title||':'||(
          select count(*) from public.listing_images where listing_id='${retireListing}'
        ) from public.listings where id='${retireListing}';`),
        "true:Deleted listing:0",
      );
      assert.match(
        sql(`${claims} select public.retire_owned_listing_idempotent(
          '${retireOperation}','${legacyListing}'
        );`, true),
        /listing_operation_payload_conflict/i,
      );
      assert.match(
        sql(`${otherClaims} select public.retire_owned_listing_idempotent(
          '${retireOperation}','${retireListing}'
        );`, true),
        /listing_owner_mismatch/i,
      );
      assert.match(
        sql(`${claims} select * from listing_action_private.retire_owned_listing_idempotent_impl(
          '${retireOperation}','${retireListing}'
        );`, true),
        /permission denied for schema listing_action_private/i,
      );

      // The durable recovery contract uses one actor-scoped operation across
      // draft creation, upload reservation, metadata attachment, and cleanup.
      const durableCreateOperation = "10101010-1010-4010-8010-101010101010";
      const durableCreateSignature = "a".repeat(64);
      const durableCreateIntent = `${claims} select public.begin_owned_listing_write_intent(
        '${durableCreateOperation}','create_listing','${durableCreateSignature}'
      );`;
      assert.equal(JSON.parse(sql(durableCreateIntent)).stage, "begun");
      const durableListing = sql(`${claims}
        select id from public.commit_owned_listing_create_draft_intent(
          '${durableCreateOperation}','${durableCreateSignature}',
          'Durable listing','Complete',25,'Books','Used','Casa Loma',false
        );`);
      const replayedCreateAfterDraft = JSON.parse(sql(durableCreateIntent));
      assert.equal(replayedCreateAfterDraft.stage, "draft_created");
      assert.equal(replayedCreateAfterDraft.listing_id, durableListing);
      const durablePath = `${owner}/${durableListing}/${durableCreateOperation}-cover.webp`;
      const durableImage = "20202020-2020-4020-8020-202020202020";
      const reserveDurable = `${claims} select public.reserve_owned_listing_image_uploads(
        '${durableCreateOperation}','${durableCreateSignature}','${durableListing}',
        jsonb_build_array(jsonb_build_object(
          'storage_path','${durablePath}','file_name','cover.webp',
          'mime_type','image/webp','size_bytes',100
        ))
      );`;
      assert.equal(JSON.parse(sql(reserveDurable)).length, 1);
      sql(`${claims} insert into storage.objects(bucket_id,name,owner_id)
        values ('listing-images','${durablePath}','${owner}');`);
      assert.equal(sql(`${claims}
        select public.verify_owned_listing_reserved_upload(
          '${durableCreateOperation}','${durableCreateSignature}','${durablePath}'
        );`), "t");
      assert.match(
        sql(`${otherClaims} select public.verify_owned_listing_reserved_upload(
          '${durableCreateOperation}','${durableCreateSignature}','${durablePath}'
        );`, true),
        /listing_write_intent_conflict/i,
      );
      const durableManifest = `jsonb_build_array(jsonb_build_object(
        'id','${durableImage}',
        'image_url','https://bmnfynufuqjwjmtlfdxf.supabase.co/storage/v1/object/public/listing-images/${durablePath}',
        'storage_path','${durablePath}','position',0
      ))`;
      const durableCommit = `${claims} select public.commit_owned_listing_create_intent(
        '${durableCreateOperation}','${durableCreateSignature}',${durableManifest},false
      );`;
      const firstDurableResult = JSON.parse(sql(durableCommit));
      assert.equal(firstDurableResult.listing_id, durableListing);
      assert.deepEqual(JSON.parse(sql(durableCommit)), firstDurableResult);
      assert.equal(
        sql(`select count(*) from public.listing_images
          where listing_id='${durableListing}' and storage_path='${durablePath}';`),
        "1",
      );
      assert.match(
        sql(`${claims} select listing_action_private.get_owned_listing_write_intent_impl(
          '${durableCreateOperation}'
        );`, true),
        /permission denied for schema listing_action_private/i,
      );

      const durableEditOperation = "30303030-3030-4030-8030-303030303030";
      const durableEditSignature = "b".repeat(64);
      const durableEditRevision = Number(firstDurableResult.content_revision);
      assert.equal(JSON.parse(sql(`${claims}
        select public.begin_owned_listing_write_intent(
          '${durableEditOperation}','edit_listing','${durableEditSignature}',
          '${durableListing}',${durableEditRevision},false
        );`)).stage, "begun");
      const replacementPath = `${owner}/${durableListing}/${durableEditOperation}-cover.webp`;
      const replacementImage = "40404040-4040-4040-8040-404040404040";
      assert.equal(JSON.parse(sql(`${claims}
        select public.reserve_owned_listing_image_uploads(
          '${durableEditOperation}','${durableEditSignature}','${durableListing}',
          jsonb_build_array(jsonb_build_object(
            'storage_path','${replacementPath}','file_name','replacement.webp',
            'mime_type','image/webp','size_bytes',120
          ))
        );`)).length, 1);
      sql(`${claims} insert into storage.objects(bucket_id,name,owner_id)
        values ('listing-images','${replacementPath}','${owner}');`);
      const replacementManifest = `jsonb_build_array(jsonb_build_object(
        'id','${replacementImage}',
        'image_url','https://bmnfynufuqjwjmtlfdxf.supabase.co/storage/v1/object/public/listing-images/${replacementPath}',
        'storage_path','${replacementPath}','position',0
      ))`;
      const durableEdit = `${claims} select public.commit_owned_listing_edit_intent(
        '${durableEditOperation}','${durableEditSignature}',${replacementManifest},
        'Durable listing edited','Complete',30,'Books','Used','Casa Loma',false
      );`;
      const firstDurableEdit = JSON.parse(sql(durableEdit));
      assert.equal(firstDurableEdit.cleanup_task_count, 1);
      assert.deepEqual(JSON.parse(sql(durableEdit)), firstDurableEdit);
      assert.equal(
        sql(`select string_agg(storage_path,',') from public.listing_images
          where listing_id='${durableListing}';`),
        replacementPath,
      );
      sql(`${claims} delete from storage.objects
        where bucket_id='listing-images' and name='${durablePath}';`);
      const ownedCleanup = JSON.parse(sql(`${claims}
        select row_to_json(task) from public.claim_owned_listing_image_cleanup_tasks(20) task
        where task.storage_path='${durablePath}';`));
      assert.equal(sql(`${claims} select public.complete_owned_listing_image_cleanup_task(
        '${ownedCleanup.task_id}','${ownedCleanup.lease_token}'
      );`), "t");
      assert.equal(sql(`${claims} select public.complete_owned_listing_image_cleanup_task(
        '${ownedCleanup.task_id}','${ownedCleanup.lease_token}'
      );`), "t");
      assert.equal(
        JSON.parse(sql(`${claims} select public.get_owned_listing_write_intent(
          '${durableEditOperation}'
        );`)).cleanup_pending,
        false,
      );

      // Maintenance aborts stale operations even when no upload reservation
      // exists, and removes only an untouched orphan create draft.
      const staleBegunOperation = "41414141-4141-4141-8141-414141414141";
      const staleDraftOperation = "42424242-4242-4242-8242-424242424242";
      const staleSignature = "e".repeat(64);
      sql(`${claims} select public.begin_owned_listing_write_intent(
        '${staleBegunOperation}','create_listing','${staleSignature}'
      );`);
      sql(`${claims} select public.begin_owned_listing_write_intent(
        '${staleDraftOperation}','create_listing','${staleSignature}'
      );`);
      const staleDraftListing = sql(`${claims}
        select id from public.commit_owned_listing_create_draft_intent(
          '${staleDraftOperation}','${staleSignature}',
          'Abandoned draft',null,null,null,null,null,false
        );`);
      sql(`update listing_action_private.write_intents
        set updated_at=now()-interval '25 hours'
        where actor_user_id='${owner}'
          and operation_id in ('${staleBegunOperation}','${staleDraftOperation}');`);
      const maintenanceBeforeRetirement = JSON.parse(sql(`${serviceClaims}
        select public.maintain_listing_write_recovery(100);`));
      assert.equal(maintenanceBeforeRetirement.reconciled_intents, 2);
      assert.equal(sql(`select count(*) from public.listings
        where id='${staleDraftListing}';`), "0");
      assert.equal(
        JSON.parse(sql(`${claims} select public.get_owned_listing_write_intent(
          '${staleDraftOperation}'
        );`)).stage,
        "aborted",
      );

      // Storage upload and account retirement serialize on the same actor
      // advisory barrier. The in-flight upload commits before prepare scans it;
      // every later upload for the retired actor is rejected.
      const retirementUploadPath = `${otherOwner}/abababab-abab-4bab-8bab-abababababab/in-flight.webp`;
      const inFlightUpload = sqlAsync(`begin; ${otherClaims}
        insert into storage.objects(bucket_id,name,owner_id)
        values ('listing-images','${retirementUploadPath}','${otherOwner}');
        select pg_sleep(1); commit;`);
      const retirementOperation = "50505050-5050-4050-8050-505050505050";
      const prepareRetirement = sqlAsync(`select pg_sleep(0.2);
        set role service_role;
        set request.jwt.claims='{"role":"service_role"}';
        select public.prepare_listing_account_retirement(
          '${otherOwner}','${retirementOperation}'
        );`);
      const [uploadResult, prepareResult] = await Promise.all([
        inFlightUpload,
        prepareRetirement,
      ]);
      assert.equal(uploadResult.status, 0, uploadResult.stderr);
      assert.equal(prepareResult.status, 0, prepareResult.stderr);
      assert.equal(JSON.parse(prepareResult.stdout.trim()).cleanup_task_count, 1);
      assert.match(
        sql(`${otherClaims} insert into storage.objects(bucket_id,name,owner_id)
          values ('listing-images','${otherOwner}/abababab-abab-4bab-8bab-abababababab/late.webp','${otherOwner}');`, true),
        /listing_account_retirement_in_progress/i,
      );
      const accountCleanup = JSON.parse(sql(`${serviceClaims}
        select row_to_json(task) from public.claim_listing_account_cleanup_tasks(
          '${otherOwner}','${retirementOperation}',100
        ) task where task.storage_path='${retirementUploadPath}';`));
      assert.equal(accountCleanup.actor_user_id_snapshot, otherOwner);
      assert.equal(accountCleanup.reason, "account_deleted");
      sql(`delete from storage.objects where bucket_id='listing-images'
        and name='${retirementUploadPath}';`);
      assert.equal(sql(`${serviceClaims}
        select public.complete_listing_image_cleanup_task(
          '${accountCleanup.task_id}','${accountCleanup.lease_token}'
        );`), "t");
      assert.equal(
        JSON.parse(sql(`${serviceClaims}
          select public.finalize_listing_account_retirement(
            '${otherOwner}','${retirementOperation}'
          );`)).state,
        "complete",
      );
      assert.equal(
        JSON.parse(sql(`${serviceClaims}
          select public.prepare_listing_account_retirement(
            '${otherOwner}','${retirementOperation}'
          );`)).state,
        "ready",
      );

      // A historical cleaned path is re-armed under the account barrier and
      // normalized to an account-deletion task before exact cleanup/finalize.
      const cleanupClaims = `set role authenticated;
        set request.jwt.claims='{"role":"authenticated","sub":"${cleanupOwner}"}';`;
      const cleanupOperation = "51515151-5151-4151-8151-515151515151";
      const historicalTask = "52525252-5252-4252-8252-525252525252";
      const historicalCompletion = "53535353-5353-4353-8353-535353535353";
      const cleanupIntent = "54545454-5454-4454-8454-545454545454";
      const cleanupCommand = "56565656-5656-4656-8656-565656565656";
      const historicalPath = `${cleanupOwner}/legacy-file.webp`;
      sql(`${cleanupClaims} select public.begin_owned_listing_write_intent(
        '${cleanupIntent}','create_listing','${"f".repeat(64)}'
      );`);
      sql(`insert into listing_action_private.write_command_results(
        actor_user_id,operation_id,action,payload,result
      ) values (
        '${cleanupOwner}','${cleanupCommand}','cleanup_test',
        '{"private":"payload"}'::jsonb,'{"private":"result"}'::jsonb
      );`);
      sql(`insert into listing_action_private.image_cleanup_tasks(
        id,actor_user_id_snapshot,source_operation_id,storage_path,reason,
        state,completion_token,cleaned_at
      ) values (
        '${historicalTask}','${cleanupOwner}','${historicalCompletion}',
        '${historicalPath}','listing_retired','cleaned',
        '${historicalCompletion}',now()-interval '1 day'
      );`);
      sql(`${cleanupClaims} insert into storage.objects(bucket_id,name,owner_id)
        values ('listing-images','${historicalPath}','${cleanupOwner}');`);
      assert.equal(
        JSON.parse(sql(`${serviceClaims}
          select public.prepare_listing_account_retirement(
            '${cleanupOwner}','${cleanupOperation}'
          );`)).cleanup_task_count,
        1,
      );
      assert.equal(sql(`select count(*) from listing_action_private.write_intents
        where actor_user_id='${cleanupOwner}';`), "0");
      assert.equal(sql(`select count(*) from listing_action_private.write_intent_tombstones
        where actor_user_id_snapshot='${cleanupOwner}'
          and operation_id='${cleanupIntent}';`), "1");
      assert.equal(sql(`select payload::text||':'||(scrubbed_at is not null)::text
        from listing_action_private.write_command_results
        where actor_user_id='${cleanupOwner}'
          and operation_id='${cleanupCommand}';`), "{}:true");
      const historicalCleanup = JSON.parse(sql(`${serviceClaims}
        select row_to_json(task) from public.claim_listing_account_cleanup_tasks(
          '${cleanupOwner}','${cleanupOperation}',100
        ) task where task.storage_path='${historicalPath}';`));
      assert.equal(historicalCleanup.actor_user_id_snapshot, cleanupOwner);
      assert.equal(historicalCleanup.reason, "account_deleted");
      sql(`delete from storage.objects where bucket_id='listing-images'
        and name='${historicalPath}';`);
      assert.equal(sql(`${serviceClaims}
        select public.complete_listing_image_cleanup_task(
          '${historicalCleanup.task_id}','${historicalCleanup.lease_token}'
        );`), "t");
      assert.equal(
        JSON.parse(sql(`${serviceClaims}
          select public.finalize_listing_account_retirement(
            '${cleanupOwner}','${cleanupOperation}'
          );`)).state,
        "complete",
      );

      // Replay payloads are scrubbed at expiry, while old terminal queue,
      // reservation, intent, tombstone, and command rows are purged in bounded
      // maintenance batches after their recovery/audit retention windows.
      sql(`update listing_action_private.write_intents
        set replay_expires_at=now()-interval '1 day'
        where actor_user_id='${owner}'
          and operation_id='${durableCreateOperation}';
        update listing_action_private.image_cleanup_tasks
        set cleaned_at=now()-interval '31 days'
        where id='${historicalTask}';
        update listing_action_private.write_command_results
        set scrubbed_at=now()-interval '91 days'
        where actor_user_id='${cleanupOwner}'
          and operation_id='${cleanupCommand}';`);
      sql(`${serviceClaims} select public.maintain_listing_write_recovery(100);`);
      assert.equal(sql(`select count(*)
        from listing_action_private.image_upload_reservations
        where actor_user_id_snapshot='${owner}'
          and operation_id='${durableCreateOperation}';`), "0");
      assert.equal(sql(`select count(*) from listing_action_private.image_cleanup_tasks
        where id='${historicalTask}';`), "0");
      assert.equal(sql(`select count(*) from listing_action_private.write_command_results
        where actor_user_id='${cleanupOwner}'
          and operation_id='${cleanupCommand}';`), "0");
      sql(`update listing_action_private.write_intents
        set scrubbed_at=now()-interval '31 days'
        where actor_user_id='${owner}'
          and operation_id='${durableCreateOperation}';
        update listing_action_private.write_intent_tombstones
        set scrubbed_at=now()-interval '91 days'
        where actor_user_id_snapshot='${owner}'
          and operation_id='${durableCreateOperation}';`);
      sql(`${serviceClaims} select public.maintain_listing_write_recovery(100);`);
      assert.equal(sql(`select count(*) from listing_action_private.write_intents
        where actor_user_id='${owner}'
          and operation_id='${durableCreateOperation}';`), "0");
      assert.equal(sql(`select count(*) from listing_action_private.write_intent_tombstones
        where actor_user_id_snapshot='${owner}'
          and operation_id='${durableCreateOperation}';`), "0");
      assert.deepEqual(
        Object.keys(JSON.parse(sql(`${serviceClaims}
          select public.maintain_listing_write_recovery(100);`))).sort(),
        [
          "compacted_commands",
          "expired_reservations_enqueued",
          "purged_cleanup_tasks",
          "purged_commands",
          "purged_intents",
          "purged_reservations",
          "purged_tombstones",
          "reconciled_intents",
          "scrubbed_intents",
        ],
      );

      sql(`insert into public.user_status(user_id,is_banned,banned_until)
        values ('${owner}',true,now()+interval '1 day');`);
      assert.match(
        sql(`${claims} select id from public.save_owned_listing_draft('Blocked');`, true),
        /account_is_banned/i,
      );
      sql(`begin;
        set local app.listing_integrity_context='listing_contract_migration';
        update public.listings set status='draft' where id='${legacyListing}';
        commit;`);
      assert.match(
        sql(`${claims} select public.replace_owned_listing_images(
          '${legacyListing}',${idempotentImageResult},
          jsonb_build_array(jsonb_build_object(
            'id','${raceImageA}',
            'image_url','${raceUrlA}',
            'storage_path','${racePathA}',
            'position',0
          ))
        );`, true),
        /account_is_banned/i,
      );
      assert.match(
        sql(`${claims} select (public.transition_owned_listing_status('${legacyListing}','submit_for_review')).id;`, true),
        /account_is_banned/i,
      );
    } finally {
      if (started) {
        spawnSync(join(postgresBin, "pg_ctl"), ["-D", data, "-m", "fast", "stop"]);
      }
      await rm(cluster, { recursive: true, force: true });
    }
  },
);

const BOOTSTRAP_SQL = String.raw`
create role postgres superuser;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create extension if not exists pgcrypto;
create schema auth;
create schema private;
create schema storage;

create function auth.jwt() returns jsonb language sql stable
as $body$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $body$;
create function auth.uid() returns uuid language sql stable
as $body$ select nullif(auth.jwt()->>'sub','')::uuid $body$;

create table auth.users(
  id uuid primary key,
  banned_until timestamptz
);
create table public.user_status(
  user_id uuid primary key,
  is_banned boolean not null default false,
  banned_until timestamptz
);
create table public.listings(
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null,
  slug text not null unique,
  title text not null,
  description text not null,
  price numeric not null,
  category text not null,
  condition text not null,
  location text,
  status text not null default 'draft',
  is_negotiable boolean not null default false,
  previous_price numeric,
  content_revision bigint not null default 1,
  retired_at timestamptz,
  submitted_for_review_at timestamptz,
  moderation_feedback text,
  moderation_reviewed_at timestamptz,
  moderation_reviewed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table storage.objects(
  bucket_id text not null,
  name text not null,
  owner_id text,
  primary key(bucket_id,name)
);
create table public.listing_images(
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  image_url text not null,
  storage_path text not null unique,
  position integer not null
);
create table public.reports(
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.listings(id)
);
create table public.listing_moderation_history(
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.listings(id)
);
create table public.conversations(
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.listings(id)
);

create function public.discard_owned_listing_draft(p_listing_id uuid) returns void
language sql security invoker as $body$ select null::void $body$;
grant execute on function public.discard_owned_listing_draft(uuid) to authenticated;

create function public.enforce_listing_integrity() returns trigger
language plpgsql as $body$ begin return new; end $body$;
create trigger enforce_listing_integrity before insert or update on public.listings
for each row execute function public.enforce_listing_integrity();

create function private.reject_banned_authenticated_write() returns trigger
language plpgsql security definer set search_path=''
as $body$
begin
  if coalesce(auth.jwt()->>'role','')='authenticated' and exists (
    select 1 from public.user_status s where s.user_id=auth.uid() and s.is_banned
      and (s.banned_until is null or s.banned_until>statement_timestamp())
  ) then
    raise exception using errcode='42501',message='account_is_banned';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $body$;
alter function private.reject_banned_authenticated_write() owner to postgres;
create trigger reject_banned_authenticated_write before insert or update or delete on public.listings
for each row execute function private.reject_banned_authenticated_write();

create function public.touch_listing_revision_for_image_change() returns trigger
language plpgsql security definer set search_path=''
as $body$
declare target_id uuid := case when tg_op='DELETE' then old.listing_id else new.listing_id end;
begin
  perform pg_catalog.set_config('app.listing_integrity_context','image_change',true);
  update public.listings set content_revision=content_revision+1 where id=target_id;
  return null;
end $body$;
alter function public.touch_listing_revision_for_image_change() owner to postgres;
create trigger touch_listing_revision_for_image_change after insert or update or delete on public.listing_images
for each row execute function public.touch_listing_revision_for_image_change();
create trigger reject_banned_authenticated_write before insert or update or delete on public.listing_images
for each row execute function private.reject_banned_authenticated_write();

create function public.test_moderator_approve(p_listing_id uuid) returns void
language plpgsql security definer set search_path=''
as $body$
begin
  perform pg_catalog.set_config('app.listing_integrity_context','trusted_moderation_decision',true);
  update public.listings set status='active' where id=p_listing_id;
  perform pg_catalog.set_config('app.listing_integrity_context','',true);
end $body$;
alter function public.test_moderator_approve(uuid) owner to postgres;

grant select,insert,update,delete on public.listings,public.listing_images to authenticated;
grant usage on schema storage to authenticated;
grant select,insert,delete on storage.objects to authenticated;
grant execute on function public.test_moderator_approve(uuid) to authenticated;
`;
