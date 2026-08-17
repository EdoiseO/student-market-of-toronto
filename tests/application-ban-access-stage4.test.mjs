import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  migration,
  banRoute,
  nameRoute,
  roleRoute,
  adminUsersPage,
  proxy,
  bannedPage,
  bannedActions,
  bannedLoading,
  roleClient,
] =
  await Promise.all([
    readFile(
      new URL(
        "../supabase/migrations/20260816171825_application_enforced_ban_access.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../src/app/api/admin/users/[userId]/ban/route.js", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/app/api/account/name/route.js", import.meta.url), "utf8"),
    readFile(
      new URL("../src/app/api/admin/users/[userId]/role/route.js", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/app/admin/users/page.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/proxy.js", import.meta.url), "utf8"),
    readFile(new URL("../src/app/banned/page.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/banned-account-actions.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/banned/loading.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/admin-users-management.jsx", import.meta.url), "utf8"),
  ]);

test("application bans are atomic, DB-timed, idempotent, and do not mutate Auth", () => {
  assert.match(migration, /create table moderation_action_private\.application_ban_commands/i);
  assert.match(migration, /unique \(actor_user_id_snapshot, request_id\)/i);
  assert.match(migration, /create function public\.set_application_moderation_ban/i);
  assert.match(migration, /language sql\s+security invoker/i);
  assert.match(migration, /begin atomic/i);
  assert.match(migration, /when '24h' then p_started_at \+ interval '24 hours'/i);
  assert.match(migration, /when '7d' then p_started_at \+ interval '7 days'/i);
  assert.match(migration, /when '30d' then p_started_at \+ interval '30 days'/i);
  assert.match(migration, /when 'permanent' then null/i);
  assert.match(migration, /insert into public\.moderation_sanctions/i);
  assert.match(migration, /insert into public\.user_status/i);
  assert.match(migration, /moderation_request_id_payload_conflict/i);
  assert.match(migration, /'enforcement', 'application'/i);
  assert.match(
    migration,
    /if normalized_action = 'ban' then[\s\S]*assert_subject[\s\S]*p_subject_user_id = actor_id[\s\S]*from auth\.users account[\s\S]*for update/i,
  );

  assert.match(banRoute, /"set_application_moderation_ban"/);
  assert.match(
    banRoute,
    /action === "ban" && getUserModerationRole\(targetUser\) === "admin"/,
  );
  assert.doesNotMatch(banRoute, /ban_duration/);
  assert.doesNotMatch(banRoute, /updateUserById/);
  assert.doesNotMatch(banRoute, /begin_auth_ban_operation/);
});

test("legacy Auth bans are imported before only matched users are made sign-in capable", () => {
  const sanctionImport = migration.indexOf("insert into public.moderation_sanctions");
  const projectionImport = migration.indexOf("insert into public.user_status", sanctionImport);
  const authClear = migration.indexOf("update auth.users account", projectionImport);

  assert.ok(sanctionImport >= 0 && projectionImport > sanctionImport && authClear > projectionImport);
  assert.match(migration, /'origin', 'legacy_auth_ban_cutover'/i);
  assert.match(
    migration,
    /update auth\.users account[\s\S]*set banned_until = null[\s\S]*exists \([\s\S]*public\.user_status[\s\S]*exists \([\s\S]*public\.moderation_sanctions/i,
  );
  assert.match(migration, /account\.banned_until > now\(\)/i);
  assert.match(migration, /not exists \([\s\S]*sanction\.sanction_type = 'ban'/i);
});

test("all direct marketplace tables, upload reservations, and user media buckets fail closed", () => {
  for (const table of [
    "profiles",
    "listings",
    "listing_images",
    "listing_favourites",
    "conversations",
    "conversation_user_state",
    "messages",
    "message_attachments",
    "message_reactions",
    "blocked_users",
    "reports",
    "notification_preferences",
  ]) {
    assert.match(migration, new RegExp(`'${table}'`));
  }

  assert.match(migration, /private\.message_media_upload_reservations/i);
  assert.match(migration, /before insert or update or delete/i);
  assert.match(migration, /auth\.jwt\(\) ->> 'role'.*= 'authenticated'/i);
  assert.match(migration, /status\.is_banned/i);
  assert.match(migration, /status\.banned_until is null[\s\S]*status\.banned_until > statement_timestamp/i);

  for (const bucket of ["profile-images", "listing-images", "message-media"]) {
    assert.match(migration, new RegExp(`'${bucket}'`));
  }

  assert.doesNotMatch(migration, /reject_banned_authenticated_write[\s\S]*public\.notifications/);
  assert.doesNotMatch(migration, /reject_banned_authenticated_write[\s\S]*public\.moderation_sanctions/);
});

test("standing lifecycle and password-confirmed account deletion remain reachable", () => {
  assert.match(proxy, /path === "\/api\/account\/delete" && request\.method === "POST"/);
  assert.match(proxy, /isBannedRoute \|\| isAccountStandingRoute \|\| isAccountDeleteRoute/);
  assert.match(proxy, /userStatusResult\.available !== true \|\| Boolean\(userStatusResult\.error\)/);
  assert.match(proxy, /userStatusUnavailable && !isBannedAccountAllowedRoute/);
  assert.match(proxy, /status: 503/);
  assert.match(bannedPage, /userStatusResult\.available !== true \|\| Boolean\(userStatusResult\.error\)/);
  assert.match(bannedPage, /!userStatusUnavailable && !isUserBanned/);
  assert.match(bannedActions, /fetch\("\/api\/account\/delete"/);
  assert.match(bannedActions, /body: JSON\.stringify\(\{ password: confirmationPassword \}\)/);
  assert.match(bannedActions, /settingsDeleteAccountConfirmPasswordHelp/);
  assert.match(bannedActions, /supabase\.auth\.signOut\(\)/);
  assert.match(bannedActions, /htmlFor="banned-account-delete-password"/);
  assert.match(bannedActions, /id="banned-account-delete-password"/);
  assert.equal((bannedLoading.match(/<Skeleton className="h-11/g) ?? []).length, 4);

  assert.doesNotMatch(migration, /on public\.notifications[\s\S]*reject_banned_authenticated_write/i);
  assert.doesNotMatch(
    migration,
    /on public\.moderation_sanctions[\s\S]*reject_banned_authenticated_write/i,
  );
});

test("service-backed identity and role writes explicitly verify application standing", () => {
  for (const source of [nameRoute, roleRoute]) {
    assert.match(source, /getUserStatusRow\(/);
    assert.match(source, /available !== true \|\| .*\.error/s);
    assert.match(source, /isUserBanned\(/);
    assert.match(source, /status: 403/);
  }

  assert.match(adminUsersPage, /rpc\("list_admin_user_directory"/);
  assert.match(adminUsersPage, /isUserBanned\(directoryUser\)/);
  assert.match(adminUsersPage, /legacyAuthBanActive/);
  assert.match(adminUsersPage, /if \(!directory\)/);
  assert.match(adminUsersPage, /adminUsersStatusUnavailableTitle/);
  assert.match(adminUsersPage, /adminUsersStatusUnavailableDescription/);
  assert.match(roleRoute, /getUserStatusRow\(admin, targetUserId\)/);
  assert.match(roleRoute, /targetStatusResult\.available !== true \|\| targetStatusResult\.error/);
  assert.match(roleRoute, /isUserBanned\(targetStatusResult\.data\) && action !== "remove_moderator"/);
  assert.match(roleRoute, /Unban this account before granting or transferring moderation access/);
  assert.match(roleClient, /user\.role !== "admin" && !user\.isBanned/);
  assert.match(roleClient, /user\.role !== "admin" && !user\.isBanned \? \(/);
});

test("application bans deliberately preserve recipient-owned RLS reads", () => {
  assert.match(migration, /Recipient-owned SELECT access intentionally remains available/i);
  assert.match(migration, /restriction is mutation-only at the data boundary/i);
  assert.doesNotMatch(migration, /create policy[\s\S]*for select[\s\S]*account_is_banned/i);
});

test("stale Auth-first callable entry points are revoked", () => {
  for (const functionName of [
    "begin_auth_ban_operation",
    "complete_auth_ban_operation",
    "abort_auth_ban_operation",
    "issue_moderation_ban",
    "revoke_active_moderation_ban",
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke execute on function public\\.${functionName}`, "i"),
    );
  }
});

test("review modification cannot use the obsolete Auth-coupled ban escalation path", () => {
  assert.match(migration, /application_ban_replacement_requires_separate_action/);
  assert.match(migration, /modify_application_safe_sanction_review_impl/);
  assert.match(
    migration,
    /create or replace function public\.modify_moderation_sanction_review[\s\S]*security invoker[\s\S]*begin atomic/i,
  );
  assert.match(
    migration,
    /ban escalation must use the atomic application-ban command/i,
  );
});
