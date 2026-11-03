import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("../supabase/migrations/20260817010541_stage7_security_remediation.sql", import.meta.url),
  "utf8",
);
const roleRoute = await readFile(
  new URL("../src/app/api/admin/users/[userId]/role/route.js", import.meta.url),
  "utf8",
);
const sanctionsRoute = await readFile(
  new URL("../src/app/api/admin/users/[userId]/sanctions/route.js", import.meta.url),
  "utf8",
);
const moderation = await readFile(new URL("../src/lib/moderation.js", import.meta.url), "utf8");
const proxy = await readFile(new URL("../src/proxy.js", import.meta.url), "utf8");
const accountDelete = await readFile(
  new URL("../src/app/api/account/delete/route.js", import.meta.url),
  "utf8",
);
const cleanupWorker = await readFile(
  new URL("../src/lib/listing-image-cleanup-worker.mjs", import.meta.url),
  "utf8",
);
const userDetail = await readFile(
  new URL("../src/components/admin-user-detail-content.jsx", import.meta.url),
  "utf8",
);

test("Stage 7 retires the legacy role fallback and blocks forced-name writes", () => {
  assert.doesNotMatch(moderation, /user\?\.role/);
  assert.match(roleRoute, /role:\s*"authenticated"/);
  assert.match(roleRoute, /isNameChangeRequired\(accessUser\)/);
  assert.match(migration, /p_auth_role is deliberately ignored/i);
  assert.doesNotMatch(migration, /jsonb_set\([\s\S]*account\.role/);
  assert.match(migration, /profile_name_change_required/g);
  assert.doesNotMatch(proxy, /path\.startsWith\("\/api\/"\)/);
  assert.match(proxy, /path === "\/api\/account\/name"/);
});

test("Stage 7 binds listing uploads to reservations and retires the old message writer", () => {
  assert.match(
    migration,
    /reservation\.storage_path = new\.name[\s\S]*reservation\.state = 'reserved'[\s\S]*intent\.state in \('begun', 'in_progress'\)/,
  );
  assert.match(migration, /listing_image_overwrite_forbidden/);
  assert.match(
    migration,
    /to_regprocedure\('public\.send_conversation_message\(uuid,text\)'\)/,
  );
  assert.match(migration, /message_send_abort_rate_limit/);
  assert.match(migration, /message_send_conversation_access_denied/);
  assert.match(migration, /language sql[\s\S]*message_send_private\.abort_impl/);
  assert.match(migration, /initialize_stage7_operation_lifecycle/);
});

test("Stage 7 bounds report and message command retention and account erasure", () => {
  assert.match(migration, /interval '7 days'/);
  assert.match(migration, /operation_tombstones/);
  assert.match(migration, /command_tombstones/);
  assert.match(migration, /report_already_submitted_recently/);
  assert.match(migration, /report_submission_rate_limit/);
  assert.match(migration, /stage7-report-actor:/);
  assert.match(migration, /initialize_stage7_command_lifecycle/);
  assert.match(accountDelete, /purge_stage7_user_security_data/);
  assert.match(cleanupWorker, /maintain_stage7_security_ledgers/);
});

test("Stage 7 enforces moderator strike strength and sanction issuer hierarchy twice", () => {
  assert.match(migration, /moderator_standard_strike_limit/);
  assert.match(migration, /moderation_sanction_issuer_hierarchy/);
  assert.match(sanctionsRoute, /actorRole === "moderator"[\s\S]*sanction\.issued_by_role === "admin"/);
  assert.match(sanctionsRoute, /strikePoints !== 1[\s\S]*\["low", "medium"\]/);
  assert.match(userDetail, /sanction\.issuedByRole !== "admin"/);
  assert.match(userDetail, /isModeratorStrike/);
});
