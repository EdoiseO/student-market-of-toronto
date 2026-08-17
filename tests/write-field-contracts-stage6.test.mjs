import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { focusFirstInvalidField } from "../src/lib/focus-first-invalid-field.js";
import {
  countUnicodeCodePoints,
  normalizeWriteText,
  validateForceNameDecision,
  validateListingDraftFields,
  validateListingPublishFields,
  validateModeratorNote,
  validateMessageBody,
  validateProfileBio,
  validateProfileIdentity,
  validateReportDecisionSummary,
  validateReportDetails,
  validateReportedListingDecision,
} from "../src/lib/write-field-contracts.mjs";

test("profile identity uses normalized Unicode code-point bounds", () => {
  assert.equal(countUnicodeCodePoints("😀"), 1);
  assert.deepEqual(
    validateProfileIdentity({ firstName: "  Ada  ", lastName: "  Lovelace " }),
    {
      ok: true,
      values: { firstName: "Ada", lastName: "Lovelace" },
      errors: {},
    },
  );
  assert.equal(
    validateProfileIdentity({ firstName: "😀".repeat(100), lastName: "Student" }).ok,
    true,
  );
  assert.equal(
    validateProfileIdentity({ firstName: "😀".repeat(101), lastName: "Student" })
      .errors.firstName,
    "too_long",
  );
  assert.equal(
    validateProfileIdentity({ firstName: "  ", lastName: "Student" }).errors.firstName,
    "required",
  );
  assert.equal(validateProfileBio("x".repeat(1001)).error, "too_long");
  assert.equal(validateProfileBio("   ").value, null);
  assert.equal(validateProfileIdentity(null).errors.firstName, "required");
});

test("listing draft and publish contracts distinguish partial from complete writes", () => {
  assert.deepEqual(validateListingDraftFields({ title: "  Desk lamp " }), {
    ok: true,
    values: { title: "Desk lamp" },
    errors: {},
  });
  const incomplete = validateListingPublishFields({ title: "Desk lamp", photoCount: 0 });
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.errors.category, "required");
  assert.equal(incomplete.errors.price, "required");
  assert.equal(incomplete.errors.photos, "out_of_range");
  assert.equal(validateListingPublishFields({ price: true }).errors.price, "required");

  const complete = validateListingPublishFields({
    title: " Desk lamp ",
    category: "Home",
    price: "25.50",
    description: "A compact lamp for a residence desk.",
    condition: "used",
    campus: "Casa Loma",
    photoCount: 1,
  });
  assert.equal(complete.ok, true);
  assert.equal(complete.values.title, "Desk lamp");
  assert.equal(complete.values.price, 25.5);
});

test("report and moderator helpers normalize action-specific required fields", () => {
  assert.equal(validateReportDetails("short", { isOther: true }).error, "report_other_details");
  assert.deepEqual(validateReportDetails("  context  ", { isOther: true }), {
    ok: false,
    value: "context",
    error: "report_other_details",
  });
  assert.equal(validateReportDetails("optional", { isOther: false }).ok, true);
  assert.equal(validateReportDecisionSummary("short").error, "report_decision_summary");
  assert.equal(
    validateReportedListingDecision({ sellerFeedback: "short", privateSummary: "" }).error,
    "seller_feedback",
  );
  assert.deepEqual(validateModeratorNote("  "), { ok: true, value: null, error: null });
  assert.equal(
    validateForceNameDecision({
      policyReason: "A documented policy reason",
      userMessage: "Please update your display name",
      privateNote: "",
    }).value.privateNote,
    null,
  );
});

test("message prose uses ECMAScript edge whitespace, CRLF, and Unicode code-point bounds", () => {
  assert.equal(
    normalizeWriteText("\uFEFF\u00A0\u2003line one\r\nline two\r\u3000"),
    "line one\nline two",
  );
  assert.equal(validateMessageBody("😀".repeat(2000)).ok, true);
  assert.equal(validateMessageBody("😀".repeat(2001)).error, "too_long");
  assert.equal(validateMessageBody("\t\r\n\u00A0\u2003\uFEFF").error, "required");
  assert.deepEqual(validateMessageBody("\t\r\n\u00A0", { allowEmpty: true }), {
    ok: true,
    value: null,
    length: 0,
    error: null,
  });
});

test("registration and profile forms expose required, error, focus, and loading contracts", async () => {
  const files = await Promise.all([
    readFile(new URL("../src/components/register-form.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/profile-settings-form.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/skeletons/profile-settings-skeleton.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/account/name/route.js", import.meta.url), "utf8"),
  ]);
  const [register, profile, loading, route] = files;

  for (const source of [register, profile]) {
    assert.match(source, /noValidate/);
    assert.match(source, /focusFirstInvalidField/);
    assert.match(source, /aria-required="true"/);
    assert.match(source, /aria-invalid=/);
    assert.match(source, /requiredFieldsLegend/);
  }
  assert.match(register, /validateProfileIdentity/);
  assert.match(profile, /validateProfileBio/);
  assert.match(profile, /const hasBioChanges = currentNormalizedBio !== initialNormalizedBio/);
  assert.match(profile, /hasBioChanges[\s\S]*\? validateProfileBio\(bio\)/);
  assert.match(profile, /if \(hasBioChanges\) \{[\s\S]*\.from\("profiles"\)[\s\S]*\.update\(\{ bio: bioResult\.value \}\)[\s\S]*\.eq\("id", initialProfile\.id\)[\s\S]*\.select\("id"\)[\s\S]*\.maybeSingle\(\)/);
  assert.doesNotMatch(profile, /\.from\("profiles"\)[\s\S]{0,80}\.upsert\(/);
  assert.match(profile, /min-\[360px\]:grid-cols-2/);
  assert.match(loading, /min-\[360px\]:grid-cols-2/);
  assert.match(route, /validateProfileIdentity/);
  assert.match(route, /fieldErrors: identity\.errors/);
  assert.match(route, /getProfileNameFingerprint/);
  assert.match(route, /rpc\(\s*["']save_profile_identity_from_server["']/);
  assert.doesNotMatch(route, /auth\.admin\.updateUserById/);
  assert.match(profile, /\(!hasProfileChanges && !requiresNameChange\)/);
  assert.match(profile, /if \(hasNameChanges \|\| requiresNameChange\)/);
});

test("first-invalid focus helper focuses and vertically reveals the first invalid control", () => {
  const calls = [];
  const field = {
    focus(options) {
      calls.push(["focus", options]);
    },
    scrollIntoView(options) {
      calls.push(["scroll", options]);
    },
  };
  const form = {
    querySelector() {
      return field;
    },
  };

  assert.equal(focusFirstInvalidField(form, { defer: false }), true);
  assert.deepEqual(calls, [
    ["focus", { preventScroll: true }],
    ["scroll", { behavior: "smooth", block: "center", inline: "nearest" }],
  ]);
});
