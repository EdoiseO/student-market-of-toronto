-- Keep restricted users authenticated so they can inspect Account standing,
-- acknowledge notices, request one review, sign out, or delete their account.
-- Marketplace mutations are denied at the database boundary from the durable
-- public.user_status projection rather than by terminating Supabase Auth.
-- Recipient-owned SELECT access intentionally remains available through the
-- existing RLS policies so restricted users can retain their own history and
-- evidence. The restriction is mutation-only at the data boundary.

create table moderation_action_private.application_ban_commands (
  id uuid primary key default gen_random_uuid(),
  actor_user_id_snapshot uuid not null,
  subject_user_id_snapshot uuid not null,
  action text not null check (action in ('ban', 'unban')),
  request_id uuid not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  result_sanction_id uuid not null,
  result_is_banned boolean not null,
  result_banned_until timestamptz,
  completed_at timestamptz not null default now(),
  constraint application_ban_commands_actor_request_key
    unique (actor_user_id_snapshot, request_id),
  constraint application_ban_commands_result_shape check (
    result_is_banned or result_banned_until is null
  )
);

alter table moderation_action_private.application_ban_commands owner to postgres;
revoke all on table moderation_action_private.application_ban_commands
  from public, anon, authenticated, service_role;

create or replace function moderation_action_private.application_ban_expiry(
  p_duration text,
  p_started_at timestamptz
)
returns timestamptz
language sql
immutable
security definer
set search_path = ''
as $function$
  select case p_duration
    when '24h' then p_started_at + interval '24 hours'
    when '7d' then p_started_at + interval '7 days'
    when '30d' then p_started_at + interval '30 days'
    when 'permanent' then null
    else 'infinity'::timestamptz
  end;
$function$;

create or replace function moderation_action_private.set_application_moderation_ban_impl(
  p_subject_user_id uuid,
  p_action text,
  p_duration text,
  p_reason_code text,
  p_user_message text,
  p_revocation_reason text,
  p_request_id uuid
)
returns table (
  sanction_id uuid,
  is_banned boolean,
  banned_until timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  action_at timestamptz := statement_timestamp();
  normalized_action text := lower(btrim(coalesce(p_action, '')));
  normalized_duration text := lower(btrim(coalesce(p_duration, '')));
  normalized_reason_code text := lower(btrim(coalesce(p_reason_code, '')));
  normalized_user_message text := btrim(coalesce(p_user_message, ''));
  normalized_revocation_reason text := btrim(coalesce(p_revocation_reason, ''));
  canonical_payload jsonb;
  existing_command moderation_action_private.application_ban_commands%rowtype;
  existing_status public.user_status%rowtype;
  result_id uuid;
  result_until timestamptz;
begin
  if p_request_id is null or normalized_action not in ('ban', 'unban') then
    raise exception using
      errcode = '22023',
      message = 'application_ban_request_is_invalid';
  end if;

  actor_role := moderation_action_private.require_actor(
    case normalized_action when 'ban' then 'ban_user' else 'unban_user' end
  );
  if normalized_action = 'ban' then
    perform moderation_action_private.assert_subject(
      p_subject_user_id,
      actor_role,
      actor_id
    );
  else
    -- A legacy GoTrue ban may have affected an administrator. Another active
    -- administrator must be able to clear that imported restriction, while
    -- self-unban remains forbidden. Keep the canonical actor -> subject lock.
    if p_subject_user_id is null or p_subject_user_id = actor_id then
      raise exception using
        errcode = '22023',
        message = 'moderation_subject_is_invalid';
    end if;

    perform 1
    from auth.users account
    where account.id = p_subject_user_id
    for update;

    if not found then
      raise exception using
        errcode = 'P0002',
        message = 'moderation_subject_not_found';
    end if;
  end if;

  -- require_actor and assert_subject lock Auth identities in the canonical
  -- actor -> subject order. The subject advisory lock serializes two admins.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('application-ban:' || p_subject_user_id::text, 0)
  );

  if normalized_action = 'ban' then
    if normalized_duration not in ('24h', '7d', '30d', 'permanent')
      or normalized_reason_code not in (
        'spam', 'scam', 'misleading', 'prohibited',
        'harassment', 'inappropriate', 'other'
      )
      or char_length(normalized_user_message) not between 10 and 1000
      or normalized_revocation_reason <> '' then
      raise exception using
        errcode = '22023',
        message = 'application_ban_request_is_invalid';
    end if;

    result_until := moderation_action_private.application_ban_expiry(
      normalized_duration,
      action_at
    );
    canonical_payload := jsonb_build_object(
      'duration', normalized_duration,
      'reason_code', normalized_reason_code,
      'user_message', normalized_user_message
    );
  else
    if normalized_duration <> ''
      or normalized_reason_code <> ''
      or normalized_user_message <> ''
      or char_length(normalized_revocation_reason) not between 10 and 1000 then
      raise exception using
        errcode = '22023',
        message = 'application_unban_request_is_invalid';
    end if;

    result_until := null;
    canonical_payload := jsonb_build_object(
      'revocation_reason', normalized_revocation_reason
    );
  end if;

  select *
  into existing_command
  from moderation_action_private.application_ban_commands command
  where command.actor_user_id_snapshot = actor_id
    and command.request_id = p_request_id
  for update;

  if found then
    if existing_command.subject_user_id_snapshot is distinct from p_subject_user_id
      or existing_command.action is distinct from normalized_action
      or existing_command.payload is distinct from canonical_payload then
      raise exception using
        errcode = '22023',
        message = 'moderation_request_id_payload_conflict';
    end if;

    select *
    into existing_status
    from public.user_status status
    where status.user_id = p_subject_user_id;

    if existing_command.result_is_banned then
      if not found
        or not existing_status.is_banned
        or existing_status.banned_until is distinct from existing_command.result_banned_until then
        raise exception using
          errcode = '40001',
          message = 'application_ban_completed_state_changed';
      end if;
    elsif found and existing_status.is_banned then
      raise exception using
        errcode = '40001',
        message = 'application_ban_completed_state_changed';
    end if;

    return query
    select
      existing_command.result_sanction_id,
      existing_command.result_is_banned
        and (
          existing_command.result_banned_until is null
          or existing_command.result_banned_until > action_at
        ),
      existing_command.result_banned_until,
      true;
    return;
  end if;

  if normalized_action = 'ban' then
    perform moderation_action_private.validate_common_inputs(
      normalized_reason_code,
      normalized_user_message,
      null,
      jsonb_build_object('account_access', 'blocked'),
      null,
      null,
      p_request_id::text
    );

    if exists (
      select 1
      from public.moderation_sanctions sanction
      where sanction.subject_user_id_snapshot = p_subject_user_id
        and sanction.sanction_type = 'ban'
        and sanction.revoked_at is null
        and (sanction.expires_at is null or sanction.expires_at > action_at)
    ) then
      raise exception using
        errcode = '55000',
        message = 'moderation_subject_already_banned';
    end if;

    insert into public.moderation_sanctions (
      subject_user_id,
      subject_user_id_snapshot,
      issued_by_user_id,
      issued_by_user_id_snapshot,
      issued_by_role,
      sanction_type,
      severity,
      reason_code,
      user_message,
      restrictions,
      starts_at,
      expires_at,
      acknowledgement_required,
      metadata
    ) values (
      p_subject_user_id,
      p_subject_user_id,
      actor_id,
      actor_id,
      actor_role,
      'ban',
      'critical',
      normalized_reason_code,
      normalized_user_message,
      jsonb_build_object('account_access', 'blocked'),
      action_at,
      result_until,
      true,
      jsonb_build_object(
        'request_id', p_request_id::text,
        'duration', normalized_duration,
        'enforcement', 'application'
      )
    )
    returning id into result_id;

    insert into public.user_status (
      user_id,
      is_banned,
      banned_until,
      ban_reason,
      created_at,
      updated_at
    ) values (
      p_subject_user_id,
      true,
      result_until,
      normalized_user_message,
      action_at,
      action_at
    )
    on conflict (user_id) do update
    set is_banned = true,
        banned_until = excluded.banned_until,
        ban_reason = excluded.ban_reason,
        updated_at = excluded.updated_at;
  else
    -- This is the only path that may revoke a ban on a protected target. It
    -- already holds the active admin actor and exact subject Auth row locks.
    -- Keep the generic revocation RPC protected for every other moderation
    -- action while advancing the canonical sanction/audit/projection together.
    select sanction.id
    into result_id
    from public.moderation_sanctions sanction
    where sanction.subject_user_id_snapshot = p_subject_user_id
      and sanction.sanction_type = 'ban'
      and sanction.revoked_at is null
      and (sanction.expires_at is null or sanction.expires_at > action_at)
    order by sanction.starts_at desc, sanction.id desc
    limit 1
    for update;

    if result_id is null then
      raise exception using
        errcode = 'P0002',
        message = 'moderation_active_ban_not_found';
    end if;

    perform moderation_action_private.assert_auth_ban_cleared(p_subject_user_id);

    update public.moderation_sanctions sanction
    set revoked_at = action_at,
        revoked_by_user_id = actor_id,
        revoked_by_user_id_snapshot = actor_id,
        revoked_by_role = actor_role,
        revocation_kind = 'revoked',
        revocation_reason = normalized_revocation_reason
    where sanction.id = result_id;

    perform moderation_action_private.clear_ban_projection(
      p_subject_user_id,
      action_at
    );
  end if;

  insert into moderation_action_private.application_ban_commands (
    actor_user_id_snapshot,
    subject_user_id_snapshot,
    action,
    request_id,
    payload,
    result_sanction_id,
    result_is_banned,
    result_banned_until,
    completed_at
  ) values (
    actor_id,
    p_subject_user_id,
    normalized_action,
    p_request_id,
    canonical_payload,
    result_id,
    normalized_action = 'ban',
    result_until,
    action_at
  );

  return query
  select result_id, normalized_action = 'ban', result_until, false;
end;
$function$;

alter function moderation_action_private.application_ban_expiry(text, timestamptz)
  owner to postgres;
alter function moderation_action_private.set_application_moderation_ban_impl(
  uuid, text, text, text, text, text, uuid
) owner to postgres;
revoke all on function moderation_action_private.application_ban_expiry(text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function moderation_action_private.set_application_moderation_ban_impl(
  uuid, text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function moderation_action_private.set_application_moderation_ban_impl(
  uuid, text, text, text, text, text, uuid
) to authenticated;

create function public.set_application_moderation_ban(
  p_subject_user_id uuid,
  p_action text,
  p_duration text,
  p_reason_code text,
  p_user_message text,
  p_revocation_reason text,
  p_request_id uuid
)
returns table (
  sanction_id uuid,
  is_banned boolean,
  banned_until timestamptz,
  replayed boolean
)
language sql
security invoker
set search_path = ''
begin atomic
  select sanction_id, is_banned, banned_until, replayed
  from moderation_action_private.set_application_moderation_ban_impl(
    p_subject_user_id,
    p_action,
    p_duration,
    p_reason_code,
    p_user_message,
    p_revocation_reason,
    p_request_id
  );
end;

alter function public.set_application_moderation_ban(
  uuid, text, text, text, text, text, uuid
) owner to postgres;
revoke all on function public.set_application_moderation_ban(
  uuid, text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.set_application_moderation_ban(
  uuid, text, text, text, text, text, uuid
) to authenticated;

-- The Auth-saga and Auth-first ban entry point are retired. Their objects stay
-- for migration-history compatibility, but stale authenticated callers fail.
revoke execute on function public.begin_auth_ban_operation(uuid, text, text, jsonb, text)
  from authenticated;
revoke execute on function public.complete_auth_ban_operation(uuid, timestamptz)
  from authenticated;
revoke execute on function public.abort_auth_ban_operation(uuid)
  from authenticated;
revoke execute on function public.issue_moderation_ban(
  uuid, text, text, text, text, uuid, text, uuid, text
) from authenticated;
revoke execute on function public.revoke_active_moderation_ban(uuid, text)
  from authenticated;

revoke execute on function moderation_action_private.begin_auth_ban_operation_impl(
  uuid, text, text, jsonb, text
) from authenticated;
revoke execute on function moderation_action_private.complete_auth_ban_operation_impl(
  uuid, timestamptz
) from authenticated;
revoke execute on function moderation_action_private.abort_auth_ban_operation_impl(uuid)
  from authenticated;
revoke execute on function moderation_action_private.issue_moderation_ban_impl(
  uuid, text, text, text, text, uuid, text, uuid, text
) from authenticated;
revoke execute on function moderation_action_private.revoke_active_moderation_ban_impl(uuid, text)
  from authenticated;

-- Preserve any active Auth-only restriction before clearing GoTrue's ban. The
-- import is naturally idempotent: an active durable ban suppresses insertion,
-- and the Auth value is cleared only after both sanction and projection exist.
insert into public.moderation_sanctions (
  subject_user_id,
  subject_user_id_snapshot,
  issued_by_user_id,
  issued_by_user_id_snapshot,
  issued_by_role,
  sanction_type,
  severity,
  reason_code,
  user_message,
  internal_note,
  restrictions,
  starts_at,
  expires_at,
  acknowledgement_required,
  metadata,
  created_at,
  updated_at
)
select
  account.id,
  account.id,
  null,
  null,
  'system',
  'ban',
  'critical',
  'legacy_auth_ban',
  case
    when char_length(btrim(coalesce(status.ban_reason, ''))) between 10 and 1000
      then btrim(status.ban_reason)
    else 'Account restriction imported from the previous authentication ban system.'
  end,
  'Imported during the application-enforced ban cutover.',
  jsonb_build_object('account_access', 'blocked'),
  case
    when coalesce(status.updated_at, account.updated_at, now()) >= account.banned_until
      then account.banned_until - interval '1 second'
    else coalesce(status.updated_at, account.updated_at, now())
  end,
  case
    when account.banned_until - now() >= interval '99 years' then null
    else account.banned_until
  end,
  true,
  jsonb_build_object(
    'origin', 'legacy_auth_ban_cutover',
    'enforcement', 'application',
    'imported_at', now()
  ),
  case
    when coalesce(status.updated_at, account.updated_at, now()) >= account.banned_until
      then account.banned_until - interval '1 second'
    else coalesce(status.updated_at, account.updated_at, now())
  end,
  now()
from auth.users account
left join public.user_status status
  on status.user_id = account.id
where account.banned_until is not null
  and account.banned_until > now()
  and not exists (
    select 1
    from public.moderation_sanctions sanction
    where sanction.subject_user_id_snapshot = account.id
      and sanction.sanction_type = 'ban'
      and sanction.revoked_at is null
      and (sanction.expires_at is null or sanction.expires_at > now())
  );

insert into public.user_status (
  user_id,
  is_banned,
  banned_until,
  ban_reason,
  created_at,
  updated_at
)
select
  account.id,
  true,
  case
    when account.banned_until - now() >= interval '99 years' then null
    else account.banned_until
  end,
  case
    when char_length(btrim(coalesce(status.ban_reason, ''))) between 10 and 1000
      then btrim(status.ban_reason)
    else 'Account restriction imported from the previous authentication ban system.'
  end,
  coalesce(status.created_at, now()),
  now()
from auth.users account
left join public.user_status status
  on status.user_id = account.id
where account.banned_until is not null
  and account.banned_until > now()
  and not (
    coalesce(status.is_banned, false)
    and (status.banned_until is null or status.banned_until > now())
  )
on conflict (user_id) do update
set is_banned = true,
    banned_until = excluded.banned_until,
    ban_reason = excluded.ban_reason,
    updated_at = excluded.updated_at;

update auth.users account
set banned_until = null,
    updated_at = now()
where account.banned_until is not null
  and account.banned_until > now()
  and exists (
    select 1
    from public.user_status status
    where status.user_id = account.id
      and status.is_banned
      and (status.banned_until is null or status.banned_until > now())
  )
  and exists (
    select 1
    from public.moderation_sanctions sanction
    where sanction.subject_user_id_snapshot = account.id
      and sanction.sanction_type = 'ban'
      and sanction.revoked_at is null
      and (sanction.expires_at is null or sanction.expires_at > now())
  );

create or replace function private.reject_banned_authenticated_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'authenticated'
    and actor_id is not null
    and exists (
      select 1
      from public.user_status status
      where status.user_id = actor_id
        and status.is_banned
        and (
          status.banned_until is null
          or status.banned_until > statement_timestamp()
        )
    ) then
    raise exception using
      errcode = '42501',
      message = 'account_is_banned';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$function$;

alter function private.reject_banned_authenticated_write() owner to postgres;
revoke all on function private.reject_banned_authenticated_write()
  from public, anon, authenticated, service_role;

do $migration$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'profiles',
    'listings',
    'listing_images',
    'listing_favourites',
    'conversations',
    'conversation_user_state',
    'messages',
    'message_attachments',
    'message_reactions',
    'blocked_users',
    'reports',
    'notification_preferences'
  ] loop
    if to_regclass('public.' || relation_name) is not null then
      execute format(
        'drop trigger if exists reject_banned_authenticated_write on public.%I',
        relation_name
      );
      execute format(
        'create trigger reject_banned_authenticated_write '
        || 'before insert or update or delete on public.%I '
        || 'for each row execute function private.reject_banned_authenticated_write()',
        relation_name
      );
    end if;
  end loop;

  if to_regclass('private.message_media_upload_reservations') is not null then
    drop trigger if exists reject_banned_authenticated_write
      on private.message_media_upload_reservations;
    create trigger reject_banned_authenticated_write
      before insert or update or delete on private.message_media_upload_reservations
      for each row execute function private.reject_banned_authenticated_write();
  end if;
end;
$migration$;

create or replace function private.reject_banned_authenticated_storage_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  object_bucket text := case when tg_op = 'DELETE' then old.bucket_id else new.bucket_id end;
  actor_id uuid := auth.uid();
begin
  if object_bucket = any (array['profile-images', 'listing-images', 'message-media']::text[])
    and coalesce(auth.jwt() ->> 'role', '') = 'authenticated'
    and actor_id is not null
    and exists (
      select 1
      from public.user_status status
      where status.user_id = actor_id
        and status.is_banned
        and (
          status.banned_until is null
          or status.banned_until > statement_timestamp()
        )
    ) then
    raise exception using
      errcode = '42501',
      message = 'account_is_banned';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$function$;

alter function private.reject_banned_authenticated_storage_write() owner to postgres;
revoke all on function private.reject_banned_authenticated_storage_write()
  from public, anon, authenticated, service_role;

drop trigger if exists reject_banned_authenticated_storage_write on storage.objects;
create trigger reject_banned_authenticated_storage_write
  before insert or update or delete on storage.objects
  for each row execute function private.reject_banned_authenticated_storage_write();

comment on table moderation_action_private.application_ban_commands is
  'Actor-scoped idempotency ledger for atomic application-enforced ban and unban commands.';
comment on function public.set_application_moderation_ban(
  uuid, text, text, text, text, text, uuid
) is
  'Atomically applies or revokes an application-enforced account ban while preserving Supabase Auth access for standing and review.';
comment on function private.reject_banned_authenticated_write() is
  'Fails authenticated marketplace table mutations closed while an application ban is effective.';
comment on function private.reject_banned_authenticated_storage_write() is
  'Fails profile, listing, and message media mutations closed while an application ban is effective.';

-- Review modification predates application-enforced bans and derives a ban
-- replacement from auth.users.banned_until. Reject that obsolete escalation
-- path explicitly. An administrator must issue the reviewed ban as a distinct,
-- idempotent set_application_moderation_ban command instead.
create function moderation_action_private.modify_application_safe_sanction_review_impl(
  p_sanction_id uuid,
  p_replacement_type text,
  p_severity text,
  p_reason_code text,
  p_user_message text,
  p_outcome_message text,
  p_revocation_reason text,
  p_strike_points smallint default null,
  p_internal_note text default null,
  p_restrictions jsonb default '{}'::jsonb,
  p_related_resource_type text default null,
  p_related_resource_id uuid default null,
  p_expires_at timestamptz default null,
  p_acknowledgement_required boolean default true,
  p_private_reason text default null,
  p_request_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if lower(btrim(coalesce(p_replacement_type, ''))) = 'ban' then
    raise exception using
      errcode = '55000',
      message = 'application_ban_replacement_requires_separate_action';
  end if;

  return moderation_action_private.modify_moderation_sanction_review_impl(
    p_sanction_id,
    p_replacement_type,
    p_severity,
    p_reason_code,
    p_user_message,
    p_outcome_message,
    p_revocation_reason,
    p_strike_points,
    p_internal_note,
    p_restrictions,
    p_related_resource_type,
    p_related_resource_id,
    p_expires_at,
    p_acknowledgement_required,
    p_private_reason,
    p_request_id
  );
end;
$function$;

alter function moderation_action_private.modify_application_safe_sanction_review_impl(
  uuid, text, text, text, text, text, text, smallint, text, jsonb, text, uuid,
  timestamptz, boolean, text, text
) owner to postgres;
revoke all on function moderation_action_private.modify_application_safe_sanction_review_impl(
  uuid, text, text, text, text, text, text, smallint, text, jsonb, text, uuid,
  timestamptz, boolean, text, text
) from public, anon, authenticated, service_role;
grant execute on function moderation_action_private.modify_application_safe_sanction_review_impl(
  uuid, text, text, text, text, text, text, smallint, text, jsonb, text, uuid,
  timestamptz, boolean, text, text
) to authenticated;

create or replace function public.modify_moderation_sanction_review(
  p_sanction_id uuid,
  p_replacement_type text,
  p_severity text,
  p_reason_code text,
  p_user_message text,
  p_outcome_message text,
  p_revocation_reason text,
  p_strike_points smallint default null,
  p_internal_note text default null,
  p_restrictions jsonb default '{}'::jsonb,
  p_related_resource_type text default null,
  p_related_resource_id uuid default null,
  p_expires_at timestamptz default null,
  p_acknowledgement_required boolean default true,
  p_private_reason text default null,
  p_request_id text default null
)
returns uuid
language sql
security invoker
set search_path = ''
begin atomic
  select moderation_action_private.modify_application_safe_sanction_review_impl(
    p_sanction_id,
    p_replacement_type,
    p_severity,
    p_reason_code,
    p_user_message,
    p_outcome_message,
    p_revocation_reason,
    p_strike_points,
    p_internal_note,
    p_restrictions,
    p_related_resource_type,
    p_related_resource_id,
    p_expires_at,
    p_acknowledgement_required,
    p_private_reason,
    p_request_id
  );
end;

alter function public.modify_moderation_sanction_review(
  uuid, text, text, text, text, text, text, smallint, text, jsonb, text, uuid,
  timestamptz, boolean, text, text
) owner to postgres;
revoke all on function public.modify_moderation_sanction_review(
  uuid, text, text, text, text, text, text, smallint, text, jsonb, text, uuid,
  timestamptz, boolean, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.modify_moderation_sanction_review(
  uuid, text, text, text, text, text, text, smallint, text, jsonb, text, uuid,
  timestamptz, boolean, text, text
) to authenticated;

comment on function public.modify_moderation_sanction_review(
  uuid, text, text, text, text, text, text, smallint, text, jsonb, text, uuid,
  timestamptz, boolean, text, text
) is
  'Modifies reviewed warnings and strikes; ban escalation must use the atomic application-ban command.';
