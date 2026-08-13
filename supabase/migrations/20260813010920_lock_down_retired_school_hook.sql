-- Supabase Dashboard restores the retired hook's historical grants when the
-- active Before User Created hook is switched. Keep the inactive validator
-- callable only by the Auth service while the hardened replacement is active.
do $migration$
begin
  if pg_catalog.to_regprocedure(
    'public.before_user_created_validate_school_email(jsonb)'
  ) is not null then
    revoke all on function public.before_user_created_validate_school_email(jsonb)
      from public, anon, authenticated, service_role;
    grant execute on function public.before_user_created_validate_school_email(jsonb)
      to supabase_auth_admin;
  end if;
end
$migration$;
