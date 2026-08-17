import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [routeSource, sheetSource, operationsSource] = await Promise.all([
  readFile(
    new URL("../src/app/api/admin/announcements/route.js", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/components/admin-announcement-sheet.jsx", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../src/lib/admin-announcements.mjs", import.meta.url), "utf8"),
]);

test("announcement API and composer share the canonical validation contract", () => {
  assert.match(routeSource, /validateAnnouncementPayload/);
  assert.match(operationsSource, /validateAnnouncementMessage\(input\?\.body \?\? input\?\.message\)/);
  assert.match(routeSource, /request\.json\(\)\.catch\(\(\) => null\)/);
  assert.match(
    routeSource,
    /MODERATION_ACTIONS\.manageAnnouncements/,
  );
  assert.doesNotMatch(routeSource, /trimmedMessage\.length\s*>\s*3000/);
  assert.match(operationsSource, /Array\.from\(title\)/);
  assert.match(operationsSource, /characters\.slice\(0, 79\)\.join\(""\)/);

  assert.match(sheetSource, /ANNOUNCEMENT_MESSAGE_MAX_LENGTH/);
  assert.match(sheetSource, /validateAnnouncementMessage\(message\)/);
  assert.match(sheetSource, /slice\(0, ANNOUNCEMENT_MESSAGE_MAX_LENGTH\)/);
  assert.doesNotMatch(sheetSource, /maxLength=\{2000\}/);
});

test("announcement route uses the durable RPC and bounded worker cutover", () => {
  assert.match(routeSource, /create_and_start_announcement/);
  assert.match(routeSource, /create_announcement_draft_idempotent/);
  assert.match(routeSource, /execute_announcement_lifecycle_command/);
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
