import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createPostgresFixture, postgresAvailable } from "./helpers/postgres-fixture.mjs";

const migrationName = "20260907202430_route_private_message_media_through_gateway.sql";
const migration = new URL(`../supabase/migrations/${migrationName}`, import.meta.url);
const readMigration = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const definition = (source, name) => {
  const start = source.indexOf(`create or replace function ${name}(`);
  assert.ok(start >= 0, name);
  const body = source.slice(start);
  const delimiter = body.match(/\bas (\$\w*\$)/i)?.[1];
  assert.ok(delimiter, name);
  return body.slice(0, body.indexOf(`${delimiter};`, body.indexOf(delimiter) + delimiter.length) + delimiter.length + 1);
};
const id = (value) => `71000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const uploader = id(1), buyer = id(2), moderator = id(3), outsider = id(4);
const conversation = id(10), listing = id(11), message = id(12);
const attachment = id(20), secondAttachment = id(21), thirdAttachment = id(22);
const source = `${conversation}/${uploader}/evidence.png`;
const secondSource = `${conversation}/${uploader}/pending.png`;
const thirdSource = `${conversation}/${uploader}/cleanup.png`;
const draft = `${conversation}/${uploader}/draft.png`;
const sha = "a".repeat(64);
const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const context = (statement, { role = "service_role", user = null, operation = "", claimsRole = role } = {}) =>
  `set request.jwt.claims=${quote(JSON.stringify({ role: claimsRole, ...(user ? { sub: user } : {}), app_metadata: { role: "moderator" } }))};
   set storage.operation=${quote(operation)}; set role ${role}; ${statement}`;
const asUser = (statement, user = uploader, operation = "") => context(statement, { role: "authenticated", user, operation });
const asService = (statement, operation = "") => context(statement, { operation });
const insertObject = (path, { owner = uploader, mime = "image/png", size = 4, metadata } = {}) =>
  `insert into storage.objects(bucket_id,name,owner_id,metadata) values('message-media',${quote(path)},${owner === null ? "null" : quote(owner)},${quote(JSON.stringify(metadata ?? { mimetype: mime, size }))}::jsonb);`;
const removeObject = (path) => `delete from storage.objects where bucket_id='message-media' and name=${quote(path)} returning name;`;

function setup(t) {
  const fixture = createPostgresFixture(t, { prefix: "smot-media-" });
  fixture.apply(new URL("./fixtures/current-moderation-read-authority.sql", import.meta.url));
  fixture.sql(`
    create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role'; $$;
    create function storage.allow_only_operation(operation text) returns boolean language sql stable as $$
      select coalesce(nullif(current_setting('storage.operation',true),'') = operation,false);
    $$;
    alter table storage.objects alter column id set default gen_random_uuid(), add column metadata jsonb;
    alter table storage.objects add unique(bucket_id,name);
    alter table message_attachments add column uploader_id uuid, add column file_name text,
      add column mime_type text, add column size_bytes bigint, add column created_at timestamptz default now();
    alter table message_attachments add unique(storage_path);
    create table blocked_users(blocker_user_id uuid,blocked_user_id uuid);
    create table conversation_moderation_state(conversation_id uuid primary key,status text,closed_until timestamptz);
    grant select on storage.objects to anon;
    grant insert,delete on storage.objects to authenticated;
    create policy fixture_public_bucket on storage.objects for select to anon,authenticated using(bucket_id='public-test');
    insert into auth.users(id,raw_app_meta_data) values ('${uploader}','{}'),('${buyer}','{}'),('${moderator}','{"role":"moderator"}'),('${outsider}','{}');
    insert into profiles(id,school) values ('${uploader}','school'),('${buyer}','demo'),('${moderator}','school'),('${outsider}','demo');
    insert into listings(id,status,seller_id) values ('${listing}','active','${uploader}');
    insert into conversations(id,listing_id,buyer_id,seller_id) values ('${conversation}','${listing}','${buyer}','${uploader}');
    insert into conversation_moderation_state values ('${conversation}','open',null);
    insert into messages(id,conversation_id,sender_id) values ('${message}','${conversation}','${uploader}');
    insert into message_attachments(id,conversation_id,message_id,storage_path,uploader_id,file_name,mime_type,size_bytes)
      values ('${attachment}','${conversation}','${message}','${source}','${uploader}','evidence.png','image/png',4),
        ('${secondAttachment}','${conversation}','${message}','${secondSource}','${uploader}','pending.png','image/png',4),
        ('${thirdAttachment}','${conversation}','${message}','${thirdSource}','${uploader}','cleanup.png','image/png',4);
    ${insertObject(source)} ${insertObject(secondSource)} ${insertObject(thirdSource)} ${insertObject(draft)}
    insert into storage.objects(bucket_id,name,owner_id,metadata) values('public-test','public.png',null,'{}');
  `);
  const stage7 = readMigration("20260817010541_stage7_security_remediation.sql");
  fixture.sql(definition(stage7, "moderation_action_private.resolve_role_from_account"));
  fixture.apply(new URL("../supabase/migrations/20260906144154_current_moderation_read_authority.sql", import.meta.url));
  const reservations = readMigration("20260812112419_enforce_message_media_reservations.sql");
  fixture.sql(reservations.slice(0, reservations.indexOf("create or replace function public.reserve_message_media_uploads(")));
  fixture.sql(definition(reservations, "public.prepare_message_media_account_cleanup"));
  fixture.sql(definition(reservations, "public.retire_message_media_account_reservations"));
  fixture.sql(`grant usage on schema private to authenticated;
    revoke all on function public.prepare_message_media_account_cleanup(uuid),public.retire_message_media_account_reservations(uuid,text[]) from public,anon,authenticated;
    grant execute on function public.prepare_message_media_account_cleanup(uuid),public.retire_message_media_account_reservations(uuid,text[]) to service_role;`);
  fixture.apply(new URL("../supabase/migrations/20260812192359_fix_message_media_storage_completion.sql", import.meta.url));
  const closed = readMigration("20260816081757_enforce_closed_conversation_writes.sql");
  fixture.sql(definition(closed, "private.assert_conversation_participant_write_allowed"));
  fixture.sql(definition(closed, "private.verify_open_conversation_message_media_insert"));
  fixture.sql(definition(readMigration("20260812233357_bound_message_history_and_guard_media_deletes.sql"), "private.guard_message_media_storage_delete"));
  fixture.sql(`
    create trigger lock_message_media_storage_insert before insert on storage.objects for each row
      when(new.bucket_id='message-media') execute function private.lock_message_media_storage_insert();
    create trigger verify_open_conversation_message_media_insert before insert on storage.objects for each row
      when(new.bucket_id='message-media') execute function private.verify_open_conversation_message_media_insert();
    create trigger guard_message_media_storage_delete before delete on storage.objects for each row
      when(old.bucket_id='message-media') execute function private.guard_message_media_storage_delete();
    create policy "Reserved message media can be uploaded" on storage.objects for insert to authenticated
      with check(bucket_id='message-media' and private.message_media_upload_is_reserved(name,owner_id,metadata));
    create policy "Uploaders can remove unattached message media" on storage.objects for delete to authenticated
      using(bucket_id='message-media' and owner_id=auth.uid()::text and (storage.foldername(name))[2]=auth.uid()::text
        and not exists(select 1 from message_attachments attachment where attachment.storage_path=name));
  `);
  return fixture;
}

test("private media gateway policies and relocation lifecycle execute against native PostgreSQL", { skip: !postgresAvailable }, async (t) => {
  const fixture = setup(t);
  const denied = (statement, pattern = /permission denied|not_permitted|required|invalid|failed|retiring|not_complete|changed|cannot be deleted|cannot be updated/i) => {
    const result = fixture.result(statement);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, pattern);
  };
  const resolve = (attachmentId = attachment) => JSON.parse(fixture.sql(asService(`select row_to_json(result) from resolve_message_media_attachment('${attachmentId}') result;`)));
  const begin = (attachmentId = attachment) => JSON.parse(fixture.sql(asService(`select row_to_json(result) from begin_message_media_relocation('${attachmentId}') result;`)));
  const activate = (attachmentId = attachment, sourceHash = sha, targetHash = sourceHash) =>
    asService(`select verify_message_media_relocation('${attachmentId}',${quote(sourceHash)},${quote(targetHash)});`);
  let relocation, pending, cleanup;

  await t.test("baseline has direct participant/moderator storage reads", () => {
    assert.equal(fixture.sql(asUser("select count(*) from storage.objects where bucket_id='message-media';", buyer)), "3");
    assert.equal(fixture.sql(asUser("select count(*) from storage.objects where bucket_id='message-media';", moderator)), "3");
  });
  fixture.apply(migration);
  await t.test("all direct read/sign/list/transform operation variants deny, upload/delete probes remain owner-scoped", () => {
    for (const operation of ["", "storage.object.get", "storage.object.get_authenticated", "storage.object.info", "storage.object.list", "storage.object.sign", "storage.object.sign_many", "storage.render.image", "storage.render.image_authenticated", "storage.object.upload_signed", "storage.object.copy", "storage.object.move", "storage.object"]) {
      for (const user of [uploader, buyer, moderator, outsider]) {
        assert.equal(fixture.sql(asUser("select count(*) from storage.objects where bucket_id='message-media';", user, operation)), "0", `${operation}/${user}`);
      }
    }
    for (const operation of ["storage.object.upload", "storage.object.delete", "storage.object.delete_many"]) {
      assert.equal(fixture.sql(asUser("select count(*) from storage.objects where bucket_id='message-media';", uploader, operation)), "4");
      for (const user of [buyer, moderator, outsider]) {
        assert.equal(fixture.sql(asUser("select count(*) from storage.objects where bucket_id='message-media';", user, operation)), "0");
      }
    }
    assert.equal(fixture.sql(context("select count(*) from storage.objects where bucket_id='message-media';", { role: "anon" })), "0");
    assert.equal(fixture.sql(context("select count(*) from storage.objects where bucket_id='public-test';", { role: "anon" })), "1");
    fixture.sql("create policy fixture_accidental_broad_read on storage.objects for select to authenticated using(true);");
    assert.equal(fixture.sql(asUser("select count(*) from storage.objects where bucket_id='message-media';")), "0");
    fixture.sql("drop policy fixture_accidental_broad_read on storage.objects;");
  });
  await t.test("participant metadata remains independent of current moderation authority", () => {
    const count = "select count(*) from message_attachments;";
    assert.equal(fixture.sql(asUser(count, buyer)), "3");
    assert.equal(fixture.sql(asUser(count, moderator)), "3");
    fixture.sql(`update auth.users set raw_app_meta_data='{}' where id='${moderator}';`);
    assert.equal(fixture.sql(asUser(count, moderator)), "0");
    assert.equal(fixture.sql(asUser(count, buyer)), "3");
    assert.equal(fixture.sql(asUser(count, uploader)), "3");
  });
  await t.test("resolver and maintenance RPCs require service role with no caller-selected subject", () => {
    const rpcs = [`resolve_message_media_attachment('${attachment}')`, `begin_message_media_relocation('${attachment}')`,
      `verify_message_media_relocation('${attachment}','${sha}','${sha}')`, `finish_message_media_relocation('${attachment}')`,
      `list_message_media_account_cleanup('${uploader}')`];
    for (const rpc of rpcs) {
      denied(asUser(`select ${rpc};`));
      denied(context(`select ${rpc};`, { role: "anon" }));
      denied(context(`select ${rpc};`, { role: "service_role", user: moderator }));
      denied(context(`select ${rpc};`, { role: "service_role", claimsRole: "authenticated" }));
    }
    for (const role of ["anon", "authenticated", "service_role"]) {
      denied(context("select * from private.message_media_relocations;", { role, user: role === "authenticated" ? uploader : null }));
    }
    denied(asService("select * from resolve_message_media_attachment(null);"));
    denied(asService("select * from begin_message_media_relocation(null);"), /not_found/);
    assert.equal(fixture.sql(asService(`select count(*) from resolve_message_media_attachment('${id(999)}');`)), "0");
    assert.equal(resolve().storage_path, source);
  });
  await t.test("begin is idempotent and keeps the logical source readable before verification", () => {
    relocation = begin();
    assert.equal(relocation.source_path, source);
    assert.equal(relocation.state, "prepared");
    assert.match(relocation.target_path, new RegExp(`^${conversation}/${uploader}/[0-9a-f-]{36}$`));
    assert.notEqual(relocation.target_path, source);
    assert.deepEqual(begin(), relocation);
    assert.equal(resolve().storage_path, source);
    assert.equal(fixture.sql("select count(*) from private.message_media_account_retirements;"), "0");
    denied(asService(`select finish_message_media_relocation('${attachment}');`));
    denied(activate(), /target_invalid/);
    denied(asService(removeObject(source), "storage.object.delete_many"), /account retirement/);
  });
  await t.test("only exact service standard-upload target is permitted, owner is rebound and preflight rolls back", () => {
    denied(asUser(insertObject(relocation.target_path), uploader, "storage.object.upload"));
    denied(asService(insertObject(relocation.target_path, { owner: null }), "storage.object.copy"));
    denied(asService(insertObject(relocation.target_path, { owner: null })));
    denied(asService(insertObject(relocation.target_path, { owner: buyer }), "storage.object.upload"));
    denied(asService(insertObject(relocation.target_path, { owner: null, size: 5 }), "storage.object.upload"));
    denied(asService(insertObject(relocation.target_path, { owner: null, mime: "image/jpeg" }), "storage.object.upload"));
    denied(asService(insertObject(`${conversation}/${uploader}/unscoped.png`, { owner: null }), "storage.object.upload"), /ownership is invalid/);
    fixture.sql(asService(`begin; ${insertObject(relocation.target_path, { owner: null, metadata: { mimetype: "image/png" } })} rollback;`, "storage.object.upload"));
    assert.equal(fixture.sql(`select count(*) from storage.objects where name='${relocation.target_path}';`), "0");
    fixture.sql(`update private.message_media_relocations set upload_expires_at=now()-interval '1 second' where attachment_id='${attachment}';`);
    denied(asService(insertObject(relocation.target_path, { owner: null }), "storage.object.upload"));
    assert.equal(begin().target_path, relocation.target_path);
    fixture.sql(asService(insertObject(relocation.target_path, { owner: null }), "storage.object.upload"));
    assert.equal(fixture.sql(`select owner_id from storage.objects where name='${relocation.target_path}';`), uploader);
    denied(asService(insertObject(relocation.target_path, { owner: null }), "storage.object.upload"));
    denied(asService(`update storage.objects set metadata='{}' where name='${relocation.target_path}';`, "storage.object.upload"));
    assert.equal(resolve().storage_path, source);
  });
  await t.test("physical targets cannot be mistaken for unattached uploader-cleanup objects", () => {
    denied(asUser(removeObject(relocation.target_path), uploader, "storage.object.delete_many"), /Attached message media cannot be deleted/);
    // A trusted worker can roll back only the prepared copy; source remains.
    assert.equal(fixture.sql(asService(removeObject(relocation.target_path), "storage.object.delete_many")), relocation.target_path);
    assert.equal(resolve().storage_path, source);
    fixture.sql(asService(insertObject(relocation.target_path, { owner: null, metadata: { mimetype: "image/png" } }), "storage.object.upload"));
    denied(activate(), /target_invalid/);
    fixture.sql(asService(removeObject(relocation.target_path), "storage.object.delete_many"));
    fixture.sql(asService(insertObject(relocation.target_path, { owner: null }), "storage.object.upload"));
    assert.equal(fixture.sql(asUser(removeObject(source), uploader, "storage.object.delete_many")), "");
  });
  await t.test("hash verification atomically activates the physical path and is safely retryable", () => {
    denied(activate(attachment, sha, "b".repeat(64)), /hash_verification_failed/);
    denied(activate(attachment, "invalid", "invalid"), /hash_verification_failed/);
    assert.equal(resolve().storage_path, source);
    assert.equal(fixture.sql(activate()), "active");
    assert.equal(resolve().storage_path, relocation.target_path);
    assert.equal(fixture.sql(activate()), "active");
    denied(activate(attachment, "b".repeat(64)), /verification_changed/);
    assert.equal(begin().state, "active");
    denied(asService(`select finish_message_media_relocation('${attachment}');`));
  });
  await t.test("only the old verified source can be retired; completion survives interrupted/repeated cleanup", () => {
    denied(asService(removeObject(relocation.target_path), "storage.object.delete_many"), /account retirement/);
    denied(asService(removeObject(secondSource), "storage.object.delete_many"), /account retirement/);
    denied(asService(removeObject(source)), /through the Storage API/);
    assert.equal(fixture.sql(asService(removeObject(source), "storage.object.delete_many")), source);
    assert.equal(resolve().storage_path, relocation.target_path);
    assert.equal(fixture.sql(activate()), "active");
    assert.equal(fixture.sql(asService(`select finish_message_media_relocation('${attachment}');`)), "retired");
    assert.equal(fixture.sql(asService(`select finish_message_media_relocation('${attachment}');`)), "retired");
    assert.equal(fixture.sql(activate()), "retired");
    assert.equal(begin().target_path, relocation.target_path);
    assert.equal(fixture.sql(asService(removeObject(source), "storage.object.delete_many")), "");
  });
  await t.test("normal reservation preflight/completion and aborted cleanup retain the original guards", () => {
    const normal = `${conversation}/${uploader}/normal.png`;
    fixture.sql(`insert into private.message_media_upload_reservations(user_id,conversation_id,storage_path,file_name,mime_type,size_bytes,expires_at)
      values('${uploader}','${conversation}','${normal}','normal.png','image/png',4,now()+interval '30 minutes');`);
    fixture.sql(asUser(`begin; ${insertObject(normal, { metadata: { mimetype: "image/png" } })} rollback;`, uploader, "storage.object.upload"));
    denied(asService(insertObject(normal, { size: 5 }), "storage.object.upload"), /does not match an active reservation/);
    fixture.sql(`update conversation_moderation_state set status='closed' where conversation_id='${conversation}';`);
    denied(asService(insertObject(normal), "storage.object.upload"), /conversation_write_closed/);
    fixture.sql(`update conversation_moderation_state set status='open' where conversation_id='${conversation}';`);
    fixture.sql(asService(insertObject(normal), "storage.object.upload"));
    assert.equal(fixture.sql(asUser(removeObject(normal), uploader, "storage.object.delete_many")), normal);
    assert.equal(fixture.sql(asUser(removeObject(draft), uploader, "storage.object.delete_many")), draft);
  });
  await t.test("closed conversations can relocate historical evidence without enabling new messages", () => {
    fixture.sql(`update conversation_moderation_state set status='closed' where conversation_id='${conversation}';`);
    pending = begin(secondAttachment);
    cleanup = begin(thirdAttachment);
    fixture.sql(asService(insertObject(pending.target_path, { owner: null }), "storage.object.upload"));
    fixture.sql(asService(insertObject(cleanup.target_path, { owner: null }), "storage.object.upload"));
    assert.equal(fixture.sql(activate(thirdAttachment)), "active");
    assert.equal(resolve(secondAttachment).storage_path, secondSource);
    assert.equal(resolve(thirdAttachment).storage_path, cleanup.target_path);
  });
  await t.test("account retirement enumerates logical and physical copies in prepared, active and retired states", () => {
    denied(asService(`select list_message_media_account_cleanup('${uploader}');`), /not_prepared/);
    fixture.sql(asService(`select * from prepare_message_media_account_cleanup('${uploader}');`));
    const paths = JSON.parse(fixture.sql(asService(`select list_message_media_account_cleanup('${uploader}');`))).map((row) => row.storage_path);
    assert.deepEqual(paths.sort(), [source, secondSource, thirdSource, relocation.target_path, pending.target_path, cleanup.target_path].sort());
    denied(asService(`select * from begin_message_media_relocation('${secondAttachment}');`), /account_retiring/);
    denied(activate(secondAttachment), /account_retiring/);
    denied(asUser(removeObject(pending.target_path), uploader, "storage.object.delete_many"), /reserved for account cleanup/);
    for (const path of paths) fixture.sql(asService(removeObject(path), "storage.object.delete_many"));
    assert.equal(fixture.sql("select count(*) from storage.objects where bucket_id='message-media';"), "0");
    assert.equal(JSON.parse(fixture.sql(asService(`select list_message_media_account_cleanup('${uploader}');`))).length, paths.length);
    assert.equal(fixture.sql(asService(`select retire_message_media_account_reservations('${uploader}',array['${conversation}/${uploader}/normal.png']);`)), "1");
    fixture.sql(`delete from message_attachments where uploader_id='${uploader}';`);
    assert.equal(fixture.sql("select count(*) from private.message_media_relocations;"), "0");
    assert.equal(fixture.sql(asService(`select list_message_media_account_cleanup('${uploader}');`)), "[]");
  });
});

test("account cleanup wins the quota lock before relocation activation and blocks retry uploads", { skip: !postgresAvailable }, async (t) => {
  const fixture = setup(t);
  fixture.apply(migration);
  const relocation = JSON.parse(fixture.sql(asService(`select row_to_json(result) from begin_message_media_relocation('${attachment}') result;`)));
  fixture.sql(asService(insertObject(relocation.target_path, { owner: null }), "storage.object.upload"));
  const cleanup = fixture.spawnSql();
  cleanup.stdin.write(asService(`begin; select * from prepare_message_media_account_cleanup('${uploader}'); select 'RETIREMENT_LOCKED';\n`));
  await cleanup.waitForOutput("RETIREMENT_LOCKED");
  const verifier = fixture.spawnSql(asService(`select 'VERIFYING'; select verify_message_media_relocation('${attachment}','${sha}','${sha}');`));
  await verifier.waitForOutput("VERIFYING");
  let isWaiting = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    isWaiting = fixture.sql("select count(*) from pg_stat_activity where wait_event='advisory' and query like 'select verify_message_media_relocation%';") === "1";
    if (isWaiting) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(isWaiting, "Activation must wait behind account retirement's quota lock");
  cleanup.stdin.end("commit;\n");
  assert.equal((await cleanup.completion).status, 0);
  const result = await verifier.completion;
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /message_media_account_retiring/);
  assert.equal(fixture.sql(asService(`select storage_path from resolve_message_media_attachment('${attachment}');`)), source);
  const retry = fixture.result(asService(insertObject(relocation.target_path, { owner: null }), "storage.object.upload"));
  assert.notEqual(retry.status, 0);
  assert.match(retry.stderr, /message_media_relocation_upload_not_permitted/);
  const paths = JSON.parse(fixture.sql(asService(`select list_message_media_account_cleanup('${uploader}');`))).map((item) => item.storage_path);
  assert.ok(paths.includes(source));
  assert.ok(paths.includes(relocation.target_path));
});
