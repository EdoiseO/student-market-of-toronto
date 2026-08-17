-- Present private report moderator notes as an append-only collaboration timeline.
--
-- The Stage 6 decision ledger already records every note save immutably. This
-- migration adds a non-empty append command and a bounded triage-only reader
-- over those immutable records. The legacy current-note cache remains in place
-- for related-report summaries and backwards compatibility with older clients.

create or replace function moderation_decision_private.append_report_moderator_note_impl(
  p_report_id uuid,
  p_moderator_note text,
  p_request_id uuid
)
returns table (
  note_id uuid,
  report_id uuid,
  moderator_note text,
  created_at timestamptz,
  created_by_user_id uuid,
  created_by_role text
)
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
  inserted_note_id uuid;
  changed_at timestamptz := pg_catalog.statement_timestamp();
begin
  actor_role := moderation_decision_private.require_triage_actor();
  if p_report_id is null or p_request_id is null
    or pg_catalog.char_length(coalesce(normalized_note, '')) not between 1 and 4000 then
    raise exception using errcode = '22023', message = 'moderator_note_invalid';
  end if;
  canonical_payload := pg_catalog.jsonb_build_object(
    'report_id', p_report_id,
    'moderator_note', normalized_note
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      actor_id::text || ':moderation-decision:' || p_request_id::text,
      0
    )
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
    return query select
      existing.id,
      existing.resource_id,
      existing.private_note,
      existing.created_at,
      existing.actor_user_id_snapshot,
      existing.actor_role;
    return;
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
  ) on conflict on constraint report_notes_pkey do update
  set moderator_note = excluded.moderator_note,
      updated_at = excluded.updated_at,
      updated_by_user_id_snapshot = excluded.updated_by_user_id_snapshot;

  insert into public.moderation_audit_events (
    event_type, actor_user_id, actor_user_id_snapshot, actor_role,
    subject_user_id, subject_user_id_snapshot, source_report_id,
    resource_type, resource_id, summary, metadata, request_id, occurred_at
  ) values (
    'report.note_added', actor_id, actor_id, actor_role,
    report_row.reported_user_id, report_row.reported_user_id, report_row.id,
    'report', report_row.id, 'Private moderator note added.',
    '{}'::jsonb, p_request_id::text, changed_at
  ) returning id into audit_id;

  insert into moderation_decision_private.records (
    actor_user_id_snapshot, actor_role, action, request_id,
    resource_type, resource_id, subject_user_id_snapshot, source_report_ids,
    private_note, payload, result, audit_event_id, created_at
  ) values (
    actor_id, actor_role, 'report_moderator_note_saved', p_request_id,
    'report', report_row.id, report_row.reported_user_id, array[report_row.id],
    normalized_note, canonical_payload,
    pg_catalog.jsonb_build_object('saved', true), audit_id, changed_at
  ) returning id into inserted_note_id;

  return query select
    inserted_note_id,
    report_row.id,
    normalized_note,
    changed_at,
    actor_id,
    actor_role;
end
$function$;

alter function moderation_decision_private.append_report_moderator_note_impl(
  uuid, text, uuid
) owner to postgres;
revoke all on function moderation_decision_private.append_report_moderator_note_impl(
  uuid, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function moderation_decision_private.append_report_moderator_note_impl(
  uuid, text, uuid
) to authenticated;

create or replace function public.append_report_moderator_note(
  p_report_id uuid,
  p_moderator_note text,
  p_request_id uuid
)
returns table (
  note_id uuid,
  report_id uuid,
  moderator_note text,
  created_at timestamptz,
  created_by_user_id uuid,
  created_by_role text
)
language sql
security invoker
set search_path = ''
begin atomic
  select * from moderation_decision_private.append_report_moderator_note_impl(
    p_report_id, p_moderator_note, p_request_id
  );
end;

revoke all on function public.append_report_moderator_note(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.append_report_moderator_note(uuid, text, uuid)
  to authenticated;

create or replace function moderation_decision_private.get_report_note_history_impl(
  p_report_id uuid,
  p_limit integer
)
returns table (
  note_id uuid,
  report_id uuid,
  moderator_note text,
  created_at timestamptz,
  created_by_user_id uuid,
  created_by_role text
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  perform moderation_decision_private.require_triage_actor();
  if p_report_id is null or p_limit is null or p_limit not between 1 and 101 then
    raise exception using errcode = '22023', message = 'moderator_note_history_request_invalid';
  end if;
  if not exists (
    select 1 from public.reports report where report.id = p_report_id
  ) then
    raise exception using errcode = 'P0002', message = 'report_not_found';
  end if;

  return query
  select
    record.id,
    record.resource_id,
    record.private_note,
    record.created_at,
    record.actor_user_id_snapshot,
    record.actor_role
  from moderation_decision_private.records record
  where record.action = 'report_moderator_note_saved'
    and record.resource_type = 'report'
    and record.resource_id = p_report_id
    and record.private_note is not null
  order by record.created_at desc, record.id desc
  limit p_limit;
end
$function$;

alter function moderation_decision_private.get_report_note_history_impl(
  uuid, integer
) owner to postgres;
revoke all on function moderation_decision_private.get_report_note_history_impl(
  uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function moderation_decision_private.get_report_note_history_impl(
  uuid, integer
) to authenticated;

create or replace function public.get_report_moderator_note_history(
  p_report_id uuid,
  p_limit integer default 21
)
returns table (
  note_id uuid,
  report_id uuid,
  moderator_note text,
  created_at timestamptz,
  created_by_user_id uuid,
  created_by_role text
)
language sql
security invoker
set search_path = ''
begin atomic
  select * from moderation_decision_private.get_report_note_history_impl(
    p_report_id, p_limit
  );
end;

revoke all on function public.get_report_moderator_note_history(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_report_moderator_note_history(uuid, integer)
  to authenticated;

comment on function public.append_report_moderator_note(uuid, text, uuid) is
  'Appends one private, immutable, idempotent moderator note to a report timeline.';
comment on function public.get_report_moderator_note_history(uuid, integer) is
  'Returns a bounded newest-first private report-note timeline to current triage actors.';
