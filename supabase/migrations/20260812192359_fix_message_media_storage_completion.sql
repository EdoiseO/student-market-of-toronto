-- Supabase Storage checks INSERT permission as the authenticated uploader, rolls
-- that transaction back, streams the bytes, and then persists the final object
-- metadata through its internal service-role connection. The original trigger
-- required auth.uid() during both phases, so every legitimate completion failed
-- after the bytes had been streamed.
--
-- Keep the authenticated preflight strict, but recognize only Storage's exact
-- standard-upload completion operation. The completion transaction reacquires
-- the same quota lock and must match the authoritative final MIME/size to one
-- exact, live reservation before it can create the storage.objects row.

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
  select storage.allow_only_operation('storage.object.upload')
    and (select auth.uid()) is not null
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
        and not exists (
          select 1
          from private.message_media_account_retirements retirement
          where retirement.user_id = reservation.user_id
        )
        and reservation.mime_type = lower(trim(coalesce(p_metadata ->> 'mimetype', '')))
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

comment on function private.message_media_upload_is_reserved(text, text, jsonb) is
  'Authorizes only the authenticated Storage standard-upload preflight for an exact active message-media reservation.';

create or replace function private.lock_message_media_storage_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := auth.uid();
  effective_user_id uuid;
  is_storage_completion boolean := false;
  final_size_bytes bigint;
begin
  if not storage.allow_only_operation('storage.object.upload') then
    raise exception 'Message media objects must be created through the Storage upload API'
      using errcode = '28000';
  end if;

  if auth.role() = 'authenticated' and authenticated_user_id is not null then
    if new.owner_id is distinct from authenticated_user_id::text then
      raise exception 'Message media object ownership is invalid'
        using errcode = '28000';
    end if;

    effective_user_id := authenticated_user_id;
  elsif auth.role() = 'service_role' and authenticated_user_id is null then
    -- Storage's final completion scope has role=service_role and no subject.
    -- Bind it back to the reservation owner carried in the object row; never
    -- infer an owner from request headers or accept a generic null-subject write.
    if coalesce(new.owner_id, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Message media object ownership is invalid'
        using errcode = '28000';
    end if;

    effective_user_id := new.owner_id::uuid;
    is_storage_completion := true;
  else
    raise exception 'Message media object ownership is invalid'
      using errcode = '28000';
  end if;

  -- This lock must be acquired in the committing completion transaction, not
  -- only in Storage's rolled-back permission probe.
  perform private.lock_message_media_user_quota(effective_user_id);

  if exists (
    select 1
    from private.message_media_account_retirements retirement
    where retirement.user_id = effective_user_id
  ) then
    raise exception 'Message media uploads are frozen for account deletion';
  end if;

  if not is_storage_completion then
    -- The authenticated INSERT policy performs the remaining preflight checks.
    return new;
  end if;

  if coalesce(new.metadata ->> 'size', '') !~ '^[0-9]+$' then
    raise exception 'Completed message media size is invalid';
  end if;

  final_size_bytes := (new.metadata ->> 'size')::bigint;

  if exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'message-media'
      and object.name = new.name
  ) or exists (
    select 1
    from public.message_attachments attachment
    where attachment.storage_path = new.name
  ) then
    raise exception 'Message media object path is already in use';
  end if;

  if not exists (
    select 1
    from private.message_media_upload_reservations reservation
    join public.conversations conversation
      on conversation.id = reservation.conversation_id
    join public.listings listing on listing.id = conversation.listing_id
    where reservation.user_id = effective_user_id
      and reservation.storage_path = new.name
      and reservation.expires_at > now()
      and reservation.mime_type = lower(trim(coalesce(new.metadata ->> 'mimetype', '')))
      and reservation.size_bytes = final_size_bytes
      and listing.status = 'active'
      and (
        conversation.buyer_id = effective_user_id
        or conversation.seller_id = effective_user_id
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
    raise exception 'Completed message media does not match an active reservation';
  end if;

  return new;
end;
$$;

revoke all on function private.lock_message_media_storage_insert()
  from public, anon, authenticated, service_role;

-- Message media paths are immutable. Standard uploads create a fresh reserved
-- path, and the INSERT guard above rejects Storage's conflict-update path. This
-- UPDATE trigger also fails closed if Storage changes its completion protocol.
create or replace function private.reject_message_media_storage_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Message media objects cannot be updated; upload a new reserved path';
end;
$$;

revoke all on function private.reject_message_media_storage_update()
  from public, anon, authenticated, service_role;

drop trigger if exists reject_message_media_storage_update
  on storage.objects;
create trigger reject_message_media_storage_update
  before update on storage.objects
  for each row
  when (
    old.bucket_id = 'message-media'
    or new.bucket_id = 'message-media'
  )
  execute function private.reject_message_media_storage_update();
