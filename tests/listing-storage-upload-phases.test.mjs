import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createPostgresFixture, postgresAvailable } from "./helpers/postgres-fixture.mjs";

const migration = new URL("../supabase/migrations/20260907190013_fix_listing_storage_upload_phases.sql", import.meta.url);
const stage8 = readFileSync(new URL("../supabase/migrations/20260817120920_stage8_release_security_hardening.sql", import.meta.url), "utf8");
const oldFunction = stage8.slice(stage8.indexOf("create or replace function listing_action_private.guard_retiring_listing_image_upload()"),
  stage8.indexOf("-- Abort quotas cover"));
const seller = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const listing = "33333333-3333-4333-8333-333333333333";
const operation = "44444444-4444-4444-8444-444444444444";
const path = `${seller}/${listing}/reserved.png`;
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
const metadata = { mimetype: "image/png", size: 100 };
const preflightMetadata = { mimetype: "image/png", contentLength: 375 };
const insert = (value = metadata, owner = seller, name = path, bucket = "listing-images") =>
  `insert into storage.objects(bucket_id,name,owner_id,metadata) values (${literal(bucket)},${literal(name)},${literal(owner)},${literal(JSON.stringify(value))}::jsonb);`;
const session = (statement, { role = "authenticated", sub = seller, uploadOperation = "storage.object.upload" } = {}) =>
  `set role ${role}; set request.jwt.claims=${literal(JSON.stringify({ role, ...(sub === null ? {} : { sub }) }))};
   set storage.operation=${literal(uploadOperation)}; ${statement}`;
const completion = statement => session(statement, { role: "service_role", sub: null });

test("listing Storage validates the actual preflight and completion phases", { skip: !postgresAvailable, timeout: 60_000 }, async t => {
  const fixture = createPostgresFixture(t, { prefix: "smot-list-up-" });
  fixture.sql(BOOTSTRAP);
  fixture.sql(oldFunction);
  fixture.sql(`create trigger guard_retiring_listing_image_upload before insert or update on storage.objects
    for each row execute function listing_action_private.guard_retiring_listing_image_upload();`);
  const triggerOid = fixture.sql("select oid from pg_trigger where tgname='guard_retiring_listing_image_upload';");
  const reset = () => fixture.sql(`
    truncate storage.objects, listing_action_private.account_retirements,
      listing_action_private.image_upload_reservations, listing_action_private.write_intents;
    insert into listing_action_private.write_intents(actor_user_id,operation_id,state)
      values ('${seller}','${operation}','in_progress');
    insert into listing_action_private.image_upload_reservations(
      storage_path,actor_user_id_snapshot,operation_id,listing_id_snapshot,state,expires_at,mime_type,size_bytes)
      values ('${path}','${seller}','${operation}','${listing}','reserved',now()+interval '1 hour','image/png',100);
  `);
  const fails = (statement, expected) => {
    const result = fixture.result(statement);
    assert.notEqual(result.status, 0, "The prohibited object write must fail.");
    assert.match(result.stderr, expected);
    assert.equal(fixture.sql("select count(*) from storage.objects;"), "0");
  };
  reset();
  await t.test("pre-fix: ordinary multipart preflight fails even with an exact live reservation", () => {
    fails(session(`begin; ${insert(preflightMetadata)} rollback;`), /listing_image_reservation_metadata_mismatch/);
    // The former native positive control supplied final metadata in the wrong phase.
    fixture.sql(session(`begin; ${insert()} rollback;`));
  });
  await t.test("pre-fix: internal completion skips the old authenticated-only final-size check", () => {
    fixture.sql(completion(`begin; ${insert({ mimetype: "image/png", size: 101 })} rollback;`));
  });

  fixture.apply(migration);
  fixture.apply(migration);
  await t.test("migration preserves the trigger and private function ownership and grants", () => {
    assert.equal(fixture.sql("select oid from pg_trigger where tgname='guard_retiring_listing_image_upload';"), triggerOid);
    assert.equal(fixture.sql(`select proowner::regrole::text || ':' || prosecdef::text || ':' ||
      (proconfig = array['search_path=""'])::text from pg_proc
      where oid='listing_action_private.guard_retiring_listing_image_upload()'::regprocedure;`), "postgres:true:true");
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.equal(fixture.sql(`select has_function_privilege('${role}',
        'listing_action_private.guard_retiring_listing_image_upload()','execute');`), "f");
    }
  });
  await t.test("normal multipart preflight rolls back and completion persists exact actual metadata", () => {
    reset();
    fixture.sql(session(`begin; ${insert(preflightMetadata)} rollback;`));
    assert.equal(fixture.sql("select count(*) from storage.objects;"), "0");
    fixture.sql(completion(insert()));
    assert.equal(fixture.sql(`select owner_id || ':' || (metadata->>'mimetype') || ':' || (metadata->>'size') from storage.objects;`),
      `${seller}:image/png:100`);
  });
  await t.test("unknown request length and normalized operation/MIME representations remain supported", () => {
    reset();
    fixture.sql(session(`begin; ${insert({ mimetype: "IMAGE/PNG" })} rollback;`, { uploadOperation: "object.upload" }));
    fixture.sql(session(insert({ mimetype: "IMAGE/PNG", size: "100" }),
      { role: "service_role", sub: null, uploadOperation: "object.upload" }));
  });
  await t.test("authenticated writes outside standard Storage upload cannot masquerade as preflight", () => {
    for (const uploadOperation of ["", "storage.object.update", "storage.object.upload_signed", "storage.object.move", "storage.object.copy"]) {
      reset();
      fails(session(insert(preflightMetadata), { uploadOperation }), /listing_image_upload_context_invalid/);
    }
  });
  await t.test("only service_role without a subject can perform standard upload completion", () => {
    for (const context of [
      { role: "service_role", sub: seller },
      { role: "service_role", sub: null, uploadOperation: "" },
      { role: "service_role", sub: null, uploadOperation: "storage.object.update" },
      { role: "authenticated", sub: null },
    ]) {
      reset();
      fails(session(insert(), context), /listing_image_upload_context_invalid/);
    }
  });
  await t.test("both phases reject missing or different MIME metadata", () => {
    for (const value of [null, {}, { contentLength: 375 }, { mimetype: "image/jpeg", size: 100 }, { mimetype: "text/html", size: 100 }]) {
      for (const wrap of [session, completion]) {
        reset();
        fails(wrap(insert(value)), /listing_image_reservation_metadata_mismatch/);
      }
    }
  });
  await t.test("completion cannot substitute contentLength for final size or accept malformed sizes", () => {
    for (const size of [undefined, null, "", 99, 101, -1, 0, "1e2", "100.0", "100x", "99999999999999999999", {}, []]) {
      reset();
      fails(completion(insert({ mimetype: "image/png", contentLength: 100, ...(size === undefined ? {} : { size }) })),
        /listing_image_reservation_metadata_mismatch/);
    }
  });
  await t.test("a real size supplied during authenticated preflight still must match", () => {
    reset();
    fails(session(insert({ mimetype: "image/png", size: 101 })), /listing_image_reservation_metadata_mismatch/);
    fixture.sql(session(`begin; ${insert()} rollback;`));
  });
  await t.test("caller, owner, reserved path, listing, and operation bindings hold in both phases", () => {
    for (const wrap of [session, completion]) {
      for (const [owner, name] of [[other, path], ["", path], [seller, `invalid/${listing}/reserved.png`],
        [seller, `${seller}/${listing}/unreserved.png`], [seller, `${seller}/${other}/reserved.png`]]) {
        reset();
        fails(wrap(insert(metadata, owner, name)), /listing_image_(owner_mismatch|reservation_required)/);
      }
      reset();
      fixture.sql(`update listing_action_private.image_upload_reservations set operation_id='${other}';`);
      fails(wrap(insert()), /listing_image_reservation_required/);
    }
    reset();
    fails(session(insert(), { sub: other }), /listing_image_owner_mismatch/);
  });
  await t.test("completion rechecks expiration, reservation state, and intent state after preflight", () => {
    for (const change of [
      "update listing_action_private.image_upload_reservations set expires_at=now()-interval '1 second';",
      "update listing_action_private.image_upload_reservations set state='cleanup_pending';",
      "update listing_action_private.image_upload_reservations set state='consumed';",
      "update listing_action_private.write_intents set state='aborted';",
      "update listing_action_private.write_intents set state='committed';",
      "delete from listing_action_private.write_intents;",
    ]) {
      reset();
      fixture.sql(session(`begin; ${insert(preflightMetadata)} rollback;`));
      fixture.sql(change);
      fails(completion(insert()), /listing_image_reservation_required/);
    }
  });
  await t.test("retirement blocks both preliminary and completing writes", () => {
    for (const wrap of [session, completion]) {
      reset();
      fixture.sql(`insert into listing_action_private.account_retirements values ('${seller}');`);
      fails(wrap(insert()), /listing_account_retirement_in_progress/);
    }
  });
  await t.test("completion waits for concurrent retirement and sees its committed barrier", async () => {
    reset();
    fixture.sql(session(`begin; ${insert(preflightMetadata)} rollback;`));
    const retirement = fixture.spawnSql();
    let completing;
    try {
      retirement.stdin.write(`begin; select pg_advisory_xact_lock(hashtextextended('listing-write-actor:${seller}',0));
        insert into listing_action_private.account_retirements values ('${seller}'); select 'retirement-held';\n`);
      await retirement.waitForOutput("retirement-held");
      completing = fixture.spawnSql(completion(`set application_name='listing-completion-waiter'; ${insert()}`));
      let waiting = false;
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        waiting = fixture.sql("select exists(select 1 from pg_stat_activity where application_name='listing-completion-waiter' and wait_event_type='Lock');") === "t";
        if (waiting) break;
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      assert.ok(waiting, "Completion must acquire the same actor lock as retirement.");
      retirement.stdin.end("commit;\n");
      assert.equal((await retirement.completion).status, 0);
      const result = await completing.completion;
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /listing_account_retirement_in_progress/);
      assert.equal(fixture.sql("select count(*) from storage.objects;"), "0");
    } finally {
      if (!retirement.stdin.writableEnded) retirement.stdin.end("rollback;\n");
      await retirement.completion;
      if (completing) await completing.completion;
    }
  });
  await t.test("authenticated and completion updates cannot overwrite an existing listing object", () => {
    reset();
    fixture.sql(completion(insert()));
    for (const wrap of [session, completion]) {
      const result = fixture.result(wrap(`update storage.objects set metadata='{"mimetype":"image/png","size":101}';`));
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /listing_image_overwrite_forbidden/);
    }
    const upsert = fixture.result(completion(insert().replace(/;$/, " on conflict(bucket_id,name) do update set metadata=excluded.metadata;")));
    assert.notEqual(upsert.status, 0);
    assert.match(upsert.stderr, /listing_image_overwrite_forbidden/);
    assert.equal(fixture.sql("select metadata->>'size' from storage.objects;"), "100");
  });
  await t.test("other Storage buckets and existing listing object deletion retain their original boundary", () => {
    reset();
    fixture.sql(session(insert({}, seller, `${seller}/profile.png`, "profile-images"), { uploadOperation: "" }));
    fixture.sql("delete from storage.objects;");
    fixture.sql(completion(insert()));
    fixture.sql(completion("delete from storage.objects;"));
    assert.equal(fixture.sql("select count(*) from storage.objects;"), "0");
  });
});

const BOOTSTRAP = `
create role postgres superuser;
create role authenticated nologin;
create role anon nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema storage;
create schema listing_action_private;
create function auth.jwt() returns jsonb language sql stable
as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable
as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
create function storage.operation() returns text language sql stable
as $$ select current_setting('storage.operation',true) $$;
-- Match the managed helper's normalization, not an always-true fixture stub.
create function storage.allow_only_operation(expected_operation text) returns boolean language sql stable
as $$ select coalesce(regexp_replace(storage.operation(),'^storage\\.','') =
  regexp_replace(expected_operation,'^storage\\.','') and expected_operation <> '',false) $$;
grant usage on schema auth,storage to authenticated,service_role;
create table listing_action_private.write_intents(
  actor_user_id uuid not null, operation_id uuid not null, state text not null,
  primary key(actor_user_id,operation_id)
);
create table listing_action_private.image_upload_reservations(
  storage_path text primary key, actor_user_id_snapshot uuid not null, operation_id uuid not null,
  listing_id_snapshot uuid not null, state text not null, expires_at timestamptz not null,
  mime_type text not null, size_bytes bigint not null
);
create table listing_action_private.account_retirements(actor_user_id_snapshot uuid primary key);
create table storage.objects(
  bucket_id text not null, name text not null, owner_id text, metadata jsonb,
  primary key(bucket_id,name)
);
alter table storage.objects enable row level security;
grant select,insert,update,delete on storage.objects to authenticated,service_role;
create policy own_storage_fixture on storage.objects for all to authenticated
  using(owner_id=auth.uid()::text) with check(owner_id=auth.uid()::text);
`;
