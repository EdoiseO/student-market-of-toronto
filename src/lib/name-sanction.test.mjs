import assert from "node:assert/strict";
import test from "node:test";

import {
  REJECTED_PROFILE_NAME_FINGERPRINT_HISTORY_KEY,
  REJECTED_PROFILE_NAME_FINGERPRINT_KEY,
  appendRejectedProfileNameFingerprint,
  areOpenProfileReportsBoundToUser,
  getProfileNameFingerprint,
  getRejectedProfileNameFingerprints,
  matchesRejectedProfileName,
} from "./name-sanction.mjs";

const targetUserId = "11111111-1111-1111-1111-111111111111";
const otherUserId = "22222222-2222-2222-2222-222222222222";

function buildReport(overrides = {}) {
  return {
    id: "report-1",
    subject_type: "profile",
    subject_id: targetUserId,
    reported_user_id: targetUserId,
    status: "open",
    ...overrides,
  };
}

test("fingerprints canonical equivalents as the same profile name", () => {
  const rejectedFingerprint = getProfileNameFingerprint("  JA\u200bNE ", "ＤＯＥ");

  assert.equal(
    matchesRejectedProfileName("jane", "doe", rejectedFingerprint),
    true,
  );
  assert.equal(
    matchesRejectedProfileName("janet", "doe", rejectedFingerprint),
    false,
  );
});

test("allows backward-compatible replacement when an old sanction has no fingerprint", () => {
  assert.equal(matchesRejectedProfileName("Jane", "Doe", null), false);
  assert.equal(getProfileNameFingerprint(null, null), null);
});

test("retains a bounded rejected-name history across later sanctions", () => {
  const firstFingerprint = getProfileNameFingerprint("Rejected", "One");
  const secondFingerprint = getProfileNameFingerprint("Rejected", "Two");
  const metadata = {
    [REJECTED_PROFILE_NAME_FINGERPRINT_KEY]: firstFingerprint,
    [REJECTED_PROFILE_NAME_FINGERPRINT_HISTORY_KEY]: [firstFingerprint],
  };
  const history = appendRejectedProfileNameFingerprint(metadata, secondFingerprint);

  assert.deepEqual(history, [firstFingerprint, secondFingerprint]);
  assert.deepEqual(
    getRejectedProfileNameFingerprints({
      [REJECTED_PROFILE_NAME_FINGERPRINT_HISTORY_KEY]: Array.from(
        { length: 25 },
        (_, index) => `fingerprint-${index}`,
      ),
    }),
    Array.from({ length: 20 }, (_, index) => `fingerprint-${index + 5}`),
  );
  assert.equal(matchesRejectedProfileName("Rejected", "One", history), true);
  assert.equal(matchesRejectedProfileName("Rejected", "Two", history), true);
  assert.equal(matchesRejectedProfileName("Accepted", "Name", history), false);
});

test("accepts only a complete set of open profile reports bound to the target", () => {
  assert.equal(
    areOpenProfileReportsBoundToUser([buildReport()], ["report-1"], targetUserId),
    true,
  );
  assert.equal(
    areOpenProfileReportsBoundToUser([], ["report-1"], targetUserId),
    false,
  );
  assert.equal(
    areOpenProfileReportsBoundToUser(
      [buildReport({ subject_id: otherUserId })],
      ["report-1"],
      targetUserId,
    ),
    false,
  );
  assert.equal(
    areOpenProfileReportsBoundToUser(
      [buildReport({ reported_user_id: otherUserId })],
      ["report-1"],
      targetUserId,
    ),
    false,
  );
  assert.equal(
    areOpenProfileReportsBoundToUser(
      [buildReport({ subject_type: "listing" })],
      ["report-1"],
      targetUserId,
    ),
    false,
  );
  assert.equal(
    areOpenProfileReportsBoundToUser(
      [buildReport({ status: "resolved" })],
      ["report-1"],
      targetUserId,
    ),
    false,
  );
});
