-- Stage 3 announcement cutover.
--
-- The Stage 2 outbox deliberately refused to accept caller-created in-app
-- output references. This migration installs the only supported in-app
-- delivery boundary: a postgres-owned, lease-validated transaction that
-- creates the compatibility conversation/message/notification output and
-- finalizes its durable delivery/outbox rows together.

do $migration$
declare
  type_constraint_name text;
begin
  select constraint_row.conname
  into type_constraint_name
  from pg_constraint constraint_row
  join pg_class table_row on table_row.oid = constraint_row.conrelid
  join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
  join pg_attribute column_row
    on column_row.attrelid = table_row.oid
    and column_row.attname = 'type'
  where schema_row.nspname = 'public'
    and table_row.relname = 'notifications'
    and constraint_row.contype = 'c'
    and constraint_row.conkey = array[column_row.attnum]::smallint[]
  order by constraint_row.conname
  limit 1;

  if type_constraint_name is not null then
    execute format(
      'alter table public.notifications drop constraint %I',
      type_constraint_name
    );
  end if;
end
$migration$;

alter table public.notifications
  add constraint notifications_type_check
  check (type = any (array[
    'message',
    'messages',
    'announcement',
    'favourite_sold',
    'favourite_unavailable',
    'favourite_price_change',
    'listing_sold',
    'listing_approved',
    'listing_rejected',
    'moderator_role_granted'
  ]::text[]));

comment on constraint notifications_type_check on public.notifications is
  'announcement is an always-on in-app system notice. It intentionally has no ordinary notification-preference or email-queue mapping.';

alter table public.announcement_delivery_outbox
  add column completed_lease_token uuid;

comment on column public.announcement_delivery_outbox.completed_lease_token is
  'Immutable token snapshot used only to make a lost-response retry of the atomic in-app delivery RPC idempotent. Never exposed to recipients.';

create or replace function private.enforce_announcement_completed_lease_token()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  write_scope text := coalesce(
    current_setting('smot.announcement_outbox_write_scope', true),
    ''
  );
begin
  if tg_op = 'INSERT' then
    if new.completed_lease_token is not null then
      raise exception 'announcement_completed_lease_token_must_start_empty';
    end if;
    return new;
  end if;

  if old.completed_lease_token is not null
    and new.completed_lease_token is distinct from old.completed_lease_token then
    raise exception 'announcement_completed_lease_token_is_immutable';
  end if;

  if old.completed_lease_token is null
    and new.completed_lease_token is not null
    and (
      write_scope <> 'finish'
      or old.queue_status <> 'leased'
      or new.queue_status <> 'completed'
      or new.completed_lease_token is distinct from old.lease_token
    ) then
    raise exception 'announcement_completed_lease_token_requires_atomic_finish';
  end if;

  return new;
end
$function$;

alter function private.enforce_announcement_completed_lease_token()
  owner to postgres;
revoke all on function private.enforce_announcement_completed_lease_token()
  from public, anon, authenticated, service_role;

create trigger enforce_announcement_completed_lease_token
before insert or update on public.announcement_delivery_outbox
for each row execute function private.enforce_announcement_completed_lease_token();

create table public.announcement_dispatch_state (
  announcement_id uuid primary key
    references public.announcements(id) on delete restrict,
  next_recipient_id uuid,
  audience_cutoff_at timestamptz not null default now(),
  audience_exhausted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcement_dispatch_state_updated_at_check
    check (updated_at >= created_at)
);

comment on table public.announcement_dispatch_state is
  'Internal durable cursor for bounded audience expansion. A worker can resume after a timeout or deployment without skipping recipients.';

create or replace function private.guard_announcement_dispatch_state_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception 'announcement_dispatch_state_is_durable';
end
$function$;

alter function private.guard_announcement_dispatch_state_delete() owner to postgres;
revoke all on function private.guard_announcement_dispatch_state_delete()
  from public, anon, authenticated, service_role;

create trigger guard_announcement_dispatch_state_delete
before delete on public.announcement_dispatch_state
for each row execute function private.guard_announcement_dispatch_state_delete();

create or replace function private.enqueue_announcement_audience_batch_impl(
  p_announcement_id uuid,
  p_batch_size integer default 100,
  p_max_attempts integer default 5
)
returns table(
  enqueued_count integer,
  next_cursor uuid,
  exhausted boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_announcement public.announcements%rowtype;
  candidate record;
  dispatch_state public.announcement_dispatch_state%rowtype;
  last_candidate_id uuid;
  candidate_count integer := 0;
  has_more boolean := false;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'announcement_batch_enqueue_requires_service_role'
      using errcode = '42501';
  end if;
  if p_batch_size not between 1 and 100 then
    raise exception 'invalid_announcement_enqueue_batch_size'
      using errcode = '22023';
  end if;
  if p_max_attempts not between 1 and 20 then
    raise exception 'invalid_announcement_max_attempts'
      using errcode = '22023';
  end if;

  select * into current_announcement
  from public.announcements
  where id = p_announcement_id
  for update;

  if not found then
    raise exception 'announcement_not_found' using errcode = 'P0002';
  end if;
  if current_announcement.status <> 'sending' then
    raise exception 'announcement_is_not_sending' using errcode = '55000';
  end if;
  if current_announcement.email_enabled then
    raise exception 'announcement_email_worker_not_configured' using errcode = '55000';
  end if;
  if current_announcement.audience_type = 'case' then
    raise exception 'announcement_case_audience_not_configured' using errcode = '55000';
  end if;

  insert into public.announcement_dispatch_state (
    announcement_id,
    audience_cutoff_at
  ) values (
    p_announcement_id,
    current_announcement.sending_started_at
  )
  on conflict (announcement_id) do nothing;

  select * into dispatch_state
  from public.announcement_dispatch_state
  where announcement_id = p_announcement_id
  for update;

  if dispatch_state.audience_exhausted then
    return query select 0, null::uuid, true;
    return;
  end if;

  for candidate in
    select profile.id
    from public.profiles profile
    join auth.users auth_user on auth_user.id = profile.id
    where (dispatch_state.next_recipient_id is null or profile.id > dispatch_state.next_recipient_id)
      and profile.created_at <= dispatch_state.audience_cutoff_at
      and profile.id <> current_announcement.updated_by_snapshot
      and (auth_user.banned_until is null or auth_user.banned_until <= now())
      and not exists (
        select 1
        from public.user_status recipient_status
        where recipient_status.user_id = profile.id
          and recipient_status.is_banned
          and (
            recipient_status.banned_until is null
            or recipient_status.banned_until > now()
          )
      )
      and not exists (
        select 1
        from public.announcement_deliveries existing_delivery
        where existing_delivery.announcement_id = p_announcement_id
          and existing_delivery.recipient_user_id_snapshot = profile.id
      )
      and (
        current_announcement.audience_type = 'all'
        or (
          current_announcement.audience_type = 'school'
          and exists (
            select 1
            from jsonb_array_elements_text(
              current_announcement.audience_filter -> 'schools'
            ) school(value)
            where lower(btrim(school.value)) = lower(btrim(coalesce(profile.school, '')))
          )
        )
        or (
          current_announcement.audience_type = 'selected'
          and (current_announcement.audience_filter -> 'user_ids') ? profile.id::text
        )
        or (
          current_announcement.audience_type = 'role'
          and exists (
            select 1
            from jsonb_array_elements_text(
              current_announcement.audience_filter -> 'roles'
            ) requested_role(value)
            where lower(btrim(requested_role.value)) = case
              when lower(btrim(coalesce(auth_user.raw_app_meta_data ->> 'role', ''))) in
                ('staff', 'moderator', 'admin')
                then lower(btrim(auth_user.raw_app_meta_data ->> 'role'))
              when exists (
                select 1
                from jsonb_array_elements_text(
                  case
                    when jsonb_typeof(auth_user.raw_app_meta_data -> 'roles') = 'array'
                      then auth_user.raw_app_meta_data -> 'roles'
                    else '[]'::jsonb
                  end
                ) assigned_role(value)
                where lower(btrim(assigned_role.value)) = 'admin'
              ) then 'admin'
              when exists (
                select 1
                from jsonb_array_elements_text(
                  case
                    when jsonb_typeof(auth_user.raw_app_meta_data -> 'roles') = 'array'
                      then auth_user.raw_app_meta_data -> 'roles'
                    else '[]'::jsonb
                  end
                ) assigned_role(value)
                where lower(btrim(assigned_role.value)) = 'moderator'
              ) then 'moderator'
              when exists (
                select 1
                from jsonb_array_elements_text(
                  case
                    when jsonb_typeof(auth_user.raw_app_meta_data -> 'roles') = 'array'
                      then auth_user.raw_app_meta_data -> 'roles'
                    else '[]'::jsonb
                  end
                ) assigned_role(value)
                where lower(btrim(assigned_role.value)) = 'staff'
              ) then 'staff'
              else 'member'
            end
          )
        )
      )
    order by profile.id
    limit p_batch_size + 1
  loop
    if candidate_count >= p_batch_size then
      has_more := true;
      exit;
    end if;

    perform private.enqueue_announcement_delivery_impl(
      p_announcement_id,
      candidate.id,
      true,
      false,
      p_max_attempts
    );
    candidate_count := candidate_count + 1;
    last_candidate_id := candidate.id;
  end loop;

  update public.announcement_dispatch_state
  set
    next_recipient_id = case when has_more then last_candidate_id else next_recipient_id end,
    audience_exhausted = not has_more,
    updated_at = now()
  where announcement_id = p_announcement_id;

  return query select
    candidate_count,
    case when has_more then last_candidate_id else null end,
    not has_more;
end
$function$;

alter function private.enqueue_announcement_audience_batch_impl(uuid, integer, integer)
  owner to postgres;
revoke all on function private.enqueue_announcement_audience_batch_impl(uuid, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function private.enqueue_announcement_audience_batch_impl(uuid, integer, integer)
  to service_role;

create or replace function public.enqueue_announcement_audience_batch(
  p_announcement_id uuid,
  p_batch_size integer default 100,
  p_max_attempts integer default 5
)
returns table(
  enqueued_count integer,
  next_cursor uuid,
  exhausted boolean
)
language sql
security invoker
set search_path = ''
as $function$
  select * from private.enqueue_announcement_audience_batch_impl(
    p_announcement_id,
    p_batch_size,
    p_max_attempts
  );
$function$;

alter function public.enqueue_announcement_audience_batch(uuid, integer, integer)
  owner to postgres;
revoke all on function public.enqueue_announcement_audience_batch(uuid, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.enqueue_announcement_audience_batch(uuid, integer, integer)
  to service_role;

create or replace function private.deliver_announcement_in_app_impl(
  p_delivery_id uuid,
  p_lease_token uuid
)
returns table(
  delivery_id uuid,
  announcement_id uuid,
  conversation_id uuid,
  message_id uuid,
  notification_id uuid,
  delivery_status text,
  queue_status text,
  idempotent_replay boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_announcement public.announcements%rowtype;
  current_delivery public.announcement_deliveries%rowtype;
  current_outbox public.announcement_delivery_outbox%rowtype;
  sender_user_id uuid;
  output_conversation_id uuid := gen_random_uuid();
  output_message_id uuid := gen_random_uuid();
  output_notification_id uuid := gen_random_uuid();
  delivered_at_value timestamptz := now();
  message_preview text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'announcement_atomic_delivery_requires_service_role'
      using errcode = '42501';
  end if;
  if p_delivery_id is null or p_lease_token is null then
    raise exception 'announcement_delivery_lease_required' using errcode = '22023';
  end if;

  select announcement.* into current_announcement
  from public.announcements announcement
  join public.announcement_deliveries delivery
    on delivery.announcement_id = announcement.id
  where delivery.id = p_delivery_id
  for update of announcement;

  if not found then
    raise exception 'announcement_delivery_not_found' using errcode = 'P0002';
  end if;

  select * into current_delivery
  from public.announcement_deliveries
  where id = p_delivery_id
  for update;

  select outbox.* into current_outbox
  from public.announcement_delivery_outbox outbox
  where outbox.delivery_id = p_delivery_id
  for update of outbox;

  if current_delivery.status = 'delivered'
    and current_outbox.queue_status = 'completed'
    and current_outbox.completed_lease_token = p_lease_token then
    return query select
      current_delivery.id,
      current_delivery.announcement_id,
      current_delivery.conversation_id_snapshot,
      current_delivery.message_id_snapshot,
      current_delivery.notification_id_snapshot,
      current_delivery.status,
      current_outbox.queue_status,
      true;
    return;
  end if;

  if current_announcement.status <> 'sending' then
    raise exception 'announcement_is_not_sending' using errcode = '55000';
  end if;
  if current_delivery.status <> 'processing'
    or current_delivery.recipient_user_id is null
    or current_delivery.recipient_user_id <> current_delivery.recipient_user_id_snapshot then
    raise exception 'announcement_delivery_is_not_processable' using errcode = '55000';
  end if;
  if current_outbox.queue_status <> 'leased'
    or current_outbox.lease_token is distinct from p_lease_token
    or current_outbox.lease_expires_at <= delivered_at_value then
    raise exception 'announcement_delivery_lease_invalid' using errcode = '55000';
  end if;
  if not current_outbox.send_in_app then
    raise exception 'announcement_in_app_channel_not_enabled' using errcode = '55000';
  end if;
  if current_outbox.send_email then
    raise exception 'announcement_mixed_channel_worker_not_configured' using errcode = '55000';
  end if;

  sender_user_id := current_announcement.updated_by_snapshot;
  if sender_user_id is null
    or sender_user_id = current_delivery.recipient_user_id_snapshot
    or not exists (select 1 from public.profiles where id = sender_user_id) then
    raise exception 'announcement_sender_not_available' using errcode = '55000';
  end if;

  message_preview := substring(
    regexp_replace(btrim(current_announcement.body), '[[:space:]]+', ' ', 'g')
    from 1 for 100
  );

  -- This transaction-local scope is consumed by the Stage 3-B message guard.
  -- It is set only after the canonical parent -> delivery -> outbox locks and
  -- all parent/lease/channel checks above. The target conversation is created
  -- here with listing_id NULL and is never accepted for participant writes.
  perform set_config('smot.conversation_write_scope', 'announcement_delivery', true);

  insert into public.conversations (
    id, listing_id, buyer_id, seller_id,
    last_message_at, last_message_preview, created_at, updated_at
  ) values (
    output_conversation_id, null,
    current_delivery.recipient_user_id_snapshot, sender_user_id,
    delivered_at_value, message_preview, delivered_at_value, delivered_at_value
  );

  insert into public.messages (
    id, conversation_id, sender_id, body, created_at
  ) values (
    output_message_id, output_conversation_id, sender_user_id,
    current_announcement.body, delivered_at_value
  );

  insert into public.notifications (
    id, user_id, type, conversation_id, message_id,
    listing_id, metadata, created_at
  ) values (
    output_notification_id,
    current_delivery.recipient_user_id_snapshot,
    'announcement', output_conversation_id, output_message_id,
    null,
    jsonb_build_object(
      'announcement_id', current_announcement.id,
      'announcement_delivery_id', current_delivery.id,
      'title', current_announcement.title,
      'category', current_announcement.category,
      'priority', current_announcement.priority
    ),
    delivered_at_value
  );

  perform set_config('smot.conversation_write_scope', '', true);

  insert into public.conversation_user_state (
    conversation_id, user_id, hidden_at, created_at, updated_at
  ) values (
    output_conversation_id, sender_user_id, delivered_at_value,
    delivered_at_value, delivered_at_value
  )
  on conflict on constraint conversation_user_state_pkey do update
    set hidden_at = excluded.hidden_at, updated_at = excluded.updated_at;

  perform set_config('smot.announcement_delivery_write_scope', 'finish', true);
  update public.announcement_deliveries
  set
    status = 'delivered',
    conversation_id = output_conversation_id,
    message_id = output_message_id,
    notification_id = output_notification_id
  where id = p_delivery_id;
  perform set_config('smot.announcement_delivery_write_scope', '', true);

  perform set_config('smot.announcement_outbox_write_scope', 'finish', true);
  update public.announcement_delivery_outbox outbox
  set
    queue_status = 'completed',
    completed_lease_token = p_lease_token,
    last_error = null
  where outbox.delivery_id = p_delivery_id;
  perform set_config('smot.announcement_outbox_write_scope', '', true);

  return query
    select
      delivery.id,
      delivery.announcement_id,
      delivery.conversation_id_snapshot,
      delivery.message_id_snapshot,
      delivery.notification_id_snapshot,
      delivery.status,
      outbox.queue_status,
      false
    from public.announcement_deliveries delivery
    join public.announcement_delivery_outbox outbox
      on outbox.delivery_id = delivery.id
    where delivery.id = p_delivery_id;
end
$function$;

alter function private.deliver_announcement_in_app_impl(uuid, uuid)
  owner to postgres;
revoke all on function private.deliver_announcement_in_app_impl(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.deliver_announcement_in_app_impl(uuid, uuid)
  to service_role;

create or replace function public.deliver_announcement_in_app(
  p_delivery_id uuid,
  p_lease_token uuid
)
returns table(
  delivery_id uuid,
  announcement_id uuid,
  conversation_id uuid,
  message_id uuid,
  notification_id uuid,
  delivery_status text,
  queue_status text,
  idempotent_replay boolean
)
language sql
security invoker
set search_path = ''
as $function$
  select * from private.deliver_announcement_in_app_impl(
    p_delivery_id,
    p_lease_token
  );
$function$;

alter function public.deliver_announcement_in_app(uuid, uuid)
  owner to postgres;
revoke all on function public.deliver_announcement_in_app(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.deliver_announcement_in_app(uuid, uuid)
  to service_role;

comment on function public.deliver_announcement_in_app(uuid, uuid) is
  'Stage 3 atomic worker boundary. Validates the live lease and sending parent, creates one listing-null compatibility conversation/message/notification, snapshots output IDs, and completes the outbox in one transaction. A same-token lost-response retry returns the existing outputs.';

create or replace function private.get_announcement_terminal_state_impl(
  p_announcement_id uuid
)
returns table(
  announcement_id uuid,
  announcement_version integer,
  actor_user_id uuid,
  audience_exhausted boolean,
  deliveries_terminal boolean,
  has_terminal_failure boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'announcement_terminal_state_requires_service_role'
      using errcode = '42501';
  end if;

  return query
    select
      announcement.id,
      announcement.version,
      announcement.updated_by_snapshot,
      coalesce(dispatch.audience_exhausted, false),
      coalesce(dispatch.audience_exhausted, false)
        and not exists (
          select 1
          from public.announcement_deliveries delivery
          left join public.announcement_delivery_outbox outbox
            on outbox.delivery_id = delivery.id
          where delivery.announcement_id = announcement.id
            and (
              outbox.delivery_id is null
              or not (
                (delivery.status = 'delivered' and outbox.queue_status = 'completed')
                or (delivery.status = 'failed' and outbox.queue_status = 'dead')
                or (delivery.status = 'skipped' and outbox.queue_status = 'completed')
                or (delivery.status = 'cancelled' and outbox.queue_status = 'cancelled')
              )
            )
        ),
      exists (
        select 1
        from public.announcement_deliveries delivery
        join public.announcement_delivery_outbox outbox
          on outbox.delivery_id = delivery.id
        where delivery.announcement_id = announcement.id
          and delivery.status = 'failed'
          and outbox.queue_status = 'dead'
      )
    from public.announcements announcement
    left join public.announcement_dispatch_state dispatch
      on dispatch.announcement_id = announcement.id
    where announcement.id = p_announcement_id
      and announcement.status = 'sending';
end
$function$;

alter function private.get_announcement_terminal_state_impl(uuid)
  owner to postgres;
revoke all on function private.get_announcement_terminal_state_impl(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.get_announcement_terminal_state_impl(uuid)
  to service_role;

create or replace function public.get_announcement_terminal_state(
  p_announcement_id uuid
)
returns table(
  announcement_id uuid,
  announcement_version integer,
  actor_user_id uuid,
  audience_exhausted boolean,
  deliveries_terminal boolean,
  has_terminal_failure boolean
)
language sql
security invoker
set search_path = ''
as $function$
  select * from private.get_announcement_terminal_state_impl(p_announcement_id);
$function$;

alter function public.get_announcement_terminal_state(uuid) owner to postgres;
revoke all on function public.get_announcement_terminal_state(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_announcement_terminal_state(uuid)
  to service_role;

alter table public.announcement_dispatch_state enable row level security;
revoke all on table public.announcement_dispatch_state
  from public, anon, authenticated, service_role;
grant select on table public.announcement_dispatch_state to service_role;
