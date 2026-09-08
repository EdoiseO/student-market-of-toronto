-- Synthetic fixture, including the 14 legacy policy expressions captured read-only.
create role postgres superuser;
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create schema storage;
create schema moderation_action_private;
create schema conversation_admin_private;
grant usage on schema auth, storage to authenticated, anon, service_role;
create function auth.uid() returns uuid language sql stable as $$
 select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
$$;
create function auth.jwt() returns jsonb language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}');
$$;
create function storage.foldername(text) returns text[] language sql immutable as $$
 select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1];
$$;
create table auth.users(id uuid primary key,raw_app_meta_data jsonb not null default '{}',role text default 'authenticated',banned_until timestamptz);
create table public.user_status(user_id uuid primary key,is_banned boolean default false,banned_until timestamptz);
create table public.profiles(id uuid primary key,first_name text,last_name text,school text,avatar_preset_id text,avatar_url text,bio_is_public boolean default false);
create table public.profile_bios(profile_id uuid primary key,bio text,updated_at timestamptz default now());
create table public.listings(id uuid primary key,slug text,title text,location text,status text,seller_id uuid);
create table public.listing_images(id uuid primary key,listing_id uuid,image_url text,position int);
create table public.listing_moderation_history(id uuid primary key,listing_id uuid);
create table public.conversations(id uuid primary key,listing_id uuid,buyer_id uuid,seller_id uuid,last_message_preview text);
create table public.messages(id uuid primary key,conversation_id uuid,sender_id uuid,body text,created_at timestamptz);
create index on public.messages(conversation_id,created_at,id);
create table public.message_attachments(id uuid primary key,conversation_id uuid,message_id uuid,storage_path text);
create table public.message_reactions(id uuid primary key,conversation_id uuid,message_id uuid);
create table public.reports(id uuid primary key,reporter_user_id uuid,subject_type text,conversation_id uuid,message_id uuid,status text);
create table public.notifications(id uuid primary key default gen_random_uuid(),user_id uuid,type text,metadata jsonb,is_read boolean default false);
create table public.test_delivery_queue(notification_id uuid);
create function public.test_enqueue_notification() returns trigger language plpgsql security definer as $$
begin insert into public.test_delivery_queue values (new.id); return new; end;
$$;
create trigger fixture_delivery after insert on public.notifications for each row execute function public.test_enqueue_notification();
create table storage.objects(id uuid primary key,bucket_id text,name text,owner_id text);
grant select on all tables in schema public,storage to authenticated;
grant all on all tables in schema public,storage to service_role;
grant insert on public.notifications to anon, authenticated;
grant insert(id,user_id,type,metadata,is_read) on public.notifications to public,anon,authenticated;
grant update(is_read) on public.notifications to authenticated;
do $$ declare target text; begin
 foreach target in array array['profiles','profile_bios','listings','listing_images','listing_moderation_history','conversations','messages','message_attachments','message_reactions','reports','notifications'] loop
 execute format('alter table public.%I enable row level security',target);
 end loop;
end; $$;
alter table storage.objects enable row level security;
create policy fixture_profiles on public.profiles for select to authenticated using(true);
create policy fixture_bios_own on public.profile_bios for select to authenticated using(profile_id=auth.uid());
create policy fixture_bios_public on public.profile_bios for select to authenticated using(exists(select 1 from public.profiles where id=profile_id and bio_is_public));
create policy fixture_listings on public.listings for select to authenticated using(status='active' or seller_id=auth.uid());
create policy fixture_listing_images on public.listing_images for select to authenticated using(exists(select 1 from public.listings where id=listing_id and (status='active' or seller_id=auth.uid())));
create policy fixture_conversations on public.conversations for select to authenticated using(buyer_id=auth.uid() or seller_id=auth.uid());
create policy fixture_messages on public.messages for select to authenticated using(exists(select 1 from public.conversations where id=conversation_id and (buyer_id=auth.uid() or seller_id=auth.uid())));
create policy fixture_notifications_select on public.notifications for select to authenticated using(user_id=auth.uid());
create policy fixture_notifications_update on public.notifications for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create function public.is_moderation_role() returns boolean language sql stable set search_path=pg_catalog,public as $$
 select coalesce(auth.jwt()->'app_metadata'->>'role','') in ('admin','moderator','staff')
 or coalesce(auth.jwt()->'app_metadata'->'roles','[]'::jsonb) ?| array['admin','moderator','staff'];
$$;
create policy "Moderators can read all conversations" on public.conversations for SELECT to authenticated using (is_moderation_role());
create policy "Moderators can read all listing images" on public.listing_images for SELECT to authenticated using (is_moderation_role());
create policy "Moderators can insert listing moderation history" on public.listing_moderation_history for INSERT to authenticated with check (is_moderation_role());
create policy "Moderators can read listing moderation history" on public.listing_moderation_history for SELECT to authenticated using (is_moderation_role());
create policy "Moderators can read all listings" on public.listings for SELECT to authenticated using (is_moderation_role());
create policy "Moderators can update all listings" on public.listings for UPDATE to authenticated using (is_moderation_role()) with check (is_moderation_role());
create policy "Participants and moderators can read message attachments" on public.message_attachments for SELECT to authenticated using ((is_moderation_role() OR (EXISTS ( SELECT 1
   FROM conversations conversation
  WHERE ((conversation.id = message_attachments.conversation_id) AND ((conversation.buyer_id = ( SELECT auth.uid() AS uid)) OR (conversation.seller_id = ( SELECT auth.uid() AS uid))))))));
create policy "Participants and moderators can read message reactions" on public.message_reactions for SELECT to authenticated using ((is_moderation_role() OR (EXISTS ( SELECT 1
   FROM (messages message
     JOIN conversations conversation ON ((conversation.id = message.conversation_id)))
  WHERE ((message.id = message_reactions.message_id) AND (message.conversation_id = message_reactions.conversation_id) AND ((conversation.buyer_id = ( SELECT auth.uid() AS uid)) OR (conversation.seller_id = ( SELECT auth.uid() AS uid))))))));
create policy "Moderators can read all messages" on public.messages for SELECT to authenticated using (is_moderation_role());
create policy "Moderators can insert notifications" on public.notifications for INSERT to authenticated with check (is_moderation_role());
create policy "profile_bios_select_moderators" on public.profile_bios for SELECT to authenticated using (is_moderation_role());
create policy "Moderators can update reports" on public.reports for UPDATE to authenticated using (is_moderation_role()) with check (is_moderation_role());
create policy "Users can read own reports and moderators can read all reports" on public.reports for SELECT to authenticated using (((reporter_user_id = auth.uid()) OR is_moderation_role()));
create policy "Participants can view message media" on storage.objects for SELECT to authenticated using (((bucket_id = 'message-media'::text) AND (((owner_id = (( SELECT auth.uid() AS uid))::text) AND ((storage.foldername(name))[2] = (( SELECT auth.uid() AS uid))::text) AND (NOT (EXISTS ( SELECT 1
   FROM message_attachments attachment
  WHERE (attachment.storage_path = objects.name))))) OR (EXISTS ( SELECT 1
   FROM (message_attachments attachment
     JOIN conversations conversation ON ((conversation.id = attachment.conversation_id)))
  WHERE ((attachment.storage_path = objects.name) AND ((conversation.buyer_id = ( SELECT auth.uid() AS uid)) OR (conversation.seller_id = ( SELECT auth.uid() AS uid)) OR is_moderation_role())))))));
