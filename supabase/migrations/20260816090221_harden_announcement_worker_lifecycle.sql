-- Stage 3 announcement reliability hardening.
--
-- Campaign creation/start is a single idempotent command, workers rotate
-- fairly across campaigns, announcement output has no dependency on the
-- initiating administrator remaining active, and only the worker finalizer can
-- move a fully-expanded campaign into a terminal state.

alter table public.messages alter column sender_id drop not null;
alter table public.conversations alter column seller_id drop not null;

comment on column public.messages.sender_id is
  'Nullable only for postgres-owned announcement delivery. Participant message guards continue to require sender_id = auth.uid().';

comment on column public.conversations.seller_id is
  'Nullable only for listing-null senderless announcement conversations. Listing-backed participant conversations continue to require a seller through trusted creation paths.';

create schema if not exists announcement_worker_private;
revoke all on schema announcement_worker_private
  from public, anon, authenticated, service_role;

create or replace function private.guard_senderless_announcement_conversation_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.listing_id is not null then
    if new.seller_id is null then
      raise exception 'listing_conversation_seller_required' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.seller_id is not null
    or new.buyer_id is null
    or coalesce(current_setting('smot.conversation_write_scope', true), '')
      <> 'announcement_delivery'
    or current_user <> 'postgres'
    or coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'senderless_announcement_conversation_requires_atomic_worker'
      using errcode = '42501';
  end if;

  return new;
end
$function$;

alter function private.guard_senderless_announcement_conversation_insert()
  owner to postgres;
revoke all on function private.guard_senderless_announcement_conversation_insert()
  from public, anon, authenticated, service_role;

create trigger guard_senderless_announcement_conversation_insert
before insert on public.conversations
for each row execute function private.guard_senderless_announcement_conversation_insert();

alter table public.announcement_dispatch_state
  add column last_worker_attempt_at timestamptz,
  add column worker_attempt_count bigint not null default 0,
  add column last_delivery_claimed_at timestamptz,
  add constraint announcement_dispatch_worker_attempt_count_check
    check (worker_attempt_count >= 0);

create index announcement_dispatch_state_worker_fairness_idx
  on public.announcement_dispatch_state (
    last_worker_attempt_at asc nulls first,
    announcement_id
  );

create index announcement_dispatch_state_delivery_fairness_idx
  on public.announcement_dispatch_state (
    last_delivery_claimed_at asc nulls first,
    announcement_id
  );

create table public.announcement_send_commands (
  operation_id uuid primary key,
  announcement_id uuid not null unique
    references public.announcements(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_user_id_snapshot uuid not null,
  command_payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint announcement_send_commands_actor_snapshot_check
    check (actor_user_id is null or actor_user_id = actor_user_id_snapshot),
  constraint announcement_send_commands_payload_check
    check (jsonb_typeof(command_payload) = 'object' and octet_length(command_payload::text) <= 65536)
);

comment on table public.announcement_send_commands is
  'Durable idempotency ledger for atomic create-and-start commands. The canonical payload and actor snapshot prevent a key from being reused for different content.';

create or replace function private.guard_announcement_send_command_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE'
    and old.actor_user_id is not null
    and new.actor_user_id is null
    and old.operation_id is not distinct from new.operation_id
    and old.announcement_id is not distinct from new.announcement_id
    and old.actor_user_id_snapshot is not distinct from new.actor_user_id_snapshot
    and old.command_payload is not distinct from new.command_payload
    and old.created_at is not distinct from new.created_at then
    return new;
  end if;

  if tg_op <> 'INSERT'
    or coalesce(current_setting('smot.announcement_command_write_scope', true), '') <> 'create' then
    raise exception 'announcement_send_commands_are_immutable';
  end if;

  return new;
end
$function$;

alter function private.guard_announcement_send_command_lifecycle() owner to postgres;
revoke all on function private.guard_announcement_send_command_lifecycle()
  from public, anon, authenticated, service_role;

create trigger guard_announcement_send_command_lifecycle
before insert or update or delete on public.announcement_send_commands
for each row execute function private.guard_announcement_send_command_lifecycle();

alter table public.announcement_send_commands enable row level security;
revoke all on table public.announcement_send_commands
  from public, anon, authenticated, service_role;
grant select on table public.announcement_send_commands to service_role;

create or replace function announcement_worker_private.create_and_start_announcement_impl(
  p_operation_id uuid,
  p_title text,
  p_body text,
  p_category text,
  p_priority text,
  p_audience_type text,
  p_audience_filter jsonb,
  p_delivery_policy text,
  p_email_enabled boolean,
  p_actor_id uuid
)
returns setof public.announcements
language plpgsql
security definer
set search_path = ''
as $function$
declare
  existing_command public.announcement_send_commands%rowtype;
  current_announcement public.announcements%rowtype;
  canonical_payload jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'announcement_create_start_requires_service_role'
      using errcode = '42501';
  end if;
  if p_operation_id is null then
    raise exception 'announcement_operation_id_required' using errcode = '22023';
  end if;

  -- Replay is idempotent, but it is still a privileged admin command. A
  -- banned/demoted caller cannot use a known operation UUID as an API access
  -- bypass; the independent worker can continue the already-started campaign.
  perform private.require_active_announcement_admin(p_actor_id, now());

  canonical_payload := jsonb_build_object(
    'title', btrim(coalesce(p_title, '')),
    'body', btrim(coalesce(p_body, '')),
    'category', lower(btrim(coalesce(p_category, ''))),
    'priority', lower(btrim(coalesce(p_priority, ''))),
    'audience_type', lower(btrim(coalesce(p_audience_type, ''))),
    'audience_filter', coalesce(p_audience_filter, 'null'::jsonb),
    'delivery_policy', lower(btrim(coalesce(p_delivery_policy, ''))),
    'email_enabled', coalesce(p_email_enabled, false)
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_operation_id::text, 0)
  );

  select * into existing_command
  from public.announcement_send_commands
  where operation_id = p_operation_id;

  if found then
    if existing_command.actor_user_id_snapshot is distinct from p_actor_id
      or existing_command.command_payload is distinct from canonical_payload then
      raise exception 'announcement_operation_id_conflict' using errcode = '23505';
    end if;

    return query
      select * from public.announcements
      where id = existing_command.announcement_id;
    return;
  end if;

  select * into current_announcement
  from private.create_announcement_draft_impl(
    p_title,
    p_body,
    p_category,
    p_priority,
    p_audience_type,
    p_audience_filter,
    p_delivery_policy,
    p_email_enabled,
    p_actor_id,
    'announcement-command:' || p_operation_id::text || ':create'
  );

  select * into current_announcement
  from private.transition_announcement_impl(
    current_announcement.id,
    current_announcement.version,
    'start_sending',
    p_actor_id,
    null,
    'announcement-command:' || p_operation_id::text || ':start'
  );

  perform set_config('smot.announcement_command_write_scope', 'create', true);
  insert into public.announcement_send_commands (
    operation_id,
    announcement_id,
    actor_user_id,
    actor_user_id_snapshot,
    command_payload
  ) values (
    p_operation_id,
    current_announcement.id,
    p_actor_id,
    p_actor_id,
    canonical_payload
  );
  perform set_config('smot.announcement_command_write_scope', '', true);

  return query
    select * from public.announcements where id = current_announcement.id;
end
$function$;

alter function announcement_worker_private.create_and_start_announcement_impl(
  uuid, text, text, text, text, text, jsonb, text, boolean, uuid
) owner to postgres;
revoke all on function announcement_worker_private.create_and_start_announcement_impl(
  uuid, text, text, text, text, text, jsonb, text, boolean, uuid
) from public, anon, authenticated, service_role;
grant execute on function announcement_worker_private.create_and_start_announcement_impl(
  uuid, text, text, text, text, text, jsonb, text, boolean, uuid
) to service_role;

create or replace function public.create_and_start_announcement(
  p_operation_id uuid,
  p_title text,
  p_body text,
  p_category text,
  p_priority text,
  p_audience_type text,
  p_audience_filter jsonb,
  p_delivery_policy text,
  p_email_enabled boolean,
  p_actor_id uuid
)
returns setof public.announcements
language sql
security invoker
set search_path = ''
begin atomic
  select * from announcement_worker_private.create_and_start_announcement_impl(
    p_operation_id, p_title, p_body, p_category, p_priority,
    p_audience_type, p_audience_filter, p_delivery_policy,
    p_email_enabled, p_actor_id
  );
end;

alter function public.create_and_start_announcement(
  uuid, text, text, text, text, text, jsonb, text, boolean, uuid
) owner to postgres;
revoke all on function public.create_and_start_announcement(
  uuid, text, text, text, text, text, jsonb, text, boolean, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.create_and_start_announcement(
  uuid, text, text, text, text, text, jsonb, text, boolean, uuid
) to service_role;

comment on function public.create_and_start_announcement(
  uuid, text, text, text, text, text, jsonb, text, boolean, uuid
) is
  'Atomically creates and starts one announcement. Replaying the same operation UUID with the same actor and canonical payload returns the original campaign.';

-- Keep the Stage 2 lifecycle trigger unchanged for every ordinary write. A
-- second, narrowly-scoped trigger handles only the worker's terminal update so
-- finalization can preserve an administrator snapshot after the live Auth row
-- has been deleted.
drop trigger enforce_announcement_lifecycle on public.announcements;
create trigger enforce_announcement_lifecycle
before insert or update or delete on public.announcements
for each row
when (
  coalesce(current_setting('smot.announcement_write_scope', true), '')
    <> 'worker_finalize'
)
execute function private.enforce_announcement_lifecycle();

create or replace function private.enforce_announcement_worker_finalize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(current_setting('smot.announcement_write_scope', true), '')
      <> 'worker_finalize'
    or tg_op <> 'UPDATE'
    or old.status <> 'sending'
    or new.status not in ('sent', 'partially_failed')
    or old.id is distinct from new.id
    or old.title is distinct from new.title
    or old.body is distinct from new.body
    or old.category is distinct from new.category
    or old.priority is distinct from new.priority
    or old.audience_type is distinct from new.audience_type
    or old.audience_filter is distinct from new.audience_filter
    or old.delivery_policy is distinct from new.delivery_policy
    or old.email_enabled is distinct from new.email_enabled
    or old.scheduled_for is distinct from new.scheduled_for
    or old.sending_started_at is distinct from new.sending_started_at
    or old.sent_at is not null
    or new.sent_at is null
    or old.cancelled_at is distinct from new.cancelled_at
    or old.recipient_count is distinct from new.recipient_count
    or old.delivered_count is distinct from new.delivered_count
    or old.failed_count is distinct from new.failed_count
    or old.skipped_count is distinct from new.skipped_count
    or old.cancelled_count is distinct from new.cancelled_count
    or old.read_count is distinct from new.read_count
    or old.dismissed_count is distinct from new.dismissed_count
    or old.created_by is distinct from new.created_by
    or old.created_by_snapshot is distinct from new.created_by_snapshot
    or old.updated_by is distinct from new.updated_by
    or old.updated_by_snapshot is distinct from new.updated_by_snapshot
    or new.version <> old.version + 1
    or old.created_at is distinct from new.created_at
    or new.updated_at < old.updated_at
    or not exists (
      select 1
      from public.moderation_audit_events audit_event
      where audit_event.id = new.moderation_audit_event_id
        and audit_event.event_type = 'announcement.completed'
        and audit_event.actor_user_id_snapshot = new.updated_by_snapshot
        and audit_event.resource_type = 'announcement'
        and audit_event.resource_id = new.id
    ) then
    raise exception 'invalid_announcement_worker_finalization';
  end if;

  return new;
end
$function$;

alter function private.enforce_announcement_worker_finalize() owner to postgres;
revoke all on function private.enforce_announcement_worker_finalize()
  from public, anon, authenticated, service_role;

create trigger enforce_announcement_worker_finalize
before update on public.announcements
for each row
when (
  coalesce(current_setting('smot.announcement_write_scope', true), '')
    = 'worker_finalize'
)
execute function private.enforce_announcement_worker_finalize();

create or replace function announcement_worker_private.finalize_announcement_worker_impl(
  p_announcement_id uuid
)
returns setof public.announcements
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_announcement public.announcements%rowtype;
  current_dispatch public.announcement_dispatch_state%rowtype;
  audit_event_id uuid := gen_random_uuid();
  finalized_at timestamptz := now();
  terminal_failure boolean;
  next_status text;
  lifecycle_action text;
  actor_live_id uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'announcement_worker_finalize_requires_service_role'
      using errcode = '42501';
  end if;

  select * into current_announcement
  from public.announcements
  where id = p_announcement_id
  for update;

  if not found then
    raise exception 'announcement_not_found' using errcode = 'P0002';
  end if;
  if current_announcement.status in ('sent', 'partially_failed') then
    return query select * from public.announcements where id = p_announcement_id;
    return;
  end if;
  if current_announcement.status <> 'sending' then
    raise exception 'announcement_is_not_sending' using errcode = '55000';
  end if;

  select * into current_dispatch
  from public.announcement_dispatch_state
  where announcement_id = p_announcement_id
  for update;

  if not found or not current_dispatch.audience_exhausted then
    raise exception 'announcement_audience_is_not_exhausted' using errcode = '55000';
  end if;

  perform delivery.id
  from public.announcement_deliveries delivery
  where delivery.announcement_id = p_announcement_id
  order by delivery.id
  for update;

  perform outbox.delivery_id
  from public.announcement_delivery_outbox outbox
  join public.announcement_deliveries delivery on delivery.id = outbox.delivery_id
  where delivery.announcement_id = p_announcement_id
  order by outbox.delivery_id
  for update of outbox;

  if exists (
    select 1
    from public.announcement_deliveries delivery
    left join public.announcement_delivery_outbox outbox
      on outbox.delivery_id = delivery.id
    where delivery.announcement_id = p_announcement_id
      and (
        outbox.delivery_id is null
        or not (
          (delivery.status = 'delivered' and outbox.queue_status = 'completed')
          or (delivery.status = 'failed' and outbox.queue_status = 'dead')
          or (delivery.status = 'skipped' and outbox.queue_status = 'completed')
          or (delivery.status = 'cancelled' and outbox.queue_status = 'cancelled')
        )
      )
  ) then
    raise exception 'announcement_deliveries_are_not_terminal' using errcode = '55000';
  end if;

  select exists (
    select 1
    from public.announcement_deliveries delivery
    join public.announcement_delivery_outbox outbox on outbox.delivery_id = delivery.id
    where delivery.announcement_id = p_announcement_id
      and delivery.status = 'failed'
      and outbox.queue_status = 'dead'
  ) into terminal_failure;

  next_status := case when terminal_failure then 'partially_failed' else 'sent' end;
  lifecycle_action := case when terminal_failure then 'partially_fail' else 'complete' end;
  actor_live_id := current_announcement.updated_by;

  insert into public.moderation_audit_events (
    id, event_type, actor_user_id, actor_user_id_snapshot, actor_role,
    resource_type, resource_id, summary, metadata, request_id, occurred_at
  ) values (
    audit_event_id, 'announcement.completed', actor_live_id,
    current_announcement.updated_by_snapshot, 'admin',
    'announcement', p_announcement_id, 'Announcement worker finalized campaign',
    jsonb_build_object(
      'action', lifecycle_action,
      'previous_status', current_announcement.status,
      'new_status', next_status,
      'previous_version', current_announcement.version,
      'new_version', current_announcement.version + 1,
      'worker_finalized', true
    ),
    'announcement-worker-finalize:' || p_announcement_id::text || ':' || current_announcement.version::text,
    finalized_at
  );

  perform set_config('smot.announcement_write_scope', 'worker_finalize', true);
  update public.announcements
  set
    status = next_status,
    sent_at = finalized_at,
    moderation_audit_event_id = audit_event_id,
    updated_by = actor_live_id,
    version = version + 1,
    updated_at = finalized_at
  where id = p_announcement_id;
  perform set_config('smot.announcement_write_scope', '', true);

  perform set_config('smot.announcement_history_write_scope', 'transition', true);
  insert into public.announcement_lifecycle_history (
    announcement_id, announcement_version, action,
    previous_status, new_status, previous_scheduled_for, new_scheduled_for,
    actor_user_id, actor_user_id_snapshot, actor_role,
    moderation_audit_event_id, created_at
  ) values (
    p_announcement_id, current_announcement.version + 1, lifecycle_action,
    current_announcement.status, next_status,
    current_announcement.scheduled_for, current_announcement.scheduled_for,
    actor_live_id, current_announcement.updated_by_snapshot, 'admin',
    audit_event_id, finalized_at
  );
  perform set_config('smot.announcement_history_write_scope', '', true);

  return query select * from public.announcements where id = p_announcement_id;
end
$function$;

alter function announcement_worker_private.finalize_announcement_worker_impl(uuid) owner to postgres;
revoke all on function announcement_worker_private.finalize_announcement_worker_impl(uuid)
  from public, anon, authenticated, service_role;
grant execute on function announcement_worker_private.finalize_announcement_worker_impl(uuid)
  to service_role;

create or replace function public.finalize_announcement_worker(p_announcement_id uuid)
returns setof public.announcements
language sql
security invoker
set search_path = ''
begin atomic
  select * from announcement_worker_private.finalize_announcement_worker_impl(p_announcement_id);
end;

alter function public.finalize_announcement_worker(uuid) owner to postgres;
revoke all on function public.finalize_announcement_worker(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_announcement_worker(uuid) to service_role;

comment on function public.finalize_announcement_worker(uuid) is
  'Worker-only atomic finalizer. Requires an exhausted dispatch cursor and every delivery/outbox pair in a canonical terminal state; it does not require the initiating admin to remain live or privileged.';

revoke execute on function private.transition_announcement_impl(
  uuid, integer, text, uuid, timestamptz, text
) from service_role;

create or replace function announcement_worker_private.transition_announcement_service_impl(
  p_announcement_id uuid,
  p_expected_version integer,
  p_action text,
  p_actor_id uuid,
  p_scheduled_for timestamptz default null,
  p_request_id text default null
)
returns setof public.announcements
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'announcement_transition_requires_service_role'
      using errcode = '42501';
  end if;
  if lower(btrim(coalesce(p_action, ''))) in ('complete', 'partially_fail') then
    raise exception 'announcement_worker_finalization_required'
      using errcode = '42501';
  end if;

  return query select * from private.transition_announcement_impl(
    p_announcement_id, p_expected_version, p_action,
    p_actor_id, p_scheduled_for, p_request_id
  );
end
$function$;

alter function announcement_worker_private.transition_announcement_service_impl(
  uuid, integer, text, uuid, timestamptz, text
)
  owner to postgres;
revoke all on function announcement_worker_private.transition_announcement_service_impl(
  uuid, integer, text, uuid, timestamptz, text
)
  from public, anon, authenticated, service_role;
grant execute on function announcement_worker_private.transition_announcement_service_impl(
  uuid, integer, text, uuid, timestamptz, text
) to service_role;

create or replace function public.transition_announcement(
  p_announcement_id uuid,
  p_expected_version integer,
  p_action text,
  p_actor_id uuid,
  p_scheduled_for timestamptz default null,
  p_request_id text default null
)
returns setof public.announcements
language sql
security invoker
set search_path = ''
begin atomic
  select * from announcement_worker_private.transition_announcement_service_impl(
    p_announcement_id, p_expected_version, p_action,
    p_actor_id, p_scheduled_for, p_request_id
  );
end;

alter function public.transition_announcement(uuid, integer, text, uuid, timestamptz, text)
  owner to postgres;
revoke all on function public.transition_announcement(uuid, integer, text, uuid, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.transition_announcement(uuid, integer, text, uuid, timestamptz, text)
  to service_role;

create or replace function announcement_worker_private.deliver_announcement_in_app_impl(
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

  message_preview := substring(
    regexp_replace(btrim(current_announcement.body), '[[:space:]]+', ' ', 'g')
    from 1 for 100
  );

  perform set_config('smot.conversation_write_scope', 'announcement_delivery', true);

  insert into public.conversations (
    id, listing_id, buyer_id, seller_id,
    last_message_at, last_message_preview, created_at, updated_at
  ) values (
    output_conversation_id, null,
    current_delivery.recipient_user_id_snapshot, null,
    delivered_at_value, message_preview, delivered_at_value, delivered_at_value
  );

  insert into public.messages (
    id, conversation_id, sender_id, body, created_at
  ) values (
    output_message_id, output_conversation_id, null,
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

alter function announcement_worker_private.deliver_announcement_in_app_impl(uuid, uuid) owner to postgres;
revoke all on function announcement_worker_private.deliver_announcement_in_app_impl(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function announcement_worker_private.deliver_announcement_in_app_impl(uuid, uuid)
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
begin atomic
  select * from announcement_worker_private.deliver_announcement_in_app_impl(
    p_delivery_id,
    p_lease_token
  );
end;

alter function public.deliver_announcement_in_app(uuid, uuid) owner to postgres;
revoke all on function public.deliver_announcement_in_app(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.deliver_announcement_in_app(uuid, uuid)
  to service_role;

comment on function public.deliver_announcement_in_app(uuid, uuid) is
  'Atomic senderless system delivery. The initiating admin is retained only in announcement audit provenance, so account deletion, demotion, or a later ban cannot strand queued output.';

create or replace function announcement_worker_private.claim_announcement_worker_batch_impl(
  p_limit integer default 5
)
returns table(announcement_id uuid)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  selected_announcement record;
  attempted_at timestamptz := now();
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'announcement_worker_batch_requires_service_role'
      using errcode = '42501';
  end if;
  if p_limit not between 1 and 20 then
    raise exception 'invalid_announcement_worker_batch_size' using errcode = '22023';
  end if;

  for selected_announcement in
    select announcement.id, announcement.sending_started_at
    from public.announcements announcement
    left join public.announcement_dispatch_state dispatch
      on dispatch.announcement_id = announcement.id
    where announcement.status = 'sending'
    order by
      coalesce(dispatch.last_worker_attempt_at, '-infinity'::timestamptz) asc,
      case announcement.priority
        when 'urgent' then 4
        when 'high' then 3
        when 'normal' then 2
        else 1
      end desc,
      announcement.sending_started_at asc,
      announcement.id asc
    for update of announcement skip locked
    limit p_limit
  loop
    insert into public.announcement_dispatch_state (
      announcement_id,
      audience_cutoff_at
    ) values (
      selected_announcement.id,
      selected_announcement.sending_started_at
    ) on conflict on constraint announcement_dispatch_state_pkey do nothing;

    perform 1
    from public.announcement_dispatch_state
    where announcement_dispatch_state.announcement_id = selected_announcement.id
    for update;

    update public.announcement_dispatch_state
    set
      last_worker_attempt_at = attempted_at,
      worker_attempt_count = worker_attempt_count + 1,
      updated_at = greatest(updated_at, attempted_at)
    where announcement_dispatch_state.announcement_id = selected_announcement.id;

    announcement_id := selected_announcement.id;
    return next;
  end loop;
end
$function$;

alter function announcement_worker_private.claim_announcement_worker_batch_impl(integer)
  owner to postgres;
revoke all on function announcement_worker_private.claim_announcement_worker_batch_impl(integer)
  from public, anon, authenticated, service_role;
grant execute on function announcement_worker_private.claim_announcement_worker_batch_impl(integer)
  to service_role;

create or replace function public.claim_announcement_worker_batch(p_limit integer default 5)
returns table(announcement_id uuid)
language sql
security invoker
set search_path = ''
begin atomic
  select * from announcement_worker_private.claim_announcement_worker_batch_impl(p_limit);
end;

alter function public.claim_announcement_worker_batch(integer) owner to postgres;
revoke all on function public.claim_announcement_worker_batch(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_announcement_worker_batch(integer)
  to service_role;

comment on function public.claim_announcement_worker_batch(integer) is
  'Rotating campaign selector. Least-recently-attempted campaigns win; priority breaks ties so urgent work is prompt without starving older campaigns.';

create or replace function announcement_worker_private.claim_announcement_delivery_impl(
  p_lease_seconds integer default 60
)
returns setof public.announcement_delivery_outbox
language plpgsql
security definer
set search_path = ''
as $function$
declare
  selected_announcement_id uuid;
  selected_delivery_id uuid;
  selected_lease_token uuid := gen_random_uuid();
  claimed_at timestamptz := now();
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'announcement_claim_requires_service_role' using errcode = '42501';
  end if;
  if p_lease_seconds not between 15 and 900 then
    raise exception 'invalid_announcement_lease_seconds' using errcode = '22023';
  end if;

  select announcement.id
  into selected_announcement_id
  from public.announcements announcement
  join public.announcement_dispatch_state dispatch
    on dispatch.announcement_id = announcement.id
  where announcement.status = 'sending'
    and exists (
      select 1
      from public.announcement_deliveries delivery
      join public.announcement_delivery_outbox outbox
        on outbox.delivery_id = delivery.id
      where delivery.announcement_id = announcement.id
        and delivery.recipient_user_id is not null
        and delivery.status in ('queued', 'failed')
        and outbox.queue_status in ('pending', 'retry')
        and outbox.available_at <= claimed_at
    )
  order by
    coalesce(dispatch.last_delivery_claimed_at, '-infinity'::timestamptz) asc,
    case announcement.priority
      when 'urgent' then 4
      when 'high' then 3
      when 'normal' then 2
      else 1
    end desc,
    announcement.sending_started_at asc,
    announcement.id asc
  for update of announcement skip locked
  limit 1;

  if selected_announcement_id is null then
    return;
  end if;

  perform 1
  from public.announcement_dispatch_state
  where announcement_id = selected_announcement_id
  for update;

  select delivery.id
  into selected_delivery_id
  from public.announcement_deliveries delivery
  join public.announcement_delivery_outbox outbox on outbox.delivery_id = delivery.id
  where delivery.announcement_id = selected_announcement_id
    and delivery.recipient_user_id is not null
    and delivery.status in ('queued', 'failed')
    and outbox.queue_status in ('pending', 'retry')
    and outbox.available_at <= claimed_at
  order by outbox.available_at, outbox.delivery_id
  for update of delivery, outbox skip locked
  limit 1;

  if selected_delivery_id is null then
    return;
  end if;

  update public.announcement_dispatch_state
  set
    last_delivery_claimed_at = claimed_at,
    updated_at = greatest(updated_at, claimed_at)
  where announcement_id = selected_announcement_id;

  perform set_config('smot.announcement_delivery_write_scope', 'claim', true);
  update public.announcement_deliveries
  set status = 'processing'
  where id = selected_delivery_id;
  perform set_config('smot.announcement_delivery_write_scope', '', true);

  perform set_config('smot.announcement_outbox_write_scope', 'claim', true);
  update public.announcement_delivery_outbox
  set
    queue_status = 'leased',
    attempt_count = attempt_count + 1,
    lease_token = selected_lease_token,
    lease_expires_at = claimed_at + make_interval(secs => p_lease_seconds)
  where delivery_id = selected_delivery_id;
  perform set_config('smot.announcement_outbox_write_scope', '', true);

  return query
    select * from public.announcement_delivery_outbox
    where delivery_id = selected_delivery_id;
end
$function$;

alter function announcement_worker_private.claim_announcement_delivery_impl(integer)
  owner to postgres;
revoke all on function announcement_worker_private.claim_announcement_delivery_impl(integer)
  from public, anon, authenticated, service_role;
grant execute on function announcement_worker_private.claim_announcement_delivery_impl(integer)
  to service_role;

revoke execute on function private.claim_announcement_delivery_impl(integer)
  from service_role;

create or replace function public.claim_announcement_delivery(
  p_lease_seconds integer default 60
)
returns setof public.announcement_delivery_outbox
language sql
security invoker
set search_path = ''
begin atomic
  select * from announcement_worker_private.claim_announcement_delivery_impl(
    p_lease_seconds
  );
end;

alter function public.claim_announcement_delivery(integer) owner to postgres;
revoke all on function public.claim_announcement_delivery(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_announcement_delivery(integer)
  to service_role;

create or replace function announcement_worker_private.get_conversation_unread_counts_impl(
  p_conversation_ids uuid[]
)
returns table(conversation_id uuid, unread_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := auth.uid();
  requested_ids uuid[] := coalesce(p_conversation_ids, array[]::uuid[]);
begin
  if current_user_id is null then
    raise exception 'Authentication required to read unread counts'
      using errcode = '28000';
  end if;
  if coalesce(array_ndims(requested_ids), 0) > 1
    or cardinality(requested_ids) > 100 then
    raise exception 'At most 100 conversation counts may be requested'
      using errcode = '22023';
  end if;

  return query
  select conversation.id, count(message.id)::bigint
  from public.conversations conversation
  left join public.conversation_user_state state
    on state.conversation_id = conversation.id
    and state.user_id = current_user_id
  left join public.messages message
    on message.conversation_id = conversation.id
    and message.read_at is null
    and message.sender_id is distinct from current_user_id
    and (state.deleted_at is null or message.created_at > state.deleted_at)
  where conversation.id = any(requested_ids)
    and (
      conversation.buyer_id = current_user_id
      or conversation.seller_id = current_user_id
    )
  group by conversation.id;
end
$function$;

alter function announcement_worker_private.get_conversation_unread_counts_impl(uuid[])
  owner to postgres;
revoke all on function announcement_worker_private.get_conversation_unread_counts_impl(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function announcement_worker_private.get_conversation_unread_counts_impl(uuid[])
  to authenticated;

create or replace function public.get_conversation_unread_counts(
  p_conversation_ids uuid[]
)
returns table(conversation_id uuid, unread_count bigint)
language sql
stable
security invoker
set search_path = ''
begin atomic
  select * from announcement_worker_private.get_conversation_unread_counts_impl(
    p_conversation_ids
  );
end;

alter function public.get_conversation_unread_counts(uuid[]) owner to postgres;
revoke all on function public.get_conversation_unread_counts(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.get_conversation_unread_counts(uuid[])
  to authenticated;

create or replace function announcement_worker_private.mark_conversation_read_impl(
  p_conversation_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := auth.uid();
  marked_count integer := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not exists (
    select 1
    from public.conversations conversation
    where conversation.id = p_conversation_id
      and (
        conversation.buyer_id = current_user_id
        or conversation.seller_id = current_user_id
      )
  ) then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;

  with updated_messages as (
    update public.messages
    set read_at = timezone('utc', now())
    where conversation_id = p_conversation_id
      and sender_id is distinct from current_user_id
      and read_at is null
    returning 1
  )
  select count(*)::integer into marked_count from updated_messages;

  update public.notifications
  set read_at = timezone('utc', now())
  where conversation_id = p_conversation_id
    and user_id = current_user_id
    and read_at is null;

  return marked_count;
end
$function$;

alter function announcement_worker_private.mark_conversation_read_impl(uuid)
  owner to postgres;
revoke all on function announcement_worker_private.mark_conversation_read_impl(uuid)
  from public, anon, authenticated, service_role;
grant execute on function announcement_worker_private.mark_conversation_read_impl(uuid)
  to authenticated;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns integer
language sql
security invoker
set search_path = ''
begin atomic
  select announcement_worker_private.mark_conversation_read_impl(
    p_conversation_id
  );
end;

alter function public.mark_conversation_read(uuid) owner to postgres;
revoke all on function public.mark_conversation_read(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.mark_conversation_read(uuid)
  to authenticated;

drop policy if exists "Recipients can mark incoming messages read"
  on public.messages;
create policy "Recipients can mark incoming messages read"
on public.messages
for update
to authenticated
using (
  sender_id is distinct from (select auth.uid())
  and exists (
    select 1
    from public.conversations conversation
    where conversation.id = messages.conversation_id
      and (
        conversation.buyer_id = (select auth.uid())
        or conversation.seller_id = (select auth.uid())
      )
  )
)
with check (
  sender_id is distinct from (select auth.uid())
  and exists (
    select 1
    from public.conversations conversation
    where conversation.id = messages.conversation_id
      and (
        conversation.buyer_id = (select auth.uid())
        or conversation.seller_id = (select auth.uid())
      )
  )
);
