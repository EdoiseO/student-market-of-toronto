import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  areOpenReportsBoundToOneSubject,
  getReportSubjectBinding,
  getRestorableBanDuration,
} from "../src/lib/admin-moderation-integrity.mjs";

const report = (overrides = {}) => ({
  id: "report-1",
  subject_type: "listing",
  subject_id: "listing-1",
  listing_id: "listing-1",
  message_id: null,
  reported_user_id: "seller-1",
  status: "open",
  ...overrides,
});

test("report batches must contain every requested open report for exactly one subject", () => {
  const rows = [report(), report({ id: "report-2" })];

  assert.equal(
    areOpenReportsBoundToOneSubject(rows, ["report-1", "report-2"]),
    true,
  );
  assert.equal(
    areOpenReportsBoundToOneSubject(
      [report(), report({ id: "report-2", subject_id: "listing-2", listing_id: "listing-2" })],
      ["report-1", "report-2"],
    ),
    false,
  );
  assert.equal(
    areOpenReportsBoundToOneSubject(
      [report(), report({ id: "report-2", status: "resolved" })],
      ["report-1", "report-2"],
    ),
    false,
  );
  assert.equal(areOpenReportsBoundToOneSubject([report()], ["report-1", "missing"]), false);
});

test("report bindings fail closed when redundant target columns disagree", () => {
  assert.equal(getReportSubjectBinding(report()), "listing:listing-1");
  assert.equal(
    getReportSubjectBinding(report({ subject_id: "listing-2" })),
    null,
  );
  assert.equal(
    getReportSubjectBinding(
      report({
        subject_type: "message",
        subject_id: "message-1",
        message_id: "message-1",
        listing_id: null,
      }),
    ),
    "message:message-1",
  );
  assert.equal(
    getReportSubjectBinding(
      report({
        subject_type: "profile",
        subject_id: "user-1",
        reported_user_id: "user-1",
        listing_id: null,
      }),
    ),
    "profile:user-1",
  );
});

test("ban rollback duration preserves only a still-active previous ban", () => {
  const now = Date.parse("2026-08-12T20:00:00.000Z");

  assert.equal(getRestorableBanDuration(null, now), "none");
  assert.equal(getRestorableBanDuration("2026-08-12T19:59:59.000Z", now), "none");
  assert.equal(getRestorableBanDuration("2026-08-12T20:00:30.100Z", now), "31s");
});

test("reconciliation migration retires the legacy workflow and restores the revisioned RPC", async () => {
  const sql = await readFile(
    new URL(
      "../supabase/migrations/20260812211025_reconcile_listing_moderation_integrity.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(sql, /add column if not exists content_revision bigint/i);
  assert.match(sql, /add column if not exists retired_at timestamptz/i);
  assert.match(sql, /drop function if exists public\.moderate_listing_decision\(uuid, text, text\)/i);
  assert.match(sql, /drop trigger if exists trg_enforce_listing_review_workflow on public\.listings/i);
  assert.match(sql, /drop function if exists public\.enforce_listing_review_workflow\(\)/i);
  assert.match(sql, /create or replace function public\.decide_listing_moderation/i);
  assert.match(
    sql,
    /revoke all on function public\.decide_listing_moderation[\s\S]*from public, anon, authenticated/i,
  );
});

test("privileged admin routes fail closed and announcements use durable delivery state", async () => {
  const [roleRoute, banRoute, announcementRoute, usersPage] = await Promise.all([
    readFile(new URL("../src/app/api/admin/users/[userId]/role/route.js", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/admin/users/[userId]/ban/route.js", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/admin/announcements/route.js", import.meta.url), "utf8"),
    readFile(new URL("../src/app/admin/users/page.jsx", import.meta.url), "utf8"),
  ]);

  for (const source of [roleRoute, banRoute, announcementRoute, usersPage]) {
    assert.doesNotMatch(source, /getLatestAuthUser\([^\n]+\)\s*\?\?\s*user/);
  }

  assert.match(roleRoute, /targetRole === "admin"/);
  assert.match(roleRoute, /Admin transfer rollback failed/);
  assert.match(roleRoute, /getUserStatusRow\(admin, targetUserId\)/);
  assert.match(roleRoute, /isUserBanned\(targetStatusResult\.data\)/);
  assert.match(banRoute, /set_application_moderation_ban/);
  assert.match(
    banRoute,
    /action === "ban" && getUserModerationRole\(targetUser\) === "admin"/,
  );
  assert.doesNotMatch(banRoute, /ban_duration|updateUserById/);
  assert.match(announcementRoute, /failureCount = Number\(latestAnnouncement\.failed_count/);
  assert.match(announcementRoute, /queued: !deliveryFinished/);
  assert.match(announcementRoute, /enqueueAnnouncementAudience/);
  assert.match(announcementRoute, /runAnnouncementDeliveryWorker/);
  assert.match(announcementRoute, /create_and_start_announcement/);
  assert.match(announcementRoute, /operationId/);
  assert.doesNotMatch(announcementRoute, /create_announcement_draft|transition_announcement/);
  assert.doesNotMatch(announcementRoute, /\.from\("(?:conversations|messages|notifications)"\)\.insert/);
  assert.match(usersPage, /getUserModerationRole\(accessUser\) !== "admin"/);
  assert.match(usersPage, /statusError \|\| !Array\.isArray\(statusRows\)/);
});
