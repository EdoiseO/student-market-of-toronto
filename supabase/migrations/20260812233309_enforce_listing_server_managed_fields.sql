-- Keep marketplace ranking and system timestamps outside seller-controlled
-- Data API writes. Existing owner-bound RLS remains the row-level control; the
-- trigger is defense in depth if table grants are broadened later.
create or replace function public.enforce_listing_server_managed_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  caller_role text := coalesce(auth.role(), '');
  integrity_context text := coalesce(
    pg_catalog.current_setting('app.listing_integrity_context', true),
    ''
  );
begin
  if caller_role = 'service_role' then
    return new;
  end if;

  if caller_role <> 'authenticated' or caller_id is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.is_featured := false;
    new.view_count := 0;
    new.previous_price := null;
    new.created_at := pg_catalog.statement_timestamp();
    new.updated_at := new.created_at;
    return new;
  end if;

  if new.is_featured is distinct from old.is_featured
    or new.view_count is distinct from old.view_count
    or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = '42501',
      message = 'listing_ranking_fields_are_server_managed';
  end if;

  if new.previous_price is distinct from old.previous_price
    and integrity_context <> 'retirement' then
    raise exception using
      errcode = '42501',
      message = 'listing_previous_price_is_server_managed';
  end if;

  -- A price change records the immediately preceding price atomically. The
  -- listing-integrity trigger runs first and already treats the price itself
  -- as moderated content; this trigger only derives its trusted history.
  if new.price is distinct from old.price and integrity_context = 'retirement' then
    new.previous_price := null;
  elsif new.price is distinct from old.price then
    new.previous_price := old.price;
  end if;

  -- Ignore any caller-supplied timestamp and update it authoritatively for all
  -- authenticated seller/RPC changes.
  new.updated_at := pg_catalog.statement_timestamp();

  return new;
end;
$$;

drop trigger if exists enforce_listing_server_managed_fields on public.listings;
create trigger enforce_listing_server_managed_fields
before insert or update on public.listings
for each row execute function public.enforce_listing_server_managed_fields();

revoke all on function public.enforce_listing_server_managed_fields()
from public, anon, authenticated;

-- Table-level INSERT/UPDATE privileges override column revocations. Replace
-- them with the exact seller-authored fields used by create/edit flows. Trusted
-- SECURITY DEFINER RPCs and service-role routes keep their owner privileges.
revoke insert, update on table public.listings from anon, authenticated;

grant insert (
  seller_id,
  slug,
  title,
  description,
  price,
  category,
  condition,
  location,
  status,
  is_negotiable
) on table public.listings to authenticated;

grant update (
  slug,
  title,
  description,
  price,
  category,
  condition,
  location,
  is_negotiable
) on table public.listings to authenticated;

-- Keep public substring search index-backed (including punctuation) while
-- providing a token-indexed fallback for one- and two-character terms.
create schema if not exists extensions;
grant usage on schema extensions to public, anon, authenticated, service_role;
create extension if not exists pg_trgm with schema extensions;

alter table public.listings
  add column if not exists catalog_search_text text
  generated always as (
    pg_catalog.lower(
      coalesce(title, '') || ' ' ||
      coalesce(description, '') || ' ' ||
      coalesce(category, '') || ' ' ||
      coalesce(location, '')
    )
  ) stored;

alter table public.listings
  add column if not exists catalog_search_vector tsvector
  generated always as (
    pg_catalog.to_tsvector(
      'simple'::pg_catalog.regconfig,
      pg_catalog.lower(
        coalesce(title, '') || ' ' ||
        coalesce(description, '') || ' ' ||
        coalesce(category, '') || ' ' ||
        coalesce(location, '')
      )
    )
  ) stored;

create index if not exists listings_active_catalog_search_trgm_idx
  on public.listings using gin (catalog_search_text extensions.gin_trgm_ops)
  where status = 'active' and retired_at is null;

create index if not exists listings_active_catalog_search_vector_idx
  on public.listings using gin (catalog_search_vector)
  where status = 'active' and retired_at is null;

create index if not exists listings_active_created_desc_id_idx
  on public.listings (created_at desc, id asc)
  where status = 'active' and retired_at is null;

create index if not exists listings_active_created_asc_id_idx
  on public.listings (created_at asc, id asc)
  where status = 'active' and retired_at is null;

create index if not exists listings_active_price_asc_id_idx
  on public.listings (price asc, id asc)
  where status = 'active' and retired_at is null;

create index if not exists listings_active_price_desc_id_idx
  on public.listings (price desc, id asc)
  where status = 'active' and retired_at is null;

create index if not exists listings_active_condition_created_idx
  on public.listings (condition, created_at desc, id asc)
  where status = 'active' and retired_at is null;

create index if not exists listings_active_category_created_idx
  on public.listings (category, created_at desc, id asc)
  where status = 'active' and retired_at is null;

create index if not exists listings_active_featured_created_idx
  on public.listings (created_at desc, id asc)
  where status = 'active' and retired_at is null and is_featured;

create index if not exists listings_active_negotiable_created_idx
  on public.listings (created_at desc, id asc)
  where status = 'active' and retired_at is null and is_negotiable;

create index if not exists listings_active_price_drop_created_idx
  on public.listings (created_at desc, id asc)
  where status = 'active'
    and retired_at is null
    and previous_price is not null
    and previous_price > price;

-- Search filtering includes a column-to-column price-drop predicate that the
-- REST filter grammar cannot express. First read at most 1,201 rows from the
-- indexed newest-active order; every text/filter/sort/count operation then runs
-- only over the newest 1,200-row public-search horizon. The sentinel row makes
-- that product horizon explicit to the UI without any unbounded exact count.
create or replace function public.search_active_listing_page(
  p_query text default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_condition text default null,
  p_tag text default null,
  p_sort text default 'new-old',
  p_offset integer default 0,
  p_limit integer default 24
)
returns table (listing_ids uuid[], total_count bigint, is_count_capped boolean)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  normalized_query text := pg_catalog.left(
    pg_catalog.lower(pg_catalog.btrim(coalesce(p_query, ''))),
    80
  );
  normalized_condition text := pg_catalog.left(
    pg_catalog.btrim(coalesce(p_condition, '')),
    40
  );
  normalized_tag text := case
    when p_tag in ('featured', 'negotiable', 'new', 'price-drop') then p_tag
    else ''
  end;
  search_pattern text;
  search_clause text := 'true';
  order_clause text;
  page_limit integer := least(
    greatest(coalesce(p_limit, 24), 1),
    60
  );
  page_offset integer := least(
    greatest(coalesce(p_offset, 0), 0),
    1200
  );
  candidate_limit constant integer := 1201;
  statement_sql text;
begin
  if normalized_query <> '' then
    if pg_catalog.char_length(normalized_query) < 3 then
      search_clause :=
        'listing.catalog_search_vector @@ pg_catalog.plainto_tsquery(''simple''::pg_catalog.regconfig, $1)';
    else
      search_pattern := '%' ||
        pg_catalog.replace(
          pg_catalog.replace(
            pg_catalog.replace(
              normalized_query,
              pg_catalog.chr(92),
              pg_catalog.chr(92) || pg_catalog.chr(92)
            ),
            '%',
            pg_catalog.chr(92) || '%'
          ),
          '_',
          pg_catalog.chr(92) || '_'
        ) || '%';
      search_clause := 'listing.catalog_search_text like $2 escape E''\\''';
    end if;
  end if;

  order_clause := case p_sort
    when 'old-new' then 'listing.created_at asc, listing.id asc'
    when 'price-low-high' then 'listing.price asc, listing.id asc'
    when 'price-high-low' then 'listing.price desc, listing.id asc'
    else 'listing.created_at desc, listing.id asc'
  end;

  statement_sql := pg_catalog.format(
    $query$
      with horizon_scan as materialized (
        select
          listing.id,
          listing.created_at,
          listing.price,
          listing.previous_price,
          listing.condition,
          listing.is_featured,
          listing.is_negotiable,
          listing.catalog_search_text,
          listing.catalog_search_vector,
          pg_catalog.row_number() over (
            order by listing.created_at desc, listing.id asc
          )::bigint as horizon_ordinal
        from public.listings listing
        where listing.status = 'active'
          and listing.retired_at is null
        order by listing.created_at desc, listing.id asc
        limit $7
      ),
      candidates as materialized (
        select
          listing.id,
          pg_catalog.row_number() over (order by %1$s)::bigint as ordinal
        from horizon_scan listing
        where listing.horizon_ordinal <= 1200
          and (%2$s)
          and ($3 is null or listing.price >= $3)
          and ($4 is null or listing.price <= $4)
          and ($5 = '' or listing.condition = $5)
          and (
            $6 = ''
            or ($6 = 'featured' and listing.is_featured)
            or ($6 = 'negotiable' and listing.is_negotiable)
            or (
              $6 = 'new'
              and listing.created_at >= pg_catalog.statement_timestamp() - interval '7 days'
            )
            or (
              $6 = 'price-drop'
              and listing.previous_price is not null
              and listing.previous_price > listing.price
            )
          )
        order by %1$s
      ),
      page as (
        select candidate.id, candidate.ordinal
        from candidates candidate
        where candidate.ordinal <= 1200
        order by candidate.ordinal
        limit $8
        offset $9
      ),
      result_counts as (
        select
          (select pg_catalog.count(*)::bigint from candidates) as matched_count,
          (select pg_catalog.count(*)::bigint from horizon_scan) as scanned_count
      )
      select
        coalesce(
          pg_catalog.array_agg(page.id order by page.ordinal)
            filter (where page.id is not null),
          '{}'::uuid[]
        ),
        result_counts.matched_count,
        result_counts.scanned_count > 1200
      from result_counts
      left join page on true
      group by result_counts.matched_count, result_counts.scanned_count
    $query$,
    order_clause,
    search_clause
  );

  return query execute statement_sql using
    normalized_query,
    search_pattern,
    p_min_price,
    p_max_price,
    normalized_condition,
    normalized_tag,
    candidate_limit,
    page_limit,
    page_offset;
end;
$function$;

revoke all on function public.search_active_listing_page(
  text, numeric, numeric, text, text, text, integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.search_active_listing_page(
  text, numeric, numeric, text, text, text, integer, integer
) to anon, authenticated, service_role;

-- Category landing sections need exact featured/trending/recent ordering, but
-- only a small ID window. The hard maximum prevents direct callers from
-- turning this public helper back into an unbounded catalog read.
create or replace function public.get_active_category_listing_ids(
  p_categories text[],
  p_mode text,
  p_limit integer default 6
)
returns table (listing_id uuid)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if coalesce(pg_catalog.array_ndims(p_categories), 1) <> 1
    or coalesce(pg_catalog.cardinality(p_categories), 0) > 16 then
    raise exception using
      errcode = '22023',
      message = 'category_filter_too_large';
  end if;

  return query
  with requested_categories as materialized (
    select distinct requested.category
    from pg_catalog.unnest(coalesce(p_categories, '{}'::text[]))
      as requested(category)
    where requested.category is not null and requested.category <> ''
    limit 16
  ),
  category_horizon as materialized (
    select candidate.id, candidate.created_at, candidate.view_count, candidate.is_featured
    from requested_categories requested
    cross join lateral (
      select listing.id, listing.created_at, listing.view_count, listing.is_featured
      from public.listings listing
      where listing.status = 'active'
        and listing.retired_at is null
        and listing.category = requested.category
      order by listing.created_at desc, listing.id asc
      limit 96
    ) candidate
  )
  select candidate.id
  from category_horizon candidate
  where p_mode in ('featured', 'trending', 'recent')
    and (p_mode <> 'featured' or candidate.is_featured)
  order by
    case when p_mode = 'trending' then
      candidate.view_count::numeric
      / greatest(
        extract(
          epoch from (pg_catalog.statement_timestamp() - candidate.created_at)
        ) / 86400,
        1
      )
    end desc,
    candidate.created_at desc,
    candidate.id asc
  limit least(greatest(coalesce(p_limit, 6), 1), 24);
end;
$function$;

revoke all on function public.get_active_category_listing_ids(text[], text, integer)
from public, anon, authenticated, service_role;
grant execute on function public.get_active_category_listing_ids(text[], text, integer)
to anon, authenticated, service_role;

-- Serialize image-row creation on the parent listing so concurrent direct
-- Data API inserts cannot exceed the product's ten-image limit. The trigger
-- also binds each row to the authenticated seller, the canonical bucket path,
-- and an already-uploaded object owned by that seller.
create schema if not exists private;
-- Authenticated schema USAGE is required by the message-media Storage policy
-- helpers installed by 20260812142916. Individual private functions remain
-- non-executable unless a migration grants them explicitly.
revoke usage on schema private from public, anon, service_role;
grant usage on schema private to authenticated;

create index if not exists listing_images_listing_position_id_idx
  on public.listing_images (listing_id, position, id);

alter table public.listing_images
  drop constraint if exists listing_images_position_range;
alter table public.listing_images
  add constraint listing_images_position_range
  check (position is not null and position between 0 and 9)
  not valid;
alter table public.listing_images
  validate constraint listing_images_position_range;

do $migration$
begin
  if exists (
    select 1
    from public.listing_images image
    group by image.listing_id
    having pg_catalog.count(*) > 10
  ) then
    raise exception using
      errcode = '23514',
      message = 'existing_listing_image_limit_exceeded';
  end if;
end;
$migration$;

-- Pre-apply audit: do not install controls over an already-inconsistent legacy
-- data set. Operators must repair the named rows and rerun the migration; no
-- image metadata is silently rewritten or detached here.
do $migration$
begin
  if exists (
    select 1
    from public.listing_images image
    left join public.listings listing on listing.id = image.listing_id
    left join storage.objects object
      on object.bucket_id = 'listing-images'
      and object.name = image.storage_path
    where listing.id is null
      or image.storage_path is null
      or pg_catalog.array_length(pg_catalog.string_to_array(image.storage_path, '/'), 1) is distinct from 3
      or pg_catalog.split_part(image.storage_path, '/', 1) <> listing.seller_id::text
      or pg_catalog.split_part(image.storage_path, '/', 2) <> image.listing_id::text
      or pg_catalog.split_part(image.storage_path, '/', 3) in ('', '.', '..')
      or pg_catalog.strpos(image.storage_path, pg_catalog.chr(92)) > 0
      or pg_catalog.strpos(image.storage_path, '%') > 0
      or pg_catalog.strpos(image.storage_path, '?') > 0
      or pg_catalog.strpos(image.storage_path, '#') > 0
      or image.image_url is null
      or pg_catalog.strpos(
        image.image_url,
        '/storage/v1/object/public/listing-images/' || image.storage_path
      ) = 0
      or object.id is null
      or object.owner_id is distinct from listing.seller_id::text
  ) then
    raise exception using
      errcode = '23514',
      message = 'existing_listing_image_integrity_violation';
  end if;
end;
$migration$;

create or replace function private.enforce_listing_image_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  caller_role text := coalesce(auth.jwt() ->> 'role', '');
  new_listing_owner uuid;
  old_listing_owner uuid;
  current_image_count bigint;
begin
  -- Lock both parents in deterministic UUID order for a move. The same parent
  -- lock serializes inserts and makes the subsequent count transactional.
  if tg_op = 'UPDATE' and new.listing_id is distinct from old.listing_id then
    perform listing.id
    from public.listings listing
    where listing.id = any(array[new.listing_id, old.listing_id])
    order by listing.id
    for update;
  else
    perform listing.id
    from public.listings listing
    where listing.id = new.listing_id
    for update;
  end if;

  select listing.seller_id
  into new_listing_owner
  from public.listings listing
  where listing.id = new.listing_id;

  if new_listing_owner is null then
    raise exception using
      errcode = '23503',
      message = 'listing_image_parent_not_found';
  end if;

  if tg_op = 'UPDATE' and new.listing_id is distinct from old.listing_id then
    select listing.seller_id
    into old_listing_owner
    from public.listings listing
    where listing.id = old.listing_id;

    if old_listing_owner is null then
      raise exception using
        errcode = '23503',
        message = 'listing_image_original_parent_not_found';
    end if;
  else
    old_listing_owner := new_listing_owner;
  end if;

  if caller_role <> 'service_role'
    and (
      caller_role <> 'authenticated'
      or caller_id is null
      or caller_id <> new_listing_owner
      or caller_id <> old_listing_owner
    ) then
    raise exception using
      errcode = '42501',
      message = 'listing_image_owner_mismatch';
  end if;

  if new.position is null or new.position < 0 or new.position > 9 then
    raise exception using
      errcode = '23514',
      message = 'listing_image_position_out_of_range';
  end if;

  if tg_op = 'INSERT'
    or new.listing_id is distinct from old.listing_id
    or new.storage_path is distinct from old.storage_path
    or new.image_url is distinct from old.image_url then
    if new.storage_path is null
      or pg_catalog.array_length(pg_catalog.string_to_array(new.storage_path, '/'), 1) is distinct from 3
      or pg_catalog.split_part(new.storage_path, '/', 1) <> new_listing_owner::text
      or pg_catalog.split_part(new.storage_path, '/', 2) <> new.listing_id::text
      or pg_catalog.split_part(new.storage_path, '/', 3) in ('', '.', '..')
      or pg_catalog.strpos(new.storage_path, pg_catalog.chr(92)) > 0
      or pg_catalog.strpos(new.storage_path, '%') > 0
      or pg_catalog.strpos(new.storage_path, '?') > 0
      or pg_catalog.strpos(new.storage_path, '#') > 0 then
      raise exception using
        errcode = '23514',
        message = 'listing_image_storage_path_mismatch';
    end if;

    if new.image_url is null
      or pg_catalog.strpos(
        new.image_url,
        '/storage/v1/object/public/listing-images/' || new.storage_path
      ) = 0 then
      raise exception using
        errcode = '23514',
        message = 'listing_image_url_path_mismatch';
    end if;

    if not exists (
      select 1
      from storage.objects object
      where object.bucket_id = 'listing-images'
        and object.name = new.storage_path
        and (
          caller_role = 'service_role'
          or object.owner_id = caller_id::text
        )
    ) then
      raise exception using
        errcode = '23503',
        message = 'listing_image_storage_object_not_found_or_owned';
    end if;
  end if;

  if tg_op = 'INSERT' or new.listing_id is distinct from old.listing_id then
    select pg_catalog.count(*)
    into current_image_count
    from public.listing_images image
    where image.listing_id = new.listing_id;

    if current_image_count >= 10 then
      raise exception using
        errcode = '23514',
        message = 'listing_image_limit_exceeded';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists enforce_listing_image_integrity on public.listing_images;
create trigger enforce_listing_image_integrity
before insert or update of listing_id, storage_path, image_url, position
on public.listing_images
for each row execute function private.enforce_listing_image_integrity();

revoke all on function private.enforce_listing_image_integrity()
from public, anon, authenticated, service_role;
