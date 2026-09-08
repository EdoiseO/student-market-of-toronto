-- Storage first probes INSERT as the authenticated uploader and rolls it back.
-- That row contains MIME/contentLength, not the final object size. After the
-- upload, Storage persists the actual metadata as service_role without a sub.
-- Bind both phases to the same live reservation and lock; validate final size
-- in the committing phase, as the message-media upload boundary already does.

create or replace function listing_action_private.guard_retiring_listing_image_upload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid;
  actor_segment text;
  jwt_actor_id uuid := auth.uid();
  jwt_role text := coalesce(auth.jwt() ->> 'role', '');
  is_storage_completion boolean := false;
  reservation_row listing_action_private.image_upload_reservations%rowtype;
  object_mime_type text;
  object_size_text text;
begin
  if new.bucket_id <> 'listing-images' then return new; end if;

  if tg_op = 'UPDATE' then
    raise exception using errcode = '42501', message = 'listing_image_overwrite_forbidden';
  end if;

  if not storage.allow_only_operation('storage.object.upload') then
    raise exception using errcode = '28000', message = 'listing_image_upload_context_invalid';
  end if;

  actor_segment := pg_catalog.split_part(new.name, '/', 1);
  if actor_segment !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode = '42501', message = 'listing_image_reservation_required';
  end if;
  actor_id := actor_segment::uuid;

  if new.owner_id is distinct from actor_id::text then
    raise exception using errcode = '42501', message = 'listing_image_owner_mismatch';
  end if;

  if jwt_role = 'authenticated' and jwt_actor_id is not null then
    if jwt_actor_id is distinct from actor_id then
      raise exception using errcode = '42501', message = 'listing_image_owner_mismatch';
    end if;
  elsif jwt_role = 'service_role' and jwt_actor_id is null then
    is_storage_completion := true;
  else
    raise exception using errcode = '28000', message = 'listing_image_upload_context_invalid';
  end if;

  -- Reacquire in completion: the permission probe's lock was rolled back.
  -- Retirement uses this same actor lock before installing its durable barrier.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('listing-write-actor:' || actor_id::text, 0)
  );

  if exists (
    select 1
    from listing_action_private.account_retirements retirement
    where retirement.actor_user_id_snapshot = actor_id
  ) then
    raise exception using errcode = '42501', message = 'listing_account_retirement_in_progress';
  end if;

  select reservation.* into reservation_row
  from listing_action_private.image_upload_reservations reservation
  join listing_action_private.write_intents intent
    on intent.actor_user_id = reservation.actor_user_id_snapshot
   and intent.operation_id = reservation.operation_id
  where reservation.storage_path = new.name
    and reservation.actor_user_id_snapshot = actor_id
    and reservation.listing_id_snapshot::text = pg_catalog.split_part(new.name, '/', 2)
    and reservation.state = 'reserved'
    and reservation.expires_at > pg_catalog.statement_timestamp()
    and intent.state in ('begun', 'in_progress')
  for key share of reservation, intent;

  if not found then
    raise exception using errcode = '42501', message = 'listing_image_reservation_required';
  end if;

  object_mime_type := pg_catalog.lower(coalesce(new.metadata ->> 'mimetype', ''));
  object_size_text := new.metadata ->> 'size';

  if object_mime_type is distinct from reservation_row.mime_type then
    raise exception using errcode = '22023', message = 'listing_image_reservation_metadata_mismatch';
  end if;

  -- contentLength can include multipart framing; it is never an object size.
  -- A real size, when supplied in preflight, must still match. Completion must
  -- always carry the authoritative final size; absent/malformed values fail.
  if is_storage_completion or object_size_text is not null then
    if object_size_text is null
      or object_size_text !~ '^[0-9]{1,19}$'
      or object_size_text::numeric is distinct from reservation_row.size_bytes::numeric then
      raise exception using errcode = '22023', message = 'listing_image_reservation_metadata_mismatch';
    end if;
  end if;

  return new;
end
$function$;

alter function listing_action_private.guard_retiring_listing_image_upload()
  owner to postgres;
revoke all on function listing_action_private.guard_retiring_listing_image_upload()
  from public, anon, authenticated, service_role;
