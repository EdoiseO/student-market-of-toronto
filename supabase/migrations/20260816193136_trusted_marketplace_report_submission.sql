-- Trusted marketplace report submission.
--
-- The browser supplies only a subject type/id, reason, optional bounded detail,
-- and a stable operation id.  The database derives every relationship and the
-- reporter from locked canonical rows.  Exact retries replay the original row.

create schema if not exists report_submission_private;
revoke all on schema report_submission_private
  from public, anon, authenticated, service_role;
create schema if not exists private;

-- Canonical prose normalization shared by the Stage 6 trusted writers.
-- Normalize platform line endings first, then trim the ECMAScript whitespace
-- and line-terminator set used by the browser contract. PostgreSQL's
-- one-argument btrim only removes spaces and would otherwise accept invisible
-- Unicode edge whitespace as satisfying a minimum length.
create or replace function private.normalize_user_prose(p_value text)
returns text
language sql
immutable
security invoker
set search_path = ''
begin atomic
  select pg_catalog.btrim(
    pg_catalog.replace(
      pg_catalog.replace(coalesce(p_value, ''), E'\r\n', E'\n'),
      E'\r',
      E'\n'
    ),
    E'\t\n\f\r ' || pg_catalog.chr(11)
      || pg_catalog.convert_from(pg_catalog.decode(
        'c2a0e19a80e28080e28081e28082e28083e28084e28085e28086e28087e28088e28089e2808ae280a8e280a9e280afe2819fe38080efbbbf',
        'hex'
      ), 'UTF8')
  );
end;

alter function private.normalize_user_prose(text) owner to postgres;
revoke all on function private.normalize_user_prose(text)
  from public, anon, authenticated, service_role;

create table report_submission_private.commands (
  id uuid primary key default gen_random_uuid(),
  actor_user_id_snapshot uuid not null,
  operation_id uuid not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  report_id uuid not null,
  result jsonb not null check (
    jsonb_typeof(result) = 'object'
    and result ? 'id'
    and result ? 'status'
    and result - array['id', 'status'] = '{}'::jsonb
  ),
  completed_at timestamptz not null default now(),
  constraint report_submission_commands_actor_operation_key
    unique (actor_user_id_snapshot, operation_id)
);

alter table report_submission_private.commands owner to postgres;
revoke all on table report_submission_private.commands
  from public, anon, authenticated, service_role;

create or replace function report_submission_private.submit_marketplace_report_impl(
  p_subject_type text,
  p_subject_id uuid,
  p_reason text,
  p_details text,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  normalized_subject_type text := lower(btrim(coalesce(p_subject_type, '')));
  normalized_reason text := lower(btrim(coalesce(p_reason, '')));
  normalized_details text := nullif(private.normalize_user_prose(p_details), '');
  canonical_payload jsonb;
  canonical_result jsonb;
  existing_command report_submission_private.commands%rowtype;
  report_row public.reports%rowtype;
  listing_row public.listings%rowtype;
  message_row public.messages%rowtype;
  conversation_row public.conversations%rowtype;
  target_user_id uuid;
  derived_listing_id uuid;
  derived_message_id uuid;
  derived_conversation_id uuid;
  allowed_reasons text[];
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' or actor_id is null then
    raise exception using errcode = '42501', message = 'report_authentication_required';
  end if;

  if p_operation_id is null or p_subject_id is null
    or normalized_subject_type not in ('listing', 'message', 'profile') then
    raise exception using errcode = '22023', message = 'report_submission_invalid';
  end if;

  allowed_reasons := case normalized_subject_type
    when 'listing' then array['spam', 'scam', 'misleading', 'prohibited', 'harassment', 'other']
    else array['spam', 'scam', 'harassment', 'inappropriate', 'other']
  end;

  if not (normalized_reason = any (allowed_reasons))
    or char_length(coalesce(normalized_details, '')) > 600
    or (
      normalized_reason = 'other'
      and char_length(coalesce(normalized_details, '')) not between 10 and 600
    ) then
    raise exception using errcode = '22023', message = 'report_details_invalid';
  end if;

  canonical_payload := jsonb_strip_nulls(jsonb_build_object(
    'subject_type', normalized_subject_type,
    'subject_id', p_subject_id,
    'reason', normalized_reason,
    'details', normalized_details
  ));

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || ':report:' || p_operation_id::text, 0)
  );

  select * into existing_command
  from report_submission_private.commands command
  where command.actor_user_id_snapshot = actor_id
    and command.operation_id = p_operation_id
  for update;

  if found then
    if existing_command.payload is distinct from canonical_payload then
      raise exception using errcode = '22023', message = 'report_operation_payload_conflict';
    end if;

    return existing_command.result;
  end if;

  -- A committed command is authoritative even if the actor is banned or
  -- removed before an ambiguous client response is retried. New operations
  -- still lock and verify the live actor before reading any subject state.
  perform 1 from auth.users account where account.id = actor_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'report_actor_not_found';
  end if;

  if exists (
    select 1
    from public.user_status status
    where status.user_id = actor_id
      and status.is_banned
      and (status.banned_until is null or status.banned_until > statement_timestamp())
  ) then
    raise exception using errcode = '42501', message = 'account_banned';
  end if;

  if normalized_subject_type = 'listing' then
    select * into listing_row
    from public.listings listing
    where listing.id = p_subject_id
      and listing.retired_at is null
      and listing.status = 'active'
    for share;

    if not found then
      raise exception using errcode = 'P0002', message = 'report_subject_not_found';
    end if;

    target_user_id := listing_row.seller_id;
    derived_listing_id := listing_row.id;
  elsif normalized_subject_type = 'message' then
    select * into message_row
    from public.messages message
    where message.id = p_subject_id
    for share;

    if not found or message_row.sender_id is null then
      raise exception using errcode = 'P0002', message = 'report_subject_not_found';
    end if;

    select * into conversation_row
    from public.conversations conversation
    where conversation.id = message_row.conversation_id
    for share;

    if not found
      or (
        actor_id is distinct from conversation_row.buyer_id
        and actor_id is distinct from conversation_row.seller_id
      ) then
      raise exception using errcode = '42501', message = 'report_subject_access_denied';
    end if;

    target_user_id := message_row.sender_id;
    derived_message_id := message_row.id;
    derived_conversation_id := conversation_row.id;
    derived_listing_id := conversation_row.listing_id;
  else
    perform 1
    from public.profiles profile
    join auth.users account on account.id = profile.id
    where profile.id = p_subject_id
    for share of profile, account;
    if not found then
      raise exception using errcode = 'P0002', message = 'report_subject_not_found';
    end if;
    target_user_id := p_subject_id;
  end if;

  if target_user_id is null or target_user_id = actor_id then
    raise exception using errcode = '22023', message = 'report_self_submission_not_allowed';
  end if;

  insert into public.reports (
    reporter_user_id,
    subject_type,
    subject_id,
    listing_id,
    message_id,
    conversation_id,
    reported_user_id,
    reason,
    details,
    status
  ) values (
    actor_id,
    normalized_subject_type,
    p_subject_id,
    derived_listing_id,
    derived_message_id,
    derived_conversation_id,
    target_user_id,
    normalized_reason,
    normalized_details,
    'open'
  )
  returning * into report_row;

  canonical_result := jsonb_build_object(
    'id', report_row.id,
    'status', report_row.status
  );

  insert into report_submission_private.commands (
    actor_user_id_snapshot,
    operation_id,
    payload,
    report_id,
    result
  ) values (
    actor_id,
    p_operation_id,
    canonical_payload,
    report_row.id,
    canonical_result
  );

  return canonical_result;
end
$function$;

alter function report_submission_private.submit_marketplace_report_impl(
  text, uuid, text, text, uuid
) owner to postgres;
revoke all on function report_submission_private.submit_marketplace_report_impl(
  text, uuid, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function report_submission_private.submit_marketplace_report_impl(
  text, uuid, text, text, uuid
) to authenticated;

create or replace function public.submit_marketplace_report(
  p_subject_type text,
  p_subject_id uuid,
  p_reason text,
  p_details text,
  p_operation_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
begin atomic
  select report_submission_private.submit_marketplace_report_impl(
    p_subject_type,
    p_subject_id,
    p_reason,
    p_details,
    p_operation_id
  );
end;

revoke all on function public.submit_marketplace_report(text, uuid, text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_marketplace_report(text, uuid, text, text, uuid)
  to authenticated;

comment on function public.submit_marketplace_report(text, uuid, text, text, uuid) is
  'Creates an idempotent report whose actor and subject relationships are derived from canonical locked rows.';
