-- Stage 5 announcement operations.
--
-- Adds a durable idempotency boundary for saved drafts, activates due
-- scheduled campaigns without depending on the original administrator still
-- existing, and exposes one audited manual-retry operation for terminal
-- failed deliveries. All worker paths retain the canonical
-- announcement -> delivery -> outbox lock order.

create table public.announcement_draft_commands (
  operation_id uuid primary key,
  announcement_id uuid not null unique
    references public.announcements(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_user_id_snapshot uuid not null,
  command_payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint announcement_draft_commands_actor_snapshot_check
    check (actor_user_id is null or actor_user_id = actor_user_id_snapshot),
  constraint announcement_draft_commands_payload_check
    check (
      jsonb_typeof(command_payload) = 'object'
      and octet_length(command_payload::text) <= 65536
    )
);

comment on table public.announcement_draft_commands is
  'Durable idempotency ledger for saved announcement drafts. Exact operation replay returns the canonical draft; actor or payload reuse is rejected.';

create or replace function private.guard_announcement_draft_command_lifecycle()
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
    or coalesce(current_setting('smot.announcement_draft_command_scope', true), '')
      <> 'create' then
    raise exception 'announcement_draft_commands_are_immutable';
  end if;

  return new;
end
$function$;

alter function private.guard_announcement_draft_command_lifecycle()
  owner to postgres;
revoke all on function private.guard_announcement_draft_command_lifecycle()
  from public, anon, authenticated, service_role;

create trigger guard_announcement_draft_command_lifecycle
before insert or update or delete on public.announcement_draft_commands
for each row execute function private.guard_announcement_draft_command_lifecycle();

alter table public.announcement_draft_commands enable row level security;
revoke all on table public.announcement_draft_commands
  from public, anon, authenticated, service_role;
grant select on table public.announcement_draft_commands to service_role;

create or replace function announcement_worker_private.create_announcement_draft_idempotent_impl(
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
  existing_command public.announcement_draft_commands%rowtype;
  current_announcement public.announcements%rowtype;
  canonical_payload jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'announcement_draft_create_requires_service_role'
      using errcode = '42501';
  end if;
  if p_operation_id is null then
    raise exception 'announcement_operation_id_required' using errcode = '22023';
  end if;

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
  from public.announcement_draft_commands
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
    'announcement-draft-command:' || p_operation_id::text
  );

  perform set_config('smot.announcement_draft_command_scope', 'create', true);
  insert into public.announcement_draft_commands (
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
  perform set_config('smot.announcement_draft_command_scope', '', true);

  return query
    select * from public.announcements where id = current_announcement.id;
end
$function$;

alter function announcement_worker_private.create_announcement_draft_idempotent_impl(
  uuid, text, text, text, text, text, jsonb, text, boolean, uuid
) owner to postgres;
revoke all on function announcement_worker_private.create_announcement_draft_idempotent_impl(
  uuid, text, text, text, text, text, jsonb, text, boolean, uuid
) from public, anon, authenticated, service_role;
grant execute on function announcement_worker_private.create_announcement_draft_idempotent_impl(
  uuid, text, text, text, text, text, jsonb, text, boolean, uuid
) to service_role;

create or replace function public.create_announcement_draft_idempotent(
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
  select *
  from announcement_worker_private.create_announcement_draft_idempotent_impl(
    p_operation_id,
    p_title,
    p_body,
    p_category,
    p_priority,
    p_audience_type,
    p_audience_filter,
    p_delivery_policy,
    p_email_enabled,
    p_actor_id
  );
end;

alter function public.create_announcement_draft_idempotent(
  uuid, text, text, text, text, text, jsonb, text, boolean, uuid
) owner to postgres;
revoke all on function public.create_announcement_draft_idempotent(
  uuid, text, text, text, text, text, jsonb, text, boolean, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.create_announcement_draft_idempotent(
  uuid, text, text, text, text, text, jsonb, text, boolean, uuid
) to service_role;

-- The ordinary lifecycle trigger retains every Stage 2/3 invariant. Only the
-- two postgres-owned worker scopes use their dedicated, field-bounded guards.
drop trigger enforce_announcement_lifecycle on public.announcements;
create trigger enforce_announcement_lifecycle
before insert or update or delete on public.announcements
for each row
when (
  coalesce(current_setting('smot.announcement_write_scope', true), '')
    not in ('worker_finalize', 'worker_schedule')
)
execute function private.enforce_announcement_lifecycle();

create or replace function private.enforce_announcement_worker_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(current_setting('smot.announcement_write_scope', true), '')
      <> 'worker_schedule'
    or tg_op <> 'UPDATE'
    or old.status <> 'scheduled'
    or new.status <> 'sending'
    or old.scheduled_for is null
    or old.scheduled_for > now()
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
    or old.sending_started_at is not null
    or new.sending_started_at is null
    or old.sent_at is distinct from new.sent_at
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
        and audit_event.event_type = 'announcement.sending'
        and audit_event.actor_user_id_snapshot = new.updated_by_snapshot
        and audit_event.resource_type = 'announcement'
        and audit_event.resource_id = new.id
    ) then
    raise exception 'invalid_announcement_worker_schedule_activation';
  end if;

  return new;
end
$function$;

alter function private.enforce_announcement_worker_schedule() owner to postgres;
revoke all on function private.enforce_announcement_worker_schedule()
  from public, anon, authenticated, service_role;

create trigger enforce_announcement_worker_schedule
before update on public.announcements
for each row
when (
  coalesce(current_setting('smot.announcement_write_scope', true), '')
    = 'worker_schedule'
)
execute function private.enforce_announcement_worker_schedule();

create or replace function announcement_worker_private.activate_due_scheduled_announcements_impl(
  p_limit integer default 10
)
returns setof public.announcements
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_announcement public.announcements%rowtype;
  audit_event_id uuid;
  activated_at timestamptz;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'announcement_schedule_activation_requires_service_role'
      using errcode = '42501';
  end if;
  if p_limit not between 1 and 20 then
    raise exception 'invalid_announcement_schedule_activation_limit'
      using errcode = '22023';
  end if;

  for current_announcement in
    select announcement.*
    from public.announcements announcement
    where announcement.status = 'scheduled'
      and announcement.scheduled_for <= now()
    order by
      case announcement.priority
        when 'urgent' then 1
        when 'high' then 2
        when 'normal' then 3
        else 4
      end,
      announcement.scheduled_for,
      announcement.id
    limit p_limit
    for update skip locked
  loop
    audit_event_id := gen_random_uuid();
    activated_at := now();

    insert into public.moderation_audit_events (
      id,
      event_type,
      actor_user_id,
      actor_user_id_snapshot,
      actor_role,
      resource_type,
      resource_id,
      summary,
      metadata,
      request_id,
      occurred_at
    ) values (
      audit_event_id,
      'announcement.sending',
      current_announcement.updated_by,
      current_announcement.updated_by_snapshot,
      'admin',
      'announcement',
      current_announcement.id,
      'Scheduled announcement activated by worker',
      jsonb_build_object(
        'action', 'start_sending',
        'previous_status', 'scheduled',
        'new_status', 'sending',
        'previous_version', current_announcement.version,
        'new_version', current_announcement.version + 1,
        'worker_activated', true
      ),
      'announcement-worker-schedule:' || current_announcement.id::text || ':' || current_announcement.version::text,
      activated_at
    );

    perform set_config('smot.announcement_write_scope', 'worker_schedule', true);
    update public.announcements
    set
      status = 'sending',
      sending_started_at = activated_at,
      moderation_audit_event_id = audit_event_id,
      version = version + 1,
      updated_at = activated_at
    where id = current_announcement.id;
    perform set_config('smot.announcement_write_scope', '', true);

    perform set_config('smot.announcement_history_write_scope', 'transition', true);
    insert into public.announcement_lifecycle_history (
      announcement_id,
      announcement_version,
      action,
      previous_status,
      new_status,
      previous_scheduled_for,
      new_scheduled_for,
      actor_user_id,
      actor_user_id_snapshot,
      actor_role,
      moderation_audit_event_id,
      created_at
    ) values (
      current_announcement.id,
      current_announcement.version + 1,
      'start_sending',
      'scheduled',
      'sending',
      current_announcement.scheduled_for,
      current_announcement.scheduled_for,
      current_announcement.updated_by,
      current_announcement.updated_by_snapshot,
      'admin',
      audit_event_id,
      activated_at
    );
    perform set_config('smot.announcement_history_write_scope', '', true);

    return query
      select * from public.announcements
      where id = current_announcement.id;
  end loop;
end
$function$;

alter function announcement_worker_private.activate_due_scheduled_announcements_impl(integer)
  owner to postgres;
revoke all on function announcement_worker_private.activate_due_scheduled_announcements_impl(integer)
  from public, anon, authenticated, service_role;
grant execute on function announcement_worker_private.activate_due_scheduled_announcements_impl(integer)
  to service_role;

create or replace function public.activate_due_scheduled_announcements(
  p_limit integer default 10
)
returns setof public.announcements
language sql
security invoker
set search_path = ''
begin atomic
  select *
  from announcement_worker_private.activate_due_scheduled_announcements_impl(p_limit);
end;

alter function public.activate_due_scheduled_announcements(integer)
  owner to postgres;
revoke all on function public.activate_due_scheduled_announcements(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.activate_due_scheduled_announcements(integer)
  to service_role;

create or replace function private.enforce_announcement_outbox_lifecycle()
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
  if tg_op = 'DELETE' then
    raise exception 'announcement_delivery_outbox_is_durable';
  end if;

  if tg_op = 'INSERT' then
    if write_scope <> 'enqueue'
      or new.queue_status <> 'pending'
      or new.attempt_count <> 0
      or new.lease_token is not null
      or new.lease_expires_at is not null
      or new.last_attempt_at is not null
      or new.completed_at is not null
      or new.last_error is not null then
      raise exception 'announcement_delivery_outbox_must_be_enqueued_through_rpc';
    end if;

    new.updated_at := new.created_at;
    return new;
  end if;

  if write_scope not in ('claim', 'finish', 'cancel', 'manual_retry')
    or old.delivery_id is distinct from new.delivery_id
    or old.idempotency_key is distinct from new.idempotency_key
    or old.created_at is distinct from new.created_at then
    raise exception 'announcement_outbox_identity_locked';
  end if;

  if old.max_attempts is distinct from new.max_attempts
    or old.send_in_app is distinct from new.send_in_app
    or old.send_email is distinct from new.send_email then
    raise exception 'announcement_outbox_configuration_locked';
  end if;

  if write_scope = 'claim' then
    if old.queue_status not in ('pending', 'retry')
      or new.queue_status <> 'leased'
      or new.attempt_count <> old.attempt_count + 1
      or new.lease_token is null
      or new.lease_expires_at is null
      or new.lease_expires_at <= now()
      or old.completed_at is distinct from new.completed_at
      or old.last_error is distinct from new.last_error then
      raise exception 'announcement_outbox_attempt_must_increment_on_lease';
    end if;
    new.last_attempt_at := now();
  elsif write_scope = 'finish' then
    if old.queue_status <> 'leased'
      or new.queue_status not in ('completed', 'retry', 'dead')
      or old.attempt_count is distinct from new.attempt_count
      or old.last_attempt_at is distinct from new.last_attempt_at then
      raise exception 'invalid_announcement_outbox_finish';
    end if;
    if new.queue_status = 'completed' then
      new.completed_at := now();
      new.last_error := null;
    elsif nullif(btrim(new.last_error), '') is null then
      raise exception 'announcement_outbox_failure_requires_error';
    end if;
    new.lease_token := null;
    new.lease_expires_at := null;
  elsif write_scope = 'cancel' then
    if old.queue_status not in ('pending', 'leased', 'retry')
      or new.queue_status <> 'cancelled'
      or old.attempt_count is distinct from new.attempt_count
      or old.last_attempt_at is distinct from new.last_attempt_at
      or old.completed_at is distinct from new.completed_at
      or old.last_error is distinct from new.last_error then
      raise exception 'invalid_announcement_outbox_cancellation';
    end if;
    new.lease_token := null;
    new.lease_expires_at := null;
  else
    if old.queue_status <> 'dead'
      or new.queue_status <> 'pending'
      or new.attempt_count <> 0
      or new.available_at > now()
      or new.lease_token is not null
      or new.lease_expires_at is not null
      or new.last_attempt_at is not null
      or new.completed_at is not null
      or new.last_error is not null then
      raise exception 'invalid_announcement_outbox_manual_retry';
    end if;
  end if;

  new.updated_at := now();
  return new;
end
$function$;

alter function private.enforce_announcement_outbox_lifecycle()
  owner to postgres;
revoke all on function private.enforce_announcement_outbox_lifecycle()
  from public, anon, authenticated, service_role;

create or replace function announcement_worker_private.retry_failed_announcement_impl(
  p_announcement_id uuid,
  p_expected_version integer,
  p_actor_id uuid,
  p_request_id text
)
returns setof public.announcements
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_announcement public.announcements%rowtype;
  transitioned_announcement public.announcements%rowtype;
  normalized_request_id text := nullif(btrim(coalesce(p_request_id, '')), '');
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'announcement_retry_requires_service_role' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'valid_announcement_expected_version_required' using errcode = '22023';
  end if;
  if normalized_request_id is null or char_length(normalized_request_id) > 200 then
    raise exception 'valid_announcement_request_id_required' using errcode = '22023';
  end if;

  perform private.require_active_announcement_admin(p_actor_id, now());

  select * into current_announcement
  from public.announcements
  where id = p_announcement_id
  for update;

  if not found then
    raise exception 'announcement_not_found' using errcode = 'P0002';
  end if;
  if current_announcement.status <> 'partially_failed' then
    raise exception 'only_partially_failed_announcements_can_retry'
      using errcode = '55000';
  end if;
  if current_announcement.version <> p_expected_version then
    raise exception 'announcement_version_conflict' using errcode = '40001';
  end if;

  perform delivery.id
  from public.announcement_deliveries delivery
  where delivery.announcement_id = p_announcement_id
  order by delivery.id
  for update;

  perform outbox.delivery_id
  from public.announcement_delivery_outbox outbox
  join public.announcement_deliveries delivery
    on delivery.id = outbox.delivery_id
  where delivery.announcement_id = p_announcement_id
  order by outbox.delivery_id
  for update of outbox;

  if not exists (
    select 1
    from public.announcement_deliveries delivery
    join public.announcement_delivery_outbox outbox
      on outbox.delivery_id = delivery.id
    where delivery.announcement_id = p_announcement_id
      and delivery.status = 'failed'
      and outbox.queue_status = 'dead'
  ) then
    raise exception 'announcement_has_no_terminal_failures' using errcode = '55000';
  end if;

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

  select * into transitioned_announcement
  from private.transition_announcement_impl(
    p_announcement_id,
    p_expected_version,
    'start_sending',
    p_actor_id,
    null,
    normalized_request_id
  );

  perform set_config('smot.announcement_outbox_write_scope', 'manual_retry', true);
  update public.announcement_delivery_outbox outbox
  set
    queue_status = 'pending',
    attempt_count = 0,
    available_at = now(),
    lease_token = null,
    lease_expires_at = null,
    last_attempt_at = null,
    completed_at = null,
    last_error = null
  from public.announcement_deliveries delivery
  where delivery.id = outbox.delivery_id
    and delivery.announcement_id = p_announcement_id
    and delivery.status = 'failed'
    and outbox.queue_status = 'dead';
  perform set_config('smot.announcement_outbox_write_scope', '', true);

  return query
    select * from public.announcements
    where id = transitioned_announcement.id;
end
$function$;

alter function announcement_worker_private.retry_failed_announcement_impl(
  uuid, integer, uuid, text
) owner to postgres;
revoke all on function announcement_worker_private.retry_failed_announcement_impl(
  uuid, integer, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function announcement_worker_private.retry_failed_announcement_impl(
  uuid, integer, uuid, text
) to service_role;

create or replace function public.retry_failed_announcement(
  p_announcement_id uuid,
  p_expected_version integer,
  p_actor_id uuid,
  p_request_id text
)
returns setof public.announcements
language sql
security invoker
set search_path = ''
begin atomic
  select *
  from announcement_worker_private.retry_failed_announcement_impl(
    p_announcement_id,
    p_expected_version,
    p_actor_id,
    p_request_id
  );
end;

alter function public.retry_failed_announcement(uuid, integer, uuid, text)
  owner to postgres;
revoke all on function public.retry_failed_announcement(uuid, integer, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.retry_failed_announcement(uuid, integer, uuid, text)
  to service_role;

comment on function public.retry_failed_announcement(uuid, integer, uuid, text) is
  'Admin-only trusted retry. Atomically reopens a partially failed campaign and resets only canonical failed/dead outbox pairs; delivered recipients are never duplicated.';
