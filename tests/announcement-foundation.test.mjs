import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [routeSource, sheetSource] = await Promise.all([
  readFile(
    new URL("../src/app/api/admin/announcements/route.js", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/components/admin-announcement-sheet.jsx", import.meta.url),
    "utf8",
  ),
]);

test("announcement API and composer share the canonical validation contract", () => {
  assert.match(routeSource, /validateAnnouncementMessage\(body\?\.message\)/);
  assert.match(routeSource, /request\.json\(\)\.catch\(\(\) => null\)/);
  assert.match(
    routeSource,
    /MODERATION_ACTIONS\.manageAnnouncements/,
  );
  assert.doesNotMatch(routeSource, /trimmedMessage\.length\s*>\s*3000/);
  assert.match(routeSource, /Array\.from\(trimmedMessage\)/);
  assert.match(routeSource, /announcementCharacters\.slice\(0, 100\)\.join\(""\)/);
  assert.doesNotMatch(routeSource, /trimmedMessage\.slice\(0, 100\)/);

  assert.match(sheetSource, /ANNOUNCEMENT_MESSAGE_MAX_LENGTH/);
  assert.match(sheetSource, /validateAnnouncementMessage\(message\)/);
  assert.match(sheetSource, /slice\(0, ANNOUNCEMENT_MESSAGE_MAX_LENGTH\)/);
  assert.doesNotMatch(sheetSource, /maxLength=\{2000\}/);
});

test("announcement route does not expose internal exception messages", () => {
  assert.doesNotMatch(
    routeSource,
    /NextResponse\.json\(\s*\{\s*error:\s*error\?\.message/,
  );
});
