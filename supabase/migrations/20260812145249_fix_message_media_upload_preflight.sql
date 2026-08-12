-- Supabase Storage performs an RLS permission probe before streaming a
-- multipart upload. At that point metadata contains `mimetype` and
-- `contentLength` (the complete multipart request length), not the final
-- object `size`. The original reservation policy therefore rejected every
-- browser upload before Storage could write the file.
--
-- Keep the preflight bound to the exact user/path/MIME reservation. The
-- bucket enforces the per-object 10 MiB limit while streaming, and
-- consume_message_media_upload_reservation() still compares the persisted
-- object MIME and exact final size with the reservation before an attachment
-- can be added to a message.

create or replace function private.message_media_upload_is_reserved(
  p_storage_path text,
  p_owner_id text,
  p_metadata jsonb
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and p_owner_id = (select auth.uid())::text
    and exists (
      select 1
      from private.message_media_upload_reservations reservation
      join public.conversations conversation
        on conversation.id = reservation.conversation_id
      join public.listings listing on listing.id = conversation.listing_id
      where reservation.user_id = (select auth.uid())
        and reservation.storage_path = p_storage_path
        and reservation.expires_at > now()
        and not exists (
          select 1
          from private.message_media_account_retirements retirement
          where retirement.user_id = reservation.user_id
        )
        and reservation.mime_type = lower(coalesce(p_metadata ->> 'mimetype', ''))
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
    );
$$;

revoke all on function private.message_media_upload_is_reserved(text, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.message_media_upload_is_reserved(text, text, jsonb)
  to authenticated;

comment on function private.message_media_upload_is_reserved(text, text, jsonb) is
  'Authorizes the Storage preflight for an exact active message-media reservation; final size and MIME are revalidated when the attachment is created.';
