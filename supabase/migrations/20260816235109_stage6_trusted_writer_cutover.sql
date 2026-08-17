-- Stage 6 single trusted-writer cutover.
--
-- The foundations before this migration intentionally kept the deployed
-- direct/legacy writers available while the application moved to durable,
-- revision-bound command RPCs. This cutover removes those compatibility
-- surfaces. SELECT and Storage staging/deletion permissions are deliberately
-- untouched; PostgreSQL FK actions also continue to run as the table owner.

revoke insert, update, delete, truncate on table public.listings
  from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate on table public.listing_images
  from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate on table public.reports
  from public, anon, authenticated, service_role;

-- PostgreSQL column grants survive a table-level REVOKE. Remove the exact
-- legacy seller grants introduced by the server-managed listing foundation so
-- PostgREST cannot continue to INSERT/UPDATE through those columns.
revoke insert (
  seller_id, slug, title, description, price, category, condition, location,
  status, is_negotiable
) on table public.listings from authenticated;
revoke update (
  slug, title, description, price, category, condition, location, is_negotiable
) on table public.listings from authenticated;

-- public.submit_marketplace_report(...) is the sole actor-derived report
-- submission boundary. No older report RPC exists; revoking table INSERT is
-- therefore the report writer cutover while moderator SELECT remains intact.

-- Retire the pre-recovery listing writer APIs. The later durable intent RPCs
-- remain granted, as do their bounded actor/service cleanup companions.
revoke execute on function public.save_owned_listing_draft(
  text, uuid, bigint, text, numeric, text, text, text, boolean
) from public, anon, authenticated, service_role;
revoke execute on function public.discard_owned_listing_draft(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.discard_owned_listing_draft_if_unchanged(uuid, bigint)
  from public, anon, authenticated, service_role;
revoke execute on function public.replace_owned_listing_images(uuid, bigint, jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function public.save_owned_listing_draft_with_images(
  uuid, bigint, jsonb, text, text, numeric, text, text, text, boolean
) from public, anon, authenticated, service_role;
revoke execute on function public.transition_owned_listing_status(uuid, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.retire_owned_listing(uuid)
  from public, anon, authenticated, service_role;

revoke execute on function public.save_owned_listing_draft_idempotent(
  uuid, text, uuid, bigint, text, numeric, text, text, text, boolean
) from public, anon, authenticated, service_role;
revoke execute on function public.discard_owned_listing_draft_if_unchanged_idempotent(
  uuid, uuid, bigint
) from public, anon, authenticated, service_role;
revoke execute on function public.replace_owned_listing_images_idempotent(
  uuid, uuid, bigint, jsonb
) from public, anon, authenticated, service_role;
revoke execute on function public.save_owned_listing_draft_with_images_idempotent(
  uuid, uuid, bigint, jsonb, text, text, numeric, text, text, text, boolean
) from public, anon, authenticated, service_role;
-- transition_owned_listing_status_idempotent(uuid, uuid, text) is retained as
-- the current trusted dashboard mark-sold/available path. It is not superseded
-- by the recovery foundation's create/edit/retire intent family.
revoke execute on function public.retire_owned_listing_idempotent(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Old implementation functions stay available only to postgres-owned hidden
-- definers used by the durable intent layer. Callers never receive USAGE on
-- listing_action_private and no longer retain direct EXECUTE either.
revoke execute on function listing_action_private.save_owned_listing_draft_impl(
  text, uuid, bigint, text, numeric, text, text, text, boolean
) from public, anon, authenticated, service_role;
revoke execute on function listing_action_private.discard_owned_listing_draft_impl(uuid, bigint)
  from public, anon, authenticated, service_role;
revoke execute on function listing_action_private.discard_owned_listing_draft_idempotent_impl(
  uuid, uuid, bigint
) from public, anon, authenticated, service_role;
revoke execute on function listing_action_private.replace_owned_listing_images_impl(
  uuid, bigint, jsonb, boolean, text, text, numeric, text, text, text, boolean
) from public, anon, authenticated, service_role;
revoke execute on function listing_action_private.save_owned_listing_draft_idempotent_impl(
  uuid, text, uuid, bigint, text, numeric, text, text, text, boolean
) from public, anon, authenticated, service_role;
revoke execute on function listing_action_private.replace_owned_listing_images_idempotent_impl(
  uuid, uuid, bigint, jsonb, boolean, text, text, numeric, text, text, text, boolean
) from public, anon, authenticated, service_role;
revoke execute on function listing_action_private.transition_owned_listing_status_impl(uuid, text)
  from public, anon, authenticated, service_role;
revoke execute on function listing_action_private.retire_owned_listing_idempotent_impl(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Message creation now has one idempotent reserve/send boundary. The hidden
-- postgres-owned idempotent implementation can still call these legacy
-- functions; user roles cannot invoke them directly.
revoke execute on function public.reserve_message_media_uploads(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function public.send_conversation_message_with_attachments(uuid, text, jsonb)
  from public, anon, authenticated, service_role;

-- Remove rationale-free moderation writers. The rationale-aware wrappers are
-- postgres-owned hidden definers and therefore retain their internal ability
-- to call these implementations, while Data API roles cannot bypass them.
revoke execute on function public.decide_listing_moderation(
  uuid, bigint, timestamptz, text, text, text
) from public, anon, authenticated, service_role;
revoke execute on function public.decide_report_set(uuid[], text, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.remove_reported_listing(uuid[], uuid, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.begin_force_name_operation(
  uuid[], uuid, jsonb, jsonb, text
) from public, anon, authenticated, service_role;
revoke execute on function public.complete_force_name_operation(uuid)
  from public, anon, authenticated, service_role;

-- Some deployed environments may still retain the short-lived direct force
-- name wrapper even though the trusted moderation foundation drops it on a
-- fresh install. Retire it when present without making a clean migration chain
-- depend on an object that no longer exists.
do $stage6_cutover$
begin
  if to_regprocedure('public.force_profile_name_change(uuid[],uuid,text)') is not null then
    execute 'revoke execute on function public.force_profile_name_change(uuid[],uuid,text) from public, anon, authenticated, service_role';
  end if;
end;
$stage6_cutover$;

revoke execute on function moderation_action_private.decide_listing_moderation_impl(
  uuid, bigint, timestamptz, text, text, text
) from public, anon, authenticated, service_role;
revoke execute on function moderation_action_private.decide_listing_moderation_legacy_impl(
  uuid, bigint, timestamptz, text, text
) from public, anon, authenticated, service_role;
revoke execute on function moderation_action_private.decide_report_set_impl(
  uuid[], text, text
) from public, anon, authenticated, service_role;
revoke execute on function moderation_action_private.remove_reported_listing_impl(
  uuid[], uuid, text
) from public, anon, authenticated, service_role;
revoke execute on function moderation_action_private.force_profile_name_change_impl(
  uuid[], uuid, text
) from public, anon, authenticated, service_role;
revoke execute on function moderation_action_private.begin_force_name_operation_impl(
  uuid[], uuid, jsonb, jsonb, text
) from public, anon, authenticated, service_role;
revoke execute on function moderation_action_private.complete_force_name_operation_impl(uuid)
  from public, anon, authenticated, service_role;

-- The Stage 5 command is the only service-facing conversation moderation
-- boundary. It derives and revalidates the live actor, binds an operation ID,
-- applies duration policy and optionally resolves a linked report atomically.
-- Retire the Stage 2 caller-supplied-actor transition and its hidden callee;
-- postgres-owned Stage 5 definers retain owner-level internal access.
revoke execute on function public.transition_conversation_moderation_state(
  uuid, bigint, text, text, text, uuid, timestamptz, text, uuid, text
) from public, anon, authenticated, service_role;
revoke execute on function conversation_moderation_private.transition_conversation_moderation_state_impl(
  uuid, bigint, text, text, text, uuid, timestamptz, text, uuid, text
) from public, anon, authenticated, service_role;

-- Make the intended replacement surface authoritative. These wrappers are all
-- SECURITY INVOKER; their hidden implementation grants remain unchanged.
revoke all on function public.begin_owned_listing_write_intent(uuid,text,text,uuid,bigint,boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.list_owned_listing_write_intents(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.get_owned_listing_write_intent(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.commit_owned_listing_create_draft_intent(
  uuid,text,text,text,numeric,text,text,text,boolean
) from public, anon, authenticated, service_role;
revoke all on function public.reserve_owned_listing_image_uploads(uuid,text,uuid,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.verify_owned_listing_reserved_upload(uuid,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.commit_owned_listing_create_intent(uuid,text,jsonb,boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.commit_owned_listing_edit_intent(
  uuid,text,jsonb,text,text,numeric,text,text,text,boolean
) from public, anon, authenticated, service_role;
revoke all on function public.commit_owned_listing_retire_intent(uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function public.abort_owned_listing_write_intent(uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_owned_listing_image_cleanup_tasks(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_owned_listing_image_cleanup_task(uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.release_owned_listing_image_cleanup_task(uuid,uuid,integer)
  from public, anon, authenticated, service_role;
revoke all on function public.transition_owned_listing_status_idempotent(uuid,uuid,text)
  from public, anon, authenticated, service_role;

grant execute on function public.begin_owned_listing_write_intent(uuid,text,text,uuid,bigint,boolean)
  to authenticated;
grant execute on function public.list_owned_listing_write_intents(integer) to authenticated;
grant execute on function public.get_owned_listing_write_intent(uuid) to authenticated;
grant execute on function public.commit_owned_listing_create_draft_intent(
  uuid,text,text,text,numeric,text,text,text,boolean
) to authenticated;
grant execute on function public.reserve_owned_listing_image_uploads(uuid,text,uuid,jsonb)
  to authenticated;
grant execute on function public.verify_owned_listing_reserved_upload(uuid,text,text)
  to authenticated;
grant execute on function public.commit_owned_listing_create_intent(uuid,text,jsonb,boolean)
  to authenticated;
grant execute on function public.commit_owned_listing_edit_intent(
  uuid,text,jsonb,text,text,numeric,text,text,text,boolean
) to authenticated;
grant execute on function public.commit_owned_listing_retire_intent(uuid,text)
  to authenticated;
grant execute on function public.abort_owned_listing_write_intent(uuid,text)
  to authenticated;
grant execute on function public.claim_owned_listing_image_cleanup_tasks(integer)
  to authenticated;
grant execute on function public.complete_owned_listing_image_cleanup_task(uuid,uuid)
  to authenticated;
grant execute on function public.release_owned_listing_image_cleanup_task(uuid,uuid,integer)
  to authenticated;
grant execute on function public.transition_owned_listing_status_idempotent(uuid,uuid,text)
  to authenticated;

revoke all on function public.claim_listing_image_cleanup_tasks(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_listing_account_cleanup_tasks(uuid,uuid,integer)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_listing_image_cleanup_task(uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.release_listing_image_cleanup_task(uuid,uuid,integer)
  from public, anon, authenticated, service_role;
revoke all on function public.prepare_listing_account_retirement(uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.finalize_listing_account_retirement(uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.maintain_listing_write_recovery(integer)
  from public, anon, authenticated, service_role;

grant execute on function public.claim_listing_image_cleanup_tasks(integer) to service_role;
grant execute on function public.claim_listing_account_cleanup_tasks(uuid,uuid,integer)
  to service_role;
grant execute on function public.complete_listing_image_cleanup_task(uuid,uuid) to service_role;
grant execute on function public.release_listing_image_cleanup_task(uuid,uuid,integer)
  to service_role;
grant execute on function public.prepare_listing_account_retirement(uuid,uuid) to service_role;
grant execute on function public.finalize_listing_account_retirement(uuid,uuid) to service_role;
grant execute on function public.maintain_listing_write_recovery(integer) to service_role;

revoke all on function public.submit_marketplace_report(text,uuid,text,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_marketplace_report(text,uuid,text,text,uuid)
  to authenticated;

revoke all on function public.reserve_message_media_uploads_idempotent(uuid,uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.send_conversation_message_idempotent(uuid,uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.abort_message_send_operation(uuid,uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.list_expired_message_media_uploads()
  from public, anon, authenticated, service_role;
revoke all on function public.release_message_media_upload_reservations(text[])
  from public, anon, authenticated, service_role;
revoke all on function public.prepare_message_media_account_cleanup(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.retire_message_media_account_reservations(uuid,text[])
  from public, anon, authenticated, service_role;

grant execute on function public.reserve_message_media_uploads_idempotent(uuid,uuid,text,jsonb)
  to authenticated;
grant execute on function public.send_conversation_message_idempotent(uuid,uuid,text,jsonb)
  to authenticated;
grant execute on function public.abort_message_send_operation(uuid,uuid,text,jsonb)
  to authenticated;
grant execute on function public.list_expired_message_media_uploads() to authenticated;
grant execute on function public.release_message_media_upload_reservations(text[])
  to authenticated;
grant execute on function public.prepare_message_media_account_cleanup(uuid) to service_role;
grant execute on function public.retire_message_media_account_reservations(uuid,text[])
  to service_role;

revoke all on function public.decide_listing_moderation_with_rationale(
  uuid,bigint,timestamptz,text,text,uuid
) from public, anon, authenticated, service_role;
revoke all on function public.decide_report_set_with_summary(uuid[],text,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.remove_reported_listing_with_rationale(
  uuid[],uuid,text,text,uuid
) from public, anon, authenticated, service_role;
revoke all on function public.save_report_moderator_note(uuid,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.begin_force_name_operation_with_rationale(
  uuid[],uuid,jsonb,jsonb,text,text,text,uuid
) from public, anon, authenticated, service_role;
revoke all on function public.complete_force_name_operation_with_rationale(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.abort_force_name_operation(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.decide_listing_moderation_with_rationale(
  uuid,bigint,timestamptz,text,text,uuid
) to authenticated;
grant execute on function public.decide_report_set_with_summary(uuid[],text,text,uuid)
  to authenticated;
grant execute on function public.remove_reported_listing_with_rationale(
  uuid[],uuid,text,text,uuid
) to authenticated;
grant execute on function public.save_report_moderator_note(uuid,text,uuid)
  to authenticated;
grant execute on function public.begin_force_name_operation_with_rationale(
  uuid[],uuid,jsonb,jsonb,text,text,text,uuid
) to authenticated;
grant execute on function public.complete_force_name_operation_with_rationale(uuid)
  to authenticated;
grant execute on function public.abort_force_name_operation(uuid) to authenticated;

revoke all on function public.admin_moderate_conversation(
  uuid,uuid,bigint,text,text,text,text,text,uuid,boolean,uuid
) from public, anon, authenticated, service_role;
grant execute on function public.admin_moderate_conversation(
  uuid,uuid,bigint,text,text,text,text,text,uuid,boolean,uuid
) to service_role;

-- Sanction/application-ban, announcement, notification lifecycle and reaction
-- surfaces are intentionally untouched. Conversation moderation is narrowed
-- above to the Stage 5 idempotent admin command only.
