alter table public.messages
  drop constraint if exists messages_body_length_check;

alter table public.messages
  add constraint messages_body_length_check
  check (char_length(trim(body)) <= 2000);

drop policy if exists "Conversation participants can send messages"
  on public.messages;

revoke all on table public.messages from public, anon, authenticated;
grant select on table public.messages to authenticated;
grant all on table public.messages to service_role;
