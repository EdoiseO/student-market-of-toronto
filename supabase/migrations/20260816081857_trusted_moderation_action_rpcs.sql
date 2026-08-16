-- Trusted moderation action cutover.
--
-- Every human moderation mutation is attributed to auth.uid() and authorized
-- from the actor's current auth.users.raw_app_meta_data.  Public RPCs are
-- exposed only through SECURITY INVOKER wrappers over non-USAGE private-schema
-- implementations. The private functions atomically maintain durable state and
-- never trust a caller-supplied moderator UUID or role.

create schema if not exists moderation_action_private;
revoke all on schema moderation_action_private
  from public, anon, authenticated, service_role;

create or replace function moderation_action_private.resolve_role(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when lower(coalesce(account.raw_app_meta_data ->> 'role', '')) = 'admin'
      or coalesce(account.raw_app_meta_data -> 'roles', '[]'::jsonb) ? 'admin'
      then 'admin'
    when lower(coalesce(account.raw_app_meta_data ->> 'role', '')) = 'moderator'
      or coalesce(account.raw_app_meta_data -> 'roles', '[]'::jsonb) ? 'moderator'
      then 'moderator'
    when lower(coalesce(account.raw_app_meta_data ->> 'role', '')) = 'staff'
      or coalesce(account.raw_app_meta_data -> 'roles', '[]'::jsonb) ? 'staff'
      then 'staff'
    else null
  end
  from auth.users account
  where account.id = p_user_id;
$$;

alter function moderation_action_private.resolve_role(uuid) owner to postgres;
revoke all on function moderation_action_private.resolve_role(uuid)
  from public, anon, authenticated, service_role;

create or replace function moderation_action_private.require_actor(p_action text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
begin
  if auth.role() <> 'authenticated' or actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'moderation_authentication_required';
  end if;

  actor_role := moderation_action_private.resolve_role(actor_id);

  if actor_role is null or not (
    case p_action
      when 'decide_reports' then actor_role in ('admin', 'moderator')
      when 'decide_listings' then actor_role in ('admin', 'moderator')
      when 'issue_warning' then actor_role in ('admin', 'moderator')
      when 'issue_standard_strike' then actor_role in ('admin', 'moderator')
      when 'ban_user' then actor_role = 'admin'
      when 'unban_user' then actor_role = 'admin'
      else false
    end
  ) then
    raise exception using
      errcode = '42501',
      message = 'moderation_action_not_permitted';
  end if;

  if exists (
    select 1
    from public.user_status status
    where status.user_id = actor_id
      and status.is_banned
      and (status.banned_until is null or status.banned_until > statement_timestamp())
  ) then
    raise exception using
      errcode = '42501',
      message = 'moderation_actor_is_banned';
  end if;

  return actor_role;
end;
$$;

alter function moderation_action_private.require_actor(text) owner to postgres;
revoke all on function moderation_action_private.require_actor(text)
  from public, anon, authenticated, service_role;

create or replace function moderation_action_private.assert_subject(
  p_subject_user_id uuid,
  p_actor_role text,
  p_actor_user_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  subject_role text;
begin
  if p_subject_user_id is null or p_subject_user_id = p_actor_user_id then
    raise exception using
      errcode = '22023',
      message = 'moderation_subject_is_invalid';
  end if;

  if not exists (select 1 from auth.users account where account.id = p_subject_user_id) then
    raise exception using
      errcode = 'P0002',
      message = 'moderation_subject_not_found';
  end if;

  subject_role := moderation_action_private.resolve_role(p_subject_user_id);

  if subject_role = 'admin'
    or (p_actor_role = 'moderator' and subject_role = 'moderator') then
    raise exception using
      errcode = '42501',
      message = 'moderation_subject_is_protected';
  end if;
end;
$$;

alter function moderation_action_private.assert_subject(uuid, text, uuid) owner to postgres;
revoke all on function moderation_action_private.assert_subject(uuid, text, uuid)
  from public, anon, authenticated, service_role;

create or replace function moderation_action_private.assert_source_report(
  p_source_report_id uuid,
  p_subject_user_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_source_report_id is not null and not exists (
    select 1
    from public.reports report
    where report.id = p_source_report_id
      and report.reported_user_id = p_subject_user_id
  ) then
    raise exception using
      errcode = '22023',
      message = 'moderation_source_report_mismatch';
  end if;
end;
$$;

alter function moderation_action_private.assert_source_report(uuid, uuid) owner to postgres;
revoke all on function moderation_action_private.assert_source_report(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function moderation_action_private.validate_common_inputs(
  p_reason_code text,
  p_user_message text,
  p_internal_note text,
  p_restrictions jsonb,
  p_related_resource_type text,
  p_related_resource_id uuid,
  p_request_id text
)
returns void
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  if p_reason_code is null
    or p_reason_code !~ '^[a-z][a-z0-9_]{1,63}$'
    or char_length(btrim(coalesce(p_user_message, ''))) not between 10 and 1000
    or (p_internal_note is not null and char_length(btrim(p_internal_note)) not between 1 and 2000)
    or jsonb_typeof(coalesce(p_restrictions, '{}'::jsonb)) <> 'object'
    or ((p_related_resource_type is null) <> (p_related_resource_id is null))
    or (
      p_related_resource_type is not null
      and p_related_resource_type !~ '^[a-z][a-z0-9_]{1,63}$'
    )
    or (p_request_id is not null and char_length(btrim(p_request_id)) not between 1 and 200) then
    raise exception using
      errcode = '22023',
      message = 'moderation_sanction_input_is_invalid';
  end if;
end;
$$;

alter function moderation_action_private.validate_common_inputs(text, text, text, jsonb, text, uuid, text)
  owner to postgres;
revoke all on function moderation_action_private.validate_common_inputs(text, text, text, jsonb, text, uuid, text)
  from public, anon, authenticated, service_role;

create or replace function public.issue_moderation_warning(
  p_subject_user_id uuid,
  p_severity text,
  p_reason_code text,
  p_user_message text,
  p_internal_note text default null,
  p_source_report_id uuid default null,
  p_restrictions jsonb default '{}'::jsonb,
  p_related_resource_type text default null,
  p_related_resource_id uuid default null,
  p_expires_at timestamptz default null,
  p_acknowledgement_required boolean default true,
  p_request_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  sanction_id uuid;
  issued_at timestamptz := statement_timestamp();
begin
  actor_role := moderation_action_private.require_actor('issue_warning');
  perform moderation_action_private.assert_subject(p_subject_user_id, actor_role, actor_id);
  perform moderation_action_private.assert_source_report(p_source_report_id, p_subject_user_id);
  perform moderation_action_private.validate_common_inputs(
    p_reason_code, p_user_message, p_internal_note, p_restrictions,
    p_related_resource_type, p_related_resource_id, p_request_id
  );

  if p_severity not in ('low', 'medium', 'high', 'critical')
    or (p_expires_at is not null and p_expires_at <= issued_at) then
    raise exception using errcode = '22023', message = 'moderation_warning_input_is_invalid';
  end if;

  insert into public.moderation_sanctions (
    subject_user_id, subject_user_id_snapshot,
    issued_by_user_id, issued_by_user_id_snapshot, issued_by_role,
    source_report_id, sanction_type, severity, reason_code, user_message,
    internal_note, restrictions, related_resource_type, related_resource_id,
    starts_at, expires_at, acknowledgement_required, metadata
  ) values (
    p_subject_user_id, p_subject_user_id,
    actor_id, actor_id, actor_role,
    p_source_report_id, 'warning', p_severity, p_reason_code, btrim(p_user_message),
    nullif(btrim(p_internal_note), ''), coalesce(p_restrictions, '{}'::jsonb),
    p_related_resource_type, p_related_resource_id,
    issued_at, p_expires_at, coalesce(p_acknowledgement_required, true),
    jsonb_strip_nulls(jsonb_build_object('request_id', nullif(btrim(p_request_id), '')))
  ) returning id into sanction_id;

  return sanction_id;
end;
$$;

create or replace function public.issue_moderation_strike(
  p_subject_user_id uuid,
  p_severity text,
  p_reason_code text,
  p_user_message text,
  p_strike_points smallint,
  p_internal_note text default null,
  p_source_report_id uuid default null,
  p_restrictions jsonb default '{}'::jsonb,
  p_related_resource_type text default null,
  p_related_resource_id uuid default null,
  p_expires_at timestamptz default null,
  p_acknowledgement_required boolean default true,
  p_request_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  sanction_id uuid;
  issued_at timestamptz := statement_timestamp();
begin
  actor_role := moderation_action_private.require_actor('issue_standard_strike');
  perform moderation_action_private.assert_subject(p_subject_user_id, actor_role, actor_id);
  perform moderation_action_private.assert_source_report(p_source_report_id, p_subject_user_id);
  perform moderation_action_private.validate_common_inputs(
    p_reason_code, p_user_message, p_internal_note, p_restrictions,
    p_related_resource_type, p_related_resource_id, p_request_id
  );

  if p_severity not in ('low', 'medium', 'high', 'critical')
    or p_strike_points not between 1 and 3
    or (p_expires_at is not null and p_expires_at <= issued_at) then
    raise exception using errcode = '22023', message = 'moderation_strike_input_is_invalid';
  end if;

  insert into public.moderation_sanctions (
    subject_user_id, subject_user_id_snapshot,
    issued_by_user_id, issued_by_user_id_snapshot, issued_by_role,
    source_report_id, sanction_type, severity, reason_code, user_message,
    internal_note, strike_points, restrictions, related_resource_type,
    related_resource_id, starts_at, expires_at, acknowledgement_required, metadata
  ) values (
    p_subject_user_id, p_subject_user_id,
    actor_id, actor_id, actor_role,
    p_source_report_id, 'strike', p_severity, p_reason_code, btrim(p_user_message),
    nullif(btrim(p_internal_note), ''), p_strike_points,
    coalesce(p_restrictions, '{}'::jsonb), p_related_resource_type,
    p_related_resource_id, issued_at, p_expires_at,
    coalesce(p_acknowledgement_required, true),
    jsonb_strip_nulls(jsonb_build_object('request_id', nullif(btrim(p_request_id), '')))
  ) returning id into sanction_id;

  return sanction_id;
end;
$$;

create or replace function public.issue_moderation_ban(
  p_subject_user_id uuid,
  p_severity text,
  p_reason_code text,
  p_user_message text,
  p_internal_note text default null,
  p_source_report_id uuid default null,
  p_related_resource_type text default null,
  p_related_resource_id uuid default null,
  p_request_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  auth_banned_until timestamptz;
  sanction_id uuid;
  issued_at timestamptz := statement_timestamp();
begin
  actor_role := moderation_action_private.require_actor('ban_user');
  perform moderation_action_private.assert_subject(p_subject_user_id, actor_role, actor_id);
  perform moderation_action_private.assert_source_report(p_source_report_id, p_subject_user_id);
  perform moderation_action_private.validate_common_inputs(
    p_reason_code, p_user_message, p_internal_note,
    jsonb_build_object('account_access', 'blocked'),
    p_related_resource_type, p_related_resource_id, p_request_id
  );

  if p_severity not in ('high', 'critical') then
    raise exception using errcode = '22023', message = 'moderation_ban_severity_is_invalid';
  end if;

  select account.banned_until
  into auth_banned_until
  from auth.users account
  where account.id = p_subject_user_id
  for update;

  if auth_banned_until is null or auth_banned_until <= issued_at then
    raise exception using
      errcode = '55000',
      message = 'moderation_auth_ban_must_be_applied_first';
  end if;

  if exists (
    select 1
    from public.moderation_sanctions sanction
    where sanction.subject_user_id_snapshot = p_subject_user_id
      and sanction.sanction_type = 'ban'
      and sanction.revoked_at is null
      and (sanction.expires_at is null or sanction.expires_at > issued_at)
  ) then
    raise exception using errcode = '55000', message = 'moderation_subject_already_banned';
  end if;

  insert into public.moderation_sanctions (
    subject_user_id, subject_user_id_snapshot,
    issued_by_user_id, issued_by_user_id_snapshot, issued_by_role,
    source_report_id, sanction_type, severity, reason_code, user_message,
    internal_note, restrictions, related_resource_type, related_resource_id,
    starts_at, expires_at, acknowledgement_required, metadata
  ) values (
    p_subject_user_id, p_subject_user_id,
    actor_id, actor_id, actor_role,
    p_source_report_id, 'ban', p_severity, p_reason_code, btrim(p_user_message),
    nullif(btrim(p_internal_note), ''), jsonb_build_object('account_access', 'blocked'),
    p_related_resource_type, p_related_resource_id,
    issued_at, auth_banned_until, true,
    jsonb_strip_nulls(jsonb_build_object('request_id', nullif(btrim(p_request_id), '')))
  ) returning id into sanction_id;

  insert into public.user_status (
    user_id, is_banned, banned_until, ban_reason, created_at, updated_at
  ) values (
    p_subject_user_id, true, auth_banned_until, btrim(p_user_message), issued_at, issued_at
  )
  on conflict (user_id) do update
  set is_banned = true,
      banned_until = excluded.banned_until,
      ban_reason = excluded.ban_reason,
      updated_at = excluded.updated_at;

  return sanction_id;
end;
$$;

create or replace function public.acknowledge_moderation_sanction(p_sanction_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  subject_id uuid := auth.uid();
  acknowledged_count integer;
begin
  if auth.role() <> 'authenticated' or subject_id is null then
    raise exception using errcode = '42501', message = 'moderation_authentication_required';
  end if;

  update public.moderation_sanctions sanction
  set acknowledged_at = statement_timestamp(),
      acknowledged_by_user_id = subject_id,
      acknowledged_by_user_id_snapshot = subject_id
  where sanction.id = p_sanction_id
    and sanction.subject_user_id_snapshot = subject_id
    and sanction.acknowledgement_required
    and sanction.acknowledged_at is null;

  get diagnostics acknowledged_count = row_count;

  if acknowledged_count <> 1 then
    raise exception using
      errcode = 'P0002',
      message = 'moderation_sanction_not_acknowledgeable';
  end if;

  return true;
end;
$$;

create or replace function public.request_moderation_sanction_review(p_sanction_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  subject_id uuid := auth.uid();
  requested_count integer;
begin
  if auth.role() <> 'authenticated' or subject_id is null then
    raise exception using errcode = '42501', message = 'moderation_authentication_required';
  end if;

  update public.moderation_sanctions sanction
  set review_requested_at = statement_timestamp(),
      review_status = 'pending'
  where sanction.id = p_sanction_id
    and sanction.subject_user_id_snapshot = subject_id
    and sanction.review_requested_at is null
    and sanction.revoked_at is null;

  get diagnostics requested_count = row_count;

  if requested_count <> 1 then
    raise exception using
      errcode = 'P0002',
      message = 'moderation_sanction_review_not_requestable';
  end if;

  return true;
end;
$$;

create or replace function moderation_action_private.require_sanction_actor(
  p_sanction_type text,
  p_operation text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_sanction_type = 'ban' then
    return moderation_action_private.require_actor(
      case when p_operation = 'issue' then 'ban_user' else 'unban_user' end
    );
  end if;

  if p_sanction_type = 'warning' then
    return moderation_action_private.require_actor('issue_warning');
  end if;

  if p_sanction_type = 'strike' then
    return moderation_action_private.require_actor('issue_standard_strike');
  end if;

  raise exception using errcode = '22023', message = 'moderation_sanction_type_is_invalid';
end;
$$;

alter function moderation_action_private.require_sanction_actor(text, text) owner to postgres;
revoke all on function moderation_action_private.require_sanction_actor(text, text)
  from public, anon, authenticated, service_role;

create or replace function moderation_action_private.assert_auth_ban_cleared(
  p_subject_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_banned_until timestamptz;
begin
  select account.banned_until
  into auth_banned_until
  from auth.users account
  where account.id = p_subject_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'moderation_subject_not_found';
  end if;

  if auth_banned_until is not null and auth_banned_until > statement_timestamp() then
    raise exception using
      errcode = '55000',
      message = 'moderation_auth_ban_must_be_cleared_first';
  end if;
end;
$$;

alter function moderation_action_private.assert_auth_ban_cleared(uuid) owner to postgres;
revoke all on function moderation_action_private.assert_auth_ban_cleared(uuid)
  from public, anon, authenticated, service_role;

create or replace function moderation_action_private.clear_ban_projection(
  p_subject_user_id uuid,
  p_changed_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.user_status
  set is_banned = false,
      banned_until = null,
      ban_reason = null,
      updated_at = p_changed_at
  where user_id = p_subject_user_id;
end;
$$;

alter function moderation_action_private.clear_ban_projection(uuid, timestamptz) owner to postgres;
revoke all on function moderation_action_private.clear_ban_projection(uuid, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function public.revoke_moderation_sanction(
  p_sanction_id uuid,
  p_revocation_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  preliminary public.moderation_sanctions%rowtype;
  sanction_row public.moderation_sanctions%rowtype;
  changed_at timestamptz := statement_timestamp();
begin
  if char_length(btrim(coalesce(p_revocation_reason, ''))) not between 10 and 1000 then
    raise exception using errcode = '22023', message = 'moderation_revocation_reason_is_invalid';
  end if;

  select *
  into preliminary
  from public.moderation_sanctions sanction
  where sanction.id = p_sanction_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'moderation_sanction_not_revocable';
  end if;

  actor_role := moderation_action_private.require_sanction_actor(
    preliminary.sanction_type,
    'revoke'
  );
  perform moderation_action_private.assert_subject(
    preliminary.subject_user_id_snapshot, actor_role, actor_id
  );

  select *
  into sanction_row
  from public.moderation_sanctions sanction
  where sanction.id = p_sanction_id
  for update;

  if not found
    or sanction_row.sanction_type is distinct from preliminary.sanction_type
    or sanction_row.subject_user_id_snapshot is distinct from preliminary.subject_user_id_snapshot
    or sanction_row.revoked_at is not null then
    raise exception using errcode = 'P0002', message = 'moderation_sanction_not_revocable';
  end if;

  if sanction_row.sanction_type = 'ban' then
    perform moderation_action_private.assert_auth_ban_cleared(
      sanction_row.subject_user_id_snapshot
    );
  end if;

  update public.moderation_sanctions
  set revoked_at = changed_at,
      revoked_by_user_id = actor_id,
      revoked_by_user_id_snapshot = actor_id,
      revoked_by_role = actor_role,
      revocation_kind = 'revoked',
      revocation_reason = btrim(p_revocation_reason)
  where id = sanction_row.id;

  if sanction_row.sanction_type = 'ban' then
    perform moderation_action_private.clear_ban_projection(
      sanction_row.subject_user_id_snapshot,
      changed_at
    );
  end if;

  return sanction_row.id;
end;
$$;

create or replace function public.revoke_active_moderation_ban(
  p_subject_user_id uuid,
  p_revocation_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_sanction_id uuid;
begin
  perform moderation_action_private.require_actor('unban_user');

  select sanction.id
  into active_sanction_id
  from public.moderation_sanctions sanction
  where sanction.subject_user_id_snapshot = p_subject_user_id
    and sanction.sanction_type = 'ban'
    and sanction.revoked_at is null
    and (sanction.expires_at is null or sanction.expires_at > statement_timestamp())
  order by sanction.starts_at desc, sanction.id desc
  limit 1;

  if active_sanction_id is null then
    raise exception using errcode = 'P0002', message = 'moderation_active_ban_not_found';
  end if;

  return public.revoke_moderation_sanction(active_sanction_id, p_revocation_reason);
end;
$$;

create or replace function public.decide_moderation_sanction_review(
  p_sanction_id uuid,
  p_outcome text,
  p_outcome_message text,
  p_private_reason text default null,
  p_revocation_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  preliminary public.moderation_sanctions%rowtype;
  sanction_row public.moderation_sanctions%rowtype;
  changed_at timestamptz := statement_timestamp();
begin
  if p_outcome not in ('upheld', 'overturned')
    or char_length(btrim(coalesce(p_outcome_message, ''))) not between 10 and 2000
    or (p_private_reason is not null and char_length(btrim(p_private_reason)) not between 1 and 2000)
    or (
      p_outcome = 'overturned'
      and char_length(btrim(coalesce(p_revocation_reason, ''))) not between 10 and 1000
    ) then
    raise exception using errcode = '22023', message = 'moderation_review_input_is_invalid';
  end if;

  select *
  into preliminary
  from public.moderation_sanctions sanction
  where sanction.id = p_sanction_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'moderation_review_not_decidable';
  end if;

  actor_role := moderation_action_private.require_sanction_actor(
    preliminary.sanction_type,
    case when p_outcome = 'overturned' then 'revoke' else 'issue' end
  );
  perform moderation_action_private.assert_subject(
    preliminary.subject_user_id_snapshot, actor_role, actor_id
  );

  select *
  into sanction_row
  from public.moderation_sanctions sanction
  where sanction.id = p_sanction_id
  for update;

  if not found
    or sanction_row.sanction_type is distinct from preliminary.sanction_type
    or sanction_row.subject_user_id_snapshot is distinct from preliminary.subject_user_id_snapshot
    or sanction_row.review_status is distinct from 'pending'
    or sanction_row.revoked_at is not null then
    raise exception using errcode = 'P0002', message = 'moderation_review_not_decidable';
  end if;

  if p_outcome = 'overturned' and sanction_row.sanction_type = 'ban' then
    perform moderation_action_private.assert_auth_ban_cleared(
      sanction_row.subject_user_id_snapshot
    );
  end if;

  update public.moderation_sanctions
  set review_status = p_outcome,
      reviewed_at = changed_at,
      reviewed_by_user_id = actor_id,
      reviewed_by_user_id_snapshot = actor_id,
      reviewed_by_role = actor_role,
      review_outcome_message = btrim(p_outcome_message),
      review_private_reason = nullif(btrim(p_private_reason), ''),
      revoked_at = case when p_outcome = 'overturned' then changed_at else revoked_at end,
      revoked_by_user_id = case when p_outcome = 'overturned' then actor_id else revoked_by_user_id end,
      revoked_by_user_id_snapshot = case when p_outcome = 'overturned' then actor_id else revoked_by_user_id_snapshot end,
      revoked_by_role = case when p_outcome = 'overturned' then actor_role else revoked_by_role end,
      revocation_kind = case when p_outcome = 'overturned' then 'overturned' else revocation_kind end,
      revocation_reason = case
        when p_outcome = 'overturned' then btrim(p_revocation_reason)
        else revocation_reason
      end
  where id = sanction_row.id;

  if p_outcome = 'overturned' and sanction_row.sanction_type = 'ban' then
    perform moderation_action_private.clear_ban_projection(
      sanction_row.subject_user_id_snapshot,
      changed_at
    );
  end if;

  return sanction_row.id;
end;
$$;

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
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  replacement_role text;
  preliminary public.moderation_sanctions%rowtype;
  original public.moderation_sanctions%rowtype;
  replacement_id uuid;
  replacement_expiry timestamptz := p_expires_at;
  replacement_restrictions jsonb := coalesce(p_restrictions, '{}'::jsonb);
  changed_at timestamptz := statement_timestamp();
begin
  if p_replacement_type not in ('warning', 'strike', 'ban')
    or p_severity not in ('low', 'medium', 'high', 'critical')
    or char_length(btrim(coalesce(p_outcome_message, ''))) not between 10 and 2000
    or char_length(btrim(coalesce(p_revocation_reason, ''))) not between 10 and 1000
    or (p_private_reason is not null and char_length(btrim(p_private_reason)) not between 1 and 2000)
    or (
      p_replacement_type = 'strike'
      and p_strike_points not between 1 and 3
    )
    or (p_replacement_type <> 'strike' and p_strike_points is not null)
    or (p_replacement_type <> 'ban' and p_expires_at is not null and p_expires_at <= changed_at)
    or (p_replacement_type = 'ban' and p_severity not in ('high', 'critical')) then
    raise exception using errcode = '22023', message = 'moderation_replacement_input_is_invalid';
  end if;

  perform moderation_action_private.validate_common_inputs(
    p_reason_code, p_user_message, p_internal_note, p_restrictions,
    p_related_resource_type, p_related_resource_id, p_request_id
  );

  select *
  into preliminary
  from public.moderation_sanctions sanction
  where sanction.id = p_sanction_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'moderation_review_not_modifiable';
  end if;

  actor_role := moderation_action_private.require_sanction_actor(
    preliminary.sanction_type,
    'revoke'
  );
  replacement_role := moderation_action_private.require_sanction_actor(
    p_replacement_type,
    'issue'
  );

  if replacement_role is distinct from actor_role then
    raise exception using errcode = '42501', message = 'moderation_replacement_role_mismatch';
  end if;
  perform moderation_action_private.assert_subject(
    preliminary.subject_user_id_snapshot, actor_role, actor_id
  );

  select *
  into original
  from public.moderation_sanctions sanction
  where sanction.id = p_sanction_id
  for update;

  if not found
    or original.sanction_type is distinct from preliminary.sanction_type
    or original.subject_user_id_snapshot is distinct from preliminary.subject_user_id_snapshot
    or original.review_status is distinct from 'pending'
    or original.revoked_at is not null
    or original.replacement_sanction_id is not null then
    raise exception using errcode = 'P0002', message = 'moderation_review_not_modifiable';
  end if;

  if p_replacement_type = 'ban' then
    select account.banned_until
    into replacement_expiry
    from auth.users account
    where account.id = original.subject_user_id_snapshot
    for update;

    if replacement_expiry is null or replacement_expiry <= changed_at then
      raise exception using
        errcode = '55000',
        message = 'moderation_auth_ban_must_be_applied_first';
    end if;

    replacement_restrictions := replacement_restrictions
      || jsonb_build_object('account_access', 'blocked');
  elsif original.sanction_type = 'ban' then
    perform moderation_action_private.assert_auth_ban_cleared(
      original.subject_user_id_snapshot
    );
  end if;

  insert into public.moderation_sanctions (
    subject_user_id, subject_user_id_snapshot,
    issued_by_user_id, issued_by_user_id_snapshot, issued_by_role,
    source_report_id, sanction_type, severity, reason_code, user_message,
    internal_note, strike_points, restrictions, related_resource_type,
    related_resource_id, supersedes_sanction_id, starts_at, expires_at,
    acknowledgement_required, metadata
  ) values (
    original.subject_user_id, original.subject_user_id_snapshot,
    actor_id, actor_id, actor_role,
    original.source_report_id, p_replacement_type, p_severity,
    p_reason_code, btrim(p_user_message), nullif(btrim(p_internal_note), ''),
    p_strike_points, replacement_restrictions, p_related_resource_type,
    p_related_resource_id, original.id, changed_at, replacement_expiry,
    coalesce(p_acknowledgement_required, true),
    jsonb_strip_nulls(jsonb_build_object(
      'request_id', nullif(btrim(p_request_id), ''),
      'review_replacement_for', original.id
    ))
  ) returning id into replacement_id;

  update public.moderation_sanctions
  set review_status = 'modified',
      reviewed_at = changed_at,
      reviewed_by_user_id = actor_id,
      reviewed_by_user_id_snapshot = actor_id,
      reviewed_by_role = actor_role,
      replacement_sanction_id = replacement_id,
      review_outcome_message = btrim(p_outcome_message),
      review_private_reason = nullif(btrim(p_private_reason), ''),
      revoked_at = changed_at,
      revoked_by_user_id = actor_id,
      revoked_by_user_id_snapshot = actor_id,
      revoked_by_role = actor_role,
      revocation_kind = 'revoked',
      revocation_reason = btrim(p_revocation_reason)
  where id = original.id;

  if p_replacement_type = 'ban' then
    insert into public.user_status (
      user_id, is_banned, banned_until, ban_reason, created_at, updated_at
    ) values (
      original.subject_user_id_snapshot, true, replacement_expiry,
      btrim(p_user_message), changed_at, changed_at
    )
    on conflict (user_id) do update
    set is_banned = true,
        banned_until = excluded.banned_until,
        ban_reason = excluded.ban_reason,
        updated_at = excluded.updated_at;
  elsif original.sanction_type = 'ban' then
    perform moderation_action_private.clear_ban_projection(
      original.subject_user_id_snapshot,
      changed_at
    );
  end if;

  return replacement_id;
end;
$$;

alter function public.issue_moderation_warning(
  uuid, text, text, text, text, uuid, jsonb, text, uuid, timestamptz, boolean, text
) owner to postgres;
alter function public.issue_moderation_strike(
  uuid, text, text, text, smallint, text, uuid, jsonb, text, uuid, timestamptz, boolean, text
) owner to postgres;
alter function public.issue_moderation_ban(
  uuid, text, text, text, text, uuid, text, uuid, text
) owner to postgres;
alter function public.acknowledge_moderation_sanction(uuid) owner to postgres;
alter function public.request_moderation_sanction_review(uuid) owner to postgres;
alter function public.revoke_moderation_sanction(uuid, text) owner to postgres;
alter function public.revoke_active_moderation_ban(uuid, text) owner to postgres;
alter function public.decide_moderation_sanction_review(uuid, text, text, text, text)
  owner to postgres;
alter function public.modify_moderation_sanction_review(
  uuid, text, text, text, text, text, text, smallint, text, jsonb, text, uuid,
  timestamptz, boolean, text, text
) owner to postgres;

revoke all on function public.issue_moderation_warning(
  uuid, text, text, text, text, uuid, jsonb, text, uuid, timestamptz, boolean, text
) from public, anon, authenticated, service_role;
revoke all on function public.issue_moderation_strike(
  uuid, text, text, text, smallint, text, uuid, jsonb, text, uuid, timestamptz, boolean, text
) from public, anon, authenticated, service_role;
revoke all on function public.issue_moderation_ban(
  uuid, text, text, text, text, uuid, text, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function public.acknowledge_moderation_sanction(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.request_moderation_sanction_review(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.revoke_moderation_sanction(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.revoke_active_moderation_ban(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.decide_moderation_sanction_review(uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.modify_moderation_sanction_review(
  uuid, text, text, text, text, text, text, smallint, text, jsonb, text, uuid,
  timestamptz, boolean, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.issue_moderation_warning(
  uuid, text, text, text, text, uuid, jsonb, text, uuid, timestamptz, boolean, text
) to authenticated;
grant execute on function public.issue_moderation_strike(
  uuid, text, text, text, smallint, text, uuid, jsonb, text, uuid, timestamptz, boolean, text
) to authenticated;
grant execute on function public.issue_moderation_ban(
  uuid, text, text, text, text, uuid, text, uuid, text
) to authenticated;
grant execute on function public.acknowledge_moderation_sanction(uuid)
  to authenticated;
grant execute on function public.request_moderation_sanction_review(uuid)
  to authenticated;
grant execute on function public.revoke_moderation_sanction(uuid, text)
  to authenticated;
grant execute on function public.revoke_active_moderation_ban(uuid, text)
  to authenticated;
grant execute on function public.decide_moderation_sanction_review(uuid, text, text, text, text)
  to authenticated;
grant execute on function public.modify_moderation_sanction_review(
  uuid, text, text, text, text, text, text, smallint, text, jsonb, text, uuid,
  timestamptz, boolean, text, text
) to authenticated;

-- The public RPC surface now owns every sanction, audit, and current-state
-- mutation. service_role retains read access for server-rendered admin views,
-- but broad direct writes are removed so routes cannot bypass actor checks or
-- lifecycle invariants.
revoke insert, update, delete, truncate
  on table public.moderation_sanctions from service_role;
revoke insert, update, delete, truncate
  on table public.user_status from service_role;
revoke insert, update, delete, truncate
  on table public.moderation_audit_events from service_role;

comment on schema moderation_action_private is
  'Non-exposed helpers for trusted moderation action RPCs.';
comment on function public.issue_moderation_ban(uuid, text, text, text, text, uuid, text, uuid, text) is
  'Records a durable admin-issued ban and user_status projection only after Auth already reflects the ban.';
comment on function public.revoke_active_moderation_ban(uuid, text) is
  'Revokes the active durable ban and clears user_status only after Auth already reflects the unban.';
comment on function public.modify_moderation_sanction_review(
  uuid, text, text, text, text, text, text, smallint, text, jsonb, text, uuid,
  timestamptz, boolean, text, text
) is
  'Atomically creates a replacement sanction and finalizes the original pending review as modified.';

-- Replace the legacy service-only listing decision RPC that accepted a
-- caller-supplied moderator UUID.  This guard runs before the existing listing
-- integrity trigger, proves the live actor and exact transition, then scopes
-- the legacy service-role bypass to this single validated statement.
create or replace function moderation_action_private.allow_listing_moderation_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  claims jsonb := auth.jwt();
  integrity_context text := coalesce(
    current_setting('app.listing_integrity_context', true),
    ''
  );
begin
  if integrity_context not in (
    'trusted_moderation_decision',
    'trusted_report_listing_removal'
  ) then
    return new;
  end if;

  if integrity_context = 'trusted_report_listing_removal' then
    perform moderation_action_private.require_actor('decide_reports');
  end if;
  perform moderation_action_private.require_actor('decide_listings');

  if actor_id is null
    or old.retired_at is not null
    or new.slug is distinct from old.slug
    or new.title is distinct from old.title
    or new.description is distinct from old.description
    or new.price is distinct from old.price
    or new.previous_price is distinct from old.previous_price
    or new.category is distinct from old.category
    or new.condition is distinct from old.condition
    or new.location is distinct from old.location
    or new.is_negotiable is distinct from old.is_negotiable
    or new.seller_id is distinct from old.seller_id
    or new.content_revision is distinct from old.content_revision
    or new.retired_at is distinct from old.retired_at
    or new.submitted_for_review_at is distinct from old.submitted_for_review_at
    or new.moderation_reviewed_by is distinct from actor_id
    or new.moderation_reviewed_at is null
    or (
      integrity_context = 'trusted_moderation_decision'
      and (
        old.status <> 'inactive'
        or old.submitted_for_review_at is null
        or new.status not in ('active', 'rejected')
        or (new.status = 'active' and new.moderation_feedback is not null)
        or (
          new.status = 'rejected'
          and char_length(btrim(coalesce(new.moderation_feedback, ''))) not between 1 and 3000
        )
      )
    )
    or (
      integrity_context = 'trusted_report_listing_removal'
      and (
        old.status <> 'active'
        or new.status <> 'inactive'
        or char_length(btrim(coalesce(new.moderation_feedback, ''))) not between 10 and 3000
      )
    ) then
    raise exception using
      errcode = '42501',
      message = 'listing_moderation_transition_is_invalid';
  end if;

  perform set_config(
    'request.jwt.claims',
    (coalesce(claims, '{}'::jsonb) || jsonb_build_object('role', 'service_role'))::text,
    true
  );

  return new;
end;
$$;

alter function moderation_action_private.allow_listing_moderation_update() owner to postgres;
revoke all on function moderation_action_private.allow_listing_moderation_update()
  from public, anon, authenticated, service_role;

drop trigger if exists allow_trusted_listing_moderation_update on public.listings;
create trigger allow_trusted_listing_moderation_update
  before update on public.listings
  for each row execute function moderation_action_private.allow_listing_moderation_update();

drop function if exists public.decide_listing_moderation(
  uuid, bigint, timestamptz, text, text, uuid
);

create function public.decide_listing_moderation(
  p_listing_id uuid,
  p_expected_content_revision bigint,
  p_expected_submitted_for_review_at timestamptz,
  p_action text,
  p_feedback text
)
returns public.listings
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  listing_row public.listings%rowtype;
begin
  perform moderation_action_private.require_actor('decide_listings');

  if p_action not in ('approved', 'rejected') then
    raise exception using errcode = '22023', message = 'listing_moderation_action_not_supported';
  end if;

  if p_action = 'rejected'
    and char_length(btrim(coalesce(p_feedback, ''))) not between 1 and 3000 then
    raise exception using errcode = '22023', message = 'listing_rejection_feedback_required';
  end if;

  select *
  into listing_row
  from public.listings
  where id = p_listing_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'listing_not_found';
  end if;

  if listing_row.retired_at is not null
    or listing_row.content_revision is distinct from p_expected_content_revision
    or listing_row.submitted_for_review_at is distinct from p_expected_submitted_for_review_at
    or listing_row.status <> 'inactive'
    or listing_row.submitted_for_review_at is null
    or (
      listing_row.moderation_reviewed_at is not null
      and listing_row.submitted_for_review_at <= listing_row.moderation_reviewed_at
    ) then
    raise exception using errcode = '40001', message = 'listing_review_revision_conflict';
  end if;

  perform set_config('app.listing_integrity_context', 'trusted_moderation_decision', true);

  update public.listings
  set status = case when p_action = 'approved' then 'active' else 'rejected' end,
      moderation_feedback = case
        when p_action = 'rejected' then btrim(p_feedback)
        else null
      end,
      moderation_reviewed_at = statement_timestamp(),
      moderation_reviewed_by = actor_id
  where id = p_listing_id
  returning * into listing_row;

  return listing_row;
end;
$$;

alter function public.decide_listing_moderation(uuid, bigint, timestamptz, text, text)
  owner to postgres;
revoke all on function public.decide_listing_moderation(uuid, bigint, timestamptz, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.decide_listing_moderation(uuid, bigint, timestamptz, text, text)
  to authenticated;

comment on function public.decide_listing_moderation(uuid, bigint, timestamptz, text, text) is
  'Revision-safe listing decision attributed exclusively to the current authenticated admin or moderator.';

create or replace function moderation_action_private.report_binding(
  p_subject_type text,
  p_subject_id uuid,
  p_listing_id uuid,
  p_message_id uuid,
  p_reported_user_id uuid
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when p_subject_type = 'listing'
      and coalesce(p_subject_id, p_listing_id) is not null
      and (p_subject_id is null or p_listing_id is null or p_subject_id = p_listing_id)
      then 'listing:' || coalesce(p_subject_id, p_listing_id)::text
    when p_subject_type = 'message'
      and coalesce(p_subject_id, p_message_id) is not null
      and (p_subject_id is null or p_message_id is null or p_subject_id = p_message_id)
      then 'message:' || coalesce(p_subject_id, p_message_id)::text
    when p_subject_type = 'profile'
      and coalesce(p_subject_id, p_reported_user_id) is not null
      and (
        p_subject_id is null
        or p_reported_user_id is null
        or p_subject_id = p_reported_user_id
      )
      then 'profile:' || coalesce(p_subject_id, p_reported_user_id)::text
    else null
  end;
$$;

alter function moderation_action_private.report_binding(text, uuid, uuid, uuid, uuid)
  owner to postgres;
revoke all on function moderation_action_private.report_binding(text, uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function moderation_action_private.validate_report_id_set(
  p_report_ids uuid[]
)
returns integer
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  report_count integer := coalesce(cardinality(p_report_ids), 0);
  distinct_count integer;
begin
  if report_count < 1 or report_count > 100 or array_position(p_report_ids, null) is not null then
    raise exception using errcode = '22023', message = 'moderation_report_set_is_invalid';
  end if;

  select count(distinct report_id)
  into distinct_count
  from unnest(p_report_ids) report_id;

  if distinct_count <> report_count then
    raise exception using errcode = '22023', message = 'moderation_report_set_is_invalid';
  end if;

  return report_count;
end;
$$;

alter function moderation_action_private.validate_report_id_set(uuid[]) owner to postgres;
revoke all on function moderation_action_private.validate_report_id_set(uuid[])
  from public, anon, authenticated, service_role;

create or replace function public.decide_report_set(
  p_report_ids uuid[],
  p_status text,
  p_request_id text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  expected_count integer;
  selected_count integer;
  open_count integer;
  bound_count integer;
  binding_count integer;
  report_subject_type text;
  report_target_id uuid;
  reported_user_id uuid;
  changed_count integer;
  decided_at timestamptz := statement_timestamp();
begin
  actor_role := moderation_action_private.require_actor('decide_reports');
  expected_count := moderation_action_private.validate_report_id_set(p_report_ids);

  if p_status not in ('resolved', 'dismissed')
    or (p_request_id is not null and char_length(btrim(p_request_id)) not between 1 and 200) then
    raise exception using errcode = '22023', message = 'moderation_report_decision_is_invalid';
  end if;

  perform 1
  from public.reports report
  where report.id = any (p_report_ids)
  for update;

  select
    count(*),
    count(*) filter (where report.status = 'open'),
    count(moderation_action_private.report_binding(
      report.subject_type,
      report.subject_id,
      report.listing_id,
      report.message_id,
      report.reported_user_id
    )),
    count(distinct moderation_action_private.report_binding(
      report.subject_type,
      report.subject_id,
      report.listing_id,
      report.message_id,
      report.reported_user_id
    )),
    min(report.subject_type),
    (array_agg(
      coalesce(report.subject_id, report.listing_id, report.message_id, report.reported_user_id)
      order by report.id
    ))[1],
    case
      when count(distinct report.reported_user_id) = 1
        then (array_agg(report.reported_user_id order by report.id))[1]
      else null
    end
  into
    selected_count,
    open_count,
    bound_count,
    binding_count,
    report_subject_type,
    report_target_id,
    reported_user_id
  from public.reports report
  where report.id = any (p_report_ids);

  if selected_count <> expected_count
    or open_count <> expected_count
    or bound_count <> expected_count
    or binding_count <> 1 then
    raise exception using errcode = '40001', message = 'moderation_report_set_conflict';
  end if;

  update public.reports report
  set status = p_status,
      reviewed_by = actor_id,
      reviewed_at = decided_at
  where report.id = any (p_report_ids)
    and report.status = 'open';

  get diagnostics changed_count = row_count;
  if changed_count <> expected_count then
    raise exception using errcode = '40001', message = 'moderation_report_set_conflict';
  end if;

  insert into public.moderation_audit_events (
    event_type,
    actor_user_id,
    actor_user_id_snapshot,
    actor_role,
    subject_user_id,
    subject_user_id_snapshot,
    source_report_id,
    resource_type,
    resource_id,
    summary,
    metadata,
    request_id,
    occurred_at
  ) values (
    'reports.decided',
    actor_id,
    actor_id,
    actor_role,
    reported_user_id,
    reported_user_id,
    p_report_ids[1],
    report_subject_type,
    report_target_id,
    'Open reports were decided atomically.',
    jsonb_build_object('report_ids', to_jsonb(p_report_ids), 'status', p_status),
    nullif(btrim(p_request_id), ''),
    decided_at
  );

  return changed_count;
end;
$$;

create or replace function public.remove_reported_listing(
  p_report_ids uuid[],
  p_listing_id uuid,
  p_request_id text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  expected_count integer;
  selected_count integer;
  open_count integer;
  matching_count integer;
  changed_count integer;
  listing_row public.listings%rowtype;
  decided_at timestamptz := statement_timestamp();
begin
  actor_role := moderation_action_private.require_actor('decide_reports');
  perform moderation_action_private.require_actor('decide_listings');
  expected_count := moderation_action_private.validate_report_id_set(p_report_ids);

  if p_listing_id is null
    or (p_request_id is not null and char_length(btrim(p_request_id)) not between 1 and 200) then
    raise exception using errcode = '22023', message = 'moderation_listing_removal_is_invalid';
  end if;

  perform 1
  from public.reports report
  where report.id = any (p_report_ids)
  for update;

  select
    count(*),
    count(*) filter (where report.status = 'open'),
    count(*) filter (
      where report.subject_type = 'listing'
        and coalesce(report.subject_id, report.listing_id) = p_listing_id
        and (
          report.subject_id is null
          or report.listing_id is null
          or report.subject_id = report.listing_id
        )
    )
  into selected_count, open_count, matching_count
  from public.reports report
  where report.id = any (p_report_ids);

  if selected_count <> expected_count
    or open_count <> expected_count
    or matching_count <> expected_count then
    raise exception using errcode = '40001', message = 'moderation_report_set_conflict';
  end if;

  select *
  into listing_row
  from public.listings listing
  where listing.id = p_listing_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'listing_not_found';
  end if;

  if listing_row.retired_at is not null or listing_row.status <> 'active' then
    raise exception using errcode = '40001', message = 'moderation_listing_removal_conflict';
  end if;

  perform set_config('app.listing_integrity_context', 'trusted_report_listing_removal', true);

  update public.listings
  set status = 'inactive',
      moderation_feedback = 'Removed after review of user reports.',
      moderation_reviewed_at = decided_at,
      moderation_reviewed_by = actor_id
  where id = p_listing_id;

  perform set_config('app.listing_integrity_context', '', true);

  update public.reports report
  set status = 'resolved',
      reviewed_by = actor_id,
      reviewed_at = decided_at
  where report.id = any (p_report_ids)
    and report.status = 'open';

  get diagnostics changed_count = row_count;
  if changed_count <> expected_count then
    raise exception using errcode = '40001', message = 'moderation_report_set_conflict';
  end if;

  insert into public.moderation_audit_events (
    event_type,
    actor_user_id,
    actor_user_id_snapshot,
    actor_role,
    subject_user_id,
    subject_user_id_snapshot,
    source_report_id,
    resource_type,
    resource_id,
    summary,
    metadata,
    request_id,
    occurred_at
  ) values (
    'listing.removed_after_reports',
    actor_id,
    actor_id,
    actor_role,
    listing_row.seller_id,
    listing_row.seller_id,
    p_report_ids[1],
    'listing',
    listing_row.id,
    'Reported listing was removed and its reports were resolved atomically.',
    jsonb_build_object(
      'report_ids', to_jsonb(p_report_ids),
      'previous_status', listing_row.status,
      'content_revision', listing_row.content_revision
    ),
    nullif(btrim(p_request_id), ''),
    decided_at
  );

  return changed_count;
end;
$$;

alter function public.decide_report_set(uuid[], text, text) owner to postgres;
alter function public.remove_reported_listing(uuid[], uuid, text) owner to postgres;
revoke all on function public.decide_report_set(uuid[], text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.remove_reported_listing(uuid[], uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.decide_report_set(uuid[], text, text)
  to authenticated;
grant execute on function public.remove_reported_listing(uuid[], uuid, text)
  to authenticated;

comment on function public.decide_report_set(uuid[], text, text) is
  'Locks and decides one exact open report subject set with live actor attribution.';
comment on function public.remove_reported_listing(uuid[], uuid, text) is
  'Atomically removes one active reported listing and resolves the exact locked open report set.';

-- Final trust-boundary hardening. The definitions above are built in dependency
-- order, then moved behind a non-USAGE schema before this migration commits.
-- Public callers retain only SECURITY INVOKER, parsed wrappers. This mirrors the
-- proven announcement/conversation boundary and prevents PostgREST from ever
-- exposing a table-owner mutation function.

create or replace function moderation_action_private.resolve_role_from_account(
  p_app_metadata jsonb,
  p_auth_role text
)
returns text
language plpgsql
immutable
security definer
set search_path = ''
as $function$
declare
  candidate text;
begin
  candidate := lower(btrim(coalesce(p_app_metadata ->> 'role', '')));
  if candidate in ('admin', 'moderator', 'staff') then
    return candidate;
  end if;

  if jsonb_typeof(p_app_metadata -> 'roles') = 'array' then
    select lower(btrim(role_value.value))
    into candidate
    from jsonb_array_elements_text(p_app_metadata -> 'roles')
      with ordinality role_value(value, position)
    where lower(btrim(role_value.value)) in ('admin', 'moderator', 'staff')
    order by role_value.position
    limit 1;

    if candidate is not null then
      return candidate;
    end if;
  end if;

  candidate := lower(btrim(coalesce(p_auth_role, '')));
  return case when candidate in ('admin', 'moderator', 'staff') then candidate else null end;
end
$function$;

-- A request id is the durable idempotency key for every newly issued sanction.
-- Keep the original write implementations private, and replay the canonical row
-- when a transport retry presents the same actor/key/payload.
alter function public.issue_moderation_warning(
  uuid,text,text,text,text,uuid,jsonb,text,uuid,timestamptz,boolean,text
) set schema moderation_action_private;
alter function moderation_action_private.issue_moderation_warning(
  uuid,text,text,text,text,uuid,jsonb,text,uuid,timestamptz,boolean,text
) rename to issue_moderation_warning_impl;
alter function public.issue_moderation_strike(
  uuid,text,text,text,smallint,text,uuid,jsonb,text,uuid,timestamptz,boolean,text
) set schema moderation_action_private;
alter function moderation_action_private.issue_moderation_strike(
  uuid,text,text,text,smallint,text,uuid,jsonb,text,uuid,timestamptz,boolean,text
) rename to issue_moderation_strike_impl;
alter function public.issue_moderation_ban(
  uuid,text,text,text,text,uuid,text,uuid,text
) set schema moderation_action_private;
alter function moderation_action_private.issue_moderation_ban(
  uuid,text,text,text,text,uuid,text,uuid,text
) rename to issue_moderation_ban_impl;

create unique index moderation_sanctions_human_request_id_uidx
  on public.moderation_sanctions(
    issued_by_user_id_snapshot,
    (metadata->>'request_id')
  )
  where issued_by_user_id_snapshot is not null
    and nullif(metadata->>'request_id','') is not null;

alter function moderation_action_private.issue_moderation_warning_impl(
  uuid,text,text,text,text,uuid,jsonb,text,uuid,timestamptz,boolean,text
) rename to issue_moderation_warning_write_impl;
alter function moderation_action_private.issue_moderation_strike_impl(
  uuid,text,text,text,smallint,text,uuid,jsonb,text,uuid,timestamptz,boolean,text
) rename to issue_moderation_strike_write_impl;
alter function moderation_action_private.issue_moderation_ban_impl(
  uuid,text,text,text,text,uuid,text,uuid,text
) rename to issue_moderation_ban_write_impl;

revoke all on function moderation_action_private.issue_moderation_warning_write_impl(
  uuid,text,text,text,text,uuid,jsonb,text,uuid,timestamptz,boolean,text
) from public,anon,authenticated,service_role;
revoke all on function moderation_action_private.issue_moderation_strike_write_impl(
  uuid,text,text,text,smallint,text,uuid,jsonb,text,uuid,timestamptz,boolean,text
) from public,anon,authenticated,service_role;
revoke all on function moderation_action_private.issue_moderation_ban_write_impl(
  uuid,text,text,text,text,uuid,text,uuid,text
) from public,anon,authenticated,service_role;

create function moderation_action_private.issue_moderation_warning_impl(
  p_subject_user_id uuid,p_severity text,p_reason_code text,p_user_message text,
  p_internal_note text default null,p_source_report_id uuid default null,
  p_restrictions jsonb default '{}'::jsonb,p_related_resource_type text default null,
  p_related_resource_id uuid default null,p_expires_at timestamptz default null,
  p_acknowledgement_required boolean default true,p_request_id text default null
)
returns uuid language plpgsql security definer set search_path=''
as $function$
declare
  actor_id uuid:=auth.uid(); actor_role text;
  existing public.moderation_sanctions%rowtype; result_id uuid;
begin
  actor_role:=moderation_action_private.require_actor('issue_warning');
  perform moderation_action_private.assert_subject(p_subject_user_id,actor_role,actor_id);
  if char_length(btrim(coalesce(p_request_id,''))) not between 1 and 200 then
    raise exception using errcode='22023',message='moderation_request_id_invalid';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text||':'||btrim(p_request_id),0)
  );
  select * into existing from public.moderation_sanctions sanction
  where sanction.issued_by_user_id_snapshot=actor_id
    and sanction.metadata->>'request_id'=btrim(p_request_id)
  for update;
  if found then
    if existing.subject_user_id_snapshot is distinct from p_subject_user_id
      or existing.sanction_type<>'warning' or existing.severity is distinct from p_severity
      or existing.reason_code is distinct from p_reason_code
      or existing.user_message is distinct from btrim(p_user_message)
      or existing.internal_note is distinct from nullif(btrim(p_internal_note),'')
      or existing.source_report_id is distinct from p_source_report_id
      or existing.restrictions is distinct from coalesce(p_restrictions,'{}'::jsonb)
      or existing.related_resource_type is distinct from p_related_resource_type
      or existing.related_resource_id is distinct from p_related_resource_id
      or existing.expires_at is distinct from p_expires_at
      or existing.acknowledgement_required is distinct from coalesce(p_acknowledgement_required,true) then
      raise exception using errcode='22023',message='moderation_request_id_payload_conflict';
    end if;
    return existing.id;
  end if;
  result_id:=moderation_action_private.issue_moderation_warning_write_impl(
    p_subject_user_id,p_severity,p_reason_code,p_user_message,p_internal_note,
    p_source_report_id,p_restrictions,p_related_resource_type,p_related_resource_id,
    p_expires_at,p_acknowledgement_required,btrim(p_request_id)
  );
  return result_id;
end
$function$;

create function moderation_action_private.issue_moderation_strike_impl(
  p_subject_user_id uuid,p_severity text,p_reason_code text,p_user_message text,
  p_strike_points smallint,p_internal_note text default null,
  p_source_report_id uuid default null,p_restrictions jsonb default '{}'::jsonb,
  p_related_resource_type text default null,p_related_resource_id uuid default null,
  p_expires_at timestamptz default null,p_acknowledgement_required boolean default true,
  p_request_id text default null
)
returns uuid language plpgsql security definer set search_path=''
as $function$
declare
  actor_id uuid:=auth.uid(); actor_role text;
  existing public.moderation_sanctions%rowtype; result_id uuid;
begin
  actor_role:=moderation_action_private.require_actor('issue_standard_strike');
  perform moderation_action_private.assert_subject(p_subject_user_id,actor_role,actor_id);
  if char_length(btrim(coalesce(p_request_id,''))) not between 1 and 200 then
    raise exception using errcode='22023',message='moderation_request_id_invalid';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text||':'||btrim(p_request_id),0)
  );
  select * into existing from public.moderation_sanctions sanction
  where sanction.issued_by_user_id_snapshot=actor_id
    and sanction.metadata->>'request_id'=btrim(p_request_id)
  for update;
  if found then
    if existing.subject_user_id_snapshot is distinct from p_subject_user_id
      or existing.sanction_type<>'strike' or existing.severity is distinct from p_severity
      or existing.reason_code is distinct from p_reason_code
      or existing.user_message is distinct from btrim(p_user_message)
      or existing.strike_points is distinct from p_strike_points
      or existing.internal_note is distinct from nullif(btrim(p_internal_note),'')
      or existing.source_report_id is distinct from p_source_report_id
      or existing.restrictions is distinct from coalesce(p_restrictions,'{}'::jsonb)
      or existing.related_resource_type is distinct from p_related_resource_type
      or existing.related_resource_id is distinct from p_related_resource_id
      or existing.expires_at is distinct from p_expires_at
      or existing.acknowledgement_required is distinct from coalesce(p_acknowledgement_required,true) then
      raise exception using errcode='22023',message='moderation_request_id_payload_conflict';
    end if;
    return existing.id;
  end if;
  result_id:=moderation_action_private.issue_moderation_strike_write_impl(
    p_subject_user_id,p_severity,p_reason_code,p_user_message,p_strike_points,
    p_internal_note,p_source_report_id,p_restrictions,p_related_resource_type,
    p_related_resource_id,p_expires_at,p_acknowledgement_required,btrim(p_request_id)
  );
  return result_id;
end
$function$;

create function moderation_action_private.issue_moderation_ban_impl(
  p_subject_user_id uuid,p_severity text,p_reason_code text,p_user_message text,
  p_internal_note text default null,p_source_report_id uuid default null,
  p_related_resource_type text default null,p_related_resource_id uuid default null,
  p_request_id text default null
)
returns uuid language plpgsql security definer set search_path=''
as $function$
declare
  actor_id uuid:=auth.uid(); actor_role text;
  existing public.moderation_sanctions%rowtype; result_id uuid;
begin
  actor_role:=moderation_action_private.require_actor('ban_user');
  perform moderation_action_private.assert_subject(p_subject_user_id,actor_role,actor_id);
  if char_length(btrim(coalesce(p_request_id,''))) not between 1 and 200 then
    raise exception using errcode='22023',message='moderation_request_id_invalid';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text||':'||btrim(p_request_id),0)
  );
  select * into existing from public.moderation_sanctions sanction
  where sanction.issued_by_user_id_snapshot=actor_id
    and sanction.metadata->>'request_id'=btrim(p_request_id)
  for update;
  if found then
    if existing.subject_user_id_snapshot is distinct from p_subject_user_id
      or existing.sanction_type<>'ban' or existing.severity is distinct from p_severity
      or existing.reason_code is distinct from p_reason_code
      or existing.user_message is distinct from btrim(p_user_message)
      or existing.internal_note is distinct from nullif(btrim(p_internal_note),'')
      or existing.source_report_id is distinct from p_source_report_id
      or existing.related_resource_type is distinct from p_related_resource_type
      or existing.related_resource_id is distinct from p_related_resource_id then
      raise exception using errcode='22023',message='moderation_request_id_payload_conflict';
    end if;
    return existing.id;
  end if;
  result_id:=moderation_action_private.issue_moderation_ban_write_impl(
    p_subject_user_id,p_severity,p_reason_code,p_user_message,p_internal_note,
    p_source_report_id,p_related_resource_type,p_related_resource_id,btrim(p_request_id)
  );
  return result_id;
end
$function$;

alter function moderation_action_private.issue_moderation_warning_impl(
  uuid,text,text,text,text,uuid,jsonb,text,uuid,timestamptz,boolean,text
) owner to postgres;
alter function moderation_action_private.issue_moderation_strike_impl(
  uuid,text,text,text,smallint,text,uuid,jsonb,text,uuid,timestamptz,boolean,text
) owner to postgres;
alter function moderation_action_private.issue_moderation_ban_impl(
  uuid,text,text,text,text,uuid,text,uuid,text
) owner to postgres;
revoke all on function moderation_action_private.issue_moderation_warning_impl(
  uuid,text,text,text,text,uuid,jsonb,text,uuid,timestamptz,boolean,text
) from public,anon,authenticated,service_role;
revoke all on function moderation_action_private.issue_moderation_strike_impl(
  uuid,text,text,text,smallint,text,uuid,jsonb,text,uuid,timestamptz,boolean,text
) from public,anon,authenticated,service_role;
revoke all on function moderation_action_private.issue_moderation_ban_impl(
  uuid,text,text,text,text,uuid,text,uuid,text
) from public,anon,authenticated,service_role;
grant execute on function moderation_action_private.issue_moderation_warning_impl(
  uuid,text,text,text,text,uuid,jsonb,text,uuid,timestamptz,boolean,text
) to authenticated;
grant execute on function moderation_action_private.issue_moderation_strike_impl(
  uuid,text,text,text,smallint,text,uuid,jsonb,text,uuid,timestamptz,boolean,text
) to authenticated;
grant execute on function moderation_action_private.issue_moderation_ban_impl(
  uuid,text,text,text,text,uuid,text,uuid,text
) to authenticated;

create or replace function public.issue_moderation_warning(
  p_subject_user_id uuid,p_severity text,p_reason_code text,p_user_message text,
  p_internal_note text default null,p_source_report_id uuid default null,
  p_restrictions jsonb default '{}'::jsonb,p_related_resource_type text default null,
  p_related_resource_id uuid default null,p_expires_at timestamptz default null,
  p_acknowledgement_required boolean default true,p_request_id text default null
) returns uuid language sql security invoker set search_path=''
begin atomic
  select moderation_action_private.issue_moderation_warning_impl(
    p_subject_user_id,p_severity,p_reason_code,p_user_message,p_internal_note,
    p_source_report_id,p_restrictions,p_related_resource_type,p_related_resource_id,
    p_expires_at,p_acknowledgement_required,p_request_id
  );
end;
create or replace function public.issue_moderation_strike(
  p_subject_user_id uuid,p_severity text,p_reason_code text,p_user_message text,
  p_strike_points smallint,p_internal_note text default null,
  p_source_report_id uuid default null,p_restrictions jsonb default '{}'::jsonb,
  p_related_resource_type text default null,p_related_resource_id uuid default null,
  p_expires_at timestamptz default null,p_acknowledgement_required boolean default true,
  p_request_id text default null
) returns uuid language sql security invoker set search_path=''
begin atomic
  select moderation_action_private.issue_moderation_strike_impl(
    p_subject_user_id,p_severity,p_reason_code,p_user_message,p_strike_points,
    p_internal_note,p_source_report_id,p_restrictions,p_related_resource_type,
    p_related_resource_id,p_expires_at,p_acknowledgement_required,p_request_id
  );
end;
create or replace function public.issue_moderation_ban(
  p_subject_user_id uuid,p_severity text,p_reason_code text,p_user_message text,
  p_internal_note text default null,p_source_report_id uuid default null,
  p_related_resource_type text default null,p_related_resource_id uuid default null,
  p_request_id text default null
) returns uuid language sql security invoker set search_path=''
begin atomic
  select moderation_action_private.issue_moderation_ban_impl(
    p_subject_user_id,p_severity,p_reason_code,p_user_message,p_internal_note,
    p_source_report_id,p_related_resource_type,p_related_resource_id,p_request_id
  );
end;

create function moderation_action_private.audit_sanction_request_id()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  if nullif(new.metadata->>'request_id','') is not null then
    insert into public.moderation_audit_events(
      event_type,actor_user_id,actor_user_id_snapshot,actor_role,
      subject_user_id,subject_user_id_snapshot,sanction_id,source_report_id,
      resource_type,resource_id,summary,metadata,request_id,occurred_at
    ) values(
      'sanction.request_recorded',new.issued_by_user_id,new.issued_by_user_id_snapshot,
      new.issued_by_role,new.subject_user_id,new.subject_user_id_snapshot,new.id,
      new.source_report_id,'user',new.subject_user_id_snapshot,
      'Moderation sanction request id recorded.',
      jsonb_build_object('sanction_type',new.sanction_type),
      new.metadata->>'request_id',new.starts_at
    );
  end if;
  return new;
end
$function$;
alter function moderation_action_private.audit_sanction_request_id() owner to postgres;
revoke all on function moderation_action_private.audit_sanction_request_id()
  from public,anon,authenticated,service_role;
create trigger audit_sanction_request_id after insert on public.moderation_sanctions
for each row execute function moderation_action_private.audit_sanction_request_id();

-- Database-only moderation commands are committed atomically, but the client
-- can still lose the HTTP response. Persist their canonical payload/result so
-- an exact operation-id retry replays instead of failing a later revision check.
create table moderation_action_private.moderation_command_results(
  id uuid primary key default gen_random_uuid(),
  actor_user_id_snapshot uuid not null,
  action text not null check(action in (
    'listing_decision','report_set_decision','reported_listing_removal'
  )),
  request_id text not null,
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  result jsonb not null,
  completed_at timestamptz not null default now(),
  unique(actor_user_id_snapshot,action,request_id)
);
revoke all on table moderation_action_private.moderation_command_results
  from public,anon,authenticated,service_role;

-- The six-argument listing writer is defined later in dependency order. This
-- private placeholder gives the replay wrapper a stable OID and is replaced by
-- the full writer before the migration commits.
create function moderation_action_private.decide_listing_moderation_write_impl(
  uuid,bigint,timestamptz,text,text,text
) returns public.listings language plpgsql security definer set search_path=''
as $function$
begin
  raise exception using errcode='55000',message='listing_moderation_writer_not_ready';
end
$function$;
alter function public.decide_report_set(uuid[],text,text)
  set schema moderation_action_private;
alter function moderation_action_private.decide_report_set(uuid[],text,text)
  rename to decide_report_set_write_impl;
alter function public.remove_reported_listing(uuid[],uuid,text)
  set schema moderation_action_private;
alter function moderation_action_private.remove_reported_listing(uuid[],uuid,text)
  rename to remove_reported_listing_write_impl;
revoke all on function moderation_action_private.decide_listing_moderation_write_impl(
  uuid,bigint,timestamptz,text,text,text
) from public,anon,authenticated,service_role;
revoke all on function moderation_action_private.decide_report_set_write_impl(uuid[],text,text)
  from public,anon,authenticated,service_role;
revoke all on function moderation_action_private.remove_reported_listing_write_impl(uuid[],uuid,text)
  from public,anon,authenticated,service_role;

create function moderation_action_private.decide_listing_moderation_impl(
  p_listing_id uuid,p_expected_content_revision bigint,
  p_expected_submitted_for_review_at timestamptz,p_action text,p_feedback text,
  p_request_id text
)
returns public.listings language plpgsql security definer set search_path=''
as $function$
declare
  actor_id uuid:=auth.uid(); command_payload jsonb;
  existing moderation_action_private.moderation_command_results%rowtype;
  result_row public.listings%rowtype;
begin
  perform moderation_action_private.require_actor('decide_listings');
  if char_length(btrim(coalesce(p_request_id,''))) not between 1 and 200 then
    raise exception using errcode='22023',message='moderation_request_id_invalid';
  end if;
  command_payload:=jsonb_build_object(
    'listing_id',p_listing_id,'expected_content_revision',p_expected_content_revision,
    'expected_submitted_for_review_at',p_expected_submitted_for_review_at,
    'action',p_action,'feedback',p_feedback
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text||':listing_decision:'||btrim(p_request_id),0)
  );
  select * into existing from moderation_action_private.moderation_command_results command
  where command.actor_user_id_snapshot=actor_id and command.action='listing_decision'
    and command.request_id=btrim(p_request_id) for update;
  if found then
    if existing.payload is distinct from command_payload then
      raise exception using errcode='22023',message='moderation_request_id_payload_conflict';
    end if;
    select * into result_row from jsonb_populate_record(null::public.listings,existing.result);
    return result_row;
  end if;
  result_row:=moderation_action_private.decide_listing_moderation_write_impl(
    p_listing_id,p_expected_content_revision,p_expected_submitted_for_review_at,
    p_action,p_feedback,btrim(p_request_id)
  );
  insert into moderation_action_private.moderation_command_results(
    actor_user_id_snapshot,action,request_id,payload,result
  ) values(actor_id,'listing_decision',btrim(p_request_id),command_payload,to_jsonb(result_row));
  return result_row;
end
$function$;

create function moderation_action_private.decide_report_set_impl(
  p_report_ids uuid[],p_status text,p_request_id text
)
returns integer language plpgsql security definer set search_path=''
as $function$
declare
  actor_id uuid:=auth.uid(); command_payload jsonb;
  existing moderation_action_private.moderation_command_results%rowtype;
  result_count integer; normalized_ids uuid[];
begin
  perform moderation_action_private.require_actor('decide_reports');
  if char_length(btrim(coalesce(p_request_id,''))) not between 1 and 200 then
    raise exception using errcode='22023',message='moderation_request_id_invalid';
  end if;
  select array_agg(report_id order by report_id) into normalized_ids from unnest(p_report_ids) report_id;
  command_payload:=jsonb_build_object('report_ids',normalized_ids,'status',p_status);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text||':report_set_decision:'||btrim(p_request_id),0)
  );
  select * into existing from moderation_action_private.moderation_command_results command
  where command.actor_user_id_snapshot=actor_id and command.action='report_set_decision'
    and command.request_id=btrim(p_request_id) for update;
  if found then
    if existing.payload is distinct from command_payload then
      raise exception using errcode='22023',message='moderation_request_id_payload_conflict';
    end if;
    return (existing.result->>'updated_count')::integer;
  end if;
  result_count:=moderation_action_private.decide_report_set_write_impl(
    normalized_ids,p_status,btrim(p_request_id)
  );
  insert into moderation_action_private.moderation_command_results(
    actor_user_id_snapshot,action,request_id,payload,result
  ) values(actor_id,'report_set_decision',btrim(p_request_id),command_payload,
    jsonb_build_object('updated_count',result_count));
  return result_count;
end
$function$;

create function moderation_action_private.remove_reported_listing_impl(
  p_report_ids uuid[],p_listing_id uuid,p_request_id text
)
returns integer language plpgsql security definer set search_path=''
as $function$
declare
  actor_id uuid:=auth.uid(); command_payload jsonb;
  existing moderation_action_private.moderation_command_results%rowtype;
  result_count integer; normalized_ids uuid[];
begin
  perform moderation_action_private.require_actor('decide_reports');
  perform moderation_action_private.require_actor('decide_listings');
  if char_length(btrim(coalesce(p_request_id,''))) not between 1 and 200 then
    raise exception using errcode='22023',message='moderation_request_id_invalid';
  end if;
  select array_agg(report_id order by report_id) into normalized_ids from unnest(p_report_ids) report_id;
  command_payload:=jsonb_build_object('report_ids',normalized_ids,'listing_id',p_listing_id);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text||':reported_listing_removal:'||btrim(p_request_id),0)
  );
  select * into existing from moderation_action_private.moderation_command_results command
  where command.actor_user_id_snapshot=actor_id
    and command.action='reported_listing_removal'
    and command.request_id=btrim(p_request_id) for update;
  if found then
    if existing.payload is distinct from command_payload then
      raise exception using errcode='22023',message='moderation_request_id_payload_conflict';
    end if;
    return (existing.result->>'updated_count')::integer;
  end if;
  result_count:=moderation_action_private.remove_reported_listing_write_impl(
    normalized_ids,p_listing_id,btrim(p_request_id)
  );
  insert into moderation_action_private.moderation_command_results(
    actor_user_id_snapshot,action,request_id,payload,result
  ) values(actor_id,'reported_listing_removal',btrim(p_request_id),command_payload,
    jsonb_build_object('updated_count',result_count));
  return result_count;
end
$function$;

alter function moderation_action_private.decide_listing_moderation_write_impl(
  uuid,bigint,timestamptz,text,text,text
) owner to postgres;
alter function moderation_action_private.decide_listing_moderation_impl(
  uuid,bigint,timestamptz,text,text,text
) owner to postgres;
alter function moderation_action_private.decide_report_set_impl(uuid[],text,text) owner to postgres;
alter function moderation_action_private.remove_reported_listing_impl(uuid[],uuid,text) owner to postgres;
revoke all on function moderation_action_private.decide_listing_moderation_impl(
  uuid,bigint,timestamptz,text,text,text
) from public,anon,authenticated,service_role;
revoke all on function moderation_action_private.decide_report_set_impl(uuid[],text,text)
  from public,anon,authenticated,service_role;
revoke all on function moderation_action_private.remove_reported_listing_impl(uuid[],uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function moderation_action_private.decide_listing_moderation_impl(
  uuid,bigint,timestamptz,text,text,text
) to authenticated;
grant execute on function moderation_action_private.decide_report_set_impl(uuid[],text,text)
  to authenticated;
grant execute on function moderation_action_private.remove_reported_listing_impl(uuid[],uuid,text)
  to authenticated;

create or replace function public.decide_listing_moderation(
  p_listing_id uuid,p_expected_content_revision bigint,
  p_expected_submitted_for_review_at timestamptz,p_action text,p_feedback text,
  p_request_id text
) returns public.listings language sql security invoker set search_path=''
begin atomic
  select moderation_action_private.decide_listing_moderation_impl(
    p_listing_id,p_expected_content_revision,p_expected_submitted_for_review_at,
    p_action,p_feedback,p_request_id
  );
end;
create or replace function public.decide_report_set(
  p_report_ids uuid[],p_status text,p_request_id text default null
) returns integer language sql security invoker set search_path=''
begin atomic
  select moderation_action_private.decide_report_set_impl(p_report_ids,p_status,p_request_id);
end;
create or replace function public.remove_reported_listing(
  p_report_ids uuid[],p_listing_id uuid,p_request_id text default null
) returns integer language sql security invoker set search_path=''
begin atomic
  select moderation_action_private.remove_reported_listing_impl(
    p_report_ids,p_listing_id,p_request_id
  );
end;

create or replace function moderation_action_private.assert_listing_moderation_scope_origin()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  integrity_context text := coalesce(current_setting('app.listing_integrity_context', true), '');
begin
  if integrity_context in ('trusted_moderation_decision','trusted_report_listing_removal')
    and current_user <> 'postgres' then
    raise exception using errcode='42501',message='listing_moderation_scope_origin_invalid';
  end if;
  return new;
end
$function$;
alter function moderation_action_private.assert_listing_moderation_scope_origin()
  owner to postgres;
revoke all on function moderation_action_private.assert_listing_moderation_scope_origin()
  from public,anon,authenticated,service_role;
drop trigger if exists a0_assert_listing_moderation_scope_origin on public.listings;
create trigger a0_assert_listing_moderation_scope_origin
  before update on public.listings for each row
  execute function moderation_action_private.assert_listing_moderation_scope_origin();

-- Move every privileged mutation out of the exposed schema. The parsed public
-- wrappers created below have invoker security; callers are granted EXECUTE on
-- the referenced implementation OID but no USAGE on its schema, so they cannot
-- resolve or invoke an implementation directly.
alter function public.acknowledge_moderation_sanction(uuid)
  set schema moderation_action_private;
alter function moderation_action_private.acknowledge_moderation_sanction(uuid)
  rename to acknowledge_moderation_sanction_impl;
alter function public.request_moderation_sanction_review(uuid)
  set schema moderation_action_private;
alter function moderation_action_private.request_moderation_sanction_review(uuid)
  rename to request_moderation_sanction_review_impl;
alter function public.revoke_moderation_sanction(uuid, text)
  set schema moderation_action_private;
alter function moderation_action_private.revoke_moderation_sanction(uuid, text)
  rename to revoke_moderation_sanction_impl;
alter function public.revoke_active_moderation_ban(uuid, text)
  set schema moderation_action_private;
alter function moderation_action_private.revoke_active_moderation_ban(uuid, text)
  rename to revoke_active_moderation_ban_impl;
alter function public.decide_moderation_sanction_review(uuid, text, text, text, text)
  set schema moderation_action_private;
alter function moderation_action_private.decide_moderation_sanction_review(uuid, text, text, text, text)
  rename to decide_moderation_sanction_review_impl;
alter function public.modify_moderation_sanction_review(
  uuid, text, text, text, text, text, text, smallint, text, jsonb, text, uuid,
  timestamptz, boolean, text, text
) set schema moderation_action_private;
alter function moderation_action_private.modify_moderation_sanction_review(
  uuid, text, text, text, text, text, text, smallint, text, jsonb, text, uuid,
  timestamptz, boolean, text, text
) rename to modify_moderation_sanction_review_impl;
alter function public.decide_listing_moderation(uuid, bigint, timestamptz, text, text)
  set schema moderation_action_private;
alter function moderation_action_private.decide_listing_moderation(uuid, bigint, timestamptz, text, text)
  rename to decide_listing_moderation_legacy_impl;

-- The old active-ban helper called the public revocation function by name.
-- Rebind it to the hidden implementation after the schema cutover.
create or replace function moderation_action_private.revoke_active_moderation_ban_impl(
  p_subject_user_id uuid,
  p_revocation_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  active_sanction_id uuid;
begin
  perform moderation_action_private.require_actor('unban_user');
  select sanction.id into active_sanction_id
  from public.moderation_sanctions sanction
  where sanction.subject_user_id_snapshot = p_subject_user_id
    and sanction.sanction_type = 'ban'
    and sanction.revoked_at is null
    and (sanction.expires_at is null or sanction.expires_at > statement_timestamp())
  order by sanction.starts_at desc, sanction.id desc
  limit 1;
  if active_sanction_id is null then
    raise exception using errcode = 'P0002', message = 'moderation_active_ban_not_found';
  end if;
  return moderation_action_private.revoke_moderation_sanction_impl(
    active_sanction_id,
    p_revocation_reason
  );
end
$function$;

-- A listing decision, its readable history row, and its canonical moderation
-- audit event and seller notification are now one transaction. request_id is
-- mandatory for replay-safe retry correlation at the route boundary. The
-- namespace prefix prevents a client operation UUID from colliding with an
-- unrelated notification UUID while keeping retries deterministic.
create or replace function moderation_action_private.listing_decision_notification_id(
  p_actor_id uuid,
  p_request_id text
)
returns uuid
language sql
immutable
security definer
set search_path = ''
as $function$
  select (
    substr(pg_catalog.md5('listing-decision-notification:' || p_actor_id::text || ':' || btrim(p_request_id)), 1, 8)
    || '-' || substr(pg_catalog.md5('listing-decision-notification:' || p_actor_id::text || ':' || btrim(p_request_id)), 9, 4)
    || '-' || substr(pg_catalog.md5('listing-decision-notification:' || p_actor_id::text || ':' || btrim(p_request_id)), 13, 4)
    || '-' || substr(pg_catalog.md5('listing-decision-notification:' || p_actor_id::text || ':' || btrim(p_request_id)), 17, 4)
    || '-' || substr(pg_catalog.md5('listing-decision-notification:' || p_actor_id::text || ':' || btrim(p_request_id)), 21, 12)
  )::uuid
$function$;

alter function moderation_action_private.listing_decision_notification_id(uuid,text)
  owner to postgres;
revoke all on function moderation_action_private.listing_decision_notification_id(uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function moderation_action_private.listing_decision_notification_id(uuid,text)
  to postgres;

create or replace function moderation_action_private.decide_listing_moderation_write_impl(
  p_listing_id uuid,
  p_expected_content_revision bigint,
  p_expected_submitted_for_review_at timestamptz,
  p_action text,
  p_feedback text,
  p_request_id text
)
returns public.listings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  listing_row public.listings%rowtype;
  decided_at timestamptz := statement_timestamp();
  notification_id uuid;
  notification_metadata jsonb;
  expected_notification_type text;
begin
  actor_role := moderation_action_private.require_actor('decide_listings');
  if p_action not in ('approved', 'rejected')
    or char_length(btrim(coalesce(p_request_id, ''))) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'listing_moderation_action_not_supported';
  end if;
  if p_action = 'rejected'
    and char_length(btrim(coalesce(p_feedback, ''))) not between 1 and 3000 then
    raise exception using errcode = '22023', message = 'listing_rejection_feedback_required';
  end if;

  select * into listing_row from public.listings
  where id = p_listing_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'listing_not_found';
  end if;
  if listing_row.retired_at is not null
    or listing_row.content_revision is distinct from p_expected_content_revision
    or listing_row.submitted_for_review_at is distinct from p_expected_submitted_for_review_at
    or listing_row.status <> 'inactive' or listing_row.submitted_for_review_at is null
    or (listing_row.moderation_reviewed_at is not null
      and listing_row.submitted_for_review_at <= listing_row.moderation_reviewed_at) then
    raise exception using errcode = '40001', message = 'listing_review_revision_conflict';
  end if;

  perform set_config('app.listing_integrity_context', 'trusted_moderation_decision', true);
  update public.listings
  set status = case when p_action = 'approved' then 'active' else 'rejected' end,
      moderation_feedback = case when p_action = 'rejected' then btrim(p_feedback) else null end,
      moderation_reviewed_at = decided_at,
      moderation_reviewed_by = actor_id
  where id = p_listing_id returning * into listing_row;
  perform set_config('app.listing_integrity_context', '', true);

  insert into public.listing_moderation_history(
    listing_id, action, feedback, decided_by, decided_at
  ) values (
    p_listing_id, p_action,
    case when p_action = 'rejected' then btrim(p_feedback) else null end,
    actor_id, decided_at
  );

  insert into public.moderation_audit_events(
    event_type, actor_user_id, actor_user_id_snapshot, actor_role,
    subject_user_id, subject_user_id_snapshot, resource_type, resource_id,
    summary, metadata, request_id, occurred_at
  ) values (
    'listing.moderation_decided', actor_id, actor_id, actor_role,
    listing_row.seller_id, listing_row.seller_id, 'listing', listing_row.id,
    'Listing moderation decision recorded atomically.',
    jsonb_build_object(
      'action', p_action,
      'content_revision', p_expected_content_revision,
      'submitted_for_review_at', p_expected_submitted_for_review_at
    ),
    btrim(p_request_id), decided_at
  );

  notification_id := moderation_action_private.listing_decision_notification_id(
    actor_id, btrim(p_request_id)
  );
  expected_notification_type := case
    when p_action = 'approved' then 'listing_approved'
    else 'listing_rejected'
  end;
  notification_metadata := jsonb_strip_nulls(jsonb_build_object(
    'listing_title', listing_row.title,
    'listing_slug', listing_row.slug,
    'href', '/dashboard',
    'feedback', case when p_action = 'rejected' then btrim(p_feedback) else null end,
    'moderation_operation_id', btrim(p_request_id)
  ));

  insert into public.notifications(
    id, user_id, type, listing_id, metadata
  ) values (
    notification_id, listing_row.seller_id, expected_notification_type,
    listing_row.id, notification_metadata
  ) on conflict (id) do nothing;

  -- A deterministic collision must never silently bind this decision to an
  -- unrelated output. Exact command replay returns from the command ledger
  -- before reaching this writer, while an unexpected collision fails closed.
  if not exists (
    select 1 from public.notifications notification
    where notification.id = notification_id
      and notification.user_id = listing_row.seller_id
      and notification.type = expected_notification_type
      and notification.listing_id = listing_row.id
      and notification.metadata = notification_metadata
  ) then
    raise exception using
      errcode = '23505',
      message = 'listing_decision_notification_id_conflict';
  end if;

  return listing_row;
end
$function$;

alter function moderation_action_private.decide_listing_moderation_impl(
  uuid, bigint, timestamptz, text, text, text
) owner to postgres;

grant execute on function moderation_action_private.issue_moderation_warning_impl(
  uuid, text, text, text, text, uuid, jsonb, text, uuid, timestamptz, boolean, text
) to authenticated;
grant execute on function moderation_action_private.issue_moderation_strike_impl(
  uuid, text, text, text, smallint, text, uuid, jsonb, text, uuid, timestamptz, boolean, text
) to authenticated;
grant execute on function moderation_action_private.issue_moderation_ban_impl(
  uuid, text, text, text, text, uuid, text, uuid, text
) to authenticated;
grant execute on function moderation_action_private.acknowledge_moderation_sanction_impl(uuid)
  to authenticated;
grant execute on function moderation_action_private.request_moderation_sanction_review_impl(uuid)
  to authenticated;
grant execute on function moderation_action_private.revoke_moderation_sanction_impl(uuid, text)
  to authenticated;
grant execute on function moderation_action_private.revoke_active_moderation_ban_impl(uuid, text)
  to authenticated;
grant execute on function moderation_action_private.decide_moderation_sanction_review_impl(
  uuid, text, text, text, text
) to authenticated;
grant execute on function moderation_action_private.modify_moderation_sanction_review_impl(
  uuid, text, text, text, text, text, text, smallint, text, jsonb, text, uuid,
  timestamptz, boolean, text, text
) to authenticated;
grant execute on function moderation_action_private.decide_listing_moderation_impl(
  uuid, bigint, timestamptz, text, text, text
) to authenticated;
grant execute on function moderation_action_private.decide_report_set_impl(uuid[], text, text)
  to authenticated;
grant execute on function moderation_action_private.remove_reported_listing_impl(uuid[], uuid, text)
  to authenticated;

create or replace function public.issue_moderation_warning(
  p_subject_user_id uuid, p_severity text, p_reason_code text, p_user_message text,
  p_internal_note text default null, p_source_report_id uuid default null,
  p_restrictions jsonb default '{}'::jsonb, p_related_resource_type text default null,
  p_related_resource_id uuid default null, p_expires_at timestamptz default null,
  p_acknowledgement_required boolean default true, p_request_id text default null
)
returns uuid language sql security invoker set search_path = ''
begin atomic
  select moderation_action_private.issue_moderation_warning_impl(
    p_subject_user_id,p_severity,p_reason_code,p_user_message,p_internal_note,
    p_source_report_id,p_restrictions,p_related_resource_type,p_related_resource_id,
    p_expires_at,p_acknowledgement_required,p_request_id
  );
end;

create or replace function public.issue_moderation_strike(
  p_subject_user_id uuid, p_severity text, p_reason_code text, p_user_message text,
  p_strike_points smallint, p_internal_note text default null,
  p_source_report_id uuid default null, p_restrictions jsonb default '{}'::jsonb,
  p_related_resource_type text default null, p_related_resource_id uuid default null,
  p_expires_at timestamptz default null, p_acknowledgement_required boolean default true,
  p_request_id text default null
)
returns uuid language sql security invoker set search_path = ''
begin atomic
  select moderation_action_private.issue_moderation_strike_impl(
    p_subject_user_id,p_severity,p_reason_code,p_user_message,p_strike_points,
    p_internal_note,p_source_report_id,p_restrictions,p_related_resource_type,
    p_related_resource_id,p_expires_at,p_acknowledgement_required,p_request_id
  );
end;

create or replace function public.issue_moderation_ban(
  p_subject_user_id uuid, p_severity text, p_reason_code text, p_user_message text,
  p_internal_note text default null, p_source_report_id uuid default null,
  p_related_resource_type text default null, p_related_resource_id uuid default null,
  p_request_id text default null
)
returns uuid language sql security invoker set search_path = ''
begin atomic
  select moderation_action_private.issue_moderation_ban_impl(
    p_subject_user_id,p_severity,p_reason_code,p_user_message,p_internal_note,
    p_source_report_id,p_related_resource_type,p_related_resource_id,p_request_id
  );
end;

create function public.acknowledge_moderation_sanction(p_sanction_id uuid)
returns boolean language sql security invoker set search_path = ''
begin atomic
  select moderation_action_private.acknowledge_moderation_sanction_impl(p_sanction_id);
end;
create function public.request_moderation_sanction_review(p_sanction_id uuid)
returns boolean language sql security invoker set search_path = ''
begin atomic
  select moderation_action_private.request_moderation_sanction_review_impl(p_sanction_id);
end;
create function public.revoke_moderation_sanction(p_sanction_id uuid,p_revocation_reason text)
returns uuid language sql security invoker set search_path = ''
begin atomic
  select moderation_action_private.revoke_moderation_sanction_impl(
    p_sanction_id,p_revocation_reason
  );
end;
create function public.revoke_active_moderation_ban(
  p_subject_user_id uuid,p_revocation_reason text
)
returns uuid language sql security invoker set search_path = ''
begin atomic
  select moderation_action_private.revoke_active_moderation_ban_impl(
    p_subject_user_id,p_revocation_reason
  );
end;
create function public.decide_moderation_sanction_review(
  p_sanction_id uuid,p_outcome text,p_outcome_message text,
  p_private_reason text default null,p_revocation_reason text default null
)
returns uuid language sql security invoker set search_path = ''
begin atomic
  select moderation_action_private.decide_moderation_sanction_review_impl(
    p_sanction_id,p_outcome,p_outcome_message,p_private_reason,p_revocation_reason
  );
end;
create function public.modify_moderation_sanction_review(
  p_sanction_id uuid,p_replacement_type text,p_severity text,p_reason_code text,
  p_user_message text,p_outcome_message text,p_revocation_reason text,
  p_strike_points smallint default null,p_internal_note text default null,
  p_restrictions jsonb default '{}'::jsonb,p_related_resource_type text default null,
  p_related_resource_id uuid default null,p_expires_at timestamptz default null,
  p_acknowledgement_required boolean default true,p_private_reason text default null,
  p_request_id text default null
)
returns uuid language sql security invoker set search_path = ''
begin atomic
  select moderation_action_private.modify_moderation_sanction_review_impl(
    p_sanction_id,p_replacement_type,p_severity,p_reason_code,p_user_message,
    p_outcome_message,p_revocation_reason,p_strike_points,p_internal_note,
    p_restrictions,p_related_resource_type,p_related_resource_id,p_expires_at,
    p_acknowledgement_required,p_private_reason,p_request_id
  );
end;
create or replace function public.decide_listing_moderation(
  p_listing_id uuid,p_expected_content_revision bigint,
  p_expected_submitted_for_review_at timestamptz,p_action text,p_feedback text,
  p_request_id text
)
returns public.listings language sql security invoker set search_path = ''
begin atomic
  select moderation_action_private.decide_listing_moderation_impl(
    p_listing_id,p_expected_content_revision,p_expected_submitted_for_review_at,
    p_action,p_feedback,p_request_id
  );
end;
create or replace function public.decide_report_set(
  p_report_ids uuid[],p_status text,p_request_id text default null
)
returns integer language sql security invoker set search_path = ''
begin atomic
  select moderation_action_private.decide_report_set_impl(
    p_report_ids,p_status,p_request_id
  );
end;
create or replace function public.remove_reported_listing(
  p_report_ids uuid[],p_listing_id uuid,p_request_id text default null
)
returns integer language sql security invoker set search_path = ''
begin atomic
  select moderation_action_private.remove_reported_listing_impl(
    p_report_ids,p_listing_id,p_request_id
  );
end;

revoke all on function public.issue_moderation_warning(
  uuid,text,text,text,text,uuid,jsonb,text,uuid,timestamptz,boolean,text
) from public,anon,authenticated,service_role;
revoke all on function public.issue_moderation_strike(
  uuid,text,text,text,smallint,text,uuid,jsonb,text,uuid,timestamptz,boolean,text
) from public,anon,authenticated,service_role;
revoke all on function public.issue_moderation_ban(
  uuid,text,text,text,text,uuid,text,uuid,text
) from public,anon,authenticated,service_role;
revoke all on function public.acknowledge_moderation_sanction(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.request_moderation_sanction_review(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.revoke_moderation_sanction(uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.revoke_active_moderation_ban(uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.decide_moderation_sanction_review(uuid,text,text,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.modify_moderation_sanction_review(
  uuid,text,text,text,text,text,text,smallint,text,jsonb,text,uuid,timestamptz,boolean,text,text
) from public,anon,authenticated,service_role;
revoke all on function public.decide_listing_moderation(uuid,bigint,timestamptz,text,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.decide_report_set(uuid[],text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.remove_reported_listing(uuid[],uuid,text)
  from public,anon,authenticated,service_role;

grant execute on function public.issue_moderation_warning(
  uuid,text,text,text,text,uuid,jsonb,text,uuid,timestamptz,boolean,text
) to authenticated;
grant execute on function public.issue_moderation_strike(
  uuid,text,text,text,smallint,text,uuid,jsonb,text,uuid,timestamptz,boolean,text
) to authenticated;
grant execute on function public.issue_moderation_ban(uuid,text,text,text,text,uuid,text,uuid,text)
  to authenticated;
grant execute on function public.acknowledge_moderation_sanction(uuid) to authenticated;
grant execute on function public.request_moderation_sanction_review(uuid) to authenticated;
grant execute on function public.revoke_moderation_sanction(uuid,text) to authenticated;
grant execute on function public.revoke_active_moderation_ban(uuid,text) to authenticated;
grant execute on function public.decide_moderation_sanction_review(uuid,text,text,text,text)
  to authenticated;
grant execute on function public.modify_moderation_sanction_review(
  uuid,text,text,text,text,text,text,smallint,text,jsonb,text,uuid,timestamptz,boolean,text,text
) to authenticated;
grant execute on function public.decide_listing_moderation(uuid,bigint,timestamptz,text,text,text)
  to authenticated;
grant execute on function public.decide_report_set(uuid[],text,text) to authenticated;
grant execute on function public.remove_reported_listing(uuid[],uuid,text) to authenticated;

-- Auth Admin is an external system. A durable per-subject operation prevents a
-- second application ban/unban from interleaving between the Auth mutation and
-- the database projection. Retries with the same actor/request replay the same
-- operation; a different request fails until completion or verified rollback.
create table moderation_action_private.auth_ban_operations (
  id uuid primary key default gen_random_uuid(),
  subject_user_id_snapshot uuid not null,
  actor_user_id_snapshot uuid not null,
  action text not null check (action in ('ban', 'unban')),
  requested_ban_duration text not null,
  request_id text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  previous_banned_until timestamptz,
  expected_banned_until timestamptz,
  result_banned_until timestamptz,
  result_sanction_id uuid,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'aborted', 'reconciliation_required')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint auth_ban_operations_request_key
    unique (actor_user_id_snapshot, request_id),
  constraint auth_ban_operations_completion_shape check (
    (status = 'pending' and completed_at is null)
    or (status <> 'pending' and completed_at is not null)
  )
);
create unique index auth_ban_operations_one_pending_subject_idx
  on moderation_action_private.auth_ban_operations(subject_user_id_snapshot)
  where status = 'pending';
revoke all on table moderation_action_private.auth_ban_operations
  from public,anon,authenticated,service_role;

create or replace function moderation_action_private.begin_auth_ban_operation_impl(
  p_subject_user_id uuid,
  p_action text,
  p_ban_duration text,
  p_payload jsonb,
  p_request_id text
)
returns table(
  operation_id uuid,
  operation_status text,
  previous_banned_until timestamptz,
  result_sanction_id uuid,
  result_banned_until timestamptz
)
language plpgsql security definer set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  existing moderation_action_private.auth_ban_operations%rowtype;
  previous_value timestamptz;
begin
  actor_role := moderation_action_private.require_actor(
    case when p_action = 'ban' then 'ban_user' else 'unban_user' end
  );
  perform moderation_action_private.assert_subject(p_subject_user_id, actor_role, actor_id);
  if p_action not in ('ban','unban')
    or char_length(btrim(coalesce(p_ban_duration,''))) not between 1 and 32
    or jsonb_typeof(coalesce(p_payload,'null'::jsonb)) <> 'object'
    or char_length(btrim(coalesce(p_request_id,''))) not between 1 and 200 then
    raise exception using errcode='22023',message='moderation_auth_ban_operation_invalid';
  end if;
  if (p_action='unban' and p_ban_duration <> 'none')
    or (p_action='ban' and p_ban_duration='none') then
    raise exception using errcode='22023',message='moderation_auth_ban_operation_invalid';
  end if;

  select * into existing
  from moderation_action_private.auth_ban_operations operation
  where operation.actor_user_id_snapshot=actor_id
    and operation.request_id=btrim(p_request_id)
  for update;
  if found then
    if existing.subject_user_id_snapshot is distinct from p_subject_user_id
      or existing.action is distinct from p_action
      or existing.requested_ban_duration is distinct from p_ban_duration
      or existing.payload is distinct from p_payload then
      raise exception using errcode='22023',message='moderation_request_id_payload_conflict';
    end if;
    if existing.status='completed' and not exists(
      select 1 from auth.users account
      where account.id=existing.subject_user_id_snapshot
        and account.banned_until is not distinct from existing.result_banned_until
    ) then
      raise exception using errcode='40001',message='moderation_auth_ban_completed_state_changed';
    end if;
    return query select existing.id,existing.status,
      existing.previous_banned_until,existing.result_sanction_id,
      existing.result_banned_until;
    return;
  end if;

  select * into existing
  from moderation_action_private.auth_ban_operations operation
  where operation.subject_user_id_snapshot=p_subject_user_id
    and operation.actor_user_id_snapshot=actor_id
    and operation.action=p_action
    and operation.requested_ban_duration=p_ban_duration
    and operation.payload=p_payload
    and operation.status='pending'
    and operation.created_at>statement_timestamp()-interval '15 minutes'
  order by operation.created_at desc limit 1 for update;
  if found then
    return query select existing.id,existing.status,
      existing.previous_banned_until,existing.result_sanction_id,
      existing.result_banned_until;
    return;
  end if;

  select * into existing
  from moderation_action_private.auth_ban_operations operation
  where operation.subject_user_id_snapshot=p_subject_user_id
    and operation.status='pending'
  for update;
  if found then
    if existing.created_at<=statement_timestamp()-interval '15 minutes' then
      update moderation_action_private.auth_ban_operations
      set status='reconciliation_required',completed_at=statement_timestamp()
      where id=existing.id;
      return query select existing.id,'reconciliation_required'::text,
        existing.previous_banned_until,existing.result_sanction_id,
        existing.result_banned_until;
      return;
    end if;
    raise exception using errcode='40001',message='moderation_auth_ban_operation_in_progress';
  end if;

  select account.banned_until into previous_value from auth.users account
  where account.id=p_subject_user_id for update;
  insert into moderation_action_private.auth_ban_operations(
    subject_user_id_snapshot,actor_user_id_snapshot,action,requested_ban_duration,
    request_id,payload,previous_banned_until
  ) values(
    p_subject_user_id,actor_id,p_action,p_ban_duration,btrim(p_request_id),p_payload,previous_value
  ) returning auth_ban_operations.id,auth_ban_operations.status,
      auth_ban_operations.previous_banned_until,
      auth_ban_operations.result_sanction_id,
      auth_ban_operations.result_banned_until
    into operation_id,operation_status,previous_banned_until,result_sanction_id,result_banned_until;
  return next;
end
$function$;

create or replace function moderation_action_private.complete_auth_ban_operation_impl(
  p_operation_id uuid,
  p_expected_banned_until timestamptz
)
returns uuid language plpgsql security definer set search_path=''
as $function$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  preliminary moderation_action_private.auth_ban_operations%rowtype;
  operation moderation_action_private.auth_ban_operations%rowtype;
  live_banned_until timestamptz;
  sanction_id uuid;
begin
  -- Identity is immutable and private, so it is safe to pre-read without a
  -- lock. Every saga path then acquires locks in actor -> subject -> operation
  -- order and revalidates the identity under the operation lock.
  select * into preliminary from moderation_action_private.auth_ban_operations
  where id=p_operation_id;
  if not found or preliminary.actor_user_id_snapshot is distinct from actor_id then
    raise exception using errcode='P0002',message='moderation_auth_ban_operation_not_found';
  end if;
  actor_role := moderation_action_private.require_actor(
    case when preliminary.action='ban' then 'ban_user' else 'unban_user' end
  );
  perform moderation_action_private.assert_subject(
    preliminary.subject_user_id_snapshot,actor_role,actor_id
  );
  select * into operation from moderation_action_private.auth_ban_operations
  where id=p_operation_id for update;
  if not found
    or operation.actor_user_id_snapshot is distinct from preliminary.actor_user_id_snapshot
    or operation.subject_user_id_snapshot is distinct from preliminary.subject_user_id_snapshot
    or operation.action is distinct from preliminary.action then
    raise exception using errcode='40001',message='moderation_auth_ban_operation_identity_changed';
  end if;
  if operation.status='completed' then return operation.result_sanction_id; end if;
  if operation.status<>'pending' then
    raise exception using errcode='55000',message='moderation_auth_ban_operation_not_pending';
  end if;
  select account.banned_until into live_banned_until from auth.users account
  where account.id=operation.subject_user_id_snapshot for update;
  if live_banned_until is distinct from p_expected_banned_until
    or (operation.action='ban' and (live_banned_until is null or live_banned_until<=statement_timestamp()))
    or (operation.action='unban' and live_banned_until is not null and live_banned_until>statement_timestamp()) then
    raise exception using errcode='40001',message='moderation_auth_ban_state_changed';
  end if;

  if operation.action='ban' then
    sanction_id := moderation_action_private.issue_moderation_ban_impl(
      operation.subject_user_id_snapshot,
      coalesce(operation.payload->>'severity','critical'),
      operation.payload->>'reason_code',operation.payload->>'user_message',
      operation.payload->>'internal_note',null,null,null,operation.request_id
    );
  else
    sanction_id := moderation_action_private.revoke_active_moderation_ban_impl(
      operation.subject_user_id_snapshot,
      coalesce(operation.payload->>'revocation_reason','Ban revoked by an administrator.')
    );
  end if;
  update moderation_action_private.auth_ban_operations
  set status='completed',expected_banned_until=p_expected_banned_until,
      result_banned_until=p_expected_banned_until,result_sanction_id=sanction_id,
      completed_at=statement_timestamp()
  where id=operation.id;
  return sanction_id;
end
$function$;

create or replace function moderation_action_private.abort_auth_ban_operation_impl(
  p_operation_id uuid
)
returns boolean language plpgsql security definer set search_path=''
as $function$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  preliminary moderation_action_private.auth_ban_operations%rowtype;
  operation moderation_action_private.auth_ban_operations%rowtype;
  live_value timestamptz;
begin
  select * into preliminary from moderation_action_private.auth_ban_operations
  where id=p_operation_id;
  if not found or preliminary.actor_user_id_snapshot is distinct from actor_id then
    raise exception using errcode='P0002',message='moderation_auth_ban_operation_not_abortable';
  end if;
  actor_role := moderation_action_private.require_actor(
    case when preliminary.action='ban' then 'ban_user' else 'unban_user' end
  );
  perform moderation_action_private.assert_subject(
    preliminary.subject_user_id_snapshot,actor_role,actor_id
  );
  select * into operation from moderation_action_private.auth_ban_operations
  where id=p_operation_id for update;
  if not found
    or operation.actor_user_id_snapshot is distinct from preliminary.actor_user_id_snapshot
    or operation.subject_user_id_snapshot is distinct from preliminary.subject_user_id_snapshot
    or operation.action is distinct from preliminary.action
    or operation.status<>'pending' then
    raise exception using errcode='P0002',message='moderation_auth_ban_operation_not_abortable';
  end if;
  select account.banned_until into live_value from auth.users account
  where account.id=operation.subject_user_id_snapshot for update;
  update moderation_action_private.auth_ban_operations
  set status=case when live_value is not distinct from operation.previous_banned_until
      then 'aborted' else 'reconciliation_required' end,
      completed_at=statement_timestamp()
  where id=operation.id;
  return live_value is not distinct from operation.previous_banned_until;
end
$function$;

alter function moderation_action_private.begin_auth_ban_operation_impl(uuid,text,text,jsonb,text)
  owner to postgres;
alter function moderation_action_private.complete_auth_ban_operation_impl(uuid,timestamptz)
  owner to postgres;
alter function moderation_action_private.abort_auth_ban_operation_impl(uuid) owner to postgres;
revoke all on function moderation_action_private.begin_auth_ban_operation_impl(uuid,text,text,jsonb,text)
  from public,anon,authenticated,service_role;
revoke all on function moderation_action_private.complete_auth_ban_operation_impl(uuid,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function moderation_action_private.abort_auth_ban_operation_impl(uuid)
  from public,anon,authenticated,service_role;
grant execute on function moderation_action_private.begin_auth_ban_operation_impl(uuid,text,text,jsonb,text)
  to authenticated;
grant execute on function moderation_action_private.complete_auth_ban_operation_impl(uuid,timestamptz)
  to authenticated;
grant execute on function moderation_action_private.abort_auth_ban_operation_impl(uuid)
  to authenticated;

create function public.begin_auth_ban_operation(
  p_subject_user_id uuid,p_action text,p_ban_duration text,p_payload jsonb,p_request_id text
)
returns table(
  operation_id uuid,
  operation_status text,
  previous_banned_until timestamptz,
  result_sanction_id uuid,
  result_banned_until timestamptz
)
language sql security invoker set search_path=''
begin atomic
  select operation_id,operation_status,previous_banned_until,result_sanction_id,result_banned_until
  from moderation_action_private.begin_auth_ban_operation_impl(
    p_subject_user_id,p_action,p_ban_duration,p_payload,p_request_id
  );
end;
create function public.complete_auth_ban_operation(p_operation_id uuid,p_expected_banned_until timestamptz)
returns uuid language sql security invoker set search_path=''
begin atomic
  select moderation_action_private.complete_auth_ban_operation_impl(
    p_operation_id,p_expected_banned_until
  );
end;
create function public.abort_auth_ban_operation(p_operation_id uuid)
returns boolean language sql security invoker set search_path=''
begin atomic
  select moderation_action_private.abort_auth_ban_operation_impl(p_operation_id);
end;
revoke all on function public.begin_auth_ban_operation(uuid,text,text,jsonb,text)
  from public,anon,authenticated,service_role;
revoke all on function public.complete_auth_ban_operation(uuid,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.abort_auth_ban_operation(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.begin_auth_ban_operation(uuid,text,text,jsonb,text) to authenticated;
grant execute on function public.complete_auth_ban_operation(uuid,timestamptz) to authenticated;
grant execute on function public.abort_auth_ban_operation(uuid) to authenticated;

create or replace function moderation_action_private.assert_profile_name_scope_origin()
returns trigger language plpgsql security invoker set search_path=''
as $function$
begin
  if coalesce(current_setting('smot.profile_identity_write_scope',true),'')='force_name_change'
    and current_user<>'postgres' then
    raise exception using errcode='42501',message='profile_identity_scope_origin_invalid';
  end if;
  return new;
end
$function$;
alter function moderation_action_private.assert_profile_name_scope_origin() owner to postgres;
revoke all on function moderation_action_private.assert_profile_name_scope_origin()
  from public,anon,authenticated,service_role;
drop trigger if exists a0_assert_profile_name_scope_origin on public.profiles;
create trigger a0_assert_profile_name_scope_origin before update on public.profiles
for each row execute function moderation_action_private.assert_profile_name_scope_origin();

create or replace function private.protect_profile_identity_fields()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare
  caller_id uuid:=auth.uid();
  caller_role text:=coalesce(auth.role(),'');
  auth_email text;
  requires_name_change boolean:=false;
  trusted_target text:=coalesce(current_setting('smot.profile_identity_target',true),'');
begin
  if tg_op='UPDATE'
    and coalesce(current_setting('smot.profile_identity_write_scope',true),'')='force_name_change'
    and trusted_target=new.id::text
    and new.first_name is null and new.last_name is null
    and new.school is not distinct from old.school then
    return new;
  end if;
  if tg_op='INSERT' then
    if caller_role='authenticated' then
      if caller_id is null or new.id is distinct from caller_id then
        raise exception using errcode='42501',message='profile_identity_owner_mismatch';
      end if;
      if new.first_name is not null or new.last_name is not null then
        raise exception using errcode='42501',message='profile_identity_requires_trusted_api';
      end if;
    elsif caller_role='anon' then
      raise exception using errcode='42501',message='profile_authentication_required';
    end if;
    select account.email,account.raw_app_meta_data->'force_name_change'='true'::jsonb
      into auth_email,requires_name_change from auth.users account where account.id=new.id;
    new.school:=private.toronto_school_name_for_email(auth_email);
    if new.school is null then
      raise exception using errcode='23514',message='profile_school_email_not_allowed';
    end if;
    if requires_name_change and (new.first_name is not null or new.last_name is not null) then
      raise exception using errcode='42501',message='profile_name_change_required';
    end if;
    return new;
  end if;
  if new.first_name is not distinct from old.first_name
    and new.last_name is not distinct from old.last_name
    and new.school is not distinct from old.school then return new; end if;
  if caller_role in ('anon','authenticated') then
    raise exception using errcode='42501',message='profile_identity_requires_trusted_api';
  end if;
  return new;
end
$function$;

create or replace function moderation_action_private.force_profile_name_change_impl(
  p_report_ids uuid[],p_subject_user_id uuid,p_request_id text
)
returns integer language plpgsql security definer set search_path=''
as $function$
declare
  actor_id uuid:=auth.uid(); actor_role text; expected_count integer;
  selected_count integer; matching_count integer; changed_count integer;
  changed_at timestamptz:=statement_timestamp();
begin
  actor_role:=moderation_action_private.require_actor('decide_reports');
  if actor_role<>'admin' then
    raise exception using errcode='42501',message='moderation_action_not_permitted';
  end if;
  perform moderation_action_private.assert_subject(p_subject_user_id,actor_role,actor_id);
  expected_count:=moderation_action_private.validate_report_id_set(p_report_ids);
  if char_length(btrim(coalesce(p_request_id,''))) not between 1 and 200 then
    raise exception using errcode='22023',message='moderation_request_id_invalid';
  end if;
  if not exists(select 1 from auth.users account where account.id=p_subject_user_id
    and account.raw_app_meta_data->'force_name_change'='true'::jsonb) then
    raise exception using errcode='55000',message='force_name_change_auth_metadata_required';
  end if;
  perform report.id from public.reports report
  where report.id=any(p_report_ids)
  order by report.id
  for update;
  select count(*),count(*) filter(where report.status='open'
      and report.subject_type='profile'
      and report.subject_id=p_subject_user_id
      and (report.reported_user_id is null or report.reported_user_id=p_subject_user_id))
    into selected_count,matching_count from public.reports report where report.id=any(p_report_ids);
  if selected_count<>expected_count or matching_count<>expected_count then
    raise exception using errcode='40001',message='moderation_report_set_conflict';
  end if;
  perform 1 from public.profiles profile where profile.id=p_subject_user_id for update;
  if not found then raise exception using errcode='P0002',message='moderation_subject_profile_not_found'; end if;
  perform set_config('smot.profile_identity_target',p_subject_user_id::text,true);
  perform set_config('smot.profile_identity_write_scope','force_name_change',true);
  update public.profiles set first_name=null,last_name=null where id=p_subject_user_id;
  perform set_config('smot.profile_identity_write_scope','',true);
  perform set_config('smot.profile_identity_target','',true);
  update public.reports set status='resolved',reviewed_by=actor_id,reviewed_at=changed_at
    where id=any(p_report_ids) and status='open';
  get diagnostics changed_count=row_count;
  if changed_count<>expected_count then
    raise exception using errcode='40001',message='moderation_report_set_conflict';
  end if;
  insert into public.moderation_audit_events(
    event_type,actor_user_id,actor_user_id_snapshot,actor_role,
    subject_user_id,subject_user_id_snapshot,source_report_id,
    resource_type,resource_id,summary,metadata,request_id,occurred_at
  ) values(
    'profile.name_change_required',actor_id,actor_id,actor_role,
    p_subject_user_id,p_subject_user_id,p_report_ids[1],
    'profile',p_subject_user_id,'Profile name reset and exact report set resolved atomically.',
    jsonb_build_object('report_ids',to_jsonb(p_report_ids)),btrim(p_request_id),changed_at
  );
  return changed_count;
end
$function$;
alter function moderation_action_private.force_profile_name_change_impl(uuid[],uuid,text)
  owner to postgres;
revoke all on function moderation_action_private.force_profile_name_change_impl(uuid[],uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function moderation_action_private.force_profile_name_change_impl(uuid[],uuid,text)
  to authenticated;
create function public.force_profile_name_change(p_report_ids uuid[],p_subject_user_id uuid,p_request_id text)
returns integer language sql security invoker set search_path=''
begin atomic
  select moderation_action_private.force_profile_name_change_impl(
    p_report_ids,p_subject_user_id,p_request_id
  );
end;
revoke all on function public.force_profile_name_change(uuid[],uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.force_profile_name_change(uuid[],uuid,text) to authenticated;

-- Requiring an Auth metadata change is another external-system saga. Serialize
-- it per subject before Auth is touched, then consume the exact locked report
-- set under the durable operation token. This prevents one overlapping request
-- from rolling back metadata after a peer has already committed the sanction.
create table moderation_action_private.force_name_operations (
  id uuid primary key default gen_random_uuid(),
  subject_user_id_snapshot uuid not null,
  actor_user_id_snapshot uuid not null,
  report_ids uuid[] not null,
  request_id text not null,
  desired_metadata jsonb not null check (jsonb_typeof(desired_metadata)='object'),
  rollback_metadata jsonb not null check (jsonb_typeof(rollback_metadata)='object'),
  status text not null default 'pending'
    check (status in ('pending','completed','aborted','reconciliation_required')),
  result_updated_count integer,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint force_name_operations_request_key
    unique(actor_user_id_snapshot,request_id),
  constraint force_name_operations_completion_shape check (
    (status='pending' and completed_at is null)
    or (status<>'pending' and completed_at is not null)
  )
);
create unique index force_name_operations_one_pending_subject_idx
  on moderation_action_private.force_name_operations(subject_user_id_snapshot)
  where status='pending';
revoke all on table moderation_action_private.force_name_operations
  from public,anon,authenticated,service_role;

create function moderation_action_private.begin_force_name_operation_impl(
  p_report_ids uuid[],
  p_subject_user_id uuid,
  p_desired_metadata jsonb,
  p_rollback_metadata jsonb,
  p_request_id text
)
returns table(operation_id uuid,operation_status text,result_updated_count integer)
language plpgsql security definer set search_path=''
as $function$
declare
  actor_id uuid:=auth.uid(); actor_role text; expected_count integer;
  selected_count integer; matching_count integer;
  normalized_report_ids uuid[];
  existing moderation_action_private.force_name_operations%rowtype;
begin
  actor_role:=moderation_action_private.require_actor('decide_reports');
  if actor_role<>'admin' then
    raise exception using errcode='42501',message='moderation_action_not_permitted';
  end if;
  perform moderation_action_private.assert_subject(p_subject_user_id,actor_role,actor_id);
  expected_count:=moderation_action_private.validate_report_id_set(p_report_ids);
  select array_agg(report_id order by report_id) into normalized_report_ids
  from unnest(p_report_ids) report_id;
  if char_length(btrim(coalesce(p_request_id,''))) not between 1 and 200
    or jsonb_typeof(coalesce(p_desired_metadata,'null'::jsonb))<>'object'
    or jsonb_typeof(coalesce(p_rollback_metadata,'null'::jsonb))<>'object'
    or p_desired_metadata->'force_name_change' is distinct from 'true'::jsonb then
    raise exception using errcode='22023',message='force_name_change_operation_invalid';
  end if;

  select * into existing from moderation_action_private.force_name_operations operation
  where operation.actor_user_id_snapshot=actor_id
    and operation.request_id=btrim(p_request_id)
  for update;
  if found then
    if existing.subject_user_id_snapshot is distinct from p_subject_user_id
      or existing.report_ids is distinct from normalized_report_ids
      or existing.desired_metadata is distinct from p_desired_metadata
      or existing.rollback_metadata is distinct from p_rollback_metadata then
      raise exception using errcode='22023',message='moderation_request_id_payload_conflict';
    end if;
    if existing.status='completed' and (
      not exists(select 1 from auth.users account
        where account.id=existing.subject_user_id_snapshot
          and coalesce(account.raw_app_meta_data->'force_name_change','null'::jsonb)
            is not distinct from coalesce(existing.desired_metadata->'force_name_change','null'::jsonb)
          and coalesce(account.raw_app_meta_data->'force_name_change_rejected_name_fingerprint','null'::jsonb)
            is not distinct from coalesce(existing.desired_metadata->'force_name_change_rejected_name_fingerprint','null'::jsonb)
          and coalesce(account.raw_app_meta_data->'force_name_change_rejected_name_fingerprints','null'::jsonb)
            is not distinct from coalesce(existing.desired_metadata->'force_name_change_rejected_name_fingerprints','null'::jsonb))
      or exists(select 1 from public.profiles profile
        where profile.id=existing.subject_user_id_snapshot
          and (profile.first_name is not null or profile.last_name is not null))
      or exists(select 1 from public.reports report
        where report.id=any(existing.report_ids) and report.status<>'resolved')
    ) then
      raise exception using errcode='40001',message='force_name_change_completed_state_changed';
    end if;
    return query select existing.id,existing.status,existing.result_updated_count;
    return;
  end if;

  select * into existing from moderation_action_private.force_name_operations operation
  where operation.subject_user_id_snapshot=p_subject_user_id
    and operation.actor_user_id_snapshot=actor_id
    and operation.report_ids=normalized_report_ids
    and operation.desired_metadata=p_desired_metadata
    and operation.rollback_metadata=p_rollback_metadata
    and operation.status='pending'
    and operation.created_at>statement_timestamp()-interval '15 minutes'
  order by operation.created_at desc limit 1 for update;
  if found then
    return query select existing.id,existing.status,existing.result_updated_count;
    return;
  end if;

  select * into existing from moderation_action_private.force_name_operations operation
  where operation.subject_user_id_snapshot=p_subject_user_id and operation.status='pending'
  for update;
  if found then
    if existing.created_at<=statement_timestamp()-interval '15 minutes' then
      update moderation_action_private.force_name_operations
      set status='reconciliation_required',completed_at=statement_timestamp()
      where id=existing.id;
      return query select existing.id,'reconciliation_required'::text,
        existing.result_updated_count;
      return;
    end if;
    raise exception using errcode='40001',message='force_name_change_operation_in_progress';
  end if;

  perform report.id from public.reports report
  where report.id=any(normalized_report_ids)
  order by report.id
  for update;
  select count(*),count(*) filter(where report.status='open'
      and report.subject_type='profile'
      and report.subject_id=p_subject_user_id
      and (report.reported_user_id is null or report.reported_user_id=p_subject_user_id))
  into selected_count,matching_count from public.reports report
  where report.id=any(normalized_report_ids);
  if selected_count<>expected_count or matching_count<>expected_count then
    raise exception using errcode='40001',message='moderation_report_set_conflict';
  end if;

  insert into moderation_action_private.force_name_operations(
    subject_user_id_snapshot,actor_user_id_snapshot,report_ids,request_id,
    desired_metadata,rollback_metadata
  ) values(
    p_subject_user_id,actor_id,normalized_report_ids,btrim(p_request_id),
    p_desired_metadata,p_rollback_metadata
  ) returning force_name_operations.id,force_name_operations.status,
      force_name_operations.result_updated_count
    into operation_id,operation_status,result_updated_count;
  return next;
end
$function$;

create function moderation_action_private.complete_force_name_operation_impl(
  p_operation_id uuid
)
returns integer language plpgsql security definer set search_path=''
as $function$
declare
  actor_id uuid:=auth.uid(); actor_role text;
  preliminary moderation_action_private.force_name_operations%rowtype;
  operation moderation_action_private.force_name_operations%rowtype;
  live_metadata jsonb; changed_count integer;
begin
  select * into preliminary from moderation_action_private.force_name_operations
  where id=p_operation_id;
  if not found or preliminary.actor_user_id_snapshot is distinct from actor_id then
    raise exception using errcode='P0002',message='force_name_change_operation_not_found';
  end if;
  actor_role:=moderation_action_private.require_actor('decide_reports');
  if actor_role<>'admin' then
    raise exception using errcode='42501',message='moderation_action_not_permitted';
  end if;
  perform moderation_action_private.assert_subject(
    preliminary.subject_user_id_snapshot,actor_role,actor_id
  );
  select * into operation from moderation_action_private.force_name_operations
  where id=p_operation_id for update;
  if not found
    or operation.actor_user_id_snapshot is distinct from preliminary.actor_user_id_snapshot
    or operation.subject_user_id_snapshot is distinct from preliminary.subject_user_id_snapshot
    or operation.report_ids is distinct from preliminary.report_ids then
    raise exception using errcode='40001',message='force_name_change_operation_identity_changed';
  end if;
  if operation.status='completed' then return operation.result_updated_count; end if;
  if operation.status<>'pending' then
    raise exception using errcode='55000',message='force_name_change_operation_not_pending';
  end if;
  select coalesce(account.raw_app_meta_data,'{}'::jsonb) into live_metadata
  from auth.users account where account.id=operation.subject_user_id_snapshot for update;
  if coalesce(live_metadata->'force_name_change','null'::jsonb)
        is distinct from coalesce(operation.desired_metadata->'force_name_change','null'::jsonb)
    or coalesce(live_metadata->'force_name_change_rejected_name_fingerprint','null'::jsonb)
        is distinct from coalesce(operation.desired_metadata->'force_name_change_rejected_name_fingerprint','null'::jsonb)
    or coalesce(live_metadata->'force_name_change_rejected_name_fingerprints','null'::jsonb)
        is distinct from coalesce(operation.desired_metadata->'force_name_change_rejected_name_fingerprints','null'::jsonb) then
    raise exception using errcode='40001',message='force_name_change_auth_metadata_changed';
  end if;
  changed_count:=moderation_action_private.force_profile_name_change_impl(
    operation.report_ids,operation.subject_user_id_snapshot,operation.request_id
  );
  update moderation_action_private.force_name_operations
  set status='completed',result_updated_count=changed_count,
      completed_at=statement_timestamp()
  where id=operation.id;
  return changed_count;
end
$function$;

create function moderation_action_private.abort_force_name_operation_impl(p_operation_id uuid)
returns boolean language plpgsql security definer set search_path=''
as $function$
declare
  actor_id uuid:=auth.uid();
  actor_role text;
  preliminary moderation_action_private.force_name_operations%rowtype;
  operation moderation_action_private.force_name_operations%rowtype;
  live_metadata jsonb; rollback_matches boolean;
begin
  select * into preliminary from moderation_action_private.force_name_operations
  where id=p_operation_id;
  if not found or preliminary.actor_user_id_snapshot is distinct from actor_id then
    raise exception using errcode='P0002',message='force_name_change_operation_not_abortable';
  end if;
  actor_role:=moderation_action_private.require_actor('decide_reports');
  if actor_role<>'admin' then
    raise exception using errcode='42501',message='moderation_action_not_permitted';
  end if;
  perform moderation_action_private.assert_subject(
    preliminary.subject_user_id_snapshot,actor_role,actor_id
  );
  select * into operation from moderation_action_private.force_name_operations
  where id=p_operation_id for update;
  if not found
    or operation.actor_user_id_snapshot is distinct from preliminary.actor_user_id_snapshot
    or operation.subject_user_id_snapshot is distinct from preliminary.subject_user_id_snapshot
    or operation.report_ids is distinct from preliminary.report_ids
    or operation.status<>'pending' then
    raise exception using errcode='P0002',message='force_name_change_operation_not_abortable';
  end if;
  select coalesce(account.raw_app_meta_data,'{}'::jsonb) into live_metadata
  from auth.users account where account.id=operation.subject_user_id_snapshot for update;
  rollback_matches:=
    coalesce(live_metadata->'force_name_change','null'::jsonb)
      is not distinct from coalesce(operation.rollback_metadata->'force_name_change','null'::jsonb)
    and coalesce(live_metadata->'force_name_change_rejected_name_fingerprint','null'::jsonb)
      is not distinct from coalesce(operation.rollback_metadata->'force_name_change_rejected_name_fingerprint','null'::jsonb)
    and coalesce(live_metadata->'force_name_change_rejected_name_fingerprints','null'::jsonb)
      is not distinct from coalesce(operation.rollback_metadata->'force_name_change_rejected_name_fingerprints','null'::jsonb);
  update moderation_action_private.force_name_operations
  set status=case when rollback_matches then 'aborted' else 'reconciliation_required' end,
      completed_at=statement_timestamp()
  where id=operation.id;
  return rollback_matches;
end
$function$;

alter function moderation_action_private.begin_force_name_operation_impl(uuid[],uuid,jsonb,jsonb,text)
  owner to postgres;
alter function moderation_action_private.complete_force_name_operation_impl(uuid) owner to postgres;
alter function moderation_action_private.abort_force_name_operation_impl(uuid) owner to postgres;
revoke all on function moderation_action_private.begin_force_name_operation_impl(uuid[],uuid,jsonb,jsonb,text)
  from public,anon,authenticated,service_role;
revoke all on function moderation_action_private.complete_force_name_operation_impl(uuid)
  from public,anon,authenticated,service_role;
revoke all on function moderation_action_private.abort_force_name_operation_impl(uuid)
  from public,anon,authenticated,service_role;
grant execute on function moderation_action_private.begin_force_name_operation_impl(uuid[],uuid,jsonb,jsonb,text)
  to authenticated;
grant execute on function moderation_action_private.complete_force_name_operation_impl(uuid)
  to authenticated;
grant execute on function moderation_action_private.abort_force_name_operation_impl(uuid)
  to authenticated;

drop function public.force_profile_name_change(uuid[],uuid,text);
create function public.begin_force_name_operation(
  p_report_ids uuid[],p_subject_user_id uuid,p_desired_metadata jsonb,
  p_rollback_metadata jsonb,p_request_id text
)
returns table(operation_id uuid,operation_status text,result_updated_count integer)
language sql security invoker set search_path=''
begin atomic
  select operation_id,operation_status,result_updated_count
  from moderation_action_private.begin_force_name_operation_impl(
    p_report_ids,p_subject_user_id,p_desired_metadata,p_rollback_metadata,p_request_id
  );
end;
create function public.complete_force_name_operation(p_operation_id uuid)
returns integer language sql security invoker set search_path=''
begin atomic
  select moderation_action_private.complete_force_name_operation_impl(p_operation_id);
end;
create function public.abort_force_name_operation(p_operation_id uuid)
returns boolean language sql security invoker set search_path=''
begin atomic
  select moderation_action_private.abort_force_name_operation_impl(p_operation_id);
end;
revoke all on function public.begin_force_name_operation(uuid[],uuid,jsonb,jsonb,text)
  from public,anon,authenticated,service_role;
revoke all on function public.complete_force_name_operation(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.abort_force_name_operation(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.begin_force_name_operation(uuid[],uuid,jsonb,jsonb,text)
  to authenticated;
grant execute on function public.complete_force_name_operation(uuid) to authenticated;
grant execute on function public.abort_force_name_operation(uuid) to authenticated;




alter function moderation_action_private.resolve_role_from_account(jsonb, text)
  owner to postgres;
revoke all on function moderation_action_private.resolve_role_from_account(jsonb, text)
  from public, anon, authenticated, service_role;

create or replace function moderation_action_private.resolve_role(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select moderation_action_private.resolve_role_from_account(
    account.raw_app_meta_data,
    account.role
  )
  from auth.users account
  where account.id = p_user_id;
$function$;

create or replace function moderation_action_private.require_actor(p_action text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  actor_auth_banned_until timestamptz;
begin
  if auth.role() <> 'authenticated' or actor_id is null then
    raise exception using errcode = '42501', message = 'moderation_authentication_required';
  end if;

  select
    moderation_action_private.resolve_role_from_account(
      account.raw_app_meta_data,
      account.role
    ),
    account.banned_until
  into actor_role, actor_auth_banned_until
  from auth.users account
  where account.id = actor_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'moderation_authentication_required';
  end if;

  if actor_auth_banned_until is not null
    and actor_auth_banned_until > statement_timestamp() then
    raise exception using errcode = '42501', message = 'moderation_actor_is_banned';
  end if;

  if actor_role is null or not (
    case p_action
      when 'decide_reports' then actor_role in ('admin', 'moderator')
      when 'decide_listings' then actor_role in ('admin', 'moderator')
      when 'issue_warning' then actor_role in ('admin', 'moderator')
      when 'issue_standard_strike' then actor_role in ('admin', 'moderator')
      when 'ban_user' then actor_role = 'admin'
      when 'unban_user' then actor_role = 'admin'
      else false
    end
  ) then
    raise exception using errcode = '42501', message = 'moderation_action_not_permitted';
  end if;

  perform 1
  from public.user_status status
  where status.user_id = actor_id
    and status.is_banned
    and (status.banned_until is null or status.banned_until > statement_timestamp())
  for share;

  if found then
    raise exception using errcode = '42501', message = 'moderation_actor_is_banned';
  end if;

  return actor_role;
end
$function$;

create or replace function moderation_action_private.assert_subject(
  p_subject_user_id uuid,
  p_actor_role text,
  p_actor_user_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  subject_role text;
begin
  if p_subject_user_id is null or p_subject_user_id = p_actor_user_id then
    raise exception using errcode = '22023', message = 'moderation_subject_is_invalid';
  end if;

  select moderation_action_private.resolve_role_from_account(
    account.raw_app_meta_data,
    account.role
  )
  into subject_role
  from auth.users account
  where account.id = p_subject_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'moderation_subject_not_found';
  end if;

  if subject_role = 'admin'
    or (p_actor_role = 'moderator' and subject_role = 'moderator') then
    raise exception using errcode = '42501', message = 'moderation_subject_is_protected';
  end if;
end
$function$;

-- The trusted listing trigger validates every changed field and the live actor.
-- The existing integrity trigger consumes this narrow scope; no JWT claim is
-- rewritten, so later statements in the transaction keep the real caller role.
create or replace function public.enforce_listing_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  caller_role text := coalesce(auth.role(), '');
  integrity_context text := coalesce(
    pg_catalog.current_setting('app.listing_integrity_context', true),
    ''
  );
  content_changed boolean;
begin
  if tg_op = 'INSERT' then
    if caller_role = 'anon' then
      raise exception using errcode = '42501', message = 'listing_authentication_required';
    end if;
    if caller_role = 'authenticated' then
      if caller_id is null or new.seller_id is distinct from caller_id then
        raise exception using errcode = '42501', message = 'listing_owner_mismatch';
      end if;
      if new.status not in ('draft', 'inactive') then
        raise exception using errcode = '42501', message = 'listing_initial_status_not_allowed';
      end if;
      new.content_revision := 1;
      new.retired_at := null;
      new.moderation_feedback := null;
      new.moderation_reviewed_at := null;
      new.moderation_reviewed_by := null;
      new.submitted_for_review_at := case
        when new.status = 'inactive' then statement_timestamp()
        else null
      end;
    end if;
    return new;
  end if;

  if caller_role = 'service_role'
    or integrity_context in ('trusted_moderation_decision', 'trusted_report_listing_removal') then
    return new;
  end if;

  if old.retired_at is not null then
    raise exception using errcode = '42501', message = 'listing_is_retired';
  end if;
  if integrity_context <> 'retirement' and new.retired_at is distinct from old.retired_at then
    raise exception using errcode = '42501', message = 'listing_retirement_is_server_managed';
  end if;

  if integrity_context in ('seller_transition', 'retirement', 'image_change') then
    if caller_role <> 'authenticated' or caller_id is null
      or old.seller_id is distinct from caller_id
      or new.seller_id is distinct from caller_id then
      raise exception using errcode = '42501', message = 'listing_owner_mismatch';
    end if;
    if integrity_context = 'retirement' then
      if new.retired_at is null then
        raise exception using errcode = '42501', message = 'listing_retirement_marker_required';
      end if;
      new.content_revision := old.content_revision + 1;
    elsif integrity_context = 'image_change' then
      new.content_revision := old.content_revision + 1;
      if old.status in ('active', 'sold', 'inactive') then
        new.status := 'inactive';
        new.submitted_for_review_at := statement_timestamp();
        new.moderation_feedback := null;
        new.moderation_reviewed_at := null;
        new.moderation_reviewed_by := null;
      end if;
    else
      new.content_revision := old.content_revision;
    end if;
    return new;
  end if;

  if caller_role = 'anon' or caller_id is null then
    raise exception using errcode = '42501', message = 'listing_authentication_required';
  end if;
  if old.seller_id is distinct from caller_id or new.seller_id is distinct from caller_id then
    raise exception using errcode = '42501', message = 'listing_owner_mismatch';
  end if;

  content_changed :=
    new.slug is distinct from old.slug or new.title is distinct from old.title
    or new.description is distinct from old.description or new.price is distinct from old.price
    or new.previous_price is distinct from old.previous_price
    or new.category is distinct from old.category or new.condition is distinct from old.condition
    or new.location is distinct from old.location
    or new.is_negotiable is distinct from old.is_negotiable;

  if new.content_revision is distinct from old.content_revision then
    raise exception using errcode = '42501', message = 'listing_revision_is_server_managed';
  end if;
  if new.moderation_feedback is distinct from old.moderation_feedback
    or new.moderation_reviewed_at is distinct from old.moderation_reviewed_at
    or new.moderation_reviewed_by is distinct from old.moderation_reviewed_by then
    raise exception using errcode = '42501', message = 'listing_moderation_metadata_is_server_managed';
  end if;
  if not content_changed then
    if new.status is distinct from old.status
      or new.submitted_for_review_at is distinct from old.submitted_for_review_at then
      raise exception using errcode = '42501', message = 'listing_status_transition_requires_rpc';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status
    and not (old.status in ('active', 'sold', 'inactive') and new.status = 'inactive') then
    raise exception using errcode = '42501', message = 'listing_status_transition_requires_rpc';
  end if;
  if new.submitted_for_review_at is distinct from old.submitted_for_review_at then
    raise exception using errcode = '42501', message = 'listing_submission_timestamp_is_server_managed';
  end if;
  new.content_revision := old.content_revision + 1;
  if old.status in ('active', 'sold', 'inactive') then
    new.status := 'inactive';
    new.submitted_for_review_at := statement_timestamp();
    new.moderation_feedback := null;
    new.moderation_reviewed_at := null;
    new.moderation_reviewed_by := null;
  end if;
  return new;
end
$function$;

create or replace function moderation_action_private.allow_listing_moderation_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  integrity_context text := coalesce(current_setting('app.listing_integrity_context', true), '');
begin
  if integrity_context not in ('trusted_moderation_decision', 'trusted_report_listing_removal') then
    return new;
  end if;
  if integrity_context = 'trusted_report_listing_removal' then
    perform moderation_action_private.require_actor('decide_reports');
  end if;
  perform moderation_action_private.require_actor('decide_listings');

  if actor_id is null or old.retired_at is not null
    or new.slug is distinct from old.slug or new.title is distinct from old.title
    or new.description is distinct from old.description or new.price is distinct from old.price
    or new.previous_price is distinct from old.previous_price
    or new.category is distinct from old.category or new.condition is distinct from old.condition
    or new.location is distinct from old.location
    or new.is_negotiable is distinct from old.is_negotiable
    or new.seller_id is distinct from old.seller_id
    or new.content_revision is distinct from old.content_revision
    or new.retired_at is distinct from old.retired_at
    or new.submitted_for_review_at is distinct from old.submitted_for_review_at
    or new.moderation_reviewed_by is distinct from actor_id
    or new.moderation_reviewed_at is null
    or (integrity_context = 'trusted_moderation_decision' and (
      old.status <> 'inactive' or old.submitted_for_review_at is null
      or new.status not in ('active', 'rejected')
      or (new.status = 'active' and new.moderation_feedback is not null)
      or (new.status = 'rejected' and char_length(btrim(coalesce(new.moderation_feedback, ''))) not between 1 and 3000)
    ))
    or (integrity_context = 'trusted_report_listing_removal' and (
      old.status <> 'active' or new.status <> 'inactive'
      or char_length(btrim(coalesce(new.moderation_feedback, ''))) not between 10 and 3000
    )) then
    raise exception using errcode = '42501', message = 'listing_moderation_transition_is_invalid';
  end if;
  return new;
end
$function$;
