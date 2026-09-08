import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createPostgresFixture, postgresAvailable } from "./helpers/postgres-fixture.mjs";

const id = (n) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const email = (n) => `student-${id(n)}@example.com`;
const literal = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const owner = id(1);
const buyer = id(2);
const migration = new URL("../supabase/migrations/20260906160016_registered_demo_account_emails.sql", import.meta.url);
const historical = (name) => new URL("../supabase/migrations/" + name, import.meta.url);
const schoolHook = historical("20260812233338_enforce_toronto_school_signup_hook.sql");
const profileMigration = readFileSync(historical("20260816192910_stage6_profile_registration_required_fields.sql"), "utf8");
const stage8 = readFileSync(historical("20260817120920_stage8_release_security_hardening.sql"), "utf8");
const initialProfileHandler = profileMigration.slice(
  profileMigration.indexOf("create or replace function public.handle_new_user()"),
  profileMigration.indexOf("create or replace function private.protect_profile_identity_fields()"),
);
const trustedProfileWriter = profileMigration.slice(
  profileMigration.indexOf("create schema if not exists profile_action_private;"),
  profileMigration.indexOf("comment on function public.save_profile_identity_from_server("),
);

test("keeps the exact already-applied migration record immutable", () => {
  assert.equal(createHash("sha256").update(readFileSync(migration)).digest("hex"),
    "99d9d2e274b8507eb32e58f5eeb841e4d8b0ea8904fab18f8a1cb945b56e87cb");
});

test("registered demo identities preserve the existing marketplace and admission rules", {
  skip: !postgresAvailable,
}, async (t) => {
  const pg = createPostgresFixture(t, { prefix: "demo-id-", username: "postgres" });
  pg.apply(new URL("./fixtures/registered-demo-identities-base.sql", import.meta.url));
  pg.apply(schoolHook);
  pg.sql(initialProfileHandler);
  pg.sql(stage8.slice(stage8.indexOf("create or replace function private.protect_profile_identity_fields()")));
  pg.sql(trustedProfileWriter);
  pg.sql(`
    create trigger create_profile after insert on auth.users
      for each row execute function public.handle_new_user();
    create trigger protect_profile_identity_fields
      before insert or update of first_name, last_name, school on public.profiles
      for each row execute function private.protect_profile_identity_fields();
    grant usage on schema profile_action_private to service_role;
    grant execute on function private.toronto_school_name_for_email(text) to helper_acl_probe;
    insert into auth.users(id,email) values
      ('${owner}','fixture-owner@georgebrown.ca'),
      ('${buyer}','fixture-buyer@yorku.ca'),
      ('${id(3)}','fixture-deleted@ocadu.ca'),
      ('${id(4)}','fixture-removable@humber.ca');
    update auth.users set deleted_at=now() where id='${id(3)}';
    insert into public.listings values
      ('${id(10)}','${owner}','Fixture listing','Preserve this listing exactly');
    insert into public.listing_images values
      ('${id(11)}','${id(10)}','${owner}/${id(10)}/image.webp');
    insert into public.conversations values
      ('${id(12)}','${owner}','${buyer}','${id(10)}');
  `);
  const helperBefore = pg.sql(`select jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl)
    from pg_proc where oid='private.toronto_school_name_for_email(text)'::regprocedure;`);
  const marketplaceSnapshot = () => pg.sql(`select jsonb_build_object(
    'listings',(select jsonb_agg(to_jsonb(row) order by id) from public.listings row),
    'images',(select jsonb_agg(to_jsonb(row) order by id) from public.listing_images row),
    'conversations',(select jsonb_agg(to_jsonb(row) order by id) from public.conversations row));`);
  const originalMarketplace = marketplaceSnapshot();
  const originalIdentity = pg.sql(`select jsonb_build_object('id',account.id,
    'password',encrypted_password,'metadata',raw_app_meta_data,'user_metadata',raw_user_meta_data,
    'profile',to_jsonb(profile)) from auth.users account
    join public.profiles profile on profile.id=account.id where account.id='${owner}';`);
  pg.apply(migration);

  await t.test("keeps existing helper ownership and exact ACL while observing registry changes", () => {
    assert.equal(pg.sql(`select jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl)
      from pg_proc where oid='private.toronto_school_name_for_email(text)'::regprocedure;`), helperBefore);
    assert.equal(pg.sql(`select provolatile='s' and prosecdef and proconfig=array['search_path=""']
      from pg_proc where oid='private.toronto_school_name_for_email(text)'::regprocedure;`), "t");
    assert.equal(pg.sql(`select private.toronto_school_name_for_email('${email(1)}') is null;`), "t");
    // A literal argument must not freeze an unregistered result in a cached
    // plan. This fails if the registry-backed helper is incorrectly IMMUTABLE.
    assert.equal(pg.sql(`prepare school_lookup as
      select coalesce(private.toronto_school_name_for_email('${email(1)}'),'unmapped');
      execute school_lookup;
      insert into private.demo_account_identities(user_id,demo_email,school) values
        ('${owner}','${email(1)}','George Brown College');
      execute school_lookup;`), "unmapped\nGeorge Brown College");
    assert.equal(pg.sql(`set role supabase_auth_admin;
      select private.toronto_school_name_for_email('${email(1)}');`), "George Brown College");
  });

  await t.test("denies fresh signup and another UUID taking a registered address before replacement", () => {
    const signup = pg.result(`set role supabase_auth_admin;
      insert into auth.users(id,email) values ('${id(99)}','${email(1)}');`);
    assert.notEqual(signup.status, 0);
    assert.match(signup.stderr, /demo_email_requires_registered_existing_account/);
    const other = pg.result(`set role supabase_auth_admin;
      update auth.users set email='${email(1)}' where id='${buyer}';`);
    assert.notEqual(other.status, 0);
    assert.match(other.stderr, /demo_email_requires_registered_existing_account/);
    assert.equal(pg.sql(`select count(*) from auth.users where email='${email(1)}';`), "0");
  });

  await t.test("allows existing-user replacement and leaves passwords, ownership and content intact", () => {
    pg.sql(`set role supabase_auth_admin;
      update auth.users set email='${email(1)}' where id='${owner}';`);
    assert.equal(pg.sql(`select email from auth.users where id='${owner}';`), email(1));
    assert.equal(marketplaceSnapshot(), originalMarketplace);
    assert.equal(pg.sql(`select jsonb_build_object('id',account.id,
      'password',encrypted_password,'metadata',raw_app_meta_data,'user_metadata',raw_user_meta_data,
      'profile',to_jsonb(profile)) from auth.users account
      join public.profiles profile on profile.id=account.id where account.id='${owner}';`), originalIdentity);
  });

  await t.test("retains all exact school domains without opening example.com or subdomains", () => {
    const domains = new Map([
      ["utoronto.ca", "University of Toronto"], ["mail.utoronto.ca", "University of Toronto"],
      ["torontomu.ca", "Toronto Metropolitan University"], ["yorku.ca", "York University"],
      ["my.yorku.ca", "York University"], ["georgebrown.ca", "George Brown College"],
      ["mail.georgebrown.ca", "George Brown College"], ["senecapolytechnic.ca", "Seneca Polytechnic"],
      ["myseneca.ca", "Seneca Polytechnic"], ["humber.ca", "Humber Polytechnic"],
      ["student.humber.ca", "Humber Polytechnic"], ["students.humber.ca", "Humber Polytechnic"],
      ["centennialcollege.ca", "Centennial College"], ["my.centennialcollege.ca", "Centennial College"],
      ["ocadu.ca", "OCAD University"],
    ]);
    for (const [domain, school] of domains) {
      assert.equal(pg.sql(`select private.toronto_school_name_for_email('  PERSON@${domain.toUpperCase()}  ');`), school);
    }
    for (const address of ["ordinary@example.com", email(77), "any@sub.georgebrown.ca", "any@example.org"]) {
      assert.equal(pg.sql(`select private.toronto_school_name_for_email(${literal(address)}) is null;`), "t");
      assert.notEqual(pg.result(`set role supabase_auth_admin;
        update auth.users set email=${literal(address)} where id='${buyer}';`).status, 0);
    }
    pg.sql(`set role supabase_auth_admin;
      insert into auth.users(id,email) values ('${id(5)}','fixture-new@ocadu.ca');
      update auth.users set email='fixture-buyer@utoronto.ca' where id='${buyer}';`);
    assert.equal(pg.sql(`select school from public.profiles where id='${buyer}';`), "University of Toronto");
  });

  await t.test("continues using the original trusted name RPC with a reserved demo email", () => {
    assert.equal(pg.sql(`set role service_role; set request.jwt.claim.role='service_role';
      select public.save_profile_identity_from_server('${owner}','Demo','Student','${"a".repeat(64)}');`), "f");
    assert.equal(pg.sql(`select first_name || ' ' || last_name || ':' || school
      from public.profiles where id='${owner}';`), "Demo Student:George Brown College");
    assert.equal(marketplaceSnapshot(), originalMarketplace);
  });

  await t.test("keeps the registry and trigger function inaccessible to API/Auth client roles", () => {
    assert.equal(pg.sql(`select relrowsecurity from pg_class where oid='private.demo_account_identities'::regclass;`), "t");
    assert.equal(pg.sql(`select count(*) from pg_policies where schemaname='private' and tablename='demo_account_identities';`), "0");
    for (const role of ["anon", "authenticated", "service_role", "supabase_auth_admin"]) {
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
        assert.equal(pg.sql(`select has_table_privilege('${role}','private.demo_account_identities','${privilege}');`), "f");
      }
      assert.notEqual(pg.result(`set role ${role}; select * from private.demo_account_identities;`).status, 0);
      assert.equal(pg.sql(`select has_function_privilege('${role}',
        'private.guard_registered_demo_identity_email()','EXECUTE');`), "f");
    }
  });

  await t.test("rejects malformed mappings and treats deleted/nonexistent accounts as unmapped", () => {
    assert.notEqual(pg.result(`insert into private.demo_account_identities values
      ('${buyer}','arbitrary@example.com','York University',now());`).status, 0);
    assert.notEqual(pg.result(`insert into private.demo_account_identities values
      ('${buyer}','${email(2)}','Invented School',now());`).status, 0);
    assert.notEqual(pg.result(`insert into private.demo_account_identities values
      ('${id(88)}','${email(88)}','York University',now());`).status, 0);
    pg.sql(`insert into private.demo_account_identities(user_id,demo_email,school) values
      ('${id(3)}','${email(3)}','OCAD University'),
      ('${id(4)}','${email(4)}','Humber Polytechnic');`);
    assert.equal(pg.sql(`select private.toronto_school_name_for_email('${email(3)}') is null;`), "t");
    assert.notEqual(pg.result(`set role supabase_auth_admin;
      update auth.users set email='${email(3)}' where id='${id(3)}';`).status, 0);
    pg.sql(`delete from auth.users where id='${id(4)}';`);
    assert.equal(pg.sql(`select count(*) from private.demo_account_identities where user_id='${id(4)}';`), "0");
    assert.equal(pg.sql(`select private.toronto_school_name_for_email('${email(4)}') is null;`), "t");
    assert.notEqual(pg.result(`set role supabase_auth_admin;
      insert into auth.users(id,email) values ('${id(4)}','${email(4)}');`).status, 0);
  });

  await t.test("restores the original school email without changing retained marketplace data", () => {
    pg.sql(`set role supabase_auth_admin;
      update auth.users set email='fixture-owner@georgebrown.ca' where id='${owner}';`);
    pg.sql(`delete from private.demo_account_identities where user_id='${owner}';`);
    assert.equal(pg.sql(`select private.toronto_school_name_for_email('${email(1)}') is null;`), "t");
    assert.equal(marketplaceSnapshot(), originalMarketplace);
  });
});


test("requires the known privileged helper owner before creating registry state", {skip:!postgresAvailable}, (t) => {
  const pg = createPostgresFixture(t,{prefix:"demo-owner-",username:"postgres"});
  pg.apply(new URL("./fixtures/registered-demo-identities-base.sql", import.meta.url));
  pg.apply(schoolHook);
  pg.sql("alter function private.toronto_school_name_for_email(text) owner to helper_acl_probe;");
  const result = pg.result(readFileSync(migration,"utf8"));
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/demo_identity_expected_school_helper_missing_or_wrong_owner/);
  assert.equal(pg.sql("select to_regclass('private.demo_account_identities') is null;"),"t");
});
