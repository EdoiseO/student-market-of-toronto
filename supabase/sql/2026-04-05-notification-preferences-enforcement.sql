create or replace function public.skip_disabled_message_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_in_app_enabled boolean;
begin
  if new.user_id is null then
    return new;
  end if;

  if new.conversation_id is null and new.message_id is null then
    return new;
  end if;

  select notification_preferences.in_app_enabled
    into v_in_app_enabled
  from public.notification_preferences
  where notification_preferences.user_id = new.user_id
    and notification_preferences.notification_type = 'messages';

  if v_in_app_enabled is false then
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists skip_disabled_message_notifications
  on public.notifications;

create trigger skip_disabled_message_notifications
before insert on public.notifications
for each row
execute function public.skip_disabled_message_notifications();
