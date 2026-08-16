-- Stage 4: notify only the participants of a conversation moderation
-- transition, then let clients refetch the RLS-protected effective-state view.
-- The base moderation tables intentionally remain outside Postgres Changes
-- because Realtime DELETE events cannot safely rely on row filters.
--
-- The preceding enforcement notification lifecycle migration adds the
-- conversation_closed and conversation_reopened notification types. This
-- migration only emits those safe signals; it does not broaden publication or
-- table grants.

create schema if not exists private;

create or replace function private.emit_conversation_moderation_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.notifications (
    user_id,
    type,
    conversation_id,
    message_id,
    listing_id,
    metadata,
    created_at
  )
  select distinct
    recipient.user_id,
    case
      when new.action = 'close' then 'conversation_closed'
      else 'conversation_reopened'
    end,
    new.conversation_id,
    null::uuid,
    null::uuid,
    jsonb_strip_nulls(jsonb_build_object(
      'action', new.action,
      'state_version', new.state_version,
      'closed_until', new.new_closed_until
    )),
    new.created_at
  from public.conversations conversation
  cross join lateral (
    values (conversation.buyer_id), (conversation.seller_id)
  ) as recipient(user_id)
  where conversation.id = new.conversation_id
    and recipient.user_id is not null;

  return new;
end
$function$;

alter function private.emit_conversation_moderation_notification()
  owner to postgres;
revoke all on function private.emit_conversation_moderation_notification()
  from public, anon, authenticated, service_role;

drop trigger if exists emit_conversation_moderation_notification
  on public.conversation_moderation_history;

create trigger emit_conversation_moderation_notification
  after insert on public.conversation_moderation_history
  for each row
  execute function private.emit_conversation_moderation_notification();

comment on function private.emit_conversation_moderation_notification() is
  'Emits recipient-only close/reopen signals without moderator identity, audit linkage, or user-facing reason text. Clients refetch participant-safe effective state after receiving the signal.';
