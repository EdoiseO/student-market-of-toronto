create schema if not exists private;

create or replace function private.toronto_school_name_for_email(email_value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case pg_catalog.lower(pg_catalog.split_part(pg_catalog.btrim(email_value), '@', 2))
    when 'utoronto.ca' then 'University of Toronto'
    when 'mail.utoronto.ca' then 'University of Toronto'
    when 'torontomu.ca' then 'Toronto Metropolitan University'
    when 'yorku.ca' then 'York University'
    when 'my.yorku.ca' then 'York University'
    when 'georgebrown.ca' then 'George Brown College'
    when 'mail.georgebrown.ca' then 'George Brown College'
    when 'senecapolytechnic.ca' then 'Seneca Polytechnic'
    when 'myseneca.ca' then 'Seneca Polytechnic'
    when 'humber.ca' then 'Humber Polytechnic'
    -- Retain the singular subdomain for legacy accounts while accepting Humber's
    -- current plural student domain below.
    when 'student.humber.ca' then 'Humber Polytechnic'
    when 'students.humber.ca' then 'Humber Polytechnic'
    when 'centennialcollege.ca' then 'Centennial College'
    when 'my.centennialcollege.ca' then 'Centennial College'
    when 'ocadu.ca' then 'OCAD University'
    else null
  end;
$$;

revoke all on function private.toronto_school_name_for_email(text)
from public, anon, authenticated, service_role, supabase_auth_admin;

create or replace function public.before_user_created_enforce_toronto_school(event jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_email text := pg_catalog.lower(pg_catalog.btrim(
    pg_catalog.coalesce(event -> 'user' ->> 'email', '')
  ));
  school_name text;
begin
  if normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    return pg_catalog.jsonb_build_object(
      'error',
      pg_catalog.jsonb_build_object(
        'http_code', 403,
        'message', 'Use a valid Toronto school email from a supported school domain.'
      )
    );
  end if;

  school_name := private.toronto_school_name_for_email(normalized_email);

  if school_name is not null then
    return '{}'::jsonb;
  end if;

  return pg_catalog.jsonb_build_object(
    'error',
    pg_catalog.jsonb_build_object(
      'http_code', 403,
      'message', 'Use a valid Toronto school email from a supported school domain.'
    )
  );
end;
$$;

revoke all on function public.before_user_created_enforce_toronto_school(jsonb)
from public, anon, authenticated, service_role, supabase_auth_admin;

grant usage on schema public to supabase_auth_admin;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.toronto_school_name_for_email(text)
to supabase_auth_admin;
grant execute on function public.before_user_created_enforce_toronto_school(jsonb)
to supabase_auth_admin;

comment on function public.before_user_created_enforce_toronto_school(jsonb) is
  'Before User Created Auth hook that admits only the exact Toronto school email allowlist.';
