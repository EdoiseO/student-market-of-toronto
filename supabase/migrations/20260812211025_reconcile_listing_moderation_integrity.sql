-- Reconciliation migration: production advanced past 20260812112706 without
-- recording its listing-integrity objects. Keep this migration idempotent so
-- environments that did apply the earlier migration can safely converge too.

alter table public.listings
  add column if not exists content_revision bigint not null default 1
    check (content_revision > 0);

alter table public.listings
  add column if not exists retired_at timestamptz;

-- Retire the pre-revision moderation path and workflow trigger. Leaving either
-- callable would bypass the content-revision comparison or conflict with the
-- replacement trigger during service-role decisions.
drop function if exists public.moderate_listing_decision(uuid, text, text);

drop trigger if exists trg_enforce_listing_review_workflow on public.listings;
drop function if exists public.enforce_listing_review_workflow();

comment on column public.listings.content_revision is
  'Monotonic revision of seller-visible listing content, including listing images.';
comment on column public.listings.retired_at is
  'Immutable seller-retirement marker; retired rows remain only to preserve audit references.';

create or replace function public.enforce_listing_integrity()
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
  content_changed boolean;
begin
  if tg_op = 'INSERT' then
    if caller_role = 'anon' then
      raise exception using
        errcode = '42501',
        message = 'listing_authentication_required';
    end if;

    if caller_role = 'authenticated' then
      if caller_id is null or new.seller_id is distinct from caller_id then
        raise exception using
          errcode = '42501',
          message = 'listing_owner_mismatch';
      end if;

      if new.status not in ('draft', 'inactive') then
        raise exception using
          errcode = '42501',
          message = 'listing_initial_status_not_allowed';
      end if;

      new.content_revision := 1;
      new.retired_at := null;
      new.moderation_feedback := null;
      new.moderation_reviewed_at := null;
      new.moderation_reviewed_by := null;

      if new.status = 'inactive' then
        new.submitted_for_review_at := pg_catalog.statement_timestamp();
      else
        new.submitted_for_review_at := null;
      end if;
    end if;

    return new;
  end if;

  if caller_role = 'service_role' then
    return new;
  end if;

  if old.retired_at is not null then
    raise exception using
      errcode = '42501',
      message = 'listing_is_retired';
  end if;

  if integrity_context <> 'retirement'
    and new.retired_at is distinct from old.retired_at then
    raise exception using
      errcode = '42501',
      message = 'listing_retirement_is_server_managed';
  end if;

  if integrity_context = 'seller_transition' then
    if caller_role <> 'authenticated'
      or caller_id is null
      or old.seller_id is distinct from caller_id
      or new.seller_id is distinct from caller_id then
      raise exception using
        errcode = '42501',
        message = 'listing_owner_mismatch';
    end if;

    new.content_revision := old.content_revision;
    return new;
  end if;

  if integrity_context = 'retirement' then
    if caller_role <> 'authenticated'
      or caller_id is null
      or old.seller_id is distinct from caller_id
      or new.seller_id is distinct from caller_id then
      raise exception using
        errcode = '42501',
        message = 'listing_owner_mismatch';
    end if;

    if new.retired_at is null then
      raise exception using
        errcode = '42501',
        message = 'listing_retirement_marker_required';
    end if;

    new.content_revision := old.content_revision + 1;
    return new;
  end if;

  if integrity_context = 'image_change' then
    if caller_role <> 'authenticated'
      or caller_id is null
      or old.seller_id is distinct from caller_id
      or new.seller_id is distinct from caller_id then
      raise exception using
        errcode = '42501',
        message = 'listing_owner_mismatch';
    end if;

    new.content_revision := old.content_revision + 1;

    if old.status in ('active', 'sold', 'inactive') then
      new.status := 'inactive';
      new.submitted_for_review_at := pg_catalog.statement_timestamp();
      new.moderation_feedback := null;
      new.moderation_reviewed_at := null;
      new.moderation_reviewed_by := null;
    end if;

    return new;
  end if;

  if caller_role = 'anon' or caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'listing_authentication_required';
  end if;

  if old.seller_id is distinct from caller_id
    or new.seller_id is distinct from caller_id then
    raise exception using
      errcode = '42501',
      message = 'listing_owner_mismatch';
  end if;

  content_changed :=
    new.slug is distinct from old.slug
    or new.title is distinct from old.title
    or new.description is distinct from old.description
    or new.price is distinct from old.price
    or new.previous_price is distinct from old.previous_price
    or new.category is distinct from old.category
    or new.condition is distinct from old.condition
    or new.location is distinct from old.location
    or new.is_negotiable is distinct from old.is_negotiable;

  if new.content_revision is distinct from old.content_revision then
    raise exception using
      errcode = '42501',
      message = 'listing_revision_is_server_managed';
  end if;

  if new.moderation_feedback is distinct from old.moderation_feedback
    or new.moderation_reviewed_at is distinct from old.moderation_reviewed_at
    or new.moderation_reviewed_by is distinct from old.moderation_reviewed_by then
    raise exception using
      errcode = '42501',
      message = 'listing_moderation_metadata_is_server_managed';
  end if;

  if not content_changed then
    if new.status is distinct from old.status
      or new.submitted_for_review_at is distinct from old.submitted_for_review_at then
      raise exception using
        errcode = '42501',
        message = 'listing_status_transition_requires_rpc';
    end if;

    return new;
  end if;

  if new.status is distinct from old.status
    and not (old.status in ('active', 'sold', 'inactive') and new.status = 'inactive') then
    raise exception using
      errcode = '42501',
      message = 'listing_status_transition_requires_rpc';
  end if;

  if new.submitted_for_review_at is distinct from old.submitted_for_review_at then
    raise exception using
      errcode = '42501',
      message = 'listing_submission_timestamp_is_server_managed';
  end if;

  new.content_revision := old.content_revision + 1;

  if old.status in ('active', 'sold', 'inactive') then
    new.status := 'inactive';
    new.submitted_for_review_at := pg_catalog.statement_timestamp();
    new.moderation_feedback := null;
    new.moderation_reviewed_at := null;
    new.moderation_reviewed_by := null;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_listing_integrity on public.listings;
create trigger enforce_listing_integrity
before insert or update on public.listings
for each row execute function public.enforce_listing_integrity();

revoke all on function public.enforce_listing_integrity() from public, anon, authenticated;

create or replace function public.prevent_untrusted_listing_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and coalesce(
      pg_catalog.current_setting('app.listing_integrity_context', true),
      ''
    ) <> 'discard_draft' then
    raise exception using
      errcode = '42501',
      message = 'listing_delete_requires_retirement_rpc';
  end if;

  return old;
end;
$$;

drop trigger if exists prevent_untrusted_listing_delete on public.listings;
create trigger prevent_untrusted_listing_delete
before delete on public.listings
for each row execute function public.prevent_untrusted_listing_delete();

revoke all on function public.prevent_untrusted_listing_delete()
from public, anon, authenticated;

create or replace function public.touch_listing_revision_for_image_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_listing_id uuid;
  integrity_context text := coalesce(
    pg_catalog.current_setting('app.listing_integrity_context', true),
    ''
  );
begin
  if integrity_context in ('discard_draft', 'retirement') then
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

  update public.listings
  set content_revision = content_revision + 1
  where id = affected_listing_id;

  if tg_op = 'UPDATE' and new.listing_id is distinct from old.listing_id then
    update public.listings
    set content_revision = content_revision + 1
    where id = old.listing_id;
  end if;

  return null;
end;
$$;

drop trigger if exists touch_listing_revision_for_image_change on public.listing_images;
create trigger touch_listing_revision_for_image_change
after insert or update or delete on public.listing_images
for each row execute function public.touch_listing_revision_for_image_change();

revoke all on function public.touch_listing_revision_for_image_change()
from public, anon, authenticated;

create or replace function public.transition_owned_listing_status(
  p_listing_id uuid,
  p_action text
)
returns public.listings
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  listing_row public.listings%rowtype;
begin
  if auth.role() <> 'authenticated' or caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'listing_authentication_required';
  end if;

  select *
  into listing_row
  from public.listings
  where id = p_listing_id
  for update;

  if not found or listing_row.seller_id is distinct from caller_id then
    raise exception using
      errcode = '42501',
      message = 'listing_owner_mismatch';
  end if;

  if listing_row.retired_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'listing_is_retired';
  end if;

  if p_action = 'submit_for_review' then
    if listing_row.status not in ('draft', 'rejected') then
      raise exception using
        errcode = 'P0001',
        message = 'listing_transition_not_allowed';
    end if;
  elsif p_action = 'mark_sold' then
    if listing_row.status <> 'active' then
      raise exception using
        errcode = 'P0001',
        message = 'listing_transition_not_allowed';
    end if;
  elsif p_action = 'reopen_for_review' then
    if listing_row.status <> 'sold' then
      raise exception using
        errcode = 'P0001',
        message = 'listing_transition_not_allowed';
    end if;
  else
    raise exception using
      errcode = '22023',
      message = 'listing_action_not_supported';
  end if;

  perform pg_catalog.set_config('app.listing_integrity_context', 'seller_transition', true);

  if p_action = 'mark_sold' then
    update public.listings
    set status = 'sold'
    where id = p_listing_id
    returning * into listing_row;
  else
    update public.listings
    set
      status = 'inactive',
      submitted_for_review_at = pg_catalog.statement_timestamp(),
      moderation_feedback = null,
      moderation_reviewed_at = null,
      moderation_reviewed_by = null
    where id = p_listing_id
    returning * into listing_row;
  end if;

  return listing_row;
end;
$$;

revoke all on function public.transition_owned_listing_status(uuid, text)
from public, anon;
grant execute on function public.transition_owned_listing_status(uuid, text)
to authenticated;

create or replace function public.discard_owned_listing_draft(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  listing_row public.listings%rowtype;
  has_dependencies boolean;
begin
  if auth.role() <> 'authenticated' or caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'listing_authentication_required';
  end if;

  select *
  into listing_row
  from public.listings
  where id = p_listing_id
  for update;

  if not found or listing_row.seller_id is distinct from caller_id then
    raise exception using
      errcode = '42501',
      message = 'listing_owner_mismatch';
  end if;

  if listing_row.retired_at is not null
    or listing_row.status not in ('draft', 'inactive')
    or listing_row.moderation_reviewed_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'listing_discard_not_allowed';
  end if;

  select
    exists (
      select 1 from public.reports where listing_id = p_listing_id
    )
    or exists (
      select 1 from public.listing_moderation_history where listing_id = p_listing_id
    )
    or exists (
      select 1 from public.conversations where listing_id = p_listing_id
    )
  into has_dependencies;

  if has_dependencies then
    raise exception using
      errcode = 'P0001',
      message = 'listing_discard_has_dependencies';
  end if;

  perform pg_catalog.set_config('app.listing_integrity_context', 'discard_draft', true);

  delete from public.listing_images
  where listing_id = p_listing_id;

  delete from public.listings
  where id = p_listing_id;
end;
$$;

revoke all on function public.discard_owned_listing_draft(uuid) from public, anon;
grant execute on function public.discard_owned_listing_draft(uuid)
to authenticated;

create or replace function public.retire_owned_listing(p_listing_id uuid)
returns public.listings
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  listing_row public.listings%rowtype;
begin
  if auth.role() <> 'authenticated' or caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'listing_authentication_required';
  end if;

  select *
  into listing_row
  from public.listings
  where id = p_listing_id
  for update;

  if not found or listing_row.seller_id is distinct from caller_id then
    raise exception using
      errcode = '42501',
      message = 'listing_owner_mismatch';
  end if;

  if listing_row.retired_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'listing_is_retired';
  end if;

  perform pg_catalog.set_config('app.listing_integrity_context', 'retirement', true);

  delete from public.listing_images
  where listing_id = p_listing_id;

  update public.listings
  set
    slug = 'retired-' || id::text,
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

  return listing_row;
end;
$$;

revoke all on function public.retire_owned_listing(uuid) from public, anon;
grant execute on function public.retire_owned_listing(uuid) to authenticated;

create or replace function public.decide_listing_moderation(
  p_listing_id uuid,
  p_expected_content_revision bigint,
  p_expected_submitted_for_review_at timestamptz,
  p_action text,
  p_feedback text,
  p_moderator_id uuid
)
returns public.listings
language plpgsql
security definer
set search_path = ''
as $$
declare
  listing_row public.listings%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'listing_moderation_service_role_required';
  end if;

  if p_action not in ('approved', 'rejected') then
    raise exception using
      errcode = '22023',
      message = 'listing_moderation_action_not_supported';
  end if;

  if p_moderator_id is null then
    raise exception using
      errcode = '22023',
      message = 'listing_moderator_required';
  end if;

  if p_action = 'rejected'
    and (nullif(pg_catalog.btrim(p_feedback), '') is null or pg_catalog.length(p_feedback) > 3000) then
    raise exception using
      errcode = '22023',
      message = 'listing_rejection_feedback_required';
  end if;

  select *
  into listing_row
  from public.listings
  where id = p_listing_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'listing_not_found';
  end if;

  if listing_row.retired_at is not null
    or listing_row.content_revision is distinct from p_expected_content_revision
    or listing_row.submitted_for_review_at is distinct from p_expected_submitted_for_review_at
    or listing_row.status <> 'inactive'
    or listing_row.submitted_for_review_at is null
    or (
      listing_row.moderation_reviewed_at is not null
      and listing_row.submitted_for_review_at <= listing_row.moderation_reviewed_at
    ) then
    raise exception using
      errcode = '40001',
      message = 'listing_review_revision_conflict';
  end if;

  perform pg_catalog.set_config('app.listing_integrity_context', 'moderation_decision', true);

  update public.listings
  set
    status = case when p_action = 'approved' then 'active' else 'rejected' end,
    moderation_feedback = case
      when p_action = 'rejected' then pg_catalog.btrim(p_feedback)
      else null
    end,
    moderation_reviewed_at = pg_catalog.statement_timestamp(),
    moderation_reviewed_by = p_moderator_id
  where id = p_listing_id
  returning * into listing_row;

  return listing_row;
end;
$$;

revoke all on function public.decide_listing_moderation(
  uuid,
  bigint,
  timestamptz,
  text,
  text,
  uuid
) from public, anon, authenticated;
grant execute on function public.decide_listing_moderation(
  uuid,
  bigint,
  timestamptz,
  text,
  text,
  uuid
) to service_role;
