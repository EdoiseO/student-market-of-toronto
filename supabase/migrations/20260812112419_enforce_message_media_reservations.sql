-- Message media is uploaded through the Storage API before a message row exists.
-- Reservations make that unavoidable two-step flow bounded and auditable: Storage
-- accepts only exact, short-lived reservations, while a trigger consumes each
-- reservation atomically when the attachment row is created.

create schema if not exists private;

create table private.message_media_upload_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint message_media_upload_reservation_file_name_length
    check (char_length(file_name) between 1 and 180),
  constraint message_media_upload_reservation_mime_type
    check (
      mime_type in (
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'video/mp4',
        'video/webm',
        'video/quicktime'
      )
    ),
  constraint message_media_upload_reservation_size
    check (size_bytes between 1 and 10485760),
  constraint message_media_upload_reservation_expiry
    check (expires_at > created_at)
);

create index message_media_upload_reservations_user_expiry_idx
  on private.message_media_upload_reservations (user_id, expires_at);

alter table private.message_media_upload_reservations enable row level security;

revoke all on table private.message_media_upload_reservations
  from public, anon, authenticated;

create or replace function public.reserve_message_media_uploads(
  p_conversation_id uuid,
  p_attachments jsonb
)
returns table (storage_path text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  clean_attachments jsonb := coalesce(p_attachments, '[]'::jsonb);
  attachment jsonb;
  attachment_count integer;
  attachment_path text;
  attachment_file_name text;
  attachment_mime_type text;
  attachment_size_bytes bigint;
  path_prefix text;
  reservation_expiry timestamptz := now() + interval '30 minutes';
  existing_object_count bigint := 0;
  existing_object_bytes bigint := 0;
  pending_count bigint := 0;
  pending_bytes bigint := 0;
  requested_bytes bigint := 0;
  projected_object_count bigint := 0;
  projected_object_bytes bigint := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_conversation_id is null
    or jsonb_typeof(clean_attachments) <> 'array' then
    raise exception 'Invalid message media reservation payload';
  end if;

  attachment_count := jsonb_array_length(clean_attachments);

  if attachment_count not between 1 and 3 then
    raise exception 'A reservation must include between 1 and 3 attachments';
  end if;

  -- Serialize quota accounting per user so parallel reservation requests cannot
  -- both observe the same remaining capacity.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(current_user_id::text, 0)
  );

  if not exists (
    select 1
    from public.conversations conversation
    join public.listings listing on listing.id = conversation.listing_id
    where conversation.id = p_conversation_id
      and listing.status = 'active'
      and (
        conversation.buyer_id = current_user_id
        or conversation.seller_id = current_user_id
      )
      and not exists (
        select 1
        from public.blocked_users blocked
        where (
          blocked.blocker_user_id = conversation.buyer_id
          and blocked.blocked_user_id = conversation.seller_id
        )
        or (
          blocked.blocker_user_id = conversation.seller_id
          and blocked.blocked_user_id = conversation.buyer_id
        )
      )
  ) then
    raise exception 'Messaging is unavailable for this conversation';
  end if;

  path_prefix := p_conversation_id::text || '/' || current_user_id::text || '/';

  for attachment in
    select item
    from jsonb_array_elements(clean_attachments) item
  loop
    attachment_path := attachment ->> 'storage_path';
    attachment_file_name := trim(coalesce(attachment ->> 'file_name', ''));
    attachment_mime_type := lower(trim(coalesce(attachment ->> 'mime_type', '')));

    if coalesce(attachment ->> 'size_bytes', '') !~ '^[0-9]+$' then
      raise exception 'Attachment size is invalid';
    end if;

    attachment_size_bytes := (attachment ->> 'size_bytes')::bigint;

    if attachment_path is null
      or char_length(attachment_path) > 512
      or attachment_path not like (path_prefix || '%')
      or strpos(substring(attachment_path from char_length(path_prefix) + 1), '/') > 0
      or substring(attachment_path from char_length(path_prefix) + 1) in ('', '.', '..') then
      raise exception 'Attachment path is invalid';
    end if;

    if char_length(attachment_file_name) not between 1 and 180 then
      raise exception 'Attachment file name is invalid';
    end if;

    if attachment_mime_type not in (
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'video/mp4',
      'video/webm',
      'video/quicktime'
    ) then
      raise exception 'Attachment type is not supported';
    end if;

    if attachment_size_bytes not between 1 and 10485760 then
      raise exception 'Attachment exceeds the 10 MB limit';
    end if;

    if exists (
      select 1
      from storage.objects object
      where object.bucket_id = 'message-media'
        and object.name = attachment_path
    ) or exists (
      select 1
      from public.message_attachments message_attachment
      where message_attachment.storage_path = attachment_path
    ) then
      raise exception 'Attachment path is already in use';
    end if;

    requested_bytes := requested_bytes + attachment_size_bytes;
  end loop;

  if attachment_count <> (
    select count(distinct item ->> 'storage_path')
    from jsonb_array_elements(clean_attachments) item
  ) then
    raise exception 'Attachment paths must be unique';
  end if;

  -- Expired reservations without an object are safe to discard. Reservations
  -- with an object remain until the owner removes that object through Storage,
  -- so abandoning an upload can never create free, unaccounted quota.
  delete from private.message_media_upload_reservations reservation
  where reservation.user_id = current_user_id
    and reservation.expires_at <= now()
    and not exists (
      select 1
      from storage.objects object
      where object.bucket_id = 'message-media'
        and object.name = reservation.storage_path
    );

  select
    count(*),
    coalesce(sum(
      case
        when coalesce(object.metadata ->> 'size', '') ~ '^[0-9]+$'
          then (object.metadata ->> 'size')::bigint
        else 0
      end
    ), 0)
  into existing_object_count, existing_object_bytes
  from storage.objects object
  where object.bucket_id = 'message-media'
    and object.owner_id = current_user_id::text;

  select count(*), coalesce(sum(reservation.size_bytes), 0)
  into pending_count, pending_bytes
  from private.message_media_upload_reservations reservation
  where reservation.user_id = current_user_id
    and reservation.expires_at > now();

  if pending_count + attachment_count > 6
    or pending_bytes + requested_bytes > 62914560 then
    raise exception 'message_media_pending_quota_exceeded'
      using detail = 'At most 6 pending objects and 60 MiB may be reserved per user';
  end if;

  select
    existing_object_count + count(*),
    existing_object_bytes + coalesce(sum(reservation.size_bytes), 0)
  into projected_object_count, projected_object_bytes
  from private.message_media_upload_reservations reservation
  where reservation.user_id = current_user_id
    and reservation.expires_at > now()
    and not exists (
      select 1
      from storage.objects object
      where object.bucket_id = 'message-media'
        and object.name = reservation.storage_path
    );

  projected_object_count := projected_object_count + attachment_count;
  projected_object_bytes := projected_object_bytes + requested_bytes;

  if projected_object_count > 100
    or projected_object_bytes > 268435456 then
    raise exception 'message_media_storage_quota_exceeded'
      using detail = 'At most 100 objects and 256 MiB may be stored or reserved per user';
  end if;

  insert into private.message_media_upload_reservations (
    user_id,
    conversation_id,
    storage_path,
    file_name,
    mime_type,
    size_bytes,
    expires_at
  )
  select
    current_user_id,
    p_conversation_id,
    item ->> 'storage_path',
    trim(item ->> 'file_name'),
    lower(trim(item ->> 'mime_type')),
    (item ->> 'size_bytes')::bigint,
    reservation_expiry
  from jsonb_array_elements(clean_attachments) item;

  return query
  select reservation.storage_path, reservation.expires_at
  from private.message_media_upload_reservations reservation
  where reservation.user_id = current_user_id
    and reservation.storage_path in (
      select item ->> 'storage_path'
      from jsonb_array_elements(clean_attachments) item
    );
end;
$$;

revoke all on function public.reserve_message_media_uploads(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_message_media_uploads(uuid, jsonb)
  to authenticated;

create or replace function public.list_expired_message_media_uploads()
returns table (storage_path text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  return query
  select reservation.storage_path
  from private.message_media_upload_reservations reservation
  where reservation.user_id = auth.uid()
    and reservation.expires_at <= now()
    and not exists (
      select 1
      from public.message_attachments attachment
      where attachment.storage_path = reservation.storage_path
    )
  order by reservation.expires_at
  limit 20;
end;
$$;

revoke all on function public.list_expired_message_media_uploads()
  from public, anon, authenticated, service_role;
grant execute on function public.list_expired_message_media_uploads()
  to authenticated;

create or replace function public.release_message_media_upload_reservations(
  p_storage_paths text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  released_count integer := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_storage_paths is null
    or coalesce(cardinality(p_storage_paths), 0) not between 1 and 20 then
    raise exception 'Invalid reservation release payload';
  end if;

  -- Callers must remove abandoned objects through the Storage API first. This
  -- function deliberately never mutates storage.objects directly.
  delete from private.message_media_upload_reservations reservation
  where reservation.user_id = current_user_id
    and reservation.storage_path = any(p_storage_paths)
    and not exists (
      select 1
      from storage.objects object
      where object.bucket_id = 'message-media'
        and object.name = reservation.storage_path
    )
    and not exists (
      select 1
      from public.message_attachments attachment
      where attachment.storage_path = reservation.storage_path
    );

  get diagnostics released_count = row_count;
  return released_count;
end;
$$;

revoke all on function public.release_message_media_upload_reservations(text[])
  from public, anon, authenticated, service_role;
grant execute on function public.release_message_media_upload_reservations(text[])
  to authenticated;

create or replace function private.message_media_upload_is_reserved(
  p_storage_path text,
  p_owner_id text,
  p_metadata jsonb
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and p_owner_id = (select auth.uid())::text
    and exists (
      select 1
      from private.message_media_upload_reservations reservation
      join public.conversations conversation
        on conversation.id = reservation.conversation_id
      join public.listings listing on listing.id = conversation.listing_id
      where reservation.user_id = (select auth.uid())
        and reservation.storage_path = p_storage_path
        and reservation.expires_at > now()
        and reservation.mime_type = lower(coalesce(p_metadata ->> 'mimetype', ''))
        and reservation.size_bytes = case
          when coalesce(p_metadata ->> 'size', '') ~ '^[0-9]+$'
            then (p_metadata ->> 'size')::bigint
          else -1
        end
        and listing.status = 'active'
        and (
          conversation.buyer_id = (select auth.uid())
          or conversation.seller_id = (select auth.uid())
        )
        and not exists (
          select 1
          from public.blocked_users blocked
          where (
            blocked.blocker_user_id = conversation.buyer_id
            and blocked.blocked_user_id = conversation.seller_id
          )
          or (
            blocked.blocker_user_id = conversation.seller_id
            and blocked.blocked_user_id = conversation.buyer_id
          )
        )
    );
$$;

revoke all on function private.message_media_upload_is_reserved(text, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.message_media_upload_is_reserved(text, text, jsonb)
  to authenticated;

drop policy if exists "Participants can upload message media" on storage.objects;
create policy "Reserved message media can be uploaded"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'message-media'
    and private.message_media_upload_is_reserved(name, owner_id, metadata)
  );

create or replace function private.consume_message_media_upload_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  consumed_reservation_id uuid;
begin
  if current_user_id is null or new.uploader_id <> current_user_id then
    raise exception 'Authentication required to consume a media reservation'
      using errcode = '28000';
  end if;

  delete from private.message_media_upload_reservations reservation
  where reservation.user_id = current_user_id
    and reservation.conversation_id = new.conversation_id
    and reservation.storage_path = new.storage_path
    and reservation.file_name = new.file_name
    and reservation.mime_type = new.mime_type
    and reservation.size_bytes = new.size_bytes
    and reservation.expires_at > now()
    and exists (
      select 1
      from storage.objects object
      where object.bucket_id = 'message-media'
        and object.name = reservation.storage_path
        and object.owner_id = current_user_id::text
        and lower(coalesce(object.metadata ->> 'mimetype', '')) = reservation.mime_type
        and case
          when coalesce(object.metadata ->> 'size', '') ~ '^[0-9]+$'
            then (object.metadata ->> 'size')::bigint
          else -1
        end = reservation.size_bytes
    )
  returning reservation.id into consumed_reservation_id;

  if consumed_reservation_id is null then
    raise exception 'A valid message media reservation is required';
  end if;

  return new;
end;
$$;

revoke all on function private.consume_message_media_upload_reservation()
  from public, anon, authenticated, service_role;

drop trigger if exists consume_message_media_upload_reservation
  on public.message_attachments;
create trigger consume_message_media_upload_reservation
  before insert on public.message_attachments
  for each row
  execute function private.consume_message_media_upload_reservation();

comment on table private.message_media_upload_reservations is
  'Short-lived, per-user upload authorizations for exact message-media objects.';
comment on function public.reserve_message_media_uploads(uuid, jsonb) is
  'Validates conversation access and per-user quotas, then reserves exact message-media paths.';
comment on function public.release_message_media_upload_reservations(text[]) is
  'Releases only the caller reservations whose unattached Storage objects have already been removed.';
