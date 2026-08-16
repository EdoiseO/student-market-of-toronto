import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ACCOUNT_STANDING_NOTICE_SELECT,
  deriveAccountStanding,
  isModerationNoticeActive,
  normalizeAccountStandingSummary,
  normalizeModerationNotice,
} from "../src/lib/account-standing.mjs";
import {
  ACCOUNT_STANDING_ACTIONS,
  performAccountStandingAction,
} from "../src/lib/account-standing-client.mjs";
import { translations } from "../src/lib/translations.js";

const NOW = Date.parse("2026-08-16T16:00:00.000Z");

function notice(overrides = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    sanctionType: "warning",
    severity: "medium",
    reasonCode: "other",
    userMessage: "Review the marketplace rules.",
    strikePoints: null,
    restrictions: {},
    startsAt: "2026-08-16T15:00:00.000Z",
    expiresAt: null,
    acknowledgementRequired: false,
    acknowledgedAt: null,
    reviewRequestedAt: null,
    reviewStatus: null,
    lifecycleState: "active",
    createdAt: "2026-08-16T15:00:00.000Z",
    ...overrides,
  };
}

test("standing status precedence and metrics are deterministic with injected time", () => {
  assert.equal(deriveAccountStanding([], null, NOW).status, "good");

  const warning = notice({ acknowledgementRequired: true });
  const strike = notice({
    id: "22222222-2222-4222-8222-222222222222",
    sanctionType: "strike",
    strikePoints: 3,
    reviewStatus: "pending",
  });
  const actionNeeded = deriveAccountStanding([warning, strike], null, NOW);

  assert.equal(actionNeeded.status, "action_needed");
  assert.deepEqual(actionNeeded.metrics, {
    activeNotices: 2,
    strikePoints: 3,
    needsAcknowledgement: 1,
    pendingReviews: 1,
  });

  assert.equal(
    deriveAccountStanding([
      notice({ restrictions: { messaging: "blocked" } }),
    ], null, NOW).status,
    "restricted",
  );
  assert.equal(
    deriveAccountStanding([
      notice({ sanctionType: "ban", severity: "critical" }),
    ], null, NOW).status,
    "banned",
  );
  assert.equal(
    deriveAccountStanding([], { isBanned: true, bannedUntil: null }, NOW).status,
    "banned",
  );
  assert.equal(
    deriveAccountStanding([], { isBanned: true, bannedUntil: "invalid" }, NOW).status,
    "banned",
  );
});

test("authoritative summary keeps status and metrics complete across active pages", () => {
  const summary = normalizeAccountStandingSummary({
    active_notice_count: 73,
    strike_points: 9,
    needs_acknowledgement: 4,
    pending_reviews: 2,
    has_active_restrictions: true,
    has_active_ban: false,
  });
  const standing = deriveAccountStanding([notice()], null, NOW, summary);

  assert.equal(standing.status, "restricted");
  assert.deepEqual(standing.metrics, {
    activeNotices: 73,
    strikePoints: 9,
    needsAcknowledgement: 4,
    pendingReviews: 2,
  });
});

test("expired and invalid notices are not treated as active", () => {
  assert.equal(
    isModerationNoticeActive(notice({ expiresAt: "2026-08-16T16:00:00.000Z" }), NOW),
    false,
  );
  assert.equal(
    isModerationNoticeActive(notice({ expiresAt: "not-a-date" }), NOW),
    false,
  );
  assert.equal(
    isModerationNoticeActive(notice({ lifecycleState: "revoked" }), NOW),
    false,
  );
  assert.equal(
    deriveAccountStanding([
      notice({ expiresAt: "2026-08-16T15:59:59.000Z" }),
    ], { isBanned: true, bannedUntil: "2026-08-16T15:59:59.000Z" }, NOW).status,
    "good",
  );
});

test("normalization returns only the user-safe moderation projection", () => {
  const normalized = normalizeModerationNotice({
    id: "33333333-3333-4333-8333-333333333333",
    sanction_type: "strike",
    severity: "high",
    reason_code: "spam",
    user_message: "User-facing explanation",
    strike_points: 2,
    restrictions: { messaging: false },
    starts_at: "2026-08-16T15:00:00.000Z",
    lifecycle_state: "acknowledged",
    review_status: "upheld",
    review_outcome_message: "Decision remains in place.",
    revocation_reason: "User-safe reversal explanation.",
    internal_note: "must never cross the boundary",
    review_private_reason: "private",
    issued_by_user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    metadata: { private: true },
  });

  assert.deepEqual(Object.keys(normalized), [
    "id",
    "sanctionType",
    "severity",
    "reasonCode",
    "userMessage",
    "strikePoints",
    "restrictions",
    "startsAt",
    "expiresAt",
    "acknowledgementRequired",
    "acknowledgedAt",
    "revokedAt",
    "revocationKind",
    "revocationReason",
    "reviewRequestedAt",
    "reviewStatus",
    "reviewedAt",
    "supersedesSanctionId",
    "replacementSanctionId",
    "reviewOutcomeMessage",
    "lifecycleState",
    "createdAt",
    "updatedAt",
  ]);
  assert.equal(normalized.internalNote, undefined);
  assert.equal(normalized.reviewPrivateReason, undefined);
  assert.equal(normalized.issuedByUserId, undefined);
  assert.equal(normalized.metadata, undefined);
});

test("standing queries select only the public notice projection", () => {
  assert.match(ACCOUNT_STANDING_NOTICE_SELECT, /user_message/);
  assert.match(ACCOUNT_STANDING_NOTICE_SELECT, /restrictions/);
  assert.match(ACCOUNT_STANDING_NOTICE_SELECT, /review_outcome_message/);
  assert.match(ACCOUNT_STANDING_NOTICE_SELECT, /revocation_reason/);
  assert.doesNotMatch(ACCOUNT_STANDING_NOTICE_SELECT, /internal_note/);
  assert.doesNotMatch(ACCOUNT_STANDING_NOTICE_SELECT, /review_private_reason/);
  assert.doesNotMatch(ACCOUNT_STANDING_NOTICE_SELECT, /issued_by/);
  assert.doesNotMatch(ACCOUNT_STANDING_NOTICE_SELECT, /metadata/);
});

test("account actions call authenticated lifecycle RPCs and never direct DML", async () => {
  const calls = [];
  const supabase = {
    rpc(name, args) {
      calls.push({ name, args });
      return Promise.resolve({ data: { id: args.p_sanction_id }, error: null });
    },
  };
  const sanctionId = "44444444-4444-4444-8444-444444444444";

  await performAccountStandingAction(
    supabase,
    ACCOUNT_STANDING_ACTIONS.acknowledge,
    sanctionId,
  );
  await performAccountStandingAction(
    supabase,
    ACCOUNT_STANDING_ACTIONS.requestReview,
    sanctionId,
  );

  assert.deepEqual(calls, [
    {
      name: "acknowledge_moderation_sanction",
      args: { p_sanction_id: sanctionId },
    },
    {
      name: "request_moderation_sanction_review",
      args: { p_sanction_id: sanctionId },
    },
  ]);

  const clientSource = await readFile(
    new URL("../src/lib/account-standing-client.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(clientSource, /\.from\s*\(/);
  assert.doesNotMatch(clientSource, /\.(insert|update|delete|upsert)\s*\(/);
});

test("page stays bounded, RLS-backed, responsive, and paired with matching loading geometry", async () => {
  const [page, content, loading, skeleton] = await Promise.all([
    readFile(new URL("../src/app/dashboard/standing/page.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/account-standing-content.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/dashboard/standing/loading.jsx", import.meta.url), "utf8"),
    readFile(
      new URL("../src/components/skeletons/account-standing-skeleton.jsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(page, /from\("user_moderation_notices"\)/);
  assert.match(page, /rpc\("get_account_standing_summary"\)/);
  assert.match(page, /activePage/);
  assert.match(page, /\.range\(activeFrom, activeTo\)/);
  assert.match(page, /\.range\(historyFrom, historyTo\)/);
  assert.doesNotMatch(page, /ACTIVE_NOTICE_LIMIT/);
  assert.doesNotMatch(page, /from\("moderation_sanctions"\)/);
  assert.match(content, /grid-cols-2/);
  assert.match(content, /md:grid-cols-4/);
  assert.match(content, /xl:grid-cols-2/);
  assert.match(loading, /AccountStandingSkeleton/);
  assert.match(skeleton, /grid-cols-2/);
  assert.match(skeleton, /md:grid-cols-4/);
  assert.match(skeleton, /xl:grid-cols-2/);
});

test("English and French provide standing, conversation, and notification copy", () => {
  const requiredKeys = [
    "accountStanding",
    "standingGood",
    "standingActionNeeded",
    "standingRestricted",
    "standingBanned",
    "standingAcknowledge",
    "standingRequestReview",
    "standingHistoryTitle",
    "standingActivePagination",
    "standingActivePageDescription",
    "moderationStandingBannerTitle",
    "notificationModerationWarningTitle",
    "notificationModerationStrikeTitle",
    "notificationModerationBanTitle",
    "notificationModerationReviewTitle",
    "notificationConversationClosedTitle",
    "notificationConversationReopenedTitle",
    "conversationClosedTitle",
    "conversationClosedComposerDescription",
    "conversationModerationRefreshError",
  ];

  for (const locale of ["en", "fr"]) {
    for (const key of requiredKeys) {
      assert.equal(typeof translations[locale][key], "string", `${locale}.${key}`);
      assert.ok(translations[locale][key].trim().length > 0, `${locale}.${key}`);
    }
  }
});
