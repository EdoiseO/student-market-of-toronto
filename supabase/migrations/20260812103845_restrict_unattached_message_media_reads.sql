drop policy if exists "Participants can view message media" on storage.objects;
create policy "Participants can view message media"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'message-media'
    and (
      (
        owner_id = (select auth.uid())::text
        and (storage.foldername(name))[2] = (select auth.uid())::text
        and not exists (
          select 1
          from public.message_attachments attachment
          where attachment.storage_path = name
        )
      )
      or exists (
        select 1
        from public.message_attachments attachment
        join public.conversations conversation
          on conversation.id = attachment.conversation_id
        where attachment.storage_path = name
          and (
            conversation.buyer_id = (select auth.uid())
            or conversation.seller_id = (select auth.uid())
            or public.is_moderation_role()
          )
      )
    )
  );
