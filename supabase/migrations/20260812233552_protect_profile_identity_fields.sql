create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  derived_school text := private.toronto_school_name_for_email(new.email);
  first_name_value text := pg_catalog.nullif(
    pg_catalog.btrim(new.raw_user_meta_data ->> 'first_name'),
    ''
  );
  last_name_value text := pg_catalog.nullif(
    pg_catalog.btrim(new.raw_user_meta_data ->> 'last_name'),
    ''
  );
begin
  if derived_school is null then
    raise exception using
      errcode = '23514',
      message = 'profile_school_email_not_allowed';
  end if;

  if pg_catalog.length(first_name_value) > 100
    or pg_catalog.length(last_name_value) > 100 then
    raise exception using
      errcode = '22001',
      message = 'profile_name_too_long';
  end if;

  insert into public.profiles (id, first_name, last_name, school)
  values (new.id, first_name_value, last_name_value, derived_school)
  on conflict (id) do update
  set first_name = excluded.first_name,
      last_name = excluded.last_name,
      school = excluded.school;

  return new;
end;
$$;

revoke all on function public.handle_new_user()
from public, anon, authenticated, service_role, supabase_auth_admin;

comment on function public.handle_new_user() is
  'Creates the initial profile and derives school from the verified Auth email, never user metadata.';

create or replace function private.protect_profile_identity_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  caller_role text := pg_catalog.coalesce(auth.role(), '');
  auth_email text;
  requires_name_change boolean := false;
begin
  if tg_op = 'INSERT' then
    if caller_role = 'authenticated' then
      if caller_id is null or new.id is distinct from caller_id then
        raise exception using
          errcode = '42501',
          message = 'profile_identity_owner_mismatch';
      end if;

      if new.first_name is not null or new.last_name is not null then
        raise exception using
          errcode = '42501',
          message = 'profile_identity_requires_trusted_api';
      end if;
    elsif caller_role = 'anon' then
      raise exception using
        errcode = '42501',
        message = 'profile_authentication_required';
    end if;

    select
      account.email,
      account.raw_app_meta_data -> 'force_name_change' = 'true'::jsonb
    into auth_email, requires_name_change
    from auth.users account
    where account.id = new.id;

    new.school := private.toronto_school_name_for_email(auth_email);

    if new.school is null then
      raise exception using
        errcode = '23514',
        message = 'profile_school_email_not_allowed';
    end if;

    if requires_name_change and (new.first_name is not null or new.last_name is not null) then
      raise exception using
        errcode = '42501',
        message = 'profile_name_change_required';
    end if;

    return new;
  end if;

  if new.first_name is not distinct from old.first_name
    and new.last_name is not distinct from old.last_name
    and new.school is not distinct from old.school then
    return new;
  end if;

  if caller_role in ('anon', 'authenticated') then
    raise exception using
      errcode = '42501',
      message = 'profile_identity_requires_trusted_api';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_identity_fields on public.profiles;
create trigger protect_profile_identity_fields
before insert or update of first_name, last_name, school on public.profiles
for each row execute function private.protect_profile_identity_fields();

revoke all on function private.protect_profile_identity_fields()
from public, anon, authenticated, service_role;

comment on function private.protect_profile_identity_fields() is
  'Keeps profile identity fields behind trusted server writes and derives school from Auth email.';
