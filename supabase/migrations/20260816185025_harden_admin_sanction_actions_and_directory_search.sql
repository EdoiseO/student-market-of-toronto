-- Stage 5 admin remediation: replay-safe sanction lifecycle commands with an
-- exact audit result, plus a bounded service-only global user directory.

create schema if not exists moderation_stage5_private;
revoke all on schema moderation_stage5_private from public, anon, authenticated, service_role;

create table moderation_stage5_private.sanction_action_commands (
  id uuid primary key default gen_random_uuid(),
  actor_user_id_snapshot uuid not null,
  request_id uuid not null,
  action text not null check (action in ('revoke', 'uphold', 'overturn')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  sanction_id uuid not null,
  audit_event_id uuid not null,
  completed_at timestamptz not null default statement_timestamp(),
  unique (actor_user_id_snapshot, request_id)
);

revoke all on table moderation_stage5_private.sanction_action_commands
  from public, anon, authenticated, service_role;

create function moderation_stage5_private.prevent_sanction_action_command_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception using
    errcode = '42501',
    message = 'moderation_sanction_action_command_is_immutable';
end
$function$;

alter function moderation_stage5_private.prevent_sanction_action_command_mutation()
  owner to postgres;
revoke all on function moderation_stage5_private.prevent_sanction_action_command_mutation()
  from public, anon, authenticated, service_role;

create trigger prevent_sanction_action_command_mutation
before update or delete on moderation_stage5_private.sanction_action_commands
for each row execute function moderation_stage5_private.prevent_sanction_action_command_mutation();

create function moderation_stage5_private.execute_sanction_action_impl(
  p_sanction_id uuid,
  p_action text,
  p_outcome_message text,
  p_revocation_reason text,
  p_request_id uuid
)
returns table (
  sanction_id uuid,
  audit_event_id uuid,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  preliminary public.moderation_sanctions%rowtype;
  command_row moderation_stage5_private.sanction_action_commands%rowtype;
  command_payload jsonb;
  result_sanction_id uuid;
  result_audit_event_id uuid;
  normalized_outcome_message text := nullif(btrim(p_outcome_message), '');
  normalized_revocation_reason text := nullif(btrim(p_revocation_reason), '');
begin
  if auth.role() <> 'authenticated' or actor_id is null then
    raise exception using errcode = '42501', message = 'moderation_authentication_required';
  end if;
  if p_sanction_id is null or p_request_id is null
    or p_action not in ('revoke', 'uphold', 'overturn')
    or (p_action = 'revoke' and char_length(coalesce(normalized_revocation_reason, '')) not between 10 and 1000)
    or (p_action in ('uphold', 'overturn') and char_length(coalesce(normalized_outcome_message, '')) not between 10 and 2000)
    or (p_action = 'overturn' and char_length(coalesce(normalized_revocation_reason, '')) not between 10 and 1000)
    or (p_action = 'uphold' and normalized_revocation_reason is not null)
    or (p_action = 'revoke' and normalized_outcome_message is not null) then
    raise exception using errcode = '22023', message = 'moderation_sanction_action_input_is_invalid';
  end if;

  select * into preliminary
  from public.moderation_sanctions sanction
  where sanction.id = p_sanction_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'moderation_sanction_action_not_found';
  end if;

  -- Preserve the global actor -> subject -> operation -> sanction lock order.
  actor_role := moderation_action_private.require_sanction_actor(
    preliminary.sanction_type,
    case when p_action in ('revoke', 'overturn') then 'revoke' else 'issue' end
  );
  perform moderation_action_private.assert_subject(
    preliminary.subject_user_id_snapshot,
    actor_role,
    actor_id
  );

  command_payload := jsonb_strip_nulls(jsonb_build_object(
    'sanction_id', p_sanction_id,
    'action', p_action,
    'outcome_message', normalized_outcome_message,
    'revocation_reason', normalized_revocation_reason
  ));

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      actor_id::text || ':sanction_action:' || p_request_id::text,
      0
    )
  );

  select * into command_row
  from moderation_stage5_private.sanction_action_commands command
  where command.actor_user_id_snapshot = actor_id
    and command.request_id = p_request_id
  for update;

  if found then
    if command_row.action is distinct from p_action
      or command_row.payload is distinct from command_payload then
      raise exception using
        errcode = '22023',
        message = 'moderation_sanction_action_operation_conflict';
    end if;
    return query select command_row.sanction_id, command_row.audit_event_id, true;
    return;
  end if;

  if p_action = 'revoke' then
    result_sanction_id := moderation_action_private.revoke_moderation_sanction_impl(
      p_sanction_id,
      normalized_revocation_reason
    );
  else
    result_sanction_id := moderation_action_private.decide_moderation_sanction_review_impl(
      p_sanction_id,
      case when p_action = 'uphold' then 'upheld' else 'overturned' end,
      normalized_outcome_message,
      null,
      normalized_revocation_reason
    );
  end if;

  insert into public.moderation_audit_events (
    event_type,
    actor_user_id,
    actor_user_id_snapshot,
    actor_role,
    subject_user_id,
    subject_user_id_snapshot,
    sanction_id,
    source_report_id,
    resource_type,
    resource_id,
    summary,
    metadata,
    request_id,
    occurred_at
  ) values (
    'sanction.action_completed',
    actor_id,
    actor_id,
    actor_role,
    preliminary.subject_user_id,
    preliminary.subject_user_id_snapshot,
    result_sanction_id,
    preliminary.source_report_id,
    'user',
    preliminary.subject_user_id_snapshot,
    'Replay-safe moderation sanction action completed.',
    jsonb_build_object('action', p_action, 'sanction_type', preliminary.sanction_type),
    p_request_id::text,
    statement_timestamp()
  ) returning id into result_audit_event_id;

  insert into moderation_stage5_private.sanction_action_commands (
    actor_user_id_snapshot,
    request_id,
    action,
    payload,
    sanction_id,
    audit_event_id
  ) values (
    actor_id,
    p_request_id,
    p_action,
    command_payload,
    result_sanction_id,
    result_audit_event_id
  );

  return query select result_sanction_id, result_audit_event_id, false;
end
$function$;

alter function moderation_stage5_private.execute_sanction_action_impl(
  uuid, text, text, text, uuid
) owner to postgres;
revoke all on function moderation_stage5_private.execute_sanction_action_impl(
  uuid, text, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function moderation_stage5_private.execute_sanction_action_impl(
  uuid, text, text, text, uuid
) to authenticated;

create function public.execute_moderation_sanction_action(
  p_sanction_id uuid,
  p_action text,
  p_outcome_message text default null,
  p_revocation_reason text default null,
  p_request_id uuid default null
)
returns table (
  sanction_id uuid,
  audit_event_id uuid,
  replayed boolean
)
language sql
security invoker
set search_path = ''
begin atomic
  select * from moderation_stage5_private.execute_sanction_action_impl(
    p_sanction_id,
    p_action,
    p_outcome_message,
    p_revocation_reason,
    p_request_id
  );
end;

revoke all on function public.execute_moderation_sanction_action(
  uuid, text, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.execute_moderation_sanction_action(
  uuid, text, text, text, uuid
) to authenticated;

-- Retire the non-idempotent lifecycle entry points for direct authenticated
-- callers. The new wrapper is the only supported moderation action boundary.
revoke execute on function public.revoke_moderation_sanction(uuid, text)
  from authenticated;
revoke execute on function public.decide_moderation_sanction_review(
  uuid, text, text, text, text
) from authenticated;
revoke execute on function moderation_action_private.revoke_moderation_sanction_impl(
  uuid, text
) from authenticated;
revoke execute on function moderation_action_private.decide_moderation_sanction_review_impl(
  uuid, text, text, text, text
) from authenticated;

create function moderation_stage5_private.list_admin_user_directory_impl(
  p_query text,
  p_role text,
  p_page integer,
  p_page_size integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_query text := lower(regexp_replace(btrim(coalesce(p_query, '')), '\s+', ' ', 'g'));
  normalized_role text := lower(btrim(coalesce(p_role, 'all')));
  page_number integer := coalesce(p_page, 1);
  page_size integer := coalesce(p_page_size, 50);
  result jsonb;
begin
  if auth.jwt() ->> 'role' <> 'service_role' then
    raise exception using errcode = '42501', message = 'admin_directory_service_role_required';
  end if;
  if char_length(normalized_query) > 100
    or normalized_role not in ('all', 'standard', 'admin', 'moderator', 'staff')
    or page_number not between 1 and 10000
    or page_size not between 1 and 50 then
    raise exception using errcode = '22023', message = 'admin_directory_query_is_invalid';
  end if;

  with scoped_accounts as materialized (
    select account.*
    from auth.users account
    order by account.created_at desc, account.id desc
    limit 5000
  ), directory as materialized (
    select
      account.id,
      account.email,
      account.created_at,
      account.last_sign_in_at,
      account.email_confirmed_at,
      account.banned_until as auth_banned_until,
      profile.first_name,
      profile.last_name,
      profile.school,
      (profile.id is not null) as profile_exists,
      status.is_banned,
      status.banned_until,
      status.ban_reason,
      status.updated_at as status_updated_at,
      coalesce(account.raw_app_meta_data -> 'force_name_change', 'false'::jsonb) = 'true'::jsonb
        as force_name_change,
      moderation_action_private.resolve_role_from_account(
        account.raw_app_meta_data,
        account.role
      ) as moderation_role
    from scoped_accounts account
    left join public.profiles profile on profile.id = account.id
    left join public.user_status status on status.user_id = account.id
  ), filtered as materialized (
    select *
    from directory entry
    where (
      normalized_role = 'all'
      or (normalized_role = 'standard' and entry.moderation_role is null)
      or entry.moderation_role = normalized_role
    )
    and (
      normalized_query = ''
      or strpos(
        lower(concat_ws(
          ' ',
          entry.id::text,
          entry.email,
          entry.first_name,
          entry.last_name,
          entry.school
        )),
        normalized_query
      ) > 0
    )
  ), page_rows as (
    select *
    from filtered
    order by created_at desc, id desc
    limit page_size
    offset ((page_number - 1) * page_size)
  )
  select jsonb_build_object(
    'users', coalesce(
      (
        select jsonb_agg(to_jsonb(page_row) order by page_row.created_at desc, page_row.id desc)
        from page_rows page_row
      ),
      '[]'::jsonb
    ),
    'total', (select count(*) from filtered),
    'page', page_number,
    'pageSize', page_size,
    'scopeLimit', 5000
  ) into result;

  return result;
end
$function$;

alter function moderation_stage5_private.list_admin_user_directory_impl(
  text, text, integer, integer
) owner to postgres;
revoke all on function moderation_stage5_private.list_admin_user_directory_impl(
  text, text, integer, integer
) from public, anon, authenticated, service_role;
grant execute on function moderation_stage5_private.list_admin_user_directory_impl(
  text, text, integer, integer
) to service_role;

create function public.list_admin_user_directory(
  p_query text default '',
  p_role text default 'all',
  p_page integer default 1,
  p_page_size integer default 50
)
returns jsonb
language sql
security invoker
set search_path = ''
begin atomic
  select moderation_stage5_private.list_admin_user_directory_impl(
    p_query,
    p_role,
    p_page,
    p_page_size
  );
end;

revoke all on function public.list_admin_user_directory(text, text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_admin_user_directory(text, text, integer, integer)
  to service_role;
