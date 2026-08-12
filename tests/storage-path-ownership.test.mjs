import assert from "node:assert/strict";
import test from "node:test";

import { isOwnedStoragePath } from "../src/lib/storage-path-ownership.mjs";

const userId = "11111111-1111-1111-1111-111111111111";
const listingId = "22222222-2222-2222-2222-222222222222";

test("accepts canonical user and listing-owned paths", () => {
  assert.equal(isOwnedStoragePath(`${userId}/avatar.png`, userId), true);
  assert.equal(
    isOwnedStoragePath(`${userId}/${listingId}/listing.png`, userId, listingId),
    true,
  );
});

test("rejects cross-user and cross-listing paths", () => {
  assert.equal(isOwnedStoragePath(`victim/${listingId}/listing.png`, userId, listingId), false);
  assert.equal(isOwnedStoragePath(`${userId}/victim-listing/listing.png`, userId, listingId), false);
});

test("rejects non-canonical and unsafe segments", () => {
  assert.equal(isOwnedStoragePath(`${userId}/${listingId}/../victim.png`, userId, listingId), false);
  assert.equal(isOwnedStoragePath(`${userId}/${listingId}/%2e%2e/victim.png`, userId, listingId), false);
  assert.equal(isOwnedStoragePath(`${userId}\\${listingId}\\victim.png`, userId, listingId), false);
  assert.equal(isOwnedStoragePath(`${userId}//victim.png`, userId), false);
});
