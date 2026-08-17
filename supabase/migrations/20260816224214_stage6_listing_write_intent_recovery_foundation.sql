-- Stage 6 durable listing-write recovery foundation.
--
-- The prior required-field migration intentionally preserves the deployed
-- direct-write compatibility surface. This later additive migration gives the
-- Stage 6 application a durable, actor-scoped command lifecycle for browser
-- reloads, ambiguous responses, staged Storage uploads, post-commit cleanup,
-- and account deletion. A later cutover may revoke the legacy surface only
-- after this application contract is deployed.

alter table listing_action_private.write_command_results
  add column if not exists replay_expires_at timestamptz
    not null default (pg_catalog.statement_timestamp() + interval '7 days'),
  add column if not exists scrubbed_at timestamptz,
  add column if not exists payload_hash text not null default '',
  add column if not exists result_hash text not null default '';

create index if not exists listing_write_commands_replay_expiry_idx
  on listing_action_private.write_command_results
    (replay_expires_at, actor_user_id, operation_id);

create or replace function listing_action_private.freeze_listing_command_hashes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    new.payload_hash := pg_catalog.md5(new.payload::text);
    new.result_hash := pg_catalog.md5(new.result::text);
  else
    new.payload_hash := old.payload_hash;
    new.result_hash := old.result_hash;
  end if;
  return new;
end
$function$;

alter function listing_action_private.freeze_listing_command_hashes() owner to postgres;
revoke all on function listing_action_private.freeze_listing_command_hashes()
  from public, anon, authenticated, service_role;

update listing_action_private.write_command_results
set payload_hash = pg_catalog.md5(payload::text),
    result_hash = pg_catalog.md5(result::text)
where payload_hash = '' or result_hash = '';

drop trigger if exists freeze_listing_command_hashes
  on listing_action_private.write_command_results;
create trigger freeze_listing_command_hashes
before insert or update on listing_action_private.write_command_results
for each row execute function listing_action_private.freeze_listing_command_hashes();

create table listing_action_private.write_intents (
  actor_user_id uuid not null,
  operation_id uuid not null,
  action text not null,
  signature_hash text not null,
  request_listing_id uuid,
  request_expected_content_revision bigint,
  listing_id uuid,
  expected_content_revision bigint,
  is_publishing boolean not null default false,
  state text not null default 'begun',
  stage text not null default 'begun',
  safe_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  updated_at timestamptz not null default pg_catalog.statement_timestamp(),
  terminal_at timestamptz,
  cleanup_completed_at timestamptz,
  replay_expires_at timestamptz not null
    default (pg_catalog.statement_timestamp() + interval '7 days'),
  scrubbed_at timestamptz,
  primary key (actor_user_id, operation_id),
  constraint listing_write_intent_action check (
    action in ('create_listing', 'edit_listing', 'retire_listing')
  ),
  constraint listing_write_intent_signature check (
    signature_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint listing_write_intent_revision check (
    (expected_content_revision is null or expected_content_revision > 0)
    and (request_expected_content_revision is null
      or request_expected_content_revision > 0)
  ),
  constraint listing_write_intent_request_shape check (
    (action = 'create_listing' and request_listing_id is null
      and request_expected_content_revision is null)
    or (action <> 'create_listing' and request_listing_id is not null
      and request_expected_content_revision is not null)
  ),
  constraint listing_write_intent_state check (
    state in ('begun', 'in_progress', 'committed', 'aborted', 'cleanup_pending')
  ),
  constraint listing_write_intent_stage check (
    stage in ('begun', 'draft_created', 'uploads_reserved', 'committed', 'aborted')
  ),
  constraint listing_write_intent_result check (
    pg_catalog.jsonb_typeof(safe_result) = 'object'
  ),
  constraint listing_write_intent_terminal_pair check (
    (state in ('committed', 'aborted', 'cleanup_pending') and terminal_at is not null)
    or (state in ('begun', 'in_progress') and terminal_at is null)
  )
);

create index listing_write_intents_actor_updated_idx
  on listing_action_private.write_intents
    (actor_user_id, updated_at desc, operation_id);
create index listing_write_intents_maintenance_idx
  on listing_action_private.write_intents
    (state, replay_expires_at, actor_user_id, operation_id);

create table listing_action_private.image_upload_reservations (
  storage_path text not null,
  actor_user_id_snapshot uuid not null,
  operation_id uuid not null,
  listing_id_snapshot uuid not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  state text not null default 'reserved',
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  expires_at timestamptz not null
    default (pg_catalog.statement_timestamp() + interval '24 hours'),
  consumed_at timestamptz,
  cleaned_at timestamptz,
  primary key (storage_path),
  unique (actor_user_id_snapshot, operation_id, storage_path),
  foreign key (actor_user_id_snapshot, operation_id)
    references listing_action_private.write_intents(actor_user_id, operation_id)
    on delete restrict,
  constraint listing_image_reservation_path_bound
    check (pg_catalog.char_length(storage_path) between 1 and 1024),
  constraint listing_image_reservation_name_bound
    check (pg_catalog.char_length(file_name) between 1 and 180),
  constraint listing_image_reservation_mime
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint listing_image_reservation_size
    check (size_bytes between 1 and 5242880),
  constraint listing_image_reservation_state
    check (state in ('reserved', 'consumed', 'cleanup_pending', 'cleaned')),
  constraint listing_image_reservation_lifecycle check (
    (state = 'reserved' and consumed_at is null and cleaned_at is null)
    or (state = 'consumed' and consumed_at is not null and cleaned_at is null)
    or (state = 'cleanup_pending' and cleaned_at is null)
    or (state = 'cleaned' and cleaned_at is not null)
  )
);

create index listing_image_reservations_actor_state_idx
  on listing_action_private.image_upload_reservations
    (actor_user_id_snapshot, state, expires_at, storage_path);

create table listing_action_private.image_cleanup_tasks (
  id uuid primary key default gen_random_uuid(),
  actor_user_id_snapshot uuid,
  listing_id_snapshot uuid,
  source_operation_id uuid,
  storage_path text not null unique,
  reason text not null,
  state text not null default 'pending',
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  available_at timestamptz not null default pg_catalog.statement_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  completion_token uuid,
  cleaned_at timestamptz,
  constraint listing_image_cleanup_reason check (
    reason in ('abandoned_upload', 'edit_removed', 'listing_retired', 'account_deleted')
  ),
  constraint listing_image_cleanup_state check (
    state in ('pending', 'leased', 'cleaned')
  ),
  constraint listing_image_cleanup_lease_pair check (
    (state = 'leased' and lease_token is not null
      and lease_expires_at is not null and completion_token is null
      and cleaned_at is null)
    or (state = 'pending' and lease_token is null
      and lease_expires_at is null and completion_token is null
      and cleaned_at is null)
    or (state = 'cleaned' and lease_token is null
      and lease_expires_at is null and completion_token is not null
      and cleaned_at is not null)
  )
);

create index listing_image_cleanup_actor_state_idx
  on listing_action_private.image_cleanup_tasks
    (actor_user_id_snapshot, state, available_at, id);
create index listing_image_cleanup_service_claim_idx
  on listing_action_private.image_cleanup_tasks
    (state, available_at, lease_expires_at, id);

-- Cleanup paths are unique, but a previously cleaned object can be recreated
-- by an exact retry or discovered during account retirement. Re-arm that same
-- durable row while holding its conflict-row lock instead of silently keeping
-- the stale terminal state through `ON CONFLICT DO NOTHING` call sites.
create or replace function listing_action_private.rearm_listing_image_cleanup_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare existing_task listing_action_private.image_cleanup_tasks%rowtype;
begin
  select * into existing_task
  from listing_action_private.image_cleanup_tasks task
  where task.storage_path = new.storage_path
  for update;
  if not found then
    return new;
  end if;
  if existing_task.state = 'cleaned' then
    update listing_action_private.image_cleanup_tasks task
    set actor_user_id_snapshot = new.actor_user_id_snapshot,
        listing_id_snapshot = new.listing_id_snapshot,
        source_operation_id = new.source_operation_id,
        reason = new.reason,
        state = 'pending',
        created_at = pg_catalog.statement_timestamp(),
        available_at = pg_catalog.statement_timestamp(),
        lease_token = null,
        lease_expires_at = null,
        completion_token = null,
        cleaned_at = null
    where task.id = existing_task.id;
  end if;
  return null;
end
$function$;

alter function listing_action_private.rearm_listing_image_cleanup_task()
  owner to postgres;
revoke all on function listing_action_private.rearm_listing_image_cleanup_task()
  from public, anon, authenticated, service_role;

create trigger rearm_listing_image_cleanup_task
before insert on listing_action_private.image_cleanup_tasks
for each row execute function listing_action_private.rearm_listing_image_cleanup_task();

create table listing_action_private.write_intent_tombstones (
  actor_user_id_snapshot uuid not null,
  operation_id uuid not null,
  action text not null,
  signature_hash text not null,
  terminal_state text not null,
  payload_hash text not null,
  result_hash text not null,
  completed_at timestamptz not null,
  scrubbed_at timestamptz not null default pg_catalog.statement_timestamp(),
  primary key (actor_user_id_snapshot, operation_id),
  constraint listing_write_tombstone_terminal
    check (terminal_state in ('committed', 'aborted'))
);

create table listing_action_private.account_retirements (
  actor_user_id_snapshot uuid primary key,
  operation_id uuid not null,
  state text not null default 'cleanup_pending',
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  updated_at timestamptz not null default pg_catalog.statement_timestamp(),
  completed_at timestamptz,
  constraint listing_account_retirement_state
    check (state in ('cleanup_pending', 'complete')),
  constraint listing_account_retirement_completed_pair check (
    (state = 'complete' and completed_at is not null)
    or (state = 'cleanup_pending' and completed_at is null)
  )
);

alter table listing_action_private.write_intents owner to postgres;
alter table listing_action_private.image_upload_reservations owner to postgres;
alter table listing_action_private.image_cleanup_tasks owner to postgres;
alter table listing_action_private.write_intent_tombstones owner to postgres;
alter table listing_action_private.account_retirements owner to postgres;
revoke all on table listing_action_private.write_intents
  from public, anon, authenticated, service_role;
revoke all on table listing_action_private.image_upload_reservations
  from public, anon, authenticated, service_role;
revoke all on table listing_action_private.image_cleanup_tasks
  from public, anon, authenticated, service_role;
revoke all on table listing_action_private.write_intent_tombstones
  from public, anon, authenticated, service_role;
revoke all on table listing_action_private.account_retirements
  from public, anon, authenticated, service_role;

-- Serialize Storage uploads with account retirement on the same actor barrier.
-- A request that reached Storage before retirement either commits first and is
-- included in retirement cleanup, or waits until the durable barrier exists
-- and then fails. This also blocks overwrite/upsert attempts after retirement.
create or replace function listing_action_private.guard_retiring_listing_image_upload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid;
  actor_segment text;
begin
  if new.bucket_id <> 'listing-images' then
    return new;
  end if;
  actor_segment := pg_catalog.split_part(new.name, '/', 1);
  if actor_segment !~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
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
    raise exception using
      errcode = '42501', message = 'listing_account_retirement_in_progress';
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
before insert or update of bucket_id, name on storage.objects
for each row execute function
  listing_action_private.guard_retiring_listing_image_upload();

create or replace function listing_action_private.require_listing_write_actor()
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  jwt_role text := coalesce(auth.jwt() ->> 'role', '');
  auth_banned_until timestamptz;
  status_row public.user_status%rowtype;
begin
  if jwt_role <> 'authenticated' or actor_id is null then
    raise exception using errcode = '42501', message = 'listing_authentication_required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('listing-write-actor:' || actor_id::text, 0)
  );
  select account.banned_until into auth_banned_until
  from auth.users account
  where account.id = actor_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'listing_authentication_required';
  end if;
  if auth_banned_until is not null
    and auth_banned_until > pg_catalog.statement_timestamp() then
    raise exception using errcode = '42501', message = 'listing_actor_is_banned';
  end if;

  select * into status_row
  from public.user_status status
  where status.user_id = actor_id
  for update;
  if found and status_row.is_banned
    and (status_row.banned_until is null
      or status_row.banned_until > pg_catalog.statement_timestamp()) then
    raise exception using errcode = '42501', message = 'listing_actor_is_banned';
  end if;
  if exists (
    select 1 from listing_action_private.account_retirements retirement
    where retirement.actor_user_id_snapshot = actor_id
  ) then
    raise exception using
      errcode = '42501', message = 'listing_account_retirement_in_progress';
  end if;
  return actor_id;
end
$function$;

alter function listing_action_private.require_listing_write_actor() owner to postgres;
revoke all on function listing_action_private.require_listing_write_actor()
  from public, anon, authenticated, service_role;
grant execute on function listing_action_private.require_listing_write_actor()
  to authenticated;

create or replace function listing_action_private.safe_listing_write_intent_result(
  p_intent listing_action_private.write_intents
)
returns jsonb
language sql
stable
security definer
set search_path = ''
begin atomic
  select pg_catalog.jsonb_build_object(
    'operation_id', p_intent.operation_id,
    'action', p_intent.action,
    'state', p_intent.state,
    'stage', p_intent.stage,
    'listing_id', p_intent.listing_id,
    'is_publishing', p_intent.is_publishing,
    'updated_at', p_intent.updated_at,
    'cleanup_pending', exists (
      select 1
      from listing_action_private.image_cleanup_tasks task
      where task.actor_user_id_snapshot = p_intent.actor_user_id
        and task.source_operation_id = p_intent.operation_id
        and task.state <> 'cleaned'
    ),
    'result', case when p_intent.scrubbed_at is null
      then p_intent.safe_result else '{}'::jsonb end
  );
end;

alter function listing_action_private.safe_listing_write_intent_result(
  listing_action_private.write_intents
) owner to postgres;
revoke all on function listing_action_private.safe_listing_write_intent_result(
  listing_action_private.write_intents
) from public, anon, authenticated, service_role;
grant execute on function listing_action_private.safe_listing_write_intent_result(
  listing_action_private.write_intents
) to authenticated;

create or replace function listing_action_private.begin_owned_listing_write_intent_impl(
  p_operation_id uuid,
  p_action text,
  p_signature_hash text,
  p_listing_id uuid default null,
  p_expected_content_revision bigint default null,
  p_is_publishing boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := listing_action_private.require_listing_write_actor();
  intent_row listing_action_private.write_intents%rowtype;
  listing_row public.listings%rowtype;
begin
  if p_operation_id is null
    or p_action not in ('create_listing', 'edit_listing', 'retire_listing')
    or p_signature_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'listing_write_intent_invalid';
  end if;
  if (p_action = 'create_listing' and (
      p_listing_id is not null or p_expected_content_revision is not null
    )) or (p_action <> 'create_listing' and (
      p_listing_id is null or p_expected_content_revision is null
      or p_expected_content_revision < 1
    )) then
    raise exception using errcode = '22023', message = 'listing_write_intent_invalid';
  end if;

  select * into intent_row
  from listing_action_private.write_intents intent
  where intent.actor_user_id = actor_id
    and intent.operation_id = p_operation_id
  for update;
  if found then
    if intent_row.action is distinct from p_action
      or intent_row.signature_hash is distinct from p_signature_hash
      or intent_row.request_listing_id is distinct from p_listing_id
      or intent_row.request_expected_content_revision
        is distinct from p_expected_content_revision
      or intent_row.is_publishing is distinct from coalesce(p_is_publishing, false) then
      raise exception using
        errcode = '22023', message = 'listing_operation_payload_conflict';
    end if;
    return listing_action_private.safe_listing_write_intent_result(intent_row);
  end if;

  if exists (
    select 1
    from listing_action_private.write_intent_tombstones tombstone
    where tombstone.actor_user_id_snapshot = actor_id
      and tombstone.operation_id = p_operation_id
  ) then
    raise exception using errcode = '22023', message = 'listing_operation_expired';
  end if;

  insert into listing_action_private.write_intents(
    actor_user_id, operation_id, action, signature_hash,
    request_listing_id, request_expected_content_revision,
    listing_id, expected_content_revision, is_publishing
  ) values (
    actor_id, p_operation_id, p_action, p_signature_hash,
    p_listing_id, p_expected_content_revision,
    p_listing_id, p_expected_content_revision, coalesce(p_is_publishing, false)
  ) returning * into intent_row;

  if p_action <> 'create_listing' then
    select * into listing_row
    from public.listings listing
    where listing.id = p_listing_id
    for update;
    if not found or listing_row.seller_id is distinct from actor_id then
      raise exception using errcode = '42501', message = 'listing_owner_mismatch';
    end if;
    if listing_row.retired_at is not null then
      raise exception using errcode = 'P0001', message = 'listing_is_retired';
    end if;
    if listing_row.content_revision is distinct from p_expected_content_revision then
      raise exception using errcode = '40001', message = 'listing_review_revision_conflict';
    end if;
  end if;

  return listing_action_private.safe_listing_write_intent_result(intent_row);
end
$function$;

alter function listing_action_private.begin_owned_listing_write_intent_impl(
  uuid, text, text, uuid, bigint, boolean
) owner to postgres;
revoke all on function listing_action_private.begin_owned_listing_write_intent_impl(
  uuid, text, text, uuid, bigint, boolean
) from public, anon, authenticated, service_role;
grant execute on function listing_action_private.begin_owned_listing_write_intent_impl(
  uuid, text, text, uuid, bigint, boolean
) to authenticated;

create or replace function public.begin_owned_listing_write_intent(
  p_operation_id uuid,
  p_action text,
  p_signature_hash text,
  p_listing_id uuid default null,
  p_expected_content_revision bigint default null,
  p_is_publishing boolean default false
)
returns jsonb
language sql
security invoker
set search_path = ''
begin atomic
  select listing_action_private.begin_owned_listing_write_intent_impl(
    p_operation_id, p_action, p_signature_hash, p_listing_id,
    p_expected_content_revision, p_is_publishing
  );
end;

alter function public.begin_owned_listing_write_intent(
  uuid, text, text, uuid, bigint, boolean
) owner to postgres;
revoke all on function public.begin_owned_listing_write_intent(
  uuid, text, text, uuid, bigint, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.begin_owned_listing_write_intent(
  uuid, text, text, uuid, bigint, boolean
) to authenticated;

create or replace function listing_action_private.list_owned_listing_write_intents_impl(
  p_limit integer default 20
)
returns setof jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare actor_id uuid := listing_action_private.require_listing_write_actor();
begin
  if p_limit not between 1 and 20 then
    raise exception using errcode = '22023', message = 'listing_write_intent_limit_invalid';
  end if;
  return query
  select listing_action_private.safe_listing_write_intent_result(intent)
  from listing_action_private.write_intents intent
  where intent.actor_user_id = actor_id
    and (
      intent.state in ('begun', 'in_progress', 'cleanup_pending')
      or exists (
        select 1 from listing_action_private.image_cleanup_tasks task
        where task.actor_user_id_snapshot = actor_id
          and task.source_operation_id = intent.operation_id
          and task.state <> 'cleaned'
      )
    )
  order by intent.updated_at desc, intent.operation_id
  limit p_limit;
end
$function$;

alter function listing_action_private.list_owned_listing_write_intents_impl(integer)
  owner to postgres;
revoke all on function listing_action_private.list_owned_listing_write_intents_impl(integer)
  from public, anon, authenticated, service_role;
grant execute on function listing_action_private.list_owned_listing_write_intents_impl(integer)
  to authenticated;

create or replace function public.list_owned_listing_write_intents(
  p_limit integer default 20
)
returns setof jsonb
language sql
security invoker
set search_path = ''
begin atomic
  select *
  from listing_action_private.list_owned_listing_write_intents_impl(p_limit);
end;

alter function public.list_owned_listing_write_intents(integer) owner to postgres;
revoke all on function public.list_owned_listing_write_intents(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_owned_listing_write_intents(integer)
  to authenticated;

create or replace function listing_action_private.get_owned_listing_write_intent_impl(
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := listing_action_private.require_listing_write_actor();
  intent_row listing_action_private.write_intents%rowtype;
begin
  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'listing_write_intent_invalid';
  end if;
  select * into intent_row
  from listing_action_private.write_intents intent
  where intent.actor_user_id = actor_id
    and intent.operation_id = p_operation_id;
  if not found then
    return null;
  end if;
  return listing_action_private.safe_listing_write_intent_result(intent_row);
end
$function$;

alter function listing_action_private.get_owned_listing_write_intent_impl(uuid)
  owner to postgres;
revoke all on function listing_action_private.get_owned_listing_write_intent_impl(uuid)
  from public, anon, authenticated, service_role;
grant execute on function listing_action_private.get_owned_listing_write_intent_impl(uuid)
  to authenticated;

create or replace function public.get_owned_listing_write_intent(
  p_operation_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
begin atomic
  select listing_action_private.get_owned_listing_write_intent_impl(p_operation_id);
end;

alter function public.get_owned_listing_write_intent(uuid) owner to postgres;
revoke all on function public.get_owned_listing_write_intent(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_owned_listing_write_intent(uuid)
  to authenticated;

create or replace function listing_action_private.commit_owned_listing_create_draft_intent_impl(
  p_operation_id uuid,
  p_signature_hash text,
  p_title text,
  p_description text default null,
  p_price numeric default null,
  p_category text default null,
  p_condition text default null,
  p_location text default null,
  p_is_negotiable boolean default false
)
returns setof public.listings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := listing_action_private.require_listing_write_actor();
  intent_row listing_action_private.write_intents%rowtype;
  listing_row public.listings%rowtype;
begin
  select * into intent_row
  from listing_action_private.write_intents intent
  where intent.actor_user_id = actor_id
    and intent.operation_id = p_operation_id
  for update;
  if not found
    or intent_row.action <> 'create_listing'
    or intent_row.signature_hash is distinct from p_signature_hash then
    raise exception using errcode = '22023', message = 'listing_write_intent_conflict';
  end if;
  if intent_row.state in ('aborted', 'cleanup_pending') then
    raise exception using errcode = '55000', message = 'listing_write_intent_not_active';
  end if;
  if intent_row.listing_id is not null then
    select * into listing_row
    from public.listings listing
    where listing.id = intent_row.listing_id
      and listing.seller_id = actor_id;
    if not found then
      raise exception using errcode = '55000', message = 'listing_write_intent_result_unavailable';
    end if;
    return query select listing_row.*;
    return;
  end if;

  select * into listing_row
  from listing_action_private.save_owned_listing_draft_impl(
    p_title, null, null, p_description, p_price, p_category,
    p_condition, p_location, p_is_negotiable
  );
  update listing_action_private.write_intents intent
  set listing_id = listing_row.id,
      expected_content_revision = listing_row.content_revision,
      state = 'in_progress',
      stage = 'draft_created',
      safe_result = pg_catalog.jsonb_build_object(
        'listing_id', listing_row.id,
        'content_revision', listing_row.content_revision,
        'status', listing_row.status,
        'slug', listing_row.slug
      ),
      updated_at = pg_catalog.statement_timestamp()
  where intent.actor_user_id = actor_id
    and intent.operation_id = p_operation_id;
  return query select listing_row.*;
end
$function$;

alter function listing_action_private.commit_owned_listing_create_draft_intent_impl(
  uuid, text, text, text, numeric, text, text, text, boolean
) owner to postgres;
revoke all on function listing_action_private.commit_owned_listing_create_draft_intent_impl(
  uuid, text, text, text, numeric, text, text, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function listing_action_private.commit_owned_listing_create_draft_intent_impl(
  uuid, text, text, text, numeric, text, text, text, boolean
) to authenticated;

create or replace function public.commit_owned_listing_create_draft_intent(
  p_operation_id uuid,
  p_signature_hash text,
  p_title text,
  p_description text default null,
  p_price numeric default null,
  p_category text default null,
  p_condition text default null,
  p_location text default null,
  p_is_negotiable boolean default false
)
returns setof public.listings
language sql
security invoker
set search_path = ''
begin atomic
  select *
  from listing_action_private.commit_owned_listing_create_draft_intent_impl(
    p_operation_id, p_signature_hash, p_title, p_description, p_price,
    p_category, p_condition, p_location, p_is_negotiable
  );
end;

alter function public.commit_owned_listing_create_draft_intent(
  uuid, text, text, text, numeric, text, text, text, boolean
) owner to postgres;
revoke all on function public.commit_owned_listing_create_draft_intent(
  uuid, text, text, text, numeric, text, text, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.commit_owned_listing_create_draft_intent(
  uuid, text, text, text, numeric, text, text, text, boolean
) to authenticated;

create or replace function listing_action_private.reserve_owned_listing_image_uploads_impl(
  p_operation_id uuid,
  p_signature_hash text,
  p_listing_id uuid,
  p_images jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := listing_action_private.require_listing_write_actor();
  intent_row listing_action_private.write_intents%rowtype;
  item jsonb;
  item_path text;
  item_name text;
  item_mime text;
  item_size bigint;
  image_count integer;
  requested_bytes bigint := 0;
  canonical jsonb := '[]'::jsonb;
begin
  if pg_catalog.jsonb_typeof(p_images) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'listing_image_reservation_invalid';
  end if;
  image_count := pg_catalog.jsonb_array_length(p_images);
  if image_count not between 1 and 10 then
    raise exception using errcode = '23514', message = 'listing_image_limit_exceeded';
  end if;

  select * into intent_row
  from listing_action_private.write_intents intent
  where intent.actor_user_id = actor_id
    and intent.operation_id = p_operation_id
  for update;
  if not found
    or intent_row.signature_hash is distinct from p_signature_hash
    or intent_row.listing_id is distinct from p_listing_id
    or intent_row.state not in ('begun', 'in_progress') then
    raise exception using errcode = '22023', message = 'listing_write_intent_conflict';
  end if;

  for item in
    select value from pg_catalog.jsonb_array_elements(p_images)
  loop
    item_path := item ->> 'storage_path';
    item_name := private.normalize_listing_write_text(item ->> 'file_name');
    item_mime := pg_catalog.lower(
      private.normalize_listing_write_text(item ->> 'mime_type')
    );
    if coalesce(item ->> 'size_bytes', '') !~ '^[0-9]+$' then
      raise exception using errcode = '22023', message = 'listing_image_size_invalid';
    end if;
    item_size := (item ->> 'size_bytes')::bigint;
    if item_path is null
      or pg_catalog.array_length(
        pg_catalog.string_to_array(item_path, '/'), 1
      ) is distinct from 3
      or pg_catalog.split_part(item_path, '/', 1) <> actor_id::text
      or pg_catalog.split_part(item_path, '/', 2) <> p_listing_id::text
      or pg_catalog.split_part(item_path, '/', 3) in ('', '.', '..')
      or pg_catalog.strpos(item_path, pg_catalog.chr(92)) > 0
      or pg_catalog.strpos(item_path, '%') > 0
      or pg_catalog.strpos(item_path, '?') > 0
      or pg_catalog.strpos(item_path, '#') > 0
      or pg_catalog.char_length(item_name) not between 1 and 180
      or item_mime not in ('image/jpeg', 'image/png', 'image/webp')
      or item_size not between 1 and 5242880 then
      raise exception using errcode = '23514', message = 'listing_image_reservation_invalid';
    end if;
    requested_bytes := requested_bytes + item_size;
    canonical := canonical || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'storage_path', item_path,
        'file_name', item_name,
        'mime_type', item_mime,
        'size_bytes', item_size
      )
    );
  end loop;

  if image_count <> (
    select pg_catalog.count(distinct value ->> 'storage_path')
    from pg_catalog.jsonb_array_elements(canonical)
  ) then
    raise exception using errcode = '23505', message = 'listing_image_paths_must_be_unique';
  end if;

  perform reservation.storage_path
  from listing_action_private.image_upload_reservations reservation
  where reservation.actor_user_id_snapshot = actor_id
    and reservation.operation_id = p_operation_id
  order by reservation.storage_path
  for update;
  if found then
    if exists (
      (select reservation.storage_path, reservation.file_name,
          reservation.mime_type, reservation.size_bytes
       from listing_action_private.image_upload_reservations reservation
       where reservation.actor_user_id_snapshot = actor_id
         and reservation.operation_id = p_operation_id)
      except
      (select value ->> 'storage_path', value ->> 'file_name',
          value ->> 'mime_type', (value ->> 'size_bytes')::bigint
       from pg_catalog.jsonb_array_elements(canonical))
    ) or exists (
      (select value ->> 'storage_path', value ->> 'file_name',
          value ->> 'mime_type', (value ->> 'size_bytes')::bigint
       from pg_catalog.jsonb_array_elements(canonical))
      except
      (select reservation.storage_path, reservation.file_name,
          reservation.mime_type, reservation.size_bytes
       from listing_action_private.image_upload_reservations reservation
       where reservation.actor_user_id_snapshot = actor_id
         and reservation.operation_id = p_operation_id)
    ) then
      raise exception using errcode = '22023', message = 'listing_operation_payload_conflict';
    end if;
    return canonical;
  end if;

  if (
    select pg_catalog.count(*)
    from listing_action_private.image_upload_reservations reservation
    where reservation.actor_user_id_snapshot = actor_id
      and reservation.state in ('reserved', 'cleanup_pending')
  ) + image_count > 20
  or (
    select coalesce(pg_catalog.sum(reservation.size_bytes), 0)
    from listing_action_private.image_upload_reservations reservation
    where reservation.actor_user_id_snapshot = actor_id
      and reservation.state in ('reserved', 'cleanup_pending')
  ) + requested_bytes > 104857600 then
    raise exception using
      errcode = '54000', message = 'listing_image_reservation_quota_exceeded';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(canonical) value
    where exists (
      select 1 from storage.objects object
      where object.bucket_id = 'listing-images'
        and object.name = value ->> 'storage_path'
    ) or exists (
      select 1 from public.listing_images image
      where image.storage_path = value ->> 'storage_path'
    )
  ) then
    raise exception using errcode = '23505', message = 'listing_image_path_already_in_use';
  end if;

  insert into listing_action_private.image_upload_reservations(
    storage_path, actor_user_id_snapshot, operation_id, listing_id_snapshot,
    file_name, mime_type, size_bytes
  )
  select value ->> 'storage_path', actor_id, p_operation_id, p_listing_id,
      value ->> 'file_name', value ->> 'mime_type',
      (value ->> 'size_bytes')::bigint
  from pg_catalog.jsonb_array_elements(canonical) value;

  update listing_action_private.write_intents intent
  set stage = 'uploads_reserved',
      updated_at = pg_catalog.statement_timestamp()
  where intent.actor_user_id = actor_id
    and intent.operation_id = p_operation_id;
  return canonical;
end
$function$;

alter function listing_action_private.reserve_owned_listing_image_uploads_impl(
  uuid, text, uuid, jsonb
) owner to postgres;
revoke all on function listing_action_private.reserve_owned_listing_image_uploads_impl(
  uuid, text, uuid, jsonb
) from public, anon, authenticated, service_role;
grant execute on function listing_action_private.reserve_owned_listing_image_uploads_impl(
  uuid, text, uuid, jsonb
) to authenticated;

create or replace function public.reserve_owned_listing_image_uploads(
  p_operation_id uuid,
  p_signature_hash text,
  p_listing_id uuid,
  p_images jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
begin atomic
  select listing_action_private.reserve_owned_listing_image_uploads_impl(
    p_operation_id, p_signature_hash, p_listing_id, p_images
  );
end;

alter function public.reserve_owned_listing_image_uploads(
  uuid, text, uuid, jsonb
) owner to postgres;
revoke all on function public.reserve_owned_listing_image_uploads(
  uuid, text, uuid, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.reserve_owned_listing_image_uploads(
  uuid, text, uuid, jsonb
) to authenticated;

-- A browser reload or second tab can retry an upload after Storage committed
-- the object but its HTTP response was lost. Accept a 409 only after this
-- actor-scoped proof locks the exact active reservation and confirms the exact
-- listing-images object is owned by the same authenticated actor.
create or replace function listing_action_private.verify_owned_listing_reserved_upload_impl(
  p_operation_id uuid,
  p_signature_hash text,
  p_storage_path text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := listing_action_private.require_listing_write_actor();
  intent_row listing_action_private.write_intents%rowtype;
  reservation_row listing_action_private.image_upload_reservations%rowtype;
begin
  if p_operation_id is null
    or p_signature_hash !~ '^[0-9a-f]{64}$'
    or p_storage_path is null
    or pg_catalog.char_length(p_storage_path) not between 1 and 1024 then
    raise exception using errcode = '22023', message = 'listing_image_reservation_invalid';
  end if;
  select * into intent_row
  from listing_action_private.write_intents intent
  where intent.actor_user_id = actor_id
    and intent.operation_id = p_operation_id
  for update;
  if not found
    or intent_row.signature_hash is distinct from p_signature_hash
    or intent_row.state not in ('begun', 'in_progress') then
    raise exception using errcode = '22023', message = 'listing_write_intent_conflict';
  end if;
  select * into reservation_row
  from listing_action_private.image_upload_reservations reservation
  where reservation.actor_user_id_snapshot = actor_id
    and reservation.operation_id = p_operation_id
    and reservation.storage_path = p_storage_path
  for update;
  if not found
    or reservation_row.listing_id_snapshot is distinct from intent_row.listing_id
    or reservation_row.state <> 'reserved'
    or reservation_row.expires_at <= pg_catalog.statement_timestamp() then
    raise exception using errcode = '55000', message = 'listing_image_reservation_required';
  end if;
  perform object.name
  from storage.objects object
  where object.bucket_id = 'listing-images'
    and object.name = p_storage_path
    and object.owner_id = actor_id::text
  for key share;
  if not found then
    raise exception using errcode = '55000', message = 'listing_reserved_upload_unverified';
  end if;
  return true;
end
$function$;

alter function listing_action_private.verify_owned_listing_reserved_upload_impl(
  uuid, text, text
) owner to postgres;
revoke all on function listing_action_private.verify_owned_listing_reserved_upload_impl(
  uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function listing_action_private.verify_owned_listing_reserved_upload_impl(
  uuid, text, text
) to authenticated;

create or replace function public.verify_owned_listing_reserved_upload(
  p_operation_id uuid,
  p_signature_hash text,
  p_storage_path text
)
returns boolean
language sql
security invoker
set search_path = ''
begin atomic
  select listing_action_private.verify_owned_listing_reserved_upload_impl(
    p_operation_id, p_signature_hash, p_storage_path
  );
end;

alter function public.verify_owned_listing_reserved_upload(uuid, text, text)
  owner to postgres;
revoke all on function public.verify_owned_listing_reserved_upload(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.verify_owned_listing_reserved_upload(uuid, text, text)
  to authenticated;

create or replace function listing_action_private.require_reserved_listing_image_paths(
  p_actor_id uuid,
  p_operation_id uuid,
  p_listing_id uuid,
  p_images jsonb
)
returns text[]
language plpgsql
security definer
set search_path = ''
as $function$
declare
  incoming_paths text[];
  valid_count integer;
begin
  select coalesce(
    pg_catalog.array_agg(value ->> 'storage_path' order by value ->> 'storage_path'),
    '{}'::text[]
  ) into incoming_paths
  from pg_catalog.jsonb_array_elements(p_images) value
  where not exists (
    select 1
    from public.listing_images image
    where image.listing_id = p_listing_id
      and image.storage_path = value ->> 'storage_path'
  );
  if pg_catalog.cardinality(incoming_paths) = 0 then
    return incoming_paths;
  end if;

  perform reservation.storage_path
  from listing_action_private.image_upload_reservations reservation
  where reservation.actor_user_id_snapshot = p_actor_id
    and reservation.operation_id = p_operation_id
    and reservation.listing_id_snapshot = p_listing_id
    and reservation.storage_path = any(incoming_paths)
  order by reservation.storage_path
  for update;

  select pg_catalog.count(*) into valid_count
  from listing_action_private.image_upload_reservations reservation
  where reservation.actor_user_id_snapshot = p_actor_id
    and reservation.operation_id = p_operation_id
    and reservation.listing_id_snapshot = p_listing_id
    and reservation.storage_path = any(incoming_paths)
    and reservation.state = 'reserved'
    and reservation.expires_at > pg_catalog.statement_timestamp();
  if valid_count <> pg_catalog.cardinality(incoming_paths) then
    raise exception using errcode = '55000', message = 'listing_image_reservation_required';
  end if;
  return incoming_paths;
end
$function$;

alter function listing_action_private.require_reserved_listing_image_paths(
  uuid, uuid, uuid, jsonb
) owner to postgres;
revoke all on function listing_action_private.require_reserved_listing_image_paths(
  uuid, uuid, uuid, jsonb
) from public, anon, authenticated, service_role;

create or replace function listing_action_private.consume_listing_image_reservations(
  p_actor_id uuid,
  p_operation_id uuid,
  p_listing_id uuid,
  p_paths text[]
)
returns void
language sql
security definer
set search_path = ''
begin atomic
  update listing_action_private.image_upload_reservations reservation
  set state = 'consumed',
      consumed_at = pg_catalog.statement_timestamp()
  where reservation.actor_user_id_snapshot = p_actor_id
    and reservation.operation_id = p_operation_id
    and reservation.listing_id_snapshot = p_listing_id
    and reservation.storage_path = any(p_paths)
    and reservation.state = 'reserved';
end;

alter function listing_action_private.consume_listing_image_reservations(
  uuid, uuid, uuid, text[]
) owner to postgres;
revoke all on function listing_action_private.consume_listing_image_reservations(
  uuid, uuid, uuid, text[]
) from public, anon, authenticated, service_role;

create or replace function listing_action_private.commit_owned_listing_create_intent_impl(
  p_operation_id uuid,
  p_signature_hash text,
  p_images jsonb,
  p_is_publishing boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := listing_action_private.require_listing_write_actor();
  intent_row listing_action_private.write_intents%rowtype;
  listing_row public.listings%rowtype;
  incoming_paths text[];
  next_revision bigint;
  canonical_result jsonb;
begin
  if pg_catalog.jsonb_typeof(p_images) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'listing_images_array_required';
  end if;
  select * into intent_row
  from listing_action_private.write_intents intent
  where intent.actor_user_id = actor_id
    and intent.operation_id = p_operation_id
  for update;
  if not found
    or intent_row.action <> 'create_listing'
    or intent_row.signature_hash is distinct from p_signature_hash
    or intent_row.is_publishing is distinct from coalesce(p_is_publishing, false) then
    raise exception using errcode = '22023', message = 'listing_write_intent_conflict';
  end if;
  if intent_row.state = 'committed' then
    return intent_row.safe_result;
  end if;
  if intent_row.state not in ('begun', 'in_progress')
    or intent_row.listing_id is null
    or intent_row.expected_content_revision is null then
    raise exception using errcode = '55000', message = 'listing_write_intent_not_active';
  end if;

  incoming_paths := listing_action_private.require_reserved_listing_image_paths(
    actor_id, p_operation_id, intent_row.listing_id, p_images
  );
  next_revision := listing_action_private.replace_owned_listing_images_impl(
    intent_row.listing_id, intent_row.expected_content_revision, p_images,
    false, null, null, null, null, null, null, false
  );
  perform listing_action_private.consume_listing_image_reservations(
    actor_id, p_operation_id, intent_row.listing_id, incoming_paths
  );

  if p_is_publishing then
    select * into listing_row
    from listing_action_private.transition_owned_listing_status_impl(
      intent_row.listing_id, 'submit_for_review'
    );
  else
    select * into listing_row
    from public.listings listing
    where listing.id = intent_row.listing_id;
  end if;
  canonical_result := pg_catalog.jsonb_build_object(
    'listing_id', listing_row.id,
    'content_revision', next_revision,
    'status', listing_row.status,
    'slug', listing_row.slug,
    'cleanup_pending', false
  );
  update listing_action_private.write_intents intent
  set state = 'committed',
      stage = 'committed',
      expected_content_revision = next_revision,
      safe_result = canonical_result,
      updated_at = pg_catalog.statement_timestamp(),
      terminal_at = pg_catalog.statement_timestamp(),
      cleanup_completed_at = pg_catalog.statement_timestamp()
  where intent.actor_user_id = actor_id
    and intent.operation_id = p_operation_id;
  return canonical_result;
end
$function$;

alter function listing_action_private.commit_owned_listing_create_intent_impl(
  uuid, text, jsonb, boolean
) owner to postgres;
revoke all on function listing_action_private.commit_owned_listing_create_intent_impl(
  uuid, text, jsonb, boolean
) from public, anon, authenticated, service_role;
grant execute on function listing_action_private.commit_owned_listing_create_intent_impl(
  uuid, text, jsonb, boolean
) to authenticated;

create or replace function public.commit_owned_listing_create_intent(
  p_operation_id uuid,
  p_signature_hash text,
  p_images jsonb,
  p_is_publishing boolean
)
returns jsonb
language sql
security invoker
set search_path = ''
begin atomic
  select listing_action_private.commit_owned_listing_create_intent_impl(
    p_operation_id, p_signature_hash, p_images, p_is_publishing
  );
end;

alter function public.commit_owned_listing_create_intent(
  uuid, text, jsonb, boolean
) owner to postgres;
revoke all on function public.commit_owned_listing_create_intent(
  uuid, text, jsonb, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.commit_owned_listing_create_intent(
  uuid, text, jsonb, boolean
) to authenticated;

create or replace function listing_action_private.commit_owned_listing_edit_intent_impl(
  p_operation_id uuid,
  p_signature_hash text,
  p_images jsonb,
  p_title text,
  p_description text,
  p_price numeric,
  p_category text,
  p_condition text,
  p_location text,
  p_is_negotiable boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := listing_action_private.require_listing_write_actor();
  intent_row listing_action_private.write_intents%rowtype;
  incoming_paths text[];
  removed_paths text[];
  next_revision bigint;
  listing_row public.listings%rowtype;
  cleanup_count integer := 0;
  canonical_result jsonb;
begin
  if pg_catalog.jsonb_typeof(p_images) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'listing_images_array_required';
  end if;
  select * into intent_row
  from listing_action_private.write_intents intent
  where intent.actor_user_id = actor_id
    and intent.operation_id = p_operation_id
  for update;
  if not found
    or intent_row.action <> 'edit_listing'
    or intent_row.signature_hash is distinct from p_signature_hash then
    raise exception using errcode = '22023', message = 'listing_write_intent_conflict';
  end if;
  if intent_row.state in ('committed', 'cleanup_pending') then
    return intent_row.safe_result;
  end if;
  if intent_row.state not in ('begun', 'in_progress') then
    raise exception using errcode = '55000', message = 'listing_write_intent_not_active';
  end if;

  perform image.id
  from public.listing_images image
  where image.listing_id = intent_row.listing_id
  order by image.id
  for update;
  incoming_paths := listing_action_private.require_reserved_listing_image_paths(
    actor_id, p_operation_id, intent_row.listing_id, p_images
  );
  select coalesce(
    pg_catalog.array_agg(image.storage_path order by image.position, image.id)
      filter (where image.storage_path is not null),
    '{}'::text[]
  ) into removed_paths
  from public.listing_images image
  where image.listing_id = intent_row.listing_id
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_images) incoming
      where incoming ->> 'storage_path' = image.storage_path
    );

  next_revision := listing_action_private.replace_owned_listing_images_impl(
    intent_row.listing_id, intent_row.expected_content_revision, p_images,
    true, p_title, p_description, p_price, p_category, p_condition, p_location,
    p_is_negotiable
  );
  perform listing_action_private.consume_listing_image_reservations(
    actor_id, p_operation_id, intent_row.listing_id, incoming_paths
  );
  insert into listing_action_private.image_cleanup_tasks(
    actor_user_id_snapshot, listing_id_snapshot, source_operation_id,
    storage_path, reason
  )
  select actor_id, intent_row.listing_id, p_operation_id, path, 'edit_removed'
  from pg_catalog.unnest(removed_paths) path
  on conflict (storage_path) do nothing;
  select pg_catalog.count(*) into cleanup_count
  from listing_action_private.image_cleanup_tasks task
  where task.actor_user_id_snapshot = actor_id
    and task.source_operation_id = p_operation_id
    and task.state <> 'cleaned';

  select * into listing_row
  from public.listings listing
  where listing.id = intent_row.listing_id;
  canonical_result := pg_catalog.jsonb_build_object(
    'listing_id', listing_row.id,
    'content_revision', next_revision,
    'status', listing_row.status,
    'slug', listing_row.slug,
    'cleanup_pending', cleanup_count > 0,
    'cleanup_task_count', cleanup_count
  );
  update listing_action_private.write_intents intent
  set state = case when cleanup_count > 0 then 'cleanup_pending' else 'committed' end,
      stage = 'committed',
      expected_content_revision = next_revision,
      safe_result = canonical_result,
      updated_at = pg_catalog.statement_timestamp(),
      terminal_at = pg_catalog.statement_timestamp(),
      cleanup_completed_at = case when cleanup_count = 0
        then pg_catalog.statement_timestamp() else null end
  where intent.actor_user_id = actor_id
    and intent.operation_id = p_operation_id;
  return canonical_result;
end
$function$;

alter function listing_action_private.commit_owned_listing_edit_intent_impl(
  uuid, text, jsonb, text, text, numeric, text, text, text, boolean
) owner to postgres;
revoke all on function listing_action_private.commit_owned_listing_edit_intent_impl(
  uuid, text, jsonb, text, text, numeric, text, text, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function listing_action_private.commit_owned_listing_edit_intent_impl(
  uuid, text, jsonb, text, text, numeric, text, text, text, boolean
) to authenticated;

create or replace function public.commit_owned_listing_edit_intent(
  p_operation_id uuid,
  p_signature_hash text,
  p_images jsonb,
  p_title text,
  p_description text default null,
  p_price numeric default null,
  p_category text default null,
  p_condition text default null,
  p_location text default null,
  p_is_negotiable boolean default false
)
returns jsonb
language sql
security invoker
set search_path = ''
begin atomic
  select listing_action_private.commit_owned_listing_edit_intent_impl(
    p_operation_id, p_signature_hash, p_images, p_title, p_description,
    p_price, p_category, p_condition, p_location, p_is_negotiable
  );
end;

alter function public.commit_owned_listing_edit_intent(
  uuid, text, jsonb, text, text, numeric, text, text, text, boolean
) owner to postgres;
revoke all on function public.commit_owned_listing_edit_intent(
  uuid, text, jsonb, text, text, numeric, text, text, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.commit_owned_listing_edit_intent(
  uuid, text, jsonb, text, text, numeric, text, text, text, boolean
) to authenticated;

create or replace function listing_action_private.commit_owned_listing_retire_intent_impl(
  p_operation_id uuid,
  p_signature_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := listing_action_private.require_listing_write_actor();
  intent_row listing_action_private.write_intents%rowtype;
  listing_row public.listings%rowtype;
  retired_result jsonb;
  storage_paths text[];
  cleanup_count integer := 0;
  canonical_result jsonb;
begin
  select * into intent_row
  from listing_action_private.write_intents intent
  where intent.actor_user_id = actor_id
    and intent.operation_id = p_operation_id
  for update;
  if not found
    or intent_row.action <> 'retire_listing'
    or intent_row.signature_hash is distinct from p_signature_hash then
    raise exception using errcode = '22023', message = 'listing_write_intent_conflict';
  end if;
  if intent_row.state in ('committed', 'cleanup_pending') then
    return intent_row.safe_result;
  end if;
  if intent_row.state <> 'begun' then
    raise exception using errcode = '55000', message = 'listing_write_intent_not_active';
  end if;

  perform image.id
  from public.listing_images image
  where image.listing_id = intent_row.listing_id
  order by image.id
  for update;
  select * into listing_row
  from public.listings listing
  where listing.id = intent_row.listing_id
  for update;
  if not found or listing_row.seller_id is distinct from actor_id then
    raise exception using errcode = '42501', message = 'listing_owner_mismatch';
  end if;
  if listing_row.content_revision is distinct from intent_row.expected_content_revision then
    raise exception using errcode = '40001', message = 'listing_review_revision_conflict';
  end if;

  retired_result := listing_action_private.retire_owned_listing_idempotent_impl(
    p_operation_id, intent_row.listing_id
  );
  select coalesce(pg_catalog.array_agg(value), '{}'::text[])
  into storage_paths
  from pg_catalog.jsonb_array_elements_text(retired_result -> 'storage_paths') value;
  insert into listing_action_private.image_cleanup_tasks(
    actor_user_id_snapshot, listing_id_snapshot, source_operation_id,
    storage_path, reason
  )
  select actor_id, intent_row.listing_id, p_operation_id, path, 'listing_retired'
  from pg_catalog.unnest(storage_paths) path
  on conflict (storage_path) do nothing;
  select pg_catalog.count(*) into cleanup_count
  from listing_action_private.image_cleanup_tasks task
  where task.actor_user_id_snapshot = actor_id
    and task.source_operation_id = p_operation_id
    and task.state <> 'cleaned';

  canonical_result := pg_catalog.jsonb_build_object(
    'listing_id', intent_row.listing_id,
    'content_revision', (retired_result ->> 'content_revision')::bigint,
    'retired_at', retired_result ->> 'retired_at',
    'cleanup_pending', cleanup_count > 0,
    'cleanup_task_count', cleanup_count
  );
  update listing_action_private.write_intents intent
  set state = case when cleanup_count > 0 then 'cleanup_pending' else 'committed' end,
      stage = 'committed',
      safe_result = canonical_result,
      updated_at = pg_catalog.statement_timestamp(),
      terminal_at = pg_catalog.statement_timestamp(),
      cleanup_completed_at = case when cleanup_count = 0
        then pg_catalog.statement_timestamp() else null end
  where intent.actor_user_id = actor_id
    and intent.operation_id = p_operation_id;
  return canonical_result;
end
$function$;

alter function listing_action_private.commit_owned_listing_retire_intent_impl(
  uuid, text
) owner to postgres;
revoke all on function listing_action_private.commit_owned_listing_retire_intent_impl(
  uuid, text
) from public, anon, authenticated, service_role;
grant execute on function listing_action_private.commit_owned_listing_retire_intent_impl(
  uuid, text
) to authenticated;

create or replace function public.commit_owned_listing_retire_intent(
  p_operation_id uuid,
  p_signature_hash text
)
returns jsonb
language sql
security invoker
set search_path = ''
begin atomic
  select listing_action_private.commit_owned_listing_retire_intent_impl(
    p_operation_id, p_signature_hash
  );
end;

alter function public.commit_owned_listing_retire_intent(uuid, text)
  owner to postgres;
revoke all on function public.commit_owned_listing_retire_intent(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.commit_owned_listing_retire_intent(uuid, text)
  to authenticated;

create or replace function listing_action_private.abort_owned_listing_write_intent_impl(
  p_operation_id uuid,
  p_signature_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := listing_action_private.require_listing_write_actor();
  intent_row listing_action_private.write_intents%rowtype;
  cleanup_count integer := 0;
  listing_discarded boolean := false;
  canonical_result jsonb;
begin
  select * into intent_row
  from listing_action_private.write_intents intent
  where intent.actor_user_id = actor_id
    and intent.operation_id = p_operation_id
  for update;
  if not found or intent_row.signature_hash is distinct from p_signature_hash then
    raise exception using errcode = '22023', message = 'listing_write_intent_conflict';
  end if;
  if intent_row.state = 'committed' then
    raise exception using errcode = '55000', message = 'listing_write_intent_already_committed';
  end if;
  if intent_row.state in ('aborted', 'cleanup_pending')
    and intent_row.stage = 'aborted' then
    return intent_row.safe_result;
  end if;

  perform reservation.storage_path
  from listing_action_private.image_upload_reservations reservation
  where reservation.actor_user_id_snapshot = actor_id
    and reservation.operation_id = p_operation_id
  order by reservation.storage_path
  for update;
  update listing_action_private.image_upload_reservations reservation
  set state = 'cleanup_pending'
  where reservation.actor_user_id_snapshot = actor_id
    and reservation.operation_id = p_operation_id
    and reservation.state = 'reserved';
  insert into listing_action_private.image_cleanup_tasks(
    actor_user_id_snapshot, listing_id_snapshot, source_operation_id,
    storage_path, reason
  )
  select reservation.actor_user_id_snapshot, reservation.listing_id_snapshot,
      reservation.operation_id, reservation.storage_path, 'abandoned_upload'
  from listing_action_private.image_upload_reservations reservation
  where reservation.actor_user_id_snapshot = actor_id
    and reservation.operation_id = p_operation_id
    and reservation.state = 'cleanup_pending'
  on conflict (storage_path) do nothing;
  select pg_catalog.count(*) into cleanup_count
  from listing_action_private.image_cleanup_tasks task
  where task.actor_user_id_snapshot = actor_id
    and task.source_operation_id = p_operation_id
    and task.state <> 'cleaned';

  if intent_row.action = 'create_listing'
    and intent_row.listing_id is not null
    and intent_row.expected_content_revision is not null then
    begin
      perform listing_action_private.discard_owned_listing_draft_impl(
        intent_row.listing_id, intent_row.expected_content_revision
      );
      listing_discarded := true;
    exception
      when sqlstate '40001' or sqlstate 'P0001' then
        listing_discarded := false;
    end;
  end if;

  canonical_result := pg_catalog.jsonb_build_object(
    'listing_id', intent_row.listing_id,
    'listing_discarded', listing_discarded,
    'cleanup_pending', cleanup_count > 0,
    'cleanup_task_count', cleanup_count
  );
  update listing_action_private.write_intents intent
  set state = case when cleanup_count > 0 then 'cleanup_pending' else 'aborted' end,
      stage = 'aborted',
      safe_result = canonical_result,
      updated_at = pg_catalog.statement_timestamp(),
      terminal_at = pg_catalog.statement_timestamp(),
      cleanup_completed_at = case when cleanup_count = 0
        then pg_catalog.statement_timestamp() else null end
  where intent.actor_user_id = actor_id
    and intent.operation_id = p_operation_id;
  return canonical_result;
end
$function$;

alter function listing_action_private.abort_owned_listing_write_intent_impl(
  uuid, text
) owner to postgres;
revoke all on function listing_action_private.abort_owned_listing_write_intent_impl(
  uuid, text
) from public, anon, authenticated, service_role;
grant execute on function listing_action_private.abort_owned_listing_write_intent_impl(
  uuid, text
) to authenticated;

create or replace function public.abort_owned_listing_write_intent(
  p_operation_id uuid,
  p_signature_hash text
)
returns jsonb
language sql
security invoker
set search_path = ''
begin atomic
  select listing_action_private.abort_owned_listing_write_intent_impl(
    p_operation_id, p_signature_hash
  );
end;

alter function public.abort_owned_listing_write_intent(uuid, text) owner to postgres;
revoke all on function public.abort_owned_listing_write_intent(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.abort_owned_listing_write_intent(uuid, text)
  to authenticated;

create or replace function listing_action_private.enqueue_expired_owned_reservations(
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform reservation.storage_path
  from listing_action_private.image_upload_reservations reservation
  where reservation.actor_user_id_snapshot = p_actor_id
    and reservation.state = 'reserved'
    and reservation.expires_at <= pg_catalog.statement_timestamp()
  order by reservation.storage_path
  for update;
  update listing_action_private.image_upload_reservations reservation
  set state = 'cleanup_pending'
  where reservation.actor_user_id_snapshot = p_actor_id
    and reservation.state = 'reserved'
    and reservation.expires_at <= pg_catalog.statement_timestamp();
  insert into listing_action_private.image_cleanup_tasks(
    actor_user_id_snapshot, listing_id_snapshot, source_operation_id,
    storage_path, reason
  )
  select reservation.actor_user_id_snapshot, reservation.listing_id_snapshot,
      reservation.operation_id, reservation.storage_path, 'abandoned_upload'
  from listing_action_private.image_upload_reservations reservation
  where reservation.actor_user_id_snapshot = p_actor_id
    and reservation.state = 'cleanup_pending'
  on conflict (storage_path) do nothing;
end
$function$;

alter function listing_action_private.enqueue_expired_owned_reservations(uuid)
  owner to postgres;
revoke all on function listing_action_private.enqueue_expired_owned_reservations(uuid)
  from public, anon, authenticated, service_role;

create or replace function listing_action_private.claim_owned_listing_image_cleanup_tasks_impl(
  p_limit integer default 20
)
returns table(
  task_id uuid,
  actor_user_id_snapshot uuid,
  storage_path text,
  lease_token uuid,
  lease_expires_at timestamptz,
  reason text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := listing_action_private.require_listing_write_actor();
begin
  if p_limit not between 1 and 20 then
    raise exception using errcode = '22023', message = 'listing_cleanup_limit_invalid';
  end if;
  perform listing_action_private.enqueue_expired_owned_reservations(actor_id);
  update listing_action_private.image_cleanup_tasks task
  set state = 'pending', lease_token = null, lease_expires_at = null
  where task.actor_user_id_snapshot = actor_id
    and task.state = 'leased'
    and task.lease_expires_at <= pg_catalog.statement_timestamp();

  return query
  with candidate as (
    select task.id
    from listing_action_private.image_cleanup_tasks task
    where task.actor_user_id_snapshot = actor_id
      and task.state = 'pending'
      and task.available_at <= pg_catalog.statement_timestamp()
    order by task.available_at, task.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update listing_action_private.image_cleanup_tasks task
    set state = 'leased',
        lease_token = gen_random_uuid(),
        lease_expires_at = pg_catalog.statement_timestamp() + interval '5 minutes'
    from candidate
    where task.id = candidate.id
    returning task.id, task.actor_user_id_snapshot, task.storage_path,
      task.lease_token,
      task.lease_expires_at, task.reason
  )
  select claimed.id, claimed.actor_user_id_snapshot, claimed.storage_path,
    claimed.lease_token,
    claimed.lease_expires_at, claimed.reason
  from claimed;
end
$function$;

alter function listing_action_private.claim_owned_listing_image_cleanup_tasks_impl(integer)
  owner to postgres;
revoke all on function listing_action_private.claim_owned_listing_image_cleanup_tasks_impl(integer)
  from public, anon, authenticated, service_role;
grant execute on function listing_action_private.claim_owned_listing_image_cleanup_tasks_impl(integer)
  to authenticated;

create or replace function public.claim_owned_listing_image_cleanup_tasks(
  p_limit integer default 20
)
returns table(
  task_id uuid,
  actor_user_id_snapshot uuid,
  storage_path text,
  lease_token uuid,
  lease_expires_at timestamptz,
  reason text
)
language sql
security invoker
set search_path = ''
begin atomic
  select *
  from listing_action_private.claim_owned_listing_image_cleanup_tasks_impl(p_limit);
end;

alter function public.claim_owned_listing_image_cleanup_tasks(integer) owner to postgres;
revoke all on function public.claim_owned_listing_image_cleanup_tasks(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_owned_listing_image_cleanup_tasks(integer)
  to authenticated;

create or replace function listing_action_private.complete_owned_listing_image_cleanup_task_impl(
  p_task_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := listing_action_private.require_listing_write_actor();
  task_row listing_action_private.image_cleanup_tasks%rowtype;
begin
  select * into task_row
  from listing_action_private.image_cleanup_tasks task
  where task.id = p_task_id
  for update;
  if found and task_row.state = 'cleaned'
    and task_row.completion_token is not distinct from p_lease_token then
    return true;
  end if;
  if not found
    or task_row.actor_user_id_snapshot is distinct from actor_id
    or task_row.state <> 'leased'
    or task_row.lease_token is distinct from p_lease_token
    or task_row.lease_expires_at <= pg_catalog.statement_timestamp() then
    raise exception using errcode = '40001', message = 'listing_cleanup_lease_conflict';
  end if;
  if exists (
    select 1 from storage.objects object
    where object.bucket_id = 'listing-images'
      and object.name = task_row.storage_path
  ) or exists (
    select 1 from public.listing_images image
    where image.storage_path = task_row.storage_path
  ) then
    raise exception using errcode = '55000', message = 'listing_cleanup_not_complete';
  end if;

  update listing_action_private.image_cleanup_tasks task
  set state = 'cleaned', cleaned_at = pg_catalog.statement_timestamp(),
      completion_token = p_lease_token,
      lease_token = null, lease_expires_at = null
  where task.id = p_task_id;
  update listing_action_private.image_upload_reservations reservation
  set state = 'cleaned', cleaned_at = pg_catalog.statement_timestamp()
  where reservation.storage_path = task_row.storage_path
    and reservation.state <> 'cleaned';
  if task_row.source_operation_id is not null
    and not exists (
      select 1
      from listing_action_private.image_cleanup_tasks remaining
      where remaining.actor_user_id_snapshot = actor_id
        and remaining.source_operation_id = task_row.source_operation_id
        and remaining.state <> 'cleaned'
    ) then
    update listing_action_private.write_intents intent
    set state = case when intent.stage = 'aborted' then 'aborted' else 'committed' end,
        cleanup_completed_at = pg_catalog.statement_timestamp(),
        updated_at = pg_catalog.statement_timestamp(),
        safe_result = intent.safe_result || pg_catalog.jsonb_build_object(
          'cleanup_pending', false, 'cleanup_task_count', 0
        )
    where intent.actor_user_id = actor_id
      and intent.operation_id = task_row.source_operation_id;
  end if;
  return true;
end
$function$;

alter function listing_action_private.complete_owned_listing_image_cleanup_task_impl(
  uuid, uuid
) owner to postgres;
revoke all on function listing_action_private.complete_owned_listing_image_cleanup_task_impl(
  uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function listing_action_private.complete_owned_listing_image_cleanup_task_impl(
  uuid, uuid
) to authenticated;

create or replace function public.complete_owned_listing_image_cleanup_task(
  p_task_id uuid,
  p_lease_token uuid
)
returns boolean
language sql
security invoker
set search_path = ''
begin atomic
  select listing_action_private.complete_owned_listing_image_cleanup_task_impl(
    p_task_id, p_lease_token
  );
end;

alter function public.complete_owned_listing_image_cleanup_task(uuid, uuid)
  owner to postgres;
revoke all on function public.complete_owned_listing_image_cleanup_task(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_owned_listing_image_cleanup_task(uuid, uuid)
  to authenticated;

create or replace function listing_action_private.release_owned_listing_image_cleanup_task_impl(
  p_task_id uuid,
  p_lease_token uuid,
  p_retry_after_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := listing_action_private.require_listing_write_actor();
begin
  if p_retry_after_seconds not between 15 and 3600 then
    raise exception using errcode = '22023', message = 'listing_cleanup_retry_invalid';
  end if;
  update listing_action_private.image_cleanup_tasks task
  set state = 'pending',
      available_at = pg_catalog.statement_timestamp()
        + pg_catalog.make_interval(secs => p_retry_after_seconds),
      lease_token = null,
      lease_expires_at = null
  where task.id = p_task_id
    and task.actor_user_id_snapshot = actor_id
    and task.state = 'leased'
    and task.lease_token = p_lease_token
    and task.lease_expires_at > pg_catalog.statement_timestamp();
  if not found then
    raise exception using errcode = '40001', message = 'listing_cleanup_lease_conflict';
  end if;
  return true;
end
$function$;

alter function listing_action_private.release_owned_listing_image_cleanup_task_impl(
  uuid, uuid, integer
) owner to postgres;
revoke all on function listing_action_private.release_owned_listing_image_cleanup_task_impl(
  uuid, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function listing_action_private.release_owned_listing_image_cleanup_task_impl(
  uuid, uuid, integer
) to authenticated;

create or replace function public.release_owned_listing_image_cleanup_task(
  p_task_id uuid,
  p_lease_token uuid,
  p_retry_after_seconds integer default 60
)
returns boolean
language sql
security invoker
set search_path = ''
begin atomic
  select listing_action_private.release_owned_listing_image_cleanup_task_impl(
    p_task_id, p_lease_token, p_retry_after_seconds
  );
end;

alter function public.release_owned_listing_image_cleanup_task(uuid, uuid, integer)
  owner to postgres;
revoke all on function public.release_owned_listing_image_cleanup_task(uuid, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.release_owned_listing_image_cleanup_task(uuid, uuid, integer)
  to authenticated;

create or replace function listing_action_private.require_listing_cleanup_service()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'listing_cleanup_service_required';
  end if;
end
$function$;

alter function listing_action_private.require_listing_cleanup_service() owner to postgres;
revoke all on function listing_action_private.require_listing_cleanup_service()
  from public, anon, authenticated, service_role;
grant execute on function listing_action_private.require_listing_cleanup_service()
  to service_role;

create or replace function listing_action_private.claim_listing_image_cleanup_tasks_impl(
  p_limit integer default 20,
  p_actor_user_id uuid default null,
  p_retirement_operation_id uuid default null
)
returns table(
  task_id uuid,
  actor_user_id_snapshot uuid,
  storage_path text,
  lease_token uuid,
  lease_expires_at timestamptz,
  reason text
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform listing_action_private.require_listing_cleanup_service();
  if p_limit < 1
    or (p_actor_user_id is null and p_limit > 20)
    or (p_actor_user_id is not null and p_limit > 100)
  then
    raise exception using errcode = '22023', message = 'listing_cleanup_limit_invalid';
  end if;
  if p_actor_user_id is not null and (
    p_retirement_operation_id is null
    or not exists (
      select 1
      from listing_action_private.account_retirements retirement
      where retirement.actor_user_id_snapshot = p_actor_user_id
        and retirement.operation_id = p_retirement_operation_id
        and retirement.state = 'cleanup_pending'
    )
  ) then
    raise exception using
      errcode = '40001', message = 'listing_account_retirement_conflict';
  end if;

  update listing_action_private.image_cleanup_tasks task
  set state = 'pending', lease_token = null, lease_expires_at = null
  where task.state = 'leased'
    and task.lease_expires_at <= pg_catalog.statement_timestamp()
    and (p_actor_user_id is null
      or task.actor_user_id_snapshot = p_actor_user_id);
  return query
  with candidate as (
    select task.id
    from listing_action_private.image_cleanup_tasks task
    where task.state = 'pending'
      and task.available_at <= pg_catalog.statement_timestamp()
      and (p_actor_user_id is null
        or task.actor_user_id_snapshot = p_actor_user_id)
    order by task.available_at, task.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update listing_action_private.image_cleanup_tasks task
    set state = 'leased',
        lease_token = gen_random_uuid(),
        lease_expires_at = pg_catalog.statement_timestamp() + interval '5 minutes'
    from candidate
    where task.id = candidate.id
    returning task.id, task.actor_user_id_snapshot, task.storage_path,
      task.lease_token,
      task.lease_expires_at, task.reason
  )
  select claimed.id, claimed.actor_user_id_snapshot, claimed.storage_path,
    claimed.lease_token,
    claimed.lease_expires_at, claimed.reason
  from claimed;
end
$function$;

alter function listing_action_private.claim_listing_image_cleanup_tasks_impl(
  integer, uuid, uuid
) owner to postgres;
revoke all on function listing_action_private.claim_listing_image_cleanup_tasks_impl(
  integer, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function listing_action_private.claim_listing_image_cleanup_tasks_impl(
  integer, uuid, uuid
) to service_role;

create or replace function public.claim_listing_image_cleanup_tasks(
  p_limit integer default 20
)
returns table(
  task_id uuid,
  actor_user_id_snapshot uuid,
  storage_path text,
  lease_token uuid,
  lease_expires_at timestamptz,
  reason text
)
language sql
security invoker
set search_path = ''
begin atomic
  select *
  from listing_action_private.claim_listing_image_cleanup_tasks_impl(
    p_limit, null, null
  );
end;

alter function public.claim_listing_image_cleanup_tasks(integer) owner to postgres;
revoke all on function public.claim_listing_image_cleanup_tasks(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_listing_image_cleanup_tasks(integer)
  to service_role;

create or replace function public.claim_listing_account_cleanup_tasks(
  p_actor_user_id uuid,
  p_operation_id uuid,
  p_limit integer default 100
)
returns table(
  task_id uuid,
  actor_user_id_snapshot uuid,
  storage_path text,
  lease_token uuid,
  lease_expires_at timestamptz,
  reason text
)
language sql
security invoker
set search_path = ''
begin atomic
  select *
  from listing_action_private.claim_listing_image_cleanup_tasks_impl(
    p_limit, p_actor_user_id, p_operation_id
  );
end;

alter function public.claim_listing_account_cleanup_tasks(uuid, uuid, integer)
  owner to postgres;
revoke all on function public.claim_listing_account_cleanup_tasks(uuid, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_listing_account_cleanup_tasks(uuid, uuid, integer)
  to service_role;

create or replace function listing_action_private.complete_listing_image_cleanup_task_impl(
  p_task_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare task_row listing_action_private.image_cleanup_tasks%rowtype;
begin
  perform listing_action_private.require_listing_cleanup_service();
  select * into task_row
  from listing_action_private.image_cleanup_tasks task
  where task.id = p_task_id
  for update;
  if found and task_row.state = 'cleaned'
    and task_row.completion_token is not distinct from p_lease_token then
    return true;
  end if;
  if not found
    or task_row.state <> 'leased'
    or task_row.lease_token is distinct from p_lease_token
    or task_row.lease_expires_at <= pg_catalog.statement_timestamp() then
    raise exception using errcode = '40001', message = 'listing_cleanup_lease_conflict';
  end if;
  if exists (
    select 1 from storage.objects object
    where object.bucket_id = 'listing-images'
      and object.name = task_row.storage_path
  ) or exists (
    select 1 from public.listing_images image
    where image.storage_path = task_row.storage_path
  ) then
    raise exception using errcode = '55000', message = 'listing_cleanup_not_complete';
  end if;

  update listing_action_private.image_cleanup_tasks task
  set state = 'cleaned', cleaned_at = pg_catalog.statement_timestamp(),
      completion_token = p_lease_token,
      lease_token = null, lease_expires_at = null
  where task.id = p_task_id;
  update listing_action_private.image_upload_reservations reservation
  set state = 'cleaned', cleaned_at = pg_catalog.statement_timestamp()
  where reservation.storage_path = task_row.storage_path
    and reservation.state <> 'cleaned';
  if task_row.actor_user_id_snapshot is not null
    and task_row.source_operation_id is not null
    and not exists (
      select 1
      from listing_action_private.image_cleanup_tasks remaining
      where remaining.actor_user_id_snapshot = task_row.actor_user_id_snapshot
        and remaining.source_operation_id = task_row.source_operation_id
        and remaining.state <> 'cleaned'
    ) then
    update listing_action_private.write_intents intent
    set state = case when intent.stage = 'aborted' then 'aborted' else 'committed' end,
        cleanup_completed_at = pg_catalog.statement_timestamp(),
        updated_at = pg_catalog.statement_timestamp(),
        safe_result = intent.safe_result || pg_catalog.jsonb_build_object(
          'cleanup_pending', false, 'cleanup_task_count', 0
        )
    where intent.actor_user_id = task_row.actor_user_id_snapshot
      and intent.operation_id = task_row.source_operation_id;
  end if;
  return true;
end
$function$;

alter function listing_action_private.complete_listing_image_cleanup_task_impl(
  uuid, uuid
) owner to postgres;
revoke all on function listing_action_private.complete_listing_image_cleanup_task_impl(
  uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function listing_action_private.complete_listing_image_cleanup_task_impl(
  uuid, uuid
) to service_role;

create or replace function public.complete_listing_image_cleanup_task(
  p_task_id uuid,
  p_lease_token uuid
)
returns boolean
language sql
security invoker
set search_path = ''
begin atomic
  select listing_action_private.complete_listing_image_cleanup_task_impl(
    p_task_id, p_lease_token
  );
end;

alter function public.complete_listing_image_cleanup_task(uuid, uuid) owner to postgres;
revoke all on function public.complete_listing_image_cleanup_task(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_listing_image_cleanup_task(uuid, uuid)
  to service_role;

create or replace function listing_action_private.release_listing_image_cleanup_task_impl(
  p_task_id uuid,
  p_lease_token uuid,
  p_retry_after_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform listing_action_private.require_listing_cleanup_service();
  if p_retry_after_seconds not between 15 and 3600 then
    raise exception using errcode = '22023', message = 'listing_cleanup_retry_invalid';
  end if;
  update listing_action_private.image_cleanup_tasks task
  set state = 'pending',
      available_at = pg_catalog.statement_timestamp()
        + pg_catalog.make_interval(secs => p_retry_after_seconds),
      lease_token = null, lease_expires_at = null
  where task.id = p_task_id
    and task.state = 'leased'
    and task.lease_token = p_lease_token
    and task.lease_expires_at > pg_catalog.statement_timestamp();
  if not found then
    raise exception using errcode = '40001', message = 'listing_cleanup_lease_conflict';
  end if;
  return true;
end
$function$;

alter function listing_action_private.release_listing_image_cleanup_task_impl(
  uuid, uuid, integer
) owner to postgres;
revoke all on function listing_action_private.release_listing_image_cleanup_task_impl(
  uuid, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function listing_action_private.release_listing_image_cleanup_task_impl(
  uuid, uuid, integer
) to service_role;

create or replace function public.release_listing_image_cleanup_task(
  p_task_id uuid,
  p_lease_token uuid,
  p_retry_after_seconds integer default 60
)
returns boolean
language sql
security invoker
set search_path = ''
begin atomic
  select listing_action_private.release_listing_image_cleanup_task_impl(
    p_task_id, p_lease_token, p_retry_after_seconds
  );
end;

alter function public.release_listing_image_cleanup_task(uuid, uuid, integer)
  owner to postgres;
revoke all on function public.release_listing_image_cleanup_task(uuid, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.release_listing_image_cleanup_task(uuid, uuid, integer)
  to service_role;

create or replace function listing_action_private.prepare_listing_account_retirement_impl(
  p_actor_user_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  retirement_row listing_action_private.account_retirements%rowtype;
  cleanup_count integer;
begin
  perform listing_action_private.require_listing_cleanup_service();
  if p_actor_user_id is null or p_operation_id is null then
    raise exception using errcode = '22023', message = 'listing_account_retirement_invalid';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('listing-write-actor:' || p_actor_user_id::text, 0)
  );
  insert into listing_action_private.account_retirements(
    actor_user_id_snapshot, operation_id
  ) values (p_actor_user_id, p_operation_id)
  on conflict (actor_user_id_snapshot) do nothing;
  select * into retirement_row
  from listing_action_private.account_retirements retirement
  where retirement.actor_user_id_snapshot = p_actor_user_id
  for update;
  if retirement_row.operation_id is distinct from p_operation_id then
    raise exception using
      errcode = '40001', message = 'listing_account_retirement_conflict';
  end if;

  perform intent.operation_id
  from listing_action_private.write_intents intent
  where intent.actor_user_id = p_actor_user_id
  order by intent.operation_id
  for update;
  perform reservation.storage_path
  from listing_action_private.image_upload_reservations reservation
  where reservation.actor_user_id_snapshot = p_actor_user_id
  order by reservation.storage_path
  for update;
  perform task.id
  from listing_action_private.image_cleanup_tasks task
  where task.actor_user_id_snapshot = p_actor_user_id
  order by task.id
  for update;
  perform image.id
  from public.listing_images image
  join public.listings listing on listing.id = image.listing_id
  where listing.seller_id = p_actor_user_id
  order by image.id
  for update of image;
  perform listing.id
  from public.listings listing
  where listing.seller_id = p_actor_user_id
  order by listing.id
  for update;
  perform object.name
  from storage.objects object
  where object.bucket_id = 'listing-images'
    and pg_catalog.split_part(object.name, '/', 1) = p_actor_user_id::text
  order by object.name
  for key share;

  update listing_action_private.image_upload_reservations reservation
  set state = 'cleanup_pending'
  where reservation.actor_user_id_snapshot = p_actor_user_id
    and reservation.state in ('reserved', 'consumed');
  insert into listing_action_private.image_cleanup_tasks(
    actor_user_id_snapshot, listing_id_snapshot, source_operation_id,
    storage_path, reason
  )
  select reservation.actor_user_id_snapshot, reservation.listing_id_snapshot,
      p_operation_id, reservation.storage_path, 'account_deleted'
  from listing_action_private.image_upload_reservations reservation
  where reservation.actor_user_id_snapshot = p_actor_user_id
    and reservation.state = 'cleanup_pending'
  on conflict (storage_path) do nothing;
  insert into listing_action_private.image_cleanup_tasks(
    actor_user_id_snapshot, listing_id_snapshot, source_operation_id,
    storage_path, reason
  )
  select p_actor_user_id, image.listing_id, p_operation_id,
      image.storage_path, 'account_deleted'
  from public.listing_images image
  join public.listings listing on listing.id = image.listing_id
  where listing.seller_id = p_actor_user_id
    and image.storage_path is not null
  on conflict (storage_path) do nothing;
  insert into listing_action_private.image_cleanup_tasks(
    actor_user_id_snapshot, listing_id_snapshot, source_operation_id,
    storage_path, reason
  )
  select p_actor_user_id, null, p_operation_id,
      object.name, 'account_deleted'
  from storage.objects object
  where object.bucket_id = 'listing-images'
    and pg_catalog.split_part(object.name, '/', 1) = p_actor_user_id::text
  on conflict (storage_path) do nothing;
  update listing_action_private.image_cleanup_tasks task
  set actor_user_id_snapshot = p_actor_user_id,
      source_operation_id = p_operation_id,
      reason = 'account_deleted'
  where task.actor_user_id_snapshot = p_actor_user_id
    and task.state <> 'cleaned';

  perform pg_catalog.set_config('app.listing_integrity_context', 'retirement', true);
  delete from public.listing_images image
  using public.listings listing
  where listing.id = image.listing_id
    and listing.seller_id = p_actor_user_id;
  update public.listings listing
  set slug = 'retired-' || listing.id::text,
      title = 'Deleted listing',
      description = '',
      price = 0,
      previous_price = null,
      location = null,
      is_negotiable = false,
      status = 'inactive',
      submitted_for_review_at = null,
      retired_at = coalesce(listing.retired_at, pg_catalog.statement_timestamp()),
      content_revision = listing.content_revision + 1
  where listing.seller_id = p_actor_user_id
    and listing.retired_at is null;
  perform pg_catalog.set_config('app.listing_integrity_context', '', true);

  update listing_action_private.write_intents intent
  set state = case when exists (
        select 1 from listing_action_private.image_cleanup_tasks task
        where task.actor_user_id_snapshot = p_actor_user_id
          and task.state <> 'cleaned'
      ) then 'cleanup_pending' else 'aborted' end,
      stage = case when intent.state in ('begun', 'in_progress')
        then 'aborted' else intent.stage end,
      terminal_at = coalesce(intent.terminal_at, pg_catalog.statement_timestamp()),
      updated_at = pg_catalog.statement_timestamp()
  where intent.actor_user_id = p_actor_user_id
    and intent.state in ('begun', 'in_progress');

  insert into listing_action_private.write_intent_tombstones(
    actor_user_id_snapshot, operation_id, action, signature_hash,
    terminal_state, payload_hash, result_hash, completed_at
  )
  select intent.actor_user_id, intent.operation_id, intent.action,
      intent.signature_hash,
      case when intent.stage = 'aborted' then 'aborted' else 'committed' end,
      pg_catalog.md5(intent.signature_hash),
      pg_catalog.md5(intent.safe_result::text),
      coalesce(intent.terminal_at, pg_catalog.statement_timestamp())
  from listing_action_private.write_intents intent
  where intent.actor_user_id = p_actor_user_id
  on conflict (actor_user_id_snapshot, operation_id) do nothing;

  update listing_action_private.write_command_results command
  set payload = '{}'::jsonb, result = '{}'::jsonb,
      scrubbed_at = pg_catalog.statement_timestamp()
  where command.actor_user_id = p_actor_user_id
    and command.scrubbed_at is null;
  delete from listing_action_private.image_upload_reservations reservation
  where reservation.actor_user_id_snapshot = p_actor_user_id;
  delete from listing_action_private.write_intents intent
  where intent.actor_user_id = p_actor_user_id;

  select pg_catalog.count(*) into cleanup_count
  from listing_action_private.image_cleanup_tasks task
  where task.actor_user_id_snapshot = p_actor_user_id
    and task.state <> 'cleaned';
  update listing_action_private.account_retirements retirement
  set updated_at = pg_catalog.statement_timestamp()
  where retirement.actor_user_id_snapshot = p_actor_user_id;
  return pg_catalog.jsonb_build_object(
    'actor_user_id', p_actor_user_id,
    'operation_id', p_operation_id,
    'state', case when cleanup_count = 0 then 'ready' else 'cleanup_pending' end,
    'cleanup_task_count', cleanup_count
  );
end
$function$;

alter function listing_action_private.prepare_listing_account_retirement_impl(uuid, uuid)
  owner to postgres;
revoke all on function listing_action_private.prepare_listing_account_retirement_impl(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function listing_action_private.prepare_listing_account_retirement_impl(uuid, uuid)
  to service_role;

create or replace function public.prepare_listing_account_retirement(
  p_actor_user_id uuid,
  p_operation_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
begin atomic
  select listing_action_private.prepare_listing_account_retirement_impl(
    p_actor_user_id, p_operation_id
  );
end;

alter function public.prepare_listing_account_retirement(uuid, uuid) owner to postgres;
revoke all on function public.prepare_listing_account_retirement(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.prepare_listing_account_retirement(uuid, uuid)
  to service_role;

create or replace function listing_action_private.finalize_listing_account_retirement_impl(
  p_actor_user_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare retirement_row listing_action_private.account_retirements%rowtype;
begin
  perform listing_action_private.require_listing_cleanup_service();
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('listing-write-actor:' || p_actor_user_id::text, 0)
  );
  select * into retirement_row
  from listing_action_private.account_retirements retirement
  where retirement.actor_user_id_snapshot = p_actor_user_id
  for update;
  if not found or retirement_row.operation_id is distinct from p_operation_id then
    raise exception using
      errcode = '40001', message = 'listing_account_retirement_conflict';
  end if;
  if retirement_row.state = 'complete' then
    return pg_catalog.jsonb_build_object(
      'actor_user_id', p_actor_user_id,
      'operation_id', p_operation_id,
      'state', 'complete',
      'completed_at', retirement_row.completed_at
    );
  end if;
  if exists (
    select 1 from listing_action_private.image_cleanup_tasks task
    where task.actor_user_id_snapshot = p_actor_user_id
      and task.state <> 'cleaned'
  ) or exists (
    select 1 from public.listing_images image
    join public.listings listing on listing.id = image.listing_id
    where listing.seller_id = p_actor_user_id
  ) or exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'listing-images'
      and pg_catalog.split_part(object.name, '/', 1) = p_actor_user_id::text
  ) then
    raise exception using errcode = '55000', message = 'listing_account_cleanup_incomplete';
  end if;

  insert into listing_action_private.write_intent_tombstones(
    actor_user_id_snapshot, operation_id, action, signature_hash,
    terminal_state, payload_hash, result_hash, completed_at
  )
  select intent.actor_user_id, intent.operation_id, intent.action,
      intent.signature_hash,
      case when intent.stage = 'aborted' then 'aborted' else 'committed' end,
      pg_catalog.md5(intent.signature_hash),
      pg_catalog.md5(intent.safe_result::text),
      coalesce(intent.terminal_at, pg_catalog.statement_timestamp())
  from listing_action_private.write_intents intent
  where intent.actor_user_id = p_actor_user_id
  on conflict (actor_user_id_snapshot, operation_id) do nothing;
  update listing_action_private.write_intents intent
  set safe_result = '{}'::jsonb,
      scrubbed_at = pg_catalog.statement_timestamp(),
      updated_at = pg_catalog.statement_timestamp()
  where intent.actor_user_id = p_actor_user_id
    and intent.scrubbed_at is null;
  update listing_action_private.account_retirements retirement
  set state = 'complete', completed_at = pg_catalog.statement_timestamp(),
      updated_at = pg_catalog.statement_timestamp()
  where retirement.actor_user_id_snapshot = p_actor_user_id
  returning * into retirement_row;
  return pg_catalog.jsonb_build_object(
    'actor_user_id', p_actor_user_id,
    'operation_id', p_operation_id,
    'state', 'complete',
    'completed_at', retirement_row.completed_at
  );
end
$function$;

alter function listing_action_private.finalize_listing_account_retirement_impl(uuid, uuid)
  owner to postgres;
revoke all on function listing_action_private.finalize_listing_account_retirement_impl(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function listing_action_private.finalize_listing_account_retirement_impl(uuid, uuid)
  to service_role;

create or replace function public.finalize_listing_account_retirement(
  p_actor_user_id uuid,
  p_operation_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
begin atomic
  select listing_action_private.finalize_listing_account_retirement_impl(
    p_actor_user_id, p_operation_id
  );
end;

alter function public.finalize_listing_account_retirement(uuid, uuid) owner to postgres;
revoke all on function public.finalize_listing_account_retirement(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_listing_account_retirement(uuid, uuid)
  to service_role;

create or replace function listing_action_private.reconcile_stale_listing_write_intent(
  p_actor_user_id uuid,
  p_operation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  intent_row listing_action_private.write_intents%rowtype;
  listing_row public.listings%rowtype;
  has_dependencies boolean := false;
  listing_discarded boolean := false;
  cleanup_count integer := 0;
begin
  perform listing_action_private.require_listing_cleanup_service();
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'listing-write-actor:' || p_actor_user_id::text, 0
    )
  );
  select * into intent_row
  from listing_action_private.write_intents intent
  where intent.actor_user_id = p_actor_user_id
    and intent.operation_id = p_operation_id
  for update;
  if not found
    or intent_row.state not in ('begun', 'in_progress')
    or intent_row.updated_at > pg_catalog.statement_timestamp() - interval '24 hours' then
    return false;
  end if;

  perform reservation.storage_path
  from listing_action_private.image_upload_reservations reservation
  where reservation.actor_user_id_snapshot = p_actor_user_id
    and reservation.operation_id = p_operation_id
  order by reservation.storage_path
  for update;
  perform task.id
  from listing_action_private.image_cleanup_tasks task
  where task.actor_user_id_snapshot = p_actor_user_id
    and task.source_operation_id = p_operation_id
  order by task.id
  for update;
  update listing_action_private.image_upload_reservations reservation
  set state = 'cleanup_pending'
  where reservation.actor_user_id_snapshot = p_actor_user_id
    and reservation.operation_id = p_operation_id
    and reservation.state = 'reserved';
  insert into listing_action_private.image_cleanup_tasks(
    actor_user_id_snapshot, listing_id_snapshot, source_operation_id,
    storage_path, reason
  )
  select reservation.actor_user_id_snapshot, reservation.listing_id_snapshot,
      reservation.operation_id, reservation.storage_path, 'abandoned_upload'
  from listing_action_private.image_upload_reservations reservation
  where reservation.actor_user_id_snapshot = p_actor_user_id
    and reservation.operation_id = p_operation_id
    and reservation.state = 'cleanup_pending'
  on conflict (storage_path) do nothing;

  if intent_row.action = 'create_listing' and intent_row.listing_id is not null then
    perform image.id
    from public.listing_images image
    where image.listing_id = intent_row.listing_id
    order by image.id
    for update;
    select * into listing_row
    from public.listings listing
    where listing.id = intent_row.listing_id
    for update;
    if found
      and listing_row.seller_id = p_actor_user_id
      and listing_row.content_revision = intent_row.expected_content_revision
      and listing_row.retired_at is null
      and listing_row.status in ('draft', 'inactive')
      and listing_row.moderation_reviewed_at is null then
      select exists (
        select 1 from public.reports report
        where report.listing_id = intent_row.listing_id
      ) or exists (
        select 1 from public.listing_moderation_history history
        where history.listing_id = intent_row.listing_id
      ) or exists (
        select 1 from public.conversations conversation
        where conversation.listing_id = intent_row.listing_id
      ) into has_dependencies;
      if not has_dependencies then
        insert into listing_action_private.image_cleanup_tasks(
          actor_user_id_snapshot, listing_id_snapshot, source_operation_id,
          storage_path, reason
        )
        select p_actor_user_id, image.listing_id, p_operation_id,
          image.storage_path, 'abandoned_upload'
        from public.listing_images image
        where image.listing_id = intent_row.listing_id
          and image.storage_path is not null
        on conflict (storage_path) do nothing;
        perform pg_catalog.set_config(
          'app.listing_integrity_context', 'discard_draft', true
        );
        delete from public.listing_images image
        where image.listing_id = intent_row.listing_id;
        delete from public.listings listing
        where listing.id = intent_row.listing_id;
        perform pg_catalog.set_config('app.listing_integrity_context', '', true);
        listing_discarded := true;
      end if;
    end if;
  end if;

  select pg_catalog.count(*) into cleanup_count
  from listing_action_private.image_cleanup_tasks task
  where task.actor_user_id_snapshot = p_actor_user_id
    and task.source_operation_id = p_operation_id
    and task.state <> 'cleaned';
  update listing_action_private.write_intents intent
  set state = case when cleanup_count > 0 then 'cleanup_pending' else 'aborted' end,
      stage = 'aborted',
      safe_result = pg_catalog.jsonb_build_object(
        'listing_id', intent_row.listing_id,
        'listing_discarded', listing_discarded,
        'cleanup_pending', cleanup_count > 0,
        'cleanup_task_count', cleanup_count
      ),
      terminal_at = pg_catalog.statement_timestamp(),
      cleanup_completed_at = case when cleanup_count = 0
        then pg_catalog.statement_timestamp() else null end,
      updated_at = pg_catalog.statement_timestamp()
  where intent.actor_user_id = p_actor_user_id
    and intent.operation_id = p_operation_id;
  return true;
end
$function$;

alter function listing_action_private.reconcile_stale_listing_write_intent(uuid, uuid)
  owner to postgres;
revoke all on function listing_action_private.reconcile_stale_listing_write_intent(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function listing_action_private.reconcile_stale_listing_write_intent(uuid, uuid)
  to service_role;

create or replace function listing_action_private.maintain_listing_write_recovery_impl(
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_record record;
  intent_record record;
  expired_reservations integer := 0;
  actor_expired integer := 0;
  reconciled_intents integer := 0;
  scrubbed_intents integer := 0;
  compacted_commands integer := 0;
  purged_cleanup_tasks integer := 0;
  purged_reservations integer := 0;
  purged_intents integer := 0;
  purged_tombstones integer := 0;
  purged_commands integer := 0;
begin
  perform listing_action_private.require_listing_cleanup_service();
  if p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'listing_cleanup_limit_invalid';
  end if;

  for actor_record in
    select distinct reservation.actor_user_id_snapshot as actor_id
    from listing_action_private.image_upload_reservations reservation
    where reservation.state = 'reserved'
      and reservation.expires_at <= pg_catalog.statement_timestamp()
    order by reservation.actor_user_id_snapshot
    limit p_limit
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'listing-write-actor:' || actor_record.actor_id::text, 0
      )
    );
    perform intent.operation_id
    from listing_action_private.write_intents intent
    where intent.actor_user_id = actor_record.actor_id
    order by intent.operation_id
    for update;
    perform reservation.storage_path
    from listing_action_private.image_upload_reservations reservation
    where reservation.actor_user_id_snapshot = actor_record.actor_id
      and reservation.state = 'reserved'
      and reservation.expires_at <= pg_catalog.statement_timestamp()
    order by reservation.storage_path
    for update;
    perform task.id
    from listing_action_private.image_cleanup_tasks task
    where task.actor_user_id_snapshot = actor_record.actor_id
    order by task.id
    for update;
    update listing_action_private.image_upload_reservations reservation
    set state = 'cleanup_pending'
    where reservation.actor_user_id_snapshot = actor_record.actor_id
      and reservation.state = 'reserved'
      and reservation.expires_at <= pg_catalog.statement_timestamp();
    get diagnostics actor_expired = row_count;
    expired_reservations := expired_reservations + actor_expired;
    insert into listing_action_private.image_cleanup_tasks(
      actor_user_id_snapshot, listing_id_snapshot, source_operation_id,
      storage_path, reason
    )
    select reservation.actor_user_id_snapshot, reservation.listing_id_snapshot,
        reservation.operation_id, reservation.storage_path, 'abandoned_upload'
    from listing_action_private.image_upload_reservations reservation
    where reservation.actor_user_id_snapshot = actor_record.actor_id
      and reservation.state = 'cleanup_pending'
    on conflict (storage_path) do nothing;
  end loop;

  for intent_record in
    select intent.actor_user_id, intent.operation_id
    from listing_action_private.write_intents intent
    where intent.state in ('begun', 'in_progress')
      and intent.updated_at <= pg_catalog.statement_timestamp() - interval '24 hours'
    order by intent.updated_at, intent.actor_user_id, intent.operation_id
    limit p_limit
  loop
    if listing_action_private.reconcile_stale_listing_write_intent(
      intent_record.actor_user_id, intent_record.operation_id
    ) then
      reconciled_intents := reconciled_intents + 1;
    end if;
  end loop;

  with candidates as (
    select intent.actor_user_id, intent.operation_id
    from listing_action_private.write_intents intent
    where intent.scrubbed_at is null
      and intent.state in ('committed', 'aborted')
      and intent.replay_expires_at <= pg_catalog.statement_timestamp()
      and not exists (
        select 1
        from listing_action_private.image_cleanup_tasks task
        where task.actor_user_id_snapshot = intent.actor_user_id
          and task.source_operation_id = intent.operation_id
          and task.state <> 'cleaned'
      )
    order by intent.replay_expires_at, intent.actor_user_id, intent.operation_id
    for update skip locked
    limit p_limit
  ), tombstoned as (
    insert into listing_action_private.write_intent_tombstones(
      actor_user_id_snapshot, operation_id, action, signature_hash,
      terminal_state, payload_hash, result_hash, completed_at
    )
    select intent.actor_user_id, intent.operation_id, intent.action,
      intent.signature_hash, intent.state,
      pg_catalog.md5(intent.signature_hash),
      pg_catalog.md5(intent.safe_result::text),
      coalesce(intent.terminal_at, intent.updated_at)
    from listing_action_private.write_intents intent
    join candidates on candidates.actor_user_id = intent.actor_user_id
      and candidates.operation_id = intent.operation_id
    on conflict (actor_user_id_snapshot, operation_id) do nothing
    returning actor_user_id_snapshot, operation_id
  )
  update listing_action_private.write_intents intent
  set safe_result = '{}'::jsonb,
      scrubbed_at = pg_catalog.statement_timestamp(),
      updated_at = pg_catalog.statement_timestamp()
  from candidates
  where intent.actor_user_id = candidates.actor_user_id
    and intent.operation_id = candidates.operation_id;
  get diagnostics scrubbed_intents = row_count;

  with candidates as (
    select command.actor_user_id, command.operation_id
    from listing_action_private.write_command_results command
    where command.scrubbed_at is null
      and command.replay_expires_at <= pg_catalog.statement_timestamp()
      and not exists (
        select 1 from listing_action_private.image_cleanup_tasks task
        where task.actor_user_id_snapshot = command.actor_user_id
          and task.source_operation_id = command.operation_id
          and task.state <> 'cleaned'
      )
    order by command.replay_expires_at, command.actor_user_id, command.operation_id
    for update skip locked
    limit p_limit
  )
  update listing_action_private.write_command_results command
  set payload = '{}'::jsonb,
      result = '{}'::jsonb,
      scrubbed_at = pg_catalog.statement_timestamp()
  from candidates
  where command.actor_user_id = candidates.actor_user_id
    and command.operation_id = candidates.operation_id;
  get diagnostics compacted_commands = row_count;

  with candidates as (
    select task.id
    from listing_action_private.image_cleanup_tasks task
    where task.state = 'cleaned'
      and task.cleaned_at <= pg_catalog.statement_timestamp() - interval '30 days'
    order by task.cleaned_at, task.id
    for update skip locked
    limit p_limit
  )
  delete from listing_action_private.image_cleanup_tasks task
  using candidates
  where task.id = candidates.id;
  get diagnostics purged_cleanup_tasks = row_count;

  with candidates as (
    select reservation.storage_path
    from listing_action_private.image_upload_reservations reservation
    join listing_action_private.write_intents intent
      on intent.actor_user_id = reservation.actor_user_id_snapshot
      and intent.operation_id = reservation.operation_id
    where reservation.state in ('consumed', 'cleaned')
      and intent.replay_expires_at <= pg_catalog.statement_timestamp()
      and not exists (
        select 1 from listing_action_private.image_cleanup_tasks task
        where task.storage_path = reservation.storage_path
          and task.state <> 'cleaned'
      )
    order by reservation.storage_path
    for update of reservation skip locked
    limit p_limit
  )
  delete from listing_action_private.image_upload_reservations reservation
  using candidates
  where reservation.storage_path = candidates.storage_path;
  get diagnostics purged_reservations = row_count;

  with candidates as (
    select intent.actor_user_id, intent.operation_id
    from listing_action_private.write_intents intent
    where intent.scrubbed_at <= pg_catalog.statement_timestamp() - interval '30 days'
      and not exists (
        select 1 from listing_action_private.image_upload_reservations reservation
        where reservation.actor_user_id_snapshot = intent.actor_user_id
          and reservation.operation_id = intent.operation_id
      )
      and not exists (
        select 1 from listing_action_private.image_cleanup_tasks task
        where task.actor_user_id_snapshot = intent.actor_user_id
          and task.source_operation_id = intent.operation_id
      )
    order by intent.scrubbed_at, intent.actor_user_id, intent.operation_id
    for update skip locked
    limit p_limit
  )
  delete from listing_action_private.write_intents intent
  using candidates
  where intent.actor_user_id = candidates.actor_user_id
    and intent.operation_id = candidates.operation_id;
  get diagnostics purged_intents = row_count;

  with candidates as (
    select tombstone.actor_user_id_snapshot, tombstone.operation_id
    from listing_action_private.write_intent_tombstones tombstone
    where tombstone.scrubbed_at
      <= pg_catalog.statement_timestamp() - interval '90 days'
    order by tombstone.scrubbed_at, tombstone.actor_user_id_snapshot,
      tombstone.operation_id
    for update skip locked
    limit p_limit
  )
  delete from listing_action_private.write_intent_tombstones tombstone
  using candidates
  where tombstone.actor_user_id_snapshot = candidates.actor_user_id_snapshot
    and tombstone.operation_id = candidates.operation_id;
  get diagnostics purged_tombstones = row_count;

  with candidates as (
    select command.actor_user_id, command.operation_id
    from listing_action_private.write_command_results command
    where command.scrubbed_at
      <= pg_catalog.statement_timestamp() - interval '90 days'
    order by command.scrubbed_at, command.actor_user_id, command.operation_id
    for update skip locked
    limit p_limit
  )
  delete from listing_action_private.write_command_results command
  using candidates
  where command.actor_user_id = candidates.actor_user_id
    and command.operation_id = candidates.operation_id;
  get diagnostics purged_commands = row_count;

  return pg_catalog.jsonb_build_object(
    'expired_reservations_enqueued', expired_reservations,
    'reconciled_intents', reconciled_intents,
    'scrubbed_intents', scrubbed_intents,
    'compacted_commands', compacted_commands,
    'purged_cleanup_tasks', purged_cleanup_tasks,
    'purged_reservations', purged_reservations,
    'purged_intents', purged_intents,
    'purged_tombstones', purged_tombstones,
    'purged_commands', purged_commands
  );
end
$function$;

alter function listing_action_private.maintain_listing_write_recovery_impl(integer)
  owner to postgres;
revoke all on function listing_action_private.maintain_listing_write_recovery_impl(integer)
  from public, anon, authenticated, service_role;
grant execute on function listing_action_private.maintain_listing_write_recovery_impl(integer)
  to service_role;

create or replace function public.maintain_listing_write_recovery(
  p_limit integer default 100
)
returns jsonb
language sql
security invoker
set search_path = ''
begin atomic
  select listing_action_private.maintain_listing_write_recovery_impl(p_limit);
end;

alter function public.maintain_listing_write_recovery(integer) owner to postgres;
revoke all on function public.maintain_listing_write_recovery(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.maintain_listing_write_recovery(integer)
  to service_role;

comment on table listing_action_private.write_intents is
  'Private actor-scoped durable listing write lifecycle. Public callers receive only bounded safe projections through invoker wrappers.';
comment on table listing_action_private.image_upload_reservations is
  'Private exact-path upload reservations consumed atomically by a listing metadata commit or converted to cleanup tasks.';
comment on table listing_action_private.image_cleanup_tasks is
  'Private bounded Storage cleanup queue. Object deletion occurs through Storage APIs; database completion requires the object and metadata reference to be absent.';
