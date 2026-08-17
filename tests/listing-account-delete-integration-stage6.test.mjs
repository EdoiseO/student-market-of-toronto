import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(
  new URL("../src/app/api/account/delete/route.js", import.meta.url),
  "utf8",
);

test("account deletion establishes both media retirement barriers before destructive cleanup", () => {
  const passwordVerification = route.indexOf(
    "passwordVerified = await verifyUserPassword(",
  );
  const messageRetirement = route.indexOf(
    "await retireOutstandingMessageMediaReservations(admin, user.id)",
  );
  const listingRetirement = route.indexOf("await retireListingMediaForAccount({");
  const profileScrub = route.indexOf("await scrubProfile(admin, user.id)");
  const authDeletion = route.indexOf("admin.auth.admin.deleteUser(user.id, true)");

  assert.ok(passwordVerification >= 0);
  assert.ok(messageRetirement > passwordVerification);
  assert.ok(listingRetirement > messageRetirement);
  assert.ok(profileScrub > listingRetirement);
  assert.ok(authDeletion > profileScrub);
  assert.match(
    route.slice(listingRetirement, profileScrub),
    /userId:\s*user\.id[\s\S]*operationId:\s*user\.id/,
  );
});

test("account deletion no longer performs unsafe direct listing image cleanup", () => {
  assert.doesNotMatch(
    route,
    /from\(["']listing_images["']\)[\s\S]{0,120}?\.delete\(/,
  );
  assert.doesNotMatch(
    route,
    /storage[\s\S]{0,40}?\.from\(["']listing-images["']\)/,
  );
  assert.doesNotMatch(route, /anonymizeOwnedListings/);
  assert.match(route, /retireListingMediaForAccount/);
  assert.match(route, /retireOutstandingMessageMediaReservations/);
});
