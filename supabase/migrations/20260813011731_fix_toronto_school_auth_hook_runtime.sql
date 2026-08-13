-- COALESCE is SQL syntax rather than a pg_catalog function. Recreate the hook
-- with an unqualified COALESCE expression so it executes under the empty
-- search_path used by Supabase Auth.
create or replace function public.before_user_created_enforce_toronto_school(event jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_email text := pg_catalog.lower(pg_catalog.btrim(
    coalesce(event -> 'user' ->> 'email', '')
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

grant execute on function public.before_user_created_enforce_toronto_school(jsonb)
to supabase_auth_admin;
