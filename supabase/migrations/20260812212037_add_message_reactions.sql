create table public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint message_reactions_pkey primary key (message_id, user_id, emoji),
  constraint message_reactions_supported_emoji_check
    check (emoji = any (array['👍', '❤️', '😂', '😮', '😢', '🎉']::text[]))
);

create index message_reactions_conversation_created_at_idx
  on public.message_reactions (conversation_id, created_at);

create index message_reactions_user_id_idx
  on public.message_reactions (user_id);

alter table public.message_reactions enable row level security;

create policy "Participants and moderators can read message reactions"
  on public.message_reactions
  for select
  to authenticated
  using (
    public.is_moderation_role()
    or exists (
      select 1
      from public.messages message
      join public.conversations conversation
        on conversation.id = message.conversation_id
      where message.id = message_reactions.message_id
        and message.conversation_id = message_reactions.conversation_id
        and (
          conversation.buyer_id = (select auth.uid())
          or conversation.seller_id = (select auth.uid())
        )
    )
  );

create policy "Participants can add message reactions"
  on public.message_reactions
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
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

create policy "Participants can update their message reactions"
  on public.message_reactions
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.messages message
      join public.conversations conversation
        on conversation.id = message.conversation_id
      where message.id = message_reactions.message_id
        and message.conversation_id = message_reactions.conversation_id
        and (
          conversation.buyer_id = (select auth.uid())
          or conversation.seller_id = (select auth.uid())
      )
    )
  )
  with check (
    user_id = (select auth.uid())
    and (
      removed_at is not null
      or exists (
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
    )
  );

revoke all on table public.message_reactions from public, anon, authenticated;
grant select, insert on table public.message_reactions to authenticated;
grant update (removed_at) on table public.message_reactions to authenticated;
grant all on table public.message_reactions to service_role;

do $migration$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'message_reactions'
  ) then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end
$migration$;
