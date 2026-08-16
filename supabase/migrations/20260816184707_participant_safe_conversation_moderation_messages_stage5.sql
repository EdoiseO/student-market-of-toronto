-- Stage 5: preserve the moderator-authored, participant-safe close/reopen
-- explanation on each recipient-owned notification. The transition RPC
-- already normalizes and validates conversation_moderation_history.user_message
-- (10-1000 characters). Moderator identity, internal notes, audit linkage, and
-- reason codes remain excluded from this projection.

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
      'closed_until', new.new_closed_until,
      'user_message', new.user_message
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

comment on function private.emit_conversation_moderation_notification() is
  'Emits one recipient-owned close/reopen notification per participant with only the validated participant-safe user message and state metadata. Moderator identity, internal notes, reason codes, and audit linkage are excluded.';
