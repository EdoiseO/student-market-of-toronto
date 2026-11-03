import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  getAdminEnforcementHref,
  isSanctionEffectivelyActive,
  parseAdminEnforcementFilters,
} from "../src/lib/admin-enforcement.mjs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("filter parsing is bounded and links preserve only normalized filters", () => {
  const filters = parseAdminEnforcementFilters({
    page: "99999999",
    status: "ACTIVE",
    type: "strike",
    severity: "unexpected",
    q: `  repeated   spam ${"x".repeat(120)}  `,
  });
  assert.equal(filters.page, 1);
  assert.equal(filters.status, "active");
  assert.equal(filters.type, "strike");
  assert.equal(filters.severity, "all");
  assert.equal(filters.query.length, 100);
  assert.match(getAdminEnforcementHref(filters, 2), /^\/admin\/enforcement\?/);
  assert.match(getAdminEnforcementHref(filters, 2), /page=2/);
  assert.doesNotMatch(getAdminEnforcementHref(filters, 2), /severity=/);
});

test("effective-active derivation excludes future, expired, and revoked sanctions", () => {
  const now = Date.parse("2026-08-16T12:00:00.000Z");
  assert.equal(isSanctionEffectivelyActive({ starts_at: "2026-08-15T00:00:00Z", expires_at: null }, now), true);
  assert.equal(isSanctionEffectivelyActive({ starts_at: "2026-08-17T00:00:00Z", expires_at: null }, now), false);
  assert.equal(isSanctionEffectivelyActive({ starts_at: "2026-08-15T00:00:00Z", expires_at: "2026-08-16T00:00:00Z" }, now), false);
  assert.equal(isSanctionEffectivelyActive({ starts_at: "2026-08-15T00:00:00Z", expires_at: null, revoked_at: "2026-08-16T01:00:00Z" }, now), false);
});

test("enforcement registry is bounded, deterministic, and omits private moderation fields", () => {
  const helper = read("src/lib/admin-enforcement.mjs");
  const page = read("src/app/admin/enforcement/page.jsx");
  assert.match(helper, /ADMIN_ENFORCEMENT_PAGE_SIZE = 20/);
  assert.doesNotMatch(helper.match(/ADMIN_ENFORCEMENT_SANCTION_SELECT = `[\s\S]*?`;/)?.[0] ?? "", /internal_note|review_private_reason|metadata/);
  assert.match(page, /count: "exact"/);
  assert.match(page, /\.order\("created_at", \{ ascending: false \}\)/);
  assert.match(page, /\.order\("id", \{ ascending: false \}\)/);
  assert.match(page, /\.range\(from, to\)/);
});

test("user detail uses bounded summaries and never selects private sanction notes", () => {
  const page = read("src/app/admin/users/[userId]/page.jsx");
  assert.match(page, /HISTORY_PAGE_SIZE = 20/);
  assert.match(page, /head: true/);
  assert.match(page, /\.limit\(5\)/);
  assert.match(page, /ADMIN_ENFORCEMENT_SANCTION_SELECT/);
  assert.match(page, /getUserStatusRow\(admin, accessUser\.id\)/);
  assert.match(page, /statusResult\.available !== true \|\| statusResult\.error/);
  assert.match(page, /adminUsersStatusUnavailableTitle/);
  assert.match(page, /canReadPrivateAuthDetails = currentUserRole === "admin"/);
  assert.match(page, /email: canReadPrivateAuthDetails \?/);
  assert.match(page, /lastSignInAt: canReadPrivateAuthDetails \?/);
  assert.match(page, /emailConfirmedAt: canReadPrivateAuthDetails \?/);
  assert.doesNotMatch(page, /internal_note|review_private_reason/);
});

test("sanction action route authorizes fresh actors and calls only trusted RPCs", () => {
  const route = read("src/app/api/admin/users/[userId]/sanctions/route.js");
  assert.match(route, /getLatestAuthUser/);
  assert.match(route, /getUserStatusRow/);
  assert.match(route, /isUserBanned/);
  assert.match(route, /canPerformModerationAction/);
  assert.match(route, /userId === accessUser\.id/);
  assert.match(route, /targetRole === "admin"/);
  assert.match(route, /actorRole === "moderator" && targetRole === "moderator"/);
  assert.match(route, /issue_moderation_warning/);
  assert.match(route, /issue_moderation_strike/);
  assert.match(route, /execute_moderation_sanction_action/);
  assert.match(route, /UUID_PATTERN\.test\(body\.operationId/);
  assert.match(route, /\.eq\("request_id", operationId\)/);
  assert.match(route, /auditEventId: audit\.id/);
  assert.doesNotMatch(route, /revoke_moderation_sanction/);
  assert.doesNotMatch(route, /decide_moderation_sanction_review/);
  assert.doesNotMatch(route, /modify_moderation_sanction_review/);
  assert.doesNotMatch(route, /\.from\("moderation_sanctions"\)\s*\.insert|\.from\("moderation_sanctions"\)\s*\.update/);
});

test("sanction dialogs preserve one operation id across ambiguous retries", () => {
  const content = read("src/components/admin-user-detail-content.jsx");
  assert.match(content, /operationId = React\.useRef/);
  assert.match(content, /operationId: operationId\.current/);
  assert.match(content, /operationId\.current = null/);
});

test("directory search is globally truthful within a bounded newest-account window", () => {
  const page = read("src/app/admin/users/page.jsx");
  const content = read("src/components/admin-users-management.jsx");
  const migration = read("supabase/migrations/20260816185025_harden_admin_sanction_actions_and_directory_search.sql");
  assert.match(page, /list_admin_user_directory/);
  assert.match(page, /p_page_size: perPage/);
  assert.match(page, /directoryUser\.force_name_change === true/);
  assert.doesNotMatch(page, /auth\.admin\.listUsers/);
  assert.match(content, /<AdminQueueFilters action="\/admin\/users"/);
  assert.match(read("src/components/admin-queue-filters.jsx"), /<form[\s\S]*?method="get"/);
  assert.match(content, /adminUsersSearchScope/);
  assert.match(migration, /limit 5000/i);
  assert.match(migration, /'scopeLimit', 5000/);
  assert.match(migration, /raw_app_meta_data -> 'force_name_change'/);
  assert.match(
    migration,
    /resolve_role_from_account\(\s*account\.raw_app_meta_data,\s*account\.role\s*\)/i,
  );
  assert.match(migration, /grant execute on function public\.list_admin_user_directory[\s\S]*?to service_role/i);
  assert.doesNotMatch(migration, /grant usage on schema moderation_stage5_private/i);
});

test("unban requires a stable UUID and a required 10-1000 character reason", () => {
  const route = read("src/app/api/admin/users/[userId]/ban/route.js");
  const content = read("src/components/admin-user-detail-content.jsx");
  const users = read("src/components/admin-users-management.jsx");
  assert.match(route, /UUID_PATTERN\.test\(operationId\)/);
  assert.match(route, /Array\.from\(revocationReason\)\.length < 10/);
  assert.match(route, /sanctionId: operationResult\.sanction_id/);
  assert.match(route, /replayed: operationResult\.replayed === true/);
  assert.match(route, /auditEventId/);
  assert.match(content, /operationId = React\.useRef/);
  assert.match(content, /minLength=\{10\}/);
  assert.match(content, /maxLength=\{1000\}/);
  assert.match(content, /before:/);
  assert.match(content, /current:/);
  assert.match(content, /after:/);
  assert.match(users, /href=\{`\/admin\/users\/\$\{user\.id\}`\}/);
});

test("admin detail UI never offers generic modified-review ban replacement", () => {
  const content = read("src/components/admin-user-detail-content.jsx");
  assert.doesNotMatch(content, /modify_moderation_sanction_review|replacement_type|replacementType/);
  assert.match(content, /action="uphold"/);
  assert.match(content, /action="overturn"/);
  assert.match(content, /LiftBanDialog/);
});

test("Stage 5 enforcement copy is present in both English and French", () => {
  const translations = read("src/lib/translations.js");
  for (const key of [
    "adminEnforcementTitle",
    "adminEnforcementDescription",
    "adminEnforcementOpenUser",
    "adminUserCurrentStanding",
    "adminUserSanctionHistory",
    "adminIssueSanctionDescription",
    "adminIssueWarning",
    "adminIssueStrike",
    "adminRevokeSanctionDescription",
    "adminReviewOutcomeDescription",
    "adminLiftBanTitle",
    "adminLiftBanReasonValidation",
    "adminLiftBanAuditRecord",
  ]) {
    assert.equal(
      translations.split(`${key}:`).length - 1,
      2,
      `${key} must exist in EN and FR`,
    );
  }
});
