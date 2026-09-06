-- Support explicitly registered demo identities while preserving account ownership.
-- Register approved existing accounts separately, then change their email using
-- the supported Auth admin API. No account/content rows are changed here.

-- Preserve the existing helper's owner, OID and EXECUTE ACL. Its body gains a
-- protected registry read, so it becomes STABLE SECURITY DEFINER with an empty
-- search_path. A known owner is required for that narrow elevated read.
do $guard$
begin
  if not exists (
    select 1 from pg_catalog.pg_proc routine
    join pg_catalog.pg_roles owner_role on owner_role.oid = routine.proowner
    where routine.oid = pg_catalog.to_regprocedure('private.toronto_school_name_for_email(text)')
      and owner_role.rolname = 'postgres'
  ) then
    raise exception 'demo_identity_expected_school_helper_missing_or_wrong_owner';
  end if;
end
$guard$;

create table private.demo_account_identities (
  user_id uuid primary key references auth.users(id) on delete cascade,
  demo_email text not null unique,
  school text not null,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  constraint demo_identity_canonical_address check (
    demo_email = 'student-' || user_id::text || '@example.com'
  ),
  constraint demo_identity_supported_school check (
    school in (
      'University of Toronto', 'Toronto Metropolitan University',
      'York University', 'George Brown College', 'Seneca Polytechnic',
      'Humber Polytechnic', 'Centennial College', 'OCAD University'
    )
  )
);
alter table private.demo_account_identities owner to postgres;
alter table private.demo_account_identities enable row level security;
revoke all on table private.demo_account_identities
  from public, anon, authenticated, service_role, supabase_auth_admin;
comment on table private.demo_account_identities is
  'Administrator-maintained exact reserved identities for approved existing school-project accounts. No client policies or grants.';

create or replace function private.toronto_school_name_for_email(email_value text)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
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
    when 'student.humber.ca' then 'Humber Polytechnic'
    when 'students.humber.ca' then 'Humber Polytechnic'
    when 'centennialcollege.ca' then 'Centennial College'
    when 'my.centennialcollege.ca' then 'Centennial College'
    when 'ocadu.ca' then 'OCAD University'
    else (
      select registered.school
      from private.demo_account_identities registered
      join auth.users account on account.id = registered.user_id
      where registered.demo_email = pg_catalog.lower(pg_catalog.btrim(email_value))
        and account.deleted_at is null
    )
  end;
$function$;

-- The helper has only an email argument. Bind reserved email writes to the
-- registered existing UUID as well: this closes the interval between registry
-- insertion and Auth email replacement, and rejects signup with a fresh UUID.
create function private.guard_registered_demo_identity_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_email text := pg_catalog.lower(pg_catalog.btrim(new.email));
begin
  if pg_catalog.split_part(normalized_email, '@', 2) <> 'example.com'
    or normalized_email is null then
    return new;
  end if;

  if tg_op = 'INSERT' or new.deleted_at is not null or not exists (
    select 1
    from private.demo_account_identities registered
    join auth.users account on account.id = registered.user_id
    where registered.user_id = new.id
      and registered.demo_email = normalized_email
      and account.deleted_at is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'demo_email_requires_registered_existing_account';
  end if;
  return new;
end
$function$;
alter function private.guard_registered_demo_identity_email() owner to postgres;
revoke all on function private.guard_registered_demo_identity_email()
  from public, anon, authenticated, service_role, supabase_auth_admin;

create trigger a0_guard_registered_demo_identity_email
before insert or update of email on auth.users
for each row execute function private.guard_registered_demo_identity_email();
