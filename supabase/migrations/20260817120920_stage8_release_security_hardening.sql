-- Stage 8 release security hardening.
--
-- Close the four medium-severity gaps found during the pre-production review:
-- bind listing image reservations to final object metadata, apply abort quotas
-- to every pending-to-aborted transition, retire expired pending message
-- operations, and enforce Toronto-school eligibility across email changes.

-- ---------------------------------------------------------------------------
-- Listing image reservations bind the final Storage size and MIME type
-- ---------------------------------------------------------------------------

create or replace function listing_action_private.guard_retiring_listing_image_upload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid;
  actor_segment text;
  jwt_actor_id uuid := auth.uid();
  jwt_role text := coalesce(auth.jwt() ->> 'role', '');
  reservation_row listing_action_private.image_upload_reservations%rowtype;
  object_mime_type text;
  object_size_text text;
begin
  if new.bucket_id <> 'listing-images' then return new; end if;

  actor_segment := pg_catalog.split_part(new.name, '/', 1);
  if actor_segment !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    if jwt_role = 'authenticated' then
      raise exception using errcode = '42501', message = 'listing_image_reservation_required';
    end if;
    return new;
  end if;
  actor_id := actor_segment::uuid;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('listing-write-actor:' || actor_id::text, 0)
  );

  if exists (
    select 1
    from listing_action_private.account_retirements retirement
    where retirement.actor_user_id_snapshot = actor_id
  ) then
    raise exception using errcode = '42501', message = 'listing_account_retirement_in_progress';
  end if;

  if jwt_role = 'authenticated' then
    if jwt_actor_id is null
      or jwt_actor_id is distinct from actor_id
      or new.owner_id is distinct from actor_id::text then
      raise exception using errcode = '42501', message = 'listing_image_owner_mismatch';
    end if;

    if tg_op = 'UPDATE' then
      raise exception using errcode = '42501', message = 'listing_image_overwrite_forbidden';
    end if;

    select reservation.* into reservation_row
    from listing_action_private.image_upload_reservations reservation
    join listing_action_private.write_intents intent
      on intent.actor_user_id = reservation.actor_user_id_snapshot
     and intent.operation_id = reservation.operation_id
    where reservation.storage_path = new.name
      and reservation.actor_user_id_snapshot = actor_id
      and reservation.listing_id_snapshot::text = pg_catalog.split_part(new.name, '/', 2)
      and reservation.state = 'reserved'
      and reservation.expires_at > pg_catalog.statement_timestamp()
      and intent.state in ('begun', 'in_progress')
    for key share of reservation, intent;

    if not found then
      raise exception using errcode = '42501', message = 'listing_image_reservation_required';
    end if;

    object_mime_type := pg_catalog.lower(
      coalesce(new.metadata ->> 'mimetype', '')
    );
    object_size_text := new.metadata ->> 'size';

    if object_mime_type is distinct from reservation_row.mime_type
      or object_size_text is null
      or object_size_text !~ '^[0-9]{1,19}$'
      or object_size_text::numeric is distinct from reservation_row.size_bytes::numeric then
      raise exception using
        errcode = '22023',
        message = 'listing_image_reservation_metadata_mismatch';
    end if;
  end if;

  return new;
end
$function$;

alter function listing_action_private.guard_retiring_listing_image_upload()
  owner to postgres;
revoke all on function listing_action_private.guard_retiring_listing_image_upload()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Abort quotas cover existing pending operations as well as new operations
-- ---------------------------------------------------------------------------

create or replace function message_send_private.abort_impl(
  p_operation_id uuid,
  p_conversation_id uuid,
  p_body text,
  p_attachments jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  payload jsonb;
  operation message_send_private.operations%rowtype;
  operation_exists boolean := false;
  abort_result jsonb;
begin
  perform message_send_private.assert_operation_replay_available(
    p_operation_id, p_conversation_id, p_body, p_attachments
  );
  payload := message_send_private.canonical_payload(p_conversation_id, p_body, p_attachments);
  perform message_send_private.lock_operation(actor_id, p_operation_id);

  select * into operation
  from message_send_private.operations existing
  where existing.sender_user_id_snapshot = actor_id
    and existing.operation_id = p_operation_id
  for update;
  operation_exists := found;

  if operation_exists then
    if operation.canonical_payload is distinct from payload then
      raise exception 'message_send_operation_payload_conflict' using errcode = '22023';
    end if;
    if operation.status in ('completed', 'aborted') then
      return pg_catalog.jsonb_build_object('status', operation.status, 'result', operation.result);
    end if;
  else
    perform 1
    from public.conversations conversation
    where conversation.id = p_conversation_id
      and actor_id in (conversation.buyer_id, conversation.seller_id)
    for share;
    if not found then
      raise exception 'message_send_conversation_access_denied' using errcode = '42501';
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('message-send-abort-actor:' || actor_id::text, 0)
  );
  if (
    select pg_catalog.count(*)
    from message_send_private.operations existing
    where existing.sender_user_id_snapshot = actor_id
      and existing.status = 'aborted'
      and existing.aborted_at > pg_catalog.statement_timestamp() - interval '24 hours'
  ) >= 20 then
    raise exception 'message_send_abort_rate_limit' using errcode = '54000';
  end if;

  if not operation_exists then
    insert into message_send_private.operations (
      sender_user_id, sender_user_id_snapshot, operation_id,
      conversation_id, conversation_id_snapshot, canonical_payload,
      payload_hash, replay_expires_at
    ) values (
      actor_id, actor_id, p_operation_id,
      p_conversation_id, p_conversation_id, payload,
      pg_catalog.md5(payload::text),
      pg_catalog.statement_timestamp() + interval '7 days'
    ) returning * into operation;
  end if;

  abort_result := pg_catalog.jsonb_build_object(
    'status', 'aborted',
    'storage_paths', coalesce((
      select pg_catalog.jsonb_agg(attachment ->> 'storage_path' order by position)
      from pg_catalog.jsonb_array_elements(payload -> 'attachments')
        with ordinality planned(attachment, position)
    ), '[]'::jsonb)
  );
  perform pg_catalog.set_config('smot.message_send_operation_scope', 'trusted', true);
  update message_send_private.operations existing
  set status = 'aborted', result = abort_result,
      aborted_at = pg_catalog.timezone('utc', pg_catalog.now())
  where existing.sender_user_id_snapshot = actor_id
    and existing.operation_id = p_operation_id;
  perform pg_catalog.set_config('smot.message_send_operation_scope', '', true);
  return pg_catalog.jsonb_build_object('status', 'aborted', 'result', abort_result);
exception when others then
  perform pg_catalog.set_config('smot.message_send_operation_scope', '', true);
  raise;
end
$function$;

alter function message_send_private.abort_impl(uuid, uuid, text, jsonb)
  owner to postgres;
revoke all on function message_send_private.abort_impl(uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function message_send_private.abort_impl(uuid, uuid, text, jsonb)
  to authenticated;

create index if not exists message_send_operations_pending_expiry_idx
  on message_send_private.operations (
    replay_expires_at,
    sender_user_id_snapshot,
    operation_id
  ) where scrubbed_at is null and status = 'pending';

-- ---------------------------------------------------------------------------
-- Expired pending operations are terminalized, tombstoned, and scrubbed
-- ---------------------------------------------------------------------------

create or replace function private.maintain_stage7_security_ledgers_impl(p_limit integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  bounded_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  message_expired integer := 0;
  message_scrubbed integer := 0;
  message_deleted integer := 0;
  report_scrubbed integer := 0;
  report_deleted integer := 0;
begin
  perform pg_catalog.set_config('smot.message_send_operation_scope', 'stage7_maintenance', true);
  with selected as (
    select operation.sender_user_id_snapshot, operation.operation_id
    from message_send_private.operations operation
    where operation.status = 'pending'
      and operation.scrubbed_at is null
      and operation.replay_expires_at <= pg_catalog.statement_timestamp()
    order by operation.replay_expires_at, operation.sender_user_id_snapshot, operation.operation_id
    limit bounded_limit
    for update skip locked
  )
  update message_send_private.operations operation
  set status = 'aborted',
      result = pg_catalog.jsonb_build_object(
        'status', 'aborted',
        'reason', 'expired',
        'storage_paths', coalesce((
          select pg_catalog.jsonb_agg(attachment ->> 'storage_path' order by position)
          from pg_catalog.jsonb_array_elements(operation.canonical_payload -> 'attachments')
            with ordinality planned(attachment, position)
        ), '[]'::jsonb)
      ),
      aborted_at = pg_catalog.statement_timestamp()
  from selected
  where operation.sender_user_id_snapshot = selected.sender_user_id_snapshot
    and operation.operation_id = selected.operation_id;
  get diagnostics message_expired = row_count;

  insert into message_send_private.operation_tombstones(
    sender_user_id_snapshot, operation_id, payload_hash, expires_at
  )
  select operation.sender_user_id_snapshot, operation.operation_id,
      operation.payload_hash, pg_catalog.statement_timestamp() + interval '90 days'
  from message_send_private.operations operation
  where operation.status in ('completed', 'aborted')
    and operation.scrubbed_at is null
    and operation.replay_expires_at <= pg_catalog.statement_timestamp()
  order by operation.replay_expires_at, operation.sender_user_id_snapshot, operation.operation_id
  limit bounded_limit
  on conflict (sender_user_id_snapshot, operation_id) do nothing;

  with selected as (
    select operation.sender_user_id_snapshot, operation.operation_id
    from message_send_private.operations operation
    where operation.status in ('completed', 'aborted')
      and operation.scrubbed_at is null
      and operation.replay_expires_at <= pg_catalog.statement_timestamp()
    order by operation.replay_expires_at, operation.sender_user_id_snapshot, operation.operation_id
    limit bounded_limit
    for update skip locked
  )
  update message_send_private.operations operation
  set canonical_payload = pg_catalog.jsonb_build_object(
        'conversation_id', operation.conversation_id_snapshot,
        'body', '', 'attachments', '[]'::jsonb, 'expired', true
      ),
      reservation_result = null,
      result = pg_catalog.jsonb_build_object('status', 'expired'),
      sender_user_id = null,
      conversation_id = null,
      scrubbed_at = pg_catalog.statement_timestamp()
  from selected
  where operation.sender_user_id_snapshot = selected.sender_user_id_snapshot
    and operation.operation_id = selected.operation_id;
  get diagnostics message_scrubbed = row_count;

  with selected as (
    select operation.sender_user_id_snapshot, operation.operation_id
    from message_send_private.operations operation
    where operation.scrubbed_at is not null
      and operation.replay_expires_at <= pg_catalog.statement_timestamp() - interval '30 days'
      and not exists (
        select 1 from private.message_media_upload_reservations reservation
        where reservation.send_operation_sender_snapshot = operation.sender_user_id_snapshot
          and reservation.send_operation_id = operation.operation_id
      )
    order by operation.replay_expires_at, operation.sender_user_id_snapshot, operation.operation_id
    limit bounded_limit
    for update skip locked
  )
  delete from message_send_private.operations operation
  using selected
  where operation.sender_user_id_snapshot = selected.sender_user_id_snapshot
    and operation.operation_id = selected.operation_id;
  get diagnostics message_deleted = row_count;
  perform pg_catalog.set_config('smot.message_send_operation_scope', '', true);

  insert into report_submission_private.command_tombstones(
    actor_user_id_snapshot, operation_id, payload_hash, expires_at
  )
  select command.actor_user_id_snapshot, command.operation_id,
      command.payload_hash, pg_catalog.statement_timestamp() + interval '90 days'
  from report_submission_private.commands command
  where command.scrubbed_at is null
    and command.replay_expires_at <= pg_catalog.statement_timestamp()
  order by command.replay_expires_at, command.actor_user_id_snapshot, command.operation_id
  limit bounded_limit
  on conflict (actor_user_id_snapshot, operation_id) do nothing;

  with selected as (
    select command.id
    from report_submission_private.commands command
    where command.scrubbed_at is null
      and command.replay_expires_at <= pg_catalog.statement_timestamp()
    order by command.replay_expires_at, command.id
    limit bounded_limit
    for update skip locked
  )
  update report_submission_private.commands command
  set payload = pg_catalog.jsonb_build_object('expired', true),
      scrubbed_at = pg_catalog.statement_timestamp()
  from selected
  where command.id = selected.id;
  get diagnostics report_scrubbed = row_count;

  with selected as (
    select command.id
    from report_submission_private.commands command
    where command.scrubbed_at is not null
      and command.replay_expires_at <= pg_catalog.statement_timestamp() - interval '30 days'
    order by command.replay_expires_at, command.id
    limit bounded_limit
    for update skip locked
  )
  delete from report_submission_private.commands command
  using selected where command.id = selected.id;
  get diagnostics report_deleted = row_count;

  delete from message_send_private.operation_tombstones tombstone
  where tombstone.expires_at <= pg_catalog.statement_timestamp();
  delete from report_submission_private.command_tombstones tombstone
  where tombstone.expires_at <= pg_catalog.statement_timestamp();

  return pg_catalog.jsonb_build_object(
    'message_expired', message_expired,
    'message_scrubbed', message_scrubbed,
    'message_deleted', message_deleted,
    'report_scrubbed', report_scrubbed,
    'report_deleted', report_deleted
  );
exception when others then
  perform pg_catalog.set_config('smot.message_send_operation_scope', '', true);
  raise;
end
$function$;

alter function private.maintain_stage7_security_ledgers_impl(integer)
  owner to postgres;
revoke all on function private.maintain_stage7_security_ledgers_impl(integer)
  from public, anon, authenticated, service_role;
grant execute on function private.maintain_stage7_security_ledgers_impl(integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- Toronto-school eligibility survives the full Auth email lifecycle
-- ---------------------------------------------------------------------------

create or replace function private.protect_profile_identity_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  caller_role text := coalesce(auth.role(), '');
  identity_scope text := coalesce(
    pg_catalog.current_setting('smot.profile_identity_scope', true),
    ''
  );
  auth_email text;
  derived_school text;
  requires_name_change boolean := false;
begin
  if tg_op = 'INSERT' then
    if caller_role = 'authenticated' then
      if caller_id is null or new.id is distinct from caller_id then
        raise exception using
          errcode = '42501',
          message = 'profile_identity_owner_mismatch';
      end if;

      if new.first_name is not null or new.last_name is not null then
        raise exception using
          errcode = '42501',
          message = 'profile_identity_requires_trusted_api';
      end if;
    elsif caller_role = 'anon' then
      raise exception using
        errcode = '42501',
        message = 'profile_authentication_required';
    end if;

    select
      account.email,
      account.raw_app_meta_data -> 'force_name_change' = 'true'::jsonb
    into auth_email, requires_name_change
    from auth.users account
    where account.id = new.id;

    new.school := private.toronto_school_name_for_email(auth_email);

    if new.school is null then
      raise exception using
        errcode = '23514',
        message = 'profile_school_email_not_allowed';
    end if;

    if requires_name_change and (new.first_name is not null or new.last_name is not null) then
      raise exception using
        errcode = '42501',
        message = 'profile_name_change_required';
    end if;

    return new;
  end if;

  if current_user = 'postgres' and identity_scope = 'auth_email_sync' then
    if new.first_name is distinct from old.first_name
      or new.last_name is distinct from old.last_name then
      raise exception using
        errcode = '42501',
        message = 'profile_identity_email_sync_scope_violation';
    end if;

    select account.email into auth_email
    from auth.users account
    where account.id = new.id;
    derived_school := private.toronto_school_name_for_email(auth_email);

    if derived_school is null or new.school is distinct from derived_school then
      raise exception using
        errcode = '42501',
        message = 'profile_school_email_sync_mismatch';
    end if;

    return new;
  end if;

  if new.first_name is not distinct from old.first_name
    and new.last_name is not distinct from old.last_name
    and new.school is not distinct from old.school then
    return new;
  end if;

  if caller_role in ('anon', 'authenticated') then
    raise exception using
      errcode = '42501',
      message = 'profile_identity_requires_trusted_api';
  end if;

  return new;
end
$function$;

alter function private.protect_profile_identity_fields() owner to postgres;
revoke all on function private.protect_profile_identity_fields()
  from public, anon, authenticated, service_role;

create or replace function private.enforce_toronto_school_auth_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.email is not distinct from old.email then return new; end if;

  if private.toronto_school_name_for_email(new.email) is null then
    raise exception using
      errcode = '23514',
      message = 'unsupported_toronto_school_email';
  end if;

  return new;
end
$function$;

alter function private.enforce_toronto_school_auth_email() owner to postgres;
revoke all on function private.enforce_toronto_school_auth_email()
  from public, anon, authenticated, service_role, supabase_auth_admin;

create or replace function private.sync_profile_school_from_auth_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  derived_school text;
begin
  if new.email is not distinct from old.email then return new; end if;

  derived_school := private.toronto_school_name_for_email(new.email);
  if derived_school is null then
    raise exception using
      errcode = '23514',
      message = 'unsupported_toronto_school_email';
  end if;

  perform pg_catalog.set_config('smot.profile_identity_scope', 'auth_email_sync', true);
  update public.profiles profile
  set school = derived_school
  where profile.id = new.id
    and profile.school is distinct from derived_school;
  perform pg_catalog.set_config('smot.profile_identity_scope', '', true);
  return new;
exception when others then
  perform pg_catalog.set_config('smot.profile_identity_scope', '', true);
  raise;
end
$function$;

alter function private.sync_profile_school_from_auth_email() owner to postgres;
revoke all on function private.sync_profile_school_from_auth_email()
  from public, anon, authenticated, service_role, supabase_auth_admin;

drop trigger if exists enforce_toronto_school_auth_email on auth.users;
create trigger enforce_toronto_school_auth_email
before update of email on auth.users
for each row execute function private.enforce_toronto_school_auth_email();

drop trigger if exists sync_profile_school_from_auth_email on auth.users;
create trigger sync_profile_school_from_auth_email
after update of email on auth.users
for each row execute function private.sync_profile_school_from_auth_email();

comment on function private.enforce_toronto_school_auth_email() is
  'Preserves Toronto-school admission whenever an existing Auth email changes.';
comment on function private.sync_profile_school_from_auth_email() is
  'Synchronizes the protected profile school after an allowed Auth email change.';
