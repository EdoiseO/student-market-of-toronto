import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const userStatusSource = await readFile(
  new URL("../src/lib/user-status.js", import.meta.url),
  "utf8",
);
const userStatusModule = await import(
  `data:text/javascript;base64,${Buffer.from(userStatusSource).toString("base64")}`
);

const { getBanDisplayUntil, isAuthUserBanned, isUserBanned } = userStatusModule;
const now = Date.parse("2026-08-15T16:00:00.000Z");

test("an Auth user is banned only while banned_until is a valid future timestamp", () => {
  assert.equal(
    isAuthUserBanned({ banned_until: "2026-08-15T16:00:01.000Z" }, now),
    true,
  );
  assert.equal(
    isAuthUserBanned({ banned_until: "2026-08-15T16:00:00.000Z" }, now),
    false,
  );
  assert.equal(
    isAuthUserBanned({ banned_until: "2026-08-15T15:59:59.000Z" }, now),
    false,
  );
});

test("missing and invalid Auth ban timestamps fail closed as not active", () => {
  assert.equal(isAuthUserBanned({}, now), false);
  assert.equal(isAuthUserBanned({ banned_until: null }, now), false);
  assert.equal(isAuthUserBanned({ banned_until: "not-a-timestamp" }, now), false);
  assert.equal(
    isAuthUserBanned({ banned_until: "2026-08-15T16:00:01.000Z" }, Number.NaN),
    false,
  );
});

test("user_status keeps indefinite bans and expires timestamped bans", () => {
  assert.equal(isUserBanned({ is_banned: false, banned_until: null }, now), false);
  assert.equal(isUserBanned({ is_banned: true, banned_until: null }, now), true);
  assert.equal(
    isUserBanned({ is_banned: true, banned_until: "not-a-timestamp" }, now),
    true,
  );
  assert.equal(
    isUserBanned({ is_banned: true, banned_until: "2026-08-15T16:00:01.000Z" }, now),
    true,
  );
  assert.equal(
    isUserBanned({ is_banned: true, banned_until: "2026-08-15T16:00:00.000Z" }, now),
    false,
  );
});

test("100-year Supabase bans use permanent user-facing copy", () => {
  assert.equal(getBanDisplayUntil("2026-09-14T16:00:00.000Z", now), "2026-09-14T16:00:00.000Z");
  assert.equal(getBanDisplayUntil("2126-07-22T16:00:00.000Z", now), null);
  assert.equal(getBanDisplayUntil(null, now), null);
});
