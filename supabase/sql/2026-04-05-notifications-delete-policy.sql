drop policy if exists "Users can delete their own notifications"
  on public.notifications;

create policy "Users can delete their own notifications"
  on public.notifications
  for delete
  to authenticated
  using (auth.uid() = user_id);
