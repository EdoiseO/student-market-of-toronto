-- Resolve privileged reads from the current account, never old JWT role claims.
-- Keep ordinary public/owner/participant access independent of moderation.
begin;

create schema if not exists moderation_read_private;
alter schema moderation_read_private owner to postgres;
revoke all on schema moderation_read_private from public, anon, authenticated, service_role;
grant usage on schema moderation_read_private to authenticated;

create or replace function moderation_read_private.can_perform_action(p_action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from auth.users account
    where account.id = (select auth.uid())
      and (account.banned_until is null or account.banned_until <= pg_catalog.statement_timestamp())
      and not exists (
        select 1 from public.user_status status
        where status.user_id = account.id
          and status.is_banned
          and (status.banned_until is null or status.banned_until > pg_catalog.statement_timestamp())
      )
      and case pg_catalog.lower(pg_catalog.btrim(coalesce(p_action, '')))
        when 'view_dashboard' then true
        when 'read_reports' then true
        when 'triage_reports' then true
        when 'assign_reports' then true
        when 'read_listings' then true
        when 'decide_reports' then
          moderation_action_private.resolve_role_from_account(account.raw_app_meta_data, account.role) in ('admin', 'moderator')
        when 'decide_listings' then
          moderation_action_private.resolve_role_from_account(account.raw_app_meta_data, account.role) in ('admin', 'moderator')
        when 'read_users' then
          moderation_action_private.resolve_role_from_account(account.raw_app_meta_data, account.role) in ('admin', 'moderator')
        when 'read_conversations' then
          moderation_action_private.resolve_role_from_account(account.raw_app_meta_data, account.role) in ('admin', 'moderator')
        when 'issue_warning' then
          moderation_action_private.resolve_role_from_account(account.raw_app_meta_data, account.role) in ('admin', 'moderator')
        when 'issue_standard_strike' then
          moderation_action_private.resolve_role_from_account(account.raw_app_meta_data, account.role) in ('admin', 'moderator')
        when 'close_chat_temporarily' then
          moderation_action_private.resolve_role_from_account(account.raw_app_meta_data, account.role) in ('admin', 'moderator')
        when 'reopen_chat' then
          moderation_action_private.resolve_role_from_account(account.raw_app_meta_data, account.role) in ('admin', 'moderator')
        when 'read_audit_log' then
          moderation_action_private.resolve_role_from_account(account.raw_app_meta_data, account.role) = 'admin'
        when 'ban_user' then
          moderation_action_private.resolve_role_from_account(account.raw_app_meta_data, account.role) = 'admin'
        when 'unban_user' then
          moderation_action_private.resolve_role_from_account(account.raw_app_meta_data, account.role) = 'admin'
        when 'manage_roles' then
          moderation_action_private.resolve_role_from_account(account.raw_app_meta_data, account.role) = 'admin'
        when 'manage_announcements' then
          moderation_action_private.resolve_role_from_account(account.raw_app_meta_data, account.role) = 'admin'
        else false
      end
      and moderation_action_private.resolve_role_from_account(account.raw_app_meta_data, account.role)
        in ('admin', 'moderator', 'staff')
  );
$function$;

alter function moderation_read_private.can_perform_action(text) owner to postgres;
revoke all on function moderation_read_private.can_perform_action(text)
  from public, anon, authenticated, service_role;
grant execute on function moderation_read_private.can_perform_action(text) to authenticated;
comment on function moderation_read_private.can_perform_action(text) is
  'Current auth.uid account role and standing; no caller-selected actor or JWT moderation metadata. Missing status row means no application ban, matching trusted action RPCs.';

-- Service-backed conversation pages recheck the actor after the page precheck.
-- NULL from demotion or forced-name state must be denial, never PL/pgSQL fallthrough.
create or replace function conversation_admin_private.resolve_actor_role(
  p_actor_id uuid,
  p_action text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_role text;
  actor_banned_until timestamptz;
  checked_at timestamptz := statement_timestamp();
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
    or p_actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'conversation_admin_service_authentication_required';
  end if;

  select
    moderation_action_private.resolve_role_from_account(
      account.raw_app_meta_data,
      account.role
    ),
    account.banned_until
  into actor_role, actor_banned_until
  from auth.users account
  where account.id = p_actor_id;

  if not found
    or actor_banned_until > checked_at
    or exists (
      select 1
      from public.user_status status
      where status.user_id = p_actor_id
        and status.is_banned
        and (status.banned_until is null or status.banned_until > checked_at)
    ) then
    raise exception using
      errcode = '42501',
      message = 'conversation_admin_actor_unavailable';
  end if;

  if (
    case p_action
      when 'read_conversations' then actor_role in ('admin', 'moderator')
      when 'close_chat_temporarily' then actor_role in ('admin', 'moderator')
      when 'close_chat_permanently' then actor_role = 'admin'
      when 'reopen_chat' then actor_role in ('admin', 'moderator')
      when 'decide_reports' then actor_role in ('admin', 'moderator')
      else false
    end
  ) is not true then
    raise exception using
      errcode = '42501',
      message = 'conversation_admin_action_not_permitted';
  end if;

  return actor_role;
end
$function$;

alter function conversation_admin_private.resolve_actor_role(uuid, text)
  owner to postgres;
revoke all on function conversation_admin_private.resolve_actor_role(uuid, text)
  from public, anon, authenticated, service_role;

-- Replace every legacy branch. A second permissive policy would retain the OR bypass.
drop policy if exists "Moderators can read all conversations" on public.conversations;
create policy "Current moderators can read conversations" on public.conversations
  for select to authenticated
  using ((select moderation_read_private.can_perform_action('read_conversations')));

drop policy if exists "Moderators can read all messages" on public.messages;
create policy "Current moderators can read messages" on public.messages
  for select to authenticated
  using ((select moderation_read_private.can_perform_action('read_conversations')));

drop policy if exists "Participants and moderators can read message attachments" on public.message_attachments;
drop policy if exists "Conversation participants can read message attachments" on public.message_attachments;
drop policy if exists "Moderators can read message attachments" on public.message_attachments;
create policy "Participants and current moderators can read attachments" on public.message_attachments
  for select to authenticated
  using (
    (select moderation_read_private.can_perform_action('read_conversations'))
    or exists (
      select 1 from public.conversations conversation
      where conversation.id = message_attachments.conversation_id
        and (conversation.buyer_id = (select auth.uid()) or conversation.seller_id = (select auth.uid()))
    )
  );

drop policy if exists "Participants and moderators can read message reactions" on public.message_reactions;
create policy "Participants and current moderators can read reactions" on public.message_reactions
  for select to authenticated
  using (
    (select moderation_read_private.can_perform_action('read_conversations'))
    or exists (
      select 1 from public.messages message
      join public.conversations conversation on conversation.id = message.conversation_id
      where message.id = message_reactions.message_id
        and message.conversation_id = message_reactions.conversation_id
        and (conversation.buyer_id = (select auth.uid()) or conversation.seller_id = (select auth.uid()))
    )
  );

drop policy if exists "Participants can view message media" on storage.objects;
create policy "Participants and current moderators can view message media" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'message-media'
    and (
      (
        owner_id = (select auth.uid())::text
        and (storage.foldername(name))[2] = (select auth.uid())::text
        and not exists (
          select 1 from public.message_attachments attachment
          where attachment.storage_path = objects.name
        )
      )
      or exists (
        select 1 from public.message_attachments attachment
        join public.conversations conversation on conversation.id = attachment.conversation_id
        where attachment.storage_path = objects.name
          and (
            conversation.buyer_id = (select auth.uid())
            or conversation.seller_id = (select auth.uid())
            or (select moderation_read_private.can_perform_action('read_conversations'))
          )
      )
    )
  );

drop policy if exists "Users can read own reports and moderators can read all reports" on public.reports;
create policy "Reporters and current triage actors can read reports" on public.reports
  for select to authenticated
  using (
    reporter_user_id = (select auth.uid())
    or (select moderation_read_private.can_perform_action('read_reports'))
  );

drop policy if exists "Moderators can read all listings" on public.listings;
create policy "Current listing reviewers can read listings" on public.listings
  for select to authenticated
  using ((select moderation_read_private.can_perform_action('read_listings')));

drop policy if exists "Moderators can read all listing images" on public.listing_images;
create policy "Current listing reviewers can read listing images" on public.listing_images
  for select to authenticated
  using ((select moderation_read_private.can_perform_action('read_listings')));

drop policy if exists "Moderators can read listing moderation history" on public.listing_moderation_history;
create policy "Current listing reviewers can read moderation history" on public.listing_moderation_history
  for select to authenticated
  using ((select moderation_read_private.can_perform_action('read_listings')));

-- Hidden bios have the read_users boundary. Owner and public-bio policies remain.
drop policy if exists "profile_bios_select_moderators" on public.profile_bios;
create policy "Current user reviewers can read private profile bios" on public.profile_bios
  for select to authenticated
  using ((select moderation_read_private.can_perform_action('read_users')));

-- These mutations already have trusted operation boundaries; remove dormant legacy grants.
drop policy if exists "Moderators can update reports" on public.reports;
drop policy if exists "Moderators can update all listings" on public.listings;
drop policy if exists "Moderators can insert listing moderation history" on public.listing_moderation_history;
drop policy if exists "Moderators can insert notifications" on public.notifications;

-- Table revocation alone does not remove explicit column grants.
revoke insert on table public.notifications from public, anon, authenticated;
do $block$
declare
  column_list text;
begin
  select pg_catalog.string_agg(pg_catalog.quote_ident(attribute.attname), ', ' order by attribute.attnum)
  into column_list
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = 'public.notifications'::regclass
    and attribute.attnum > 0 and not attribute.attisdropped;
  execute pg_catalog.format(
    'revoke insert (%s) on table public.notifications from public, anon, authenticated',
    column_list
  );
end
$block$;

-- No dependency is silently removed: unknown policies or routines abort migration.
do $block$
begin
  if exists (
    select 1 from pg_catalog.pg_policies policy
    where pg_catalog.strpos(coalesce(policy.qual, '') || coalesce(policy.with_check, ''), 'is_moderation_role') > 0
  ) then
    raise exception 'Unreconciled is_moderation_role policy dependency';
  end if;
  if exists (
    select 1 from pg_catalog.pg_proc routine
    where pg_catalog.strpos(routine.prosrc, 'is_moderation_role') > 0
  ) then
    raise exception 'Unreconciled is_moderation_role routine dependency';
  end if;
end
$block$;
drop function if exists public.is_moderation_role();

-- Report triage gets the reported message plus two neighbors on either side.
-- No cursor or conversation id is accepted; broad reads use the existing moderator route.
create or replace function moderation_read_private.report_conversation_context(p_report_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  report_conversation_id uuid;
  target_message_id uuid;
  target_created_at timestamptz;
  conversation_payload jsonb;
  message_payload jsonb;
begin
  if not moderation_read_private.can_perform_action('read_reports') then
    raise exception using errcode = '42501', message = 'report_context_not_permitted';
  end if;

  select report.conversation_id, message.id, message.created_at
  into report_conversation_id, target_message_id, target_created_at
  from public.reports report
  join public.messages message
    on message.id = report.message_id and message.conversation_id = report.conversation_id
  where report.id = p_report_id and report.subject_type = 'message';

  if not found then
    return null;
  end if;

  select pg_catalog.jsonb_build_object(
    'id', conversation.id,
    'listings', case when listing.id is null then null else pg_catalog.jsonb_build_object(
      'id', listing.id, 'slug', listing.slug, 'title', listing.title,
      'location', listing.location, 'status', listing.status,
      'listing_images', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('image_url', image.image_url, 'position', image.position))
        from (
          select photo.image_url, photo.position from public.listing_images photo
          where photo.listing_id = listing.id order by photo.position, photo.id limit 1
        ) image
      ), '[]'::jsonb)
    ) end,
    'buyer_profile', pg_catalog.jsonb_build_object(
      'id', buyer.id, 'first_name', buyer.first_name, 'last_name', buyer.last_name,
      'school', buyer.school, 'avatar_preset_id', buyer.avatar_preset_id, 'avatar_url', buyer.avatar_url
    ),
    'seller_profile', pg_catalog.jsonb_build_object(
      'id', seller.id, 'first_name', seller.first_name, 'last_name', seller.last_name,
      'school', seller.school, 'avatar_preset_id', seller.avatar_preset_id, 'avatar_url', seller.avatar_url
    )
  )
  into conversation_payload
  from public.conversations conversation
  left join public.listings listing on listing.id = conversation.listing_id
  left join public.profiles buyer on buyer.id = conversation.buyer_id
  left join public.profiles seller on seller.id = conversation.seller_id
  where conversation.id = report_conversation_id;

  if not found then
    return null;
  end if;

  with before_messages as (
    select message.id, message.sender_id, message.body, message.created_at
    from public.messages message
    where message.conversation_id = report_conversation_id
      and (message.created_at, message.id) < (target_created_at, target_message_id)
    order by message.created_at desc, message.id desc limit 2
  ), after_messages as (
    select message.id, message.sender_id, message.body, message.created_at
    from public.messages message
    where message.conversation_id = report_conversation_id
      and (message.created_at, message.id) > (target_created_at, target_message_id)
    order by message.created_at, message.id limit 2
  ), context_messages as (
    select * from before_messages
    union all
    select message.id, message.sender_id, message.body, message.created_at
    from public.messages message
    where message.id = target_message_id and message.conversation_id = report_conversation_id
    union all
    select * from after_messages
  )
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object('id', message.id, 'sender_id', message.sender_id, 'body', message.body, 'created_at', message.created_at)
    order by message.created_at, message.id
  ), '[]'::jsonb)
  into message_payload
  from context_messages message;

  return pg_catalog.jsonb_build_object(
    'conversation', conversation_payload,
    'messages', message_payload,
    'reported_message_id', target_message_id,
    'context_limited', true,
    'can_read_full_conversation', moderation_read_private.can_perform_action('read_conversations')
  );
end
$function$;

alter function moderation_read_private.report_conversation_context(uuid) owner to postgres;
revoke all on function moderation_read_private.report_conversation_context(uuid)
  from public, anon, authenticated, service_role;
grant execute on function moderation_read_private.report_conversation_context(uuid) to authenticated;

create or replace function public.get_report_conversation_context(p_report_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select moderation_read_private.report_conversation_context(p_report_id);
$function$;
alter function public.get_report_conversation_context(uuid) owner to postgres;
revoke all on function public.get_report_conversation_context(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_report_conversation_context(uuid) to authenticated;
comment on function public.get_report_conversation_context(uuid) is
  'Current report-triage authority; a fixed five-message context derived only from the report. No private transcript or attachment listing.';

commit;
