drop policy if exists "Conversation participants can read message attachments"
  on public.message_attachments;
drop policy if exists "Moderators can read message attachments"
  on public.message_attachments;

create policy "Participants and moderators can read message attachments"
  on public.message_attachments
  for select
  to authenticated
  using (
    public.is_moderation_role()
    or exists (
      select 1
      from public.conversations conversation
      where conversation.id = message_attachments.conversation_id
        and (
          conversation.buyer_id = (select auth.uid())
          or conversation.seller_id = (select auth.uid())
        )
    )
  );

drop policy if exists "Participants can upload message media" on storage.objects;
create policy "Participants can upload message media"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'message-media'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and owner_id = (select auth.uid())::text
    and exists (
      select 1
      from public.conversations conversation
      join public.listings listing on listing.id = conversation.listing_id
      where conversation.id::text = (storage.foldername(name))[1]
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
