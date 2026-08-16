-- Durable moderation enforcement foundation.
--
-- `user_status` remains the small current-state projection used by request
-- middleware. `moderation_sanctions` is the durable warning/strike/ban record,
-- and `moderation_audit_events` is append-only history. Live Auth foreign keys
-- use ON DELETE SET NULL in the history tables while immutable UUID snapshots
-- preserve accountability after an Auth user is deleted.

create schema if not exists private;

create table if not exists public.user_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  is_banned boolean not null default false,
  banned_until timestamptz,
  ban_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_status
  add column if not exists is_banned boolean,
  add column if not exists banned_until timestamptz,
  add column if not exists ban_reason text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

update public.user_status
set is_banned = false
where is_banned is null;

update public.user_status
set created_at = coalesce(created_at, updated_at, now()),
    updated_at = coalesce(updated_at, created_at, now())
where created_at is null
   or updated_at is null;

create table public.moderation_sanctions (
  id uuid primary key default gen_random_uuid(),
  subject_user_id uuid references auth.users(id) on delete set null,
  subject_user_id_snapshot uuid not null,
  issued_by_user_id uuid references auth.users(id) on delete set null,
  issued_by_user_id_snapshot uuid,
  issued_by_role text not null,
  source_report_id uuid references public.reports(id) on delete set null,
  sanction_type text not null,
  severity text not null,
  reason_code text not null,
  user_message text not null,
  internal_note text,
  strike_points smallint,
  restrictions jsonb not null default '{}'::jsonb,
  related_resource_type text,
  related_resource_id uuid,
  supersedes_sanction_id uuid
    references public.moderation_sanctions(id) on delete restrict,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  acknowledgement_required boolean not null default true,
  acknowledged_at timestamptz,
  acknowledged_by_user_id uuid references auth.users(id) on delete set null,
  acknowledged_by_user_id_snapshot uuid,
  revoked_at timestamptz,
  revoked_by_user_id uuid references auth.users(id) on delete set null,
  revoked_by_user_id_snapshot uuid,
  revoked_by_role text,
  revocation_kind text,
  revocation_reason text,
  review_requested_at timestamptz,
  review_status text,
  reviewed_at timestamptz,
  reviewed_by_user_id uuid references auth.users(id) on delete set null,
  reviewed_by_user_id_snapshot uuid,
  reviewed_by_role text,
  replacement_sanction_id uuid
    references public.moderation_sanctions(id) on delete restrict,
  review_outcome_message text,
  review_private_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint moderation_sanctions_subject_snapshot_check
    check (
      subject_user_id is null
      or subject_user_id = subject_user_id_snapshot
    ),
  constraint moderation_sanctions_issuer_snapshot_check
    check (
      (
        issued_by_role = 'system'
        and issued_by_user_id is null
        and issued_by_user_id_snapshot is null
      )
      or (
        issued_by_role = any (array['admin', 'moderator']::text[])
        and issued_by_user_id_snapshot is not null
        and (
          issued_by_user_id is null
          or issued_by_user_id = issued_by_user_id_snapshot
        )
      )
    ),
  constraint moderation_sanctions_issuer_role_check
    check (issued_by_role = any (array['admin', 'moderator', 'system']::text[])),
  constraint moderation_sanctions_type_check
    check (sanction_type = any (array['warning', 'strike', 'ban']::text[])),
  constraint moderation_sanctions_issuer_action_check
    check (
      (sanction_type = 'ban' and issued_by_role = any (array['admin', 'system']::text[]))
      or (
        sanction_type = any (array['warning', 'strike']::text[])
        and issued_by_role = any (array['admin', 'moderator', 'system']::text[])
      )
    ),
  constraint moderation_sanctions_severity_check
    check (severity = any (array['low', 'medium', 'high', 'critical']::text[])),
  constraint moderation_sanctions_reason_code_check
    check (reason_code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint moderation_sanctions_user_message_check
    check (char_length(btrim(user_message)) between 10 and 1000),
  constraint moderation_sanctions_internal_note_check
    check (internal_note is null or char_length(btrim(internal_note)) between 1 and 2000),
  constraint moderation_sanctions_strike_points_check
    check (
      (sanction_type = 'strike' and strike_points between 1 and 3)
      or (sanction_type <> 'strike' and strike_points is null)
    ),
  constraint moderation_sanctions_restrictions_object_check
    check (jsonb_typeof(restrictions) = 'object'),
  constraint moderation_sanctions_related_resource_check
    check (
      (
        related_resource_type is null
        and related_resource_id is null
      )
      or (
        related_resource_type is not null
        and
        related_resource_type ~ '^[a-z][a-z0-9_]{1,63}$'
        and related_resource_id is not null
      )
    ),
  constraint moderation_sanctions_supersession_identity_check
    check (
      (supersedes_sanction_id is null or supersedes_sanction_id <> id)
      and (replacement_sanction_id is null or replacement_sanction_id <> id)
    ),
  constraint moderation_sanctions_expiry_check
    check (expires_at is null or expires_at > starts_at),
  constraint moderation_sanctions_acknowledgement_check
    check (
      (
        acknowledged_at is null
        and acknowledged_by_user_id is null
        and acknowledged_by_user_id_snapshot is null
      )
      or (
        acknowledged_at is not null
        and
        acknowledgement_required
        and acknowledged_at >= starts_at
        and acknowledged_by_user_id_snapshot = subject_user_id_snapshot
        and (
          acknowledged_by_user_id is null
          or acknowledged_by_user_id = acknowledged_by_user_id_snapshot
        )
      )
    ),
  constraint moderation_sanctions_revocation_check
    check (
      (
        revoked_at is null
        and revoked_by_user_id is null
        and revoked_by_user_id_snapshot is null
        and revoked_by_role is null
        and revocation_kind is null
        and revocation_reason is null
      )
      or (
        revoked_at is not null
        and revoked_at >= starts_at
        and revocation_kind = any (array['revoked', 'overturned']::text[])
        and revocation_reason is not null
        and char_length(btrim(revocation_reason)) between 10 and 1000
        and (
          (
            revoked_by_role = 'system'
            and revoked_by_user_id is null
            and revoked_by_user_id_snapshot is null
          )
          or (
            revoked_by_role = any (array['admin', 'moderator']::text[])
            and revoked_by_user_id_snapshot is not null
            and (
              revoked_by_user_id is null
              or revoked_by_user_id = revoked_by_user_id_snapshot
            )
          )
        )
      )
    ),
  constraint moderation_sanctions_review_check
    check (
      (review_requested_at is null) = (review_status is null)
      and (
        review_status is null
        or review_status = any (array['pending', 'upheld', 'modified', 'overturned']::text[])
      )
      and (
      (
        review_requested_at is null
        and review_status is null
        and reviewed_at is null
        and reviewed_by_user_id is null
        and reviewed_by_user_id_snapshot is null
        and reviewed_by_role is null
        and replacement_sanction_id is null
        and review_outcome_message is null
        and review_private_reason is null
      )
      or (
        review_requested_at is not null
        and review_requested_at >= starts_at
        and review_status = 'pending'
        and reviewed_at is null
        and reviewed_by_user_id is null
        and reviewed_by_user_id_snapshot is null
        and reviewed_by_role is null
        and replacement_sanction_id is null
        and review_outcome_message is null
        and review_private_reason is null
      )
      or (
        review_requested_at is not null
        and review_requested_at >= starts_at
        and review_status = any (array['upheld', 'modified', 'overturned']::text[])
        and reviewed_at is not null
        and reviewed_at >= review_requested_at
        and (
          (
            reviewed_by_role = 'system'
            and reviewed_by_user_id is null
            and reviewed_by_user_id_snapshot is null
          )
          or (
            reviewed_by_role = any (array['admin', 'moderator']::text[])
            and reviewed_by_user_id_snapshot is not null
            and (
              reviewed_by_user_id is null
              or reviewed_by_user_id = reviewed_by_user_id_snapshot
            )
          )
        )
        and (
          (review_status = 'modified' and replacement_sanction_id is not null)
          or (
            review_status = any (array['upheld', 'overturned']::text[])
            and replacement_sanction_id is null
          )
        )
        and review_outcome_message is not null
        and char_length(btrim(review_outcome_message)) between 10 and 2000
        and (
          review_private_reason is null
          or char_length(btrim(review_private_reason)) between 1 and 2000
        )
      )
      )
    ),
  constraint moderation_sanctions_overturn_check
    check (
      (
        review_status = 'overturned'
        and revoked_at is not null
        and revocation_kind = 'overturned'
      )
      or (
        review_status is distinct from 'overturned'
        and revocation_kind is distinct from 'overturned'
      )
    ),
  constraint moderation_sanctions_modified_resolution_check
    check (
      (
        review_status = 'modified'
        and replacement_sanction_id is not null
        and revoked_at is not null
        and revocation_kind = 'revoked'
      )
      or (
        review_status is distinct from 'modified'
        and replacement_sanction_id is null
      )
    ),
  constraint moderation_sanctions_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create table public.moderation_audit_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_user_id_snapshot uuid,
  actor_role text,
  subject_user_id uuid references auth.users(id) on delete set null,
  subject_user_id_snapshot uuid,
  sanction_id uuid references public.moderation_sanctions(id) on delete set null,
  source_report_id uuid references public.reports(id) on delete set null,
  resource_type text not null,
  resource_id uuid,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  request_id text,
  occurred_at timestamptz not null default now(),
  constraint moderation_audit_events_event_type_check
    check (
      char_length(event_type) between 2 and 128
      and event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'
    ),
  constraint moderation_audit_events_actor_snapshot_check
    check (
      actor_user_id is null
      or (
        actor_user_id_snapshot is not null
        and actor_user_id = actor_user_id_snapshot
      )
    ),
  constraint moderation_audit_events_subject_snapshot_check
    check (
      subject_user_id is null
      or (
        subject_user_id_snapshot is not null
        and subject_user_id = subject_user_id_snapshot
      )
    ),
  constraint moderation_audit_events_actor_role_check
    check (actor_role is null or char_length(btrim(actor_role)) between 1 and 50),
  constraint moderation_audit_events_resource_type_check
    check (resource_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint moderation_audit_events_summary_check
    check (char_length(btrim(summary)) between 1 and 1000),
  constraint moderation_audit_events_metadata_object_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint moderation_audit_events_request_id_check
    check (request_id is null or char_length(btrim(request_id)) between 1 and 200)
);

create or replace function private.enforce_moderation_sanction_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.issued_by_role = any (array['admin', 'moderator']::text[])
      and new.issued_by_user_id is null then
      raise exception using
        errcode = '23514',
        message = 'moderation_sanction_human_issuer_is_required';
    end if;

    if new.supersedes_sanction_id is not null and not exists (
      select 1
      from public.moderation_sanctions original
      where original.id = new.supersedes_sanction_id
        and original.subject_user_id_snapshot = new.subject_user_id_snapshot
        and original.review_status = 'pending'
        and original.revoked_at is null
        and original.replacement_sanction_id is null
    ) then
      raise exception using
        errcode = '23514',
        message = 'moderation_sanction_supersession_is_invalid';
    end if;

    if new.acknowledged_at is not null
      or new.acknowledged_by_user_id is not null
      or new.acknowledged_by_user_id_snapshot is not null
      or new.revoked_at is not null
      or new.revoked_by_user_id is not null
      or new.revoked_by_user_id_snapshot is not null
      or new.revoked_by_role is not null
      or new.revocation_kind is not null
      or new.revocation_reason is not null
      or new.review_requested_at is not null
      or new.review_status is not null
      or new.reviewed_at is not null
      or new.reviewed_by_user_id is not null
      or new.reviewed_by_user_id_snapshot is not null
      or new.reviewed_by_role is not null
      or new.replacement_sanction_id is not null
      or new.review_outcome_message is not null
      or new.review_private_reason is not null then
      raise exception using
        errcode = '42501',
        message = 'moderation_sanction_lifecycle_must_start_empty';
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception using
      errcode = '42501',
      message = 'moderation_sanctions_are_durable';
  end if;

  if new.id is distinct from old.id
    or not (
      new.subject_user_id is not distinct from old.subject_user_id
      or (old.subject_user_id is not null and new.subject_user_id is null)
    )
    or new.subject_user_id_snapshot is distinct from old.subject_user_id_snapshot
    or not (
      new.issued_by_user_id is not distinct from old.issued_by_user_id
      or (
        old.issued_by_user_id is not null
        and new.issued_by_user_id is null
        and not exists (
          select 1
          from auth.users issuer
          where issuer.id = old.issued_by_user_id
        )
      )
    )
    or new.issued_by_user_id_snapshot is distinct from old.issued_by_user_id_snapshot
    or new.issued_by_role is distinct from old.issued_by_role
    or not (
      new.source_report_id is not distinct from old.source_report_id
      or (old.source_report_id is not null and new.source_report_id is null)
    )
    or new.sanction_type is distinct from old.sanction_type
    or new.severity is distinct from old.severity
    or new.reason_code is distinct from old.reason_code
    or new.user_message is distinct from old.user_message
    or new.internal_note is distinct from old.internal_note
    or new.strike_points is distinct from old.strike_points
    or new.restrictions is distinct from old.restrictions
    or new.related_resource_type is distinct from old.related_resource_type
    or new.related_resource_id is distinct from old.related_resource_id
    or new.supersedes_sanction_id is distinct from old.supersedes_sanction_id
    or new.starts_at is distinct from old.starts_at
    or new.expires_at is distinct from old.expires_at
    or new.acknowledgement_required is distinct from old.acknowledgement_required
    or new.metadata is distinct from old.metadata
    or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = '42501',
      message = 'moderation_sanction_core_is_immutable';
  end if;

  if old.acknowledged_at is not null
    and (
      new.acknowledged_at is distinct from old.acknowledged_at
      or not (
        new.acknowledged_by_user_id is not distinct from old.acknowledged_by_user_id
        or (
          old.acknowledged_by_user_id is not null
          and new.acknowledged_by_user_id is null
        )
      )
      or new.acknowledged_by_user_id_snapshot is distinct from old.acknowledged_by_user_id_snapshot
    ) then
    raise exception using
      errcode = '42501',
      message = 'moderation_sanction_acknowledgement_is_immutable';
  end if;

  if old.revoked_at is not null
    and (
      new.revoked_at is distinct from old.revoked_at
      or not (
        new.revoked_by_user_id is not distinct from old.revoked_by_user_id
        or (old.revoked_by_user_id is not null and new.revoked_by_user_id is null)
      )
      or new.revoked_by_user_id_snapshot is distinct from old.revoked_by_user_id_snapshot
      or new.revoked_by_role is distinct from old.revoked_by_role
      or new.revocation_kind is distinct from old.revocation_kind
      or new.revocation_reason is distinct from old.revocation_reason
    ) then
    raise exception using
      errcode = '42501',
      message = 'moderation_sanction_revocation_is_immutable';
  end if;

  if old.review_requested_at is null
    and new.review_requested_at is not null
    and new.review_status is distinct from 'pending' then
    raise exception using
      errcode = '42501',
      message = 'moderation_sanction_review_must_start_pending';
  end if;

  if old.review_requested_at is not null
    and new.review_requested_at is distinct from old.review_requested_at then
    raise exception using
      errcode = '42501',
      message = 'moderation_sanction_review_request_is_immutable';
  end if;

  if old.review_status = 'pending'
    and new.review_status not in ('pending', 'upheld', 'modified', 'overturned') then
    raise exception using
      errcode = '42501',
      message = 'moderation_sanction_review_transition_is_invalid';
  end if;

  if old.review_status = 'pending'
    and new.review_status = 'modified'
    and not exists (
      select 1
      from public.moderation_sanctions replacement
      where replacement.id = new.replacement_sanction_id
        and replacement.supersedes_sanction_id = old.id
        and replacement.subject_user_id_snapshot = old.subject_user_id_snapshot
        and replacement.revoked_at is null
    ) then
    raise exception using
      errcode = '23514',
      message = 'moderation_sanction_modified_review_requires_replacement';
  end if;

  if old.review_status = any (array['upheld', 'modified', 'overturned']::text[])
    and (
      new.review_status is distinct from old.review_status
      or new.reviewed_at is distinct from old.reviewed_at
      or not (
        new.reviewed_by_user_id is not distinct from old.reviewed_by_user_id
        or (
          old.reviewed_by_user_id is not null
          and new.reviewed_by_user_id is null
        )
      )
      or new.reviewed_by_user_id_snapshot is distinct from old.reviewed_by_user_id_snapshot
      or new.reviewed_by_role is distinct from old.reviewed_by_role
      or new.replacement_sanction_id is distinct from old.replacement_sanction_id
      or new.review_outcome_message is distinct from old.review_outcome_message
      or new.review_private_reason is distinct from old.review_private_reason
    ) then
    raise exception using
      errcode = '42501',
      message = 'moderation_sanction_review_outcome_is_immutable';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

alter function private.enforce_moderation_sanction_lifecycle() owner to postgres;
revoke all on function private.enforce_moderation_sanction_lifecycle()
  from public, anon, authenticated, service_role;

drop trigger if exists enforce_moderation_sanction_lifecycle
  on public.moderation_sanctions;
create trigger enforce_moderation_sanction_lifecycle
  before insert or update or delete on public.moderation_sanctions
  for each row execute function private.enforce_moderation_sanction_lifecycle();

create or replace function private.prevent_moderation_audit_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and new.id is not distinct from old.id
    and new.event_type is not distinct from old.event_type
    and (
      new.actor_user_id is not distinct from old.actor_user_id
      or (old.actor_user_id is not null and new.actor_user_id is null)
    )
    and new.actor_user_id_snapshot is not distinct from old.actor_user_id_snapshot
    and new.actor_role is not distinct from old.actor_role
    and (
      new.subject_user_id is not distinct from old.subject_user_id
      or (old.subject_user_id is not null and new.subject_user_id is null)
    )
    and new.subject_user_id_snapshot is not distinct from old.subject_user_id_snapshot
    and (
      new.sanction_id is not distinct from old.sanction_id
      or (old.sanction_id is not null and new.sanction_id is null)
    )
    and (
      new.source_report_id is not distinct from old.source_report_id
      or (old.source_report_id is not null and new.source_report_id is null)
    )
    and new.resource_type is not distinct from old.resource_type
    and new.resource_id is not distinct from old.resource_id
    and new.summary is not distinct from old.summary
    and new.metadata is not distinct from old.metadata
    and new.request_id is not distinct from old.request_id
    and new.occurred_at is not distinct from old.occurred_at then
    return new;
  end if;

  raise exception using
    errcode = '42501',
    message = 'moderation_audit_events_are_append_only';
end;
$$;

alter function private.prevent_moderation_audit_event_mutation() owner to postgres;
revoke all on function private.prevent_moderation_audit_event_mutation()
  from public, anon, authenticated, service_role;

drop trigger if exists prevent_moderation_audit_event_mutation
  on public.moderation_audit_events;
create trigger prevent_moderation_audit_event_mutation
  before update or delete on public.moderation_audit_events
  for each row execute function private.prevent_moderation_audit_event_mutation();

create or replace function private.audit_moderation_sanction_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
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
      occurred_at
    ) values (
      case
        when new.metadata ->> 'origin' = 'legacy_user_status' then 'sanction_imported'
        else 'sanction_issued'
      end,
      new.issued_by_user_id,
      new.issued_by_user_id_snapshot,
      new.issued_by_role,
      new.subject_user_id,
      new.subject_user_id_snapshot,
      new.id,
      new.source_report_id,
      'user',
      new.subject_user_id_snapshot,
      case
        when new.metadata ->> 'origin' = 'legacy_user_status'
          then 'Legacy moderation sanction imported.'
        else 'Moderation sanction issued.'
      end,
      jsonb_build_object(
        'sanction_type', new.sanction_type,
        'severity', new.severity,
        'reason_code', new.reason_code,
        'strike_points', new.strike_points,
        'restrictions', new.restrictions,
        'related_resource_type', new.related_resource_type,
        'related_resource_id', new.related_resource_id,
        'supersedes_sanction_id', new.supersedes_sanction_id,
        'expires_at', new.expires_at,
        'acknowledgement_required', new.acknowledgement_required
      ),
      new.starts_at
    );

    return new;
  end if;

  if old.acknowledged_at is null and new.acknowledged_at is not null then
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
      occurred_at
    ) values (
      'sanction_acknowledged',
      new.acknowledged_by_user_id,
      new.acknowledged_by_user_id_snapshot,
      'user',
      new.subject_user_id,
      new.subject_user_id_snapshot,
      new.id,
      new.source_report_id,
      'user',
      new.subject_user_id_snapshot,
      'Moderation sanction acknowledged.',
      jsonb_build_object('sanction_type', new.sanction_type),
      new.acknowledged_at
    );
  end if;

  if old.review_requested_at is null and new.review_requested_at is not null then
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
      occurred_at
    ) values (
      'sanction_review_requested',
      new.subject_user_id,
      new.subject_user_id_snapshot,
      'user',
      new.subject_user_id,
      new.subject_user_id_snapshot,
      new.id,
      new.source_report_id,
      'user',
      new.subject_user_id_snapshot,
      'Review requested for moderation sanction.',
      jsonb_build_object(
        'sanction_type', new.sanction_type,
        'review_status', new.review_status
      ),
      new.review_requested_at
    );
  end if;

  if old.review_status = 'pending'
    and new.review_status = any (array['upheld', 'modified', 'overturned']::text[]) then
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
      occurred_at
    ) values (
      'sanction_review_decided',
      new.reviewed_by_user_id,
      new.reviewed_by_user_id_snapshot,
      new.reviewed_by_role,
      new.subject_user_id,
      new.subject_user_id_snapshot,
      new.id,
      new.source_report_id,
      'user',
      new.subject_user_id_snapshot,
      'Review decided for moderation sanction.',
      jsonb_build_object(
        'sanction_type', new.sanction_type,
        'review_status', new.review_status,
        'replacement_sanction_id', new.replacement_sanction_id,
        'review_outcome_message', new.review_outcome_message,
        'review_private_reason', new.review_private_reason
      ),
      new.reviewed_at
    );
  end if;

  if old.revoked_at is null and new.revoked_at is not null then
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
      occurred_at
    ) values (
      'sanction_revoked',
      new.revoked_by_user_id,
      new.revoked_by_user_id_snapshot,
      new.revoked_by_role,
      new.subject_user_id,
      new.subject_user_id_snapshot,
      new.id,
      new.source_report_id,
      'user',
      new.subject_user_id_snapshot,
      'Moderation sanction revoked.',
      jsonb_build_object(
        'sanction_type', new.sanction_type,
        'revocation_kind', new.revocation_kind,
        'revocation_reason', new.revocation_reason
      ),
      new.revoked_at
    );
  end if;

  return new;
end;
$$;

alter function private.audit_moderation_sanction_lifecycle() owner to postgres;
revoke all on function private.audit_moderation_sanction_lifecycle()
  from public, anon, authenticated, service_role;

drop trigger if exists audit_moderation_sanction_lifecycle
  on public.moderation_sanctions;
create trigger audit_moderation_sanction_lifecycle
  after insert or update on public.moderation_sanctions
  for each row execute function private.audit_moderation_sanction_lifecycle();

-- Deterministically preserve every legacy ban signal before normalizing the
-- current-state projection. Expired legacy rows become expired sanctions and
-- are not resurrected as active bans.
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
  case
    when exists (
      select 1
      from auth.users account
      where account.id = status.user_id
    ) then status.user_id
    else null
  end,
  status.user_id,
  null,
  null,
  'system',
  'ban',
  'critical',
  'legacy',
  case
    when char_length(btrim(coalesce(status.ban_reason, ''))) between 10 and 1000
      then btrim(status.ban_reason)
    else 'Legacy account restriction imported without a user-facing explanation.'
  end,
  'Imported from the legacy user_status projection during the moderation enforcement migration.',
  jsonb_build_object('account_access', 'blocked'),
  status.legacy_starts_at,
  status.banned_until,
  false,
  jsonb_build_object(
    'origin', 'legacy_user_status',
    'legacy_is_banned', coalesce(status.is_banned, false),
    'imported_at', now()
  ),
  status.legacy_starts_at,
  status.legacy_starts_at
from (
  select
    legacy_status.*,
    case
      when legacy_status.banned_until is not null
        and coalesce(legacy_status.updated_at, legacy_status.created_at, now())
          >= legacy_status.banned_until
        then legacy_status.banned_until - interval '1 second'
      else coalesce(legacy_status.updated_at, legacy_status.created_at, now())
    end as legacy_starts_at
  from public.user_status legacy_status
) status
where coalesce(status.is_banned, false)
   or status.banned_until is not null
   or nullif(btrim(coalesce(status.ban_reason, '')), '') is not null;

-- Retain legacy history above, then make the projection truthful. An expired
-- row is inactive and must not be converted into an indefinite restriction.
update public.user_status
set is_banned = false,
    banned_until = null,
    ban_reason = null,
    updated_at = now()
where is_banned
  and banned_until is not null
  and banned_until <= now();

update public.user_status
set banned_until = null,
    ban_reason = null,
    updated_at = now()
where not is_banned
  and (banned_until is not null or ban_reason is not null);

update public.user_status
set ban_reason = case
      when char_length(btrim(coalesce(ban_reason, ''))) between 10 and 1000
        then btrim(ban_reason)
      else 'Account access has been restricted by moderation.'
    end,
    updated_at = coalesce(updated_at, now())
where is_banned;

-- Orphaned current-state rows are no longer enforceable. Their durable
-- sanction and audit snapshots were created before this cleanup.
delete from public.user_status status
where status.user_id is null
   or not exists (
     select 1
     from auth.users account
     where account.id = status.user_id
   );

alter table public.user_status
  alter column user_id set not null,
  alter column is_banned set default false,
  alter column is_banned set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

create unique index if not exists user_status_user_id_uidx
  on public.user_status (user_id);

do $migration$
declare
  status_user_id_attnum smallint;
  foreign_key record;
begin
  select attribute.attnum
  into status_user_id_attnum
  from pg_attribute attribute
  where attribute.attrelid = 'public.user_status'::regclass
    and attribute.attname = 'user_id'
    and not attribute.attisdropped;

  for foreign_key in
    select constraint_row.conname
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.user_status'::regclass
      and constraint_row.contype = 'f'
      and constraint_row.confrelid = 'auth.users'::regclass
      and constraint_row.conkey = array[status_user_id_attnum]::smallint[]
      and constraint_row.confdeltype <> 'c'
  loop
    execute format(
      'alter table public.user_status drop constraint %I',
      foreign_key.conname
    );
  end loop;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.user_status'::regclass
      and constraint_row.contype = 'f'
      and constraint_row.confrelid = 'auth.users'::regclass
      and constraint_row.conkey = array[status_user_id_attnum]::smallint[]
      and constraint_row.confdeltype = 'c'
  ) then
    alter table public.user_status
      add constraint user_status_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end
$migration$;

alter table public.user_status
  drop constraint if exists user_status_ban_state_check,
  drop constraint if exists user_status_ban_reason_check;

alter table public.user_status
  add constraint user_status_ban_state_check
    check (
      is_banned
      or (banned_until is null and ban_reason is null)
    ),
  add constraint user_status_ban_reason_check
    check (
      not is_banned
      or (
        ban_reason is not null
        and char_length(btrim(ban_reason)) between 10 and 1000
      )
    );

create index if not exists user_status_active_bans_idx
  on public.user_status (banned_until, user_id)
  where is_banned;

create index moderation_sanctions_subject_created_idx
  on public.moderation_sanctions (subject_user_id_snapshot, created_at desc, id desc);

create index moderation_sanctions_subject_active_idx
  on public.moderation_sanctions (subject_user_id_snapshot, starts_at desc, id desc)
  where revoked_at is null;

create index moderation_sanctions_acknowledgement_idx
  on public.moderation_sanctions (subject_user_id_snapshot, created_at desc, id desc)
  where acknowledgement_required and acknowledged_at is null and revoked_at is null;

create index moderation_sanctions_expiry_idx
  on public.moderation_sanctions (expires_at, id)
  where expires_at is not null and revoked_at is null;

create index moderation_sanctions_issuer_idx
  on public.moderation_sanctions (issued_by_user_id_snapshot, created_at desc, id desc)
  where issued_by_user_id_snapshot is not null;

create index moderation_sanctions_source_report_idx
  on public.moderation_sanctions (source_report_id)
  where source_report_id is not null;

create index moderation_sanctions_review_queue_idx
  on public.moderation_sanctions (review_requested_at, id)
  where review_status = 'pending';

create unique index moderation_sanctions_supersedes_uidx
  on public.moderation_sanctions (supersedes_sanction_id)
  where supersedes_sanction_id is not null;

create unique index moderation_sanctions_replacement_uidx
  on public.moderation_sanctions (replacement_sanction_id)
  where replacement_sanction_id is not null;

create index moderation_sanctions_related_resource_idx
  on public.moderation_sanctions (related_resource_type, related_resource_id)
  where related_resource_id is not null;

create index moderation_sanctions_type_severity_idx
  on public.moderation_sanctions (sanction_type, severity, created_at desc, id desc);

create index moderation_audit_events_occurred_idx
  on public.moderation_audit_events (occurred_at desc, id desc);

create index moderation_audit_events_actor_idx
  on public.moderation_audit_events (actor_user_id_snapshot, occurred_at desc, id desc)
  where actor_user_id_snapshot is not null;

create index moderation_audit_events_subject_idx
  on public.moderation_audit_events (subject_user_id_snapshot, occurred_at desc, id desc)
  where subject_user_id_snapshot is not null;

create index moderation_audit_events_sanction_idx
  on public.moderation_audit_events (sanction_id, occurred_at desc, id desc)
  where sanction_id is not null;

create index moderation_audit_events_resource_idx
  on public.moderation_audit_events (resource_type, resource_id, occurred_at desc, id desc);

create index moderation_audit_events_type_idx
  on public.moderation_audit_events (event_type, occurred_at desc, id desc);

create index moderation_audit_events_request_idx
  on public.moderation_audit_events (request_id)
  where request_id is not null;

alter table public.user_status enable row level security;
alter table public.moderation_sanctions enable row level security;
alter table public.moderation_audit_events enable row level security;

-- Reconcile and replace any legacy user_status policies, including the former
-- admin ALL policy. Current-state writes stay behind the trusted service API.
do $migration$
declare
  policy_row record;
begin
  for policy_row in
    select policy.policyname
    from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'user_status'
  loop
    execute format(
      'drop policy %I on public.user_status',
      policy_row.policyname
    );
  end loop;
end
$migration$;

create policy user_status_select_own
  on public.user_status
  for select
  to authenticated
  using (
    (select auth.uid()) is not null
    and user_id = (select auth.uid())
  );

create policy moderation_sanctions_select_own
  on public.moderation_sanctions
  for select
  to authenticated
  using (
    (select auth.uid()) is not null
    and subject_user_id = (select auth.uid())
  );

revoke all on table public.user_status from public, anon, authenticated;
revoke all on table public.moderation_sanctions from public, anon, authenticated;
revoke all on table public.moderation_audit_events from public, anon, authenticated;

grant select (user_id, is_banned, banned_until, ban_reason, updated_at)
  on public.user_status to authenticated;
grant select, insert, update
  on public.user_status to service_role;

grant select (
  id,
  sanction_type,
  severity,
  reason_code,
  user_message,
  strike_points,
  restrictions,
  starts_at,
  expires_at,
  acknowledgement_required,
  acknowledged_at,
  revoked_at,
  revocation_kind,
  revocation_reason,
  review_requested_at,
  review_status,
  reviewed_at,
  supersedes_sanction_id,
  replacement_sanction_id,
  review_outcome_message,
  created_at,
  updated_at
) on public.moderation_sanctions to authenticated;
grant select, insert, update
  on public.moderation_sanctions to service_role;

grant select, insert
  on public.moderation_audit_events to service_role;

create view public.user_moderation_notices
with (security_invoker = true, security_barrier = true)
as
select
  sanction.id,
  sanction.sanction_type,
  sanction.severity,
  sanction.reason_code,
  sanction.user_message,
  sanction.strike_points,
  sanction.restrictions,
  sanction.starts_at,
  sanction.expires_at,
  sanction.acknowledgement_required,
  sanction.acknowledged_at,
  sanction.revoked_at,
  sanction.revocation_kind,
  sanction.revocation_reason,
  sanction.review_requested_at,
  sanction.review_status,
  sanction.reviewed_at,
  sanction.supersedes_sanction_id,
  sanction.replacement_sanction_id,
  sanction.review_outcome_message,
  case
    when sanction.review_status = 'overturned' then 'overturned'
    when sanction.revoked_at is not null then 'revoked'
    when sanction.expires_at is not null and sanction.expires_at <= now() then 'expired'
    when sanction.acknowledged_at is not null then 'acknowledged'
    else 'active'
  end as lifecycle_state,
  sanction.created_at,
  sanction.updated_at
from public.moderation_sanctions sanction;

alter view public.user_moderation_notices owner to postgres;
revoke all on table public.user_moderation_notices from public, anon, authenticated;
grant select on table public.user_moderation_notices to authenticated, service_role;

-- Do not expose moderation state through Postgres Changes: DELETE payloads are
-- not filtered through RLS and can reveal deleted account UUIDs and timing.
-- Stage 4 uses a safe notification event and then refetches the RLS-protected
-- user_moderation_notices view. The sanctions base table also remains private.
do $migration$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_status'
  ) then
    alter publication supabase_realtime drop table public.user_status;
  end if;
end
$migration$;

comment on table public.user_status is
  'Current moderation enforcement projection. Durable history lives in moderation_sanctions and moderation_audit_events.';
comment on table public.moderation_sanctions is
  'Durable warnings, strikes, and bans with one-way acknowledgement, review, and revocation lifecycle fields.';
comment on table public.moderation_audit_events is
  'Append-only trusted moderation history. Snapshot UUIDs survive deletion of referenced Auth users.';
comment on view public.user_moderation_notices is
  'Security-invoker user-safe sanction projection that excludes internal notes, private metadata, and moderator identity.';
comment on function private.enforce_moderation_sanction_lifecycle() is
  'Prevents sanction deletion and mutation of sanction facts after issuance; acknowledgement, review, and revocation may advance only once.';
comment on function private.prevent_moderation_audit_event_mutation() is
  'Rejects every UPDATE and DELETE against append-only moderation audit history.';
comment on function private.audit_moderation_sanction_lifecycle() is
  'Automatically appends issue/import, acknowledgement, review, and revocation events for every sanction lifecycle transition.';
