-- Moderation decision rationale foundation.
--
-- This migration is deliberately additive.  The existing moderation writers
-- remain callable until the Stage 6 application has switched to the new
-- rationale-aware RPCs and a later cutover revokes the legacy surface.

create schema if not exists moderation_decision_private;
revoke all on schema moderation_decision_private
  from public, anon, authenticated, service_role;
create schema if not exists private;

-- Keep this foundation independently applicable in disposable verification
-- clusters while matching the report foundation's canonical prose contract.
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

create table moderation_decision_private.records (
  id uuid primary key default gen_random_uuid(),
  actor_user_id_snapshot uuid not null,
  actor_role text not null check (actor_role in ('admin', 'moderator', 'staff')),
  action text not null check (action in (
    'report_resolved',
    'report_dismissed',
    'reported_listing_removed',
    'profile_name_change_required',
    'report_moderator_note_saved',
    'listing_approved',
    'listing_rejected'
  )),
  request_id uuid not null,
  resource_type text not null check (
    resource_type ~ '^[a-z][a-z0-9_]{1,63}$'
  ),
  resource_id uuid not null,
  subject_user_id_snapshot uuid,
  source_report_ids uuid[] not null default '{}'::uuid[],
  policy_reason text,
  user_message text,
  private_note text,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  audit_event_id uuid not null
    references public.moderation_audit_events(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint moderation_decision_records_actor_action_request_key
    unique (actor_user_id_snapshot, request_id),
  constraint moderation_decision_records_audit_key unique (audit_event_id),
  constraint moderation_decision_records_report_ids_bounded check (
    cardinality(source_report_ids) between 0 and 100
    and array_position(source_report_ids, null) is null
  ),
  constraint moderation_decision_records_text_bounds check (
    case action
      when 'report_resolved' then
        policy_reason is null
        and
        user_message is null
        and char_length(private.normalize_user_prose(private_note)) between 10 and 1000
      when 'report_dismissed' then
        policy_reason is null
        and
        user_message is null
        and char_length(private.normalize_user_prose(private_note)) between 10 and 1000
      when 'reported_listing_removed' then
        policy_reason is null
        and
        char_length(private.normalize_user_prose(user_message)) between 10 and 3000
        and (private_note is null or char_length(private.normalize_user_prose(private_note)) between 1 and 1000)
      when 'profile_name_change_required' then
        char_length(private.normalize_user_prose(policy_reason)) between 10 and 1000
        and
        char_length(private.normalize_user_prose(user_message)) between 10 and 1000
        and (private_note is null or char_length(private.normalize_user_prose(private_note)) between 1 and 4000)
      when 'report_moderator_note_saved' then
        policy_reason is null
        and
        user_message is null
        and (private_note is null or char_length(private.normalize_user_prose(private_note)) between 1 and 4000)
      when 'listing_rejected' then
        policy_reason is null
        and
        char_length(private.normalize_user_prose(user_message)) between 1 and 3000
        and private_note is null
      when 'listing_approved' then
        policy_reason is null
        and
        (user_message is null or char_length(private.normalize_user_prose(user_message)) between 1 and 3000)
        and private_note is null
      else false
    end
  )
);

alter table moderation_decision_private.records owner to postgres;
revoke all on table moderation_decision_private.records
  from public, anon, authenticated, service_role;

create table moderation_decision_private.report_notes (
  report_id uuid primary key references public.reports(id) on delete restrict,
  moderator_note text check (
    moderator_note is null or char_length(private.normalize_user_prose(moderator_note)) between 1 and 4000
  ),
  updated_at timestamptz not null,
  updated_by_user_id_snapshot uuid not null
);

alter table moderation_decision_private.report_notes owner to postgres;
revoke all on table moderation_decision_private.report_notes
  from public, anon, authenticated, service_role;

create index moderation_decision_records_resource_created_idx
  on moderation_decision_private.records (resource_type, resource_id, created_at desc, id desc);
create index moderation_decision_records_subject_created_idx
  on moderation_decision_private.records (subject_user_id_snapshot, created_at desc, id desc)
  where subject_user_id_snapshot is not null;

create or replace function moderation_decision_private.reject_record_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception using errcode = '42501', message = 'moderation_decision_record_is_immutable';
end
$function$;

alter function moderation_decision_private.reject_record_mutation() owner to postgres;
revoke all on function moderation_decision_private.reject_record_mutation()
  from public, anon, authenticated, service_role;

create trigger protect_moderation_decision_record
  before update or delete on moderation_decision_private.records
  for each row execute function moderation_decision_private.reject_record_mutation();

create or replace function moderation_decision_private.require_triage_actor()
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
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' or actor_id is null then
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
    raise exception using errcode = '42501', message = 'moderation_actor_not_found';
  end if;

  if actor_role is null or actor_role not in ('admin', 'moderator', 'staff') then
    raise exception using errcode = '42501', message = 'moderation_action_not_permitted';
  end if;

  if actor_auth_banned_until is not null
    and actor_auth_banned_until > statement_timestamp() then
    raise exception using errcode = '42501', message = 'moderation_actor_is_banned';
  end if;

  if exists (
    select 1 from public.user_status status
    where status.user_id = actor_id
      and status.is_banned
      and (status.banned_until is null or status.banned_until > statement_timestamp())
  ) then
    raise exception using errcode = '42501', message = 'moderation_actor_is_banned';
  end if;

  return actor_role;
end
$function$;

alter function moderation_decision_private.require_triage_actor() owner to postgres;
revoke all on function moderation_decision_private.require_triage_actor()
  from public, anon, authenticated, service_role;

create or replace function moderation_decision_private.output_id(
  p_namespace text,
  p_actor_id uuid,
  p_request_id uuid
)
returns uuid
language sql
immutable
security definer
set search_path = ''
as $function$
  select (
    substr(pg_catalog.md5(p_namespace || ':' || p_actor_id::text || ':' || p_request_id::text), 1, 8)
    || '-' || substr(pg_catalog.md5(p_namespace || ':' || p_actor_id::text || ':' || p_request_id::text), 9, 4)
    || '-' || substr(pg_catalog.md5(p_namespace || ':' || p_actor_id::text || ':' || p_request_id::text), 13, 4)
    || '-' || substr(pg_catalog.md5(p_namespace || ':' || p_actor_id::text || ':' || p_request_id::text), 17, 4)
    || '-' || substr(pg_catalog.md5(p_namespace || ':' || p_actor_id::text || ':' || p_request_id::text), 21, 12)
  )::uuid
$function$;

alter function moderation_decision_private.output_id(text, uuid, uuid) owner to postgres;
revoke all on function moderation_decision_private.output_id(text, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function moderation_decision_private.decide_listing_with_rationale_impl(
  p_listing_id uuid,
  p_expected_content_revision bigint,
  p_expected_submitted_for_review_at timestamptz,
  p_action text,
  p_feedback text,
  p_request_id uuid
)
returns public.listings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  normalized_feedback text := nullif(private.normalize_user_prose(p_feedback), '');
  action_name text;
  canonical_payload jsonb;
  existing moderation_decision_private.records%rowtype;
  listing_row public.listings%rowtype;
  audit_id uuid;
begin
  actor_role := moderation_action_private.require_actor('decide_listings');
  if p_listing_id is null or p_request_id is null
    or p_action not in ('approved', 'rejected')
    or (
      p_action = 'rejected'
      and char_length(coalesce(normalized_feedback, '')) not between 1 and 3000
    )
    or (
      p_action = 'approved'
      and normalized_feedback is not null
      and char_length(normalized_feedback) > 3000
    ) then
    raise exception using errcode = '22023', message = 'listing_moderation_rationale_invalid';
  end if;

  action_name := case when p_action = 'approved'
    then 'listing_approved' else 'listing_rejected' end;
  canonical_payload := jsonb_strip_nulls(jsonb_build_object(
    'listing_id', p_listing_id,
    'expected_content_revision', p_expected_content_revision,
    'expected_submitted_for_review_at', p_expected_submitted_for_review_at,
    'action', p_action,
    'feedback', normalized_feedback
  ));

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || ':moderation-decision:' || p_request_id::text, 0)
  );
  select * into existing
  from moderation_decision_private.records record
  where record.actor_user_id_snapshot = actor_id
    and record.request_id = p_request_id
  for update;
  if found then
    if existing.action is distinct from action_name
      or existing.payload is distinct from canonical_payload then
      raise exception using errcode = '22023', message = 'moderation_request_id_payload_conflict';
    end if;
    select * into listing_row
    from jsonb_populate_record(null::public.listings, existing.result);
    return listing_row;
  end if;

  listing_row := moderation_action_private.decide_listing_moderation_impl(
    p_listing_id,
    p_expected_content_revision,
    p_expected_submitted_for_review_at,
    p_action,
    normalized_feedback,
    p_request_id::text
  );

  select event.id into audit_id
  from public.moderation_audit_events event
  where event.actor_user_id_snapshot = actor_id
    and event.event_type = 'listing.moderation_decided'
    and event.request_id = p_request_id::text
  order by event.occurred_at desc, event.id desc
  limit 1;
  if audit_id is null then
    raise exception using errcode = '55000', message = 'moderation_decision_audit_missing';
  end if;

  insert into moderation_decision_private.records (
    actor_user_id_snapshot, actor_role, action, request_id,
    resource_type, resource_id, subject_user_id_snapshot,
    user_message, payload, result, audit_event_id
  ) values (
    actor_id, actor_role, action_name, p_request_id,
    'listing', listing_row.id, listing_row.seller_id,
    normalized_feedback, canonical_payload, to_jsonb(listing_row), audit_id
  );
  return listing_row;
end
$function$;

alter function moderation_decision_private.decide_listing_with_rationale_impl(
  uuid, bigint, timestamptz, text, text, uuid
) owner to postgres;
revoke all on function moderation_decision_private.decide_listing_with_rationale_impl(
  uuid, bigint, timestamptz, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function moderation_decision_private.decide_listing_with_rationale_impl(
  uuid, bigint, timestamptz, text, text, uuid
) to authenticated;

create or replace function public.decide_listing_moderation_with_rationale(
  p_listing_id uuid,
  p_expected_content_revision bigint,
  p_expected_submitted_for_review_at timestamptz,
  p_action text,
  p_feedback text,
  p_request_id uuid
)
returns public.listings
language sql
security invoker
set search_path = ''
begin atomic
  select moderation_decision_private.decide_listing_with_rationale_impl(
    p_listing_id,
    p_expected_content_revision,
    p_expected_submitted_for_review_at,
    p_action,
    p_feedback,
    p_request_id
  );
end;

revoke all on function public.decide_listing_moderation_with_rationale(
  uuid, bigint, timestamptz, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.decide_listing_moderation_with_rationale(
  uuid, bigint, timestamptz, text, text, uuid
) to authenticated;

create or replace function moderation_decision_private.decide_report_set_with_summary_impl(
  p_report_ids uuid[],
  p_status text,
  p_private_summary text,
  p_request_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  normalized_ids uuid[];
  normalized_summary text := private.normalize_user_prose(p_private_summary);
  action_name text;
  canonical_payload jsonb;
  existing moderation_decision_private.records%rowtype;
  updated_count integer;
  audit_id uuid;
  resource_type_value text;
  resource_id_value uuid;
  subject_id_value uuid;
begin
  actor_role := moderation_action_private.require_actor('decide_reports');
  if p_request_id is null
    or p_status not in ('resolved', 'dismissed')
    or char_length(normalized_summary) not between 10 and 1000 then
    raise exception using errcode = '22023', message = 'report_decision_summary_invalid';
  end if;

  select array_agg(report_id order by report_id)
  into normalized_ids
  from unnest(p_report_ids) report_id;
  perform moderation_action_private.validate_report_id_set(normalized_ids);

  action_name := case when p_status = 'resolved'
    then 'report_resolved' else 'report_dismissed' end;
  canonical_payload := jsonb_build_object(
    'report_ids', normalized_ids,
    'status', p_status,
    'private_summary', normalized_summary
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || ':moderation-decision:' || p_request_id::text, 0)
  );
  select * into existing
  from moderation_decision_private.records record
  where record.actor_user_id_snapshot = actor_id
    and record.request_id = p_request_id
  for update;
  if found then
    if existing.action is distinct from action_name
      or existing.payload is distinct from canonical_payload then
      raise exception using errcode = '22023', message = 'moderation_request_id_payload_conflict';
    end if;
    return (existing.result ->> 'updated_count')::integer;
  end if;

  updated_count := moderation_action_private.decide_report_set_impl(
    normalized_ids, p_status, p_request_id::text
  );

  select event.id into audit_id
  from public.moderation_audit_events event
  where event.actor_user_id_snapshot = actor_id
    and event.event_type = 'reports.decided'
    and event.request_id = p_request_id::text
  order by event.occurred_at desc, event.id desc
  limit 1;
  if audit_id is null then
    raise exception using errcode = '55000', message = 'moderation_decision_audit_missing';
  end if;

  select report.subject_type,
         coalesce(report.subject_id, report.listing_id, report.message_id, report.reported_user_id),
         report.reported_user_id
  into resource_type_value, resource_id_value, subject_id_value
  from public.reports report
  where report.id = normalized_ids[1];

  insert into moderation_decision_private.records (
    actor_user_id_snapshot, actor_role, action, request_id,
    resource_type, resource_id, subject_user_id_snapshot, source_report_ids,
    private_note, payload, result, audit_event_id
  ) values (
    actor_id, actor_role, action_name, p_request_id,
    resource_type_value, resource_id_value, subject_id_value, normalized_ids,
    normalized_summary, canonical_payload,
    jsonb_build_object('updated_count', updated_count), audit_id
  );

  return updated_count;
end
$function$;

alter function moderation_decision_private.decide_report_set_with_summary_impl(
  uuid[], text, text, uuid
) owner to postgres;
revoke all on function moderation_decision_private.decide_report_set_with_summary_impl(
  uuid[], text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function moderation_decision_private.decide_report_set_with_summary_impl(
  uuid[], text, text, uuid
) to authenticated;

create or replace function public.decide_report_set_with_summary(
  p_report_ids uuid[],
  p_status text,
  p_private_summary text,
  p_request_id uuid
)
returns integer
language sql
security invoker
set search_path = ''
begin atomic
  select moderation_decision_private.decide_report_set_with_summary_impl(
    p_report_ids, p_status, p_private_summary, p_request_id
  );
end;

revoke all on function public.decide_report_set_with_summary(uuid[], text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.decide_report_set_with_summary(uuid[], text, text, uuid)
  to authenticated;

create or replace function moderation_decision_private.remove_reported_listing_with_rationale_impl(
  p_report_ids uuid[],
  p_listing_id uuid,
  p_seller_feedback text,
  p_private_summary text,
  p_request_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  normalized_ids uuid[];
  normalized_feedback text := private.normalize_user_prose(p_seller_feedback);
  normalized_summary text := nullif(private.normalize_user_prose(p_private_summary), '');
  canonical_payload jsonb;
  existing moderation_decision_private.records%rowtype;
  updated_count integer;
  audit_id uuid;
  listing_row public.listings%rowtype;
  notification_id uuid;
  notification_metadata jsonb;
begin
  actor_role := moderation_action_private.require_actor('decide_reports');
  perform moderation_action_private.require_actor('decide_listings');
  if p_request_id is null or p_listing_id is null
    or char_length(normalized_feedback) not between 10 and 3000
    or (normalized_summary is not null and char_length(normalized_summary) > 1000) then
    raise exception using errcode = '22023', message = 'reported_listing_rationale_invalid';
  end if;

  select array_agg(report_id order by report_id)
  into normalized_ids from unnest(p_report_ids) report_id;
  perform moderation_action_private.validate_report_id_set(normalized_ids);
  canonical_payload := jsonb_strip_nulls(jsonb_build_object(
    'report_ids', normalized_ids,
    'listing_id', p_listing_id,
    'seller_feedback', normalized_feedback,
    'private_summary', normalized_summary
  ));

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || ':moderation-decision:' || p_request_id::text, 0)
  );
  select * into existing
  from moderation_decision_private.records record
  where record.actor_user_id_snapshot = actor_id
    and record.request_id = p_request_id
  for update;
  if found then
    if existing.action <> 'reported_listing_removed'
      or existing.payload is distinct from canonical_payload then
      raise exception using errcode = '22023', message = 'moderation_request_id_payload_conflict';
    end if;
    return (existing.result ->> 'updated_count')::integer;
  end if;

  updated_count := moderation_action_private.remove_reported_listing_impl(
    normalized_ids, p_listing_id, p_request_id::text
  );

  select * into listing_row from public.listings where id = p_listing_id;
  select event.id into audit_id
  from public.moderation_audit_events event
  where event.actor_user_id_snapshot = actor_id
    and event.event_type = 'listing.removed_after_reports'
    and event.resource_id = p_listing_id
    and event.request_id = p_request_id::text
  order by event.occurred_at desc, event.id desc
  limit 1;
  if audit_id is null or listing_row.id is null then
    raise exception using errcode = '55000', message = 'moderation_decision_audit_missing';
  end if;

  notification_id := moderation_decision_private.output_id(
    'reported-listing-removal', actor_id, p_request_id
  );
  notification_metadata := jsonb_build_object(
    'listing_title', listing_row.title,
    'listing_slug', listing_row.slug,
    'href', '/dashboard',
    'feedback', normalized_feedback
  );
  insert into public.notifications (
    id, user_id, type, listing_id, metadata
  ) values (
    notification_id, listing_row.seller_id, 'listing_removed',
    listing_row.id, notification_metadata
  ) on conflict (id) do nothing;

  if not exists (
    select 1 from public.notifications notification
    where notification.id = notification_id
      and notification.user_id = listing_row.seller_id
      and notification.type = 'listing_removed'
      and notification.listing_id = listing_row.id
      and notification.metadata = notification_metadata
  ) then
    raise exception using errcode = '23505', message = 'moderation_notification_id_conflict';
  end if;

  insert into moderation_decision_private.records (
    actor_user_id_snapshot, actor_role, action, request_id,
    resource_type, resource_id, subject_user_id_snapshot, source_report_ids,
    user_message, private_note, payload, result, audit_event_id
  ) values (
    actor_id, actor_role, 'reported_listing_removed', p_request_id,
    'listing', listing_row.id, listing_row.seller_id, normalized_ids,
    normalized_feedback, normalized_summary, canonical_payload,
    jsonb_build_object('updated_count', updated_count, 'notification_id', notification_id),
    audit_id
  );
  return updated_count;
end
$function$;

alter function moderation_decision_private.remove_reported_listing_with_rationale_impl(
  uuid[], uuid, text, text, uuid
) owner to postgres;
revoke all on function moderation_decision_private.remove_reported_listing_with_rationale_impl(
  uuid[], uuid, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function moderation_decision_private.remove_reported_listing_with_rationale_impl(
  uuid[], uuid, text, text, uuid
) to authenticated;

create or replace function public.remove_reported_listing_with_rationale(
  p_report_ids uuid[],
  p_listing_id uuid,
  p_seller_feedback text,
  p_private_summary text,
  p_request_id uuid
)
returns integer
language sql
security invoker
set search_path = ''
begin atomic
  select moderation_decision_private.remove_reported_listing_with_rationale_impl(
    p_report_ids, p_listing_id, p_seller_feedback, p_private_summary, p_request_id
  );
end;

revoke all on function public.remove_reported_listing_with_rationale(
  uuid[], uuid, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.remove_reported_listing_with_rationale(
  uuid[], uuid, text, text, uuid
) to authenticated;

create or replace function moderation_decision_private.save_report_moderator_note_impl(
  p_report_id uuid,
  p_moderator_note text,
  p_request_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  normalized_note text := nullif(private.normalize_user_prose(p_moderator_note), '');
  canonical_payload jsonb;
  existing moderation_decision_private.records%rowtype;
  report_row public.reports%rowtype;
  audit_id uuid;
  changed_at timestamptz := statement_timestamp();
begin
  actor_role := moderation_decision_private.require_triage_actor();
  if p_report_id is null or p_request_id is null
    or (normalized_note is not null and char_length(normalized_note) > 4000) then
    raise exception using errcode = '22023', message = 'moderator_note_invalid';
  end if;
  canonical_payload := jsonb_strip_nulls(jsonb_build_object(
    'report_id', p_report_id,
    'moderator_note', normalized_note
  ));

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || ':moderation-decision:' || p_request_id::text, 0)
  );
  select * into existing
  from moderation_decision_private.records record
  where record.actor_user_id_snapshot = actor_id
    and record.request_id = p_request_id
  for update;
  if found then
    if existing.action <> 'report_moderator_note_saved'
      or existing.payload is distinct from canonical_payload then
      raise exception using errcode = '22023', message = 'moderation_request_id_payload_conflict';
    end if;
    return true;
  end if;

  select * into report_row
  from public.reports report
  where report.id = p_report_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'report_not_found';
  end if;

  insert into moderation_decision_private.report_notes (
    report_id, moderator_note, updated_at, updated_by_user_id_snapshot
  ) values (
    p_report_id, normalized_note, changed_at, actor_id
  ) on conflict (report_id) do update
  set moderator_note = excluded.moderator_note,
      updated_at = excluded.updated_at,
      updated_by_user_id_snapshot = excluded.updated_by_user_id_snapshot;

  insert into public.moderation_audit_events (
    event_type, actor_user_id, actor_user_id_snapshot, actor_role,
    subject_user_id, subject_user_id_snapshot, source_report_id,
    resource_type, resource_id, summary, metadata, request_id, occurred_at
  ) values (
    'report.note_updated', actor_id, actor_id, actor_role,
    report_row.reported_user_id, report_row.reported_user_id, report_row.id,
    'report', report_row.id, 'Private moderator note updated.',
    jsonb_build_object('has_note', normalized_note is not null),
    p_request_id::text, changed_at
  ) returning id into audit_id;

  insert into moderation_decision_private.records (
    actor_user_id_snapshot, actor_role, action, request_id,
    resource_type, resource_id, subject_user_id_snapshot, source_report_ids,
    private_note, payload, result, audit_event_id
  ) values (
    actor_id, actor_role, 'report_moderator_note_saved', p_request_id,
    'report', report_row.id, report_row.reported_user_id, array[report_row.id],
    normalized_note, canonical_payload, jsonb_build_object('saved', true), audit_id
  );
  return true;
end
$function$;

alter function moderation_decision_private.save_report_moderator_note_impl(
  uuid, text, uuid
) owner to postgres;
revoke all on function moderation_decision_private.save_report_moderator_note_impl(
  uuid, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function moderation_decision_private.save_report_moderator_note_impl(
  uuid, text, uuid
) to authenticated;

create or replace function public.save_report_moderator_note(
  p_report_id uuid,
  p_moderator_note text,
  p_request_id uuid
)
returns boolean
language sql
security invoker
set search_path = ''
begin atomic
  select moderation_decision_private.save_report_moderator_note_impl(
    p_report_id, p_moderator_note, p_request_id
  );
end;

revoke all on function public.save_report_moderator_note(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.save_report_moderator_note(uuid, text, uuid)
  to authenticated;

alter table moderation_action_private.force_name_operations
  add column if not exists policy_reason text,
  add column if not exists user_message text,
  add column if not exists private_note text;

alter table moderation_action_private.force_name_operations
  drop constraint if exists force_name_operations_rationale_bounds,
  add constraint force_name_operations_rationale_bounds check (
    (policy_reason is null or char_length(private.normalize_user_prose(policy_reason)) between 10 and 1000)
    and (user_message is null or char_length(private.normalize_user_prose(user_message)) between 10 and 1000)
    and (private_note is null or char_length(private.normalize_user_prose(private_note)) between 1 and 4000)
  );

create or replace function moderation_decision_private.begin_force_name_operation_with_rationale_impl(
  p_report_ids uuid[],
  p_subject_user_id uuid,
  p_desired_metadata jsonb,
  p_rollback_metadata jsonb,
  p_policy_reason text,
  p_user_message text,
  p_private_note text,
  p_request_id uuid
)
returns table(operation_id uuid, operation_status text, result_updated_count integer)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_policy_reason text := private.normalize_user_prose(p_policy_reason);
  normalized_user_message text := private.normalize_user_prose(p_user_message);
  normalized_private_note text := nullif(private.normalize_user_prose(p_private_note), '');
  operation_row record;
  persisted moderation_action_private.force_name_operations%rowtype;
begin
  if p_request_id is null
    or char_length(normalized_policy_reason) not between 10 and 1000
    or char_length(normalized_user_message) not between 10 and 1000
    or (normalized_private_note is not null and char_length(normalized_private_note) > 4000) then
    raise exception using errcode = '22023', message = 'force_name_decision_rationale_invalid';
  end if;

  select * into operation_row
  from moderation_action_private.begin_force_name_operation_impl(
    p_report_ids,
    p_subject_user_id,
    p_desired_metadata,
    p_rollback_metadata,
    p_request_id::text
  );

  select * into persisted
  from moderation_action_private.force_name_operations operation
  where operation.id = operation_row.operation_id
  for update;

  if persisted.policy_reason is null and persisted.user_message is null
    and persisted.private_note is null then
    update moderation_action_private.force_name_operations
    set policy_reason = normalized_policy_reason,
        user_message = normalized_user_message,
        private_note = normalized_private_note
    where id = persisted.id;
  elsif persisted.policy_reason is distinct from normalized_policy_reason
    or persisted.user_message is distinct from normalized_user_message
    or persisted.private_note is distinct from normalized_private_note then
    raise exception using errcode = '22023', message = 'moderation_request_id_payload_conflict';
  end if;

  operation_id := operation_row.operation_id;
  operation_status := operation_row.operation_status;
  result_updated_count := operation_row.result_updated_count;
  return next;
end
$function$;

alter function moderation_decision_private.begin_force_name_operation_with_rationale_impl(
  uuid[], uuid, jsonb, jsonb, text, text, text, uuid
) owner to postgres;
revoke all on function moderation_decision_private.begin_force_name_operation_with_rationale_impl(
  uuid[], uuid, jsonb, jsonb, text, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function moderation_decision_private.begin_force_name_operation_with_rationale_impl(
  uuid[], uuid, jsonb, jsonb, text, text, text, uuid
) to authenticated;

create or replace function public.begin_force_name_operation_with_rationale(
  p_report_ids uuid[],
  p_subject_user_id uuid,
  p_desired_metadata jsonb,
  p_rollback_metadata jsonb,
  p_policy_reason text,
  p_user_message text,
  p_private_note text,
  p_request_id uuid
)
returns table(operation_id uuid, operation_status text, result_updated_count integer)
language sql
security invoker
set search_path = ''
begin atomic
  select operation_id, operation_status, result_updated_count
  from moderation_decision_private.begin_force_name_operation_with_rationale_impl(
    p_report_ids, p_subject_user_id, p_desired_metadata, p_rollback_metadata,
    p_policy_reason, p_user_message, p_private_note, p_request_id
  );
end;

revoke all on function public.begin_force_name_operation_with_rationale(
  uuid[], uuid, jsonb, jsonb, text, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.begin_force_name_operation_with_rationale(
  uuid[], uuid, jsonb, jsonb, text, text, text, uuid
) to authenticated;

create or replace function moderation_decision_private.complete_force_name_operation_with_rationale_impl(
  p_operation_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  operation moderation_action_private.force_name_operations%rowtype;
  canonical_payload jsonb;
  existing moderation_decision_private.records%rowtype;
  changed_count integer;
  audit_id uuid;
  notification_id uuid;
  notification_metadata jsonb;
begin
  actor_role := moderation_action_private.require_actor('decide_reports');
  if actor_role <> 'admin' or p_operation_id is null then
    raise exception using errcode = '42501', message = 'moderation_action_not_permitted';
  end if;

  -- Pre-read the immutable operation identity without taking its row lock.
  -- The canonical cross-table order is actor -> subject -> operation; taking
  -- the operation first can deadlock a concurrent begin path that already
  -- holds the subject while checking the one-pending-operation constraint.
  select * into operation
  from moderation_action_private.force_name_operations item
  where item.id = p_operation_id
    and item.actor_user_id_snapshot = actor_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'force_name_change_operation_not_found';
  end if;

  perform 1
  from auth.users account
  where account.id = operation.subject_user_id_snapshot
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'moderation_subject_not_found';
  end if;

  select * into operation
  from moderation_action_private.force_name_operations item
  where item.id = p_operation_id
    and item.actor_user_id_snapshot = actor_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'force_name_change_operation_not_found';
  end if;
  if char_length(private.normalize_user_prose(operation.policy_reason)) not between 10 and 1000
    or char_length(private.normalize_user_prose(operation.user_message)) not between 10 and 1000
    or (operation.private_note is not null
      and char_length(private.normalize_user_prose(operation.private_note)) > 4000) then
    raise exception using errcode = '55000', message = 'force_name_decision_rationale_missing';
  end if;

  canonical_payload := jsonb_strip_nulls(jsonb_build_object(
    'operation_id', operation.id,
    'subject_user_id', operation.subject_user_id_snapshot,
    'report_ids', operation.report_ids,
    'policy_reason', operation.policy_reason,
    'user_message', operation.user_message,
    'private_note', operation.private_note
  ));
  select * into existing
  from moderation_decision_private.records record
  where record.actor_user_id_snapshot = actor_id
    and record.request_id = operation.request_id::uuid
  for update;
  if found then
    if existing.action <> 'profile_name_change_required'
      or existing.payload is distinct from canonical_payload then
      raise exception using errcode = '22023', message = 'moderation_request_id_payload_conflict';
    end if;
    return (existing.result ->> 'updated_count')::integer;
  end if;

  changed_count := moderation_action_private.complete_force_name_operation_impl(p_operation_id);
  select event.id into audit_id
  from public.moderation_audit_events event
  where event.actor_user_id_snapshot = actor_id
    and event.event_type = 'profile.name_change_required'
    and event.resource_id = operation.subject_user_id_snapshot
    and event.request_id = operation.request_id
  order by event.occurred_at desc, event.id desc
  limit 1;
  if audit_id is null then
    raise exception using errcode = '55000', message = 'moderation_decision_audit_missing';
  end if;

  notification_id := moderation_decision_private.output_id(
    'profile-name-change-required', actor_id, operation.request_id::uuid
  );
  notification_metadata := jsonb_build_object(
    'href', '/dashboard/settings',
    'user_message', operation.user_message
  );
  insert into public.notifications (id, user_id, type, metadata)
  values (
    notification_id, operation.subject_user_id_snapshot,
    'profile_name_change_required', notification_metadata
  ) on conflict (id) do nothing;
  if not exists (
    select 1 from public.notifications notification
    where notification.id = notification_id
      and notification.user_id = operation.subject_user_id_snapshot
      and notification.type = 'profile_name_change_required'
      and notification.metadata = notification_metadata
  ) then
    raise exception using errcode = '23505', message = 'moderation_notification_id_conflict';
  end if;

  insert into moderation_decision_private.records (
    actor_user_id_snapshot, actor_role, action, request_id,
    resource_type, resource_id, subject_user_id_snapshot, source_report_ids,
    policy_reason, user_message, private_note, payload, result, audit_event_id
  ) values (
    actor_id, actor_role, 'profile_name_change_required', operation.request_id::uuid,
    'profile', operation.subject_user_id_snapshot, operation.subject_user_id_snapshot,
    operation.report_ids, operation.policy_reason, operation.user_message,
    operation.private_note, canonical_payload,
    jsonb_build_object('updated_count', changed_count, 'notification_id', notification_id),
    audit_id
  );
  return changed_count;
end
$function$;

alter function moderation_decision_private.complete_force_name_operation_with_rationale_impl(uuid)
  owner to postgres;
revoke all on function moderation_decision_private.complete_force_name_operation_with_rationale_impl(uuid)
  from public, anon, authenticated, service_role;
grant execute on function moderation_decision_private.complete_force_name_operation_with_rationale_impl(uuid)
  to authenticated;

create or replace function public.complete_force_name_operation_with_rationale(
  p_operation_id uuid
)
returns integer
language sql
security invoker
set search_path = ''
begin atomic
  select moderation_decision_private.complete_force_name_operation_with_rationale_impl(
    p_operation_id
  );
end;

revoke all on function public.complete_force_name_operation_with_rationale(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_force_name_operation_with_rationale(uuid)
  to authenticated;

alter table public.notifications
  drop constraint if exists notifications_type_check;
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
    'listing_removed',
    'moderator_role_granted',
    'moderation_warning',
    'moderation_strike',
    'moderation_ban',
    'moderation_review_update',
    'conversation_closed',
    'conversation_reopened',
    'profile_name_change_required'
  ]::text[]));

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
    'conversation_reopened',
    'listing_removed',
    'profile_name_change_required'
  ]::text[]);
$function$;

alter function private.is_enforcement_notification_type(text) owner to postgres;
revoke all on function private.is_enforcement_notification_type(text)
  from public, anon, authenticated, service_role;

create or replace function moderation_decision_private.get_records_by_audit_ids_impl(
  p_audit_event_ids uuid[]
)
returns table (
  audit_event_id uuid,
  action text,
  policy_reason text,
  user_message text,
  private_note text
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_role text;
begin
  actor_role := moderation_decision_private.require_triage_actor();
  if actor_role <> 'admin' then
    raise exception using errcode = '42501', message = 'moderation_audit_access_required';
  end if;

  if p_audit_event_ids is null
    or cardinality(p_audit_event_ids) not between 1 and 100
    or array_position(p_audit_event_ids, null) is not null then
    raise exception using errcode = '22023', message = 'moderation_audit_id_set_invalid';
  end if;

  return query
  select
    record.audit_event_id,
    record.action,
    record.policy_reason,
    record.user_message,
    record.private_note
  from moderation_decision_private.records record
  where record.audit_event_id = any (p_audit_event_ids)
  order by record.created_at desc, record.id desc;
end
$function$;

alter function moderation_decision_private.get_records_by_audit_ids_impl(uuid[])
  owner to postgres;
revoke all on function moderation_decision_private.get_records_by_audit_ids_impl(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function moderation_decision_private.get_records_by_audit_ids_impl(uuid[])
  to authenticated;

create or replace function public.get_moderation_decision_records(
  p_audit_event_ids uuid[]
)
returns table (
  audit_event_id uuid,
  action text,
  policy_reason text,
  user_message text,
  private_note text
)
language sql
security invoker
set search_path = ''
begin atomic
  select *
  from moderation_decision_private.get_records_by_audit_ids_impl(p_audit_event_ids);
end;

revoke all on function public.get_moderation_decision_records(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.get_moderation_decision_records(uuid[])
  to authenticated;

create or replace function moderation_decision_private.get_report_notes_impl(
  p_report_ids uuid[]
)
returns table (
  report_id uuid,
  moderator_notes text,
  moderator_notes_updated_at timestamptz,
  moderator_notes_updated_by uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  perform moderation_decision_private.require_triage_actor();
  if p_report_ids is null
    or cardinality(p_report_ids) not between 1 and 100
    or array_position(p_report_ids, null) is not null then
    raise exception using errcode = '22023', message = 'moderation_report_id_set_invalid';
  end if;

  return query
  select
    note.report_id,
    note.moderator_note,
    note.updated_at,
    note.updated_by_user_id_snapshot
  from moderation_decision_private.report_notes note
  where note.report_id = any (p_report_ids)
  order by note.updated_at desc, note.report_id;
end
$function$;

alter function moderation_decision_private.get_report_notes_impl(uuid[])
  owner to postgres;
revoke all on function moderation_decision_private.get_report_notes_impl(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function moderation_decision_private.get_report_notes_impl(uuid[])
  to authenticated;

create or replace function public.get_report_moderator_notes(
  p_report_ids uuid[]
)
returns table (
  report_id uuid,
  moderator_notes text,
  moderator_notes_updated_at timestamptz,
  moderator_notes_updated_by uuid
)
language sql
security invoker
set search_path = ''
begin atomic
  select * from moderation_decision_private.get_report_notes_impl(p_report_ids);
end;

revoke all on function public.get_report_moderator_notes(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.get_report_moderator_notes(uuid[])
  to authenticated;

comment on table moderation_decision_private.records is
  'Append-only, non-Data-API rationale records. Private notes never enter participant notification rows or user-facing projections.';
