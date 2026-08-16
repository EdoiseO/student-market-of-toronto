-- Stage 4 enforcement notification delivery and lifecycle.
--
-- Moderation state itself remains outside Realtime. Recipient-scoped rows in
-- notifications are the safe invalidation and navigation surface; clients
-- refetch the RLS-protected user_moderation_notices view for current state.

alter table public.notifications
  add column if not exists dismissed_at timestamptz;

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
    'moderator_role_granted',
    'moderation_warning',
    'moderation_strike',
    'moderation_ban',
    'moderation_review_update',
    'conversation_closed',
    'conversation_reopened'
  ]::text[]));

comment on constraint notifications_type_check on public.notifications is
  'Includes always-on announcements, moderation enforcement notices, and participant-safe conversation moderation state notices.';

comment on column public.notifications.dismissed_at is
  'One-way recipient dismissal timestamp. Enforcement rows are retained after dismissal and remain available in durable moderation history.';

create index if not exists notifications_visible_unread_idx
  on public.notifications (user_id, created_at desc, id desc)
  where read_at is null and dismissed_at is null;

create unique index if not exists notifications_moderation_event_uidx
  on public.notifications (
    user_id,
    (metadata ->> 'sanction_id'),
    (metadata ->> 'event')
  )
  where type = any (array[
    'moderation_warning',
    'moderation_strike',
    'moderation_ban',
    'moderation_review_update'
  ]::text[]);

create or replace function private.is_enforcement_notification_type(
  notification_type text
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  select notification_type = any (array[
    'moderation_warning',
    'moderation_strike',
    'moderation_ban',
    'moderation_review_update',
    'conversation_closed',
    'conversation_reopened'
  ]::text[]);
$function$;

alter function private.is_enforcement_notification_type(text) owner to postgres;
revoke all on function private.is_enforcement_notification_type(text)
  from public, anon, authenticated, service_role;

create or replace function private.enforce_notification_recipient_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    if private.is_enforcement_notification_type(new.type)
      and (new.read_at is not null or new.dismissed_at is not null) then
      raise exception using
        errcode = '23514',
        message = 'enforcement_notification_lifecycle_must_start_empty';
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    -- Recipient dismissal is a soft lifecycle transition. Service-owned
    -- account erasure may still remove a row after its Auth owner is gone.
    if private.is_enforcement_notification_type(old.type)
      and auth.role() = 'authenticated'
      and auth.uid() = old.user_id then
      raise exception using
        errcode = '42501',
        message = 'enforcement_notifications_are_not_deleted_on_dismiss';
    end if;

    return old;
  end if;

  if not private.is_enforcement_notification_type(old.type) then
    return new;
  end if;

  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.type is distinct from old.type
    or new.created_at is distinct from old.created_at
    or new.conversation_id is distinct from old.conversation_id
    or new.message_id is distinct from old.message_id
    or new.listing_id is distinct from old.listing_id
    or new.metadata is distinct from old.metadata then
    raise exception using
      errcode = '42501',
      message = 'enforcement_notification_core_is_immutable';
  end if;

  if old.read_at is not null and new.read_at is distinct from old.read_at then
    raise exception using
      errcode = '42501',
      message = 'enforcement_notification_read_is_one_way';
  end if;

  if old.dismissed_at is not null
    and new.dismissed_at is distinct from old.dismissed_at then
    raise exception using
      errcode = '42501',
      message = 'enforcement_notification_dismissal_is_one_way';
  end if;

  if old.read_at is null and new.read_at is not null then
    new.read_at := now();
  end if;

  if old.dismissed_at is null and new.dismissed_at is not null then
    new.dismissed_at := now();
    new.read_at := coalesce(new.read_at, now());
  end if;

  return new;
end;
$function$;

alter function private.enforce_notification_recipient_lifecycle() owner to postgres;
revoke all on function private.enforce_notification_recipient_lifecycle()
  from public, anon, authenticated, service_role;

drop trigger if exists enforce_notification_recipient_lifecycle
  on public.notifications;
create trigger enforce_notification_recipient_lifecycle
  before insert or update or delete on public.notifications
  for each row execute function private.enforce_notification_recipient_lifecycle();

create or replace function private.emit_moderation_enforcement_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  notification_type text;
  notification_event text;
  safe_metadata jsonb;
begin
  if tg_op = 'INSERT' then
    if new.subject_user_id is null then
      return new;
    end if;

    notification_type := case new.sanction_type
      when 'warning' then 'moderation_warning'
      when 'strike' then 'moderation_strike'
      when 'ban' then 'moderation_ban'
      else null
    end;
    notification_event := 'issued';
    safe_metadata := jsonb_build_object(
      'sanction_id', new.id,
      'sanction_type', new.sanction_type,
      'severity', new.severity,
      'event', notification_event
    );
  elsif old.review_status is distinct from new.review_status
    and new.review_status = any (array['upheld', 'modified', 'overturned']::text[]) then
    if new.subject_user_id is null then
      return new;
    end if;

    notification_type := 'moderation_review_update';
    notification_event := 'review_' || new.review_status;
    safe_metadata := jsonb_build_object(
      'sanction_id', new.id,
      'sanction_type', new.sanction_type,
      'severity', new.severity,
      'event', notification_event,
      'review_status', new.review_status
    );
  elsif old.revoked_at is null and new.revoked_at is not null then
    if new.subject_user_id is null then
      return new;
    end if;

    notification_type := 'moderation_review_update';
    notification_event := 'revoked';
    safe_metadata := jsonb_build_object(
      'sanction_id', new.id,
      'sanction_type', new.sanction_type,
      'severity', new.severity,
      'event', notification_event
    );
  else
    return new;
  end if;

  if notification_type is null then
    return new;
  end if;

  insert into public.notifications (
    user_id,
    type,
    metadata
  ) values (
    new.subject_user_id,
    notification_type,
    safe_metadata
  )
  on conflict do nothing;

  return new;
end;
$function$;

alter function private.emit_moderation_enforcement_notification() owner to postgres;
revoke all on function private.emit_moderation_enforcement_notification()
  from public, anon, authenticated, service_role;

drop trigger if exists emit_moderation_enforcement_notification
  on public.moderation_sanctions;
create trigger emit_moderation_enforcement_notification
  after insert or update on public.moderation_sanctions
  for each row execute function private.emit_moderation_enforcement_notification();
