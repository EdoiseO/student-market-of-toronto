create table if not exists public.notification_preferences (
  user_id uuid not null references auth.users (id) on delete cascade,
  notification_type text not null,
  email_enabled boolean not null default true,
  in_app_enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint notification_preferences_pkey primary key (user_id, notification_type),
  constraint notification_preferences_notification_type_check check (
    notification_type in ('messages')
  )
);

create index if not exists notification_preferences_user_id_idx
  on public.notification_preferences (user_id);

alter table public.notification_preferences enable row level security;

drop policy if exists "Users can read their own notification preferences"
  on public.notification_preferences;

drop policy if exists "Users can insert their own notification preferences"
  on public.notification_preferences;

drop policy if exists "Users can update their own notification preferences"
  on public.notification_preferences;

drop policy if exists "Users can delete their own notification preferences"
  on public.notification_preferences;

create policy "Users can read their own notification preferences"
  on public.notification_preferences
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert their own notification preferences"
  on public.notification_preferences
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own notification preferences"
  on public.notification_preferences
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own notification preferences"
  on public.notification_preferences
  for delete
  to authenticated
  using (auth.uid() = user_id);
