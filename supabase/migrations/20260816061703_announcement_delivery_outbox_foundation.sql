create schema if not exists private;

create or replace function private.is_valid_announcement_audience_filter(
  filter_type text,
  filter_value jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  item_count integer;
  distinct_item_count integer;
  invalid_item_count integer;
begin
  if filter_value is null
    or jsonb_typeof(filter_value) <> 'object'
    or octet_length(filter_value::text) > 65536 then
    return false;
  end if;

  if filter_type = 'all' then
    return filter_value = '{}'::jsonb;
  end if;

  if filter_type = 'school' then
    if not filter_value ? 'schools'
      or filter_value - 'schools' <> '{}'::jsonb
      or jsonb_typeof(filter_value -> 'schools') <> 'array' then
      return false;
    end if;

    select
      count(*)::integer,
      count(distinct item #>> '{}')::integer,
      count(*) filter (
        where jsonb_typeof(item) <> 'string'
          or char_length(btrim(item #>> '{}')) not between 1 and 160
      )::integer
    into item_count, distinct_item_count, invalid_item_count
    from jsonb_array_elements(filter_value -> 'schools') item;

    return item_count between 1 and 25
      and distinct_item_count = item_count
      and invalid_item_count = 0;
  end if;

  if filter_type = 'role' then
    if not filter_value ? 'roles'
      or filter_value - 'roles' <> '{}'::jsonb
      or jsonb_typeof(filter_value -> 'roles') <> 'array' then
      return false;
    end if;

    select
      count(*)::integer,
      count(distinct item #>> '{}')::integer,
      count(*) filter (
        where jsonb_typeof(item) <> 'string'
          or item #>> '{}' not in ('member', 'staff', 'moderator', 'admin')
      )::integer
    into item_count, distinct_item_count, invalid_item_count
    from jsonb_array_elements(filter_value -> 'roles') item;

    return item_count between 1 and 4
      and distinct_item_count = item_count
      and invalid_item_count = 0;
  end if;

  if filter_type = 'selected' then
    if not filter_value ? 'user_ids'
      or filter_value - 'user_ids' <> '{}'::jsonb
      or jsonb_typeof(filter_value -> 'user_ids') <> 'array' then
      return false;
    end if;

    select
      count(*)::integer,
      count(distinct item #>> '{}')::integer,
      count(*) filter (
        where jsonb_typeof(item) <> 'string'
          or item #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )::integer
    into item_count, distinct_item_count, invalid_item_count
    from jsonb_array_elements(filter_value -> 'user_ids') item;

    return item_count between 1 and 500
      and distinct_item_count = item_count
      and invalid_item_count = 0;
  end if;

  if filter_type = 'case' then
    return filter_value ? 'case_id'
      and filter_value - 'case_id' = '{}'::jsonb
      and jsonb_typeof(filter_value -> 'case_id') = 'string'
      and filter_value ->> 'case_id'
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  end if;

  return false;
end
$function$;

alter function private.is_valid_announcement_audience_filter(text, jsonb)
  owner to postgres;
revoke all on function private.is_valid_announcement_audience_filter(text, jsonb)
  from public, anon, authenticated, service_role;
grant usage on schema private to service_role;
grant execute on function private.is_valid_announcement_audience_filter(text, jsonb)
  to service_role;

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  category text not null default 'general',
  priority text not null default 'normal',
  audience_type text not null default 'all',
  audience_filter jsonb not null default '{}'::jsonb,
  delivery_policy text not null default 'preference_aware',
  email_enabled boolean not null default false,
  status text not null default 'draft',
  scheduled_for timestamptz,
  sending_started_at timestamptz,
  sent_at timestamptz,
  cancelled_at timestamptz,
  recipient_count integer not null default 0,
  delivered_count integer not null default 0,
  failed_count integer not null default 0,
  skipped_count integer not null default 0,
  cancelled_count integer not null default 0,
  read_count integer not null default 0,
  dismissed_count integer not null default 0,
  moderation_audit_event_id uuid
    references public.moderation_audit_events(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_by_snapshot uuid not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_by_snapshot uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_title_length_check
    check (char_length(trim(title)) between 1 and 160),
  constraint announcements_body_length_check
    check (char_length(trim(body)) between 1 and 2000),
  constraint announcements_category_check
    check (category = any (array[
      'general',
      'maintenance',
      'safety',
      'policy',
      'moderation'
    ]::text[])),
  constraint announcements_priority_check
    check (priority = any (array['low', 'normal', 'high', 'urgent']::text[])),
  constraint announcements_audience_type_check
    check (audience_type = any (array[
      'all',
      'school',
      'role',
      'selected',
      'case'
    ]::text[])),
  constraint announcements_audience_filter_check
    check (private.is_valid_announcement_audience_filter(audience_type, audience_filter)),
  constraint announcements_delivery_policy_check
    check (delivery_policy = any (array['preference_aware', 'always_on']::text[])),
  constraint announcements_mandatory_category_policy_check
    check (
      category <> all (array['safety', 'policy', 'moderation']::text[])
      or delivery_policy = 'always_on'
    ),
  constraint announcements_status_check
    check (status = any (array[
      'draft',
      'scheduled',
      'sending',
      'sent',
      'partially_failed',
      'cancelled'
    ]::text[])),
  constraint announcements_scheduled_timestamp_check
    check (status <> 'scheduled' or scheduled_for is not null),
  constraint announcements_sending_timestamp_check
    check (status <> 'sending' or sending_started_at is not null),
  constraint announcements_sent_timestamp_check
    check (status <> all (array['sent', 'partially_failed']::text[]) or sent_at is not null),
  constraint announcements_cancelled_timestamp_check
    check (status <> 'cancelled' or cancelled_at is not null),
  constraint announcements_counter_bounds_check
    check (
      recipient_count >= 0
      and delivered_count >= 0
      and failed_count >= 0
      and skipped_count >= 0
      and cancelled_count >= 0
      and read_count >= 0
      and dismissed_count >= 0
      and delivered_count + failed_count + skipped_count + cancelled_count <= recipient_count
      and read_count <= delivered_count
      and dismissed_count <= delivered_count
    ),
  constraint announcements_version_check check (version >= 1),
  constraint announcements_creator_snapshot_check
    check (created_by is null or created_by = created_by_snapshot),
  constraint announcements_updater_snapshot_check
    check (updated_by is null or updated_by = updated_by_snapshot),
  constraint announcements_updated_at_check check (updated_at >= created_at)
);

comment on table public.announcements is
  'Durable announcement definitions and aggregate delivery counters. Existing listing-null announcement conversations remain authoritative until the Stage 3 API cutover.';

comment on column public.announcements.moderation_audit_event_id is
  'Reference to the latest aggregate moderation audit event. Non-draft transitions require the matching event type with resource_type=announcement and resource_id=announcements.id; delivery attempts are not audited individually.';

comment on column public.announcements.delivery_policy is
  'preference_aware may honor ordinary notification preferences; always_on bypasses opt-outs for safety, policy, and moderation notices.';

create index announcements_status_created_at_idx
  on public.announcements (status, created_at desc);

create index announcements_scheduled_for_idx
  on public.announcements (scheduled_for)
  where status = 'scheduled';

create index announcements_created_by_created_at_idx
  on public.announcements (created_by, created_at desc)
  where created_by is not null;

create index announcements_moderation_audit_event_id_idx
  on public.announcements (moderation_audit_event_id)
  where moderation_audit_event_id is not null;

create table public.announcement_lifecycle_history (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null,
  announcement_version integer not null,
  action text not null,
  previous_status text,
  new_status text not null,
  previous_scheduled_for timestamptz,
  new_scheduled_for timestamptz,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_user_id_snapshot uuid not null,
  actor_role text not null,
  moderation_audit_event_id uuid not null unique
    references public.moderation_audit_events(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint announcement_lifecycle_history_version_key
    unique (announcement_id, announcement_version),
  constraint announcement_lifecycle_history_version_check
    check (announcement_version >= 1),
  constraint announcement_lifecycle_history_action_check
    check (action in (
      'create',
      'update',
      'schedule',
      'unschedule',
      'start_sending',
      'complete',
      'partially_fail',
      'cancel'
    )),
  constraint announcement_lifecycle_history_status_check
    check (
      (previous_status is null or previous_status in (
        'draft', 'scheduled', 'sending', 'sent', 'partially_failed', 'cancelled'
      ))
      and new_status in (
        'draft', 'scheduled', 'sending', 'sent', 'partially_failed', 'cancelled'
      )
    ),
  constraint announcement_lifecycle_history_actor_snapshot_check
    check (actor_user_id is null or actor_user_id = actor_user_id_snapshot),
  constraint announcement_lifecycle_history_actor_role_check
    check (actor_role = 'admin')
);

comment on table public.announcement_lifecycle_history is
  'Immutable announcement lifecycle history. Snapshot identifiers and canonical audit links survive Auth-user deletion and cannot be rebound.';

create index announcement_lifecycle_history_announcement_created_idx
  on public.announcement_lifecycle_history (
    announcement_id,
    announcement_version desc,
    created_at desc
  );

create index announcement_lifecycle_history_actor_created_idx
  on public.announcement_lifecycle_history (
    actor_user_id_snapshot,
    created_at desc
  );

create table public.announcement_deliveries (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null
    references public.announcements(id) on delete restrict,
  recipient_user_id uuid
    references public.profiles(id) on delete set null,
  recipient_user_id_snapshot uuid not null,
  status text not null default 'queued',
  conversation_id uuid references public.conversations(id) on delete set null,
  conversation_id_snapshot uuid,
  message_id uuid references public.messages(id) on delete set null,
  message_id_snapshot uuid,
  notification_id uuid references public.notifications(id) on delete set null,
  notification_id_snapshot uuid,
  delivered_at timestamptz,
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcement_deliveries_announcement_recipient_key
    unique (announcement_id, recipient_user_id_snapshot),
  constraint announcement_deliveries_recipient_snapshot_check
    check (
      recipient_user_id is null
      or recipient_user_id = recipient_user_id_snapshot
    ),
  constraint announcement_deliveries_output_snapshot_check
    check (
      (conversation_id is null or conversation_id = conversation_id_snapshot)
      and (message_id is null or message_id = message_id_snapshot)
      and (notification_id is null or notification_id = notification_id_snapshot)
    ),
  constraint announcement_deliveries_status_check
    check (status = any (array[
      'queued',
      'processing',
      'delivered',
      'failed',
      'skipped',
      'cancelled'
    ]::text[])),
  constraint announcement_deliveries_delivered_timestamp_check
    check ((status = 'delivered') = (delivered_at is not null)),
  constraint announcement_deliveries_read_timestamp_check
    check (read_at is null or (status = 'delivered' and read_at >= delivered_at)),
  constraint announcement_deliveries_dismissed_timestamp_check
    check (dismissed_at is null or (status = 'delivered' and dismissed_at >= delivered_at)),
  constraint announcement_deliveries_updated_at_check check (updated_at >= created_at)
);

comment on table public.announcement_deliveries is
  'Recipient-safe durable delivery and read state. The immutable recipient snapshot preserves history after account deletion; retry errors, attempt counts, and lease credentials are isolated in announcement_delivery_outbox.';

create index announcement_deliveries_recipient_status_updated_idx
  on public.announcement_deliveries (recipient_user_id, status, updated_at desc);

create index announcement_deliveries_announcement_status_idx
  on public.announcement_deliveries (announcement_id, status);

create unique index announcement_deliveries_message_id_key
  on public.announcement_deliveries (message_id)
  where message_id is not null;

create unique index announcement_deliveries_notification_id_key
  on public.announcement_deliveries (notification_id)
  where notification_id is not null;

create table public.announcement_delivery_outbox (
  delivery_id uuid primary key
    references public.announcement_deliveries(id) on delete restrict,
  idempotency_key uuid not null default gen_random_uuid() unique,
  queue_status text not null default 'pending',
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  send_in_app boolean not null default true,
  send_email boolean not null default false,
  last_attempt_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcement_delivery_outbox_queue_status_check
    check (queue_status = any (array[
      'pending',
      'leased',
      'retry',
      'completed',
      'dead',
      'cancelled'
    ]::text[])),
  constraint announcement_delivery_outbox_attempt_count_check
    check (attempt_count >= 0 and attempt_count <= max_attempts),
  constraint announcement_delivery_outbox_max_attempts_check
    check (max_attempts between 1 and 20),
  constraint announcement_delivery_outbox_lease_check
    check (
      (queue_status = 'leased' and lease_token is not null and lease_expires_at is not null)
      or (queue_status <> 'leased' and lease_token is null and lease_expires_at is null)
    ),
  constraint announcement_delivery_outbox_channel_check
    check (send_in_app or send_email),
  constraint announcement_delivery_outbox_completed_check
    check ((queue_status = 'completed') = (completed_at is not null)),
  constraint announcement_delivery_outbox_last_error_check
    check (last_error is null or char_length(last_error) between 1 and 2000),
  constraint announcement_delivery_outbox_failure_error_check
    check (queue_status not in ('retry', 'dead') or last_error is not null),
  constraint announcement_delivery_outbox_attempted_status_check
    check (
      queue_status in ('pending', 'cancelled')
      or attempt_count > 0
    ),
  constraint announcement_delivery_outbox_updated_at_check check (updated_at >= created_at)
);

comment on table public.announcement_delivery_outbox is
  'Internal per-recipient delivery queue. delivery_id and idempotency_key remain stable across retries; workers claim rows with short leases and never create a second outbox row for the same delivery.';

comment on column public.announcement_delivery_outbox.idempotency_key is
  'Stable external-provider idempotency key. Retries reuse this value and the delivery message/notification references.';

comment on column public.announcement_delivery_outbox.attempt_count is
  'Starts at zero, increments exactly once whenever a worker acquires a lease, and resets to zero only for an explicit dead-to-pending manual retry.';

create index announcement_delivery_outbox_ready_idx
  on public.announcement_delivery_outbox (available_at, delivery_id)
  where queue_status in ('pending', 'retry');

create index announcement_delivery_outbox_expired_lease_idx
  on public.announcement_delivery_outbox (lease_expires_at, delivery_id)
  where queue_status = 'leased';

create or replace function private.enforce_announcement_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  write_scope text := current_setting('smot.announcement_write_scope', true);
  counter_fields_changed boolean;
  expected_audit_event_type text;
begin
  if tg_op = 'DELETE' then
    raise exception 'announcements_are_durable';
  end if;

  if tg_op = 'INSERT' then
    if write_scope <> 'create'
      or new.status <> 'draft'
      or new.version <> 1
      or new.scheduled_for is not null
      or new.sending_started_at is not null
      or new.sent_at is not null
      or new.cancelled_at is not null
      or new.created_by is null
      or new.created_by_snapshot <> new.created_by
      or new.updated_by <> new.created_by
      or new.updated_by_snapshot <> new.created_by_snapshot
      or new.recipient_count <> 0
      or new.delivered_count <> 0
      or new.failed_count <> 0
      or new.skipped_count <> 0
      or new.cancelled_count <> 0
      or new.read_count <> 0
      or new.dismissed_count <> 0 then
      raise exception 'announcements_must_be_created_through_rpc';
    end if;

    if not exists (
      select 1
      from public.moderation_audit_events audit_event
      where audit_event.id = new.moderation_audit_event_id
        and audit_event.event_type = 'announcement.created'
        and audit_event.actor_user_id_snapshot = new.created_by_snapshot
        and audit_event.resource_type = 'announcement'
        and audit_event.resource_id = new.id
    ) then
      raise exception 'announcement_creation_requires_audit_event';
    end if;

    return new;
  end if;

  counter_fields_changed :=
    old.recipient_count is distinct from new.recipient_count
    or old.delivered_count is distinct from new.delivered_count
    or old.failed_count is distinct from new.failed_count
    or old.skipped_count is distinct from new.skipped_count
    or old.cancelled_count is distinct from new.cancelled_count
    or old.read_count is distinct from new.read_count
    or old.dismissed_count is distinct from new.dismissed_count;

  if write_scope = 'counter_refresh' then
    if old.id is distinct from new.id
      or old.title is distinct from new.title
      or old.body is distinct from new.body
      or old.category is distinct from new.category
      or old.priority is distinct from new.priority
      or old.audience_type is distinct from new.audience_type
      or old.audience_filter is distinct from new.audience_filter
      or old.delivery_policy is distinct from new.delivery_policy
      or old.email_enabled is distinct from new.email_enabled
      or old.status is distinct from new.status
      or old.scheduled_for is distinct from new.scheduled_for
      or old.sending_started_at is distinct from new.sending_started_at
      or old.sent_at is distinct from new.sent_at
      or old.cancelled_at is distinct from new.cancelled_at
      or old.moderation_audit_event_id is distinct from new.moderation_audit_event_id
      or old.created_by is distinct from new.created_by
      or old.created_by_snapshot is distinct from new.created_by_snapshot
      or old.updated_by is distinct from new.updated_by
      or old.updated_by_snapshot is distinct from new.updated_by_snapshot
      or old.version is distinct from new.version
      or old.created_at is distinct from new.created_at
      or old.updated_at is distinct from new.updated_at then
      raise exception 'invalid_announcement_counter_refresh';
    end if;

    return new;
  end if;

  if coalesce(write_scope, '') = ''
    and old.id is not distinct from new.id
    and old.title is not distinct from new.title
    and old.body is not distinct from new.body
    and old.category is not distinct from new.category
    and old.priority is not distinct from new.priority
    and old.audience_type is not distinct from new.audience_type
    and old.audience_filter is not distinct from new.audience_filter
    and old.delivery_policy is not distinct from new.delivery_policy
    and old.email_enabled is not distinct from new.email_enabled
    and old.status is not distinct from new.status
    and old.scheduled_for is not distinct from new.scheduled_for
    and old.sending_started_at is not distinct from new.sending_started_at
    and old.sent_at is not distinct from new.sent_at
    and old.cancelled_at is not distinct from new.cancelled_at
    and old.moderation_audit_event_id is not distinct from new.moderation_audit_event_id
    and (
      new.created_by is not distinct from old.created_by
      or (old.created_by is not null and new.created_by is null)
    )
    and old.created_by_snapshot is not distinct from new.created_by_snapshot
    and (
      new.updated_by is not distinct from old.updated_by
      or (old.updated_by is not null and new.updated_by is null)
    )
    and old.updated_by_snapshot is not distinct from new.updated_by_snapshot
    and old.version is not distinct from new.version
    and old.created_at is not distinct from new.created_at
    and old.updated_at is not distinct from new.updated_at
    and not counter_fields_changed then
    return new;
  end if;

  if write_scope = 'update' then
    if old.status <> 'draft'
      or new.status <> 'draft'
      or counter_fields_changed
      or old.id is distinct from new.id
      or old.scheduled_for is distinct from new.scheduled_for
      or old.sending_started_at is distinct from new.sending_started_at
      or old.sent_at is distinct from new.sent_at
      or old.cancelled_at is distinct from new.cancelled_at
      or old.created_by is distinct from new.created_by
      or old.created_by_snapshot is distinct from new.created_by_snapshot
      or old.created_at is distinct from new.created_at
      or new.updated_by is null
      or new.updated_by_snapshot <> new.updated_by
      or new.version <> old.version + 1
      or not exists (
        select 1
        from public.moderation_audit_events audit_event
        where audit_event.id = new.moderation_audit_event_id
          and audit_event.event_type = 'announcement.updated'
          and audit_event.actor_user_id_snapshot = new.updated_by_snapshot
          and audit_event.resource_type = 'announcement'
          and audit_event.resource_id = new.id
      ) then
      raise exception 'invalid_announcement_draft_update';
    end if;

    return new;
  end if;

  if write_scope <> 'transition'
    or counter_fields_changed
    or old.id is distinct from new.id
    or old.title is distinct from new.title
    or old.body is distinct from new.body
    or old.category is distinct from new.category
    or old.priority is distinct from new.priority
    or old.audience_type is distinct from new.audience_type
    or old.audience_filter is distinct from new.audience_filter
    or old.delivery_policy is distinct from new.delivery_policy
    or old.email_enabled is distinct from new.email_enabled
    or old.created_by is distinct from new.created_by
    or old.created_by_snapshot is distinct from new.created_by_snapshot
    or old.created_at is distinct from new.created_at
    or new.updated_by is null
    or new.updated_by_snapshot <> new.updated_by
    or new.version <> old.version + 1 then
    raise exception 'announcement_must_be_changed_through_transition_rpc';
  end if;

  if old.status is distinct from new.status and not (
    (old.status = 'draft' and new.status in ('scheduled', 'sending', 'cancelled'))
    or (old.status = 'scheduled' and new.status in ('draft', 'sending', 'cancelled'))
    or (old.status = 'sending' and new.status in ('sent', 'partially_failed', 'cancelled'))
    or (old.status = 'partially_failed' and new.status in ('sending', 'cancelled'))
  ) then
    raise exception 'invalid_announcement_status_transition';
  end if;

  if new.moderation_audit_event_id is not null and not exists (
    select 1
    from public.moderation_audit_events audit_event
    where audit_event.id = new.moderation_audit_event_id
      and audit_event.resource_type = 'announcement'
      and audit_event.resource_id = new.id
      and audit_event.actor_user_id_snapshot = new.updated_by_snapshot
  ) then
    raise exception 'invalid_announcement_audit_event';
  end if;

  if old.status is distinct from new.status then
    expected_audit_event_type := case
      when old.status = 'scheduled' and new.status = 'draft' then 'announcement.unscheduled'
      when new.status = 'scheduled' then 'announcement.scheduled'
      when new.status = 'sending' then 'announcement.sending'
      when new.status in ('sent', 'partially_failed') then 'announcement.completed'
      when new.status = 'cancelled' then 'announcement.cancelled'
      else null
    end;

    if expected_audit_event_type is not null and not exists (
      select 1
      from public.moderation_audit_events audit_event
      where audit_event.id = new.moderation_audit_event_id
        and audit_event.event_type = expected_audit_event_type
        and audit_event.resource_type = 'announcement'
        and audit_event.resource_id = new.id
    ) then
      raise exception 'announcement_status_transition_requires_audit_event';
    end if;
  end if;

  if new.status = 'draft' then
    new.scheduled_for := null;
  elsif new.status = 'sending' and new.sending_started_at is null then
    new.sending_started_at := now();
  elsif new.status in ('sent', 'partially_failed') and new.sent_at is null then
    new.sent_at := now();
  elsif new.status = 'cancelled' and new.cancelled_at is null then
    new.cancelled_at := now();
  end if;

  if old.sending_started_at is not null
    and new.sending_started_at is distinct from old.sending_started_at then
    raise exception 'announcement_sending_timestamp_is_immutable';
  end if;
  if old.sent_at is not null and new.sent_at is distinct from old.sent_at then
    raise exception 'announcement_sent_timestamp_is_immutable';
  end if;
  if old.cancelled_at is not null and new.cancelled_at is distinct from old.cancelled_at then
    raise exception 'announcement_cancelled_timestamp_is_immutable';
  end if;

  return new;
end
$function$;

alter function private.enforce_announcement_lifecycle()
  owner to postgres;
revoke all on function private.enforce_announcement_lifecycle()
  from public, anon, authenticated, service_role;

create trigger enforce_announcement_lifecycle
before insert or update or delete on public.announcements
for each row execute function private.enforce_announcement_lifecycle();

create or replace function private.enforce_announcement_history_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE'
    and old.actor_user_id is not null
    and new.actor_user_id is null
    and old.id is not distinct from new.id
    and old.announcement_id is not distinct from new.announcement_id
    and old.announcement_version is not distinct from new.announcement_version
    and old.action is not distinct from new.action
    and old.previous_status is not distinct from new.previous_status
    and old.new_status is not distinct from new.new_status
    and old.previous_scheduled_for is not distinct from new.previous_scheduled_for
    and old.new_scheduled_for is not distinct from new.new_scheduled_for
    and old.actor_user_id_snapshot is not distinct from new.actor_user_id_snapshot
    and old.actor_role is not distinct from new.actor_role
    and old.moderation_audit_event_id is not distinct from new.moderation_audit_event_id
    and old.created_at is not distinct from new.created_at then
    return new;
  end if;

  if tg_op <> 'INSERT'
    or coalesce(current_setting('smot.announcement_history_write_scope', true), '')
      not in ('create', 'update', 'transition') then
    raise exception 'announcement_history_is_immutable';
  end if;

  return new;
end
$function$;

alter function private.enforce_announcement_history_lifecycle()
  owner to postgres;
revoke all on function private.enforce_announcement_history_lifecycle()
  from public, anon, authenticated, service_role;

create trigger enforce_announcement_history_lifecycle
before insert or update or delete on public.announcement_lifecycle_history
for each row execute function private.enforce_announcement_history_lifecycle();

create or replace function private.enforce_announcement_delivery_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  write_scope text := coalesce(
    current_setting('smot.announcement_delivery_write_scope', true),
    ''
  );
  only_auth_fk_nulling boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'announcement_deliveries_are_durable';
  end if;

  if tg_op = 'INSERT' then
    if write_scope <> 'enqueue'
      or new.status <> 'queued'
      or new.recipient_user_id is null
      or new.recipient_user_id_snapshot <> new.recipient_user_id
      or new.conversation_id is not null
      or new.conversation_id_snapshot is not null
      or new.message_id is not null
      or new.message_id_snapshot is not null
      or new.notification_id is not null
      or new.notification_id_snapshot is not null
      or new.delivered_at is not null
      or new.read_at is not null
      or new.dismissed_at is not null then
      raise exception 'announcement_deliveries_must_be_enqueued_through_rpc';
    end if;

    new.updated_at := new.created_at;
    return new;
  end if;

  only_auth_fk_nulling :=
    write_scope = ''
    and old.id is not distinct from new.id
    and old.announcement_id is not distinct from new.announcement_id
    and (
      new.recipient_user_id is not distinct from old.recipient_user_id
      or (old.recipient_user_id is not null and new.recipient_user_id is null)
    )
    and old.recipient_user_id_snapshot is not distinct from new.recipient_user_id_snapshot
    and old.status is not distinct from new.status
    and (
      new.conversation_id is not distinct from old.conversation_id
      or (old.conversation_id is not null and new.conversation_id is null)
    )
    and old.conversation_id_snapshot is not distinct from new.conversation_id_snapshot
    and (
      new.message_id is not distinct from old.message_id
      or (old.message_id is not null and new.message_id is null)
    )
    and old.message_id_snapshot is not distinct from new.message_id_snapshot
    and (
      new.notification_id is not distinct from old.notification_id
      or (old.notification_id is not null and new.notification_id is null)
    )
    and old.notification_id_snapshot is not distinct from new.notification_id_snapshot
    and old.delivered_at is not distinct from new.delivered_at
    and old.read_at is not distinct from new.read_at
    and old.dismissed_at is not distinct from new.dismissed_at
    and old.created_at is not distinct from new.created_at;

  if only_auth_fk_nulling then
    if old.recipient_user_id is not null
      and new.recipient_user_id is null
      and old.status in ('queued', 'processing', 'failed') then
      new.status := 'cancelled';
    end if;
    new.updated_at := now();
    return new;
  end if;

  if write_scope not in ('claim', 'finish', 'cancel', 'recipient_state')
    or old.id is distinct from new.id
    or old.announcement_id is distinct from new.announcement_id
    or old.recipient_user_id is distinct from new.recipient_user_id
    or old.recipient_user_id_snapshot is distinct from new.recipient_user_id_snapshot
    or old.created_at is distinct from new.created_at then
    raise exception 'announcement_delivery_must_be_changed_through_rpc';
  end if;

  if (old.conversation_id is null and new.conversation_id is not null and write_scope <> 'finish')
    or (old.message_id is null and new.message_id is not null and write_scope <> 'finish')
    or (old.notification_id is null and new.notification_id is not null and write_scope <> 'finish')
    or (old.conversation_id is not null and new.conversation_id is distinct from old.conversation_id and new.conversation_id is not null)
    or (old.message_id is not null and new.message_id is distinct from old.message_id and new.message_id is not null)
    or (old.notification_id is not null and new.notification_id is distinct from old.notification_id and new.notification_id is not null)
    or (old.conversation_id is null and old.conversation_id_snapshot is not null and new.conversation_id is not null)
    or (old.message_id is null and old.message_id_snapshot is not null and new.message_id is not null)
    or (old.notification_id is null and old.notification_id_snapshot is not null and new.notification_id is not null)
    or (old.conversation_id_snapshot is not null and new.conversation_id_snapshot is distinct from old.conversation_id_snapshot)
    or (old.message_id_snapshot is not null and new.message_id_snapshot is distinct from old.message_id_snapshot)
    or (old.notification_id_snapshot is not null and new.notification_id_snapshot is distinct from old.notification_id_snapshot) then
    raise exception 'announcement_delivery_output_reference_locked';
  end if;

  if write_scope = 'claim' then
    if old.status not in ('queued', 'failed')
      or new.status <> 'processing'
      or old.delivered_at is distinct from new.delivered_at
      or old.read_at is distinct from new.read_at
      or old.dismissed_at is distinct from new.dismissed_at then
      raise exception 'invalid_announcement_delivery_claim';
    end if;
  elsif write_scope = 'finish' then
    if old.status <> 'processing'
      or new.status not in ('delivered', 'failed')
      or old.read_at is distinct from new.read_at
      or old.dismissed_at is distinct from new.dismissed_at then
      raise exception 'invalid_announcement_delivery_finish';
    end if;

    if new.status = 'delivered' then
      if old.delivered_at is not null then
        raise exception 'announcement_delivery_already_delivered';
      end if;
      new.delivered_at := now();
      new.conversation_id_snapshot := coalesce(old.conversation_id_snapshot, new.conversation_id);
      new.message_id_snapshot := coalesce(old.message_id_snapshot, new.message_id);
      new.notification_id_snapshot := coalesce(old.notification_id_snapshot, new.notification_id);
    elsif old.delivered_at is distinct from new.delivered_at then
      raise exception 'announcement_delivery_delivered_at_is_locked';
    end if;
  elsif write_scope = 'cancel' then
    if old.status not in ('queued', 'processing', 'failed')
      or new.status <> 'cancelled'
      or old.conversation_id is distinct from new.conversation_id
      or old.conversation_id_snapshot is distinct from new.conversation_id_snapshot
      or old.message_id is distinct from new.message_id
      or old.message_id_snapshot is distinct from new.message_id_snapshot
      or old.notification_id is distinct from new.notification_id
      or old.notification_id_snapshot is distinct from new.notification_id_snapshot
      or old.delivered_at is distinct from new.delivered_at
      or old.read_at is distinct from new.read_at
      or old.dismissed_at is distinct from new.dismissed_at then
      raise exception 'invalid_announcement_delivery_cancellation';
    end if;
  else
    if old.status <> 'delivered'
      or new.status <> 'delivered'
      or old.conversation_id is distinct from new.conversation_id
      or old.conversation_id_snapshot is distinct from new.conversation_id_snapshot
      or old.message_id is distinct from new.message_id
      or old.message_id_snapshot is distinct from new.message_id_snapshot
      or old.notification_id is distinct from new.notification_id
      or old.notification_id_snapshot is distinct from new.notification_id_snapshot
      or old.delivered_at is distinct from new.delivered_at
      or (old.read_at is not null and new.read_at is distinct from old.read_at)
      or (old.dismissed_at is not null and new.dismissed_at is distinct from old.dismissed_at) then
      raise exception 'invalid_announcement_recipient_state_change';
    end if;

    if old.read_at is null and new.read_at is not null then
      new.read_at := now();
    end if;
    if old.dismissed_at is null and new.dismissed_at is not null then
      new.dismissed_at := now();
      new.read_at := coalesce(new.read_at, now());
    end if;
  end if;

  if old.delivered_at is not null
    and new.delivered_at is distinct from old.delivered_at then
    raise exception 'announcement_delivery_delivered_at_is_immutable';
  end if;

  new.updated_at := now();
  return new;
end
$function$;

alter function private.enforce_announcement_delivery_lifecycle()
  owner to postgres;
revoke all on function private.enforce_announcement_delivery_lifecycle()
  from public, anon, authenticated, service_role;

create trigger enforce_announcement_delivery_lifecycle
before insert or update or delete on public.announcement_deliveries
for each row execute function private.enforce_announcement_delivery_lifecycle();

create or replace function private.cancel_orphaned_announcement_delivery_outbox()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.recipient_user_id is not null and new.recipient_user_id is null then
    perform set_config('smot.announcement_outbox_write_scope', 'cancel', true);
    update public.announcement_delivery_outbox
    set
      queue_status = 'cancelled',
      lease_token = null,
      lease_expires_at = null,
      updated_at = now()
    where delivery_id = new.id
      and queue_status in ('pending', 'leased', 'retry');
    perform set_config('smot.announcement_outbox_write_scope', '', true);
  end if;

  return new;
end
$function$;

alter function private.cancel_orphaned_announcement_delivery_outbox()
  owner to postgres;
revoke all on function private.cancel_orphaned_announcement_delivery_outbox()
  from public, anon, authenticated, service_role;

create trigger cancel_orphaned_announcement_delivery_outbox
after update of recipient_user_id on public.announcement_deliveries
for each row execute function private.cancel_orphaned_announcement_delivery_outbox();

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

  if write_scope not in ('claim', 'finish', 'cancel')
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
  else
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
  end if;

  new.updated_at := now();
  return new;
end
$function$;

alter function private.enforce_announcement_outbox_lifecycle()
  owner to postgres;
revoke all on function private.enforce_announcement_outbox_lifecycle()
  from public, anon, authenticated, service_role;

create trigger enforce_announcement_outbox_lifecycle
before insert or update or delete on public.announcement_delivery_outbox
for each row execute function private.enforce_announcement_outbox_lifecycle();

create or replace function private.refresh_announcement_delivery_counters()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_announcement_id uuid;
begin
  target_announcement_id := case
    when tg_op = 'DELETE' then old.announcement_id
    else new.announcement_id
  end;

  perform set_config('smot.announcement_write_scope', 'counter_refresh', true);

  update public.announcements announcement
  set
    recipient_count = counters.recipient_count,
    delivered_count = counters.delivered_count,
    failed_count = counters.failed_count,
    skipped_count = counters.skipped_count,
    cancelled_count = counters.cancelled_count,
    read_count = counters.read_count,
    dismissed_count = counters.dismissed_count
  from (
    select
      count(*)::integer as recipient_count,
      count(*) filter (where delivery.status = 'delivered')::integer as delivered_count,
      count(*) filter (where delivery.status = 'failed')::integer as failed_count,
      count(*) filter (where delivery.status = 'skipped')::integer as skipped_count,
      count(*) filter (where delivery.status = 'cancelled')::integer as cancelled_count,
      count(*) filter (where delivery.read_at is not null)::integer as read_count,
      count(*) filter (where delivery.dismissed_at is not null)::integer as dismissed_count
    from public.announcement_deliveries delivery
    where delivery.announcement_id = target_announcement_id
  ) counters
  where announcement.id = target_announcement_id;

  perform set_config('smot.announcement_write_scope', '', true);

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end
$function$;

alter function private.refresh_announcement_delivery_counters()
  owner to postgres;
revoke all on function private.refresh_announcement_delivery_counters()
  from public, anon, authenticated, service_role;

create trigger refresh_announcement_delivery_counters
after insert or update or delete on public.announcement_deliveries
for each row execute function private.refresh_announcement_delivery_counters();

create or replace function private.require_active_announcement_admin(
  p_actor_id uuid,
  p_checked_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_role text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'announcement_admin_action_requires_service_role'
      using errcode = '42501';
  end if;

  select 'admin'
  into actor_role
  from auth.users actor
  where actor.id = p_actor_id
    and (
      lower(trim(coalesce(actor.raw_app_meta_data ->> 'role', ''))) = 'admin'
      or exists (
        select 1
        from jsonb_array_elements_text(
          case
            when jsonb_typeof(actor.raw_app_meta_data -> 'roles') = 'array'
              then actor.raw_app_meta_data -> 'roles'
            else '[]'::jsonb
          end
        ) assigned_role(value)
        where lower(trim(assigned_role.value)) = 'admin'
      )
    )
    and (actor.banned_until is null or actor.banned_until <= p_checked_at)
    and not exists (
      select 1
      from public.user_status status
      where status.user_id = actor.id
        and status.is_banned
        and (status.banned_until is null or status.banned_until > p_checked_at)
    );

  if actor_role is null then
    raise exception 'active_announcement_admin_required'
      using errcode = '42501';
  end if;

  return actor_role;
end
$function$;

alter function private.require_active_announcement_admin(uuid, timestamptz)
  owner to postgres;
revoke all on function private.require_active_announcement_admin(uuid, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function private.create_announcement_draft_impl(
  p_title text,
  p_body text,
  p_category text,
  p_priority text,
  p_audience_type text,
  p_audience_filter jsonb,
  p_delivery_policy text,
  p_email_enabled boolean,
  p_actor_id uuid,
  p_request_id text default null
)
returns setof public.announcements
language plpgsql
security definer
set search_path = ''
as $function$
declare
  announcement_id uuid := gen_random_uuid();
  audit_event_id uuid := gen_random_uuid();
  created_at_value timestamptz := now();
  normalized_request_id text := nullif(btrim(coalesce(p_request_id, '')), '');
begin
  perform private.require_active_announcement_admin(p_actor_id, created_at_value);

  if normalized_request_id is not null and char_length(normalized_request_id) > 200 then
    raise exception 'announcement_request_id_too_long' using errcode = '22023';
  end if;

  insert into public.moderation_audit_events (
    id, event_type, actor_user_id, actor_user_id_snapshot, actor_role,
    resource_type, resource_id, summary, metadata, request_id, occurred_at
  ) values (
    audit_event_id, 'announcement.created', p_actor_id, p_actor_id, 'admin',
    'announcement', announcement_id, 'Announcement draft created',
    jsonb_build_object('status', 'draft', 'version', 1),
    normalized_request_id, created_at_value
  );

  perform set_config('smot.announcement_write_scope', 'create', true);
  insert into public.announcements (
    id, title, body, category, priority, audience_type, audience_filter,
    delivery_policy, email_enabled, status, moderation_audit_event_id,
    created_by, created_by_snapshot, updated_by, updated_by_snapshot,
    version, created_at, updated_at
  ) values (
    announcement_id, btrim(p_title), btrim(p_body), lower(btrim(p_category)),
    lower(btrim(p_priority)), lower(btrim(p_audience_type)), p_audience_filter,
    lower(btrim(p_delivery_policy)), coalesce(p_email_enabled, false), 'draft',
    audit_event_id, p_actor_id, p_actor_id, p_actor_id, p_actor_id,
    1, created_at_value, created_at_value
  );
  perform set_config('smot.announcement_write_scope', '', true);

  perform set_config('smot.announcement_history_write_scope', 'create', true);
  insert into public.announcement_lifecycle_history (
    announcement_id, announcement_version, action, previous_status, new_status,
    actor_user_id, actor_user_id_snapshot, actor_role,
    moderation_audit_event_id, created_at
  ) values (
    announcement_id, 1, 'create', null, 'draft',
    p_actor_id, p_actor_id, 'admin', audit_event_id, created_at_value
  );
  perform set_config('smot.announcement_history_write_scope', '', true);

  return query select * from public.announcements where id = announcement_id;
end
$function$;

alter function private.create_announcement_draft_impl(
  text, text, text, text, text, jsonb, text, boolean, uuid, text
) owner to postgres;
revoke all on function private.create_announcement_draft_impl(
  text, text, text, text, text, jsonb, text, boolean, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function private.create_announcement_draft_impl(
  text, text, text, text, text, jsonb, text, boolean, uuid, text
) to service_role;

create or replace function public.create_announcement_draft(
  p_title text,
  p_body text,
  p_category text,
  p_priority text,
  p_audience_type text,
  p_audience_filter jsonb,
  p_delivery_policy text,
  p_email_enabled boolean,
  p_actor_id uuid,
  p_request_id text default null
)
returns setof public.announcements
language sql
security invoker
set search_path = ''
as $function$
  select * from private.create_announcement_draft_impl(
    p_title, p_body, p_category, p_priority, p_audience_type,
    p_audience_filter, p_delivery_policy, p_email_enabled,
    p_actor_id, p_request_id
  );
$function$;

alter function public.create_announcement_draft(
  text, text, text, text, text, jsonb, text, boolean, uuid, text
) owner to postgres;
revoke all on function public.create_announcement_draft(
  text, text, text, text, text, jsonb, text, boolean, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.create_announcement_draft(
  text, text, text, text, text, jsonb, text, boolean, uuid, text
) to service_role;

create or replace function private.update_announcement_draft_impl(
  p_announcement_id uuid,
  p_expected_version integer,
  p_title text,
  p_body text,
  p_category text,
  p_priority text,
  p_audience_type text,
  p_audience_filter jsonb,
  p_delivery_policy text,
  p_email_enabled boolean,
  p_actor_id uuid,
  p_request_id text default null
)
returns setof public.announcements
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_announcement public.announcements%rowtype;
  audit_event_id uuid := gen_random_uuid();
  updated_at_value timestamptz := now();
  normalized_request_id text := nullif(btrim(coalesce(p_request_id, '')), '');
begin
  perform private.require_active_announcement_admin(p_actor_id, updated_at_value);
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'valid_announcement_expected_version_required' using errcode = '22023';
  end if;
  if normalized_request_id is not null and char_length(normalized_request_id) > 200 then
    raise exception 'announcement_request_id_too_long' using errcode = '22023';
  end if;

  select * into current_announcement
  from public.announcements
  where id = p_announcement_id
  for update;
  if not found then
    raise exception 'announcement_not_found' using errcode = 'P0002';
  end if;
  if current_announcement.status <> 'draft' then
    raise exception 'only_announcement_drafts_can_be_updated' using errcode = '55000';
  end if;
  if current_announcement.version <> p_expected_version then
    raise exception 'announcement_version_conflict' using errcode = '40001';
  end if;

  insert into public.moderation_audit_events (
    id, event_type, actor_user_id, actor_user_id_snapshot, actor_role,
    resource_type, resource_id, summary, metadata, request_id, occurred_at
  ) values (
    audit_event_id, 'announcement.updated', p_actor_id, p_actor_id, 'admin',
    'announcement', p_announcement_id, 'Announcement draft updated',
    jsonb_build_object(
      'previous_version', current_announcement.version,
      'new_version', current_announcement.version + 1
    ), normalized_request_id, updated_at_value
  );

  perform set_config('smot.announcement_write_scope', 'update', true);
  update public.announcements
  set
    title = btrim(p_title),
    body = btrim(p_body),
    category = lower(btrim(p_category)),
    priority = lower(btrim(p_priority)),
    audience_type = lower(btrim(p_audience_type)),
    audience_filter = p_audience_filter,
    delivery_policy = lower(btrim(p_delivery_policy)),
    email_enabled = coalesce(p_email_enabled, false),
    moderation_audit_event_id = audit_event_id,
    updated_by = p_actor_id,
    updated_by_snapshot = p_actor_id,
    version = version + 1,
    updated_at = updated_at_value
  where id = p_announcement_id;
  perform set_config('smot.announcement_write_scope', '', true);

  perform set_config('smot.announcement_history_write_scope', 'update', true);
  insert into public.announcement_lifecycle_history (
    announcement_id, announcement_version, action,
    previous_status, new_status, previous_scheduled_for, new_scheduled_for,
    actor_user_id, actor_user_id_snapshot, actor_role,
    moderation_audit_event_id, created_at
  ) values (
    p_announcement_id, current_announcement.version + 1, 'update',
    'draft', 'draft', current_announcement.scheduled_for, current_announcement.scheduled_for,
    p_actor_id, p_actor_id, 'admin', audit_event_id, updated_at_value
  );
  perform set_config('smot.announcement_history_write_scope', '', true);

  return query select * from public.announcements where id = p_announcement_id;
end
$function$;

alter function private.update_announcement_draft_impl(
  uuid, integer, text, text, text, text, text, jsonb, text, boolean, uuid, text
) owner to postgres;
revoke all on function private.update_announcement_draft_impl(
  uuid, integer, text, text, text, text, text, jsonb, text, boolean, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function private.update_announcement_draft_impl(
  uuid, integer, text, text, text, text, text, jsonb, text, boolean, uuid, text
) to service_role;

create or replace function public.update_announcement_draft(
  p_announcement_id uuid,
  p_expected_version integer,
  p_title text,
  p_body text,
  p_category text,
  p_priority text,
  p_audience_type text,
  p_audience_filter jsonb,
  p_delivery_policy text,
  p_email_enabled boolean,
  p_actor_id uuid,
  p_request_id text default null
)
returns setof public.announcements
language sql
security invoker
set search_path = ''
as $function$
  select * from private.update_announcement_draft_impl(
    p_announcement_id, p_expected_version, p_title, p_body,
    p_category, p_priority, p_audience_type, p_audience_filter,
    p_delivery_policy, p_email_enabled, p_actor_id, p_request_id
  );
$function$;

alter function public.update_announcement_draft(
  uuid, integer, text, text, text, text, text, jsonb, text, boolean, uuid, text
) owner to postgres;
revoke all on function public.update_announcement_draft(
  uuid, integer, text, text, text, text, text, jsonb, text, boolean, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.update_announcement_draft(
  uuid, integer, text, text, text, text, text, jsonb, text, boolean, uuid, text
) to service_role;

create or replace function private.transition_announcement_impl(
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
declare
  current_announcement public.announcements%rowtype;
  normalized_action text := lower(btrim(coalesce(p_action, '')));
  normalized_request_id text := nullif(btrim(coalesce(p_request_id, '')), '');
  next_status text;
  next_scheduled_for timestamptz;
  audit_event_type text;
  audit_event_id uuid := gen_random_uuid();
  transitioned_at timestamptz := now();
  has_terminal_failure boolean := false;
begin
  perform private.require_active_announcement_admin(p_actor_id, transitioned_at);

  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'valid_announcement_expected_version_required' using errcode = '22023';
  end if;
  if normalized_request_id is not null and char_length(normalized_request_id) > 200 then
    raise exception 'announcement_request_id_too_long' using errcode = '22023';
  end if;

  select * into current_announcement
  from public.announcements
  where id = p_announcement_id
  for update;

  if not found then
    raise exception 'announcement_not_found' using errcode = 'P0002';
  end if;
  if current_announcement.version <> p_expected_version then
    raise exception 'announcement_version_conflict' using errcode = '40001';
  end if;

  if normalized_action in ('complete', 'partially_fail') then
    -- Parent announcement is already locked above. Lock every delivery before
    -- every outbox row to match cancellation, finish, claim, and lease-reap
    -- ordering and prevent a worker from changing terminality underneath this
    -- aggregate transition.
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
      raise exception 'announcement_deliveries_are_not_terminal'
        using errcode = '55000';
    end if;

    select exists (
      select 1
      from public.announcement_deliveries delivery
      join public.announcement_delivery_outbox outbox
        on outbox.delivery_id = delivery.id
      where delivery.announcement_id = p_announcement_id
        and delivery.status = 'failed'
        and outbox.queue_status = 'dead'
    ) into has_terminal_failure;

    if normalized_action = 'complete' and has_terminal_failure then
      raise exception 'completed_announcement_cannot_have_terminal_failures'
        using errcode = '55000';
    end if;
    if normalized_action = 'partially_fail' and not has_terminal_failure then
      raise exception 'partially_failed_announcement_requires_terminal_failure'
        using errcode = '55000';
    end if;
  end if;

  case normalized_action
    when 'schedule' then
      if current_announcement.status <> 'draft'
        or p_scheduled_for is null
        or p_scheduled_for <= transitioned_at then
        raise exception 'invalid_announcement_schedule' using errcode = '22023';
      end if;
      next_status := 'scheduled';
      next_scheduled_for := p_scheduled_for;
      audit_event_type := 'announcement.scheduled';
    when 'unschedule' then
      if current_announcement.status <> 'scheduled' or p_scheduled_for is not null then
        raise exception 'invalid_announcement_unschedule' using errcode = '22023';
      end if;
      next_status := 'draft';
      next_scheduled_for := null;
      audit_event_type := 'announcement.unscheduled';
    when 'start_sending' then
      if current_announcement.status not in ('draft', 'scheduled', 'partially_failed')
        or p_scheduled_for is not null then
        raise exception 'invalid_announcement_start_sending' using errcode = '22023';
      end if;
      next_status := 'sending';
      next_scheduled_for := current_announcement.scheduled_for;
      audit_event_type := 'announcement.sending';
    when 'complete' then
      if current_announcement.status <> 'sending' or p_scheduled_for is not null then
        raise exception 'invalid_announcement_completion' using errcode = '22023';
      end if;
      next_status := 'sent';
      next_scheduled_for := current_announcement.scheduled_for;
      audit_event_type := 'announcement.completed';
    when 'partially_fail' then
      if current_announcement.status <> 'sending' or p_scheduled_for is not null then
        raise exception 'invalid_announcement_partial_failure' using errcode = '22023';
      end if;
      next_status := 'partially_failed';
      next_scheduled_for := current_announcement.scheduled_for;
      audit_event_type := 'announcement.completed';
    when 'cancel' then
      if current_announcement.status not in ('draft', 'scheduled', 'sending', 'partially_failed')
        or p_scheduled_for is not null then
        raise exception 'invalid_announcement_cancellation' using errcode = '22023';
      end if;
      next_status := 'cancelled';
      next_scheduled_for := current_announcement.scheduled_for;
      audit_event_type := 'announcement.cancelled';
    else
      raise exception 'invalid_announcement_action' using errcode = '22023';
  end case;

  insert into public.moderation_audit_events (
    id, event_type, actor_user_id, actor_user_id_snapshot, actor_role,
    resource_type, resource_id, summary, metadata, request_id, occurred_at
  ) values (
    audit_event_id, audit_event_type, p_actor_id, p_actor_id, 'admin',
    'announcement', p_announcement_id,
    'Announcement lifecycle action: ' || normalized_action,
    jsonb_build_object(
      'action', normalized_action,
      'previous_status', current_announcement.status,
      'new_status', next_status,
      'previous_version', current_announcement.version,
      'new_version', current_announcement.version + 1
    ),
    normalized_request_id, transitioned_at
  );

  perform set_config('smot.announcement_write_scope', 'transition', true);
  update public.announcements
  set
    status = next_status,
    scheduled_for = next_scheduled_for,
    sending_started_at = case
      when next_status = 'sending' then coalesce(sending_started_at, transitioned_at)
      else sending_started_at
    end,
    sent_at = case
      when next_status in ('sent', 'partially_failed') then coalesce(sent_at, transitioned_at)
      else sent_at
    end,
    cancelled_at = case
      when next_status = 'cancelled' then coalesce(cancelled_at, transitioned_at)
      else cancelled_at
    end,
    moderation_audit_event_id = audit_event_id,
    updated_by = p_actor_id,
    updated_by_snapshot = p_actor_id,
    version = version + 1,
    updated_at = transitioned_at
  where id = p_announcement_id;
  perform set_config('smot.announcement_write_scope', '', true);

  perform set_config('smot.announcement_history_write_scope', 'transition', true);
  insert into public.announcement_lifecycle_history (
    announcement_id, announcement_version, action,
    previous_status, new_status, previous_scheduled_for, new_scheduled_for,
    actor_user_id, actor_user_id_snapshot, actor_role,
    moderation_audit_event_id, created_at
  ) values (
    p_announcement_id, current_announcement.version + 1, normalized_action,
    current_announcement.status, next_status,
    current_announcement.scheduled_for, next_scheduled_for,
    p_actor_id, p_actor_id, 'admin', audit_event_id, transitioned_at
  );
  perform set_config('smot.announcement_history_write_scope', '', true);

  if next_status = 'cancelled' then
    perform set_config('smot.announcement_delivery_write_scope', 'cancel', true);
    update public.announcement_deliveries
    set status = 'cancelled'
    where announcement_id = p_announcement_id
      and status in ('queued', 'processing', 'failed');
    perform set_config('smot.announcement_delivery_write_scope', '', true);

    perform set_config('smot.announcement_outbox_write_scope', 'cancel', true);
    update public.announcement_delivery_outbox outbox
    set queue_status = 'cancelled', lease_token = null, lease_expires_at = null
    from public.announcement_deliveries delivery
    where delivery.id = outbox.delivery_id
      and delivery.announcement_id = p_announcement_id
      and outbox.queue_status in ('pending', 'leased', 'retry');
    perform set_config('smot.announcement_outbox_write_scope', '', true);
  end if;

  return query select * from public.announcements where id = p_announcement_id;
end
$function$;

alter function private.transition_announcement_impl(uuid, integer, text, uuid, timestamptz, text)
  owner to postgres;
revoke all on function private.transition_announcement_impl(uuid, integer, text, uuid, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function private.transition_announcement_impl(uuid, integer, text, uuid, timestamptz, text)
  to service_role;

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
as $function$
  select * from private.transition_announcement_impl(
    p_announcement_id, p_expected_version, p_action,
    p_actor_id, p_scheduled_for, p_request_id
  );
$function$;

alter function public.transition_announcement(uuid, integer, text, uuid, timestamptz, text)
  owner to postgres;
revoke all on function public.transition_announcement(uuid, integer, text, uuid, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.transition_announcement(uuid, integer, text, uuid, timestamptz, text)
  to service_role;

create or replace function private.enqueue_announcement_delivery_impl(
  p_announcement_id uuid,
  p_recipient_user_id uuid,
  p_send_in_app boolean default true,
  p_send_email boolean default false,
  p_max_attempts integer default 5
)
returns setof public.announcement_delivery_outbox
language plpgsql
security definer
set search_path = ''
as $function$
declare
  delivery_id_value uuid := gen_random_uuid();
  created_at_value timestamptz := now();
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'announcement_enqueue_requires_service_role' using errcode = '42501';
  end if;
  if not coalesce(p_send_in_app, false) and not coalesce(p_send_email, false) then
    raise exception 'announcement_delivery_channel_required' using errcode = '22023';
  end if;
  if p_max_attempts not between 1 and 20 then
    raise exception 'invalid_announcement_max_attempts' using errcode = '22023';
  end if;

  perform 1 from public.announcements
  where id = p_announcement_id and status = 'sending'
  for update;
  if not found then
    raise exception 'announcement_is_not_sending' using errcode = '55000';
  end if;
  if not exists (select 1 from public.profiles where id = p_recipient_user_id) then
    raise exception 'announcement_recipient_not_found' using errcode = 'P0002';
  end if;

  perform set_config('smot.announcement_delivery_write_scope', 'enqueue', true);
  insert into public.announcement_deliveries (
    id, announcement_id, recipient_user_id, recipient_user_id_snapshot,
    status, created_at, updated_at
  ) values (
    delivery_id_value, p_announcement_id, p_recipient_user_id,
    p_recipient_user_id, 'queued', created_at_value, created_at_value
  );
  perform set_config('smot.announcement_delivery_write_scope', '', true);

  perform set_config('smot.announcement_outbox_write_scope', 'enqueue', true);
  insert into public.announcement_delivery_outbox (
    delivery_id, queue_status, attempt_count, max_attempts,
    available_at, send_in_app, send_email, created_at, updated_at
  ) values (
    delivery_id_value, 'pending', 0, p_max_attempts,
    created_at_value, p_send_in_app, p_send_email,
    created_at_value, created_at_value
  );
  perform set_config('smot.announcement_outbox_write_scope', '', true);

  return query
    select * from public.announcement_delivery_outbox where delivery_id = delivery_id_value;
end
$function$;

alter function private.enqueue_announcement_delivery_impl(uuid, uuid, boolean, boolean, integer)
  owner to postgres;
revoke all on function private.enqueue_announcement_delivery_impl(uuid, uuid, boolean, boolean, integer)
  from public, anon, authenticated, service_role;
grant execute on function private.enqueue_announcement_delivery_impl(uuid, uuid, boolean, boolean, integer)
  to service_role;

create or replace function public.enqueue_announcement_delivery(
  p_announcement_id uuid,
  p_recipient_user_id uuid,
  p_send_in_app boolean default true,
  p_send_email boolean default false,
  p_max_attempts integer default 5
)
returns setof public.announcement_delivery_outbox
language sql
security invoker
set search_path = ''
as $function$
  select * from private.enqueue_announcement_delivery_impl(
    p_announcement_id, p_recipient_user_id,
    p_send_in_app, p_send_email, p_max_attempts
  );
$function$;

alter function public.enqueue_announcement_delivery(uuid, uuid, boolean, boolean, integer)
  owner to postgres;
revoke all on function public.enqueue_announcement_delivery(uuid, uuid, boolean, boolean, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.enqueue_announcement_delivery(uuid, uuid, boolean, boolean, integer)
  to service_role;

create or replace function private.reap_expired_announcement_delivery_lease_impl()
returns setof public.announcement_delivery_outbox
language plpgsql
security definer
set search_path = ''
as $function$
declare
  selected_delivery_id uuid;
  parent_status text;
  current_delivery public.announcement_deliveries%rowtype;
  current_outbox public.announcement_delivery_outbox%rowtype;
  next_queue_status text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'announcement_lease_reap_requires_service_role'
      using errcode = '42501';
  end if;

  -- Candidate discovery takes no lock. The row is rechecked after acquiring
  -- the canonical parent -> delivery -> outbox lock order below.
  select outbox.delivery_id
  into selected_delivery_id
  from public.announcement_delivery_outbox outbox
  where outbox.queue_status = 'leased'
    and outbox.lease_expires_at <= now()
  order by outbox.lease_expires_at, outbox.delivery_id
  limit 1;

  if selected_delivery_id is null then
    return;
  end if;

  select announcement.status
  into parent_status
  from public.announcements announcement
  join public.announcement_deliveries delivery
    on delivery.announcement_id = announcement.id
  where delivery.id = selected_delivery_id
  for update of announcement;

  if not found then
    return;
  end if;

  select * into current_delivery
  from public.announcement_deliveries
  where id = selected_delivery_id
  for update;

  select * into current_outbox
  from public.announcement_delivery_outbox
  where delivery_id = selected_delivery_id
  for update;

  if current_delivery.status <> 'processing'
    or current_outbox.queue_status <> 'leased'
    or current_outbox.lease_expires_at > now() then
    return;
  end if;

  if parent_status <> 'sending' then
    perform set_config('smot.announcement_delivery_write_scope', 'cancel', true);
    update public.announcement_deliveries
    set status = 'cancelled'
    where id = selected_delivery_id;
    perform set_config('smot.announcement_delivery_write_scope', '', true);

    perform set_config('smot.announcement_outbox_write_scope', 'cancel', true);
    update public.announcement_delivery_outbox
    set queue_status = 'cancelled', lease_token = null, lease_expires_at = null
    where delivery_id = selected_delivery_id;
    perform set_config('smot.announcement_outbox_write_scope', '', true);
  else
    next_queue_status := case
      when current_outbox.attempt_count >= current_outbox.max_attempts then 'dead'
      else 'retry'
    end;

    perform set_config('smot.announcement_delivery_write_scope', 'finish', true);
    update public.announcement_deliveries
    set status = 'failed'
    where id = selected_delivery_id;
    perform set_config('smot.announcement_delivery_write_scope', '', true);

    perform set_config('smot.announcement_outbox_write_scope', 'finish', true);
    update public.announcement_delivery_outbox
    set
      queue_status = next_queue_status,
      available_at = case
        when next_queue_status = 'retry' then now()
        else available_at
      end,
      last_error = 'delivery_lease_expired'
    where delivery_id = selected_delivery_id;
    perform set_config('smot.announcement_outbox_write_scope', '', true);
  end if;

  return query
    select *
    from public.announcement_delivery_outbox
    where delivery_id = selected_delivery_id;
end
$function$;

alter function private.reap_expired_announcement_delivery_lease_impl()
  owner to postgres;
revoke all on function private.reap_expired_announcement_delivery_lease_impl()
  from public, anon, authenticated, service_role;
grant execute on function private.reap_expired_announcement_delivery_lease_impl()
  to service_role;

create or replace function public.reap_expired_announcement_delivery_lease()
returns setof public.announcement_delivery_outbox
language sql
security invoker
set search_path = ''
as $function$
  select * from private.reap_expired_announcement_delivery_lease_impl();
$function$;

alter function public.reap_expired_announcement_delivery_lease()
  owner to postgres;
revoke all on function public.reap_expired_announcement_delivery_lease()
  from public, anon, authenticated, service_role;
grant execute on function public.reap_expired_announcement_delivery_lease()
  to service_role;

comment on function public.reap_expired_announcement_delivery_lease() is
  'Atomically recovers one expired lease. Attempts below max become immediately claimable retry rows; exhausted attempts become terminal failed/dead rows. Call until no row is returned.';

create or replace function private.claim_announcement_delivery_impl(
  p_lease_seconds integer default 60
)
returns setof public.announcement_delivery_outbox
language plpgsql
security definer
set search_path = ''
as $function$
declare
  selected_delivery_id uuid;
  selected_lease_token uuid := gen_random_uuid();
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'announcement_claim_requires_service_role' using errcode = '42501';
  end if;
  if p_lease_seconds not between 15 and 900 then
    raise exception 'invalid_announcement_lease_seconds' using errcode = '22023';
  end if;

  select outbox.delivery_id
  into selected_delivery_id
  from public.announcement_delivery_outbox outbox
  join public.announcement_deliveries delivery on delivery.id = outbox.delivery_id
  join public.announcements announcement on announcement.id = delivery.announcement_id
  where announcement.status = 'sending'
    and delivery.recipient_user_id is not null
    and delivery.status in ('queued', 'failed')
    and outbox.queue_status in ('pending', 'retry')
    and outbox.available_at <= now()
  order by outbox.available_at, outbox.delivery_id
  for update of announcement, delivery, outbox skip locked
  limit 1;

  if selected_delivery_id is null then
    return;
  end if;

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
    lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  where delivery_id = selected_delivery_id;
  perform set_config('smot.announcement_outbox_write_scope', '', true);

  return query
    select * from public.announcement_delivery_outbox where delivery_id = selected_delivery_id;
end
$function$;

alter function private.claim_announcement_delivery_impl(integer) owner to postgres;
revoke all on function private.claim_announcement_delivery_impl(integer)
  from public, anon, authenticated, service_role;
grant execute on function private.claim_announcement_delivery_impl(integer) to service_role;

create or replace function public.claim_announcement_delivery(p_lease_seconds integer default 60)
returns setof public.announcement_delivery_outbox
language sql
security invoker
set search_path = ''
as $function$
  select * from private.claim_announcement_delivery_impl(p_lease_seconds);
$function$;

alter function public.claim_announcement_delivery(integer) owner to postgres;
revoke all on function public.claim_announcement_delivery(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_announcement_delivery(integer) to service_role;

create or replace function private.finish_announcement_delivery_impl(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_succeeded boolean,
  p_conversation_id uuid default null,
  p_message_id uuid default null,
  p_notification_id uuid default null,
  p_error text default null,
  p_retry_at timestamptz default null
)
returns setof public.announcement_delivery_outbox
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_outbox public.announcement_delivery_outbox%rowtype;
  current_delivery public.announcement_deliveries%rowtype;
  parent_status text;
  normalized_error text := nullif(btrim(coalesce(p_error, '')), '');
  next_queue_status text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'announcement_finish_requires_service_role' using errcode = '42501';
  end if;

  select announcement.status
  into parent_status
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

  select * into current_outbox
  from public.announcement_delivery_outbox
  where delivery_id = p_delivery_id
  for update;
  if current_outbox.queue_status <> 'leased'
    or current_outbox.lease_token is distinct from p_lease_token
    or current_outbox.lease_expires_at <= now() then
    raise exception 'announcement_delivery_lease_invalid' using errcode = '55000';
  end if;

  if parent_status <> 'sending' then
    perform set_config('smot.announcement_delivery_write_scope', 'cancel', true);
    update public.announcement_deliveries
    set status = 'cancelled'
    where id = p_delivery_id and status in ('queued', 'processing', 'failed');
    perform set_config('smot.announcement_delivery_write_scope', '', true);
    perform set_config('smot.announcement_outbox_write_scope', 'cancel', true);
    update public.announcement_delivery_outbox
    set queue_status = 'cancelled', lease_token = null, lease_expires_at = null
    where delivery_id = p_delivery_id;
    perform set_config('smot.announcement_outbox_write_scope', '', true);
    return query select * from public.announcement_delivery_outbox where delivery_id = p_delivery_id;
    return;
  end if;

  if p_succeeded then
    if current_outbox.send_in_app then
      -- Stage 2 cannot safely prove that caller-created conversation/message/
      -- notification rows were created in this same transaction after the
      -- parent status recheck. Stage 3 must replace or wrap this boundary with
      -- the atomic in-app output creator before in-app delivery is enabled.
      raise exception 'atomic_in_app_worker_required' using errcode = '55000';
    end if;
    if p_conversation_id is not null
      or p_message_id is not null
      or p_notification_id is not null then
      raise exception 'email_only_delivery_cannot_reference_in_app_outputs'
        using errcode = '22023';
    end if;
    if normalized_error is not null or p_retry_at is not null then
      raise exception 'successful_announcement_delivery_cannot_have_retry' using errcode = '22023';
    end if;

    perform set_config('smot.announcement_delivery_write_scope', 'finish', true);
    update public.announcement_deliveries
    set status = 'delivered'
    where id = p_delivery_id;
    perform set_config('smot.announcement_delivery_write_scope', '', true);
    next_queue_status := 'completed';
  else
    if normalized_error is null or char_length(normalized_error) > 2000 then
      raise exception 'announcement_delivery_failure_error_required' using errcode = '22023';
    end if;
    next_queue_status := case
      when current_outbox.attempt_count >= current_outbox.max_attempts then 'dead'
      else 'retry'
    end;
    if next_queue_status = 'retry' and p_retry_at is not null and p_retry_at <= now() then
      raise exception 'announcement_retry_must_be_future' using errcode = '22023';
    end if;

    perform set_config('smot.announcement_delivery_write_scope', 'finish', true);
    update public.announcement_deliveries set status = 'failed' where id = p_delivery_id;
    perform set_config('smot.announcement_delivery_write_scope', '', true);
  end if;

  perform set_config('smot.announcement_outbox_write_scope', 'finish', true);
  update public.announcement_delivery_outbox
  set
    queue_status = next_queue_status,
    available_at = case
      when next_queue_status = 'retry'
        then coalesce(p_retry_at, now() + interval '5 minutes')
      else available_at
    end,
    last_error = case when next_queue_status in ('retry', 'dead') then normalized_error else null end
  where delivery_id = p_delivery_id;
  perform set_config('smot.announcement_outbox_write_scope', '', true);

  return query select * from public.announcement_delivery_outbox where delivery_id = p_delivery_id;
end
$function$;

alter function private.finish_announcement_delivery_impl(uuid, uuid, boolean, uuid, uuid, uuid, text, timestamptz)
  owner to postgres;
revoke all on function private.finish_announcement_delivery_impl(uuid, uuid, boolean, uuid, uuid, uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function private.finish_announcement_delivery_impl(uuid, uuid, boolean, uuid, uuid, uuid, text, timestamptz)
  to service_role;

create or replace function public.finish_announcement_delivery(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_succeeded boolean,
  p_conversation_id uuid default null,
  p_message_id uuid default null,
  p_notification_id uuid default null,
  p_error text default null,
  p_retry_at timestamptz default null
)
returns setof public.announcement_delivery_outbox
language sql
security invoker
set search_path = ''
as $function$
  select * from private.finish_announcement_delivery_impl(
    p_delivery_id, p_lease_token, p_succeeded,
    p_conversation_id, p_message_id, p_notification_id,
    p_error, p_retry_at
  );
$function$;

alter function public.finish_announcement_delivery(uuid, uuid, boolean, uuid, uuid, uuid, text, timestamptz)
  owner to postgres;
revoke all on function public.finish_announcement_delivery(uuid, uuid, boolean, uuid, uuid, uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.finish_announcement_delivery(uuid, uuid, boolean, uuid, uuid, uuid, text, timestamptz)
  to service_role;

comment on function public.finish_announcement_delivery(
  uuid, uuid, boolean, uuid, uuid, uuid, text, timestamptz
) is
  'Stage 2 generic finalizer. Successful in-app completion fails closed with atomic_in_app_worker_required. Email-only retries must reuse idempotency_key because a provider may accept an email before cancellation or lease expiry is observed locally.';

create or replace function public.mark_announcement_delivery_read(p_delivery_id uuid)
returns table(delivery_id uuid, read_at timestamptz, dismissed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.announcement_deliveries
    where id = p_delivery_id and recipient_user_id = auth.uid() and status = 'delivered'
  ) then
    raise exception 'announcement_delivery_not_found' using errcode = 'P0002';
  end if;

  perform set_config('smot.announcement_delivery_write_scope', 'recipient_state', true);
  update public.announcement_deliveries delivery
  set read_at = coalesce(delivery.read_at, '-infinity'::timestamptz)
  where delivery.id = p_delivery_id;
  perform set_config('smot.announcement_delivery_write_scope', '', true);

  return query select delivery.id, delivery.read_at, delivery.dismissed_at
  from public.announcement_deliveries delivery where delivery.id = p_delivery_id;
end
$function$;

alter function public.mark_announcement_delivery_read(uuid) owner to postgres;
revoke all on function public.mark_announcement_delivery_read(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.mark_announcement_delivery_read(uuid) to authenticated;

create or replace function public.dismiss_announcement_delivery(p_delivery_id uuid)
returns table(delivery_id uuid, read_at timestamptz, dismissed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.announcement_deliveries
    where id = p_delivery_id and recipient_user_id = auth.uid() and status = 'delivered'
  ) then
    raise exception 'announcement_delivery_not_found' using errcode = 'P0002';
  end if;

  perform set_config('smot.announcement_delivery_write_scope', 'recipient_state', true);
  update public.announcement_deliveries delivery
  set
    read_at = coalesce(delivery.read_at, '-infinity'::timestamptz),
    dismissed_at = coalesce(delivery.dismissed_at, '-infinity'::timestamptz)
  where delivery.id = p_delivery_id;
  perform set_config('smot.announcement_delivery_write_scope', '', true);

  return query select delivery.id, delivery.read_at, delivery.dismissed_at
  from public.announcement_deliveries delivery where delivery.id = p_delivery_id;
end
$function$;

alter function public.dismiss_announcement_delivery(uuid) owner to postgres;
revoke all on function public.dismiss_announcement_delivery(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.dismiss_announcement_delivery(uuid) to authenticated;

alter table public.announcements enable row level security;
alter table public.announcement_lifecycle_history enable row level security;
alter table public.announcement_deliveries enable row level security;
alter table public.announcement_delivery_outbox enable row level security;

create policy "Recipients can read delivered announcements"
  on public.announcements
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.announcement_deliveries delivery
      where delivery.announcement_id = announcements.id
        and delivery.recipient_user_id = (select auth.uid())
        and delivery.status = 'delivered'
    )
  );

create policy "Recipients can read their delivered announcement state"
  on public.announcement_deliveries
  for select
  to authenticated
  using (
    recipient_user_id = (select auth.uid())
    and status = 'delivered'
  );

revoke all on table public.announcements
  from public, anon, authenticated;
revoke all on table public.announcement_lifecycle_history
  from public, anon, authenticated;
revoke all on table public.announcement_deliveries
  from public, anon, authenticated;
revoke all on table public.announcement_delivery_outbox
  from public, anon, authenticated;

grant select (
  id,
  title,
  body,
  category,
  priority,
  delivery_policy,
  status,
  sent_at,
  created_at,
  updated_at
) on table public.announcements to authenticated;
grant select on table public.announcement_deliveries to authenticated;

revoke all on table public.announcements from service_role;
revoke all on table public.announcement_lifecycle_history from service_role;
revoke all on table public.announcement_deliveries from service_role;
revoke all on table public.announcement_delivery_outbox from service_role;
grant select on table public.announcements to service_role;
grant select on table public.announcement_lifecycle_history to service_role;
grant select on table public.announcement_deliveries to service_role;
grant select on table public.announcement_delivery_outbox to service_role;

do $migration$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'announcement_deliveries'
  ) then
    alter publication supabase_realtime add table public.announcement_deliveries;
  end if;
end
$migration$;
