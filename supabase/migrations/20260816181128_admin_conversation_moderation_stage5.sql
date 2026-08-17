-- Stage 5: bounded admin conversation inspection and idempotent moderation.
--
-- The public functions are invoker wrappers callable only with the service
-- role. Their postgres-owned implementations independently resolve the named
-- actor from live Auth/app metadata and reject actively banned moderators.
-- Conversation state changes still flow through the existing trusted,
-- versioned transition implementation so state, participant-safe history,
-- canonical audit, and notification signals commit together.

create schema if not exists conversation_admin_private;
revoke all on schema conversation_admin_private
  from public, anon, authenticated, service_role;

create table conversation_admin_private.moderation_commands (
  id uuid primary key default gen_random_uuid(),
  actor_user_id_snapshot uuid not null,
  conversation_id_snapshot uuid not null,
  operation_id uuid not null,
  action text not null,
  payload jsonb not null,
  result jsonb not null,
  completed_at timestamptz not null default statement_timestamp(),
  constraint conversation_admin_commands_actor_operation_key
    unique (actor_user_id_snapshot, operation_id),
  constraint conversation_admin_commands_action_check
    check (action in ('close', 'reopen')),
  constraint conversation_admin_commands_payload_check
    check (jsonb_typeof(payload) = 'object'),
  constraint conversation_admin_commands_result_check
    check (jsonb_typeof(result) = 'object')
);

revoke all on table conversation_admin_private.moderation_commands
  from public, anon, authenticated, service_role;

comment on table conversation_admin_private.moderation_commands is
  'Actor-scoped exact-operation replay ledger for conversation close/reopen commands. Rows intentionally retain UUID snapshots without cascading foreign keys.';

create index if not exists reports_conversation_status_created_idx
  on public.reports (conversation_id, status, created_at desc, id desc)
  where conversation_id is not null;

create index if not exists conversations_admin_activity_idx
  on public.conversations (
    (greatest(created_at, updated_at, last_message_at)) desc,
    id desc
  )
  where listing_id is not null;

create or replace function conversation_admin_private.resolve_actor_role(
  p_actor_id uuid,
  p_action text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_role text;
  actor_banned_until timestamptz;
  checked_at timestamptz := statement_timestamp();
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
    or p_actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'conversation_admin_service_authentication_required';
  end if;

  select
    moderation_action_private.resolve_role_from_account(
      account.raw_app_meta_data,
      account.role
    ),
    account.banned_until
  into actor_role, actor_banned_until
  from auth.users account
  where account.id = p_actor_id;

  if not found
    or actor_banned_until > checked_at
    or exists (
      select 1
      from public.user_status status
      where status.user_id = p_actor_id
        and status.is_banned
        and (status.banned_until is null or status.banned_until > checked_at)
    ) then
    raise exception using
      errcode = '42501',
      message = 'conversation_admin_actor_unavailable';
  end if;

  if not (
    case p_action
      when 'read_conversations' then actor_role in ('admin', 'moderator')
      when 'close_chat_temporarily' then actor_role in ('admin', 'moderator')
      when 'close_chat_permanently' then actor_role = 'admin'
      when 'reopen_chat' then actor_role in ('admin', 'moderator')
      when 'decide_reports' then actor_role in ('admin', 'moderator')
      else false
    end
  ) then
    raise exception using
      errcode = '42501',
      message = 'conversation_admin_action_not_permitted';
  end if;

  return actor_role;
end
$function$;

alter function conversation_admin_private.resolve_actor_role(uuid, text)
  owner to postgres;
revoke all on function conversation_admin_private.resolve_actor_role(uuid, text)
  from public, anon, authenticated, service_role;

create or replace function conversation_admin_private.list_conversations_impl(
  p_actor_id uuid,
  p_filter text default 'all',
  p_search text default '',
  p_page integer default 1,
  p_page_size integer default 25
)
returns table (
  conversation_id uuid,
  listing_id uuid,
  listing_slug text,
  listing_title text,
  listing_status text,
  buyer_id uuid,
  buyer_first_name text,
  buyer_last_name text,
  buyer_school text,
  buyer_avatar_preset_id text,
  buyer_avatar_url text,
  seller_id uuid,
  seller_first_name text,
  seller_last_name text,
  seller_school text,
  seller_avatar_preset_id text,
  seller_avatar_url text,
  recorded_status text,
  effective_status text,
  state_version bigint,
  closed_until timestamptz,
  reason_code text,
  user_message text,
  changed_at timestamptz,
  last_action text,
  last_activity_at timestamptz,
  last_message_preview text,
  open_report_count bigint,
  total_report_count bigint,
  total_count bigint,
  registry_truncated boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  normalized_filter text := lower(trim(coalesce(p_filter, 'all')));
  normalized_search text := lower(trim(coalesce(p_search, '')));
  normalized_page integer := greatest(coalesce(p_page, 1), 1);
  normalized_page_size integer := least(greatest(coalesce(p_page_size, 25), 1), 50);
begin
  perform conversation_admin_private.resolve_actor_role(
    p_actor_id,
    'read_conversations'
  );

  if normalized_filter not in ('all', 'open', 'closed', 'reopened', 'reported')
    or char_length(normalized_search) > 100
    or normalized_page > 1000 then
    raise exception using
      errcode = '22023',
      message = 'conversation_admin_registry_input_invalid';
  end if;

  return query
  -- Search/filter work is intentionally capped to the newest 2,000 listing
  -- conversations. The extra candidate detects truncation without letting a
  -- substring search fan out across an unbounded marketplace history.
  with candidate_rows as materialized (
    select
      conversation.id,
      greatest(
        conversation.created_at,
        conversation.updated_at,
        conversation.last_message_at
      ) as last_activity_at
    from public.conversations conversation
    where conversation.listing_id is not null
    order by last_activity_at desc, conversation.id desc
    limit 2001
  ), candidate_ids as materialized (
    select
      candidate.id,
      candidate.last_activity_at,
      row_number() over (
        order by candidate.last_activity_at desc, candidate.id desc
      ) as candidate_rank
    from candidate_rows candidate
  ), registry as (
    select
      conversation.id as conversation_id,
      conversation.listing_id,
      listing.slug as listing_slug,
      listing.title as listing_title,
      listing.status as listing_status,
      conversation.buyer_id,
      buyer.first_name as buyer_first_name,
      buyer.last_name as buyer_last_name,
      buyer.school as buyer_school,
      buyer.avatar_preset_id as buyer_avatar_preset_id,
      buyer.avatar_url as buyer_avatar_url,
      conversation.seller_id,
      seller.first_name as seller_first_name,
      seller.last_name as seller_last_name,
      seller.school as seller_school,
      seller.avatar_preset_id as seller_avatar_preset_id,
      seller.avatar_url as seller_avatar_url,
      state.status as recorded_status,
      case
        when state.status = 'closed'
          and (state.closed_until is null or state.closed_until > statement_timestamp())
          then 'closed'
        else 'open'
      end as effective_status,
      state.version as state_version,
      state.closed_until,
      state.reason_code,
      state.user_message,
      state.changed_at,
      latest_history.action as last_action,
      candidate.last_activity_at,
      left(coalesce(conversation.last_message_preview, ''), 180) as last_message_preview,
      report_counts.open_report_count,
      report_counts.total_report_count
    from candidate_ids candidate
    join public.conversations conversation
      on conversation.id = candidate.id
      and candidate.candidate_rank <= 2000
    join public.conversation_moderation_state state
      on state.conversation_id = conversation.id
    left join public.listings listing
      on listing.id = conversation.listing_id
    left join public.profiles buyer
      on buyer.id = conversation.buyer_id
    left join public.profiles seller
      on seller.id = conversation.seller_id
    left join lateral (
      select history.action
      from public.conversation_moderation_history history
      where history.conversation_id = conversation.id
      order by history.state_version desc
      limit 1
    ) latest_history on true
    cross join lateral (
      select
        count(*) filter (where report.status = 'open')::bigint as open_report_count,
        count(*)::bigint as total_report_count
      from public.reports report
      where report.conversation_id = conversation.id
    ) report_counts
    where conversation.listing_id is not null
  ), filtered as (
    select registry.*
    from registry
    where (
      normalized_filter = 'all'
      or (normalized_filter = 'open' and registry.effective_status = 'open')
      or (normalized_filter = 'closed' and registry.effective_status = 'closed')
      or (normalized_filter = 'reopened' and registry.last_action = 'reopen')
      or (normalized_filter = 'reported' and registry.open_report_count > 0)
    )
    and (
      normalized_search = ''
      or position(normalized_search in lower(concat_ws(
        ' ',
        registry.conversation_id::text,
        registry.listing_title,
        registry.buyer_first_name,
        registry.buyer_last_name,
        registry.buyer_school,
        registry.seller_first_name,
        registry.seller_last_name,
        registry.seller_school
      ))) > 0
    )
  )
  select
    filtered.conversation_id,
    filtered.listing_id,
    filtered.listing_slug,
    filtered.listing_title,
    filtered.listing_status,
    filtered.buyer_id,
    filtered.buyer_first_name,
    filtered.buyer_last_name,
    filtered.buyer_school,
    filtered.buyer_avatar_preset_id,
    filtered.buyer_avatar_url,
    filtered.seller_id,
    filtered.seller_first_name,
    filtered.seller_last_name,
    filtered.seller_school,
    filtered.seller_avatar_preset_id,
    filtered.seller_avatar_url,
    filtered.recorded_status,
    filtered.effective_status,
    filtered.state_version,
    filtered.closed_until,
    filtered.reason_code,
    filtered.user_message,
    filtered.changed_at,
    filtered.last_action,
    filtered.last_activity_at,
    filtered.last_message_preview,
    filtered.open_report_count,
    filtered.total_report_count,
    count(*) over()::bigint as total_count,
    exists (
      select 1
      from candidate_ids candidate
      where candidate.candidate_rank = 2001
    ) as registry_truncated
  from filtered
  order by filtered.last_activity_at desc, filtered.conversation_id desc
  offset (normalized_page - 1) * normalized_page_size
  limit normalized_page_size;
end
$function$;

create or replace function conversation_admin_private.get_conversation_detail_impl(
  p_actor_id uuid,
  p_conversation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  detail jsonb;
begin
  perform conversation_admin_private.resolve_actor_role(
    p_actor_id,
    'read_conversations'
  );

  select jsonb_build_object(
    'conversationId', conversation.id,
    'createdAt', conversation.created_at,
    'updatedAt', conversation.updated_at,
    'lastMessageAt', conversation.last_message_at,
    'lastMessagePreview', left(coalesce(conversation.last_message_preview, ''), 180),
    'listing', jsonb_strip_nulls(jsonb_build_object(
      'id', listing.id,
      'slug', listing.slug,
      'title', listing.title,
      'status', listing.status,
      'location', listing.location
    )),
    'buyer', jsonb_strip_nulls(jsonb_build_object(
      'id', buyer.id,
      'firstName', buyer.first_name,
      'lastName', buyer.last_name,
      'school', buyer.school,
      'avatarPresetId', buyer.avatar_preset_id,
      'avatarUrl', buyer.avatar_url
    )),
    'seller', jsonb_strip_nulls(jsonb_build_object(
      'id', seller.id,
      'firstName', seller.first_name,
      'lastName', seller.last_name,
      'school', seller.school,
      'avatarPresetId', seller.avatar_preset_id,
      'avatarUrl', seller.avatar_url
    )),
    'moderationState', jsonb_build_object(
      'version', state.version,
      'recordedStatus', state.status,
      'effectiveStatus', case
        when state.status = 'closed'
          and (state.closed_until is null or state.closed_until > statement_timestamp())
          then 'closed'
        else 'open'
      end,
      'closedUntil', state.closed_until,
      'reasonCode', state.reason_code,
      'userMessage', state.user_message,
      'changedAt', state.changed_at
    ),
    'history', coalesce((
      select jsonb_agg(to_jsonb(history_page) order by history_page.state_version desc)
      from (
        select
          history.id,
          history.state_version,
          history.action,
          history.previous_status,
          history.new_status,
          history.previous_closed_until,
          history.new_closed_until,
          history.reason_code,
          history.user_message,
          history.created_at
        from public.conversation_moderation_history history
        where history.conversation_id = conversation.id
        order by history.state_version desc
        limit 20
      ) history_page
    ), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(to_jsonb(report_page) order by report_page.created_at desc)
      from (
        select
          report.id,
          report.subject_type,
          report.subject_id,
          report.message_id,
          report.reported_user_id,
          report.reason,
          report.details,
          report.status,
          report.created_at,
          report.reviewed_at
        from public.reports report
        where report.conversation_id = conversation.id
        order by report.created_at desc, report.id desc
        limit 25
      ) report_page
    ), '[]'::jsonb)
  )
  into detail
  from public.conversations conversation
  join public.conversation_moderation_state state
    on state.conversation_id = conversation.id
  left join public.listings listing
    on listing.id = conversation.listing_id
  left join public.profiles buyer
    on buyer.id = conversation.buyer_id
  left join public.profiles seller
    on seller.id = conversation.seller_id
  where conversation.id = p_conversation_id
    and conversation.listing_id is not null;

  if detail is null then
    raise exception using
      errcode = 'P0002',
      message = 'conversation_admin_conversation_not_found';
  end if;

  return detail;
end
$function$;

create or replace function conversation_admin_private.get_message_page_impl(
  p_actor_id uuid,
  p_conversation_id uuid,
  p_before_created_at timestamptz default null,
  p_before_message_id uuid default null,
  p_limit integer default 41
)
returns table (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  sender_first_name text,
  sender_last_name text,
  sender_avatar_preset_id text,
  sender_avatar_url text,
  attachments jsonb,
  reactions jsonb,
  report_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  page_limit integer := least(greatest(coalesce(p_limit, 41), 1), 51);
begin
  perform conversation_admin_private.resolve_actor_role(
    p_actor_id,
    'read_conversations'
  );

  if not exists (
    select 1
    from public.conversations conversation
    where conversation.id = p_conversation_id
      and conversation.listing_id is not null
  ) then
    raise exception using
      errcode = 'P0002',
      message = 'conversation_admin_conversation_not_found';
  end if;

  return query
  select
    message.id,
    message.conversation_id,
    message.sender_id,
    message.body,
    message.created_at,
    sender.first_name,
    sender.last_name,
    sender.avatar_preset_id,
    sender.avatar_url,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', attachment.id,
          'message_id', attachment.message_id,
          'storage_path', attachment.storage_path,
          'file_name', attachment.file_name,
          'mime_type', attachment.mime_type,
          'size_bytes', attachment.size_bytes,
          'created_at', attachment.created_at
        ) order by attachment.created_at, attachment.id
      )
      from public.message_attachments attachment
      where attachment.message_id = message.id
        and attachment.conversation_id = p_conversation_id
    ), '[]'::jsonb) as attachments,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'user_id', reaction.user_id,
          'emoji', reaction.emoji,
          'created_at', reaction.created_at
        ) order by reaction.created_at, reaction.user_id
      )
      from public.message_reactions reaction
      where reaction.message_id = message.id
        and reaction.conversation_id = p_conversation_id
        and reaction.removed_at is null
    ), '[]'::jsonb) as reactions,
    (
      select count(*)::bigint
      from public.reports report
      where report.conversation_id = p_conversation_id
        and report.message_id = message.id
    ) as report_count
  from public.messages message
  left join public.profiles sender
    on sender.id = message.sender_id
  where message.conversation_id = p_conversation_id
    and (
      p_before_created_at is null
      or p_before_message_id is null
      or (message.created_at, message.id) < (p_before_created_at, p_before_message_id)
    )
  order by message.created_at desc, message.id desc
  limit page_limit;
end
$function$;

create or replace function conversation_admin_private.moderate_conversation_impl(
  p_actor_id uuid,
  p_conversation_id uuid,
  p_expected_version bigint,
  p_action text,
  p_reason_code text,
  p_user_message text,
  p_duration text,
  p_internal_note text,
  p_source_report_id uuid,
  p_resolve_source_report boolean,
  p_operation_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  normalized_action text := lower(trim(coalesce(p_action, '')));
  normalized_duration text := lower(trim(coalesce(p_duration, '')));
  actor_role text;
  command_payload jsonb;
  existing_command conversation_admin_private.moderation_commands%rowtype;
  transitioned_state public.conversation_moderation_state%rowtype;
  closed_until timestamptz;
  resolved_report_count integer := 0;
  report_row public.reports%rowtype;
  result jsonb;
  changed_at timestamptz := statement_timestamp();
begin
  if p_operation_id is null then
    raise exception using
      errcode = '22023',
      message = 'conversation_admin_operation_id_required';
  end if;

  if normalized_action not in ('close', 'reopen')
    or p_expected_version is null
    or p_expected_version < 0
    or (p_resolve_source_report and p_source_report_id is null) then
    raise exception using
      errcode = '22023',
      message = 'conversation_admin_command_invalid';
  end if;

  if normalized_action = 'close' then
    if normalized_duration not in ('24h', '7d', '30d', 'permanent') then
      raise exception using
        errcode = '22023',
        message = 'conversation_admin_duration_invalid';
    end if;
  elsif normalized_duration <> '' then
    raise exception using
      errcode = '22023',
      message = 'conversation_admin_reopen_duration_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_actor_id::text || ':conversation_moderation:' || p_operation_id::text,
      0
    )
  );

  command_payload := jsonb_strip_nulls(jsonb_build_object(
    'conversation_id', p_conversation_id,
    'expected_version', p_expected_version,
    'action', normalized_action,
    'reason_code', lower(trim(coalesce(p_reason_code, ''))),
    'user_message', trim(coalesce(p_user_message, '')),
    'duration', nullif(normalized_duration, ''),
    'internal_note', nullif(trim(coalesce(p_internal_note, '')), ''),
    'source_report_id', p_source_report_id,
    'resolve_source_report', coalesce(p_resolve_source_report, false)
  ));

  select command.*
  into existing_command
  from conversation_admin_private.moderation_commands command
  where command.actor_user_id_snapshot = p_actor_id
    and command.operation_id = p_operation_id
  for update;

  if found then
    if existing_command.action is distinct from normalized_action
      or existing_command.conversation_id_snapshot is distinct from p_conversation_id
      or existing_command.payload is distinct from command_payload then
      raise exception using
        errcode = '22023',
        message = 'conversation_admin_operation_payload_conflict';
    end if;

    return existing_command.result || jsonb_build_object('idempotentReplay', true);
  end if;

  -- Serialize live actor-role/ban changes before the conversation transition.
  perform 1
  from auth.users account
  where account.id = p_actor_id
  for update;

  actor_role := conversation_admin_private.resolve_actor_role(
    p_actor_id,
    case
      when normalized_action = 'reopen' then 'reopen_chat'
      when normalized_duration = 'permanent' then 'close_chat_permanently'
      else 'close_chat_temporarily'
    end
  );

  if p_resolve_source_report then
    perform conversation_admin_private.resolve_actor_role(
      p_actor_id,
      'decide_reports'
    );
  end if;

  if normalized_action = 'close' then
    closed_until := case normalized_duration
      when '24h' then changed_at + interval '24 hours'
      when '7d' then changed_at + interval '7 days'
      when '30d' then changed_at + interval '30 days'
      else null
    end;
  else
    closed_until := null;
  end if;

  if p_source_report_id is not null then
    select report.*
    into report_row
    from public.reports report
    where report.id = p_source_report_id
      and report.conversation_id = p_conversation_id
    for update;

    if not found then
      raise exception using
        errcode = '23503',
        message = 'conversation_admin_source_report_mismatch';
    end if;

    if p_resolve_source_report and report_row.status <> 'open' then
      raise exception using
        errcode = '40001',
        message = 'conversation_admin_source_report_changed';
    end if;
  end if;

  select state.*
  into transitioned_state
  from conversation_moderation_private.transition_conversation_moderation_state_impl(
    p_conversation_id,
    p_expected_version,
    normalized_action,
    p_reason_code,
    p_user_message,
    p_actor_id,
    closed_until,
    p_internal_note,
    p_source_report_id,
    p_operation_id::text
  ) state;

  if p_resolve_source_report then
    update public.reports report
    set
      status = 'resolved',
      reviewed_by = p_actor_id,
      reviewed_at = changed_at
    where report.id = p_source_report_id
      and report.status = 'open';

    get diagnostics resolved_report_count = row_count;

    if resolved_report_count <> 1 then
      raise exception using
        errcode = '40001',
        message = 'conversation_admin_source_report_changed';
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
      p_actor_id,
      p_actor_id,
      actor_role,
      report_row.reported_user_id,
      report_row.reported_user_id,
      report_row.id,
      report_row.subject_type,
      coalesce(
        report_row.subject_id,
        report_row.listing_id,
        report_row.message_id,
        report_row.reported_user_id
      ),
      'Conversation-linked report was resolved with the moderation action.',
      jsonb_build_object(
        'report_ids', jsonb_build_array(report_row.id),
        'status', 'resolved',
        'conversation_id', p_conversation_id
      ),
      p_operation_id::text || ':report',
      changed_at
    );
  end if;

  result := jsonb_build_object(
    'conversationId', transitioned_state.conversation_id,
    'version', transitioned_state.version,
    'recordedStatus', transitioned_state.status,
    'effectiveStatus', case
      when transitioned_state.status = 'closed'
        and (
          transitioned_state.closed_until is null
          or transitioned_state.closed_until > changed_at
        ) then 'closed'
      else 'open'
    end,
    'closedUntil', transitioned_state.closed_until,
    'reasonCode', transitioned_state.reason_code,
    'userMessage', transitioned_state.user_message,
    'changedAt', transitioned_state.changed_at,
    'resolvedReportCount', resolved_report_count,
    'idempotentReplay', false
  );

  insert into conversation_admin_private.moderation_commands (
    actor_user_id_snapshot,
    conversation_id_snapshot,
    operation_id,
    action,
    payload,
    result,
    completed_at
  ) values (
    p_actor_id,
    p_conversation_id,
    p_operation_id,
    normalized_action,
    command_payload,
    result,
    changed_at
  );

  return result;
end
$function$;

alter function conversation_admin_private.list_conversations_impl(uuid, text, text, integer, integer)
  owner to postgres;
alter function conversation_admin_private.get_conversation_detail_impl(uuid, uuid)
  owner to postgres;
alter function conversation_admin_private.get_message_page_impl(uuid, uuid, timestamptz, uuid, integer)
  owner to postgres;
alter function conversation_admin_private.moderate_conversation_impl(uuid, uuid, bigint, text, text, text, text, text, uuid, boolean, uuid)
  owner to postgres;

revoke all on function conversation_admin_private.list_conversations_impl(uuid, text, text, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function conversation_admin_private.get_conversation_detail_impl(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function conversation_admin_private.get_message_page_impl(uuid, uuid, timestamptz, uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function conversation_admin_private.moderate_conversation_impl(uuid, uuid, bigint, text, text, text, text, text, uuid, boolean, uuid)
  from public, anon, authenticated, service_role;

-- Parsed invoker wrappers need EXECUTE on the hidden OIDs. Schema USAGE stays
-- revoked, so service clients cannot resolve the implementations by name.
grant execute on function conversation_admin_private.list_conversations_impl(uuid, text, text, integer, integer)
  to service_role;
grant execute on function conversation_admin_private.get_conversation_detail_impl(uuid, uuid)
  to service_role;
grant execute on function conversation_admin_private.get_message_page_impl(uuid, uuid, timestamptz, uuid, integer)
  to service_role;
grant execute on function conversation_admin_private.moderate_conversation_impl(uuid, uuid, bigint, text, text, text, text, text, uuid, boolean, uuid)
  to service_role;

create or replace function public.admin_list_conversations(
  p_actor_id uuid,
  p_filter text default 'all',
  p_search text default '',
  p_page integer default 1,
  p_page_size integer default 25
)
returns table (
  conversation_id uuid,
  listing_id uuid,
  listing_slug text,
  listing_title text,
  listing_status text,
  buyer_id uuid,
  buyer_first_name text,
  buyer_last_name text,
  buyer_school text,
  buyer_avatar_preset_id text,
  buyer_avatar_url text,
  seller_id uuid,
  seller_first_name text,
  seller_last_name text,
  seller_school text,
  seller_avatar_preset_id text,
  seller_avatar_url text,
  recorded_status text,
  effective_status text,
  state_version bigint,
  closed_until timestamptz,
  reason_code text,
  user_message text,
  changed_at timestamptz,
  last_action text,
  last_activity_at timestamptz,
  last_message_preview text,
  open_report_count bigint,
  total_report_count bigint,
  total_count bigint,
  registry_truncated boolean
)
language sql
security invoker
set search_path = ''
begin atomic
  select *
  from conversation_admin_private.list_conversations_impl(
    p_actor_id,
    p_filter,
    p_search,
    p_page,
    p_page_size
  );
end;

create or replace function public.admin_get_conversation_detail(
  p_actor_id uuid,
  p_conversation_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
begin atomic
  select conversation_admin_private.get_conversation_detail_impl(
    p_actor_id,
    p_conversation_id
  );
end;

create or replace function public.admin_get_conversation_message_page(
  p_actor_id uuid,
  p_conversation_id uuid,
  p_before_created_at timestamptz default null,
  p_before_message_id uuid default null,
  p_limit integer default 41
)
returns table (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  sender_first_name text,
  sender_last_name text,
  sender_avatar_preset_id text,
  sender_avatar_url text,
  attachments jsonb,
  reactions jsonb,
  report_count bigint
)
language sql
security invoker
set search_path = ''
begin atomic
  select *
  from conversation_admin_private.get_message_page_impl(
    p_actor_id,
    p_conversation_id,
    p_before_created_at,
    p_before_message_id,
    p_limit
  );
end;

create or replace function public.admin_moderate_conversation(
  p_actor_id uuid,
  p_conversation_id uuid,
  p_expected_version bigint,
  p_action text,
  p_reason_code text,
  p_user_message text,
  p_duration text default '',
  p_internal_note text default null,
  p_source_report_id uuid default null,
  p_resolve_source_report boolean default false,
  p_operation_id uuid default null
)
returns jsonb
language sql
security invoker
set search_path = ''
begin atomic
  select conversation_admin_private.moderate_conversation_impl(
    p_actor_id,
    p_conversation_id,
    p_expected_version,
    p_action,
    p_reason_code,
    p_user_message,
    p_duration,
    p_internal_note,
    p_source_report_id,
    p_resolve_source_report,
    p_operation_id
  );
end;

alter function public.admin_list_conversations(uuid, text, text, integer, integer)
  owner to postgres;
alter function public.admin_get_conversation_detail(uuid, uuid)
  owner to postgres;
alter function public.admin_get_conversation_message_page(uuid, uuid, timestamptz, uuid, integer)
  owner to postgres;
alter function public.admin_moderate_conversation(uuid, uuid, bigint, text, text, text, text, text, uuid, boolean, uuid)
  owner to postgres;

revoke all on function public.admin_list_conversations(uuid, text, text, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_get_conversation_detail(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_get_conversation_message_page(uuid, uuid, timestamptz, uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_moderate_conversation(uuid, uuid, bigint, text, text, text, text, text, uuid, boolean, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_list_conversations(uuid, text, text, integer, integer)
  to service_role;
grant execute on function public.admin_get_conversation_detail(uuid, uuid)
  to service_role;
grant execute on function public.admin_get_conversation_message_page(uuid, uuid, timestamptz, uuid, integer)
  to service_role;
grant execute on function public.admin_moderate_conversation(uuid, uuid, bigint, text, text, text, text, text, uuid, boolean, uuid)
  to service_role;

comment on function public.admin_list_conversations(uuid, text, text, integer, integer) is
  'Service-only bounded registry read. The hidden implementation verifies the live admin/moderator actor and returns participant/listing/state/report summaries only.';
comment on function public.admin_get_conversation_detail(uuid, uuid) is
  'Service-only bounded conversation context read with the latest 20 moderation events and 25 linked reports.';
comment on function public.admin_get_conversation_message_page(uuid, uuid, timestamptz, uuid, integer) is
  'Service-only newest-first keyset transcript page capped at 51 rows with bounded attachment/reaction/report evidence.';
comment on function public.admin_moderate_conversation(uuid, uuid, bigint, text, text, text, text, text, uuid, boolean, uuid) is
  'Service-only idempotent close/reopen command. It verifies the live actor, calls the trusted state transition, optionally resolves one locked linked report, and persists canonical replay output atomically.';
