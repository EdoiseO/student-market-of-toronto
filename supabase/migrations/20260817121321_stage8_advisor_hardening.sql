-- Stage 8 database-advisor hardening.
--
-- Pin legacy function resolution and remove API execution grants from trigger-
-- only SECURITY DEFINER functions. Intended authenticated RPCs retain their
-- explicit grants and continue to enforce auth.uid() inside their bodies.

do $block$
declare
  routine regprocedure;
begin
  for routine in
    select pg_catalog.to_regprocedure(signature)
    from pg_catalog.unnest(array[
      'public.update_updated_at_column()',
      'public.set_profiles_updated_at()',
      'public.notification_preference_key_from_notification_type(text)',
      'public.is_moderation_role()',
      'public.touch_conversation_user_state_updated_at()',
      'public.enforce_active_listing_for_conversation()',
      'public.enforce_active_listing_for_message()',
      'public.guard_conversation_listing_status()',
      'public.guard_message_listing_status()'
    ]::text[]) signature
    where pg_catalog.to_regprocedure(signature) is not null
  loop
    execute pg_catalog.format(
      'alter function %s set search_path = pg_catalog, public',
      routine
    );
  end loop;

  for routine in
    select pg_catalog.to_regprocedure(signature)
    from pg_catalog.unnest(array[
      'public.enqueue_notification_email()',
      'public.notify_favouriters_of_listing_activity()',
      'public.rls_auto_enable()',
      'public.skip_disabled_message_notifications()',
      'public.skip_disabled_notifications()',
      'public.unhide_conversation_for_recipient()'
    ]::text[]) signature
    where pg_catalog.to_regprocedure(signature) is not null
  loop
    execute pg_catalog.format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      routine
    );
  end loop;

  routine := pg_catalog.to_regprocedure(
    'public.create_or_get_listing_conversation(uuid)'
  );
  if routine is not null then
    execute pg_catalog.format(
      'revoke all on function %s from public, anon',
      routine
    );
    execute pg_catalog.format(
      'grant execute on function %s to authenticated, service_role',
      routine
    );
  end if;
end
$block$;
