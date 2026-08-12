create table if not exists public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint message_attachments_file_name_length
    check (char_length(file_name) between 1 and 180),
  constraint message_attachments_mime_type
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
  constraint message_attachments_size
    check (size_bytes between 1 and 10485760)
);

create index if not exists message_attachments_message_id_idx
  on public.message_attachments (message_id, created_at);

create index if not exists message_attachments_conversation_id_idx
  on public.message_attachments (conversation_id, created_at);

alter table public.message_attachments enable row level security;

drop policy if exists "Conversation participants can read message attachments"
  on public.message_attachments;
create policy "Conversation participants can read message attachments"
  on public.message_attachments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.conversations conversation
      where conversation.id = message_attachments.conversation_id
        and (
          conversation.buyer_id = (select auth.uid())
          or conversation.seller_id = (select auth.uid())
        )
    )
  );

drop policy if exists "Moderators can read message attachments"
  on public.message_attachments;
create policy "Moderators can read message attachments"
  on public.message_attachments
  for select
  to authenticated
  using (public.is_moderation_role());

revoke all on table public.message_attachments from anon;
revoke insert, update, delete on table public.message_attachments from authenticated;
grant select on table public.message_attachments to authenticated;
grant all on table public.message_attachments to service_role;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'message-media',
  'message-media',
  false,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ]::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Participants can upload message media" on storage.objects;
create policy "Participants can upload message media"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'message-media'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and owner_id = (select auth.uid())::text
    and exists (
      select 1
      from public.conversations conversation
      where conversation.id::text = (storage.foldername(name))[1]
        and (
          conversation.buyer_id = (select auth.uid())
          or conversation.seller_id = (select auth.uid())
        )
    )
  );

drop policy if exists "Participants can view message media" on storage.objects;
create policy "Participants can view message media"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'message-media'
    and exists (
      select 1
      from public.conversations conversation
      where conversation.id::text = (storage.foldername(name))[1]
        and (
          conversation.buyer_id = (select auth.uid())
          or conversation.seller_id = (select auth.uid())
          or public.is_moderation_role()
        )
    )
  );

drop policy if exists "Uploaders can remove unattached message media" on storage.objects;
create policy "Uploaders can remove unattached message media"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'message-media'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and owner_id = (select auth.uid())::text
    and not exists (
      select 1
      from public.message_attachments attachment
      where attachment.storage_path = name
    )
  );

create or replace function public.send_conversation_message_with_attachments(
  p_conversation_id uuid,
  p_body text default '',
  p_attachments jsonb default '[]'::jsonb
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  clean_body text := trim(coalesce(p_body, ''));
  clean_attachments jsonb := coalesce(p_attachments, '[]'::jsonb);
  conversation_row public.conversations;
  message_row public.messages;
  attachment jsonb;
  attachment_count integer;
  attachment_path text;
  attachment_file_name text;
  attachment_mime_type text;
  attachment_size_bytes bigint;
  object_mime_type text;
  object_size_bytes bigint;
  listing_status text;
  recipient_user_id uuid;
  message_preview text;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if jsonb_typeof(clean_attachments) <> 'array' then
    raise exception 'Attachments must be a JSON array';
  end if;

  attachment_count := jsonb_array_length(clean_attachments);

  if char_length(clean_body) = 0 and attachment_count = 0 then
    raise exception 'A message or attachment is required';
  end if;

  if char_length(clean_body) > 2000 then
    raise exception 'Message body must be 2000 characters or less';
  end if;

  if attachment_count > 3 then
    raise exception 'A message can include at most 3 attachments';
  end if;

  if attachment_count <> (
    select count(distinct item ->> 'storage_path')
    from jsonb_array_elements(clean_attachments) item
  ) then
    raise exception 'Attachment paths must be unique';
  end if;

  select conversation.*
  into conversation_row
  from public.conversations conversation
  where conversation.id = p_conversation_id
    and (
      conversation.buyer_id = current_user_id
      or conversation.seller_id = current_user_id
    );

  if not found then
    raise exception 'Conversation not found';
  end if;

  select listing.status
  into listing_status
  from public.listings listing
  where listing.id = conversation_row.listing_id;

  if listing_status is distinct from 'active' then
    raise exception 'listing_messaging_unavailable'
      using detail = 'listing_status=' || coalesce(listing_status, 'unavailable');
  end if;

  if exists (
    select 1
    from public.blocked_users blocked
    where (
      blocked.blocker_user_id = conversation_row.buyer_id
      and blocked.blocked_user_id = conversation_row.seller_id
    )
    or (
      blocked.blocker_user_id = conversation_row.seller_id
      and blocked.blocked_user_id = conversation_row.buyer_id
    )
  ) then
    raise exception 'Messaging is unavailable for this conversation';
  end if;

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
      or attachment_path not like (
        conversation_row.id::text || '/' || current_user_id::text || '/%'
      ) then
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

    select
      lower(coalesce(object.metadata ->> 'mimetype', '')),
      coalesce((object.metadata ->> 'size')::bigint, 0)
    into object_mime_type, object_size_bytes
    from storage.objects object
    where object.bucket_id = 'message-media'
      and object.name = attachment_path
      and object.owner_id = current_user_id::text;

    if not found then
      raise exception 'Uploaded attachment was not found';
    end if;

    if object_mime_type <> attachment_mime_type
      or object_size_bytes <> attachment_size_bytes then
      raise exception 'Uploaded attachment metadata does not match';
    end if;
  end loop;

  insert into public.messages (conversation_id, sender_id, body)
  values (conversation_row.id, current_user_id, clean_body)
  returning * into message_row;

  insert into public.message_attachments (
    message_id,
    conversation_id,
    uploader_id,
    storage_path,
    file_name,
    mime_type,
    size_bytes
  )
  select
    message_row.id,
    conversation_row.id,
    current_user_id,
    item ->> 'storage_path',
    trim(item ->> 'file_name'),
    lower(trim(item ->> 'mime_type')),
    (item ->> 'size_bytes')::bigint
  from jsonb_array_elements(clean_attachments) item;

  message_preview := case
    when char_length(clean_body) > 0 then left(clean_body, 140)
    when attachment_count = 1 then 'Media attachment'
    else attachment_count::text || ' media attachments'
  end;

  update public.conversations
  set updated_at = message_row.created_at,
      last_message_at = message_row.created_at,
      last_message_preview = message_preview
  where id = conversation_row.id;

  recipient_user_id := case
    when current_user_id = conversation_row.buyer_id then conversation_row.seller_id
    else conversation_row.buyer_id
  end;

  insert into public.notifications (user_id, type, conversation_id, message_id)
  values (recipient_user_id, 'message', conversation_row.id, message_row.id);

  return message_row;
end;
$$;

revoke all on function public.send_conversation_message_with_attachments(uuid, text, jsonb)
  from public, anon;
grant execute on function public.send_conversation_message_with_attachments(uuid, text, jsonb)
  to authenticated, service_role;
