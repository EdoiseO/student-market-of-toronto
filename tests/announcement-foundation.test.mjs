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
  assert.match(routeSource, /validateAnnouncementMessage\(body\.message\)/);
  assert.match(routeSource, /request\.json\(\)\.catch\(\(\) => null\)/);
  assert.match(
    routeSource,
    /MODERATION_ACTIONS\.manageAnnouncements/,
  );
  assert.doesNotMatch(routeSource, /trimmedMessage\.length\s*>\s*3000/);
  assert.match(routeSource, /Array\.from\(compactMessage\)/);
  assert.match(routeSource, /characters\.slice\(0, 79\)\.join\(""\)/);

  assert.match(sheetSource, /ANNOUNCEMENT_MESSAGE_MAX_LENGTH/);
  assert.match(sheetSource, /validateAnnouncementMessage\(message\)/);
  assert.match(sheetSource, /slice\(0, ANNOUNCEMENT_MESSAGE_MAX_LENGTH\)/);
  assert.doesNotMatch(sheetSource, /maxLength=\{2000\}/);
});

test("announcement route uses the durable RPC and bounded worker cutover", () => {
  assert.match(routeSource, /requireRpc\(admin, "create_and_start_announcement"/);
  assert.doesNotMatch(routeSource, /create_announcement_draft|transition_announcement/);
  assert.match(routeSource, /p_operation_id:\s*operationId/);
  assert.match(sheetSource, /crypto\.randomUUID\(\)/);
  assert.match(routeSource, /enqueueAnnouncementAudience/);
  assert.match(routeSource, /runAnnouncementDeliveryWorker/);
  assert.match(routeSource, /p_email_enabled:\s*false/);
  assert.doesNotMatch(routeSource, /\.from\("(?:conversations|messages|notifications)"\)\.insert/);
  assert.doesNotMatch(routeSource, /listAnnouncementRecipientIds/);
});

test("announcement route does not expose internal exception messages", () => {
  assert.doesNotMatch(
    routeSource,
    /NextResponse\.json\(\s*\{\s*error:\s*error\?\.message/,
  );
});
