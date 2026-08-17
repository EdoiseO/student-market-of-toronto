-- Stage 3: enforce effective conversation closures at every trusted write
-- boundary. Reads and historical cleanup remain available while a conversation
-- is closed. Participant writes acquire a SHARE lock on the versioned current
-- state so a concurrent close/reopen transition has a single serial order.

create schema if not exists private;

create or replace function private.assert_conversation_participant_write_allowed(
  p_conversation_id uuid,
  p_actor_id uuid,
  p_require_active_messaging boolean default true
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  conversation_row public.conversations%rowtype;
  moderation_state public.conversation_moderation_state%rowtype;
  checked_at timestamptz := now();
  listing_status text;
begin
  if p_conversation_id is null or p_actor_id is null then
    raise exception 'conversation_write_authentication_required'
      using errcode = '42501';
  end if;

  -- FOR SHARE conflicts with the moderation transition's FOR UPDATE lock. If a
  -- close wins first, this transaction observes closed; if this write wins, the
  -- close linearizes after the write commits.
  select state.*
  into moderation_state
  from public.conversation_moderation_state state
  where state.conversation_id = p_conversation_id
  for share;

  if not found then
    raise exception 'conversation_moderation_state_required'
      using errcode = '55000';
  end if;

  if moderation_state.status = 'closed'
    and (
      moderation_state.closed_until is null
      or moderation_state.closed_until > checked_at
    ) then
    raise exception 'conversation_write_closed'
      using
        errcode = '55000',
        detail = case
          when moderation_state.closed_until is null then 'closed_until=indefinite'
          else 'closed_until=' || moderation_state.closed_until::text
        end;
  end if;

  select conversation.*
  into conversation_row
  from public.conversations conversation
  where conversation.id = p_conversation_id;

  if not found
    or (
      p_actor_id is distinct from conversation_row.buyer_id
      and p_actor_id is distinct from conversation_row.seller_id
    ) then
    raise exception 'conversation_write_forbidden'
      using errcode = '42501';
  end if;

  -- Listing-null conversations are reserved for the atomic announcement
  -- delivery RPC. They are never a generic participant message/reaction path.
  if conversation_row.listing_id is null then
    raise exception 'announcement_conversation_is_read_only'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from auth.users actor
    where actor.id = p_actor_id
      and (actor.banned_until is null or actor.banned_until <= checked_at)
  ) or exists (
    select 1
    from public.user_status status
    where status.user_id = p_actor_id
      and status.is_banned
      and (status.banned_until is null or status.banned_until > checked_at)
  ) then
    raise exception 'conversation_write_actor_banned'
      using errcode = '42501';
  end if;

  if not coalesce(p_require_active_messaging, true) then
    return;
  end if;

  select listing.status
  into listing_status
  from public.listings listing
  where listing.id = conversation_row.listing_id;

  if listing_status is distinct from 'active' then
    raise exception 'listing_messaging_unavailable'
      using
        errcode = '55000',
        detail = 'listing_status=' || coalesce(listing_status, 'unavailable');
  end if;

  if exists (
    select 1
    from public.blocked_users blocked
    where (
      blocked.blocker_user_id = conversation_row.buyer_id
      and blocked.blocked_user_id = conversation_row.seller_id
    ) or (
      blocked.blocker_user_id = conversation_row.seller_id
      and blocked.blocked_user_id = conversation_row.buyer_id
    )
  ) then
    raise exception 'conversation_write_blocked'
      using errcode = '42501';
  end if;
end
$function$;

alter function private.assert_conversation_participant_write_allowed(uuid, uuid, boolean)
  owner to postgres;
revoke all on function private.assert_conversation_participant_write_allowed(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;

-- The full message guard below is SECURITY DEFINER so it can perform the
-- participant/Auth checks without exposing private helpers. Checking
-- current_user inside that function would therefore always observe postgres.
-- This separate invoker trigger preserves the outer DML role and proves that
-- only a postgres-owned trusted transaction can activate the announcement
-- scope. A service JWT or caller-set GUC alone is insufficient, even through a
-- non-postgres-owned SECURITY DEFINER helper with a narrow INSERT grant.
create or replace function private.guard_announcement_message_write_origin()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if coalesce(current_setting('smot.conversation_write_scope', true), '') =
      'announcement_delivery'
    and current_user <> 'postgres' then
    raise exception 'announcement_message_write_requires_postgres_owner'
      using errcode = '42501';
  end if;

  return new;
end
$function$;

alter function private.guard_announcement_message_write_origin() owner to postgres;
revoke all on function private.guard_announcement_message_write_origin()
  from public, anon, authenticated, service_role;

drop trigger if exists guard_announcement_message_write_origin on public.messages;
create trigger guard_announcement_message_write_origin
  before insert on public.messages
  for each row execute function private.guard_announcement_message_write_origin();

create or replace function private.guard_conversation_message_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  write_scope text := coalesce(
    current_setting('smot.conversation_write_scope', true),
    ''
  );
  conversation_listing_id uuid;
  actor_id uuid := auth.uid();
begin
  if write_scope = 'announcement_delivery' then
    if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
      raise exception 'announcement_message_write_requires_service_role'
        using errcode = '42501';
    end if;

    select conversation.listing_id
    into conversation_listing_id
    from public.conversations conversation
    where conversation.id = new.conversation_id;

    if not found or conversation_listing_id is not null then
      raise exception 'announcement_message_requires_system_conversation'
        using errcode = '42501';
    end if;

    return new;
  end if;

  if write_scope <> '' then
    raise exception 'invalid_conversation_write_scope'
      using errcode = '42501';
  end if;

  if actor_id is null or new.sender_id is distinct from actor_id then
    raise exception 'conversation_message_sender_mismatch'
      using errcode = '42501';
  end if;

  perform private.assert_conversation_participant_write_allowed(
    new.conversation_id,
    actor_id,
    true
  );

  return new;
end
$function$;

alter function private.guard_conversation_message_insert() owner to postgres;
revoke all on function private.guard_conversation_message_insert()
  from public, anon, authenticated, service_role;

drop trigger if exists guard_conversation_message_insert on public.messages;
create trigger guard_conversation_message_insert
  before insert on public.messages
  for each row execute function private.guard_conversation_message_insert();

-- Trusted functions owned by postgres can still write, but a service client can
-- no longer bypass those functions with direct table DML.
revoke insert, update, delete, truncate on table public.messages from service_role;
grant select on table public.messages to service_role;

comment on function private.assert_conversation_participant_write_allowed(uuid, uuid, boolean) is
  'Locks and validates effective open state, participation, active account status, and (when required) listing/block availability for conversation writes.';
comment on function private.guard_announcement_message_write_origin() is
  'SECURITY INVOKER origin check: announcement delivery scope is valid only while the outer DML executes as postgres inside the lease-validated atomic worker implementation.';
comment on function private.guard_conversation_message_insert() is
  'Rejects direct/generic message inserts into closed or system announcement conversations. The only system scope is the lease-validated atomic announcement delivery transaction.';

-- Reservation creation is the first durable step in a media send. Guarding the
-- private row means the public reservation RPC cannot authorize an upload after
-- a close linearizes, even if its older eligibility query was already running.
create or replace function private.guard_message_media_reservation_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or new.user_id is distinct from auth.uid() then
    raise exception 'message_media_reservation_owner_mismatch'
      using errcode = '42501';
  end if;

  perform private.assert_conversation_participant_write_allowed(
    new.conversation_id,
    new.user_id,
    true
  );

  return new;
end
$function$;

alter function private.guard_message_media_reservation_insert() owner to postgres;
revoke all on function private.guard_message_media_reservation_insert()
  from public, anon, authenticated, service_role;

drop trigger if exists guard_message_media_reservation_insert
  on private.message_media_upload_reservations;
create trigger guard_message_media_reservation_insert
  before insert on private.message_media_upload_reservations
  for each row execute function private.guard_message_media_reservation_insert();

-- Storage preflight and upload completion are separate transactions. The
-- authenticated preflight does not necessarily have authoritative final size,
-- while the null-subject service completion does. The pre-existing quota
-- trigger runs first (lock_ sorts before verify_) and validates those two
-- phases accordingly. This second trigger binds both phases to the same exact
-- live reservation and locks its conversation state before an object can be
-- authorized/committed, closing the reserve -> upload race.
create or replace function private.verify_open_conversation_message_media_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  authenticated_actor_id uuid := auth.uid();
  reservation_actor_id uuid;
  reservation_conversation_id uuid;
begin
  if new.bucket_id <> 'message-media' then
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

alter function private.verify_open_conversation_message_media_insert()
  owner to postgres;
revoke all on function private.verify_open_conversation_message_media_insert()
  from public, anon, authenticated, service_role;

drop trigger if exists verify_open_conversation_message_media_insert
  on storage.objects;
create trigger verify_open_conversation_message_media_insert
  before insert on storage.objects
  for each row
  when (new.bucket_id = 'message-media')
  execute function private.verify_open_conversation_message_media_insert();

-- Attachment INSERT is the final media-to-message linkage. It is guarded even
-- though message INSERT already holds a state lock, so no alternate trusted
-- function can finalize pre-uploaded media in a closed conversation.
create or replace function private.assert_open_conversation_attachment_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null or new.uploader_id is distinct from actor_id then
    raise exception 'message_attachment_uploader_mismatch'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.messages message
    where message.id = new.message_id
      and message.conversation_id = new.conversation_id
  ) then
    raise exception 'message_attachment_conversation_mismatch'
      using errcode = '23514';
  end if;

  perform private.assert_conversation_participant_write_allowed(
    new.conversation_id,
    actor_id,
    true
  );

  return new;
end
$function$;

alter function private.assert_open_conversation_attachment_insert()
  owner to postgres;
revoke all on function private.assert_open_conversation_attachment_insert()
  from public, anon, authenticated, service_role;

drop trigger if exists assert_open_conversation_attachment_insert
  on public.message_attachments;
create trigger assert_open_conversation_attachment_insert
  before insert on public.message_attachments
  for each row execute function private.assert_open_conversation_attachment_insert();

revoke insert, update, delete, truncate on table public.message_attachments
  from service_role;
grant select on table public.message_attachments to service_role;

-- Reactions are soft-deleted. Adding or reactivating a reaction has the same
-- active-listing/block requirements as sending a message. Removal stays usable
-- when a listing is inactive or a participant is blocked, but still requires an
-- open conversation and active participant account. This preserves cleanup
-- without allowing a closed thread to be mutated.
create or replace function private.guard_conversation_message_reaction_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  is_reactivation_or_add boolean;
begin
  if coalesce(current_setting('smot.conversation_write_scope', true), '') <> '' then
    raise exception 'system_scope_cannot_write_message_reactions'
      using errcode = '42501';
  end if;

  if actor_id is null or new.user_id is distinct from actor_id then
    raise exception 'message_reaction_actor_mismatch'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and (
    new.message_id is distinct from old.message_id
    or new.conversation_id is distinct from old.conversation_id
    or new.user_id is distinct from old.user_id
    or new.emoji is distinct from old.emoji
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'message_reaction_identity_is_immutable'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.messages message
    where message.id = new.message_id
      and message.conversation_id = new.conversation_id
  ) then
    raise exception 'message_reaction_conversation_mismatch'
      using errcode = '23514';
  end if;

  is_reactivation_or_add := new.removed_at is null;

  perform private.assert_conversation_participant_write_allowed(
    new.conversation_id,
    actor_id,
    is_reactivation_or_add
  );

  return new;
end
$function$;

alter function private.guard_conversation_message_reaction_write()
  owner to postgres;
revoke all on function private.guard_conversation_message_reaction_write()
  from public, anon, authenticated, service_role;

drop trigger if exists guard_conversation_message_reaction_write
  on public.message_reactions;
create trigger guard_conversation_message_reaction_write
  before insert or update on public.message_reactions
  for each row execute function private.guard_conversation_message_reaction_write();

revoke insert, update, delete, truncate on table public.message_reactions
  from service_role;
grant select on table public.message_reactions to service_role;

comment on function private.guard_message_media_reservation_insert() is
  'Prevents participant media reservations from being created after an effective conversation closure.';
comment on function private.verify_open_conversation_message_media_insert() is
  'Binds message-media Storage insertion to a live reservation and an effectively open conversation.';
comment on function private.assert_open_conversation_attachment_insert() is
  'Prevents attachment finalization outside an effectively open participant conversation.';
comment on function private.guard_conversation_message_reaction_write() is
  'Prevents reaction additions, removals, and reactivations in effectively closed conversations while retaining inactive-listing cleanup semantics.';
