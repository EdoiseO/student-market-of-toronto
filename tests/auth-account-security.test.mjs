import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoFile = (path) => new URL(`../${path}`, import.meta.url);

const expectedSchoolDomains = [
  "utoronto.ca",
  "mail.utoronto.ca",
  "torontomu.ca",
  "yorku.ca",
  "my.yorku.ca",
  "georgebrown.ca",
  "mail.georgebrown.ca",
  "senecapolytechnic.ca",
  "myseneca.ca",
  "humber.ca",
  "student.humber.ca",
  "students.humber.ca",
  "centennialcollege.ca",
  "my.centennialcollege.ca",
  "ocadu.ca",
];

test("Auth creation hook enforces the exact normalized Toronto school allowlist", async () => {
  const [hookSql, clientAllowlist] = await Promise.all([
    readFile(
      repoFile("supabase/migrations/20260812233338_enforce_toronto_school_signup_hook.sql"),
      "utf8",
    ),
    readFile(repoFile("src/lib/school-email.js"), "utf8"),
  ]);
  const migrationDomains = [...hookSql.matchAll(/when '([^']+)' then/g)].map(
    (match) => match[1],
  );
  const clientDomains = [...clientAllowlist.matchAll(/^\s*"([^"]+)":/gm)].map(
    (match) => match[1],
  );

  assert.deepEqual(migrationDomains, expectedSchoolDomains);
  assert.deepEqual(clientDomains, expectedSchoolDomains);
  assert.match(hookSql, /lower\(pg_catalog\.btrim[\s\S]*event -> 'user' ->> 'email'/i);
  assert.match(
    hookSql,
    /school_name := private\.toronto_school_name_for_email\(normalized_email\)/i,
  );
  assert.match(hookSql, /'http_code', 403/i);
  assert.match(
    hookSql,
    /revoke all on function public\.before_user_created_enforce_toronto_school\(jsonb\)[\s\S]*from public, anon, authenticated, service_role/i,
  );
  assert.match(
    hookSql,
    /grant execute on function public\.before_user_created_enforce_toronto_school\(jsonb\)\s+to supabase_auth_admin/i,
  );
  assert.doesNotMatch(hookSql, /grant execute[\s\S]*to (?:anon|authenticated|service_role)/i);
});

test("profile identity is email-derived and writable only through trusted server paths", async () => {
  const [identitySql, registration, layout, profileForm, nameRoute, adminUsers, reportActions] =
    await Promise.all([
      readFile(
        repoFile("supabase/migrations/20260812233552_protect_profile_identity_fields.sql"),
        "utf8",
      ),
      readFile(repoFile("src/components/register-form.jsx"), "utf8"),
      readFile(repoFile("src/app/layout.js"), "utf8"),
      readFile(repoFile("src/components/profile-settings-form.jsx"), "utf8"),
      readFile(repoFile("src/app/api/account/name/route.js"), "utf8"),
      readFile(repoFile("src/app/admin/users/page.jsx"), "utf8"),
      readFile(repoFile("src/app/api/admin/reports/actions/route.js"), "utf8"),
    ]);

  assert.match(identitySql, /derived_school text := private\.toronto_school_name_for_email\(new\.email\)/i);
  assert.doesNotMatch(identitySql, /raw_user_meta_data\s*->>\s*'school'/i);
  assert.match(identitySql, /security definer\s+set search_path = ''/i);
  assert.match(
    identitySql,
    /revoke all on function public\.handle_new_user\(\)[\s\S]*from public, anon, authenticated, service_role, supabase_auth_admin/i,
  );
  assert.match(
    identitySql,
    /before insert or update of first_name, last_name, school on public\.profiles/i,
  );
  assert.match(identitySql, /profile_identity_requires_trusted_api/g);
  assert.doesNotMatch(registration, /data:\s*\{[\s\S]{0,200}school,/);

  for (const source of [layout, adminUsers, reportActions]) {
    assert.doesNotMatch(source, /user_metadata\?*\.(?:first_name|last_name|school)/);
  }
  assert.doesNotMatch(layout, /sync profile from auth metadata/i);
  assert.doesNotMatch(profileForm, /school:\s*normalizedSchool/);
  assert.match(nameRoute, /admin\.from\("profiles"\)\.upsert/);
  assert.doesNotMatch(nameRoute, /user_metadata:/);
  assert.match(nameRoute, /force_name_change:\s*null/);
  assert.doesNotMatch(nameRoute, /delete nextAppMetadata\.force_name_change/);
  assert.doesNotMatch(nameRoute, /delete nextAppMetadata\[REJECTED_PROFILE_NAME_FINGERPRINT_KEY\]/);
  assert.match(nameRoute, /getRejectedProfileNameFingerprints\(/);
  assert.doesNotMatch(reportActions, /user_metadata:/);
  assert.match(reportActions, /appendRejectedProfileNameFingerprint\(/);
});

test("account deletion requires same-origin current-password verification before cleanup", async () => {
  const [deleteRoute, adminHelper, settings] = await Promise.all([
    readFile(repoFile("src/app/api/account/delete/route.js"), "utf8"),
    readFile(repoFile("src/lib/supabase-admin.js"), "utf8"),
    readFile(repoFile("src/components/dashboard-settings-content.jsx"), "utf8"),
  ]);
  const originIndex = deleteRoute.indexOf("if (!hasExpectedOrigin(request))");
  const parseIndex = deleteRoute.indexOf("const payload = await request.json()");
  const verifyIndex = deleteRoute.indexOf("passwordVerified = await verifyUserPassword(");
  const cleanupIndex = deleteRoute.indexOf(
    "await retireOutstandingMessageMediaReservations(admin, user.id)",
  );

  assert.ok(originIndex >= 0);
  assert.ok(parseIndex > originIndex);
  assert.ok(verifyIndex > parseIndex);
  assert.ok(cleanupIndex > verifyIndex);
  assert.match(deleteRoute, /new URL\(origin\)\.origin === request\.nextUrl\.origin/);
  assert.match(adminHelper, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY/);
  assert.match(adminHelper, /signInWithPassword\(\{ email, password \}\)/);
  assert.match(adminHelper, /data\?\.user\?\.id === userId/);
  assert.match(adminHelper, /signOut\(\{ scope: "local" \}\)/);
  assert.match(settings, /JSON\.stringify\(\{ password: confirmationPassword \}\)/);
  assert.match(settings, /autoComplete="current-password"/);
  assert.match(
    settings,
    /onOpenChange=\{\(open\) => \{[\s\S]{0,120}setConfirmationPassword\(""\)/,
  );
  assert.doesNotMatch(settings, /confirmationEmail|emailMatches/);
});
