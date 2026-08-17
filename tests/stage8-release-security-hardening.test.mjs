import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260817120920_stage8_release_security_hardening.sql",
    import.meta.url,
  ),
  "utf8",
);
const advisorMigration = await readFile(
  new URL(
    "../supabase/migrations/20260817121321_stage8_advisor_hardening.sql",
    import.meta.url,
  ),
  "utf8",
);

test("Stage 8 binds listing reservations to final Storage metadata", () => {
  assert.match(migration, /new\.metadata ->> 'mimetype'/);
  assert.match(migration, /new\.metadata ->> 'size'/);
  assert.match(migration, /object_mime_type is distinct from reservation_row\.mime_type/);
  assert.match(migration, /object_size_text::numeric is distinct from reservation_row\.size_bytes::numeric/);
  assert.match(migration, /listing_image_reservation_metadata_mismatch/);
});

test("Stage 8 applies the abort quota to every pending transition", () => {
  assert.match(migration, /operation_exists := found/);
  assert.match(migration, /message-send-abort-actor:/);
  assert.match(
    migration,
    /existing\.status = 'aborted'[\s\S]*existing\.aborted_at > pg_catalog\.statement_timestamp\(\) - interval '24 hours'/,
  );
  assert.match(
    migration,
    /message_send_abort_rate_limit[\s\S]*if not operation_exists then[\s\S]*insert into message_send_private\.operations/,
  );
});

test("Stage 8 terminalizes expired pending message operations before scrubbing", () => {
  assert.match(migration, /message_send_operations_pending_expiry_idx/);
  assert.match(
    migration,
    /operation\.status = 'pending'[\s\S]*operation\.replay_expires_at <= pg_catalog\.statement_timestamp\(\)/,
  );
  assert.match(migration, /set status = 'aborted',[\s\S]*'reason', 'expired'/);
  assert.match(migration, /'message_expired', message_expired/);
});

test("Stage 8 enforces and synchronizes school identity on Auth email changes", () => {
  assert.match(
    migration,
    /create trigger enforce_toronto_school_auth_email[\s\S]*before update of email on auth\.users/,
  );
  assert.match(migration, /unsupported_toronto_school_email/);
  assert.match(
    migration,
    /create trigger sync_profile_school_from_auth_email[\s\S]*after update of email on auth\.users/,
  );
  assert.match(migration, /smot\.profile_identity_scope', 'auth_email_sync'/);
  assert.match(migration, /new\.school is distinct from derived_school/);
});

test("Stage 8 pins legacy search paths and hides trigger-only definers", () => {
  for (const functionName of [
    "update_updated_at_column",
    "set_profiles_updated_at",
    "notification_preference_key_from_notification_type",
    "is_moderation_role",
    "touch_conversation_user_state_updated_at",
    "enforce_active_listing_for_conversation",
    "enforce_active_listing_for_message",
    "guard_conversation_listing_status",
    "guard_message_listing_status",
  ]) {
    assert.match(
      advisorMigration,
      new RegExp(`'public\\.${functionName}\\(`),
    );
  }
  assert.match(
    advisorMigration,
    /'alter function %s set search_path = pg_catalog, public'/,
  );

  for (const functionName of [
    "enqueue_notification_email",
    "notify_favouriters_of_listing_activity",
    "rls_auto_enable",
    "skip_disabled_message_notifications",
    "skip_disabled_notifications",
    "unhide_conversation_for_recipient",
  ]) {
    assert.match(
      advisorMigration,
      new RegExp(`'public\\.${functionName}\\(\\)'`),
    );
  }

  assert.match(advisorMigration, /'public\.create_or_get_listing_conversation\(uuid\)'/);
  assert.match(advisorMigration, /'revoke all on function %s from public, anon'/);
  assert.match(advisorMigration, /'grant execute on function %s to authenticated, service_role'/);
});
