import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MODERATION_ACTIONS, MODERATION_ROLE_ACTIONS } from "../src/lib/moderation-policy.mjs";
import { loadReportConversationContext } from "../src/lib/admin-report-context.mjs";
import { postgresAvailable, createPostgresFixture } from "./helpers/postgres-fixture.mjs";

const migration = new URL("../supabase/migrations/20260906144154_current_moderation_read_authority.sql", import.meta.url);
const stage7 = readFileSync(new URL("../supabase/migrations/20260817010541_stage7_security_remediation.sql", import.meta.url), "utf8");
const parser = stage7.slice(stage7.indexOf("create or replace function moderation_action_private.resolve_role_from_account("), stage7.indexOf("create or replace function private.reject_banned_authenticated_write()"));
const conversationMigration = readFileSync(new URL("../supabase/migrations/20260816181128_admin_conversation_moderation_stage5.sql", import.meta.url), "utf8");
const originalFunction = (name, next) => conversationMigration.slice(
 conversationMigration.indexOf("create or replace function " + name + "("),
 conversationMigration.indexOf("create or replace function " + next + "("),
);
const serviceReader = originalFunction("conversation_admin_private.resolve_actor_role", "conversation_admin_private.list_conversations_impl") +
 originalFunction("conversation_admin_private.get_message_page_impl", "conversation_admin_private.moderate_conversation_impl") +
 originalFunction("public.admin_get_conversation_message_page", "public.admin_moderate_conversation") + `
 alter function conversation_admin_private.get_message_page_impl(uuid,uuid,timestamptz,uuid,integer) owner to postgres;
 revoke all on function conversation_admin_private.get_message_page_impl(uuid,uuid,timestamptz,uuid,integer) from public,anon,authenticated;
 grant execute on function conversation_admin_private.get_message_page_impl(uuid,uuid,timestamptz,uuid,integer) to service_role;
 alter function public.admin_get_conversation_message_page(uuid,uuid,timestamptz,uuid,integer) owner to postgres;
 revoke all on function public.admin_get_conversation_message_page(uuid,uuid,timestamptz,uuid,integer) from public,anon,authenticated;
 grant execute on function public.admin_get_conversation_message_page(uuid,uuid,timestamptz,uuid,integer) to service_role;
`;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const literal = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const actor = id(1), buyer = id(2), seller = id(3), other = id(4);
const privateConversation = id(21), ownConversation = id(20), report = id(40);
const claims = (userId = actor, metadata = { role: "moderator" }) => JSON.stringify({ sub: userId, role: "authenticated", app_metadata: metadata });
const asActor = (statement, userId = actor, metadata) =>
  `set request.jwt.claims=${literal(claims(userId, metadata))}; set role authenticated; ${statement}`;
const asService = (statement) => `set request.jwt.claims='{"role":"service_role"}'; set role service_role; ${statement}`;
const serviceMessageCount = `select count(*) from public.admin_get_conversation_message_page('${actor}','${privateConversation}');`;
const privateCounts = `select json_build_array(
 (select count(*) from conversations where id='${privateConversation}'),
 (select count(*) from messages where conversation_id='${privateConversation}'),
 (select count(*) from message_attachments where conversation_id='${privateConversation}'),
 (select count(*) from message_reactions where conversation_id='${privateConversation}'),
 (select count(*) from storage.objects where name='private/${seller}/attached.png'),
 (select count(*) from profile_bios where profile_id='${seller}')); `;
const allPrivate = [1,9,1,1,1,1];
const seed = `
 insert into auth.users(id) values ('${actor}'),('${buyer}'),('${seller}'),('${other}');
 insert into profiles(id,first_name,last_name,school,bio_is_public)
 values ('${actor}','Actor','Fixture','test',false),('${buyer}','Buyer','Fixture','test',true),
 ('${seller}','Seller','Fixture','test',false),('${other}','Other','Fixture','test',false);
 insert into profile_bios(profile_id,bio) values ('${actor}','own'),('${buyer}','public'),('${seller}','private');
 insert into listings values ('${id(10)}','own','Own listing','Toronto','active','${actor}'),
 ('${id(11)}','hidden','Hidden listing','Toronto','removed','${seller}');
 insert into listing_images values ('${id(12)}','${id(11)}','https://fixture.invalid/listing.png',0);
 insert into listing_moderation_history values ('${id(13)}','${id(11)}');
 insert into conversations values ('${ownConversation}','${id(10)}','${actor}','${seller}','own preview'),
 ('${privateConversation}','${id(11)}','${buyer}','${seller}','DO NOT DISCLOSE FULL TRANSCRIPT PREVIEW');
 insert into messages values ('${id(99)}','${ownConversation}','${seller}','own message','2026-01-01');
 insert into messages select ('00000000-0000-4000-8000-'||lpad(value::text,12,'0'))::uuid,
 '${privateConversation}','${seller}','private message '||value,'2026-01-01'::timestamptz
 from generate_series(101,109) value;
 insert into message_attachments values ('${id(30)}','${privateConversation}','${id(105)}','private/${seller}/attached.png'),
 ('${id(31)}','${ownConversation}','${id(99)}','own/${seller}/attached.png');
 insert into message_reactions values ('${id(32)}','${privateConversation}','${id(105)}'),
 ('${id(33)}','${ownConversation}','${id(99)}');
 insert into storage.objects values ('${id(34)}','message-media','private/${seller}/attached.png','${seller}'),
 ('${id(35)}','message-media','own/${seller}/attached.png','${seller}'),
 ('${id(36)}','message-media','draft/${actor}/unattached.png','${actor}'),
 ('${id(37)}','message-media','draft/${seller}/unattached.png','${seller}'),
 ('${id(38)}','other-bucket','draft/${actor}/wrong-bucket.png','${actor}');
 insert into reports values ('${report}','${buyer}','message','${privateConversation}','${id(105)}','open'),
 ('${id(41)}','${actor}','listing',null,null,'open'),
 ('${id(42)}','${buyer}','message','${ownConversation}','${id(105)}','open');
`;

test("current account authority replaces every JWT policy while preserving participant and triage access", { skip: !postgresAvailable }, async (t) => {
 const fixture = createPostgresFixture(t, { prefix: "smot-read-" });
 fixture.apply(new URL("./fixtures/current-moderation-read-authority.sql", import.meta.url));
 fixture.sql(parser);
 fixture.sql(seed);
 fixture.sql(`alter table message_attachments add column file_name text, add column mime_type text,
  add column size_bytes bigint, add column created_at timestamptz default now();
  alter table message_reactions add column user_id uuid, add column emoji text,
  add column created_at timestamptz default now(), add column removed_at timestamptz;`);
 fixture.sql(serviceReader);
 const counts = () => JSON.parse(fixture.sql(asActor(privateCounts)));
 const metadata = (value) => fixture.sql(`update auth.users set raw_app_meta_data=${literal(JSON.stringify(value))} where id='${actor}';`);
 const context = () => JSON.parse(fixture.sql(asActor(`select get_report_conversation_context('${report}');`)));
 const forbiddenContext = () => {
  const result = fixture.result(asActor(`select get_report_conversation_context('${report}');`));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /report_context_not_permitted/);
 };
 await t.test("pre-fix reproducer: a demoted actor's unchanged claim reads private rows and inserts another user's notice", () => {
  assert.deepEqual(counts(), allPrivate);
  fixture.sql(asActor(`insert into notifications(user_id,type,metadata) values ('${buyer}','moderator_role_granted','{"role":"admin"}');`));
  assert.equal(fixture.sql("select count(*) from test_delivery_queue;"), "1");
 });
 await t.test("pre-fix staff broad-read reproducer and ordinary participant control", () => {
  metadata({ role: "staff" });
  assert.deepEqual(JSON.parse(fixture.sql(asActor(privateCounts, actor, { role: "staff" }))), allPrivate);
  assert.equal(fixture.sql(asActor(`select count(*) from messages where conversation_id='${privateConversation}';`, buyer, {})), "9");
 });
 await t.test("pre-fix service reader repeats the page-precheck/demotion/RPC interleaving", () => {
  metadata({ role:"moderator" });
  // The page has already observed a valid actor. Its later service RPC must recheck current authority.
  assert.equal(fixture.sql(`select moderation_action_private.resolve_role_from_account(raw_app_meta_data,role) from auth.users where id='${actor}';`), "moderator");
  assert.equal(fixture.sql(asService(serviceMessageCount)), "9");
  metadata({});
  assert.equal(fixture.sql(asService(serviceMessageCount)), "9");
  metadata({ role:"moderator",force_name_change:true });
  assert.equal(fixture.sql(asService(serviceMessageCount)), "9");
  metadata({ role:"staff" });
 });
 fixture.apply(migration);
 await t.test("service RPC refuses current demotion and forced-name state after an earlier successful page precheck", () => {
  for (const nextMetadata of [{},{role:"moderator",force_name_change:true},{role:"staff"}]) {
   metadata({role:"moderator"});
   assert.equal(fixture.sql(`select moderation_action_private.resolve_role_from_account(raw_app_meta_data,role) from auth.users where id='${actor}';`), "moderator");
   assert.equal(fixture.sql(asService(serviceMessageCount)), "9");
   metadata(nextMetadata);
   const result = fixture.result(asService(serviceMessageCount));
   assert.notEqual(result.status,0);
   assert.match(result.stderr,/conversation_admin_action_not_permitted/);
  }
  // The original service authentication guard remains in force.
  const direct = fixture.result(asActor(serviceMessageCount));
  assert.notEqual(direct.status,0);
  assert.match(direct.stderr,/permission denied for function admin_get_conversation_message_page/);
  metadata({role:"staff"});
 });
 await t.test("staff keeps report/listing triage but loses the general conversation and private-bio override", () => {
  assert.deepEqual(counts(), [0,0,0,0,0,0]);
  assert.equal(fixture.sql(asActor(`select count(*) from reports where id='${report}';`)), "1");
  assert.equal(fixture.sql(asActor(`select (select count(*) from listings where id='${id(11)}')+
   (select count(*) from listing_images where listing_id='${id(11)}')+
   (select count(*) from listing_moderation_history where listing_id='${id(11)}');`)), "3");
  const data = context();
  assert.deepEqual(data.messages.map((message) => message.id), [103,104,105,106,107].map(id));
  assert.equal(data.context_limited, true);
  assert.equal(data.can_read_full_conversation, false);
  assert.equal(data.conversation.id, privateConversation);
  assert.equal(JSON.stringify(data).includes("DO NOT DISCLOSE"), false);
  assert.equal("message_attachments" in data, false);
  assert.equal(fixture.sql(asActor(`select get_report_conversation_context('${id(42)}') is null;`)), "t");
  assert.equal(fixture.sql(asActor(`select get_report_conversation_context('${id(999)}') is null;`)), "t");
  fixture.sql(`update reports set message_id='${id(101)}' where id='${report}';`);
  assert.deepEqual(context().messages.map((message) => message.id), [101,102,103].map(id));
  fixture.sql(`update reports set message_id='${id(109)}' where id='${report}';`);
  assert.deepEqual(context().messages.map((message) => message.id), [107,108,109].map(id));
  fixture.sql(`update reports set message_id='${id(105)}' where id='${report}';`);
 });
 await t.test("demotion takes effect with the identical claim; unrelated reports/listings/history disappear", () => {
  metadata({});
  assert.deepEqual(counts(), [0,0,0,0,0,0]);
  assert.equal(fixture.sql(asActor(`select (select count(*) from reports where id='${report}')+
   (select count(*) from listings where id='${id(11)}')+
   (select count(*) from listing_images where listing_id='${id(11)}')+
   (select count(*) from listing_moderation_history where listing_id='${id(11)}');`)), "0");
  forbiddenContext();
 });
 await t.test("ordinary participant, own/public profile bio, and unattached owner controls survive", () => {
  assert.equal(fixture.sql(asActor(`select count(*) from messages where conversation_id='${ownConversation}';`)), "1");
  assert.equal(fixture.sql(asActor(`select count(*) from message_attachments where conversation_id='${ownConversation}';`)), "1");
  assert.equal(fixture.sql(asActor(`select count(*) from message_reactions where conversation_id='${ownConversation}';`)), "1");
  assert.equal(fixture.sql(asActor("select count(*) from storage.objects;")), "2");
  assert.equal(fixture.sql(asActor("select count(*) from profile_bios;")), "2");
  assert.equal(fixture.sql(asActor(`select count(*) from reports where id='${id(41)}';`)), "1");
  assert.equal(fixture.sql(asActor(`select count(*) from messages where conversation_id='${privateConversation}';`, buyer, {})), "9");
 });
 await t.test("SQL action matrix matches the application contract for each role", () => {
  for (const role of Object.keys(MODERATION_ROLE_ACTIONS)) {
   metadata({ role });
   for (const action of [...Object.values(MODERATION_ACTIONS), "unknown_action"]) {
    assert.equal(fixture.sql(asActor(`select moderation_read_private.can_perform_action('${action}');`)),
     MODERATION_ROLE_ACTIONS[role].includes(action) ? "t" : "f", `${role}/${action}`);
   }
   if (role !== "staff") {
    assert.deepEqual(counts(), allPrivate);
    assert.deepEqual(JSON.parse(fixture.sql(asActor(privateCounts, actor, {}))), allPrivate);
    assert.equal(context().can_read_full_conversation, true);
   }
  }
 });
 await t.test("canonical scalar role precedes ordered roles, data-role never grants application authority", () => {
  for (const [value, allowed] of [
   [{ role:" STAFF ", roles:["admin"] }, false],
   [{ roles:["unknown"," STAFF ","admin"] }, false],
   [{ role:"unknown", roles:[" MODERATOR ","staff"] }, true],
   [{ roles:"admin" }, false],
   [{ role:"moderator", force_name_change:true }, false],
   [{ role:"moderator", force_name_change:false }, true],
   [{}, false],
  ]) {
   metadata(value);
   fixture.sql(`update auth.users set role='admin' where id='${actor}';`);
   assert.equal(fixture.sql(asActor("select moderation_read_private.can_perform_action('read_conversations');")), allowed ? "t" : "f");
  }
 });
 await t.test("Auth bans, active application bans, forced-name state, and deleted accounts fail closed", () => {
  metadata({ role:"moderator" });
  fixture.sql(`update auth.users set banned_until=now()+interval '1 day' where id='${actor}';`);
  assert.deepEqual(counts(), [0,0,0,0,0,0]); forbiddenContext();
  fixture.sql(`update auth.users set banned_until=now()-interval '1 day' where id='${actor}';
   insert into user_status values ('${actor}',true,null);`);
  assert.deepEqual(counts(), [0,0,0,0,0,0]); forbiddenContext();
  fixture.sql(`update user_status set banned_until=now()+interval '1 day' where user_id='${actor}';`);
  assert.deepEqual(counts(), [0,0,0,0,0,0]);
  fixture.sql(`update user_status set banned_until=now()-interval '1 day' where user_id='${actor}';`);
  assert.deepEqual(counts(), allPrivate);
  metadata({ role:"moderator", force_name_change:true });
  assert.deepEqual(counts(), [0,0,0,0,0,0]); forbiddenContext();
  metadata({ role:"moderator" });
  fixture.sql(`delete from auth.users where id='${actor}';`);
  assert.deepEqual(counts(), [0,0,0,0,0,0]); forbiddenContext();
  fixture.sql(`insert into auth.users(id,raw_app_meta_data) values ('${actor}','{"role":"moderator"}');`);
 });
 await t.test("unavailable standing data fails the read instead of falling back to JWT metadata", () => {
  fixture.sql("alter table user_status rename to fixture_unavailable_status;");
  const result = fixture.result(asActor(privateCounts));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /user_status.*does not exist/);
  fixture.sql("alter table fixture_unavailable_status rename to user_status;");
 });
 await t.test("a prepared query rechecks authority after committed role changes, without changing claims", () => {
  const result = fixture.sql(asActor(`prepare visible_messages as select count(*) from messages where conversation_id='${privateConversation}';
   execute visible_messages; reset role;
   update auth.users set raw_app_meta_data='{}' where id='${actor}';
   set role authenticated; execute visible_messages;`));
  assert.equal(result, "9\n0");
 });
 await t.test("direct notification INSERT has no table or column path and produces no downstream row", () => {
  metadata({ role:"admin" });
  for (const role of ["anon","authenticated"]) {
   assert.equal(fixture.sql(`select has_table_privilege('${role}','notifications','INSERT') or
    has_any_column_privilege('${role}','notifications','INSERT');`), "f");
  }
  for (const role of ["staff","moderator","admin"]) {
   metadata({ role });
   const result = fixture.result(asActor(`insert into notifications(user_id,type) values ('${buyer}','moderator_role_granted');`));
   assert.notEqual(result.status, 0); assert.match(result.stderr, /permission denied for table notifications/);
  }
  assert.equal(fixture.sql("select count(*) from test_delivery_queue;"), "1");
  fixture.sql(`set role service_role; insert into notifications(user_id,type) values ('${buyer}','system');`);
  assert.equal(fixture.sql("select count(*) from test_delivery_queue;"), "2");
  assert.equal(fixture.sql(asActor("select count(*) from notifications;", buyer, {})), "2");
  fixture.sql(asActor("update notifications set is_read=true;", buyer, {}));
  assert.equal(fixture.sql("select count(*) from notifications where is_read;"), "2");
 });
 await t.test("legacy policy/helper removal, grants, and definer isolation are explicit", () => {
  assert.equal(fixture.sql("select count(*) from pg_policies where coalesce(qual,'')||coalesce(with_check,'') like '%is_moderation_role%';"), "0");
  assert.equal(fixture.sql("select to_regprocedure('public.is_moderation_role()') is null;"), "t");
  assert.equal(fixture.sql(`select count(*) from pg_policies where policyname in
   ('Moderators can update reports','Moderators can update all listings','Moderators can insert listing moderation history','Moderators can insert notifications');`), "0");
  assert.equal(fixture.sql("select has_schema_privilege('anon','moderation_read_private','USAGE');"), "f");
  assert.equal(fixture.sql("select has_function_privilege('anon','public.get_report_conversation_context(uuid)','EXECUTE');"), "f");
  assert.equal(fixture.sql("select has_function_privilege('service_role','public.get_report_conversation_context(uuid)','EXECUTE');"), "f");
  assert.equal(fixture.sql(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='moderation_read_private' and p.prosecdef and pg_get_userbyid(p.proowner)='postgres'
   and p.proconfig @> array['search_path=""'];`), "2");
  const anonymous = fixture.result("set role anon; select get_report_conversation_context(null);");
  assert.notEqual(anonymous.status, 0); assert.match(anonymous.stderr, /permission denied for function/);
 });
});

test("unknown legacy permissive policy prevents an atomic cutover", { skip: !postgresAvailable }, (t) => {
 const fixture = createPostgresFixture(t, { prefix:"smot-cutover-" });
 fixture.apply(new URL("./fixtures/current-moderation-read-authority.sql", import.meta.url));
 fixture.sql(parser);
 fixture.sql('create policy "Unexpected legacy read" on public.messages for select to authenticated using (is_moderation_role());');
 const result = fixture.result(readFileSync(migration, "utf8"));
 assert.notEqual(result.status, 0);
 assert.match(result.stderr, /Unreconciled is_moderation_role policy dependency/);
 assert.equal(fixture.sql("select to_regprocedure('public.is_moderation_role()') is not null;"), "t");
 assert.equal(fixture.sql("select count(*) from pg_policies where policyname='Moderators can read all messages';"), "1");
 assert.equal(fixture.sql("select count(*) from pg_policies where policyname='Current moderators can read messages';"), "0");
 fixture.sql(`drop policy "Unexpected legacy read" on public.messages;
  create function public.fixture_legacy_routine() returns boolean language plpgsql as $$
  begin return public.is_moderation_role(); end; $$;`);
 const routineResult = fixture.result(readFileSync(migration, "utf8"));
 assert.notEqual(routineResult.status, 0);
 assert.match(routineResult.stderr, /Unreconciled is_moderation_role routine dependency/);
 assert.equal(fixture.sql("select to_regprocedure('public.is_moderation_role()') is not null;"), "t");
});

test("report loader only uses the actor RPC and fails closed on errors or unbounded data", async () => {
 const data = { conversation:{id:privateConversation},messages:[{id:id(105)}],reported_message_id:id(105),context_limited:true };
 const client = { rpc: async (name,args) => {
  assert.equal(name, "get_report_conversation_context");
  assert.deepEqual(args, {p_report_id:report});
  return {data,error:null};
 } };
 assert.equal(await loadReportConversationContext(client, report), data);
 assert.equal(await loadReportConversationContext({rpc:async()=>({data:null,error:null})},report),null);
 await assert.rejects(loadReportConversationContext({rpc:async()=>({error:{code:"42501"}})},report), /unavailable/);
 for (const invalid of [{...data,messages:Array(6).fill(data.messages[0])},{...data,context_limited:false},{...data,messages:[]},{}]) {
  await assert.rejects(loadReportConversationContext({rpc:async()=>({data:invalid,error:null})},report), /invalid/);
 }
});
