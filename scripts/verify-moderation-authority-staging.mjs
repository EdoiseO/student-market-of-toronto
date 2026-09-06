#!/usr/bin/env node
// Opt-in platform gate. This script never reads project .env files.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { createClient } from "@supabase/supabase-js";

const [command, manifestPath] = process.argv.slice(2);
if (!["provision", "verify", "cleanup"].includes(command) || !manifestPath || !isAbsolute(manifestPath)) {
  throw new Error("Usage: node scripts/verify-moderation-authority-staging.mjs provision|verify|cleanup /absolute/private-manifest.json");
}
const url = new URL(process.env.SMOT_STAGING_URL || "http://invalid");
const project = url.hostname.endsWith(".supabase.co") ? url.hostname.split(".")[0] : "local";
assert.notEqual(project, "bmnfynufuqjwjmtlfdxf", "The production project is forbidden.");
assert.ok(
  (url.protocol === "https:" && /^[a-z0-9]+\.supabase\.co$/.test(url.hostname)) ||
  (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)),
  "Use a disposable Supabase project or local stack.",
);
assert.equal(url.pathname, "/");
assert.equal(url.username + url.password + url.search + url.hash, "");
assert.equal(process.env.SMOT_AUTHORITY_STAGING_ACK, "disposable:" + project,
  "Explicitly acknowledge the isolated target using SMOT_AUTHORITY_STAGING_ACK.");
const anonKey = process.env.SMOT_STAGING_ANON_KEY;
const serviceKey = process.env.SMOT_STAGING_SERVICE_ROLE_KEY;
assert.ok(anonKey && serviceKey, "Provide staging anon/publishable and service-role keys.");
const fetchWithDeadline = (input, init = {}) => fetch(input, {
  ...init, redirect: "error", signal: AbortSignal.timeout(20_000),
});
const options = { auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}, global:{fetch:fetchWithDeadline} };
const admin = createClient(url.origin, serviceKey, options);
const save = (manifest, flag = "w") => writeFileSync(manifestPath, JSON.stringify(manifest,null,2) + "\n", {mode:0o600,flag});
let manifest;
if (command === "provision") {
  assert.equal(existsSync(manifestPath), false, "Never overwrite an existing credential manifest.");
  manifest = { version:1, project, url:url.origin, runId:randomUUID(), users:{}, fixture:{
    conversationId:"", reportId:"", mediaPath:"",
  } };
  save(manifest, "wx");
  // No invitation or confirmation email is sent by admin createUser.
  for (const [name, role] of [["buyer",null],["seller",null],["staff","staff"],["moderator","moderator"]]) {
    const password = randomBytes(32).toString("base64url");
    const email = "authority-" + manifest.runId + "-" + name + "@mail.utoronto.ca";
    const {data,error} = await admin.auth.admin.createUser({
      email,password,email_confirm:true,
      user_metadata:{first_name:"Security",last_name:"Fixture",school:"University of Toronto"},
      app_metadata:{fixture_run:manifest.runId,...(role ? {role} : {})},
    });
    assert.ifError(error);
    manifest.users[name] = {id:data.user.id,email,password};
    save(manifest); // Persist each exact owned ID so interrupted provisioning can be cleaned up.
  }
  console.log("Provisioned four synthetic accounts. Manifest credentials are stored privately at " + manifestPath);
  console.log("Create the fixture through normal staging app flows, then fill fixture IDs in the manifest. See docs/security/moderation-authority-staging.md.");
  process.exit(0);
}
assert.equal(statSync(manifestPath).mode & 0o077, 0, "Manifest must be readable only by its owner.");
manifest = JSON.parse(readFileSync(manifestPath,"utf8"));
assert.equal(manifest.project, project);
assert.equal(manifest.url, url.origin);
assert.equal(manifest.version, 1);
assert.match(manifest.runId, /^[0-9a-f-]{36}$/);
for (const [name,user] of Object.entries(manifest.users)) {
  const {data,error} = await admin.auth.admin.getUserById(user.id);
  if (command === "cleanup" && error?.status === 404) continue;
  assert.ifError(error);
  assert.equal(data.user.email, "authority-" + manifest.runId + "-" + name + "@mail.utoronto.ca");
  assert.equal(data.user.app_metadata.fixture_run, manifest.runId, "Refuse to mutate a non-fixture account.");
}
if (command === "cleanup") {
  const failures = [];
  for (const [name,user] of Object.entries(manifest.users)) {
    const {error} = await admin.auth.admin.deleteUser(user.id);
    if (error && error.status !== 404) failures.push(name);
  }
  if (failures.length) {
    throw new Error("Cleanup incomplete for: " + failures.join(", ") +
      ". Use the staging app's account deletion flow to run trusted resource cleanup, then retry. Keep this manifest.");
  }
  // Remove the passwords from disk after successful cleanup; retain a nonsecret receipt.
  save({version:1,project,url:url.origin,runId:manifest.runId,cleanedAt:new Date().toISOString(),users:{},fixture:{}});
  console.log("Deleted all exact synthetic Auth IDs; manifest credentials erased. Dispose of the isolated deployment to remove audit/tombstone receipts.");
  process.exit(0);
}
for (const name of ["buyer","seller","staff","moderator"]) assert.ok(manifest.users[name]?.id);
const {conversationId,reportId,mediaPath} = manifest.fixture;
for (const value of [conversationId,reportId]) assert.match(value || "", /^[0-9a-f-]{36}$/);
assert.ok(mediaPath && !mediaPath.includes("..") && !mediaPath.startsWith("/"));
const readOne = async (table, fields, key, value) => {
  const {data,error} = await admin.from(table).select(fields).eq(key,value).single();
  assert.ifError(error); return data;
};
const conversation = await readOne("conversations","id,buyer_id,seller_id","id",conversationId);
assert.equal(conversation.buyer_id,manifest.users.buyer.id);
assert.equal(conversation.seller_id,manifest.users.seller.id);
const reportRow = await readOne("reports","id,conversation_id,message_id,reporter_user_id,subject_type","id",reportId);
assert.equal(reportRow.subject_type,"message");
assert.equal(reportRow.conversation_id,conversationId);
assert.ok([manifest.users.buyer.id,manifest.users.seller.id].includes(reportRow.reporter_user_id));
const {data:messages,error:messageError} = await admin.from("messages")
  .select("id,body").eq("conversation_id",conversationId);
assert.ifError(messageError);
assert.ok(messages.length >= 9, "Fixture needs at least nine real messages.");
for (const message of messages) assert.ok(message.body?.startsWith("[authority-" + manifest.runId + "]"),
  "Refuse to inspect a conversation containing non-fixture content.");
const attachment = await readOne("message_attachments","conversation_id,storage_path","storage_path",mediaPath);
assert.equal(attachment.conversation_id,conversationId);
const changeRole = async (name, role, extra = {}) => {
  const {error} = await admin.auth.admin.updateUserById(manifest.users[name].id,{
    app_metadata:{fixture_run:manifest.runId,role,roles:[],force_name_change:false,...extra},
  });
  assert.ifError(error);
};
await changeRole("moderator","moderator");
await changeRole("staff","staff");
const tokenFor = async (name) => {
  const auth = createClient(url.origin,anonKey,options);
  const {data,error} = await auth.auth.signInWithPassword({
    email:manifest.users[name].email,password:manifest.users[name].password,
  });
  assert.ifError(error);
  assert.ok(data.session?.access_token);
  return data.session.access_token; // Kept only in memory; never refreshed or logged.
};
const tokens = {moderator:await tokenFor("moderator"),staff:await tokenFor("staff"),buyer:await tokenFor("buyer")};
const request = async (path, token, method = "GET", body) => {
  const response = await fetchWithDeadline(new URL(path,url), {
    method,headers:{apikey:anonKey,Authorization:"Bearer " + token,"Content-Type":"application/json"},
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("json") ? await response.json() : await response.arrayBuffer();
  return {status:response.status,ok:response.ok,data};
};
const query = (table, filter) => "/rest/v1/" + table + "?select=id&" + filter;
const paths = [
  query("conversations","id=eq." + conversationId),
  query("messages","conversation_id=eq." + conversationId),
  query("message_attachments","conversation_id=eq." + conversationId),
  query("message_reactions","conversation_id=eq." + conversationId),
];
const visible = async (token, expected) => {
  for (const path of paths) {
    const response = await request(path,token);
    assert.equal(response.status,200);
    assert.ok(Array.isArray(response.data));
    assert.equal(response.data.length > 0,expected,path);
  }
};
const media = mediaPath.split("/").map(encodeURIComponent).join("/");
const download = "/storage/v1/object/authenticated/message-media/" + media;
const sign = "/storage/v1/object/sign/message-media/" + media;
const assertStorage = async (token, allowed) => {
  const get = await request(download,token);
  assert.equal(get.ok,allowed,"Storage download privilege");
  const signed = await request(sign,token,"POST",{expiresIn:120});
  assert.equal(signed.ok && typeof signed.data?.signedURL === "string",allowed,"New Storage URL signing privilege");
  return signed;
};
await visible(tokens.moderator,true);
const initialSignature = await assertStorage(tokens.moderator,true);
await visible(tokens.buyer,true);
await assertStorage(tokens.buyer,true);
await visible(tokens.staff,false);
await assertStorage(tokens.staff,false);
const context = await request("/rest/v1/rpc/get_report_conversation_context",tokens.staff,"POST",{p_report_id:reportId});
assert.equal(context.status,200);
assert.equal(context.data.context_limited,true);
assert.equal(context.data.can_read_full_conversation,false);
assert.ok(context.data.messages.length > 0 && context.data.messages.length <= 5);
assert.ok(context.data.messages.some((message)=>message.id===reportRow.message_id));
assert.equal("last_message_preview" in context.data.conversation,false);
await changeRole("moderator",null);
await visible(tokens.moderator,false); // Exactly the previously issued signed token.
await assertStorage(tokens.moderator,false);
const deniedContext = await request("/rest/v1/rpc/get_report_conversation_context",tokens.moderator,"POST",{p_report_id:reportId});
assert.equal(deniedContext.status,403);
for (const token of [tokens.moderator,tokens.staff]) {
  const notification = await request("/rest/v1/notifications",token,"POST",{
    user_id:manifest.users.buyer.id,type:"moderator_role_granted",
    metadata:{title:"Synthetic forbidden producer probe",href:"/admin/users"},
  });
  assert.equal(notification.status,403);
  assert.equal(notification.data.code,"42501");
}
// The same signed token follows current authority when the role or standing changes again.
await changeRole("moderator","staff");
await visible(tokens.moderator,false);
await assertStorage(tokens.moderator,false);
await changeRole("moderator","moderator",{force_name_change:true});
await visible(tokens.moderator,false);
await assertStorage(tokens.moderator,false);
await changeRole("moderator","moderator");
await visible(tokens.moderator,true);
await changeRole("moderator",null);
await visible(tokens.buyer,true);
await assertStorage(tokens.buyer,true);
// Existing signed URLs are bearer capabilities: RLS cutover does not revoke one already issued.
const signedPath = initialSignature.data.signedURL;
const capabilityURL = new URL(signedPath.startsWith("/storage/v1/") ? signedPath : "/storage/v1" + signedPath,url);
assert.equal(capabilityURL.origin,url.origin);
const capability = await fetchWithDeadline(capabilityURL);
assert.equal(capability.ok,true,"Pre-issued short-lived capability remains valid within its TTL.");
console.log(JSON.stringify({result:"passed",runId:manifest.runId,checks:[
  "current moderator and participant positive controls",
  "staff unrelated Data API and Storage denial",
  "staff report-bound context",
  "same signed token denied after committed demotion",
  "old-token notification producer denied",
  "same signed token follows moderator-to-staff and forced-name restrictions",
  "participant access preserved",
  "existing signed capability explicitly remains valid until expiry",
],cleanup:"Run cleanup after deleting fixture resources through normal staging app flows."},null,2));
