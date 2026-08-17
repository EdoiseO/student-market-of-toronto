-- Stage 6 listing required-field foundation.
--
-- Drafts intentionally require only a normalized title. Every transition into
-- moderation or the public catalogue goes through one row-locked readiness
-- assertion, including the trusted moderator approval path.

alter table public.listings
  alter column description drop not null,
  alter column price drop not null,
  alter column category drop not null,
  alter column condition drop not null;

create schema if not exists listing_action_private;
revoke all on schema listing_action_private
  from public, anon, authenticated, service_role;

-- Exact command results make browser retries safe after an ambiguous network
-- response. The actor-scoped UUID is one logical intent: replaying the same
-- normalized payload returns the original canonical result, while reusing it
-- for another action or payload fails closed.
create table if not exists listing_action_private.write_command_results (
  actor_user_id uuid not null,
  operation_id uuid not null,
  action text not null,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  primary key (actor_user_id, operation_id),
  constraint listing_write_command_action_format
    check (action ~ '^[a-z][a-z0-9_]*$'),
  constraint listing_write_command_payload_object
    check (pg_catalog.jsonb_typeof(payload) = 'object'),
  constraint listing_write_command_result_object
    check (pg_catalog.jsonb_typeof(result) = 'object')
);

alter table listing_action_private.write_command_results owner to postgres;
revoke all on table listing_action_private.write_command_results
  from public, anon, authenticated, service_role;

create or replace function private.normalize_listing_write_text(p_value text)
returns text
language sql
immutable
security invoker
set search_path = ''
begin atomic
  select pg_catalog.regexp_replace(
    pg_catalog.replace(
      pg_catalog.replace(coalesce(p_value, ''), E'\r\n', E'\n'),
      E'\r',
      E'\n'
    ),
    U&'^[[:space:]\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+|[[:space:]\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+$',
    '',
    'g'
  );
end;

alter function private.normalize_listing_write_text(text) owner to postgres;
revoke all on function private.normalize_listing_write_text(text)
  from public, anon, authenticated, service_role;

create or replace function private.listing_required_field_violations(
  p_title text,
  p_category text,
  p_price numeric,
  p_description text,
  p_condition text,
  p_location text,
  p_image_count bigint,
  p_valid_image_count bigint
)
returns text[]
language sql
immutable
security invoker
set search_path = ''
begin atomic
  select pg_catalog.array_remove(array[
    case when pg_catalog.char_length(private.normalize_listing_write_text(p_title)) not between 1 and 120 then 'title' end,
    case when pg_catalog.char_length(private.normalize_listing_write_text(p_category)) not between 1 and 80 then 'category' end,
    case when p_price is null
      or p_price::text in ('NaN', 'Infinity', '-Infinity')
      or p_price < 0 or p_price > 1000000 then 'price' end,
    case when pg_catalog.char_length(private.normalize_listing_write_text(p_description)) not between 1 and 5000 then 'description' end,
    case when pg_catalog.char_length(private.normalize_listing_write_text(p_condition)) not between 1 and 80 then 'condition' end,
    case when pg_catalog.char_length(private.normalize_listing_write_text(p_location)) not between 1 and 200 then 'location' end,
    case when coalesce(p_image_count, 0) not between 1 and 10
      or coalesce(p_valid_image_count, 0) <> coalesce(p_image_count, 0) then 'images' end
  ]::text[], null);
end;

alter function private.listing_required_field_violations(
  text, text, numeric, text, text, text, bigint, bigint
) owner to postgres;
revoke all on function private.listing_required_field_violations(
  text, text, numeric, text, text, text, bigint, bigint
) from public, anon, authenticated, service_role;

-- Drafts may omit every field except title, but any optional value they do
-- persist must already satisfy the same bounded write contract used at
-- publication. This prevents direct Data API callers from using drafts as an
-- unbounded text or invalid-numeric storage surface.
create or replace function private.listing_draft_field_violations(
  p_title text,
  p_category text,
  p_price numeric,
  p_description text,
  p_condition text,
  p_location text
)
returns text[]
language sql
immutable
security invoker
set search_path = ''
begin atomic
  select pg_catalog.array_remove(array[
    case when pg_catalog.char_length(private.normalize_listing_write_text(p_title)) not between 1 and 120 then 'title' end,
    case when p_category is not null
      and pg_catalog.char_length(private.normalize_listing_write_text(p_category)) not between 1 and 80 then 'category' end,
    case when p_price is not null and (
      p_price::text in ('NaN', 'Infinity', '-Infinity')
      or p_price < 0 or p_price > 1000000
    ) then 'price' end,
    case when p_description is not null
      and pg_catalog.char_length(private.normalize_listing_write_text(p_description)) > 5000 then 'description' end,
    case when p_condition is not null
      and pg_catalog.char_length(private.normalize_listing_write_text(p_condition)) not between 1 and 80 then 'condition' end,
    case when p_location is not null
      and pg_catalog.char_length(private.normalize_listing_write_text(p_location)) not between 1 and 200 then 'location' end
  ]::text[], null);
end;

alter function private.listing_draft_field_violations(
  text, text, numeric, text, text, text
) owner to postgres;
revoke all on function private.listing_draft_field_violations(
  text, text, numeric, text, text, text
) from public, anon, authenticated, service_role;

create or replace function private.listing_image_public_url(p_storage_path text)
returns text
language sql
immutable
security invoker
set search_path = ''
begin atomic
  -- This repository is bound to the production Supabase project whose public
  -- listing-images bucket is used by every deployed environment. Derive the
  -- origin server-side so Data API callers cannot substitute an external host.
  select 'https://bmnfynufuqjwjmtlfdxf.supabase.co/storage/v1/object/public/listing-images/'
    || coalesce(p_storage_path, '');
end;

alter function private.listing_image_public_url(text) owner to postgres;
revoke all on function private.listing_image_public_url(text)
  from public, anon, authenticated, service_role;

create or replace function private.listing_image_url_matches_path(
  p_image_url text,
  p_storage_path text
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
begin atomic
  select p_storage_path is not null
    and p_image_url is not distinct from private.listing_image_public_url(p_storage_path);
end;

alter function private.listing_image_url_matches_path(text, text) owner to postgres;
revoke all on function private.listing_image_url_matches_path(text, text)
  from public, anon, authenticated, service_role;

create or replace function private.assert_listing_publishable(p_listing_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  listing_row public.listings%rowtype;
  image_count bigint;
  valid_image_count bigint;
  violations text[];
begin
  -- Every readiness decision begins with the common parent-row lock. Image
  -- mutations use the same lock, so a submission cannot race an upload/delete.
  select * into listing_row
  from public.listings listing
  where listing.id = p_listing_id
  for update;

  if not found or listing_row.retired_at is not null then
    raise exception using errcode = 'P0002', message = 'listing_not_found';
  end if;

  select
    pg_catalog.count(*),
    pg_catalog.count(*) filter (
      where image.position between 0 and 9
        and image.storage_path is not null
        and image.image_url is not null
        and pg_catalog.array_length(
          pg_catalog.string_to_array(image.storage_path, '/'), 1
        ) = 3
        and pg_catalog.split_part(image.storage_path, '/', 1) = listing_row.seller_id::text
        and pg_catalog.split_part(image.storage_path, '/', 2) = listing_row.id::text
        and pg_catalog.split_part(image.storage_path, '/', 3) not in ('', '.', '..')
        and pg_catalog.strpos(image.storage_path, pg_catalog.chr(92)) = 0
        and pg_catalog.strpos(image.storage_path, '%') = 0
        and pg_catalog.strpos(image.storage_path, '?') = 0
        and pg_catalog.strpos(image.storage_path, '#') = 0
        and private.listing_image_url_matches_path(
          image.image_url,
          image.storage_path
        )
        and exists (
          select 1
          from storage.objects object
          where object.bucket_id = 'listing-images'
            and object.name = image.storage_path
            and object.owner_id = listing_row.seller_id::text
        )
    )
  into image_count, valid_image_count
  from public.listing_images image
  where image.listing_id = listing_row.id;

  violations := private.listing_required_field_violations(
    listing_row.title,
    listing_row.category,
    listing_row.price,
    listing_row.description,
    listing_row.condition,
    listing_row.location,
    image_count,
    valid_image_count
  );

  if pg_catalog.cardinality(violations) > 0 then
    raise exception using
      errcode = '23514',
      message = 'listing_required_fields_missing:' || pg_catalog.array_to_string(violations, ',');
  end if;
end
$function$;

alter function private.assert_listing_publishable(uuid) owner to postgres;
revoke all on function private.assert_listing_publishable(uuid)
  from public, anon, authenticated, service_role;

-- A SECURITY INVOKER trigger proves the trusted draft scope originated from a
-- postgres-owned function, rather than trusting a caller-supplied GUC alone.
create or replace function private.allow_listing_draft_save_origin()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if coalesce(
    pg_catalog.current_setting('app.listing_integrity_context', true), ''
  ) in ('trusted_draft_save', 'seller_transition') and current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'listing_draft_scope_is_not_trusted';
  end if;
  return new;
end
$function$;

alter function private.allow_listing_draft_save_origin() owner to postgres;
revoke all on function private.allow_listing_draft_save_origin()
  from public, anon, authenticated, service_role;

drop trigger if exists allow_listing_draft_save_origin on public.listings;
create trigger allow_listing_draft_save_origin
before insert or update on public.listings
for each row execute function private.allow_listing_draft_save_origin();

-- The custom GUC is only a transaction-local routing signal. A separate
-- SECURITY INVOKER trigger proves that the image batch actually originated
-- inside a postgres-owned trusted function; authenticated clients cannot
-- spoof the scope and bypass per-row revision changes.
create or replace function private.allow_listing_image_replace_origin()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if coalesce(
    pg_catalog.current_setting('app.listing_integrity_context', true), ''
  ) = 'trusted_draft_image_replace' and current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'listing_image_replace_scope_is_not_trusted';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$function$;

alter function private.allow_listing_image_replace_origin() owner to postgres;
revoke all on function private.allow_listing_image_replace_origin()
  from public, anon, authenticated, service_role;

drop trigger if exists allow_listing_image_replace_origin on public.listing_images;
create trigger allow_listing_image_replace_origin
before insert or update or delete on public.listing_images
for each row execute function private.allow_listing_image_replace_origin();

-- Reconcile the inherited image guard with the exact Stage 6 URL/path
-- contract. This second guard is intentionally additive during the foundation
-- window: old clients retain direct image DML, but cannot use substring/query
-- URL tricks or another user's Storage object.
create or replace function private.enforce_listing_image_write_contract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  caller_role text := coalesce(auth.jwt() ->> 'role', '');
  listing_owner uuid;
  current_image_count bigint;
begin
  perform listing.id
  from public.listings listing
  where listing.id = new.listing_id
  for update;

  select listing.seller_id into listing_owner
  from public.listings listing
  where listing.id = new.listing_id;

  if listing_owner is null then
    raise exception using errcode = '23503', message = 'listing_image_parent_not_found';
  end if;
  if caller_role <> 'service_role' and (
    caller_role <> 'authenticated'
    or caller_id is null
    or caller_id is distinct from listing_owner
  ) then
    raise exception using errcode = '42501', message = 'listing_image_owner_mismatch';
  end if;
  if new.position is null or new.position not between 0 and 9 then
    raise exception using errcode = '23514', message = 'listing_image_position_out_of_range';
  end if;
  if new.storage_path is null
    or pg_catalog.array_length(
      pg_catalog.string_to_array(new.storage_path, '/'), 1
    ) is distinct from 3
    or pg_catalog.split_part(new.storage_path, '/', 1) <> listing_owner::text
    or pg_catalog.split_part(new.storage_path, '/', 2) <> new.listing_id::text
    or pg_catalog.split_part(new.storage_path, '/', 3) in ('', '.', '..')
    or pg_catalog.strpos(new.storage_path, pg_catalog.chr(92)) > 0
    or pg_catalog.strpos(new.storage_path, '%') > 0
    or pg_catalog.strpos(new.storage_path, '?') > 0
    or pg_catalog.strpos(new.storage_path, '#') > 0 then
    raise exception using errcode = '23514', message = 'listing_image_storage_path_mismatch';
  end if;
  if not private.listing_image_url_matches_path(new.image_url, new.storage_path) then
    raise exception using errcode = '23514', message = 'listing_image_url_path_mismatch';
  end if;
  -- Hold the exact object through the metadata transaction. Without this row
  -- lock, a legacy direct INSERT can validate an object while a concurrent
  -- Storage DELETE removes it before the reference becomes visible.
  perform object.name
  from storage.objects object
  where object.bucket_id = 'listing-images'
    and object.name = new.storage_path
    and object.owner_id = listing_owner::text
  for key share;
  if not found then
    raise exception using
      errcode = '23503',
      message = 'listing_image_storage_object_not_found_or_owned';
  end if;

  if tg_op = 'INSERT' then
    select pg_catalog.count(*) into current_image_count
    from public.listing_images image
    where image.listing_id = new.listing_id;
    if current_image_count >= 10 then
      raise exception using errcode = '23514', message = 'listing_image_limit_exceeded';
    end if;
  end if;

  return new;
end
$function$;

alter function private.enforce_listing_image_write_contract() owner to postgres;
revoke all on function private.enforce_listing_image_write_contract()
  from public, anon, authenticated, service_role;

drop trigger if exists enforce_listing_image_write_contract on public.listing_images;
create trigger enforce_listing_image_write_contract
before insert or update of listing_id, storage_path, image_url, position
on public.listing_images
for each row execute function private.enforce_listing_image_write_contract();

create or replace function private.prevent_referenced_listing_image_object_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.bucket_id = 'listing-images' and exists (
    select 1
    from public.listing_images image
    where image.storage_path = old.name
  ) then
    raise exception using
      errcode = '23503',
      message = 'listing_image_storage_object_is_referenced';
  end if;
  return old;
end
$function$;

alter function private.prevent_referenced_listing_image_object_delete() owner to postgres;
revoke all on function private.prevent_referenced_listing_image_object_delete()
  from public, anon, authenticated, service_role;

drop trigger if exists prevent_referenced_listing_image_object_delete on storage.objects;
create trigger prevent_referenced_listing_image_object_delete
before delete on storage.objects
for each row execute function private.prevent_referenced_listing_image_object_delete();

-- The inherited after-row trigger remains the compatibility path for legacy
-- direct image writes. Only the origin-checked atomic replacement scope skips
-- its per-row bumps; the replacement RPC bumps the parent once after the full
-- metadata set is installed.
create or replace function public.touch_listing_revision_for_image_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  affected_listing_id uuid;
  integrity_context text := coalesce(
    pg_catalog.current_setting('app.listing_integrity_context', true), ''
  );
begin
  if integrity_context in ('discard_draft', 'retirement', 'trusted_draft_image_replace') then
    return null;
  end if;
  if tg_op = 'UPDATE'
    and new.listing_id is not distinct from old.listing_id
    and new.image_url is not distinct from old.image_url
    and new.storage_path is not distinct from old.storage_path
    and new.position is not distinct from old.position then
    return null;
  end if;

  affected_listing_id := case when tg_op = 'DELETE' then old.listing_id else new.listing_id end;
  perform pg_catalog.set_config('app.listing_integrity_context', 'image_change', true);
  update public.listings set content_revision = content_revision + 1
  where id = affected_listing_id;
  if tg_op = 'UPDATE' and new.listing_id is distinct from old.listing_id then
    update public.listings set content_revision = content_revision + 1
    where id = old.listing_id;
  end if;
  return null;
end
$function$;

alter function public.touch_listing_revision_for_image_change() owner to postgres;
revoke all on function public.touch_listing_revision_for_image_change()
  from public, anon, authenticated, service_role;

create or replace function public.enforce_listing_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  caller_role text := coalesce(auth.jwt() ->> 'role', '');
  integrity_context text := coalesce(
    pg_catalog.current_setting('app.listing_integrity_context', true), ''
  );
  content_changed boolean;
  violations text[];
begin
  -- Canonicalize every listing write at the database boundary. This mirrors
  -- the browser/server shared contract and prevents direct RPC/table callers
  -- from persisting platform-specific CRLF or bare-CR line endings.
  new.title := private.normalize_listing_write_text(new.title);
  new.description := nullif(private.normalize_listing_write_text(new.description), '');
  new.category := nullif(private.normalize_listing_write_text(new.category), '');
  new.condition := nullif(private.normalize_listing_write_text(new.condition), '');
  new.location := nullif(private.normalize_listing_write_text(new.location), '');

  if tg_op = 'INSERT' then
    if caller_role = 'anon' then
      raise exception using errcode = '42501', message = 'listing_authentication_required';
    end if;
    if caller_role = 'authenticated' then
      if caller_id is null or new.seller_id is distinct from caller_id then
        raise exception using errcode = '42501', message = 'listing_owner_mismatch';
      end if;
      if integrity_context = 'trusted_draft_save' then
        new.status := 'draft';
      elsif new.status not in ('draft', 'inactive') then
        raise exception using errcode = '42501', message = 'listing_initial_status_not_allowed';
      end if;
      violations := private.listing_draft_field_violations(
        new.title,
        new.category,
        new.price,
        new.description,
        new.condition,
        new.location
      );
      if pg_catalog.cardinality(violations) > 0 then
        raise exception using
          errcode = '23514',
          message = 'listing_required_fields_missing:' ||
            pg_catalog.array_to_string(violations, ',');
      end if;
      if new.status = 'inactive' then
        -- The old app inserts the pending listing before its image rows. Keep
        -- that deployment-compatible ordering, but require every non-image
        -- publish field at the database boundary during the foundation phase.
        violations := private.listing_required_field_violations(
          new.title,
          new.category,
          new.price,
          new.description,
          new.condition,
          new.location,
          1,
          1
        );
        if pg_catalog.cardinality(violations) > 0 then
          raise exception using
            errcode = '23514',
            message = 'listing_required_fields_missing:' ||
              pg_catalog.array_to_string(violations, ',');
        end if;
      end if;
      new.content_revision := 1;
      new.retired_at := null;
      new.moderation_feedback := null;
      new.moderation_reviewed_at := null;
      new.moderation_reviewed_by := null;
      new.submitted_for_review_at := case
        when new.status = 'inactive' then statement_timestamp()
        else null
      end;
    end if;
    return new;
  end if;

  if integrity_context = 'listing_contract_migration' then
    return new;
  end if;

  if caller_role = 'service_role'
    or integrity_context in ('trusted_moderation_decision', 'trusted_report_listing_removal') then
    if integrity_context = 'trusted_moderation_decision' and new.status = 'active' then
      perform private.assert_listing_publishable(new.id);
    end if;
    return new;
  end if;

  if old.retired_at is not null then
    raise exception using errcode = '42501', message = 'listing_is_retired';
  end if;
  if integrity_context <> 'retirement' and new.retired_at is distinct from old.retired_at then
    raise exception using errcode = '42501', message = 'listing_retirement_is_server_managed';
  end if;

  if integrity_context in ('seller_transition', 'retirement', 'image_change', 'trusted_draft_save') then
    if caller_role <> 'authenticated' or caller_id is null
      or old.seller_id is distinct from caller_id
      or new.seller_id is distinct from caller_id then
      raise exception using errcode = '42501', message = 'listing_owner_mismatch';
    end if;
    if integrity_context = 'retirement' then
      if new.retired_at is null then
        raise exception using errcode = '42501', message = 'listing_retirement_marker_required';
      end if;
      new.content_revision := old.content_revision + 1;
    elsif integrity_context = 'seller_transition' then
      new.content_revision := old.content_revision;
    elsif integrity_context = 'trusted_draft_save' then
      violations := private.listing_draft_field_violations(
        new.title,
        new.category,
        new.price,
        new.description,
        new.condition,
        new.location
      );
      if pg_catalog.cardinality(violations) > 0 then
        raise exception using
          errcode = '23514',
          message = 'listing_required_fields_missing:' ||
            pg_catalog.array_to_string(violations, ',');
      end if;
      new.content_revision := old.content_revision + 1;
      new.status := 'draft';
      new.submitted_for_review_at := null;
      new.moderation_feedback := null;
      new.moderation_reviewed_at := null;
      new.moderation_reviewed_by := null;
    else
      -- Foundation compatibility: the deployed client still writes image rows
      -- directly. Preserve its pending-review behavior until the later cutover
      -- moves every image edit behind the trusted draft-save workflow.
      new.content_revision := old.content_revision + 1;
      if old.status in ('active', 'sold', 'inactive') then
        new.status := 'inactive';
        new.submitted_for_review_at := statement_timestamp();
        new.moderation_feedback := null;
        new.moderation_reviewed_at := null;
        new.moderation_reviewed_by := null;
      end if;
    end if;
    return new;
  end if;

  if caller_role <> 'authenticated' or caller_id is null then
    raise exception using errcode = '42501', message = 'listing_authentication_required';
  end if;
  if old.seller_id is distinct from caller_id or new.seller_id is distinct from caller_id then
    raise exception using errcode = '42501', message = 'listing_owner_mismatch';
  end if;
  violations := private.listing_draft_field_violations(
    new.title,
    new.category,
    new.price,
    new.description,
    new.condition,
    new.location
  );
  if pg_catalog.cardinality(violations) > 0 then
    raise exception using
      errcode = '23514',
      message = 'listing_required_fields_missing:' ||
        pg_catalog.array_to_string(violations, ',');
  end if;

  content_changed :=
    new.slug is distinct from old.slug or new.title is distinct from old.title
    or new.description is distinct from old.description or new.price is distinct from old.price
    or new.previous_price is distinct from old.previous_price
    or new.category is distinct from old.category or new.condition is distinct from old.condition
    or new.location is distinct from old.location
    or new.is_negotiable is distinct from old.is_negotiable;

  if new.content_revision is distinct from old.content_revision then
    raise exception using errcode = '42501', message = 'listing_revision_is_server_managed';
  end if;
  if new.moderation_feedback is distinct from old.moderation_feedback
    or new.moderation_reviewed_at is distinct from old.moderation_reviewed_at
    or new.moderation_reviewed_by is distinct from old.moderation_reviewed_by then
    raise exception using errcode = '42501', message = 'listing_moderation_metadata_is_server_managed';
  end if;
  if not content_changed then
    if new.status is distinct from old.status
      or new.submitted_for_review_at is distinct from old.submitted_for_review_at then
      raise exception using errcode = '42501', message = 'listing_status_transition_requires_rpc';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status
    and not (old.status in ('active', 'sold', 'inactive') and new.status = 'inactive') then
    raise exception using errcode = '42501', message = 'listing_status_transition_requires_rpc';
  end if;
  if new.submitted_for_review_at is distinct from old.submitted_for_review_at then
    raise exception using errcode = '42501', message = 'listing_submission_timestamp_is_server_managed';
  end if;
  new.content_revision := old.content_revision + 1;
  if old.status in ('active', 'sold', 'inactive') then
    -- Direct field updates are the old application's write surface. Keep its
    -- inactive/pending-review projection during the additive foundation; only
    -- save_owned_listing_draft intentionally demotes to draft here. Since the
    -- row is returning to moderation, every non-image publish field remains
    -- mandatory even for a direct compatibility write.
    violations := private.listing_required_field_violations(
      new.title,
      new.category,
      new.price,
      new.description,
      new.condition,
      new.location,
      1,
      1
    );
    if pg_catalog.cardinality(violations) > 0 then
      raise exception using
        errcode = '23514',
        message = 'listing_required_fields_missing:' ||
          pg_catalog.array_to_string(violations, ',');
    end if;
    new.status := 'inactive';
    new.submitted_for_review_at := statement_timestamp();
    new.moderation_feedback := null;
    new.moderation_reviewed_at := null;
    new.moderation_reviewed_by := null;
  end if;
  return new;
end
$function$;

alter function public.enforce_listing_integrity() owner to postgres;
revoke all on function public.enforce_listing_integrity()
  from public, anon, authenticated, service_role;

create or replace function listing_action_private.save_owned_listing_draft_impl(
  p_title text,
  p_listing_id uuid default null,
  p_expected_content_revision bigint default null,
  p_description text default null,
  p_price numeric default null,
  p_category text default null,
  p_condition text default null,
  p_location text default null,
  p_is_negotiable boolean default false
)
returns setof public.listings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  caller_role text := coalesce(auth.jwt() ->> 'role', '');
  listing_row public.listings%rowtype;
  listing_uuid uuid;
  normalized_title text := private.normalize_listing_write_text(p_title);
  normalized_description text := nullif(private.normalize_listing_write_text(p_description), '');
  normalized_category text := nullif(private.normalize_listing_write_text(p_category), '');
  normalized_condition text := nullif(private.normalize_listing_write_text(p_condition), '');
  normalized_location text := nullif(private.normalize_listing_write_text(p_location), '');
  base_slug text;
begin
  if caller_role <> 'authenticated' or caller_id is null then
    raise exception using errcode = '42501', message = 'listing_authentication_required';
  end if;
  if pg_catalog.char_length(normalized_title) not between 1 and 120 then
    raise exception using errcode = '23514', message = 'listing_required_fields_missing:title';
  end if;
  if normalized_description is not null and pg_catalog.char_length(normalized_description) > 5000 then
    raise exception using errcode = '23514', message = 'listing_description_too_long';
  end if;
  if normalized_category is not null and pg_catalog.char_length(normalized_category) > 80 then
    raise exception using errcode = '23514', message = 'listing_category_too_long';
  end if;
  if normalized_condition is not null and pg_catalog.char_length(normalized_condition) > 80 then
    raise exception using errcode = '23514', message = 'listing_condition_too_long';
  end if;
  if normalized_location is not null and pg_catalog.char_length(normalized_location) > 200 then
    raise exception using errcode = '23514', message = 'listing_location_too_long';
  end if;
  if p_price is not null and (
    p_price::text in ('NaN', 'Infinity', '-Infinity') or p_price < 0 or p_price > 1000000
  ) then
    raise exception using errcode = '23514', message = 'listing_price_out_of_range';
  end if;

  if p_listing_id is null then
    if p_expected_content_revision is not null then
      raise exception using errcode = '22023', message = 'listing_revision_not_allowed_for_create';
    end if;
    listing_uuid := gen_random_uuid();
    base_slug := pg_catalog.btrim(
      pg_catalog.regexp_replace(
        pg_catalog.lower(normalized_title), '[^a-z0-9]+', '-', 'g'
      ),
      '-'
    );
    if base_slug = '' then base_slug := 'listing'; end if;

    perform pg_catalog.set_config('app.listing_integrity_context', 'trusted_draft_save', true);
    insert into public.listings (
      id, seller_id, slug, title, description, price, category, condition,
      location, status, is_negotiable
    ) values (
      listing_uuid,
      caller_id,
      pg_catalog.left(base_slug, 90) || '-' || pg_catalog.left(listing_uuid::text, 8),
      normalized_title,
      normalized_description,
      p_price,
      normalized_category,
      normalized_condition,
      normalized_location,
      'draft',
      coalesce(p_is_negotiable, false)
    ) returning * into listing_row;
    perform pg_catalog.set_config('app.listing_integrity_context', '', true);
  else
    if p_expected_content_revision is null or p_expected_content_revision < 1 then
      raise exception using errcode = '22023', message = 'listing_expected_revision_required';
    end if;

    select * into listing_row
    from public.listings listing
    where listing.id = p_listing_id
    for update;

    if not found or listing_row.seller_id is distinct from caller_id then
      raise exception using errcode = '42501', message = 'listing_owner_mismatch';
    end if;
    if listing_row.retired_at is not null then
      raise exception using errcode = 'P0001', message = 'listing_is_retired';
    end if;
    if listing_row.content_revision is distinct from p_expected_content_revision then
      raise exception using errcode = '40001', message = 'listing_review_revision_conflict';
    end if;

    -- Claim every scalar-only edit intent, even when normalization makes its
    -- values unchanged. Photo edits use the atomic manifest RPC below so the
    -- listing fields and complete image set share one original-revision lock.
    perform pg_catalog.set_config('app.listing_integrity_context', 'trusted_draft_save', true);
    update public.listings
    set title = normalized_title,
        description = normalized_description,
        price = p_price,
        category = normalized_category,
        condition = normalized_condition,
        location = normalized_location,
        is_negotiable = coalesce(p_is_negotiable, false),
        status = 'draft',
        submitted_for_review_at = null,
        moderation_feedback = null,
        moderation_reviewed_at = null,
        moderation_reviewed_by = null
    where id = p_listing_id
    returning * into listing_row;
    perform pg_catalog.set_config('app.listing_integrity_context', '', true);
  end if;

  return query select listing_row.*;
end
$function$;

alter function listing_action_private.save_owned_listing_draft_impl(
  text, uuid, bigint, text, numeric, text, text, text, boolean
) owner to postgres;
revoke all on function listing_action_private.save_owned_listing_draft_impl(
  text, uuid, bigint, text, numeric, text, text, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function listing_action_private.save_owned_listing_draft_impl(
  text, uuid, bigint, text, numeric, text, text, text, boolean
) to authenticated;

create or replace function public.save_owned_listing_draft(
  p_title text,
  p_listing_id uuid default null,
  p_expected_content_revision bigint default null,
  p_description text default null,
  p_price numeric default null,
  p_category text default null,
  p_condition text default null,
  p_location text default null,
  p_is_negotiable boolean default false
)
returns setof public.listings
language sql
security invoker
set search_path = ''
begin atomic
  select *
  from listing_action_private.save_owned_listing_draft_impl(
    p_title,
    p_listing_id,
    p_expected_content_revision,
    p_description,
    p_price,
    p_category,
    p_condition,
    p_location,
    p_is_negotiable
  );
end;

alter function public.save_owned_listing_draft(
  text, uuid, bigint, text, numeric, text, text, text, boolean
) owner to postgres;
revoke all on function public.save_owned_listing_draft(
  text, uuid, bigint, text, numeric, text, text, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.save_owned_listing_draft(
  text, uuid, bigint, text, numeric, text, text, text, boolean
) to authenticated;

-- Keep the legacy unversioned cleanup entry point available until the later
-- cutover: the currently deployed client still calls it. The Stage 6 client
-- uses the revision-conditional replacement below so it can never delete a
-- concurrently edited draft.

create or replace function listing_action_private.discard_owned_listing_draft_impl(
  p_listing_id uuid,
  p_expected_content_revision bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  caller_role text := coalesce(auth.jwt() ->> 'role', '');
  listing_row public.listings%rowtype;
  has_dependencies boolean;
begin
  if caller_role <> 'authenticated' or caller_id is null then
    raise exception using errcode = '42501', message = 'listing_authentication_required';
  end if;
  if p_expected_content_revision is null or p_expected_content_revision < 1 then
    raise exception using errcode = '22023', message = 'listing_expected_revision_required';
  end if;

  perform image.id
  from public.listing_images image
  where image.listing_id = p_listing_id
  order by image.id
  for update;

  select * into listing_row
  from public.listings listing
  where listing.id = p_listing_id
  for update;

  if not found or listing_row.seller_id is distinct from caller_id then
    raise exception using errcode = '42501', message = 'listing_owner_mismatch';
  end if;
  if listing_row.content_revision is distinct from p_expected_content_revision then
    raise exception using errcode = '40001', message = 'listing_review_revision_conflict';
  end if;
  if listing_row.retired_at is not null
    or listing_row.status not in ('draft', 'inactive')
    or listing_row.moderation_reviewed_at is not null then
    raise exception using errcode = 'P0001', message = 'listing_discard_not_allowed';
  end if;

  select exists (
    select 1 from public.reports report where report.listing_id = p_listing_id
  ) or exists (
    select 1 from public.listing_moderation_history history
    where history.listing_id = p_listing_id
  ) or exists (
    select 1 from public.conversations conversation
    where conversation.listing_id = p_listing_id
  ) into has_dependencies;
  if has_dependencies then
    raise exception using errcode = 'P0001', message = 'listing_discard_has_dependencies';
  end if;

  perform pg_catalog.set_config('app.listing_integrity_context', 'discard_draft', true);
  delete from public.listing_images image where image.listing_id = p_listing_id;
  delete from public.listings listing where listing.id = p_listing_id;
  perform pg_catalog.set_config('app.listing_integrity_context', '', true);
end
$function$;

alter function listing_action_private.discard_owned_listing_draft_impl(uuid, bigint)
  owner to postgres;
revoke all on function listing_action_private.discard_owned_listing_draft_impl(uuid, bigint)
  from public, anon, authenticated, service_role;
grant execute on function listing_action_private.discard_owned_listing_draft_impl(uuid, bigint)
  to authenticated;

create or replace function public.discard_owned_listing_draft_if_unchanged(
  p_listing_id uuid,
  p_expected_content_revision bigint
)
returns void
language sql
security invoker
set search_path = ''
begin atomic
  select listing_action_private.discard_owned_listing_draft_impl(
    p_listing_id,
    p_expected_content_revision
  );
end;

alter function public.discard_owned_listing_draft_if_unchanged(uuid, bigint)
  owner to postgres;
revoke all on function public.discard_owned_listing_draft_if_unchanged(uuid, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.discard_owned_listing_draft_if_unchanged(uuid, bigint)
  to authenticated;

create or replace function listing_action_private.discard_owned_listing_draft_idempotent_impl(
  p_operation_id uuid,
  p_listing_id uuid,
  p_expected_content_revision bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  caller_role text := coalesce(auth.jwt() ->> 'role', '');
  command_payload jsonb := pg_catalog.jsonb_build_object(
    'listing_id', p_listing_id,
    'expected_content_revision', p_expected_content_revision
  );
  command_row listing_action_private.write_command_results%rowtype;
begin
  if caller_role <> 'authenticated' or caller_id is null then
    raise exception using errcode = '42501', message = 'listing_authentication_required';
  end if;
  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'listing_operation_id_required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text || ':' || p_operation_id::text, 0)
  );
  select * into command_row
  from listing_action_private.write_command_results command
  where command.actor_user_id = caller_id
    and command.operation_id = p_operation_id;
  if found then
    if command_row.action is distinct from 'discard_listing_draft'
      or command_row.payload is distinct from command_payload then
      raise exception using errcode = '22023', message = 'listing_operation_payload_conflict';
    end if;
    return coalesce((command_row.result ->> 'discarded')::boolean, false);
  end if;

  perform listing_action_private.discard_owned_listing_draft_impl(
    p_listing_id, p_expected_content_revision
  );
  insert into listing_action_private.write_command_results(
    actor_user_id, operation_id, action, payload, result
  ) values (
    caller_id,
    p_operation_id,
    'discard_listing_draft',
    command_payload,
    pg_catalog.jsonb_build_object('discarded', true)
  );
  return true;
end
$function$;

alter function listing_action_private.discard_owned_listing_draft_idempotent_impl(
  uuid, uuid, bigint
) owner to postgres;
revoke all on function listing_action_private.discard_owned_listing_draft_idempotent_impl(
  uuid, uuid, bigint
) from public, anon, authenticated, service_role;
grant execute on function listing_action_private.discard_owned_listing_draft_idempotent_impl(
  uuid, uuid, bigint
) to authenticated;

create or replace function public.discard_owned_listing_draft_if_unchanged_idempotent(
  p_operation_id uuid,
  p_listing_id uuid,
  p_expected_content_revision bigint
)
returns boolean
language sql
security invoker
set search_path = ''
begin atomic
  select listing_action_private.discard_owned_listing_draft_idempotent_impl(
    p_operation_id, p_listing_id, p_expected_content_revision
  );
end;

alter function public.discard_owned_listing_draft_if_unchanged_idempotent(
  uuid, uuid, bigint
) owner to postgres;
revoke all on function public.discard_owned_listing_draft_if_unchanged_idempotent(
  uuid, uuid, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.discard_owned_listing_draft_if_unchanged_idempotent(
  uuid, uuid, bigint
) to authenticated;

create or replace function listing_action_private.replace_owned_listing_images_impl(
  p_listing_id uuid,
  p_expected_content_revision bigint,
  p_images jsonb,
  p_apply_listing_fields boolean,
  p_title text,
  p_description text,
  p_price numeric,
  p_category text,
  p_condition text,
  p_location text,
  p_is_negotiable boolean
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  caller_role text := coalesce(auth.jwt() ->> 'role', '');
  listing_row public.listings%rowtype;
  image_item record;
  image_count integer;
  next_revision bigint;
  normalized_title text := private.normalize_listing_write_text(p_title);
  normalized_description text := nullif(private.normalize_listing_write_text(p_description), '');
  normalized_category text := nullif(private.normalize_listing_write_text(p_category), '');
  normalized_condition text := nullif(private.normalize_listing_write_text(p_condition), '');
  normalized_location text := nullif(private.normalize_listing_write_text(p_location), '');
  violations text[];
  locked_image_ids uuid[];
  current_image_ids uuid[];
begin
  if caller_role <> 'authenticated' or caller_id is null then
    raise exception using errcode = '42501', message = 'listing_authentication_required';
  end if;
  if p_expected_content_revision is null or p_expected_content_revision < 1 then
    raise exception using errcode = '22023', message = 'listing_expected_revision_required';
  end if;
  if p_images is null or pg_catalog.jsonb_typeof(p_images) <> 'array' then
    raise exception using errcode = '22023', message = 'listing_images_array_required';
  end if;

  image_count := pg_catalog.jsonb_array_length(p_images);
  if image_count not between 0 and 10 then
    raise exception using errcode = '23514', message = 'listing_image_limit_exceeded';
  end if;

  -- Match legacy DELETE's unavoidable row->parent order. Lock the complete
  -- current manifest deterministically before the parent, then revalidate
  -- after acquiring the parent; a concurrent legacy INSERT/DELETE changes the
  -- parent revision and makes this command retry instead of forming a cycle.
  select coalesce(pg_catalog.array_agg(locked.id order by locked.id), array[]::uuid[])
  into locked_image_ids
  from (
    select image.id
    from public.listing_images image
    where image.listing_id = p_listing_id
    order by image.id
    for update
  ) locked;

  select * into listing_row
  from public.listings listing
  where listing.id = p_listing_id
  for update;

  if not found or listing_row.seller_id is distinct from caller_id then
    raise exception using errcode = '42501', message = 'listing_owner_mismatch';
  end if;
  if listing_row.retired_at is not null then
    raise exception using errcode = 'P0001', message = 'listing_is_retired';
  end if;
  if exists (
    select 1
    from public.user_status status
    where status.user_id = caller_id
      and status.is_banned = true
      and (status.banned_until is null or status.banned_until > pg_catalog.statement_timestamp())
  ) then
    raise exception using errcode = '42501', message = 'account_is_banned';
  end if;
  if not p_apply_listing_fields and listing_row.status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'listing_image_replace_requires_draft';
  end if;
  if listing_row.content_revision is distinct from p_expected_content_revision then
    raise exception using errcode = '40001', message = 'listing_review_revision_conflict';
  end if;
  select coalesce(pg_catalog.array_agg(image.id order by image.id), array[]::uuid[])
  into current_image_ids
  from public.listing_images image
  where image.listing_id = p_listing_id;
  if current_image_ids is distinct from locked_image_ids then
    raise exception using errcode = '40001', message = 'listing_review_revision_conflict';
  end if;
  if p_apply_listing_fields then
    violations := private.listing_draft_field_violations(
      normalized_title,
      normalized_category,
      p_price,
      normalized_description,
      normalized_condition,
      normalized_location
    );
    if pg_catalog.cardinality(violations) > 0 then
      raise exception using
        errcode = '23514',
        message = 'listing_required_fields_missing:' ||
          pg_catalog.array_to_string(violations, ',');
    end if;
  end if;

  if (
    select pg_catalog.count(distinct item ->> 'id')
    from pg_catalog.jsonb_array_elements(p_images) as element(item)
  ) <> image_count or (
    select pg_catalog.count(distinct item ->> 'storage_path')
    from pg_catalog.jsonb_array_elements(p_images) as element(item)
  ) <> image_count then
    raise exception using errcode = '23514', message = 'listing_image_duplicates_not_allowed';
  end if;

  for image_item in
    select value as item, ordinality
    from pg_catalog.jsonb_array_elements(p_images) with ordinality
  loop
    if pg_catalog.jsonb_typeof(image_item.item) <> 'object'
      or (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(image_item.item)
      ) <> 4
      or not (image_item.item ?& array['id', 'image_url', 'storage_path', 'position']) then
      raise exception using errcode = '22023', message = 'listing_image_object_invalid';
    end if;
    if coalesce(image_item.item ->> 'id', '') !~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode = '22023', message = 'listing_image_id_invalid';
    end if;
    if coalesce(image_item.item ->> 'position', '') !~ '^(0|[1-9])$'
      or (image_item.item ->> 'position')::integer <> image_item.ordinality - 1 then
      raise exception using errcode = '23514', message = 'listing_image_position_out_of_range';
    end if;
    if coalesce(image_item.item ->> 'storage_path', '') = ''
      or pg_catalog.array_length(
        pg_catalog.string_to_array(image_item.item ->> 'storage_path', '/'), 1
      ) is distinct from 3
      or pg_catalog.split_part(image_item.item ->> 'storage_path', '/', 1) <> caller_id::text
      or pg_catalog.split_part(image_item.item ->> 'storage_path', '/', 2) <> p_listing_id::text
      or pg_catalog.split_part(image_item.item ->> 'storage_path', '/', 3) in ('', '.', '..')
      or pg_catalog.strpos(image_item.item ->> 'storage_path', pg_catalog.chr(92)) > 0
      or pg_catalog.strpos(image_item.item ->> 'storage_path', '%') > 0
      or pg_catalog.strpos(image_item.item ->> 'storage_path', '?') > 0
      or pg_catalog.strpos(image_item.item ->> 'storage_path', '#') > 0 then
      raise exception using errcode = '23514', message = 'listing_image_storage_path_mismatch';
    end if;
    if not private.listing_image_url_matches_path(
      image_item.item ->> 'image_url',
      image_item.item ->> 'storage_path'
    ) then
      raise exception using errcode = '23514', message = 'listing_image_url_path_mismatch';
    end if;
  end loop;

  -- Lock every referenced object in canonical path order. This both prevents
  -- object deletion between validation and metadata insertion and avoids a
  -- reversed-manifest deadlock between two atomic replacements.
  perform object.name
  from storage.objects object
  where object.bucket_id = 'listing-images'
    and object.owner_id = caller_id::text
    and object.name in (
      select item ->> 'storage_path'
      from pg_catalog.jsonb_array_elements(p_images) as element(item)
    )
  order by object.name
  for key share;

  if (
    select pg_catalog.count(*)
    from storage.objects object
    where object.bucket_id = 'listing-images'
      and object.owner_id = caller_id::text
      and object.name in (
        select item ->> 'storage_path'
        from pg_catalog.jsonb_array_elements(p_images) as element(item)
      )
  ) <> image_count then
    raise exception using
      errcode = '23503',
      message = 'listing_image_storage_object_not_found_or_owned';
  end if;

  perform pg_catalog.set_config(
    'app.listing_integrity_context', 'trusted_draft_image_replace', true
  );
  delete from public.listing_images image
  where image.listing_id = p_listing_id;

  insert into public.listing_images (
    id,
    listing_id,
    image_url,
    storage_path,
    position
  )
  select
    (item ->> 'id')::uuid,
    p_listing_id,
    private.listing_image_public_url(item ->> 'storage_path'),
    item ->> 'storage_path',
    (item ->> 'position')::integer
  from pg_catalog.jsonb_array_elements(p_images) as element(item);

  perform pg_catalog.set_config('app.listing_integrity_context', 'trusted_draft_save', true);
  if p_apply_listing_fields then
    update public.listings
    set title = normalized_title,
        description = normalized_description,
        price = p_price,
        category = normalized_category,
        condition = normalized_condition,
        location = normalized_location,
        is_negotiable = coalesce(p_is_negotiable, false),
        status = 'draft',
        submitted_for_review_at = null,
        moderation_feedback = null,
        moderation_reviewed_at = null,
        moderation_reviewed_by = null,
        updated_at = pg_catalog.statement_timestamp()
    where id = p_listing_id
    returning content_revision into next_revision;
  else
    update public.listings
    set updated_at = pg_catalog.statement_timestamp()
    where id = p_listing_id
    returning content_revision into next_revision;
  end if;
  perform pg_catalog.set_config('app.listing_integrity_context', '', true);

  return next_revision;
end
$function$;

alter function listing_action_private.replace_owned_listing_images_impl(
  uuid, bigint, jsonb, boolean, text, text, numeric, text, text, text, boolean
) owner to postgres;
revoke all on function listing_action_private.replace_owned_listing_images_impl(
  uuid, bigint, jsonb, boolean, text, text, numeric, text, text, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function listing_action_private.replace_owned_listing_images_impl(
  uuid, bigint, jsonb, boolean, text, text, numeric, text, text, text, boolean
) to authenticated;

create or replace function public.replace_owned_listing_images(
  p_listing_id uuid,
  p_expected_content_revision bigint,
  p_images jsonb
)
returns bigint
language sql
security invoker
set search_path = ''
begin atomic
  select listing_action_private.replace_owned_listing_images_impl(
    p_listing_id,
    p_expected_content_revision,
    p_images,
    false,
    null,
    null,
    null,
    null,
    null,
    null,
    false
  );
end;

alter function public.replace_owned_listing_images(uuid, bigint, jsonb) owner to postgres;
revoke all on function public.replace_owned_listing_images(uuid, bigint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.replace_owned_listing_images(uuid, bigint, jsonb)
  to authenticated;

create or replace function public.save_owned_listing_draft_with_images(
  p_listing_id uuid,
  p_expected_content_revision bigint,
  p_images jsonb,
  p_title text,
  p_description text default null,
  p_price numeric default null,
  p_category text default null,
  p_condition text default null,
  p_location text default null,
  p_is_negotiable boolean default false
)
returns bigint
language sql
security invoker
set search_path = ''
begin atomic
  select listing_action_private.replace_owned_listing_images_impl(
    p_listing_id,
    p_expected_content_revision,
    p_images,
    true,
    p_title,
    p_description,
    p_price,
    p_category,
    p_condition,
    p_location,
    p_is_negotiable
  );
end;

alter function public.save_owned_listing_draft_with_images(
  uuid, bigint, jsonb, text, text, numeric, text, text, text, boolean
) owner to postgres;
revoke all on function public.save_owned_listing_draft_with_images(
  uuid, bigint, jsonb, text, text, numeric, text, text, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.save_owned_listing_draft_with_images(
  uuid, bigint, jsonb, text, text, numeric, text, text, text, boolean
) to authenticated;

create or replace function listing_action_private.transition_owned_listing_status_impl(
  p_listing_id uuid,
  p_action text
)
returns public.listings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  caller_role text := coalesce(auth.jwt() ->> 'role', '');
  listing_row public.listings%rowtype;
begin
  if caller_role <> 'authenticated' or caller_id is null then
    raise exception using errcode = '42501', message = 'listing_authentication_required';
  end if;

  select * into listing_row
  from public.listings listing
  where listing.id = p_listing_id
  for update;

  if not found or listing_row.seller_id is distinct from caller_id then
    raise exception using errcode = '42501', message = 'listing_owner_mismatch';
  end if;
  if listing_row.retired_at is not null then
    raise exception using errcode = 'P0001', message = 'listing_is_retired';
  end if;

  if p_action = 'submit_for_review' then
    if listing_row.status not in ('draft', 'rejected') then
      raise exception using errcode = 'P0001', message = 'listing_transition_not_allowed';
    end if;
    perform private.assert_listing_publishable(p_listing_id);
  elsif p_action = 'mark_sold' then
    if listing_row.status <> 'active' then
      raise exception using errcode = 'P0001', message = 'listing_transition_not_allowed';
    end if;
  elsif p_action = 'reopen_for_review' then
    if listing_row.status <> 'sold' then
      raise exception using errcode = 'P0001', message = 'listing_transition_not_allowed';
    end if;
    perform private.assert_listing_publishable(p_listing_id);
  else
    raise exception using errcode = '22023', message = 'listing_action_not_supported';
  end if;

  perform pg_catalog.set_config('app.listing_integrity_context', 'seller_transition', true);
  if p_action = 'mark_sold' then
    update public.listings set status = 'sold'
    where id = p_listing_id returning * into listing_row;
  else
    update public.listings
    set status = 'inactive',
        submitted_for_review_at = statement_timestamp(),
        moderation_feedback = null,
        moderation_reviewed_at = null,
        moderation_reviewed_by = null
    where id = p_listing_id returning * into listing_row;
  end if;
  perform pg_catalog.set_config('app.listing_integrity_context', '', true);

  return listing_row;
end
$function$;

alter function listing_action_private.transition_owned_listing_status_impl(uuid, text) owner to postgres;
revoke all on function listing_action_private.transition_owned_listing_status_impl(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function listing_action_private.transition_owned_listing_status_impl(uuid, text)
  to authenticated;

create or replace function public.transition_owned_listing_status(
  p_listing_id uuid,
  p_action text
)
returns public.listings
language sql
security invoker
set search_path = ''
begin atomic
  select listing_action_private.transition_owned_listing_status_impl(
    p_listing_id,
    p_action
  );
end;

alter function public.transition_owned_listing_status(uuid, text) owner to postgres;
revoke all on function public.transition_owned_listing_status(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.transition_owned_listing_status(uuid, text)
  to authenticated;

create or replace function listing_action_private.save_owned_listing_draft_idempotent_impl(
  p_operation_id uuid,
  p_title text,
  p_listing_id uuid default null,
  p_expected_content_revision bigint default null,
  p_description text default null,
  p_price numeric default null,
  p_category text default null,
  p_condition text default null,
  p_location text default null,
  p_is_negotiable boolean default false
)
returns setof public.listings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  caller_role text := coalesce(auth.jwt() ->> 'role', '');
  command_action text := case
    when p_listing_id is null then 'create_listing_draft'
    else 'save_listing_draft'
  end;
  command_payload jsonb := pg_catalog.jsonb_build_object(
    'listing_id', p_listing_id,
    'expected_content_revision', p_expected_content_revision,
    'title', private.normalize_listing_write_text(p_title),
    'description', nullif(private.normalize_listing_write_text(p_description), ''),
    'price', p_price,
    'category', nullif(private.normalize_listing_write_text(p_category), ''),
    'condition', nullif(private.normalize_listing_write_text(p_condition), ''),
    'location', nullif(private.normalize_listing_write_text(p_location), ''),
    'is_negotiable', coalesce(p_is_negotiable, false)
  );
  command_row listing_action_private.write_command_results%rowtype;
  listing_row public.listings%rowtype;
begin
  if caller_role <> 'authenticated' or caller_id is null then
    raise exception using errcode = '42501', message = 'listing_authentication_required';
  end if;
  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'listing_operation_id_required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text || ':' || p_operation_id::text, 0)
  );
  select * into command_row
  from listing_action_private.write_command_results command
  where command.actor_user_id = caller_id
    and command.operation_id = p_operation_id;

  if found then
    if command_row.action is distinct from command_action
      or command_row.payload is distinct from command_payload then
      raise exception using errcode = '22023', message = 'listing_operation_payload_conflict';
    end if;
    select * into listing_row
    from pg_catalog.jsonb_populate_record(null::public.listings, command_row.result);
    return query select listing_row.*;
    return;
  end if;

  select * into listing_row
  from listing_action_private.save_owned_listing_draft_impl(
    p_title,
    p_listing_id,
    p_expected_content_revision,
    p_description,
    p_price,
    p_category,
    p_condition,
    p_location,
    p_is_negotiable
  );

  insert into listing_action_private.write_command_results(
    actor_user_id, operation_id, action, payload, result
  ) values (
    caller_id, p_operation_id, command_action, command_payload, pg_catalog.to_jsonb(listing_row)
  );
  return query select listing_row.*;
end
$function$;

alter function listing_action_private.save_owned_listing_draft_idempotent_impl(
  uuid, text, uuid, bigint, text, numeric, text, text, text, boolean
) owner to postgres;
revoke all on function listing_action_private.save_owned_listing_draft_idempotent_impl(
  uuid, text, uuid, bigint, text, numeric, text, text, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function listing_action_private.save_owned_listing_draft_idempotent_impl(
  uuid, text, uuid, bigint, text, numeric, text, text, text, boolean
) to authenticated;

create or replace function public.save_owned_listing_draft_idempotent(
  p_operation_id uuid,
  p_title text,
  p_listing_id uuid default null,
  p_expected_content_revision bigint default null,
  p_description text default null,
  p_price numeric default null,
  p_category text default null,
  p_condition text default null,
  p_location text default null,
  p_is_negotiable boolean default false
)
returns setof public.listings
language sql
security invoker
set search_path = ''
begin atomic
  select *
  from listing_action_private.save_owned_listing_draft_idempotent_impl(
    p_operation_id, p_title, p_listing_id, p_expected_content_revision,
    p_description, p_price, p_category, p_condition, p_location, p_is_negotiable
  );
end;

alter function public.save_owned_listing_draft_idempotent(
  uuid, text, uuid, bigint, text, numeric, text, text, text, boolean
) owner to postgres;
revoke all on function public.save_owned_listing_draft_idempotent(
  uuid, text, uuid, bigint, text, numeric, text, text, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.save_owned_listing_draft_idempotent(
  uuid, text, uuid, bigint, text, numeric, text, text, text, boolean
) to authenticated;

create or replace function listing_action_private.replace_owned_listing_images_idempotent_impl(
  p_operation_id uuid,
  p_listing_id uuid,
  p_expected_content_revision bigint,
  p_images jsonb,
  p_apply_listing_fields boolean,
  p_title text,
  p_description text,
  p_price numeric,
  p_category text,
  p_condition text,
  p_location text,
  p_is_negotiable boolean
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  caller_role text := coalesce(auth.jwt() ->> 'role', '');
  command_action text := case
    when p_apply_listing_fields then 'save_listing_draft_with_images'
    else 'replace_listing_images'
  end;
  command_payload jsonb := pg_catalog.jsonb_build_object(
    'listing_id', p_listing_id,
    'expected_content_revision', p_expected_content_revision,
    'images', p_images,
    'title', case when p_apply_listing_fields
      then private.normalize_listing_write_text(p_title) else null end,
    'description', case when p_apply_listing_fields
      then nullif(private.normalize_listing_write_text(p_description), '') else null end,
    'price', case when p_apply_listing_fields then p_price else null end,
    'category', case when p_apply_listing_fields
      then nullif(private.normalize_listing_write_text(p_category), '') else null end,
    'condition', case when p_apply_listing_fields
      then nullif(private.normalize_listing_write_text(p_condition), '') else null end,
    'location', case when p_apply_listing_fields
      then nullif(private.normalize_listing_write_text(p_location), '') else null end,
    'is_negotiable', case when p_apply_listing_fields
      then coalesce(p_is_negotiable, false) else null end
  );
  command_row listing_action_private.write_command_results%rowtype;
  next_revision bigint;
begin
  if caller_role <> 'authenticated' or caller_id is null then
    raise exception using errcode = '42501', message = 'listing_authentication_required';
  end if;
  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'listing_operation_id_required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text || ':' || p_operation_id::text, 0)
  );
  select * into command_row
  from listing_action_private.write_command_results command
  where command.actor_user_id = caller_id
    and command.operation_id = p_operation_id;

  if found then
    if command_row.action is distinct from command_action
      or command_row.payload is distinct from command_payload then
      raise exception using errcode = '22023', message = 'listing_operation_payload_conflict';
    end if;
    return (command_row.result ->> 'content_revision')::bigint;
  end if;

  next_revision := listing_action_private.replace_owned_listing_images_impl(
    p_listing_id, p_expected_content_revision, p_images, p_apply_listing_fields,
    p_title, p_description, p_price, p_category, p_condition, p_location, p_is_negotiable
  );
  insert into listing_action_private.write_command_results(
    actor_user_id, operation_id, action, payload, result
  ) values (
    caller_id,
    p_operation_id,
    command_action,
    command_payload,
    pg_catalog.jsonb_build_object('content_revision', next_revision)
  );
  return next_revision;
end
$function$;

alter function listing_action_private.replace_owned_listing_images_idempotent_impl(
  uuid, uuid, bigint, jsonb, boolean, text, text, numeric, text, text, text, boolean
) owner to postgres;
revoke all on function listing_action_private.replace_owned_listing_images_idempotent_impl(
  uuid, uuid, bigint, jsonb, boolean, text, text, numeric, text, text, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function listing_action_private.replace_owned_listing_images_idempotent_impl(
  uuid, uuid, bigint, jsonb, boolean, text, text, numeric, text, text, text, boolean
) to authenticated;

create or replace function public.replace_owned_listing_images_idempotent(
  p_operation_id uuid,
  p_listing_id uuid,
  p_expected_content_revision bigint,
  p_images jsonb
)
returns bigint
language sql
security invoker
set search_path = ''
begin atomic
  select listing_action_private.replace_owned_listing_images_idempotent_impl(
    p_operation_id, p_listing_id, p_expected_content_revision, p_images,
    false, null, null, null, null, null, null, false
  );
end;

alter function public.replace_owned_listing_images_idempotent(uuid, uuid, bigint, jsonb)
  owner to postgres;
revoke all on function public.replace_owned_listing_images_idempotent(uuid, uuid, bigint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.replace_owned_listing_images_idempotent(uuid, uuid, bigint, jsonb)
  to authenticated;

create or replace function public.save_owned_listing_draft_with_images_idempotent(
  p_operation_id uuid,
  p_listing_id uuid,
  p_expected_content_revision bigint,
  p_images jsonb,
  p_title text,
  p_description text default null,
  p_price numeric default null,
  p_category text default null,
  p_condition text default null,
  p_location text default null,
  p_is_negotiable boolean default false
)
returns bigint
language sql
security invoker
set search_path = ''
begin atomic
  select listing_action_private.replace_owned_listing_images_idempotent_impl(
    p_operation_id, p_listing_id, p_expected_content_revision, p_images,
    true, p_title, p_description, p_price, p_category, p_condition, p_location,
    p_is_negotiable
  );
end;

alter function public.save_owned_listing_draft_with_images_idempotent(
  uuid, uuid, bigint, jsonb, text, text, numeric, text, text, text, boolean
) owner to postgres;
revoke all on function public.save_owned_listing_draft_with_images_idempotent(
  uuid, uuid, bigint, jsonb, text, text, numeric, text, text, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.save_owned_listing_draft_with_images_idempotent(
  uuid, uuid, bigint, jsonb, text, text, numeric, text, text, text, boolean
) to authenticated;

create or replace function listing_action_private.transition_owned_listing_status_idempotent_impl(
  p_operation_id uuid,
  p_listing_id uuid,
  p_action text
)
returns public.listings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  caller_role text := coalesce(auth.jwt() ->> 'role', '');
  command_payload jsonb := pg_catalog.jsonb_build_object(
    'listing_id', p_listing_id,
    'action', p_action
  );
  command_row listing_action_private.write_command_results%rowtype;
  listing_row public.listings%rowtype;
begin
  if caller_role <> 'authenticated' or caller_id is null then
    raise exception using errcode = '42501', message = 'listing_authentication_required';
  end if;
  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'listing_operation_id_required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text || ':' || p_operation_id::text, 0)
  );
  select * into command_row
  from listing_action_private.write_command_results command
  where command.actor_user_id = caller_id
    and command.operation_id = p_operation_id;
  if found then
    if command_row.action is distinct from 'transition_listing_status'
      or command_row.payload is distinct from command_payload then
      raise exception using errcode = '22023', message = 'listing_operation_payload_conflict';
    end if;
    select * into listing_row
    from pg_catalog.jsonb_populate_record(null::public.listings, command_row.result);
    return listing_row;
  end if;

  listing_row := listing_action_private.transition_owned_listing_status_impl(
    p_listing_id, p_action
  );
  insert into listing_action_private.write_command_results(
    actor_user_id, operation_id, action, payload, result
  ) values (
    caller_id,
    p_operation_id,
    'transition_listing_status',
    command_payload,
    pg_catalog.to_jsonb(listing_row)
  );
  return listing_row;
end
$function$;

alter function listing_action_private.transition_owned_listing_status_idempotent_impl(
  uuid, uuid, text
) owner to postgres;
revoke all on function listing_action_private.transition_owned_listing_status_idempotent_impl(
  uuid, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function listing_action_private.transition_owned_listing_status_idempotent_impl(
  uuid, uuid, text
) to authenticated;

create or replace function public.transition_owned_listing_status_idempotent(
  p_operation_id uuid,
  p_listing_id uuid,
  p_action text
)
returns public.listings
language sql
security invoker
set search_path = ''
begin atomic
  select listing_action_private.transition_owned_listing_status_idempotent_impl(
    p_operation_id, p_listing_id, p_action
  );
end;

alter function public.transition_owned_listing_status_idempotent(uuid, uuid, text)
  owner to postgres;
revoke all on function public.transition_owned_listing_status_idempotent(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.transition_owned_listing_status_idempotent(uuid, uuid, text)
  to authenticated;

-- Retirement removes the image metadata before Storage cleanup can run. Keep
-- the exact pre-retirement paths in the actor-scoped command result so a
-- client that loses the response can replay the same operation after the
-- listing has already been scrubbed and still finish object cleanup.
create or replace function listing_action_private.retire_owned_listing_idempotent_impl(
  p_operation_id uuid,
  p_listing_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  caller_role text := coalesce(auth.jwt() ->> 'role', '');
  command_payload jsonb := pg_catalog.jsonb_build_object('listing_id', p_listing_id);
  command_row listing_action_private.write_command_results%rowtype;
  listing_row public.listings%rowtype;
  storage_paths jsonb;
  canonical_result jsonb;
begin
  if caller_role <> 'authenticated' or caller_id is null then
    raise exception using errcode = '42501', message = 'listing_authentication_required';
  end if;
  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'listing_operation_id_required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text || ':' || p_operation_id::text, 0)
  );
  select * into command_row
  from listing_action_private.write_command_results command
  where command.actor_user_id = caller_id
    and command.operation_id = p_operation_id;
  if found then
    if command_row.action is distinct from 'retire_listing'
      or command_row.payload is distinct from command_payload then
      raise exception using errcode = '22023', message = 'listing_operation_payload_conflict';
    end if;
    return command_row.result;
  end if;

  -- Legacy image DELETE/UPDATE statements acquire their target row before the
  -- parent-row touch. Follow the same deterministic image-id -> parent order
  -- so retirement cannot create a parent/image deadlock during the foundation
  -- compatibility window.
  perform image.id
  from public.listing_images image
  where image.listing_id = p_listing_id
  order by image.id
  for update;

  select * into listing_row
  from public.listings listing
  where listing.id = p_listing_id
  for update;
  if not found or listing_row.seller_id is distinct from caller_id then
    raise exception using errcode = '42501', message = 'listing_owner_mismatch';
  end if;
  if listing_row.retired_at is not null then
    raise exception using errcode = 'P0001', message = 'listing_is_retired';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(image.storage_path order by image.position, image.id)
      filter (where image.storage_path is not null),
    '[]'::jsonb
  ) into storage_paths
  from public.listing_images image
  where image.listing_id = p_listing_id;

  perform pg_catalog.set_config('app.listing_integrity_context', 'retirement', true);
  delete from public.listing_images image where image.listing_id = p_listing_id;
  update public.listings
  set slug = 'retired-' || id::text,
      title = 'Deleted listing',
      description = '',
      price = 0,
      previous_price = null,
      location = null,
      is_negotiable = false,
      status = 'inactive',
      submitted_for_review_at = null,
      retired_at = pg_catalog.statement_timestamp(),
      content_revision = content_revision + 1
  where id = p_listing_id
  returning * into listing_row;
  perform pg_catalog.set_config('app.listing_integrity_context', '', true);

  canonical_result := pg_catalog.jsonb_build_object(
    'listing_id', listing_row.id,
    'retired_at', listing_row.retired_at,
    'content_revision', listing_row.content_revision,
    'storage_paths', storage_paths
  );
  insert into listing_action_private.write_command_results(
    actor_user_id, operation_id, action, payload, result
  ) values (
    caller_id, p_operation_id, 'retire_listing', command_payload, canonical_result
  );
  return canonical_result;
end
$function$;

alter function listing_action_private.retire_owned_listing_idempotent_impl(uuid, uuid)
  owner to postgres;
revoke all on function listing_action_private.retire_owned_listing_idempotent_impl(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function listing_action_private.retire_owned_listing_idempotent_impl(uuid, uuid)
  to authenticated;

create or replace function public.retire_owned_listing_idempotent(
  p_operation_id uuid,
  p_listing_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
begin atomic
  select listing_action_private.retire_owned_listing_idempotent_impl(
    p_operation_id, p_listing_id
  );
end;

alter function public.retire_owned_listing_idempotent(uuid, uuid) owner to postgres;
revoke all on function public.retire_owned_listing_idempotent(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.retire_owned_listing_idempotent(uuid, uuid)
  to authenticated;

comment on function public.save_owned_listing_draft(
  text, uuid, bigint, text, numeric, text, text, text, boolean
) is
  'Authenticated owner-only draft save. Existing rows are revision-checked and content edits demote active, sold, or pending listings to draft.';

comment on function private.assert_listing_publishable(uuid) is
  'Row-locking readiness assertion shared by seller submission and trusted moderator approval. Requires complete fields and 1-10 valid listing images.';
