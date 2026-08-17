-- Stage 4: publish only recipient-scoped notification invalidation signals.
--
-- public.notifications intentionally remains outside supabase_realtime. Its
-- legacy rows can be hard-deleted, and Postgres Changes cannot apply RLS to
-- DELETE payloads. This bounded signal table contains no notification content,
-- actor identity, moderation reason, or resource identifiers. Clients use an
-- INSERT or UPDATE as a prompt to refetch their RLS-protected notification
-- projections. A single upserted row per recipient keeps storage bounded.

create schema if not exists private;

create table if not exists public.notification_realtime_signals (
  recipient_user_id uuid primary key,
  version bigint not null default 1 check (version > 0),
  change_kind text not null
    check (change_kind = any (array['insert', 'update', 'delete']::text[])),
  emitted_at timestamptz not null default clock_timestamp()
);

comment on table public.notification_realtime_signals is
  'Bounded, content-free recipient invalidations for notification refetches. One row per recipient is updated monotonically and never deleted.';
comment on column public.notification_realtime_signals.recipient_user_id is
  'Recipient snapshot used only for RLS routing. Deliberately has no cascading Auth foreign key.';
comment on column public.notification_realtime_signals.change_kind is
  'The notification row operation only; no notification content or resource identity is copied.';

alter table public.notification_realtime_signals enable row level security;

drop policy if exists notification_realtime_signals_select_own
  on public.notification_realtime_signals;
create policy notification_realtime_signals_select_own
  on public.notification_realtime_signals
  for select
  to authenticated
  using (recipient_user_id = auth.uid());

revoke all on table public.notification_realtime_signals
  from public, anon, authenticated, service_role;
grant select on table public.notification_realtime_signals to authenticated;

create or replace function private.bump_notification_realtime_signal(
  p_recipient_user_id uuid,
  p_change_kind text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.notification_realtime_signals (
    recipient_user_id,
    version,
    change_kind,
    emitted_at
  ) values (
    p_recipient_user_id,
    1,
    p_change_kind,
    clock_timestamp()
  )
  on conflict (recipient_user_id) do update
  set version = public.notification_realtime_signals.version + 1,
      change_kind = excluded.change_kind,
      emitted_at = excluded.emitted_at;
end;
$function$;

alter function private.bump_notification_realtime_signal(uuid, text) owner to postgres;
revoke all on function private.bump_notification_realtime_signal(uuid, text)
  from public, anon, authenticated, service_role;

create or replace function private.emit_notification_realtime_signal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    perform private.bump_notification_realtime_signal(new.user_id, 'insert');
  elsif tg_op = 'DELETE' then
    perform private.bump_notification_realtime_signal(old.user_id, 'delete');
  else
    perform private.bump_notification_realtime_signal(new.user_id, 'update');

    -- A privileged repair that moves a legacy row must invalidate both views.
    if old.user_id is distinct from new.user_id then
      perform private.bump_notification_realtime_signal(old.user_id, 'update');
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$function$;

alter function private.emit_notification_realtime_signal() owner to postgres;
revoke all on function private.emit_notification_realtime_signal()
  from public, anon, authenticated, service_role;

drop trigger if exists emit_notification_realtime_signal
  on public.notifications;
create trigger emit_notification_realtime_signal
  after insert or update or delete on public.notifications
  for each row execute function private.emit_notification_realtime_signal();

do $preferences_trigger$
begin
  if to_regclass('public.notification_preferences') is not null then
    execute 'drop trigger if exists emit_notification_realtime_signal on public.notification_preferences';
    execute 'create trigger emit_notification_realtime_signal after insert or update or delete on public.notification_preferences for each row execute function private.emit_notification_realtime_signal()';
  end if;
end
$preferences_trigger$;

create or replace function private.reject_notification_realtime_signal_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception using
    errcode = '42501',
    message = 'notification_realtime_signals_are_never_deleted';
end;
$function$;

alter function private.reject_notification_realtime_signal_delete() owner to postgres;
revoke all on function private.reject_notification_realtime_signal_delete()
  from public, anon, authenticated, service_role;

drop trigger if exists reject_notification_realtime_signal_delete
  on public.notification_realtime_signals;
create trigger reject_notification_realtime_signal_delete
  before delete on public.notification_realtime_signals
  for each row execute function private.reject_notification_realtime_signal_delete();

do $migration$
begin
  if exists (
    select 1
    from pg_publication publication
    where publication.pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables published_table
    where published_table.pubname = 'supabase_realtime'
      and published_table.schemaname = 'public'
      and published_table.tablename = 'notification_realtime_signals'
  ) then
    alter publication supabase_realtime
      add table public.notification_realtime_signals;
  end if;
end
$migration$;
