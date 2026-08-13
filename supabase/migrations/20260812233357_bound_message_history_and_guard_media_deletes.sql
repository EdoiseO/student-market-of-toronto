-- Keep inbox and thread reads bounded at the database boundary. These functions
-- deliberately perform their own participant checks because they are exposed
-- through PostgREST and run with the table owner's privileges.

create index if not exists messages_conversation_created_id_idx
  on public.messages (conversation_id, created_at desc, id desc);

create index if not exists messages_unread_conversation_created_idx
  on public.messages (conversation_id, created_at desc)
  where read_at is null;

create index if not exists conversations_buyer_updated_id_idx
  on public.conversations (buyer_id, updated_at desc, id desc);

create index if not exists conversations_seller_updated_id_idx
  on public.conversations (seller_id, updated_at desc, id desc);

create or replace function public.get_message_inbox_conversation_ids(
  p_before_updated_at timestamptz default null,
  p_before_conversation_id uuid default null,
  p_limit integer default 101
)
returns table (
  conversation_id uuid,
  conversation_updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  inbox_limit integer := least(greatest(coalesce(p_limit, 101), 1), 101);
begin
  if current_user_id is null then
    raise exception 'Authentication required to read the conversation inbox'
      using errcode = '28000';
  end if;

  return query
  select conversation.id, conversation.updated_at
  from public.conversations conversation
  left join public.conversation_user_state state
    on state.conversation_id = conversation.id
   and state.user_id = current_user_id
  where (
      conversation.buyer_id = current_user_id
      or conversation.seller_id = current_user_id
    )
    and (
      conversation.last_message_at is not null
      or conversation.last_message_preview is not null
    )
    and (
      state.deleted_at is null
      or conversation.last_message_at > state.deleted_at
    )
    and (
      state.hidden_at is null
      or conversation.last_message_at > state.hidden_at
    )
    and (
      p_before_updated_at is null
      or p_before_conversation_id is null
      or (conversation.updated_at, conversation.id) < (
        p_before_updated_at,
        p_before_conversation_id
      )
    )
  order by conversation.updated_at desc, conversation.id desc
  limit inbox_limit;
end;
$$;

alter function public.get_message_inbox_conversation_ids(timestamptz, uuid, integer)
  owner to postgres;
revoke all on function public.get_message_inbox_conversation_ids(timestamptz, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_message_inbox_conversation_ids(timestamptz, uuid, integer)
  to authenticated;

comment on function public.get_message_inbox_conversation_ids(timestamptz, uuid, integer) is
  'Returns one bounded newest-first keyset page of visible conversation IDs after verifying participation and applying per-user hide/delete state.';

create or replace function public.get_conversation_message_page(
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
  read_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  deleted_before timestamptz;
  page_limit integer := least(greatest(coalesce(p_limit, 41), 1), 101);
begin
  if current_user_id is null then
    raise exception 'Authentication required to read conversation messages'
      using errcode = '28000';
  end if;

  if not exists (
    select 1
    from public.conversations conversation
    where conversation.id = p_conversation_id
      and (
        conversation.buyer_id = current_user_id
        or conversation.seller_id = current_user_id
      )
  ) then
    raise exception 'Conversation access denied'
      using errcode = '42501';
  end if;

  select state.deleted_at
  into deleted_before
  from public.conversation_user_state state
  where state.conversation_id = p_conversation_id
    and state.user_id = current_user_id;

  return query
  select
    message.id,
    message.conversation_id,
    message.sender_id,
    message.body,
    message.created_at,
    message.read_at
  from public.messages message
  where message.conversation_id = p_conversation_id
    and (deleted_before is null or message.created_at > deleted_before)
    and (
      p_before_created_at is null
      or p_before_message_id is null
      or (message.created_at, message.id) < (p_before_created_at, p_before_message_id)
    )
  order by message.created_at desc, message.id desc
  limit page_limit;
end;
$$;

alter function public.get_conversation_message_page(uuid, timestamptz, uuid, integer)
  owner to postgres;
revoke all on function public.get_conversation_message_page(uuid, timestamptz, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_conversation_message_page(uuid, timestamptz, uuid, integer)
  to authenticated;

comment on function public.get_conversation_message_page(uuid, timestamptz, uuid, integer) is
  'Returns one bounded newest-first keyset page after verifying conversation participation and per-user deletion history.';

create or replace function public.get_conversation_unread_counts(
  p_conversation_ids uuid[]
)
returns table (
  conversation_id uuid,
  unread_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_ids uuid[] := coalesce(p_conversation_ids, array[]::uuid[]);
begin
  if current_user_id is null then
    raise exception 'Authentication required to read unread counts'
      using errcode = '28000';
  end if;

  if coalesce(array_ndims(requested_ids), 0) > 1
     or cardinality(requested_ids) > 100 then
    raise exception 'At most 100 conversation counts may be requested';
  end if;

  return query
  select
    conversation.id,
    count(message.id)::bigint
  from public.conversations conversation
  left join public.conversation_user_state state
    on state.conversation_id = conversation.id
   and state.user_id = current_user_id
  left join public.messages message
    on message.conversation_id = conversation.id
   and message.read_at is null
   and message.sender_id <> current_user_id
   and (state.deleted_at is null or message.created_at > state.deleted_at)
  where conversation.id = any(requested_ids)
    and (
      conversation.buyer_id = current_user_id
      or conversation.seller_id = current_user_id
    )
  group by conversation.id;
end;
$$;

alter function public.get_conversation_unread_counts(uuid[])
  owner to postgres;
revoke all on function public.get_conversation_unread_counts(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.get_conversation_unread_counts(uuid[])
  to authenticated;

comment on function public.get_conversation_unread_counts(uuid[]) is
  'Aggregates unread counts for at most 100 conversations after verifying that the caller participates in each returned conversation.';

-- The DELETE policy checks that an object is not attached, but a concurrent
-- attachment INSERT can otherwise pass its own object check at the same time.
-- Serialize both operations on the existing per-user quota lock and repeat the
-- attachment check inside the deleting statement. Service-role deletion is
-- allowed only after account cleanup has installed its durable retirement row.
create or replace function private.guard_message_media_storage_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := auth.uid();
  object_owner_id uuid;
begin
  if old.bucket_id <> 'message-media' then
    return old;
  end if;

  if not (
    storage.allow_only_operation('storage.object.delete')
    or storage.allow_only_operation('storage.object.delete_many')
  ) then
    raise exception 'Message media objects must be deleted through the Storage API'
      using errcode = '28000';
  end if;

  if coalesce(old.owner_id, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Message media object ownership is invalid'
      using errcode = '28000';
  end if;

  object_owner_id := old.owner_id::uuid;
  perform private.lock_message_media_user_quota(object_owner_id);

  if auth.role() = 'authenticated' and authenticated_user_id is not null then
    if authenticated_user_id <> object_owner_id then
      raise exception 'Message media object deletion is not owned by the caller'
        using errcode = '42501';
    end if;

    if exists (
      select 1
      from private.message_media_account_retirements retirement
      where retirement.user_id = object_owner_id
    ) then
      raise exception 'Message media deletion is reserved for account cleanup'
        using errcode = '42501';
    end if;

    if exists (
      select 1
      from public.message_attachments attachment
      where attachment.storage_path = old.name
    ) then
      raise exception 'Attached message media cannot be deleted'
        using errcode = '23503';
    end if;

    return old;
  end if;

  if auth.role() = 'service_role' and authenticated_user_id is null then
    if not exists (
      select 1
      from private.message_media_account_retirements retirement
      where retirement.user_id = object_owner_id
    ) then
      raise exception 'Privileged message media deletion requires account retirement'
        using errcode = '42501';
    end if;

    return old;
  end if;

  raise exception 'Message media object deletion context is invalid'
    using errcode = '28000';
end;
$$;

alter function private.guard_message_media_storage_delete() owner to postgres;
revoke all on function private.guard_message_media_storage_delete()
  from public, anon, authenticated, service_role;

drop trigger if exists guard_message_media_storage_delete on storage.objects;
create trigger guard_message_media_storage_delete
  before delete on storage.objects
  for each row
  when (old.bucket_id = 'message-media')
  execute function private.guard_message_media_storage_delete();

comment on function private.guard_message_media_storage_delete() is
  'Serializes message-media deletion with reservation consumption and permits service-role cleanup only for durably retired accounts.';
