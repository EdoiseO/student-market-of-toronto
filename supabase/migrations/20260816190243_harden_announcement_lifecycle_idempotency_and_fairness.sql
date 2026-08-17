-- Stage 5 release hardening for announcement operations.
--
-- Every administrator-initiated mutation now crosses one durable command
-- ledger. An ambiguous HTTP response can be retried with the same UUID and
-- exact payload without applying a second lifecycle transition. Scheduled
-- activation is oldest-due first so a continuous stream of urgent campaigns
-- cannot starve older normal or low-priority work.

create table public.announcement_lifecycle_commands (
  operation_id uuid primary key,
  announcement_id uuid not null
    references public.announcements(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_user_id_snapshot uuid not null,
  action text not null check (
    action in ('update_draft', 'schedule', 'unschedule', 'send', 'cancel', 'retry')
  ),
  command_payload jsonb not null,
  result_snapshot jsonb not null,
  audit_event_id uuid not null
    references public.moderation_audit_events(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  constraint announcement_lifecycle_commands_actor_snapshot_check
    check (actor_user_id is null or actor_user_id = actor_user_id_snapshot),
  constraint announcement_lifecycle_commands_payload_check
    check (
      jsonb_typeof(command_payload) = 'object'
      and octet_length(command_payload::text) <= 65536
    ),
  constraint announcement_lifecycle_commands_result_check
    check (
      jsonb_typeof(result_snapshot) = 'object'
      and octet_length(result_snapshot::text) <= 131072
    ),
  unique (actor_user_id_snapshot, operation_id)
);

comment on table public.announcement_lifecycle_commands is
  'Immutable replay ledger for update, schedule, unschedule, send, cancel, and retry operations. Result snapshots preserve the exact successful response after ambiguous client failures.';

create or replace function private.guard_announcement_lifecycle_command()
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
    and old.action is not distinct from new.action
    and old.command_payload is not distinct from new.command_payload
    and old.result_snapshot is not distinct from new.result_snapshot
    and old.audit_event_id is not distinct from new.audit_event_id
    and old.created_at is not distinct from new.created_at then
    return new;
  end if;

  if tg_op <> 'INSERT'
    or coalesce(current_setting('smot.announcement_lifecycle_command_scope', true), '')
      <> 'create' then
    raise exception 'announcement_lifecycle_commands_are_immutable'
      using errcode = '42501';
  end if;

  return new;
end
$function$;

alter function private.guard_announcement_lifecycle_command() owner to postgres;
revoke all on function private.guard_announcement_lifecycle_command()
  from public, anon, authenticated, service_role;

create trigger guard_announcement_lifecycle_command
before insert or update or delete on public.announcement_lifecycle_commands
for each row execute function private.guard_announcement_lifecycle_command();

alter table public.announcement_lifecycle_commands enable row level security;
revoke all on table public.announcement_lifecycle_commands
  from public, anon, authenticated, service_role;
grant select on table public.announcement_lifecycle_commands to service_role;

create or replace function announcement_worker_private.execute_announcement_lifecycle_command_impl(
  p_operation_id uuid,
  p_announcement_id uuid,
  p_expected_version integer,
  p_action text,
  p_actor_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns table (
  announcement jsonb,
  audit_event_id uuid,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  existing_command public.announcement_lifecycle_commands%rowtype;
  result_announcement public.announcements%rowtype;
  normalized_action text := lower(btrim(coalesce(p_action, '')));
  normalized_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  canonical_command jsonb;
  scheduled_for_value timestamptz;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'announcement_lifecycle_command_requires_service_role'
      using errcode = '42501';
  end if;
  if p_operation_id is null
    or p_announcement_id is null
    or p_expected_version is null
    or p_expected_version < 1
    or normalized_action not in (
      'update_draft', 'schedule', 'unschedule', 'send', 'cancel', 'retry'
    )
    or jsonb_typeof(normalized_payload) <> 'object'
    or octet_length(normalized_payload::text) > 65536 then
    raise exception 'announcement_lifecycle_command_input_is_invalid'
      using errcode = '22023';
  end if;

  perform private.require_active_announcement_admin(p_actor_id, now());

  canonical_command := jsonb_build_object(
    'announcement_id', p_announcement_id,
    'expected_version', p_expected_version,
    'action', normalized_action,
    'payload', normalized_payload
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_actor_id::text || ':announcement_lifecycle:' || p_operation_id::text,
      0
    )
  );

  select * into existing_command
  from public.announcement_lifecycle_commands command
  where command.operation_id = p_operation_id
  for update;

  if found then
    if existing_command.actor_user_id_snapshot is distinct from p_actor_id
      or existing_command.announcement_id is distinct from p_announcement_id
      or existing_command.action is distinct from normalized_action
      or existing_command.command_payload is distinct from canonical_command then
      raise exception 'announcement_operation_id_conflict' using errcode = '23505';
    end if;

    return query select
      existing_command.result_snapshot,
      existing_command.audit_event_id,
      true;
    return;
  end if;

  if normalized_action = 'update_draft' then
    if normalized_payload <> jsonb_strip_nulls(jsonb_build_object(
      'title', normalized_payload ->> 'title',
      'body', normalized_payload ->> 'body',
      'category', normalized_payload ->> 'category',
      'priority', normalized_payload ->> 'priority',
      'audience_type', normalized_payload ->> 'audience_type',
      'audience_filter', normalized_payload -> 'audience_filter',
      'delivery_policy', normalized_payload ->> 'delivery_policy',
      'email_enabled', normalized_payload -> 'email_enabled'
    )) or not (normalized_payload ?& array[
      'title', 'body', 'category', 'priority', 'audience_type',
      'audience_filter', 'delivery_policy', 'email_enabled'
    ]) then
      raise exception 'announcement_update_payload_is_invalid' using errcode = '22023';
    end if;

    select * into result_announcement
    from private.update_announcement_draft_impl(
      p_announcement_id,
      p_expected_version,
      normalized_payload ->> 'title',
      normalized_payload ->> 'body',
      normalized_payload ->> 'category',
      normalized_payload ->> 'priority',
      normalized_payload ->> 'audience_type',
      normalized_payload -> 'audience_filter',
      normalized_payload ->> 'delivery_policy',
      (normalized_payload ->> 'email_enabled')::boolean,
      p_actor_id,
      'announcement-lifecycle:' || p_operation_id::text
    );
  elsif normalized_action = 'retry' then
    if normalized_payload <> '{}'::jsonb then
      raise exception 'announcement_retry_payload_is_invalid' using errcode = '22023';
    end if;
    select * into result_announcement
    from announcement_worker_private.retry_failed_announcement_impl(
      p_announcement_id,
      p_expected_version,
      p_actor_id,
      'announcement-lifecycle:' || p_operation_id::text
    );
  else
    if normalized_action = 'schedule' then
      if not (normalized_payload ? 'scheduled_for')
        or normalized_payload - 'scheduled_for' <> '{}'::jsonb
        or jsonb_typeof(normalized_payload -> 'scheduled_for') <> 'string' then
        raise exception 'announcement_schedule_payload_is_invalid' using errcode = '22023';
      end if;
      begin
        scheduled_for_value := (normalized_payload ->> 'scheduled_for')::timestamptz;
      exception when others then
        raise exception 'announcement_schedule_payload_is_invalid' using errcode = '22023';
      end;
    elsif normalized_payload <> '{}'::jsonb then
      raise exception 'announcement_transition_payload_is_invalid' using errcode = '22023';
    end if;

    select * into result_announcement
    from announcement_worker_private.transition_announcement_service_impl(
      p_announcement_id,
      p_expected_version,
      case normalized_action
        when 'send' then 'start_sending'
        else normalized_action
      end,
      p_actor_id,
      scheduled_for_value,
      'announcement-lifecycle:' || p_operation_id::text
    );
  end if;

  if result_announcement.id is null
    or result_announcement.moderation_audit_event_id is null then
    raise exception 'announcement_lifecycle_command_result_is_invalid';
  end if;

  perform set_config('smot.announcement_lifecycle_command_scope', 'create', true);
  insert into public.announcement_lifecycle_commands (
    operation_id,
    announcement_id,
    actor_user_id,
    actor_user_id_snapshot,
    action,
    command_payload,
    result_snapshot,
    audit_event_id
  ) values (
    p_operation_id,
    p_announcement_id,
    p_actor_id,
    p_actor_id,
    normalized_action,
    canonical_command,
    to_jsonb(result_announcement),
    result_announcement.moderation_audit_event_id
  );
  perform set_config('smot.announcement_lifecycle_command_scope', '', true);

  return query select
    to_jsonb(result_announcement),
    result_announcement.moderation_audit_event_id,
    false;
end
$function$;

alter function announcement_worker_private.execute_announcement_lifecycle_command_impl(
  uuid, uuid, integer, text, uuid, jsonb
) owner to postgres;
revoke all on function announcement_worker_private.execute_announcement_lifecycle_command_impl(
  uuid, uuid, integer, text, uuid, jsonb
) from public, anon, authenticated, service_role;
grant execute on function announcement_worker_private.execute_announcement_lifecycle_command_impl(
  uuid, uuid, integer, text, uuid, jsonb
) to service_role;

create or replace function public.execute_announcement_lifecycle_command(
  p_operation_id uuid,
  p_announcement_id uuid,
  p_expected_version integer,
  p_action text,
  p_actor_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns table (
  announcement jsonb,
  audit_event_id uuid,
  replayed boolean
)
language sql
security invoker
set search_path = ''
begin atomic
  select *
  from announcement_worker_private.execute_announcement_lifecycle_command_impl(
    p_operation_id,
    p_announcement_id,
    p_expected_version,
    p_action,
    p_actor_id,
    p_payload
  );
end;

alter function public.execute_announcement_lifecycle_command(
  uuid, uuid, integer, text, uuid, jsonb
) owner to postgres;
revoke all on function public.execute_announcement_lifecycle_command(
  uuid, uuid, integer, text, uuid, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.execute_announcement_lifecycle_command(
  uuid, uuid, integer, text, uuid, jsonb
) to service_role;

-- Retire every non-idempotent administrator lifecycle entry point. The new
-- invoker wrapper above is the sole service-role boundary for these actions.
revoke execute on function public.update_announcement_draft(
  uuid, integer, text, text, text, text, text, jsonb, text, boolean, uuid, text
) from service_role;
revoke execute on function public.transition_announcement(
  uuid, integer, text, uuid, timestamptz, text
) from service_role;
revoke execute on function public.retry_failed_announcement(
  uuid, integer, uuid, text
) from service_role;
revoke execute on function private.update_announcement_draft_impl(
  uuid, integer, text, text, text, text, text, jsonb, text, boolean, uuid, text
) from service_role;
revoke execute on function announcement_worker_private.transition_announcement_service_impl(
  uuid, integer, text, uuid, timestamptz, text
) from service_role;
revoke execute on function announcement_worker_private.retry_failed_announcement_impl(
  uuid, integer, uuid, text
) from service_role;

-- A partially-failed campaign already has a terminal timestamp before it is
-- reopened. Its next worker finalization must replace that earlier timestamp;
-- otherwise every retry is permanently unfinalizable. All other identities,
-- counters, audit linkage, and version invariants remain unchanged.
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
    or new.sent_at is null
    or (old.sent_at is not null and new.sent_at < old.sent_at)
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

-- Oldest due first is a bounded and starvation-free policy. Priority remains
-- a deterministic tie-breaker only for campaigns due at the same instant.
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
      announcement.scheduled_for,
      case announcement.priority
        when 'urgent' then 1
        when 'high' then 2
        when 'normal' then 3
        else 4
      end,
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

comment on function public.execute_announcement_lifecycle_command(
  uuid, uuid, integer, text, uuid, jsonb
) is
  'Service-only, replay-safe administrator lifecycle boundary. An exact actor/action/payload retry returns the stored result and conflicting UUID reuse is rejected.';
