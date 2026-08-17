-- Stage 6 message-send idempotency foundation.
--
-- This migration is deliberately additive. The legacy three-argument message
-- and reservation RPCs remain callable until the later application cutover is
-- proven. New clients bind one immutable operation UUID to the normalized
-- message body and ordered attachment plan so retries cannot duplicate visible
-- messages, attachments, conversation previews, or notifications.

create schema if not exists message_send_private;
revoke all on schema message_send_private
  from public, anon, authenticated, service_role;

create table message_send_private.operations (
  sender_user_id uuid references auth.users(id) on delete set null,
  sender_user_id_snapshot uuid not null,
  operation_id uuid not null,
  conversation_id uuid references public.conversations(id) on delete set null,
  conversation_id_snapshot uuid not null,
  canonical_payload jsonb not null,
  reservation_result jsonb,
  status text not null default 'pending',
  result jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  aborted_at timestamptz,
  primary key (sender_user_id_snapshot, operation_id),
  constraint message_send_operation_status_check
    check (status in ('pending', 'completed', 'aborted')),
  constraint message_send_operation_payload_shape_check
    check (
      jsonb_typeof(canonical_payload) = 'object'
      and canonical_payload ?& array['conversation_id', 'body', 'attachments']
      and jsonb_typeof(canonical_payload -> 'body') = 'string'
      and jsonb_typeof(canonical_payload -> 'attachments') = 'array'
    ),
  constraint message_send_operation_result_state_check
    check (
      (status = 'pending' and result is null and completed_at is null and aborted_at is null)
      or (status = 'completed' and result is not null and completed_at is not null and aborted_at is null)
      or (status = 'aborted' and result is not null and completed_at is null and aborted_at is not null)
    )
);

create index message_send_operations_live_sender_created_idx
  on message_send_private.operations (sender_user_id, created_at desc)
  where sender_user_id is not null;

alter table message_send_private.operations enable row level security;
revoke all on table message_send_private.operations
  from public, anon, authenticated, service_role;

alter table private.message_media_upload_reservations
  add column if not exists send_operation_id uuid,
  add column if not exists send_operation_sender_snapshot uuid;

alter table private.message_media_upload_reservations
  drop constraint if exists message_media_reservation_operation_pair_check,
  add constraint message_media_reservation_operation_pair_check
    check (
      (send_operation_id is null and send_operation_sender_snapshot is null)
      or (send_operation_id is not null and send_operation_sender_snapshot is not null)
    );

alter table private.message_media_upload_reservations
  drop constraint if exists message_media_reservation_operation_fkey,
  add constraint message_media_reservation_operation_fkey
    foreign key (send_operation_sender_snapshot, send_operation_id)
    references message_send_private.operations(sender_user_id_snapshot, operation_id)
    on delete restrict;

create index if not exists message_media_reservations_send_operation_idx
  on private.message_media_upload_reservations (
    send_operation_sender_snapshot,
    send_operation_id,
    storage_path
  )
  where send_operation_id is not null;

create or replace function message_send_private.normalize_user_prose(p_value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $function$
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
  )
$function$;

alter function message_send_private.normalize_user_prose(text) owner to postgres;
revoke all on function message_send_private.normalize_user_prose(text)
  from public, anon, authenticated, service_role;

create or replace function message_send_private.canonical_payload(
  p_conversation_id uuid,
  p_body text,
  p_attachments jsonb
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  normalized_body text := message_send_private.normalize_user_prose(p_body);
  submitted_attachments jsonb := coalesce(p_attachments, '[]'::jsonb);
  normalized_attachments jsonb;
  attachment_count integer;
begin
  if p_conversation_id is null or jsonb_typeof(submitted_attachments) <> 'array' then
    raise exception 'message_send_payload_invalid' using errcode = '22023';
  end if;

  attachment_count := jsonb_array_length(submitted_attachments);

  if attachment_count > 3
    or (char_length(normalized_body) = 0 and attachment_count = 0)
    or char_length(normalized_body) > 2000 then
    raise exception 'message_send_payload_invalid' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(submitted_attachments) with ordinality item(value, position)
    where jsonb_typeof(item.value) <> 'object'
      or coalesce(item.value ->> 'storage_path', '') = ''
      or coalesce(item.value ->> 'file_name', '') = ''
      or coalesce(item.value ->> 'mime_type', '') = ''
      or coalesce(item.value ->> 'size_bytes', '') !~ '^[0-9]+$'
  ) then
    raise exception 'message_send_payload_invalid' using errcode = '22023';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'storage_path', item.value ->> 'storage_path',
        'file_name', message_send_private.normalize_user_prose(item.value ->> 'file_name'),
        'mime_type', lower(message_send_private.normalize_user_prose(item.value ->> 'mime_type')),
        'size_bytes', (item.value ->> 'size_bytes')::bigint
      )
      order by item.position
    ),
    '[]'::jsonb
  )
  into normalized_attachments
  from jsonb_array_elements(submitted_attachments) with ordinality item(value, position);

  if attachment_count <> (
    select count(distinct attachment ->> 'storage_path')
    from jsonb_array_elements(normalized_attachments) attachment
  ) then
    raise exception 'message_send_attachment_paths_must_be_unique' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'conversation_id', p_conversation_id,
    'body', normalized_body,
    'attachments', normalized_attachments
  );
end
$function$;

alter function message_send_private.canonical_payload(uuid, text, jsonb)
  owner to postgres;
revoke all on function message_send_private.canonical_payload(uuid, text, jsonb)
  from public, anon, authenticated, service_role;

create or replace function message_send_private.lock_operation(
  p_sender_id uuid,
  p_operation_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  if p_sender_id is null or p_operation_id is null then
    raise exception 'message_send_operation_invalid' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_sender_id::text || ':' || p_operation_id::text, 0)
  );
end
$function$;

alter function message_send_private.lock_operation(uuid, uuid) owner to postgres;
revoke all on function message_send_private.lock_operation(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function message_send_private.guard_operation_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  -- Preserve immutable snapshots while allowing ON DELETE SET NULL to detach
  -- only the live Auth/conversation references. A detached reference can never
  -- be rebound to a different row.
  if tg_op = 'UPDATE'
    and coalesce(current_setting('smot.message_send_operation_scope', true), '') = ''
    and new.sender_user_id_snapshot is not distinct from old.sender_user_id_snapshot
    and new.operation_id is not distinct from old.operation_id
    and new.conversation_id_snapshot is not distinct from old.conversation_id_snapshot
    and new.canonical_payload is not distinct from old.canonical_payload
    and new.reservation_result is not distinct from old.reservation_result
    and new.status is not distinct from old.status
    and new.result is not distinct from old.result
    and new.created_at is not distinct from old.created_at
    and new.completed_at is not distinct from old.completed_at
    and new.aborted_at is not distinct from old.aborted_at
    and (new.sender_user_id is null or new.sender_user_id is not distinct from old.sender_user_id)
    and (new.conversation_id is null or new.conversation_id is not distinct from old.conversation_id)
    and (
      new.sender_user_id is distinct from old.sender_user_id
      or new.conversation_id is distinct from old.conversation_id
    ) then
    new.updated_at := timezone('utc', now());
    return new;
  end if;

  if current_user <> 'postgres'
    or coalesce(current_setting('smot.message_send_operation_scope', true), '') <> 'trusted' then
    raise exception 'message_send_operation_mutation_forbidden' using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    raise exception 'message_send_operation_history_is_immutable' using errcode = '42501';
  end if;

  if new.sender_user_id_snapshot is distinct from old.sender_user_id_snapshot
    or new.operation_id is distinct from old.operation_id
    or new.conversation_id_snapshot is distinct from old.conversation_id_snapshot
    or new.canonical_payload is distinct from old.canonical_payload
    or new.created_at is distinct from old.created_at
    or (old.completed_at is not null and new.completed_at is distinct from old.completed_at)
    or (old.aborted_at is not null and new.aborted_at is distinct from old.aborted_at)
    or (old.reservation_result is not null and new.reservation_result is distinct from old.reservation_result)
    or (old.result is not null and new.result is distinct from old.result)
    or old.status in ('completed', 'aborted') then
    raise exception 'message_send_operation_history_is_immutable' using errcode = '42501';
  end if;

  new.updated_at := timezone('utc', now());
  return new;
end
$function$;

alter function message_send_private.guard_operation_mutation() owner to postgres;
revoke all on function message_send_private.guard_operation_mutation()
  from public, anon, authenticated, service_role;

drop trigger if exists guard_message_send_operation_mutation
  on message_send_private.operations;
create trigger guard_message_send_operation_mutation
  before update or delete on message_send_private.operations
  for each row execute function message_send_private.guard_operation_mutation();

create or replace function message_send_private.reserve_uploads_impl(
  p_operation_id uuid,
  p_conversation_id uuid,
  p_body text,
  p_attachments jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  payload jsonb;
  operation message_send_private.operations%rowtype;
  reservation_rows jsonb;
begin
  if actor_id is null or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    raise exception 'message_send_authentication_required' using errcode = '28000';
  end if;

  payload := message_send_private.canonical_payload(
    p_conversation_id,
    p_body,
    p_attachments
  );

  if jsonb_array_length(payload -> 'attachments') not between 1 and 3 then
    raise exception 'message_send_reservation_requires_attachments' using errcode = '22023';
  end if;

  perform message_send_private.lock_operation(actor_id, p_operation_id);

  select existing.*
  into operation
  from message_send_private.operations existing
  where existing.sender_user_id_snapshot = actor_id
    and existing.operation_id = p_operation_id
  for update;

  if found then
    if operation.canonical_payload is distinct from payload then
      raise exception 'message_send_operation_payload_conflict' using errcode = '22023';
    end if;

    if operation.status = 'aborted' then
      raise exception 'message_send_operation_aborted' using errcode = '55000';
    end if;

    if operation.reservation_result is not null then
      return operation.reservation_result;
    end if;
  else
    insert into message_send_private.operations (
      sender_user_id,
      sender_user_id_snapshot,
      operation_id,
      conversation_id,
      conversation_id_snapshot,
      canonical_payload
    ) values (
      actor_id,
      actor_id,
      p_operation_id,
      p_conversation_id,
      p_conversation_id,
      payload
    )
    returning * into operation;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'storage_path', reserved.storage_path,
        'expires_at', reserved.expires_at
      )
      order by planned.position
    ),
    '[]'::jsonb
  )
  into reservation_rows
  from public.reserve_message_media_uploads(
    p_conversation_id,
    payload -> 'attachments'
  ) reserved
  join jsonb_array_elements(payload -> 'attachments') with ordinality
    planned(value, position)
    on planned.value ->> 'storage_path' = reserved.storage_path;

  update private.message_media_upload_reservations reservation
  set send_operation_id = p_operation_id,
      send_operation_sender_snapshot = actor_id
  where reservation.user_id = actor_id
    and reservation.conversation_id = p_conversation_id
    and reservation.storage_path in (
      select item ->> 'storage_path'
      from jsonb_array_elements(payload -> 'attachments') item
    );

  if (select count(*) from jsonb_array_elements(reservation_rows))
      <> jsonb_array_length(payload -> 'attachments')
    or (
      select count(*)
      from private.message_media_upload_reservations reservation
      where reservation.user_id = actor_id
        and reservation.send_operation_sender_snapshot = actor_id
        and reservation.send_operation_id = p_operation_id
    ) <> jsonb_array_length(payload -> 'attachments') then
    raise exception 'message_send_reservation_incomplete' using errcode = '55000';
  end if;

  perform set_config('smot.message_send_operation_scope', 'trusted', true);
  update message_send_private.operations existing
  set reservation_result = reservation_rows
  where existing.sender_user_id_snapshot = actor_id
    and existing.operation_id = p_operation_id;
  perform set_config('smot.message_send_operation_scope', '', true);

  return reservation_rows;
exception
  when others then
    perform set_config('smot.message_send_operation_scope', '', true);
    raise;
end
$function$;

alter function message_send_private.reserve_uploads_impl(uuid, uuid, text, jsonb)
  owner to postgres;
revoke all on function message_send_private.reserve_uploads_impl(uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function message_send_private.reserve_uploads_impl(uuid, uuid, text, jsonb)
  to authenticated;

create or replace function message_send_private.send_impl(
  p_operation_id uuid,
  p_conversation_id uuid,
  p_body text,
  p_attachments jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  payload jsonb;
  operation message_send_private.operations%rowtype;
  message_row public.messages;
  canonical_attachment_count integer;
begin
  if actor_id is null or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    raise exception 'message_send_authentication_required' using errcode = '28000';
  end if;

  payload := message_send_private.canonical_payload(
    p_conversation_id,
    p_body,
    p_attachments
  );
  canonical_attachment_count := jsonb_array_length(payload -> 'attachments');

  perform message_send_private.lock_operation(actor_id, p_operation_id);

  select existing.*
  into operation
  from message_send_private.operations existing
  where existing.sender_user_id_snapshot = actor_id
    and existing.operation_id = p_operation_id
  for update;

  if found then
    if operation.canonical_payload is distinct from payload then
      raise exception 'message_send_operation_payload_conflict' using errcode = '22023';
    end if;

    -- Replay precedes mutable listing/block/ban/closure checks. Once a visible
    -- output committed, the operation always returns that exact stable result.
    if operation.status = 'completed' then
      return operation.result;
    end if;

    if operation.status = 'aborted' then
      raise exception 'message_send_operation_aborted' using errcode = '55000';
    end if;
  else
    insert into message_send_private.operations (
      sender_user_id,
      sender_user_id_snapshot,
      operation_id,
      conversation_id,
      conversation_id_snapshot,
      canonical_payload
    ) values (
      actor_id,
      actor_id,
      p_operation_id,
      p_conversation_id,
      p_conversation_id,
      payload
    )
    returning * into operation;
  end if;

  if canonical_attachment_count > 0 then
    if operation.reservation_result is null
      or (
        select count(*)
        from private.message_media_upload_reservations reservation
        join jsonb_array_elements(payload -> 'attachments') attachment
          on attachment ->> 'storage_path' = reservation.storage_path
         and message_send_private.normalize_user_prose(attachment ->> 'file_name') = reservation.file_name
         and lower(message_send_private.normalize_user_prose(attachment ->> 'mime_type')) = reservation.mime_type
         and (attachment ->> 'size_bytes')::bigint = reservation.size_bytes
        where reservation.user_id = actor_id
          and reservation.conversation_id = p_conversation_id
          and reservation.send_operation_sender_snapshot = actor_id
          and reservation.send_operation_id = p_operation_id
          and reservation.expires_at > now()
      ) <> canonical_attachment_count then
      raise exception 'message_send_operation_reservation_required' using errcode = '55000';
    end if;
  end if;

  select sent.*
  into message_row
  from public.send_conversation_message_with_attachments(
    p_conversation_id,
    payload ->> 'body',
    payload -> 'attachments'
  ) sent;

  perform set_config('smot.message_send_operation_scope', 'trusted', true);
  update message_send_private.operations existing
  set status = 'completed',
      result = to_jsonb(message_row),
      completed_at = timezone('utc', now())
  where existing.sender_user_id_snapshot = actor_id
    and existing.operation_id = p_operation_id;
  perform set_config('smot.message_send_operation_scope', '', true);

  return to_jsonb(message_row);
exception
  when others then
    perform set_config('smot.message_send_operation_scope', '', true);
    raise;
end
$function$;

alter function message_send_private.send_impl(uuid, uuid, text, jsonb)
  owner to postgres;
revoke all on function message_send_private.send_impl(uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function message_send_private.send_impl(uuid, uuid, text, jsonb)
  to authenticated;

create or replace function message_send_private.abort_impl(
  p_operation_id uuid,
  p_conversation_id uuid,
  p_body text,
  p_attachments jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  payload jsonb;
  operation message_send_private.operations%rowtype;
  abort_result jsonb;
begin
  if actor_id is null or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    raise exception 'message_send_authentication_required' using errcode = '28000';
  end if;

  payload := message_send_private.canonical_payload(
    p_conversation_id,
    p_body,
    p_attachments
  );
  perform message_send_private.lock_operation(actor_id, p_operation_id);

  select existing.*
  into operation
  from message_send_private.operations existing
  where existing.sender_user_id_snapshot = actor_id
    and existing.operation_id = p_operation_id
  for update;

  if found then
    if operation.canonical_payload is distinct from payload then
      raise exception 'message_send_operation_payload_conflict' using errcode = '22023';
    end if;

    if operation.status in ('completed', 'aborted') then
      return jsonb_build_object(
        'status', operation.status,
        'result', operation.result
      );
    end if;
  else
    insert into message_send_private.operations (
      sender_user_id,
      sender_user_id_snapshot,
      operation_id,
      conversation_id,
      conversation_id_snapshot,
      canonical_payload
    ) values (
      actor_id,
      actor_id,
      p_operation_id,
      p_conversation_id,
      p_conversation_id,
      payload
    )
    returning * into operation;
  end if;

  abort_result := jsonb_build_object(
    'status', 'aborted',
    'storage_paths', coalesce(
      (
        select jsonb_agg(attachment ->> 'storage_path' order by position)
        from jsonb_array_elements(payload -> 'attachments') with ordinality
          planned(attachment, position)
      ),
      '[]'::jsonb
    )
  );

  perform set_config('smot.message_send_operation_scope', 'trusted', true);
  update message_send_private.operations existing
  set status = 'aborted',
      result = abort_result,
      aborted_at = timezone('utc', now())
  where existing.sender_user_id_snapshot = actor_id
    and existing.operation_id = p_operation_id;
  perform set_config('smot.message_send_operation_scope', '', true);

  return jsonb_build_object('status', 'aborted', 'result', abort_result);
exception
  when others then
    perform set_config('smot.message_send_operation_scope', '', true);
    raise;
end
$function$;

alter function message_send_private.abort_impl(uuid, uuid, text, jsonb)
  owner to postgres;
revoke all on function message_send_private.abort_impl(uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function message_send_private.abort_impl(uuid, uuid, text, jsonb)
  to authenticated;

create or replace function public.reserve_message_media_uploads_idempotent(
  p_operation_id uuid,
  p_conversation_id uuid,
  p_body text,
  p_attachments jsonb
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
begin atomic
  select message_send_private.reserve_uploads_impl(
    p_operation_id,
    p_conversation_id,
    p_body,
    p_attachments
  );
end;

alter function public.reserve_message_media_uploads_idempotent(uuid, uuid, text, jsonb)
  owner to postgres;
revoke all on function public.reserve_message_media_uploads_idempotent(uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_message_media_uploads_idempotent(uuid, uuid, text, jsonb)
  to authenticated;

create or replace function public.send_conversation_message_idempotent(
  p_operation_id uuid,
  p_conversation_id uuid,
  p_body text,
  p_attachments jsonb
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
begin atomic
  select message_send_private.send_impl(
    p_operation_id,
    p_conversation_id,
    p_body,
    p_attachments
  );
end;

alter function public.send_conversation_message_idempotent(uuid, uuid, text, jsonb)
  owner to postgres;
revoke all on function public.send_conversation_message_idempotent(uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.send_conversation_message_idempotent(uuid, uuid, text, jsonb)
  to authenticated;

create or replace function public.abort_message_send_operation(
  p_operation_id uuid,
  p_conversation_id uuid,
  p_body text,
  p_attachments jsonb
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
begin atomic
  select message_send_private.abort_impl(
    p_operation_id,
    p_conversation_id,
    p_body,
    p_attachments
  );
end;

alter function public.abort_message_send_operation(uuid, uuid, text, jsonb)
  owner to postgres;
revoke all on function public.abort_message_send_operation(uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.abort_message_send_operation(uuid, uuid, text, jsonb)
  to authenticated;

comment on table message_send_private.operations is
  'Fully private immutable sender+operation ledger for exactly-once visible message sends and reservation replay.';
comment on function public.reserve_message_media_uploads_idempotent(uuid, uuid, text, jsonb) is
  'Reserves one immutable ordered upload plan per sender operation and exactly replays the original quota result.';
comment on function public.send_conversation_message_idempotent(uuid, uuid, text, jsonb) is
  'Creates at most one message, attachment set, preview update, and notification per sender operation UUID.';
comment on function public.abort_message_send_operation(uuid, uuid, text, jsonb) is
  'Serializes ambiguous discard with send completion, returning completed output or a durable abort cleanup plan.';
