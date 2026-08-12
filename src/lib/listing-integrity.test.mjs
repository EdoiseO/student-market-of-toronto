import assert from "node:assert/strict";
import test from "node:test";

import {
  OWNED_LISTING_STATUS_ACTIONS,
  isListingReviewRevisionConflict,
  parseListingContentRevision,
  parseListingSubmissionTimestamp,
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

test("preserves exact PostgreSQL submission timestamp precision", () => {
  const timestamp = "2026-08-12T11:27:06.123456+00:00";

  assert.equal(parseListingSubmissionTimestamp(timestamp), timestamp);
  assert.equal(parseListingSubmissionTimestamp(new Date(timestamp)), null);
  assert.equal(parseListingSubmissionTimestamp("2026-08-12"), null);
  assert.equal(parseListingSubmissionTimestamp(" 2026-08-12T11:27:06Z"), null);
});

test("moderation forwards the validated timestamp without a Date round trip", async () => {
  const { readFile } = await import("node:fs/promises");
  const route = await readFile(
    new URL("../app/api/admin/listings/[listingId]/decision/route.js", import.meta.url),
    "utf8",
  );

  assert.match(
    route,
    /p_expected_submitted_for_review_at:\s*reviewedSubmissionTimestamp/i,
  );
  assert.doesNotMatch(route, /new Date\(reviewedSubmission/i);
  assert.doesNotMatch(route, /reviewedSubmission[^\n]*\.toISOString\(/i);
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
    /drop function if exists public\.moderate_listing_decision\(uuid, text, text\)/i,
  );
  assert.match(
    migration,
    /drop trigger if exists trg_enforce_listing_review_workflow on public\.listings/i,
  );
  assert.doesNotMatch(migration, /delete from public\.listing_moderation_history/i);
  assert.doesNotMatch(migration, /delete from public\.reports/i);
});

test("listing retirement is immutable and hidden from seller management", async () => {
  const { readFile } = await import("node:fs/promises");
  const [migration, dashboardPage] = await Promise.all([
    readFile(
      new URL(
        "../../supabase/migrations/20260812112706_enforce_listing_moderation_integrity.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../app/dashboard/page.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /add column if not exists retired_at timestamptz/i);
  assert.match(migration, /if old\.retired_at is not null then[\s\S]*listing_is_retired/i);
  assert.match(migration, /retired_at = pg_catalog\.statement_timestamp\(\)/i);
  assert.match(migration, /listing_row\.retired_at is not null[\s\S]*listing_review_revision_conflict/i);
  assert.match(dashboardPage, /\.is\("retired_at", null\)/i);
});
