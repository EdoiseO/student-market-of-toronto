-- Conversation moderation is intentionally separate from conversation_user_state:
-- conversation_user_state is a participant-owned inbox preference, while these
-- rows are platform moderation records written only through a trusted service
-- boundary. Existing conversations begin open at version zero. Each explicit
-- close/reopen transition advances the current version and appends one immutable
-- history row.

create schema if not exists private;
create schema if not exists conversation_moderation_private;
revoke all on schema conversation_moderation_private
  from public, anon, authenticated, service_role;

create table public.conversation_moderation_state (
  conversation_id uuid primary key
    references public.conversations(id) on delete cascade,
  version bigint not null default 0,
  status text not null default 'open',
  closed_until timestamptz,
  reason_code text,
  user_message text,
  changed_at timestamptz not null default now(),
  constraint conversation_moderation_state_version_check
    check (version >= 0),
  constraint conversation_moderation_state_status_check
    check (status in ('open', 'closed')),
  constraint conversation_moderation_state_shape_check
    check (
      (
        status = 'open'
        and closed_until is null
        and reason_code is null
        and user_message is null
      )
      or
      (
        status = 'closed'
        and version > 0
        and reason_code ~ '^[a-z0-9][a-z0-9_]{1,63}$'
        and char_length(user_message) between 10 and 1000
      )
    )
);

comment on table public.conversation_moderation_state is
  'Versioned current moderation state for a conversation. A closed_until value denotes a temporary closure; NULL denotes an indefinite closure.';
comment on column public.conversation_moderation_state.version is
  'Zero is the initial open state. Every explicit close or reopen transition increments this value exactly once.';
comment on column public.conversation_moderation_state.user_message is
  'Participant-safe explanation for the current closure. Actor identity, internal notes, and audit linkage remain service-only.';

create table public.conversation_moderation_history (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  state_version bigint not null,
  action text not null,
  previous_status text not null,
  new_status text not null,
  previous_closed_until timestamptz,
  new_closed_until timestamptz,
  reason_code text not null,
  user_message text not null,
  actor_id uuid not null,
  moderation_audit_event_id uuid
    references public.moderation_audit_events(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint conversation_moderation_history_conversation_version_key
    unique (conversation_id, state_version),
  constraint conversation_moderation_history_version_check
    check (state_version > 0),
  constraint conversation_moderation_history_action_check
    check (action in ('close', 'reopen')),
  constraint conversation_moderation_history_status_check
    check (
      previous_status in ('open', 'closed')
      and new_status in ('open', 'closed')
    ),
  constraint conversation_moderation_history_reason_code_check
    check (reason_code ~ '^[a-z0-9][a-z0-9_]{1,63}$'),
  constraint conversation_moderation_history_user_message_check
    check (char_length(user_message) between 10 and 1000),
  constraint conversation_moderation_history_transition_shape_check
    check (
      (
        action = 'close'
        and new_status = 'closed'
        and (
          previous_status = 'open'
          or (
            previous_status = 'closed'
            and previous_closed_until is not null
            and previous_closed_until <= created_at
          )
        )
      )
      or
      (
        action = 'reopen'
        and previous_status = 'closed'
        and new_status = 'open'
        and new_closed_until is null
      )
    )
);

comment on table public.conversation_moderation_history is
  'Append-only participant-readable close/reopen history. Conversation and actor UUIDs intentionally have no user/conversation foreign keys so account or conversation deletion cannot erase moderation history.';
comment on column public.conversation_moderation_history.moderation_audit_event_id is
  'Canonical moderator-only audit event created atomically with the transition (conversation.closed or conversation.reopened). Nullable only to support ON DELETE SET NULL integrity semantics.';

create index conversation_moderation_state_closed_changed_idx
  on public.conversation_moderation_state (changed_at desc, conversation_id)
  where status = 'closed';

create index conversation_moderation_state_closed_until_idx
  on public.conversation_moderation_state (closed_until, conversation_id)
  where status = 'closed' and closed_until is not null;

create index conversation_moderation_history_conversation_created_idx
  on public.conversation_moderation_history (
    conversation_id,
    state_version desc,
    created_at desc
  );

create index conversation_moderation_history_actor_created_idx
  on public.conversation_moderation_history (actor_id, created_at desc);

create index conversation_moderation_history_audit_event_idx
  on public.conversation_moderation_history (moderation_audit_event_id)
  where moderation_audit_event_id is not null;

insert into public.conversation_moderation_state (conversation_id)
select conversation.id
from public.conversations conversation
on conflict (conversation_id) do nothing;

create or replace function private.initialize_conversation_moderation_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.conversation_moderation_write_scope', 'initialize', true);

  insert into public.conversation_moderation_state (conversation_id)
  values (new.id)
  on conflict (conversation_id) do nothing;

  perform set_config('app.conversation_moderation_write_scope', '', true);

  return new;
end;
$$;

alter function private.initialize_conversation_moderation_state() owner to postgres;
revoke all on function private.initialize_conversation_moderation_state()
  from public, anon, authenticated, service_role;

drop trigger if exists initialize_conversation_moderation_state
  on public.conversations;
create trigger initialize_conversation_moderation_state
  after insert on public.conversations
  for each row
  execute function private.initialize_conversation_moderation_state();

create or replace function private.guard_conversation_moderation_state_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  write_scope text := current_setting('app.conversation_moderation_write_scope', true);
begin
  -- Deletes are allowed only after the parent conversation has disappeared,
  -- which accommodates the current-state row's ON DELETE CASCADE without
  -- letting a service caller create a conversation with no current state.
  if tg_op = 'DELETE' then
    if not exists (
      select 1
      from public.conversations conversation
      where conversation.id = old.conversation_id
    ) then
      return old;
    end if;

    raise exception 'Conversation moderation state cannot be deleted while its conversation exists'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' and write_scope in ('initialize', 'transition') then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and write_scope = 'transition'
     and new.conversation_id = old.conversation_id
     and new.version = old.version + 1 then
    return new;
  end if;

  raise exception 'Conversation moderation state must be changed through the transition function'
    using errcode = '42501';
end;
$$;

alter function private.guard_conversation_moderation_state_write() owner to postgres;
revoke all on function private.guard_conversation_moderation_state_write()
  from public, anon, authenticated, service_role;

create trigger guard_conversation_moderation_state_write
  before insert or update or delete on public.conversation_moderation_state
  for each row
  execute function private.guard_conversation_moderation_state_write();

create or replace function private.guard_conversation_moderation_history_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     and current_setting('app.conversation_moderation_write_scope', true) = 'transition' then
    return new;
  end if;

  raise exception 'Conversation moderation history is immutable'
    using errcode = '42501';
end;
$$;

alter function private.guard_conversation_moderation_history_write() owner to postgres;
revoke all on function private.guard_conversation_moderation_history_write()
  from public, anon, authenticated, service_role;

create trigger guard_conversation_moderation_history_write
  before insert or update or delete on public.conversation_moderation_history
  for each row
  execute function private.guard_conversation_moderation_history_write();

create or replace function conversation_moderation_private.transition_conversation_moderation_state_impl(
  p_conversation_id uuid,
  p_expected_version bigint,
  p_action text,
  p_reason_code text,
  p_user_message text,
  p_actor_id uuid,
  p_closed_until timestamptz default null,
  p_internal_note text default null,
  p_source_report_id uuid default null,
  p_request_id text default null
)
returns setof public.conversation_moderation_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_state public.conversation_moderation_state%rowtype;
  normalized_action text := lower(trim(coalesce(p_action, '')));
  normalized_reason_code text := lower(trim(coalesce(p_reason_code, '')));
  normalized_user_message text := trim(coalesce(p_user_message, ''));
  normalized_internal_note text := nullif(trim(coalesce(p_internal_note, '')), '');
  normalized_request_id text := nullif(trim(coalesce(p_request_id, '')), '');
  actor_role text;
  audit_event_id uuid;
  next_status text;
  next_closed_until timestamptz;
  transitioned_at timestamptz := now();
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Conversation moderation transitions require the trusted service role'
      using errcode = '42501';
  end if;

  select coalesce(
    case
      when lower(trim(coalesce(actor.raw_app_meta_data ->> 'role', '')))
        in ('admin', 'moderator')
        then lower(trim(actor.raw_app_meta_data ->> 'role'))
      else null
    end,
    (
      select lower(trim(assigned_role.value))
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(actor.raw_app_meta_data -> 'roles') = 'array'
            then actor.raw_app_meta_data -> 'roles'
          else '[]'::jsonb
        end
      ) assigned_role(value)
      where lower(trim(assigned_role.value)) in ('admin', 'moderator')
      limit 1
    )
  )
  into actor_role
  from auth.users actor
  where actor.id = p_actor_id
    and (actor.banned_until is null or actor.banned_until <= transitioned_at)
    and not exists (
      select 1
      from public.user_status status
      where status.user_id = actor.id
        and status.is_banned
        and (
          status.banned_until is null
          or status.banned_until > transitioned_at
        )
    );

  if actor_role is null then
    raise exception 'An active admin or moderator actor is required'
      using errcode = '42501';
  end if;

  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'A non-negative expected state version is required'
      using errcode = '22023';
  end if;

  if normalized_action not in ('close', 'reopen') then
    raise exception 'Conversation moderation action must be close or reopen'
      using errcode = '22023';
  end if;

  if normalized_reason_code !~ '^[a-z0-9][a-z0-9_]{1,63}$' then
    raise exception 'A valid moderation reason code is required'
      using errcode = '22023';
  end if;

  if char_length(normalized_user_message) not between 10 and 1000 then
    raise exception 'A participant-facing message between 10 and 1000 characters is required'
      using errcode = '22023';
  end if;

  if normalized_internal_note is not null
     and char_length(normalized_internal_note) not between 1 and 2000 then
    raise exception 'An internal note cannot exceed 2000 characters'
      using errcode = '22023';
  end if;

  if normalized_request_id is not null
     and char_length(normalized_request_id) not between 1 and 200 then
    raise exception 'A request identifier cannot exceed 200 characters'
      using errcode = '22023';
  end if;

  if p_source_report_id is not null and not exists (
    select 1
    from public.reports report
    where report.id = p_source_report_id
      and report.conversation_id = p_conversation_id
  ) then
    raise exception 'The source report does not belong to this conversation'
      using errcode = '23503';
  end if;

  select state.*
  into current_state
  from public.conversation_moderation_state state
  where state.conversation_id = p_conversation_id
  for update;

  if not found then
    raise exception 'Conversation moderation state was not found'
      using errcode = '23503';
  end if;

  if current_state.version <> p_expected_version then
    raise exception 'Conversation moderation state version conflict'
      using errcode = '40001';
  end if;

  if normalized_action = 'close' then
    if current_state.status = 'closed'
       and (
         current_state.closed_until is null
         or current_state.closed_until > transitioned_at
       ) then
      raise exception 'Only an effectively open conversation can be closed'
        using errcode = '55000';
    end if;

    if p_closed_until is not null and p_closed_until <= transitioned_at then
      raise exception 'A temporary closure must end in the future'
        using errcode = '22023';
    end if;

    if actor_role = 'moderator'
       and p_closed_until is null then
      raise exception 'Moderators must use a temporary conversation closure'
        using errcode = '42501';
    end if;

    if actor_role = 'moderator'
       and p_closed_until > transitioned_at + interval '30 days' then
      raise exception 'Moderator conversation closures cannot exceed 30 days'
        using errcode = '42501';
    end if;

    next_status := 'closed';
    next_closed_until := p_closed_until;
  else
    if current_state.status <> 'closed' then
      raise exception 'Only a closed conversation can be reopened'
        using errcode = '55000';
    end if;

    if p_closed_until is not null then
      raise exception 'A reopen transition cannot include a closure end time'
        using errcode = '22023';
    end if;

    next_status := 'open';
    next_closed_until := null;
  end if;

  insert into public.moderation_audit_events (
    event_type,
    actor_user_id,
    actor_user_id_snapshot,
    actor_role,
    source_report_id,
    resource_type,
    resource_id,
    summary,
    metadata,
    request_id,
    occurred_at
  )
  values (
    case normalized_action
      when 'close' then 'conversation.closed'
      else 'conversation.reopened'
    end,
    p_actor_id,
    p_actor_id,
    actor_role,
    p_source_report_id,
    'conversation',
    p_conversation_id,
    case normalized_action
      when 'close' then 'Conversation closed by moderation.'
      else 'Conversation reopened by moderation.'
    end,
    jsonb_strip_nulls(jsonb_build_object(
      'action', normalized_action,
      'reason_code', normalized_reason_code,
      'user_message', normalized_user_message,
      'previous_status', current_state.status,
      'new_status', next_status,
      'previous_closed_until', current_state.closed_until,
      'new_closed_until', next_closed_until,
      'internal_note', normalized_internal_note
    )),
    normalized_request_id,
    transitioned_at
  )
  returning id into audit_event_id;

  perform set_config('app.conversation_moderation_write_scope', 'transition', true);

  update public.conversation_moderation_state state
  set
    version = current_state.version + 1,
    status = next_status,
    closed_until = next_closed_until,
    reason_code = case
      when next_status = 'closed' then normalized_reason_code
      else null
    end,
    user_message = case
      when next_status = 'closed' then normalized_user_message
      else null
    end,
    changed_at = transitioned_at
  where state.conversation_id = p_conversation_id;

  insert into public.conversation_moderation_history (
    conversation_id,
    state_version,
    action,
    previous_status,
    new_status,
    previous_closed_until,
    new_closed_until,
    reason_code,
    user_message,
    actor_id,
    moderation_audit_event_id,
    created_at
  )
  values (
    p_conversation_id,
    current_state.version + 1,
    normalized_action,
    current_state.status,
    next_status,
    current_state.closed_until,
    next_closed_until,
    normalized_reason_code,
    normalized_user_message,
    p_actor_id,
    audit_event_id,
    transitioned_at
  );

  -- The GUC is only a trigger-scoped defense in depth signal; table ACLs deny
  -- service_role direct writes even if a caller sets this value themselves.
  perform set_config('app.conversation_moderation_write_scope', '', true);

  return query
  select state.*
  from public.conversation_moderation_state state
  where state.conversation_id = p_conversation_id;
end;
$$;

alter function conversation_moderation_private.transition_conversation_moderation_state_impl(
  uuid,
  bigint,
  text,
  text,
  text,
  uuid,
  timestamptz,
  text,
  uuid,
  text
) owner to postgres;
revoke all on function conversation_moderation_private.transition_conversation_moderation_state_impl(
  uuid,
  bigint,
  text,
  text,
  text,
  uuid,
  timestamptz,
  text,
  uuid,
  text
) from public, anon, authenticated, service_role;

-- EXECUTE is required by the parsed invoker wrapper below, but USAGE on this
-- dedicated schema is intentionally withheld. service_role therefore cannot
-- resolve or call the privileged implementation by name.
grant execute on function conversation_moderation_private.transition_conversation_moderation_state_impl(
  uuid,
  bigint,
  text,
  text,
  text,
  uuid,
  timestamptz,
  text,
  uuid,
  text
) to service_role;

create or replace function public.transition_conversation_moderation_state(
  p_conversation_id uuid,
  p_expected_version bigint,
  p_action text,
  p_reason_code text,
  p_user_message text,
  p_actor_id uuid,
  p_closed_until timestamptz default null,
  p_internal_note text default null,
  p_source_report_id uuid default null,
  p_request_id text default null
)
returns setof public.conversation_moderation_state
language sql
security invoker
set search_path = ''
begin atomic
  select *
  from conversation_moderation_private.transition_conversation_moderation_state_impl(
    p_conversation_id,
    p_expected_version,
    p_action,
    p_reason_code,
    p_user_message,
    p_actor_id,
    p_closed_until,
    p_internal_note,
    p_source_report_id,
    p_request_id
  );
end;

alter function public.transition_conversation_moderation_state(
  uuid,
  bigint,
  text,
  text,
  text,
  uuid,
  timestamptz,
  text,
  uuid,
  text
) owner to postgres;
revoke all on function public.transition_conversation_moderation_state(
  uuid,
  bigint,
  text,
  text,
  text,
  uuid,
  timestamptz,
  text,
  uuid,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.transition_conversation_moderation_state(
  uuid,
  bigint,
  text,
  text,
  text,
  uuid,
  timestamptz,
  text,
  uuid,
  text
) to service_role;

comment on function public.transition_conversation_moderation_state(
  uuid,
  bigint,
  text,
  text,
  text,
  uuid,
  timestamptz,
  text,
  uuid,
  text
) is
  'Invoker-only service RPC. Its private implementation atomically verifies the actor, appends a canonical audit event and participant-visible history, and advances the versioned current state.';

alter table public.conversation_moderation_state enable row level security;
alter table public.conversation_moderation_history enable row level security;

create policy "Participants can read conversation moderation state"
  on public.conversation_moderation_state
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.conversations conversation
      where conversation.id = conversation_moderation_state.conversation_id
        and (
          conversation.buyer_id = (select auth.uid())
          or conversation.seller_id = (select auth.uid())
        )
    )
  );

create policy "Participants can read conversation moderation history"
  on public.conversation_moderation_history
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.conversations conversation
      where conversation.id = conversation_moderation_history.conversation_id
        and (
          conversation.buyer_id = (select auth.uid())
          or conversation.seller_id = (select auth.uid())
        )
    )
  );

revoke all on table public.conversation_moderation_state
  from public, anon, authenticated, service_role;
revoke all on table public.conversation_moderation_history
  from public, anon, authenticated, service_role;

grant select (
  conversation_id,
  version,
  status,
  closed_until,
  reason_code,
  user_message,
  changed_at
) on table public.conversation_moderation_state to authenticated;
grant select (
  id,
  conversation_id,
  state_version,
  action,
  previous_status,
  new_status,
  previous_closed_until,
  new_closed_until,
  reason_code,
  user_message,
  created_at
) on table public.conversation_moderation_history to authenticated;
grant select on table public.conversation_moderation_state to service_role;
grant select on table public.conversation_moderation_history to service_role;

create view public.conversation_effective_moderation_state
with (security_invoker = true, security_barrier = true)
as
select
  state.conversation_id,
  state.version,
  state.status as recorded_status,
  case
    when state.status = 'closed'
      and (
        state.closed_until is null
        or state.closed_until > now()
      ) then 'closed'
    else 'open'
  end as effective_status,
  state.closed_until,
  state.reason_code,
  state.user_message,
  state.changed_at
from public.conversation_moderation_state state;

alter view public.conversation_effective_moderation_state owner to postgres;
revoke all on table public.conversation_effective_moderation_state
  from public, anon, authenticated, service_role;
grant select on table public.conversation_effective_moderation_state
  to authenticated, service_role;

comment on view public.conversation_effective_moderation_state is
  'Participant-safe derived state. An expired temporary closure remains recorded as closed in immutable history but is effectively open for message enforcement.';

-- Keep conversation moderation state out of Postgres Changes. Realtime DELETE
-- events are not filtered through RLS, so deleting a conversation could expose
-- its moderation-state primary key even though participant reads are otherwise
-- protected. Stage 4 emits a participant-safe notification and clients refetch
-- the RLS-protected state/view instead. Preserve every unrelated publication
-- member while removing a legacy membership for this table, if present.
do $$
begin
  if exists (
    select 1
    from pg_publication publication
    where publication.pubname = 'supabase_realtime'
  ) and exists (
    select 1
    from pg_publication_tables published_table
    where published_table.pubname = 'supabase_realtime'
      and published_table.schemaname = 'public'
      and published_table.tablename = 'conversation_moderation_state'
  ) then
    execute 'alter publication supabase_realtime drop table public.conversation_moderation_state';
  end if;
end;
$$;
