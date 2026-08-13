drop policy if exists "Participants can add message reactions"
  on public.message_reactions;

create policy "Participants can add message reactions"
  on public.message_reactions
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and removed_at is null
    and exists (
      select 1
      from public.messages message
      join public.conversations conversation
        on conversation.id = message.conversation_id
      join public.listings listing
        on listing.id = conversation.listing_id
      where message.id = message_reactions.message_id
        and message.conversation_id = message_reactions.conversation_id
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
    )
  );

revoke insert on table public.message_reactions from authenticated;
grant insert (message_id, conversation_id, user_id, emoji)
  on table public.message_reactions
  to authenticated;
