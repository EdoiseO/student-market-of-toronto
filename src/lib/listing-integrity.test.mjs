import assert from "node:assert/strict";
import test from "node:test";

import {
  OWNED_LISTING_STATUS_ACTIONS,
  isListingReviewRevisionConflict,
  parseListingContentRevision,
} from "./listing-integrity.mjs";

test("parses only positive safe listing content revisions", () => {
  assert.equal(parseListingContentRevision(7), 7);
  assert.equal(parseListingContentRevision("12"), 12);
  assert.equal(parseListingContentRevision(0), null);
  assert.equal(parseListingContentRevision("1.5"), null);
  assert.equal(parseListingContentRevision(Number.MAX_SAFE_INTEGER + 1), null);
});

test("recognizes database review revision conflicts", () => {
  assert.equal(isListingReviewRevisionConflict({ code: "40001" }), true);
  assert.equal(
    isListingReviewRevisionConflict({ message: "listing_review_revision_conflict" }),
    true,
  );
  assert.equal(isListingReviewRevisionConflict({ code: "42501" }), false);
});

test("uses the database status transition action names", () => {
  assert.deepEqual(OWNED_LISTING_STATUS_ACTIONS, {
    submitForReview: "submit_for_review",
    markSold: "mark_sold",
    reopenForReview: "reopen_for_review",
  });
});

test("listing integrity migration preserves audit rows on seller deletion", async () => {
  const { readFile } = await import("node:fs/promises");
  const migration = await readFile(
    new URL(
      "../../supabase/migrations/20260812112706_enforce_listing_moderation_integrity.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /before delete on public\.listings/i);
  assert.match(migration, /listing_delete_requires_retirement_rpc/i);
  assert.match(migration, /create or replace function public\.retire_owned_listing/i);
  assert.match(migration, /create or replace function public\.discard_owned_listing_draft/i);
  assert.match(migration, /listing_discard_has_dependencies/i);
  assert.match(migration, /new\.previous_price is distinct from old\.previous_price/i);
  assert.match(
    migration,
    /to_regprocedure\(\s*'public\.moderate_listing_decision\(uuid,text,text\)'/i,
  );
  assert.match(
    migration,
    /drop trigger if exists trg_enforce_listing_review_workflow on public\.listings/i,
  );
  assert.doesNotMatch(migration, /delete from public\.listing_moderation_history/i);
  assert.doesNotMatch(migration, /delete from public\.reports/i);
});
