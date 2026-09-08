-- Private bytes are served only by the application's per-request gateway.
-- Storage still needs SELECT for standard-upload and removal permission probes.
begin;

drop policy if exists "Participants can view message media" on storage.objects;
drop policy if exists "Participants and current moderators can view message media" on storage.objects;
create policy "Owners can probe message media upload and cleanup" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'message-media'
    and owner_id = (select auth.uid())::text
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and (
      storage.allow_only_operation('storage.object.upload')
      or storage.allow_only_operation('storage.object.delete')
      or storage.allow_only_operation('storage.object.delete_many')
    )
  );
-- Defense against any unrelated permissive SELECT policy being added later.
create policy "Message media bytes require the application gateway" on storage.objects
  as restrictive for select to anon, authenticated
  using (
    bucket_id <> 'message-media'
    or (
      owner_id = (select auth.uid())::text
      and (storage.foldername(name))[2] = (select auth.uid())::text
      and (
        storage.allow_only_operation('storage.object.upload')
        or storage.allow_only_operation('storage.object.delete')
        or storage.allow_only_operation('storage.object.delete_many')
      )
    )
  );

-- Logical attachment paths stay immutable. Only the trusted server can see the
-- new physical location, and only verified destinations become readable there.
create table private.message_media_relocations (
  attachment_id uuid primary key references public.message_attachments(id) on delete cascade,
  uploader_id uuid not null,
  source_path text not null unique,
  target_path text not null unique,
  source_object_id uuid not null,
  target_object_id uuid,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  state text not null default 'prepared' check (state in ('prepared', 'active', 'retired')),
  upload_expires_at timestamptz not null,
  source_sha256 text,
  target_sha256 text,
  created_at timestamptz not null default statement_timestamp(),
  activated_at timestamptz,
  retired_at timestamptz,
  check (source_path <> target_path),
  check (
    (state = 'prepared' and target_object_id is null and source_sha256 is null
      and target_sha256 is null and activated_at is null and retired_at is null)
    or (state in ('active', 'retired') and target_object_id is not null
      and source_sha256 is not null and target_sha256 is not null
      and source_sha256 ~ '^[0-9a-f]{64}$' and target_sha256 = source_sha256
      and activated_at is not null and (state <> 'retired' or retired_at is not null))
  )
);
alter table private.message_media_relocations owner to postgres;
alter table private.message_media_relocations enable row level security;
revoke all on table private.message_media_relocations from public, anon, authenticated, service_role;
create index message_media_relocations_uploader_idx on private.message_media_relocations(uploader_id);

create function private.assert_message_media_service()
returns void language plpgsql security definer set search_path = '' as $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' or auth.uid() is not null then
    raise exception 'message_media_service_required' using errcode = '42501';
  end if;
end
$function$;
alter function private.assert_message_media_service() owner to postgres;
revoke all on function private.assert_message_media_service() from public, anon, authenticated, service_role;

create function private.message_media_path_matches(p_path text, p_conversation_id uuid, p_user_id uuid)
returns boolean language sql immutable set search_path = '' as $function$
  select coalesce(
    array_length(string_to_array(p_path, '/'), 1) = 3
    and split_part(p_path, '/', 1) = p_conversation_id::text
    and split_part(p_path, '/', 2) = p_user_id::text
    and split_part(p_path, '/', 3) not in ('', '.', '..')
    and strpos(p_path, pg_catalog.chr(92)) = 0 and strpos(p_path, '%') = 0,
    false
  );
$function$;
alter function private.message_media_path_matches(text, uuid, uuid) owner to postgres;
revoke all on function private.message_media_path_matches(text, uuid, uuid) from public, anon, authenticated, service_role;

create function private.message_media_metadata_matches(
  p_metadata jsonb, p_mime_type text, p_size_bytes bigint, p_allow_preflight boolean default false
)
returns boolean language sql immutable set search_path = '' as $function$
  select coalesce(
    lower(btrim(p_metadata ->> 'mimetype')) = p_mime_type
    and case
      when p_allow_preflight and not (p_metadata ? 'size') then true
      when p_metadata ->> 'size' ~ '^[0-9]{1,10}$' then (p_metadata ->> 'size')::bigint = p_size_bytes
      else false
    end,
    false
  );
$function$;
alter function private.message_media_metadata_matches(jsonb, text, bigint, boolean) owner to postgres;
revoke all on function private.message_media_metadata_matches(jsonb, text, bigint, boolean) from public, anon, authenticated, service_role;

create function public.resolve_message_media_attachment(p_attachment_id uuid)
returns table(storage_path text, mime_type text, size_bytes bigint, file_name text)
language plpgsql security definer set search_path = '' as $function$
begin
  perform private.assert_message_media_service();
  if p_attachment_id is null then
    raise exception 'message_media_attachment_required' using errcode = '22023';
  end if;
  return query
    select case when relocation.state in ('active', 'retired') then relocation.target_path
      else attachment.storage_path end,
      attachment.mime_type, attachment.size_bytes, attachment.file_name
    from public.message_attachments attachment
    left join private.message_media_relocations relocation on relocation.attachment_id = attachment.id
    where attachment.id = p_attachment_id;
end
$function$;
alter function public.resolve_message_media_attachment(uuid) owner to postgres;
revoke all on function public.resolve_message_media_attachment(uuid) from public, anon, authenticated, service_role;
grant execute on function public.resolve_message_media_attachment(uuid) to service_role;

create function public.begin_message_media_relocation(p_attachment_id uuid)
returns table(attachment_id uuid, source_path text, target_path text, mime_type text, size_bytes bigint, state text)
language plpgsql security definer set search_path = '' as $function$
declare
  attachment public.message_attachments%rowtype;
  source_object storage.objects%rowtype;
  relocation private.message_media_relocations%rowtype;
begin
  perform private.assert_message_media_service();
  select * into attachment from public.message_attachments item where item.id = p_attachment_id;
  if not found then
    raise exception 'message_media_attachment_not_found' using errcode = 'P0002';
  end if;
  perform private.lock_message_media_user_quota(attachment.uploader_id);
  -- Recheck after the lifecycle lock: account cleanup may have won first.
  select * into attachment from public.message_attachments item where item.id = p_attachment_id for share;
  if not found or exists (select 1 from private.message_media_account_retirements retirement
      where retirement.user_id = attachment.uploader_id) then
    raise exception 'message_media_account_retiring' using errcode = '42501';
  end if;
  if not private.message_media_path_matches(attachment.storage_path, attachment.conversation_id, attachment.uploader_id) then
    raise exception 'message_media_unsafe_attachment_path' using errcode = '22023';
  end if;
  select * into relocation from private.message_media_relocations item where item.attachment_id = p_attachment_id for update;
  if found then
    if relocation.source_path <> attachment.storage_path or relocation.uploader_id <> attachment.uploader_id
      or relocation.mime_type <> attachment.mime_type or relocation.size_bytes <> attachment.size_bytes then
      raise exception 'message_media_attachment_changed' using errcode = '55000';
    end if;
    if relocation.state = 'prepared' then
      update private.message_media_relocations item set upload_expires_at = statement_timestamp() + interval '15 minutes'
        where item.attachment_id = p_attachment_id;
    end if;
  else
    select * into source_object from storage.objects object
      where object.bucket_id = 'message-media' and object.name = attachment.storage_path;
    if not found or source_object.owner_id is distinct from attachment.uploader_id::text
      or not private.message_media_metadata_matches(source_object.metadata, attachment.mime_type, attachment.size_bytes) then
      raise exception 'message_media_source_invalid' using errcode = '55000';
    end if;
    insert into private.message_media_relocations(
      attachment_id, uploader_id, source_path, target_path, source_object_id, mime_type, size_bytes, upload_expires_at
    ) values (
      attachment.id, attachment.uploader_id, attachment.storage_path,
      attachment.conversation_id::text || '/' || attachment.uploader_id::text || '/' || gen_random_uuid()::text,
      source_object.id, attachment.mime_type, attachment.size_bytes, statement_timestamp() + interval '15 minutes'
    );
  end if;
  return query select item.attachment_id, item.source_path, item.target_path, item.mime_type, item.size_bytes, item.state
    from private.message_media_relocations item where item.attachment_id = p_attachment_id;
end
$function$;
alter function public.begin_message_media_relocation(uuid) owner to postgres;
revoke all on function public.begin_message_media_relocation(uuid) from public, anon, authenticated, service_role;
grant execute on function public.begin_message_media_relocation(uuid) to service_role;

-- Called by both existing insertion guards. A matching target is a protected
-- maintenance namespace even when the caller is not entitled to populate it.
create function private.authorize_message_media_relocation_insert(p_path text, p_owner_id text, p_metadata jsonb)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  relocation private.message_media_relocations%rowtype;
begin
  select * into relocation from private.message_media_relocations item where item.target_path = p_path;
  if not found then return null; end if;
  perform private.assert_message_media_service();
  if not storage.allow_only_operation('storage.object.upload') then
    raise exception 'message_media_relocation_upload_required' using errcode = '42501';
  end if;
  perform private.lock_message_media_user_quota(relocation.uploader_id);
  select * into relocation from private.message_media_relocations item where item.target_path = p_path for update;
  if not found or relocation.state <> 'prepared' or relocation.upload_expires_at <= statement_timestamp()
    or (p_owner_id is not null and p_owner_id <> relocation.uploader_id::text)
    or not private.message_media_metadata_matches(p_metadata, relocation.mime_type, relocation.size_bytes, true)
    or exists (select 1 from private.message_media_account_retirements retirement where retirement.user_id = relocation.uploader_id)
    or exists (select 1 from storage.objects object where object.bucket_id = 'message-media' and object.name = p_path)
    or not exists (select 1 from public.message_attachments attachment
      where attachment.id = relocation.attachment_id and attachment.storage_path = relocation.source_path
        and attachment.uploader_id = relocation.uploader_id and attachment.mime_type = relocation.mime_type
        and attachment.size_bytes = relocation.size_bytes
        and private.message_media_path_matches(p_path, attachment.conversation_id, attachment.uploader_id))
    or not exists (select 1 from storage.objects object where object.bucket_id = 'message-media'
      and object.name = relocation.source_path and object.id = relocation.source_object_id
      and object.owner_id = relocation.uploader_id::text
      and private.message_media_metadata_matches(object.metadata, relocation.mime_type, relocation.size_bytes)) then
    raise exception 'message_media_relocation_upload_not_permitted' using errcode = '42501';
  end if;
  return relocation.uploader_id;
end
$function$;
alter function private.authorize_message_media_relocation_insert(text, text, jsonb) owner to postgres;
revoke all on function private.authorize_message_media_relocation_insert(text, text, jsonb) from public, anon, authenticated, service_role;

-- The worker hashes bytes downloaded from both locations. SQL verifies its
-- service-only attestation and durable object identity/metadata, then atomically
-- changes the resolver. A partial upload or failed verification remains hidden.
create function public.verify_message_media_relocation(p_attachment_id uuid, p_source_sha256 text, p_target_sha256 text)
returns text language plpgsql security definer set search_path = '' as $function$
declare
  relocation private.message_media_relocations%rowtype;
  source_object storage.objects%rowtype;
  target_object storage.objects%rowtype;
begin
  perform private.assert_message_media_service();
  if p_source_sha256 is null or p_source_sha256 !~ '^[0-9a-f]{64}$' or p_target_sha256 is distinct from p_source_sha256 then
    raise exception 'message_media_hash_verification_failed' using errcode = '22023';
  end if;
  select * into relocation from private.message_media_relocations item where item.attachment_id = p_attachment_id;
  if not found then raise exception 'message_media_relocation_not_found' using errcode = 'P0002'; end if;
  perform private.lock_message_media_user_quota(relocation.uploader_id);
  select * into relocation from private.message_media_relocations item where item.attachment_id = p_attachment_id for update;
  if not found or exists (select 1 from private.message_media_account_retirements retirement where retirement.user_id = relocation.uploader_id) then
    raise exception 'message_media_account_retiring' using errcode = '42501';
  end if;
  select * into target_object from storage.objects object where object.bucket_id = 'message-media' and object.name = relocation.target_path;
  if not found or target_object.owner_id is distinct from relocation.uploader_id::text
    or not private.message_media_metadata_matches(target_object.metadata, relocation.mime_type, relocation.size_bytes) then
    raise exception 'message_media_target_invalid' using errcode = '55000';
  end if;
  if relocation.state in ('active', 'retired') then
    if relocation.source_sha256 <> p_source_sha256 or relocation.target_sha256 <> p_target_sha256
      or relocation.target_object_id <> target_object.id then
      raise exception 'message_media_verification_changed' using errcode = '55000';
    end if;
    return relocation.state;
  end if;
  select * into source_object from storage.objects object where object.bucket_id = 'message-media' and object.name = relocation.source_path;
  if not found or source_object.id <> relocation.source_object_id
    or source_object.owner_id is distinct from relocation.uploader_id::text
    or not private.message_media_metadata_matches(source_object.metadata, relocation.mime_type, relocation.size_bytes)
    or not exists (select 1 from public.message_attachments attachment
      where attachment.id = relocation.attachment_id and attachment.storage_path = relocation.source_path
        and attachment.uploader_id = relocation.uploader_id and attachment.mime_type = relocation.mime_type
        and attachment.size_bytes = relocation.size_bytes) then
    raise exception 'message_media_source_invalid' using errcode = '55000';
  end if;
  update private.message_media_relocations item set state = 'active', target_object_id = target_object.id,
    source_sha256 = p_source_sha256, target_sha256 = p_target_sha256, activated_at = statement_timestamp()
    where item.attachment_id = p_attachment_id;
  return 'active';
end
$function$;
alter function public.verify_message_media_relocation(uuid, text, text) owner to postgres;
revoke all on function public.verify_message_media_relocation(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.verify_message_media_relocation(uuid, text, text) to service_role;

create function public.finish_message_media_relocation(p_attachment_id uuid)
returns text language plpgsql security definer set search_path = '' as $function$
declare relocation private.message_media_relocations%rowtype;
begin
  perform private.assert_message_media_service();
  select * into relocation from private.message_media_relocations item where item.attachment_id = p_attachment_id;
  if not found then raise exception 'message_media_relocation_not_found' using errcode = 'P0002'; end if;
  perform private.lock_message_media_user_quota(relocation.uploader_id);
  select * into relocation from private.message_media_relocations item where item.attachment_id = p_attachment_id for update;
  if not found or relocation.state not in ('active', 'retired')
    or exists (select 1 from storage.objects object where object.bucket_id = 'message-media' and object.name = relocation.source_path)
    or not exists (select 1 from storage.objects object where object.bucket_id = 'message-media'
      and object.name = relocation.target_path and object.id = relocation.target_object_id
      and object.owner_id = relocation.uploader_id::text
      and private.message_media_metadata_matches(object.metadata, relocation.mime_type, relocation.size_bytes)) then
    raise exception 'message_media_retirement_not_complete' using errcode = '55000';
  end if;
  update private.message_media_relocations item set state = 'retired', retired_at = coalesce(item.retired_at, statement_timestamp())
    where item.attachment_id = p_attachment_id;
  return 'retired';
end
$function$;
alter function public.finish_message_media_relocation(uuid) owner to postgres;
revoke all on function public.finish_message_media_relocation(uuid) from public, anon, authenticated, service_role;
grant execute on function public.finish_message_media_relocation(uuid) to service_role;

create function public.list_message_media_account_cleanup(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare result jsonb;
begin
  perform private.assert_message_media_service();
  if p_user_id is null then raise exception 'message_media_account_required' using errcode = '22023'; end if;
  perform private.lock_message_media_user_quota(p_user_id);
  if not exists (select 1 from private.message_media_account_retirements retirement where retirement.user_id = p_user_id) then
    raise exception 'message_media_account_cleanup_not_prepared' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.message_attachments attachment
      left join private.message_media_relocations relocation on relocation.attachment_id = attachment.id
    where attachment.uploader_id = p_user_id
      and (not private.message_media_path_matches(attachment.storage_path, attachment.conversation_id, p_user_id)
        or (relocation.attachment_id is not null and (relocation.uploader_id <> p_user_id
          or relocation.source_path <> attachment.storage_path
          or not private.message_media_path_matches(relocation.target_path, attachment.conversation_id, p_user_id))))
  ) then raise exception 'message_media_unsafe_cleanup_path' using errcode = '55000'; end if;
  if exists (
    select 1 from storage.objects object where object.bucket_id = 'message-media'
      and object.owner_id is distinct from p_user_id::text and object.name in (
        select attachment.storage_path from public.message_attachments attachment where attachment.uploader_id = p_user_id
        union select relocation.target_path from private.message_media_relocations relocation where relocation.uploader_id = p_user_id
      )
  ) then raise exception 'message_media_cleanup_owner_mismatch' using errcode = '55000'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('storage_path', paths.storage_path) order by paths.storage_path), '[]'::jsonb)
    into result from (
      select attachment.storage_path from public.message_attachments attachment where attachment.uploader_id = p_user_id
      union select relocation.target_path from private.message_media_relocations relocation where relocation.uploader_id = p_user_id
    ) paths;
  return result;
end
$function$;
alter function public.list_message_media_account_cleanup(uuid) owner to postgres;
revoke all on function public.list_message_media_account_cleanup(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_message_media_account_cleanup(uuid) to service_role;

-- Preserve the existing reservation/completion and effective-open guards.
-- The only additional branch is the exact prepared service relocation target.
create or replace function private.lock_message_media_storage_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  relocation_owner_id uuid;
  authenticated_user_id uuid := auth.uid();
  effective_user_id uuid;
  is_storage_completion boolean := false;
  final_size_bytes bigint;
begin
  relocation_owner_id := private.authorize_message_media_relocation_insert(new.name, new.owner_id, new.metadata);
  if relocation_owner_id is not null then
    new.owner_id := relocation_owner_id::text;
    return new;
  end if;
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

create or replace function private.verify_open_conversation_message_media_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  relocation_owner_id uuid;
  authenticated_actor_id uuid := auth.uid();
  reservation_actor_id uuid;
  reservation_conversation_id uuid;
begin
  if new.bucket_id <> 'message-media' then
    return new;
  end if;

  relocation_owner_id := private.authorize_message_media_relocation_insert(new.name, new.owner_id, new.metadata);
  if relocation_owner_id is not null then
    new.owner_id := relocation_owner_id::text;
    return new;
  end if;

  select reservation.user_id, reservation.conversation_id
  into reservation_actor_id, reservation_conversation_id
  from private.message_media_upload_reservations reservation
  where reservation.storage_path = new.name
    and reservation.expires_at > now()
    and reservation.user_id::text = new.owner_id
    and (
      authenticated_actor_id is null
      or reservation.user_id = authenticated_actor_id
    )
    and reservation.mime_type = lower(trim(coalesce(new.metadata ->> 'mimetype', '')))
    and (
      authenticated_actor_id is not null
      or (
        coalesce(new.metadata ->> 'size', '') ~ '^[0-9]+$'
        and reservation.size_bytes = (new.metadata ->> 'size')::bigint
      )
    )
  for share;

  if not found then
    raise exception 'message_media_reservation_required'
      using errcode = '42501';
  end if;

  perform private.assert_conversation_participant_write_allowed(
    reservation_conversation_id,
    reservation_actor_id,
    true
  );

  return new;
end
$function$;

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
    ) or exists (
      select 1 from private.message_media_relocations relocation
      where relocation.target_path = old.name
    ) then
      raise exception 'Attached message media cannot be deleted'
        using errcode = '23503';
    end if;

    return old;
  end if;

  if auth.role() = 'service_role' and authenticated_user_id is null then
    -- A failed, not-yet-activated destination can be removed and retried while
    -- the exact original object is intact. This never authorizes source removal
    -- or removal of a destination that the application resolver has activated.
    if exists (
      select 1 from private.message_media_relocations relocation
      join storage.objects source on source.bucket_id = 'message-media'
        and source.name = relocation.source_path and source.id = relocation.source_object_id
      where relocation.target_path = old.name and relocation.uploader_id = object_owner_id
        and relocation.state = 'prepared' and source.owner_id = object_owner_id::text
        and private.message_media_metadata_matches(source.metadata, relocation.mime_type, relocation.size_bytes)
    ) then
      return old;
    end if;

    -- Only an activated, hash-attested relocation authorizes retiring its exact
    -- old object. The active destination itself still requires account cleanup.
    if exists (
      select 1 from private.message_media_relocations relocation
      join storage.objects target on target.bucket_id = 'message-media'
        and target.name = relocation.target_path and target.id = relocation.target_object_id
      where relocation.source_path = old.name and relocation.source_object_id = old.id
        and relocation.uploader_id = object_owner_id and relocation.state = 'active'
        and target.owner_id = object_owner_id::text
        and private.message_media_metadata_matches(target.metadata, relocation.mime_type, relocation.size_bytes)
        and relocation.source_sha256 = relocation.target_sha256
        and relocation.source_sha256 ~ '^[0-9a-f]{64}$'
    ) then
      return old;
    end if;
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

alter function private.lock_message_media_storage_insert() owner to postgres;
revoke all on function private.lock_message_media_storage_insert() from public, anon, authenticated, service_role;
alter function private.verify_open_conversation_message_media_insert() owner to postgres;
revoke all on function private.verify_open_conversation_message_media_insert() from public, anon, authenticated, service_role;
alter function private.guard_message_media_storage_delete() owner to postgres;
revoke all on function private.guard_message_media_storage_delete() from public, anon, authenticated, service_role;

comment on table private.message_media_relocations is 'Service-only, resumable relocation of existing private attachment bytes; logical paths and normal upload reservations are unchanged.';
comment on function public.resolve_message_media_attachment(uuid) is 'Service transport lookup only. The application must authorize the exact attachment through the requesting user RLS before invoking this resolver.';
comment on function public.verify_message_media_relocation(uuid, text, text) is 'Activates only after a trusted worker attests equal SHA256 hashes and SQL verifies exact committed source/target object identities and metadata. SQL does not hash stored bytes.';

commit;
