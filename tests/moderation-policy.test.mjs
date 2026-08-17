import assert from "node:assert/strict";
import test from "node:test";

import {
  ANNOUNCEMENT_MESSAGE_MAX_LENGTH,
  BAN_DURATIONS,
  BAN_DURATION_VALUES,
  BAN_REASON_CODE_VALUES,
  BAN_REASON_MESSAGE_MAX_LENGTH,
  BAN_REASON_MESSAGE_MIN_LENGTH,
  MODERATION_ACTIONS,
  MODERATION_ROLE_ACTIONS,
  MODERATION_ROLES,
  SUPABASE_UNBAN_DURATION,
  canPerformModerationAction,
  getSupabaseBanDuration,
  normalizeBanDuration,
  normalizeBanReasonCode,
  normalizeModerationAction,
  normalizeModerationRole,
  validateAnnouncementMessage,
  validateBanReason,
} from "../src/lib/moderation-policy.mjs";

test("the moderation matrix gives admins every action", () => {
  const actions = Object.values(MODERATION_ACTIONS);

  assert.deepEqual(MODERATION_ROLE_ACTIONS[MODERATION_ROLES.admin], actions);

  for (const action of actions) {
    assert.equal(canPerformModerationAction("admin", action), true, action);
  }
});

test("moderators can decide content and issue standard sanctions without admin powers", () => {
  for (const action of [
    MODERATION_ACTIONS.decideReports,
    MODERATION_ACTIONS.decideListings,
    MODERATION_ACTIONS.readUsers,
    MODERATION_ACTIONS.readConversations,
    MODERATION_ACTIONS.issueWarning,
    MODERATION_ACTIONS.issueStandardStrike,
    MODERATION_ACTIONS.closeChatTemporarily,
    MODERATION_ACTIONS.reopenChat,
  ]) {
    assert.equal(canPerformModerationAction("moderator", action), true, action);
  }

  for (const action of [
    "ban_user",
    MODERATION_ACTIONS.unbanUser,
    MODERATION_ACTIONS.manageRoles,
    MODERATION_ACTIONS.manageAnnouncements,
  ]) {
    assert.equal(canPerformModerationAction("moderator", action), false, action);
  }
});

test("staff permissions stop at read, triage, and assignment", () => {
  for (const action of [
    MODERATION_ACTIONS.viewDashboard,
    MODERATION_ACTIONS.readReports,
    MODERATION_ACTIONS.triageReports,
    MODERATION_ACTIONS.assignReports,
    MODERATION_ACTIONS.readListings,
  ]) {
    assert.equal(canPerformModerationAction("staff", action), true, action);
  }

  for (const action of [
    MODERATION_ACTIONS.decideReports,
    MODERATION_ACTIONS.decideListings,
    MODERATION_ACTIONS.readUsers,
    MODERATION_ACTIONS.readConversations,
    MODERATION_ACTIONS.readAuditLog,
    MODERATION_ACTIONS.issueWarning,
    MODERATION_ACTIONS.issueStandardStrike,
    MODERATION_ACTIONS.closeChatTemporarily,
    MODERATION_ACTIONS.reopenChat,
    MODERATION_ACTIONS.banUser,
    MODERATION_ACTIONS.manageRoles,
  ]) {
    assert.equal(canPerformModerationAction("staff", action), false, action);
  }
});

test("audit-log access is admin-only", () => {
  assert.equal(canPerformModerationAction("admin", MODERATION_ACTIONS.readAuditLog), true);
  assert.equal(canPerformModerationAction("moderator", MODERATION_ACTIONS.readAuditLog), false);
  assert.equal(canPerformModerationAction("staff", MODERATION_ACTIONS.readAuditLog), false);
});

test("role and action helpers normalize known strings and fail closed", () => {
  assert.equal(normalizeModerationRole(" Moderator "), "moderator");
  assert.equal(normalizeModerationRole("owner"), null);
  assert.equal(normalizeModerationRole(null), null);
  assert.equal(normalizeModerationAction(" BAN_USER "), "ban_user");
  assert.equal(normalizeModerationAction("delete_everything"), null);
  assert.equal(canPerformModerationAction("owner", "read_reports"), false);
  assert.equal(canPerformModerationAction("admin", "delete_everything"), false);
});

test("supported ban durations map to Supabase duration strings", () => {
  assert.deepEqual(BAN_DURATION_VALUES, ["24h", "7d", "30d", "permanent"]);
  assert.deepEqual(BAN_DURATIONS, {
    "24h": "24h",
    "7d": "168h",
    "30d": "720h",
    permanent: "876000h",
  });
  assert.equal(SUPABASE_UNBAN_DURATION, "none");
  assert.equal(normalizeBanDuration(" 7D "), "7d");
  assert.equal(getSupabaseBanDuration("24h"), "24h");
  assert.equal(getSupabaseBanDuration("7d"), "168h");
  assert.equal(getSupabaseBanDuration("30d"), "720h");
  assert.equal(getSupabaseBanDuration("permanent"), "876000h");
  assert.equal(normalizeBanDuration("forever"), null);
  assert.equal(getSupabaseBanDuration(null), null);
});

test("ban reason codes match the existing report taxonomy", () => {
  assert.deepEqual(BAN_REASON_CODE_VALUES, [
    "spam",
    "scam",
    "misleading",
    "prohibited",
    "harassment",
    "inappropriate",
    "other",
  ]);
  assert.equal(normalizeBanReasonCode(" Harassment "), "harassment");
  assert.equal(normalizeBanReasonCode("policy_violation"), null);
});

test("ban reason validation returns normalized values and stable error fields", () => {
  const valid = validateBanReason({
    reasonCode: " SCAM ",
    userMessage: "  Repeated requests for payment outside the marketplace.\r\n  ",
  });

  assert.deepEqual(valid, {
    ok: true,
    reasonCode: "scam",
    userMessage: "Repeated requests for payment outside the marketplace.",
  });

  assert.deepEqual(
    validateBanReason({ reasonCode: "unknown", userMessage: "A sufficiently long reason." }),
    {
      ok: false,
      reasonCode: null,
      userMessage: "A sufficiently long reason.",
      error: "reason_code",
    },
  );

  assert.deepEqual(validateBanReason({ reasonCode: "spam", userMessage: "Too short" }), {
    ok: false,
    reasonCode: "spam",
    userMessage: "Too short",
    error: "user_message",
  });
});

test("ban reason validation accepts exact character bounds and counts emoji as one character", () => {
  const minimum = "x".repeat(BAN_REASON_MESSAGE_MIN_LENGTH);
  const maximum = "x".repeat(BAN_REASON_MESSAGE_MAX_LENGTH);

  assert.equal(validateBanReason({ reasonCode: "other", userMessage: minimum }).ok, true);
  assert.equal(validateBanReason({ reasonCode: "other", userMessage: maximum }).ok, true);
  assert.equal(
    validateBanReason({
      reasonCode: "other",
      userMessage: "🙂".repeat(BAN_REASON_MESSAGE_MAX_LENGTH),
    }).ok,
    true,
  );
  assert.equal(
    validateBanReason({ reasonCode: "other", userMessage: "x".repeat(BAN_REASON_MESSAGE_MIN_LENGTH - 1) })
      .error,
    "user_message",
  );
  assert.equal(
    validateBanReason({ reasonCode: "other", userMessage: "x".repeat(BAN_REASON_MESSAGE_MAX_LENGTH + 1) })
      .error,
    "user_message",
  );
});

test("announcement validation shares the 2000-character contract", () => {
  assert.equal(ANNOUNCEMENT_MESSAGE_MAX_LENGTH, 2000);
  assert.deepEqual(validateAnnouncementMessage("  Campus closes at 6 p.m.\r\n  "), {
    ok: true,
    message: "Campus closes at 6 p.m.",
  });
  assert.equal(validateAnnouncementMessage(" ").error, "message");
  assert.equal(validateAnnouncementMessage("x".repeat(2000)).ok, true);
  assert.equal(validateAnnouncementMessage("🙂".repeat(2000)).ok, true);
  assert.equal(validateAnnouncementMessage("x".repeat(2001)).error, "message");
});
