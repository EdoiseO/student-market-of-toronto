-- Stage 7 security remediation.
--
-- Closes the nine reportable findings preserved by Codex Security scan
-- 1315c683-6add-40be-8149-9f6a94d3060a. The failed scan remains immutable;
-- this additive migration repairs the trusted-write boundaries it identified.

-- ---------------------------------------------------------------------------
-- Canonical moderation roles and force-name compliance
-- ---------------------------------------------------------------------------

-- app_metadata is already the canonical moderation source. Fail closed for
-- legacy auth.users.role values because they may be stale demotion residue.
update auth.users account
set role = 'authenticated',
    updated_at = pg_catalog.statement_timestamp()
where pg_catalog.lower(pg_catalog.btrim(coalesce(account.role, '')))
  in ('admin', 'moderator', 'staff');

create or replace function moderation_action_private.resolve_role_from_account(
  p_app_metadata jsonb,
  p_auth_role text
)
returns text
language plpgsql
immutable
security definer
set search_path = ''
as $function$
declare
  candidate text;
begin
  -- A forced-name account retains its configured role for later recovery, but
  -- it has no effective moderation authority until compliance succeeds.
  if coalesce(p_app_metadata -> 'force_name_change' = 'true'::jsonb, false) then
    return null;
  end if;

  candidate := pg_catalog.lower(pg_catalog.btrim(coalesce(p_app_metadata ->> 'role', '')));
  if candidate in ('admin', 'moderator', 'staff') then
    return candidate;
  end if;

  if pg_catalog.jsonb_typeof(p_app_metadata -> 'roles') = 'array' then
    select pg_catalog.lower(pg_catalog.btrim(role_value.value))
    into candidate
    from pg_catalog.jsonb_array_elements_text(p_app_metadata -> 'roles')
      with ordinality role_value(value, position)
    where pg_catalog.lower(pg_catalog.btrim(role_value.value))
      in ('admin', 'moderator', 'staff')
    order by role_value.position
    limit 1;
    if candidate is not null then
      return candidate;
    end if;
  end if;

  -- p_auth_role is deliberately ignored. auth.users.role is the Data API role,
  -- never an application moderation role.
  return null;
end
$function$;

alter function moderation_action_private.resolve_role_from_account(jsonb, text)
  owner to postgres;
revoke all on function moderation_action_private.resolve_role_from_account(jsonb, text)
  from public, anon, authenticated, service_role;

create or replace function private.reject_banned_authenticated_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  force_name_change boolean := false;
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'authenticated' and actor_id is not null then
    select coalesce(account.raw_app_meta_data -> 'force_name_change' = 'true'::jsonb, false)
    into force_name_change
    from auth.users account
    where account.id = actor_id;

    if force_name_change then
      raise exception using errcode = '42501', message = 'profile_name_change_required';
    end if;

    if exists (
      select 1
      from public.user_status status
      where status.user_id = actor_id
        and status.is_banned
        and (status.banned_until is null or status.banned_until > pg_catalog.statement_timestamp())
    ) then
      raise exception using errcode = '42501', message = 'account_is_banned';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$function$;

alter function private.reject_banned_authenticated_write() owner to postgres;
revoke all on function private.reject_banned_authenticated_write()
  from public, anon, authenticated, service_role;

create or replace function private.reject_banned_authenticated_storage_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  object_bucket text := case when tg_op = 'DELETE' then old.bucket_id else new.bucket_id end;
  actor_id uuid := auth.uid();
  force_name_change boolean := false;
begin
  if object_bucket = any (array['profile-images', 'listing-images', 'message-media']::text[])
    and coalesce(auth.jwt() ->> 'role', '') = 'authenticated'
    and actor_id is not null then
    select coalesce(account.raw_app_meta_data -> 'force_name_change' = 'true'::jsonb, false)
    into force_name_change
    from auth.users account
    where account.id = actor_id;

    if force_name_change then
      raise exception using errcode = '42501', message = 'profile_name_change_required';
    end if;

    if exists (
      select 1
      from public.user_status status
      where status.user_id = actor_id
        and status.is_banned
        and (status.banned_until is null or status.banned_until > pg_catalog.statement_timestamp())
    ) then
      raise exception using errcode = '42501', message = 'account_is_banned';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$function$;

alter function private.reject_banned_authenticated_storage_write() owner to postgres;
revoke all on function private.reject_banned_authenticated_storage_write()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Listing Storage uploads must be backed by an exact active reservation
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

    perform reservation.storage_path
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
  end if;

  return new;
end
$function$;

alter function listing_action_private.guard_retiring_listing_image_upload()
  owner to postgres;
revoke all on function listing_action_private.guard_retiring_listing_image_upload()
  from public, anon, authenticated, service_role;

drop trigger if exists guard_retiring_listing_image_upload on storage.objects;
create trigger guard_retiring_listing_image_upload
before insert or update on storage.objects
for each row execute function listing_action_private.guard_retiring_listing_image_upload();

-- ---------------------------------------------------------------------------
-- Bounded message operation lifecycle and abort abuse controls
-- ---------------------------------------------------------------------------

alter table message_send_private.operations
  add column if not exists payload_hash text,
  add column if not exists replay_expires_at timestamptz,
  add column if not exists scrubbed_at timestamptz;

update message_send_private.operations operation
set payload_hash = pg_catalog.md5(operation.canonical_payload::text),
    replay_expires_at = coalesce(
      operation.completed_at,
      operation.aborted_at,
      operation.created_at
    ) + interval '7 days'
where operation.payload_hash is null or operation.replay_expires_at is null;

alter table message_send_private.operations
  alter column payload_hash set not null,
  alter column replay_expires_at set not null,
  alter column replay_expires_at set default (pg_catalog.statement_timestamp() + interval '7 days');

create or replace function message_send_private.initialize_stage7_operation_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.payload_hash := pg_catalog.md5(new.canonical_payload::text);
  new.replay_expires_at := coalesce(
    new.replay_expires_at,
    pg_catalog.statement_timestamp() + interval '7 days'
  );
  return new;
end
$function$;

alter function message_send_private.initialize_stage7_operation_lifecycle()
  owner to postgres;
revoke all on function message_send_private.initialize_stage7_operation_lifecycle()
  from public, anon, authenticated, service_role;

drop trigger if exists initialize_stage7_operation_lifecycle
  on message_send_private.operations;
create trigger initialize_stage7_operation_lifecycle
before insert on message_send_private.operations
for each row execute function message_send_private.initialize_stage7_operation_lifecycle();

create table if not exists message_send_private.operation_tombstones (
  sender_user_id_snapshot uuid not null,
  operation_id uuid not null,
  payload_hash text not null,
  expires_at timestamptz not null,
  primary key (sender_user_id_snapshot, operation_id)
);
create index if not exists message_send_operation_tombstones_expiry_idx
  on message_send_private.operation_tombstones (expires_at);
create index if not exists message_send_operations_replay_expiry_idx
  on message_send_private.operations (
    replay_expires_at,
    sender_user_id_snapshot,
    operation_id
  ) where scrubbed_at is null and status in ('completed', 'aborted');
alter table message_send_private.operation_tombstones enable row level security;
revoke all on table message_send_private.operation_tombstones
  from public, anon, authenticated, service_role;

create or replace function message_send_private.guard_operation_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  scope text := coalesce(pg_catalog.current_setting('smot.message_send_operation_scope', true), '');
begin
  if current_user = 'postgres' and scope = 'stage7_maintenance' then
    if tg_op = 'DELETE' then return old; end if;
    if new.sender_user_id_snapshot is distinct from old.sender_user_id_snapshot
      or new.operation_id is distinct from old.operation_id
      or new.conversation_id_snapshot is distinct from old.conversation_id_snapshot
      or new.created_at is distinct from old.created_at
      or new.payload_hash is distinct from old.payload_hash
      or new.replay_expires_at is distinct from old.replay_expires_at then
      raise exception 'message_send_operation_identity_is_immutable' using errcode = '42501';
    end if;
    new.updated_at := pg_catalog.timezone('utc', pg_catalog.now());
    return new;
  end if;

  if tg_op = 'UPDATE' and scope = ''
    and new.sender_user_id_snapshot is not distinct from old.sender_user_id_snapshot
    and new.operation_id is not distinct from old.operation_id
    and new.conversation_id_snapshot is not distinct from old.conversation_id_snapshot
    and new.canonical_payload is not distinct from old.canonical_payload
    and new.reservation_result is not distinct from old.reservation_result
    and new.status is not distinct from old.status
    and new.result is not distinct from old.result
    and new.created_at is not distinct from old.created_at
    and new.completed_at is not distinct from old.completed_at
    and new.aborted_at is not distinct from old.aborted_at
    and new.payload_hash is not distinct from old.payload_hash
    and new.replay_expires_at is not distinct from old.replay_expires_at
    and new.scrubbed_at is not distinct from old.scrubbed_at
    and (new.sender_user_id is null or new.sender_user_id is not distinct from old.sender_user_id)
    and (new.conversation_id is null or new.conversation_id is not distinct from old.conversation_id)
    and (new.sender_user_id is distinct from old.sender_user_id
      or new.conversation_id is distinct from old.conversation_id) then
    new.updated_at := pg_catalog.timezone('utc', pg_catalog.now());
    return new;
  end if;

  if current_user <> 'postgres' or scope <> 'trusted' then
    raise exception 'message_send_operation_mutation_forbidden' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'message_send_operation_history_is_immutable' using errcode = '42501';
  end if;
  if new.sender_user_id_snapshot is distinct from old.sender_user_id_snapshot
    or new.operation_id is distinct from old.operation_id
    or new.conversation_id_snapshot is distinct from old.conversation_id_snapshot
    or new.canonical_payload is distinct from old.canonical_payload
    or new.created_at is distinct from old.created_at
    or new.payload_hash is distinct from old.payload_hash
    or new.replay_expires_at is distinct from old.replay_expires_at
    or new.scrubbed_at is distinct from old.scrubbed_at
    or (old.completed_at is not null and new.completed_at is distinct from old.completed_at)
    or (old.aborted_at is not null and new.aborted_at is distinct from old.aborted_at)
    or (old.reservation_result is not null and new.reservation_result is distinct from old.reservation_result)
    or (old.result is not null and new.result is distinct from old.result)
    or old.status in ('completed', 'aborted') then
    raise exception 'message_send_operation_history_is_immutable' using errcode = '42501';
  end if;
  new.updated_at := pg_catalog.timezone('utc', pg_catalog.now());
  return new;
end
$function$;

create or replace function message_send_private.assert_operation_replay_available(
  p_operation_id uuid,
  p_conversation_id uuid,
  p_body text,
  p_attachments jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  canonical jsonb;
  canonical_hash text;
  operation message_send_private.operations%rowtype;
  tombstone message_send_private.operation_tombstones%rowtype;
begin
  if actor_id is null or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    raise exception 'message_send_authentication_required' using errcode = '28000';
  end if;
  canonical := message_send_private.canonical_payload(p_conversation_id, p_body, p_attachments);
  canonical_hash := pg_catalog.md5(canonical::text);
  perform message_send_private.lock_operation(actor_id, p_operation_id);

  select * into operation
  from message_send_private.operations existing
  where existing.sender_user_id_snapshot = actor_id
    and existing.operation_id = p_operation_id
  for update;
  if found and (operation.scrubbed_at is not null
      or operation.replay_expires_at <= pg_catalog.statement_timestamp()) then
    if operation.payload_hash is distinct from canonical_hash then
      raise exception 'message_send_operation_payload_conflict' using errcode = '22023';
    end if;
    raise exception 'message_send_operation_expired' using errcode = '55000';
  end if;
  if found then return; end if;

  select * into tombstone
  from message_send_private.operation_tombstones existing
  where existing.sender_user_id_snapshot = actor_id
    and existing.operation_id = p_operation_id;
  if found then
    if tombstone.payload_hash is distinct from canonical_hash then
      raise exception 'message_send_operation_payload_conflict' using errcode = '22023';
    end if;
    raise exception 'message_send_operation_expired' using errcode = '55000';
  end if;
end
$function$;

alter function message_send_private.assert_operation_replay_available(uuid, uuid, text, jsonb)
  owner to postgres;
revoke all on function message_send_private.assert_operation_replay_available(uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function message_send_private.assert_operation_replay_available(uuid, uuid, text, jsonb)
  to authenticated;

create or replace function message_send_private.reserve_uploads_stage7_impl(
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
begin
  perform message_send_private.assert_operation_replay_available(
    p_operation_id, p_conversation_id, p_body, p_attachments
  );
  return message_send_private.reserve_uploads_impl(
    p_operation_id, p_conversation_id, p_body, p_attachments
  );
end
$function$;

create or replace function message_send_private.send_stage7_impl(
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
begin
  perform message_send_private.assert_operation_replay_available(
    p_operation_id, p_conversation_id, p_body, p_attachments
  );
  return message_send_private.send_impl(
    p_operation_id, p_conversation_id, p_body, p_attachments
  );
end
$function$;

alter function message_send_private.reserve_uploads_stage7_impl(uuid, uuid, text, jsonb)
  owner to postgres;
alter function message_send_private.send_stage7_impl(uuid, uuid, text, jsonb)
  owner to postgres;
revoke all on function message_send_private.reserve_uploads_stage7_impl(uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function message_send_private.send_stage7_impl(uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function message_send_private.reserve_uploads_stage7_impl(uuid, uuid, text, jsonb)
  to authenticated;
grant execute on function message_send_private.send_stage7_impl(uuid, uuid, text, jsonb)
  to authenticated;

create or replace function public.reserve_message_media_uploads_idempotent(
  p_operation_id uuid,
  p_conversation_id uuid,
  p_body text,
  p_attachments jsonb
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
begin atomic
  select message_send_private.reserve_uploads_stage7_impl(
    p_operation_id,
    p_conversation_id,
    p_body,
    p_attachments
  );
end;

create or replace function public.send_conversation_message_idempotent(
  p_operation_id uuid,
  p_conversation_id uuid,
  p_body text,
  p_attachments jsonb
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
begin atomic
  select message_send_private.send_stage7_impl(
    p_operation_id,
    p_conversation_id,
    p_body,
    p_attachments
  );
end;

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
  if found then
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
    if (
      select pg_catalog.count(*)
      from message_send_private.operations existing
      where existing.sender_user_id_snapshot = actor_id
        and existing.status = 'aborted'
        and existing.created_at > pg_catalog.statement_timestamp() - interval '24 hours'
    ) >= 20 then
      raise exception 'message_send_abort_rate_limit' using errcode = '54000';
    end if;
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

alter function message_send_private.abort_impl(uuid, uuid, text, jsonb) owner to postgres;
revoke all on function message_send_private.abort_impl(uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function message_send_private.abort_impl(uuid, uuid, text, jsonb)
  to authenticated;

create or replace function public.abort_message_send_operation(
  p_operation_id uuid,
  p_conversation_id uuid,
  p_body text,
  p_attachments jsonb
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
begin atomic
  select message_send_private.abort_impl(
    p_operation_id,
    p_conversation_id,
    p_body,
    p_attachments
  );
end;

-- ---------------------------------------------------------------------------
-- Report duplicate controls and private command retention
-- ---------------------------------------------------------------------------

alter table report_submission_private.commands
  add column if not exists payload_hash text,
  add column if not exists replay_expires_at timestamptz,
  add column if not exists scrubbed_at timestamptz;

update report_submission_private.commands command
set payload_hash = pg_catalog.md5(command.payload::text),
    replay_expires_at = command.completed_at + interval '7 days'
where command.payload_hash is null or command.replay_expires_at is null;

alter table report_submission_private.commands
  alter column payload_hash set not null,
  alter column replay_expires_at set not null,
  alter column replay_expires_at set default (pg_catalog.statement_timestamp() + interval '7 days');

create or replace function report_submission_private.initialize_stage7_command_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.payload_hash := pg_catalog.md5(new.payload::text);
  new.replay_expires_at := coalesce(
    new.replay_expires_at,
    pg_catalog.statement_timestamp() + interval '7 days'
  );
  return new;
end
$function$;

alter function report_submission_private.initialize_stage7_command_lifecycle()
  owner to postgres;
revoke all on function report_submission_private.initialize_stage7_command_lifecycle()
  from public, anon, authenticated, service_role;

drop trigger if exists initialize_stage7_command_lifecycle
  on report_submission_private.commands;
create trigger initialize_stage7_command_lifecycle
before insert on report_submission_private.commands
for each row execute function report_submission_private.initialize_stage7_command_lifecycle();

create table if not exists report_submission_private.command_tombstones (
  actor_user_id_snapshot uuid not null,
  operation_id uuid not null,
  payload_hash text not null,
  expires_at timestamptz not null,
  primary key (actor_user_id_snapshot, operation_id)
);
create index if not exists report_submission_command_tombstones_expiry_idx
  on report_submission_private.command_tombstones (expires_at);
create index if not exists report_submission_commands_replay_expiry_idx
  on report_submission_private.commands (
    replay_expires_at,
    actor_user_id_snapshot,
    operation_id
  ) where scrubbed_at is null;
create index if not exists reports_actor_created_idx
  on public.reports (reporter_user_id, created_at desc);
create index if not exists reports_actor_subject_open_created_idx
  on public.reports (
    reporter_user_id,
    subject_type,
    subject_id,
    created_at desc
  ) where status = 'open';
alter table report_submission_private.command_tombstones enable row level security;
revoke all on table report_submission_private.command_tombstones
  from public, anon, authenticated, service_role;

create or replace function report_submission_private.assert_operation_replay_available(
  p_subject_type text,
  p_subject_id uuid,
  p_reason text,
  p_details text,
  p_operation_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  canonical jsonb;
  canonical_hash text;
  command_row report_submission_private.commands%rowtype;
  tombstone report_submission_private.command_tombstones%rowtype;
begin
  if actor_id is null or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    raise exception 'report_authentication_required' using errcode = '28000';
  end if;
  canonical := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'subject_type', pg_catalog.lower(pg_catalog.btrim(coalesce(p_subject_type, ''))),
    'subject_id', p_subject_id,
    'reason', pg_catalog.lower(pg_catalog.btrim(coalesce(p_reason, ''))),
    'details', nullif(private.normalize_user_prose(p_details), '')
  ));
  canonical_hash := pg_catalog.md5(canonical::text);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || ':report:' || p_operation_id::text, 0)
  );
  select * into command_row
  from report_submission_private.commands command
  where command.actor_user_id_snapshot = actor_id
    and command.operation_id = p_operation_id
  for update;
  if found and (command_row.scrubbed_at is not null
      or command_row.replay_expires_at <= pg_catalog.statement_timestamp()) then
    if command_row.payload_hash is distinct from canonical_hash then
      raise exception 'report_operation_payload_conflict' using errcode = '22023';
    end if;
    raise exception 'report_operation_expired' using errcode = '55000';
  end if;
  if found then return; end if;
  select * into tombstone
  from report_submission_private.command_tombstones existing
  where existing.actor_user_id_snapshot = actor_id
    and existing.operation_id = p_operation_id;
  if found then
    if tombstone.payload_hash is distinct from canonical_hash then
      raise exception 'report_operation_payload_conflict' using errcode = '22023';
    end if;
    raise exception 'report_operation_expired' using errcode = '55000';
  end if;
end
$function$;

alter function report_submission_private.assert_operation_replay_available(text, uuid, text, text, uuid)
  owner to postgres;
revoke all on function report_submission_private.assert_operation_replay_available(text, uuid, text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function report_submission_private.assert_operation_replay_available(text, uuid, text, text, uuid)
  to authenticated;

create or replace function report_submission_private.submit_marketplace_report_stage7_impl(
  p_subject_type text,
  p_subject_id uuid,
  p_reason text,
  p_details text,
  p_operation_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  perform report_submission_private.assert_operation_replay_available(
    p_subject_type, p_subject_id, p_reason, p_details, p_operation_id
  );
  return report_submission_private.submit_marketplace_report_impl(
    p_subject_type, p_subject_id, p_reason, p_details, p_operation_id
  );
end
$function$;

alter function report_submission_private.submit_marketplace_report_stage7_impl(
  text, uuid, text, text, uuid
) owner to postgres;
revoke all on function report_submission_private.submit_marketplace_report_stage7_impl(
  text, uuid, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function report_submission_private.submit_marketplace_report_stage7_impl(
  text, uuid, text, text, uuid
) to authenticated;

create or replace function public.submit_marketplace_report(
  p_subject_type text,
  p_subject_id uuid,
  p_reason text,
  p_details text,
  p_operation_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
begin atomic
  select report_submission_private.submit_marketplace_report_stage7_impl(
    p_subject_type,
    p_subject_id,
    p_reason,
    p_details,
    p_operation_id
  );
end;

create or replace function private.reject_duplicate_or_excessive_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'stage7-report-actor:' || new.reporter_user_id::text,
      0
    )
  );
  if new.status = 'open' and exists (
    select 1
    from public.reports existing
    where existing.reporter_user_id = new.reporter_user_id
      and existing.subject_type = new.subject_type
      and existing.subject_id = new.subject_id
      and existing.status = 'open'
      and existing.created_at > pg_catalog.statement_timestamp() - interval '24 hours'
  ) then
    raise exception 'report_already_submitted_recently' using errcode = '23505';
  end if;
  if (
    select pg_catalog.count(*)
    from public.reports existing
    where existing.reporter_user_id = new.reporter_user_id
      and existing.created_at > pg_catalog.statement_timestamp() - interval '24 hours'
  ) >= 20 then
    raise exception 'report_submission_rate_limit' using errcode = '54000';
  end if;
  return new;
end
$function$;

alter function private.reject_duplicate_or_excessive_report() owner to postgres;
revoke all on function private.reject_duplicate_or_excessive_report()
  from public, anon, authenticated, service_role;
drop trigger if exists reject_duplicate_or_excessive_report on public.reports;
create trigger reject_duplicate_or_excessive_report
before insert on public.reports
for each row execute function private.reject_duplicate_or_excessive_report();

-- ---------------------------------------------------------------------------
-- Sanction least privilege and issuer hierarchy
-- ---------------------------------------------------------------------------

create or replace function moderation_action_private.enforce_stage7_sanction_boundaries()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_role text;
begin
  if tg_op = 'INSERT'
    and new.sanction_type = 'strike'
    and new.issued_by_role = 'moderator'
    and (new.severity not in ('low', 'medium') or new.strike_points is distinct from 1) then
    raise exception 'moderator_standard_strike_limit' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE'
    and old.issued_by_role = 'admin'
    and (
      new.revoked_at is distinct from old.revoked_at
      or new.review_status is distinct from old.review_status
      or new.reviewed_by_user_id_snapshot is distinct from old.reviewed_by_user_id_snapshot
    ) then
    actor_role := moderation_action_private.resolve_role(auth.uid());
    if actor_role = 'moderator' then
      raise exception 'moderation_sanction_issuer_hierarchy' using errcode = '42501';
    end if;
  end if;
  return new;
end
$function$;

alter function moderation_action_private.enforce_stage7_sanction_boundaries()
  owner to postgres;
revoke all on function moderation_action_private.enforce_stage7_sanction_boundaries()
  from public, anon, authenticated, service_role;
drop trigger if exists enforce_stage7_sanction_boundaries on public.moderation_sanctions;
create trigger enforce_stage7_sanction_boundaries
before insert or update on public.moderation_sanctions
for each row execute function moderation_action_private.enforce_stage7_sanction_boundaries();

-- ---------------------------------------------------------------------------
-- Bounded retention maintenance and account erasure
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
  message_scrubbed integer := 0;
  message_deleted integer := 0;
  report_scrubbed integer := 0;
  report_deleted integer := 0;
begin
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

  perform pg_catalog.set_config('smot.message_send_operation_scope', 'stage7_maintenance', true);
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

alter function private.maintain_stage7_security_ledgers_impl(integer) owner to postgres;
revoke all on function private.maintain_stage7_security_ledgers_impl(integer)
  from public, anon, authenticated, service_role;
grant execute on function private.maintain_stage7_security_ledgers_impl(integer)
  to service_role;

create or replace function public.maintain_stage7_security_ledgers(p_limit integer default 100)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
begin atomic
  select private.maintain_stage7_security_ledgers_impl(p_limit);
end;

alter function public.maintain_stage7_security_ledgers(integer) owner to postgres;
revoke all on function public.maintain_stage7_security_ledgers(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.maintain_stage7_security_ledgers(integer)
  to service_role;

create or replace function private.purge_stage7_user_security_data_impl(p_user_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' or p_user_id is null then
    raise exception 'stage7_account_cleanup_service_required' using errcode = '42501';
  end if;
  perform pg_catalog.set_config('smot.message_send_operation_scope', 'stage7_maintenance', true);
  delete from private.message_media_upload_reservations reservation
  where reservation.user_id = p_user_id;
  delete from message_send_private.operations operation
  where operation.sender_user_id_snapshot = p_user_id;
  perform pg_catalog.set_config('smot.message_send_operation_scope', '', true);
  delete from message_send_private.operation_tombstones tombstone
  where tombstone.sender_user_id_snapshot = p_user_id;
  delete from report_submission_private.commands command
  where command.actor_user_id_snapshot = p_user_id;
  delete from report_submission_private.command_tombstones tombstone
  where tombstone.actor_user_id_snapshot = p_user_id;
  return true;
exception when others then
  perform pg_catalog.set_config('smot.message_send_operation_scope', '', true);
  raise;
end
$function$;

alter function private.purge_stage7_user_security_data_impl(uuid) owner to postgres;
revoke all on function private.purge_stage7_user_security_data_impl(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.purge_stage7_user_security_data_impl(uuid)
  to service_role;

create or replace function public.purge_stage7_user_security_data(p_user_id uuid)
returns boolean
language sql
volatile
security invoker
set search_path = ''
begin atomic
  select private.purge_stage7_user_security_data_impl(p_user_id);
end;

alter function public.purge_stage7_user_security_data(uuid) owner to postgres;
revoke all on function public.purge_stage7_user_security_data(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.purge_stage7_user_security_data(uuid)
  to service_role;

-- Retire the deployed legacy non-idempotent two-argument message writer without
-- assuming that every reconstructed environment contains that overload.
do $migration$
begin
  if pg_catalog.to_regprocedure('public.send_conversation_message(uuid,text)') is not null then
    revoke execute on function public.send_conversation_message(uuid, text)
      from public, anon, authenticated, service_role;
  end if;
end
$migration$;

-- Reassert the intended public boundaries after replacing their definitions.
revoke all on function public.reserve_message_media_uploads_idempotent(uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.send_conversation_message_idempotent(uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.abort_message_send_operation(uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.submit_marketplace_report(text, uuid, text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_message_media_uploads_idempotent(uuid, uuid, text, jsonb)
  to authenticated;
grant execute on function public.send_conversation_message_idempotent(uuid, uuid, text, jsonb)
  to authenticated;
grant execute on function public.abort_message_send_operation(uuid, uuid, text, jsonb)
  to authenticated;
grant execute on function public.submit_marketplace_report(text, uuid, text, text, uuid)
  to authenticated;

comment on function public.maintain_stage7_security_ledgers(integer) is
  'Service-only bounded scrub, tombstone, and purge lifecycle for message and report idempotency data.';
comment on function public.purge_stage7_user_security_data(uuid) is
  'Service-only account-erasure boundary for private Stage 7 message and report command data.';
