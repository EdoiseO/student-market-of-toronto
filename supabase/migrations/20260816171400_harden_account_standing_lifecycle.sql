-- Keep user-owned acknowledgement and review actions aligned with the
-- effective lifecycle shown on Account standing. Durable history remains
-- immutable once a sanction expires, is revoked, or receives a terminal
-- review decision.

create or replace function moderation_action_private.acknowledge_moderation_sanction_impl(
  p_sanction_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  subject_id uuid := auth.uid();
  action_at timestamptz := statement_timestamp();
  acknowledged_count integer;
begin
  if auth.role() <> 'authenticated' or subject_id is null then
    raise exception using
      errcode = '42501',
      message = 'moderation_authentication_required';
  end if;

  update public.moderation_sanctions sanction
  set acknowledged_at = action_at,
      acknowledged_by_user_id = subject_id,
      acknowledged_by_user_id_snapshot = subject_id
  where sanction.id = p_sanction_id
    and sanction.subject_user_id_snapshot = subject_id
    and sanction.acknowledgement_required
    and sanction.acknowledged_at is null
    and sanction.revoked_at is null
    and sanction.starts_at <= action_at
    and (sanction.expires_at is null or sanction.expires_at > action_at)
    and (
      sanction.review_status is null
      or sanction.review_status = 'pending'
    );

  get diagnostics acknowledged_count = row_count;

  if acknowledged_count <> 1 then
    raise exception using
      errcode = 'P0002',
      message = 'moderation_sanction_not_acknowledgeable';
  end if;

  return true;
end;
$function$;

create or replace function moderation_action_private.request_moderation_sanction_review_impl(
  p_sanction_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  subject_id uuid := auth.uid();
  action_at timestamptz := statement_timestamp();
  requested_count integer;
begin
  if auth.role() <> 'authenticated' or subject_id is null then
    raise exception using
      errcode = '42501',
      message = 'moderation_authentication_required';
  end if;

  update public.moderation_sanctions sanction
  set review_requested_at = action_at,
      review_status = 'pending'
  where sanction.id = p_sanction_id
    and sanction.subject_user_id_snapshot = subject_id
    and sanction.review_requested_at is null
    and sanction.review_status is null
    and sanction.revoked_at is null
    and sanction.replacement_sanction_id is null
    and sanction.starts_at <= action_at
    and (sanction.expires_at is null or sanction.expires_at > action_at);

  get diagnostics requested_count = row_count;

  if requested_count <> 1 then
    raise exception using
      errcode = 'P0002',
      message = 'moderation_sanction_review_not_requestable';
  end if;

  return true;
end;
$function$;

alter function moderation_action_private.acknowledge_moderation_sanction_impl(uuid)
  owner to postgres;
alter function moderation_action_private.request_moderation_sanction_review_impl(uuid)
  owner to postgres;

-- Return authoritative, bounded standing aggregates without exposing the
-- sanctions base table or moderator-only fields. SECURITY INVOKER keeps both
-- source relations behind their existing subject-owned RLS policies.
create function public.get_account_standing_summary()
returns table (
  active_notice_count bigint,
  strike_points bigint,
  needs_acknowledgement bigint,
  pending_reviews bigint,
  has_active_restrictions boolean,
  has_active_ban boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  subject_id uuid := auth.uid();
begin
  if auth.role() <> 'authenticated' or subject_id is null then
    raise exception using
      errcode = '42501',
      message = 'moderation_authentication_required';
  end if;

  return query
  with active_notices as (
    select
      notice.sanction_type,
      notice.strike_points,
      notice.restrictions,
      notice.acknowledgement_required,
      notice.acknowledged_at,
      notice.review_status
    from public.user_moderation_notices notice
    where notice.lifecycle_state = any (array['active', 'acknowledged']::text[])
  ),
  notice_summary as (
    select
      count(*)::bigint as active_notice_count,
      coalesce(sum(active.strike_points), 0)::bigint as strike_points,
      count(*) filter (
        where active.acknowledgement_required
          and active.acknowledged_at is null
          and (
            active.review_status is null
            or active.review_status = 'pending'
          )
      )::bigint as needs_acknowledgement,
      count(*) filter (
        where active.review_status = 'pending'
      )::bigint as pending_reviews,
      coalesce(bool_or(active.restrictions <> '{}'::jsonb), false)
        as has_active_restrictions,
      coalesce(bool_or(active.sanction_type = 'ban'), false)
        as has_notice_ban
    from active_notices active
  )
  select
    summary.active_notice_count,
    summary.strike_points,
    summary.needs_acknowledgement,
    summary.pending_reviews,
    summary.has_active_restrictions,
    (
      summary.has_notice_ban
      or exists (
        select 1
        from public.user_status status
        where status.user_id = subject_id
          and status.is_banned
          and (
            status.banned_until is null
            or status.banned_until > statement_timestamp()
          )
      )
    ) as has_active_ban
  from notice_summary summary;
end;
$function$;

alter function public.get_account_standing_summary() owner to postgres;
revoke all on function public.get_account_standing_summary()
  from public, anon, authenticated, service_role;
grant execute on function public.get_account_standing_summary()
  to authenticated;

comment on function public.get_account_standing_summary() is
  'RLS-bounded authoritative active moderation counts and standing flags for the authenticated subject.';
