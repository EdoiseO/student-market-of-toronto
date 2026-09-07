#!/usr/bin/env node
// Opt-in synthetic hosted verification. Never read .env files or log SDK payloads.
import { randomUUID } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { getMessageOperationOutcome } from "../src/lib/message-send-idempotency.mjs";

const NAMES = ["buyer", "seller", "staff", "moderator"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNAL_FIELDS = ["change_kind", "emitted_at", "recipient_user_id", "version"];
const PUBLISHED_TABLES = ["messages", "message_reactions", "notification_realtime_signals", "announcement_deliveries"];
const QUIET_MS = 5_000;
const DELIVERY_MS = 20_000;
const TOTAL_MS = 180_000;

class GateError extends Error {
  constructor(code) { super(code); this.name = "GateError"; this.code = code; }
}
const requireGate = (condition, code) => { if (!condition) throw new GateError(code); };
const checked = async (request, code) => {
  const result = await request;
  requireGate(!result.error, code);
  return result.data;
};

export function validateTarget(args, env) {
  requireGate(args.length === 2 && args[0] === "verify" && isAbsolute(args[1] || ""), "usage_verify_absolute_manifest");
  let url;
  try { url = new URL(env.SMOT_STAGING_URL); } catch { throw new GateError("invalid_target_url"); }
  const project = url.hostname.endsWith(".supabase.co") ? url.hostname.split(".")[0] : "local";
  requireGate(project !== "bmnfynufuqjwjmtlfdxf", "production_project_forbidden");
  requireGate((url.protocol === "https:" && /^[a-z0-9]+\.supabase\.co$/.test(url.hostname) && !url.port) ||
    (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)), "isolated_supabase_target_required");
  requireGate(url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash, "bare_target_origin_required");
  requireGate(env.SMOT_AUTHORITY_STAGING_ACK === "disposable:" + project, "target_ack_required");
  requireGate(Boolean(env.SMOT_STAGING_ANON_KEY && env.SMOT_STAGING_SERVICE_ROLE_KEY), "staging_keys_required");
  return { project, origin: url.origin, manifestPath: args[1] };
}

export function validateManifest(manifest, target) {
  requireGate(manifest?.version === 1 && manifest.project === target.project && manifest.url === target.origin, "manifest_target_mismatch");
  requireGate(UUID.test(manifest.runId || ""), "fixture_run_id_invalid");
  requireGate(JSON.stringify(Object.keys(manifest.users || {}).sort()) === JSON.stringify([...NAMES].sort()), "exact_four_fixture_accounts_required");
  const ids = new Set();
  for (const name of NAMES) {
    const user = manifest.users[name];
    requireGate(UUID.test(user?.id || "") && !ids.has(user.id), "distinct_fixture_ids_required");
    ids.add(user.id);
    requireGate(user.email === `authority-${manifest.runId}-${name}@mail.utoronto.ca` && typeof user.password === "string" && user.password.length >= 16, "fixture_identity_invalid");
  }
  const fixture = manifest.fixture;
  requireGate(UUID.test(fixture?.conversationId || "") && UUID.test(fixture?.reportId || ""), "complete_fixture_ids_required");
  requireGate(typeof fixture.mediaPath === "string" && fixture.mediaPath.length < 1024 &&
    !/[\\%\s]/.test(fixture.mediaPath) && !fixture.mediaPath.split("/").some((part) => !part || part === "." || part === ".."), "fixture_media_path_invalid");
  return manifest;
}

export function readManifest(target) {
  const stat = lstatSync(target.manifestPath);
  requireGate(stat.isFile() && (stat.mode & 0o077) === 0 && stat.size < 1_048_576, "private_regular_manifest_required");
  return validateManifest(JSON.parse(readFileSync(target.manifestPath, "utf8")), target);
}

// Pure oracle: an empty/dead subscription can never satisfy a positive control.
// Only normalized receipts leave this function; message bodies stay in memory.
export function evaluatePhase(events, { userId, conversationId, messageId, signalVersion, canRead }) {
  for (const { table, row } of events) {
    requireGate(PUBLISHED_TABLES.includes(table), "unexpected_published_table_event");
    if (table === "notification_realtime_signals") {
      requireGate(JSON.stringify(Object.keys(row).sort()) === JSON.stringify(SIGNAL_FIELDS), "signal_contains_unexpected_fields");
      requireGate(row.recipient_user_id === userId, "foreign_recipient_signal_delivered");
    }
    if (["messages", "message_reactions"].includes(table) && row.conversation_id === conversationId) {
      requireGate(canRead, "forbidden_conversation_event_delivered");
    }
  }
  const has = (stream, table, type, match) => events.some((event) => event.stream === stream && event.table === table && event.type === type && match(event.row));
  const signal = (stream) => events.some((event) => event.stream === stream && event.table === "notification_realtime_signals" &&
    ["INSERT", "UPDATE"].includes(event.type) && event.row.recipient_user_id === userId && BigInt(event.row.version) >= BigInt(signalVersion));
  const ownSignals = signal("scoped") && signal("broad");
  const messages = ["scoped", "broad"].every((stream) => has(stream, "messages", "INSERT", (row) => row.id === messageId));
  const reactions = ["scoped", "broad"].every((stream) =>
    has(stream, "message_reactions", "INSERT", (row) => row.message_id === messageId && row.removed_at === null) &&
    has(stream, "message_reactions", "UPDATE", (row) => row.message_id === messageId && row.removed_at !== null));
  return { ready: ownSignals && (!canRead || (messages && reactions)), ownSignals, messages, reactions };
}

export function retainedTokenOptions(token, fetchWithDeadline) {
  return {
    // The top-level callback is also the Realtime heartbeat/reconnect source.
    // This observer has no Auth session capable of replacing the captured JWT.
    accessToken: async () => token,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchWithDeadline },
  };
}

export async function runVerification(target, manifest, env) {
  const report = { result: "failed", project: target.project, runId: manifest.runId, phases: [], messagesAdded: 0,
    originalModeratorRoleRestored: true, quietWindowMs: QUIET_MS,
    limitations: ["bounded observation, not proof of indefinite absence", "no ban/deletion/expiry or offline UI reconciliation checks",
      "no announcement delivery or DELETE workload", "publication catalog requires a separate read-only receipt", "no Storage/CDN or whole-release verdict"] };
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), TOTAL_MS);
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const fetchWithDeadline = (input, init = {}) => fetch(input, {
    ...init, redirect: "error", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000), ...(init.signal ? [init.signal] : [])]),
  });
  // Cleanup must remain possible after the run deadline or an interrupt.
  const cleanupFetch = (input, init = {}) => fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) });
  const authOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fetchWithDeadline } };
  const admin = createClient(target.origin, env.SMOT_STAGING_SERVICE_ROLE_KEY, authOptions);
  const cleanupAdmin = createClient(target.origin, env.SMOT_STAGING_SERVICE_ROLE_KEY, { ...authOptions, global: { fetch: cleanupFetch } });
  const observers = {};
  const producers = {};
  const { conversationId, reportId, mediaPath } = manifest.fixture;
  let originalRole;
  let originalRoles;
  let roleTouched = false;
  let stage = "fixture_preflight";
  const health = () => {
    requireGate(!controller.signal.aborted, "run_interrupted_or_deadline");
    for (const observer of Object.values(observers)) requireGate(!observer.failure, observer.failure);
  };
  const waitUntil = async (predicate, code, timeout = DELIVERY_MS) => {
    const end = Date.now() + timeout;
    for (;;) {
      health();
      if (predicate()) return;
      requireGate(Date.now() < end, code);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  const ownedUser = async (client, name) => {
    const data = await checked(client.auth.admin.getUserById(manifest.users[name].id), "fixture_auth_read_failed");
    requireGate(data.user?.id === manifest.users[name].id && data.user.email === manifest.users[name].email &&
      data.user.app_metadata?.fixture_run === manifest.runId, "remote_fixture_identity_mismatch");
    return data.user;
  };
  const setModeratorRole = async (client, role, roles) => {
    await ownedUser(client, "moderator");
    await checked(client.auth.admin.updateUserById(manifest.users.moderator.id, { app_metadata: { role, roles } }), "fixture_role_update_failed");
    const current = await ownedUser(client, "moderator");
    requireGate((current.app_metadata.role ?? null) === role && JSON.stringify(current.app_metadata.roles ?? null) === JSON.stringify(roles), "fixture_role_readback_mismatch");
  };
  const one = (table, fields, key, value) => checked(admin.from(table).select(fields).eq(key, value).single(), "fixture_" + table + "_read_failed");
  const connect = async (observer) => {
    observer.failure = null;
    observer.subscribed = false;
    observer.postgresReady = false;
    observer.closing = false;
    const record = (stream) => (payload) => {
      if (observer.events.length >= 2000) { observer.failure = "event_receipt_limit"; return; }
      observer.events.push({ stream, table: payload.table, type: payload.eventType, row: payload.eventType === "DELETE" ? payload.old : payload.new });
    };
    const channel = observer.client.channel(`authority-realtime-${manifest.runId}-${observer.name}-${randomUUID()}`);
    channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, record("scoped"));
    for (const event of ["INSERT", "UPDATE"]) {
      channel.on("postgres_changes", { event, schema: "public", table: "message_reactions", filter: `conversation_id=eq.${conversationId}` }, record("scoped"));
      channel.on("postgres_changes", { event, schema: "public", table: "notification_realtime_signals", filter: `recipient_user_id=eq.${observer.userId}` }, record("scoped"));
      if (observer.name !== "buyer") channel.on("postgres_changes", { event, schema: "public", table: "notification_realtime_signals", filter: `recipient_user_id=eq.${manifest.users.buyer.id}` }, record("foreign-filter"));
    }
    // A healthy schema-wide channel also detects accidental notifications membership.
    // An unpublished-table subscription error is never mistaken for a passing denial.
    channel.on("postgres_changes", { event: "*", schema: "public" }, record("broad"));
    channel.on("system", {}, (payload) => {
      if (payload.status === "ok" && payload.extension === "postgres_changes") observer.postgresReady = true;
      if (payload.status === "error") observer.failure = "postgres_subscription_error";
    });
    observer.channel = channel;
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") observer.subscribed = true;
      else if (!observer.closing) observer.failure = "realtime_" + status.toLowerCase();
    }, DELIVERY_MS);
    await waitUntil(() => observer.subscribed && observer.postgresReady, "postgres_subscription_not_ready");
  };
  const disconnect = async (observer) => {
    observer.closing = true;
    const result = await Promise.race([
      observer.client.removeAllChannels(),
      new Promise((resolve) => { const timer = setTimeout(() => resolve(null), 5000); timer.unref(); }),
    ]);
    observer.client.realtime.disconnect();
    requireGate(Array.isArray(result) && result.every((value) => value === "ok"), "channel_cleanup_failed");
  };
  const ownSignalVersion = async (name) => {
    const row = await checked(observers[name].client.from("notification_realtime_signals")
      .select("version").eq("recipient_user_id", manifest.users[name].id).single(), "own_signal_pull_failed");
    requireGate(row && /^(?:[1-9][0-9]*)$/.test(String(row.version)), "own_signal_version_invalid");
    return String(row.version);
  };
  try {
    for (const name of NAMES) {
      const user = await ownedUser(admin, name);
      requireGate(!user.banned_until || Date.parse(user.banned_until) <= Date.now(), "fixture_auth_banned");
      requireGate(user.app_metadata.force_name_change !== true, "fixture_forced_name_state");
      if (name === "moderator") {
        originalRole = user.app_metadata.role ?? null;
        originalRoles = user.app_metadata.roles ?? null;
      } else {
        requireGate((user.app_metadata.role ?? null) === (name === "staff" ? "staff" : null) &&
          (!user.app_metadata.roles || (Array.isArray(user.app_metadata.roles) && user.app_metadata.roles.length === 0)), "fixture_unexpected_role");
      }
    }
    const conversation = await one("conversations", "id,buyer_id,seller_id,listing_id", "id", conversationId);
    requireGate(conversation.buyer_id === manifest.users.buyer.id && conversation.seller_id === manifest.users.seller.id, "fixture_participants_mismatch");
    const listing = await one("listings", "status", "id", conversation.listing_id);
    requireGate(listing.status === "active", "fixture_listing_not_active");
    const reportRow = await one("reports", "conversation_id,message_id,reporter_user_id,subject_type", "id", reportId);
    requireGate(reportRow.subject_type === "message" && reportRow.conversation_id === conversationId &&
      [manifest.users.buyer.id, manifest.users.seller.id].includes(reportRow.reporter_user_id), "fixture_report_mismatch");
    const messages = await checked(admin.from("messages").select("id,body").eq("conversation_id", conversationId), "fixture_messages_read_failed");
    requireGate(messages.length >= 9 && messages.some((message) => message.id === reportRow.message_id) &&
      messages.every((message) => message.body?.startsWith(`[authority-${manifest.runId}]`)), "fixture_messages_not_synthetic");
    const attachment = await one("message_attachments", "conversation_id", "storage_path", mediaPath);
    requireGate(attachment.conversation_id === conversationId, "fixture_attachment_mismatch");

    // Mark before the request: uncertain Auth responses still require restoration.
    roleTouched = true;
    report.originalModeratorRoleRestored = false;
    await setModeratorRole(admin, "moderator", []);
    for (const name of NAMES) {
      const producer = createClient(target.origin, env.SMOT_STAGING_ANON_KEY, authOptions);
      producers[name] = producer;
      const data = await checked(producer.auth.signInWithPassword({ email: manifest.users[name].email, password: manifest.users[name].password }), "fixture_sign_in_failed");
      requireGate(data.user?.id === manifest.users[name].id && data.session?.access_token, "fixture_session_mismatch");
      const token = data.session.access_token;
      const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
      requireGate(claims.sub === manifest.users[name].id && claims.exp * 1000 > Date.now() + TOTAL_MS + 30_000, "fixture_token_lifetime_too_short");
      if (name === "moderator") requireGate(claims.app_metadata?.role === "moderator", "original_moderator_claim_required");
      const client = createClient(target.origin, env.SMOT_STAGING_ANON_KEY, retainedTokenOptions(token, fetchWithDeadline));
      observers[name] = { name, userId: manifest.users[name].id, client, events: [] };
      await client.realtime.setAuth(token);
      await connect(observers[name]);
    }

    const phase = async (label, moderatorAllowed) => {
      stage = label;
      health();
      const cursors = Object.fromEntries(NAMES.map((name) => [name, observers[name].events.length]));
      // Same ordinary settings write as the app. Preserve all effective values;
      // an absent row becomes an explicit default on these synthetic accounts.
      for (const name of NAMES) {
        const preference = await checked(producers[name].from("notification_preferences")
          .select("email_enabled,in_app_enabled").eq("user_id", manifest.users[name].id).eq("notification_type", "messages").maybeSingle(), "fixture_preferences_read_failed");
        requireGate(name !== "buyer" || preference?.in_app_enabled !== false, "fixture_message_notifications_disabled");
        await checked(producers[name].from("notification_preferences").upsert({
          user_id: manifest.users[name].id, notification_type: "messages", email_enabled: preference?.email_enabled ?? true,
          in_app_enabled: preference?.in_app_enabled ?? true, updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,notification_type" }), "normal_preferences_save_failed");
      }
      const operation = await checked(producers.seller.rpc("send_conversation_message_idempotent", {
        p_operation_id: randomUUID(), p_conversation_id: conversationId,
        p_body: `[authority-${manifest.runId}] Realtime verification ${label} ${randomUUID()}`, p_attachments: [],
      }), "trusted_message_send_failed");
      const outcome = getMessageOperationOutcome(operation);
      requireGate(outcome.status === "completed" && UUID.test(outcome.message?.id || ""), "trusted_message_receipt_invalid");
      const messageId = outcome.message.id;
      report.messagesAdded += 1;
      const reaction = { message_id: messageId, conversation_id: conversationId, user_id: manifest.users.buyer.id, emoji: "👍" };
      await checked(producers.buyer.from("message_reactions").insert(reaction), "normal_reaction_insert_failed");
      await checked(producers.buyer.from("message_reactions").update({ removed_at: new Date().toISOString() })
        .eq("message_id", messageId).eq("user_id", reaction.user_id).eq("emoji", reaction.emoji).select("message_id").single(), "normal_reaction_remove_failed");
      // Signal delivery only counts once a normal, protected pull proves the
      // corresponding notification really exists. No service producer/seeding.
      const notification = await checked(observers.buyer.client.from("notifications").select("id")
        .eq("user_id", manifest.users.buyer.id).eq("message_id", messageId).single(), "normal_notification_pull_failed");
      requireGate(UUID.test(notification?.id || ""), "normal_notification_missing");
      const expectations = {};
      for (const name of NAMES) expectations[name] = {
        userId: manifest.users[name].id, conversationId, messageId, signalVersion: await ownSignalVersion(name),
        canRead: name === "buyer" || name === "seller" || (name === "moderator" && moderatorAllowed),
      };
      const evaluate = () => NAMES.map((name) => evaluatePhase(observers[name].events.slice(cursors[name]), expectations[name]));
      await waitUntil(() => evaluate().every((result) => result.ready), "positive_delivery_control_missing");
      const quietEnd = Date.now() + QUIET_MS;
      await waitUntil(() => { evaluate(); return Date.now() >= quietEnd; }, "quiet_window_interrupted", QUIET_MS + 1000);
      // Independent same-token Data API control after the live delivery round.
      for (const name of NAMES) {
        const rows = await checked(observers[name].client.from("messages").select("id").eq("id", messageId), "same_token_data_api_failed");
        requireGate((rows.length === 1) === expectations[name].canRead, "same_token_data_api_authority_mismatch");
      }
      health();
      evaluate();
      report.phases.push({ name: label, result: "passed", participantMessageAndReactionDelivery: true,
        allObserversOwnSignalDelivery: true, staffDenied: true, moderatorAllowed,
        rawAndFilteredStreamsChecked: true, legacyNotificationEvents: 0 });
    };

    await phase("initial_moderator", true);
    stage = "commit_demotion";
    await setModeratorRole(admin, null, []);
    await phase("demoted_open_channel_original_jwt", false);
    stage = "reconnect_original_jwt";
    await disconnect(observers.moderator);
    await connect(observers.moderator);
    await phase("demoted_reconnected_original_jwt", false);
    await setModeratorRole(admin, "moderator", []);
    await phase("restored_role_original_jwt", true);
    report.result = "passed";
  } catch (error) {
    report.failure = { stage, code: error instanceof GateError ? error.code : "unexpected_failure_redacted" };
  } finally {
    clearTimeout(deadline);
    // Restore the exact owned account's role values even if observers cannot close.
    if (roleTouched) {
      try {
        await setModeratorRole(cleanupAdmin, originalRole, originalRoles);
        report.originalModeratorRoleRestored = true;
      } catch { report.result = "failed"; report.cleanupFailure = "fixture_moderator_role_restore_failed"; }
    }
    for (const observer of Object.values(observers)) {
      try { await disconnect(observer); } catch { report.result = "failed"; report.channelCleanupFailed = true; }
    }
    // No Auth global sign-out: it could revoke another operator's fixture session.
    for (const producer of Object.values(producers)) producer.realtime.disconnect();
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
  return report;
}

async function main() {
  try {
    const target = validateTarget(process.argv.slice(2), process.env);
    const manifest = readManifest(target); // All local guards precede client creation/network.
    const report = await runVerification(target, manifest, process.env);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.result === "passed" ? 0 : 1;
  } catch (error) {
    console.error(JSON.stringify({ result: "failed", stage: "local_preflight", code: error instanceof GateError ? error.code : "manifest_unavailable_or_invalid" }));
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
