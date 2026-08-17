import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [migration, hardeningMigration, route, worker, dashboard, shell, mobileNav, navigation, usersPage, overviewPage, reportsPage, listingsPage, boundedRecords, announcementsPage, translations] = await Promise.all([
  readFile(new URL("../supabase/migrations/20260816181148_admin_announcement_operations_stage5.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260816190243_harden_announcement_lifecycle_idempotency_and_fairness.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/admin/announcements/route.js", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/announcement-delivery-worker.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/components/admin-announcements-dashboard.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/app-layout-shell.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/mobile-bottom-nav.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/admin-navigation.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/admin/users/page.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/admin/page.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/admin/reports/page.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/admin/listings/page.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/admin-bounded-records.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/admin/announcements/page.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/translations.js", import.meta.url), "utf8"),
]);

test("announcement operations use hidden definers, service-only invoker wrappers, and durable command replay", () => {
  assert.match(migration, /create table public\.announcement_draft_commands/);
  assert.match(migration, /operation_id uuid primary key/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /announcement_operation_id_conflict/);
  assert.match(migration, /create_announcement_draft_idempotent_impl/);
  assert.match(migration, /language sql[\s\S]*?security invoker[\s\S]*?begin atomic/i);
  assert.doesNotMatch(migration, /grant usage on schema announcement_worker_private/i);
  assert.match(migration, /grant execute on function public\.create_announcement_draft_idempotent[\s\S]*?to service_role/i);
  assert.match(hardeningMigration, /create table public\.announcement_lifecycle_commands/);
  assert.match(hardeningMigration, /execute_announcement_lifecycle_command_impl/);
  assert.match(hardeningMigration, /result_snapshot jsonb not null/);
  assert.match(hardeningMigration, /announcement_operation_id_conflict/);
  assert.match(hardeningMigration, /announcement_lifecycle_commands_are_immutable/);
  assert.match(hardeningMigration, /grant execute on function public\.execute_announcement_lifecycle_command[\s\S]*?to service_role/i);
  assert.doesNotMatch(hardeningMigration, /grant usage on schema announcement_worker_private/i);
});

test("scheduled activation and retry preserve audit, locking, and terminal delivery invariants", () => {
  assert.match(migration, /activate_due_scheduled_announcements_impl/);
  assert.match(migration, /where announcement\.status = 'scheduled'[\s\S]*?for update skip locked/i);
  assert.match(migration, /when 'urgent' then 1/);
  assert.match(migration, /event_type[\s\S]*?'announcement\.sending'/i);
  assert.match(migration, /retry_failed_announcement_impl/);
  assert.match(migration, /announcements[\s\S]*?for update;[\s\S]*?announcement_deliveries[\s\S]*?for update;[\s\S]*?announcement_delivery_outbox[\s\S]*?for update of outbox/i);
  assert.match(migration, /delivery\.status = 'failed'[\s\S]*?outbox\.queue_status = 'dead'/i);
  assert.match(migration, /queue_status = 'pending'[\s\S]*?attempt_count = 0/);
  assert.match(hardeningMigration, /order by\s+announcement\.scheduled_for,[\s\S]*?case announcement\.priority/i);
  assert.doesNotMatch(hardeningMigration, /order by\s+case announcement\.priority[\s\S]*?announcement\.scheduled_for/i);
});

test("admin route keeps direct send compatible while bounding delivery and exposing lifecycle operations", () => {
  assert.match(route, /create_and_start_announcement/);
  assert.match(route, /create_announcement_draft_idempotent/);
  assert.match(route, /execute_announcement_lifecycle_command/);
  assert.match(route, /maxBatches: 1/);
  assert.match(route, /maxDeliveries: 10/);
  assert.doesNotMatch(route, /requireRpc\(admin, "retry_failed_announcement"/);
  assert.doesNotMatch(route, /requireRpc\(admin, "transition_announcement"/);
  assert.doesNotMatch(route, /requireRpc\(admin, "update_announcement_draft"/);
  assert.match(route, /\["create_draft", "send"\]\.includes\(action\)/);
  assert.match(route, /Unsupported announcement action/);
  assert.match(route, /replayed: command\.replayed === true/);
  assert.match(route, /run_worker/);
  assert.match(route, /emailAvailable: false/);
  assert.doesNotMatch(route, /\.from\("(?:messages|notifications|conversations)"\)\.insert/);
});

test("worker activates schedules before bounded fair dispatch", () => {
  assert.match(worker, /activateDueScheduledAnnouncements/);
  assert.match(worker, /activate_due_scheduled_announcements/);
  assert.match(worker, /maxScheduledActivations/);
  assert.match(worker, /scheduledActivatedCount/);
});

test("announcement UI exposes required lifecycle, audience, status, and worker states", () => {
  for (const action of ["create_draft", "update_draft", "schedule", "unschedule", "send", "cancel", "retry", "run_worker"]) {
    assert.match(dashboard, new RegExp("[\\\"']" + action + "[\\\"']"));
  }
  assert.match(dashboard, /datetime-local/);
  assert.match(dashboard, /ANNOUNCEMENT_AUDIENCE_TYPES/);
  assert.match(dashboard, /worker\.configured/);
  assert.match(dashboard, /operationFor\(operationRef, payload\)/);
  assert.match(dashboard, /<form[^>]+onSubmit=\{submitEditor\}/);
  assert.match(dashboard, /id="announcement-title"[\s\S]*?required/);
  assert.match(dashboard, /id="announcement-body"[\s\S]*?required/);
  assert.match(dashboard, /type="submit" value="send"/);
  assert.match(announcementsPage, /requireAdminPageAction/);
});

test("shared admin navigation is role-aware and suppresses the marketplace FAB in admin and message detail", () => {
  assert.match(navigation, /canPerformModerationAction/);
  assert.match(navigation, /\/admin\/announcements/);
  assert.match(navigation, /\/admin\/audit/);
  assert.match(shell, /!isAdminPage && !isMessagesConversationPage/);
  assert.match(mobileNav, /showModerationEntry/);
  assert.match(mobileNav, /href: "\/admin"/);
});

test("user directory fetches one bounded server page instead of walking the auth directory", () => {
  assert.match(usersPage, /list_admin_user_directory/);
  assert.match(usersPage, /p_page_size: perPage/);
  assert.match(usersPage, /perPage = 50/);
  assert.doesNotMatch(usersPage, /auth\.admin\.listUsers/);
  assert.doesNotMatch(usersPage, /for \(let page = 1; page <= 20/);
});

test("overview and registries use bounded, filtered, fail-closed moderation data", () => {
  assert.match(overviewPage, /getUserStatusRow/);
  assert.match(overviewPage, /\.neq\("restrictions", "\{\}"\)/);
  assert.doesNotMatch(overviewPage, /\.neq\("restrictions", \{\}\)/);
  assert.match(overviewPage, /\.eq\("status", "inactive"\)\.not\("submitted_for_review_at", "is", null\)/);
  assert.match(reportsPage, /<form[\s\S]*?method="get"/);
  assert.match(reportsPage, /function FilterField/);
  assert.match(reportsPage, /NativeSelect className="w-full" name="status"/);
  assert.match(reportsPage, /NativeSelect className="w-full" name="subject"/);
  assert.match(reportsPage, /NativeSelect className="w-full" name="reason"/);
  assert.match(reportsPage, /xl:grid-cols-\[minmax\(260px,1\.7fr\)_repeat\(3,minmax\(150px,1fr\)\)_minmax\(170px,0\.8fr\)\]/);
  assert.match(reportsPage, /filterParams\.set\("status", status\)/);
  assert.match(reportsPage, /\.range\(from, from \+ PAGE_SIZE - 1\)/);
  assert.match(listingsPage, /<form method="get"/);
  assert.match(listingsPage, /new URLSearchParams\(\{ status: queueStatus \}\)/);
  assert.match(listingsPage, /\.range\(from, from \+ PAGE_SIZE - 1\)/);
  assert.match(boundedRecords, /<Button type="button" variant="outline" size="sm" disabled>/);
});

test("shared Stage 5 navigation and filter copy is present in English and French", () => {
  for (const key of [
    "adminFilterStatus",
    "adminFilterSubject",
    "adminFilterReason",
    "adminListingQueueFilter",
    "adminListingQueuePending",
    "adminListingQueueApproved",
    "adminListingQueueRejected",
    "adminConversationsWindowHint",
    "adminEnforcementTitle",
  ]) {
    assert.equal((translations.match(new RegExp(`\\b${key}:`, "g")) ?? []).length, 2, `${key} must have EN and FR copy`);
  }
});
