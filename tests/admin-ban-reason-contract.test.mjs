import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BAN_REASON_MESSAGE_MAX_LENGTH,
  BAN_REASON_MESSAGE_MIN_LENGTH,
  validateBanReason,
} from "../src/lib/moderation-policy.mjs";

test("ban reasons require a supported code and a bounded user-facing message", () => {
  assert.deepEqual(
    validateBanReason({ reasonCode: "unknown", userMessage: "A clear explanation." }),
    {
      ok: false,
      reasonCode: null,
      userMessage: "A clear explanation.",
      error: "reason_code",
    },
  );

  assert.equal(
    validateBanReason({
      reasonCode: "spam",
      userMessage: "x".repeat(BAN_REASON_MESSAGE_MIN_LENGTH - 1),
    })
      .error,
    "user_message",
  );
  assert.equal(
    validateBanReason({
      reasonCode: "spam",
      userMessage: "x".repeat(BAN_REASON_MESSAGE_MAX_LENGTH + 1),
    })
      .error,
    "user_message",
  );

  assert.deepEqual(
    validateBanReason({
      reasonCode: " SPAM ",
      userMessage: "  Repeated unsolicited marketplace messages.  ",
    }),
    {
      ok: true,
      reasonCode: "spam",
      userMessage: "Repeated unsolicited marketplace messages.",
    },
  );
});

test("admin ban route validates and persists only the clean user-facing reason", async () => {
  const source = await readFile(
    new URL("../src/app/api/admin/users/[userId]/ban/route.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /action === "ban"[\s\S]*MODERATION_ACTIONS\.banUser/);
  assert.match(source, /action === "unban"[\s\S]*MODERATION_ACTIONS\.unbanUser/);
  assert.match(
    source,
    /canPerformModerationAction\(getUserModerationRole\(accessUser\), requiredPermission\)/,
  );
  assert.match(source, /validateBanReason\(\{ reasonCode, userMessage \}\)/);
  assert.match(source, /"begin_auth_ban_operation"/);
  assert.match(source, /"complete_auth_ban_operation"/);
  assert.match(source, /"abort_auth_ban_operation"/);
  assert.match(source, /reason_code: sanction\.reasonCode/);
  assert.match(source, /user_message: sanction\.userMessage/);
  assert.match(source, /revocation_reason: sanction\.revocationReason/);
  assert.doesNotMatch(source, /from\("user_status"\)\.upsert/);
  assert.match(source, /previousBanDuration = getRestorableBanDuration/);
  assert.match(source, /Auth ban rollback failed; durable operation requires reconciliation/);
  assert.match(source, /operation\.result_banned_until/);
  assert.match(source, /UUID_PATTERN\.test\(operationId\)/);
  assert.match(source, /operation\.operation_status !== "pending"/);
  assert.match(source, /Auth ban state changed before compensation/);
  assert.match(source, /\.\.\.validatedReason/);
  assert.match(source, /\{ error: "Could not update the ban state right now\." \}/);
  assert.doesNotMatch(source, /\{ error: error\?\.message/);
});

test("admin ban dialog sends both structured and user-facing reason fields", async () => {
  const [componentSource, translationSource, bannedPageSource] = await Promise.all([
    readFile(new URL("../src/components/admin-users-management.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/translations.js", import.meta.url), "utf8"),
    readFile(new URL("../src/app/banned/page.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(componentSource, /reasonCode: pendingBanReasonCode/);
  assert.match(componentSource, /userMessage: normalizedBanMessage/);
  assert.match(componentSource, /minLength=\{BAN_REASON_MESSAGE_MIN_LENGTH\}/);
  assert.match(componentSource, /slice\(0, BAN_REASON_MESSAGE_MAX_LENGTH\)/);
  assert.match(componentSource, /adminBanReasonLabel/);
  assert.match(componentSource, /adminBanMessageLabel/);
  assert.match(bannedPageSource, /userStatusResult\.data\?\.ban_reason/);
  assert.match(bannedPageSource, /accountBannedReasonLabel/);
  assert.match(bannedPageSource, /accountBannedReasonFallback/);

  for (const key of [
    "accountBannedReasonLabel",
    "accountBannedReasonFallback",
    "adminBanReasonLabel",
    "adminBanMessageLabel",
    "adminBanReasonValidationError",
  ]) {
    assert.equal(translationSource.split(`${key}:`).length - 1, 2, `${key} must exist in EN and FR`);
  }
});
