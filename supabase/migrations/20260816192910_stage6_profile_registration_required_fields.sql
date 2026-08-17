-- Stage 6: make profile identity and bio rules authoritative at the Auth and
-- Postgres boundaries. The public Auth hook remains callable only by
-- supabase_auth_admin; the privileged profile trigger stays in the unexposed
-- private schema.

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
  normalized_first_name text := nullif(
    pg_catalog.regexp_replace(
      pg_catalog.replace(
        pg_catalog.replace(
          coalesce(event -> 'user' -> 'user_metadata' ->> 'first_name', ''),
          E'\r\n',
          E'\n'
        ),
        E'\r',
        E'\n'
      ),
      '^[[:space:]]+|[[:space:]]+$',
      '',
      'g'
    ),
    ''
  );
  normalized_last_name text := nullif(
    pg_catalog.regexp_replace(
      pg_catalog.replace(
        pg_catalog.replace(
          coalesce(event -> 'user' -> 'user_metadata' ->> 'last_name', ''),
          E'\r\n',
          E'\n'
        ),
        E'\r',
        E'\n'
      ),
      '^[[:space:]]+|[[:space:]]+$',
      '',
      'g'
    ),
    ''
  );
  school_name text;
begin
  if pg_catalog.jsonb_typeof(event -> 'user' -> 'user_metadata' -> 'first_name') is distinct from 'string'
    or pg_catalog.jsonb_typeof(event -> 'user' -> 'user_metadata' -> 'last_name') is distinct from 'string'
    or normalized_first_name is null
    or normalized_last_name is null
    or pg_catalog.char_length(normalized_first_name) > 100
    or pg_catalog.char_length(normalized_last_name) > 100 then
    return pg_catalog.jsonb_build_object(
      'error',
      pg_catalog.jsonb_build_object(
        'http_code', 400,
        'message', 'Enter a first and last name between 1 and 100 characters.'
      )
    );
  end if;

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

  if school_name is null then
    return pg_catalog.jsonb_build_object(
      'error',
      pg_catalog.jsonb_build_object(
        'http_code', 403,
        'message', 'Use a valid Toronto school email from a supported school domain.'
      )
    );
  end if;

  return '{}'::jsonb;
end;
$$;

alter function public.before_user_created_enforce_toronto_school(jsonb) owner to postgres;
revoke all on function public.before_user_created_enforce_toronto_school(jsonb)
from public, anon, authenticated, service_role, supabase_auth_admin;
grant execute on function public.before_user_created_enforce_toronto_school(jsonb)
to supabase_auth_admin;

comment on function public.before_user_created_enforce_toronto_school(jsonb) is
  'Rejects signups unless school email and required 1-100 character profile names are valid.';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  derived_school text := private.toronto_school_name_for_email(new.email);
  first_name_value text := nullif(
    pg_catalog.regexp_replace(
      pg_catalog.replace(
        pg_catalog.replace(
          coalesce(new.raw_user_meta_data ->> 'first_name', ''),
          E'\r\n',
          E'\n'
        ),
        E'\r',
        E'\n'
      ),
      '^[[:space:]]+|[[:space:]]+$',
      '',
      'g'
    ),
    ''
  );
  last_name_value text := nullif(
    pg_catalog.regexp_replace(
      pg_catalog.replace(
        pg_catalog.replace(
          coalesce(new.raw_user_meta_data ->> 'last_name', ''),
          E'\r\n',
          E'\n'
        ),
        E'\r',
        E'\n'
      ),
      '^[[:space:]]+|[[:space:]]+$',
      '',
      'g'
    ),
    ''
  );
begin
  if derived_school is null then
    raise exception using
      errcode = '23514',
      message = 'profile_school_email_not_allowed';
  end if;

  if pg_catalog.jsonb_typeof(new.raw_user_meta_data -> 'first_name') is distinct from 'string'
    or pg_catalog.jsonb_typeof(new.raw_user_meta_data -> 'last_name') is distinct from 'string'
    or first_name_value is null
    or last_name_value is null then
    raise exception using
      errcode = '23514',
      message = 'profile_name_required';
  end if;

  if pg_catalog.char_length(first_name_value) > 100
    or pg_catalog.char_length(last_name_value) > 100 then
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

alter function public.handle_new_user() owner to postgres;
revoke all on function public.handle_new_user()
from public, anon, authenticated, service_role, supabase_auth_admin;

comment on function public.handle_new_user() is
  'Creates a profile only when Auth metadata contains valid required names and derives school from email.';

create or replace function private.protect_profile_identity_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  caller_role text := coalesce(auth.jwt() ->> 'role', '');
  auth_email text;
  derived_school text;
  requires_name_change boolean := false;
  trusted_target text := coalesce(
    pg_catalog.current_setting('smot.profile_identity_target', true),
    ''
  );
begin
  -- Preserve the existing moderator action's one narrow null-name transition.
  -- The earlier a0_assert_profile_name_scope_origin trigger independently
  -- requires this scope to originate from the postgres-owned implementation.
  if tg_op = 'UPDATE'
    and coalesce(
      pg_catalog.current_setting('smot.profile_identity_write_scope', true),
      ''
    ) = 'force_name_change'
    and current_user = 'postgres'
    and trusted_target = new.id::text
    and new.first_name is null
    and new.last_name is null
    and new.school is not distinct from old.school then
    return new;
  end if;

  if tg_op = 'INSERT' and caller_role = 'authenticated' then
    if caller_id is null or new.id is distinct from caller_id then
      raise exception using
        errcode = '42501',
        message = 'profile_identity_owner_mismatch';
    end if;

    -- Compatibility for the previously deployed optional-field upsert: only
    -- let its INSERT leg reach ON CONFLICT when this exact owner row already
    -- exists. Any identity values in that statement are then checked by the
    -- UPDATE leg below; a missing-row INSERT remains forbidden.
    perform 1
    from public.profiles profile
    where profile.id = new.id
    for key share;
    if found then
      return new;
    end if;

    raise exception using
      errcode = '42501',
      message = 'profile_identity_requires_trusted_api';
  elsif tg_op = 'INSERT' and caller_role = 'anon' then
    raise exception using
      errcode = '42501',
      message = 'profile_authentication_required';
  end if;

  if tg_op = 'UPDATE'
    and new.first_name is not distinct from old.first_name
    and new.last_name is not distinct from old.last_name
    and new.school is not distinct from old.school then
    return new;
  end if;

  if tg_op = 'UPDATE' and caller_role in ('anon', 'authenticated') then
    raise exception using
      errcode = '42501',
      message = 'profile_identity_requires_trusted_api';
  end if;

  select
    account.email,
    coalesce(account.raw_app_meta_data -> 'force_name_change' = 'true'::jsonb, false)
  into auth_email, requires_name_change
  from auth.users account
  where account.id = new.id;

  derived_school := private.toronto_school_name_for_email(auth_email);

  if derived_school is null then
    raise exception using
      errcode = '23514',
      message = 'profile_school_email_not_allowed';
  end if;

  if new.first_name is null or new.last_name is null then
    raise exception using
      errcode = '23514',
      message = 'profile_name_required';
  end if;

  new.first_name := pg_catalog.regexp_replace(
    pg_catalog.replace(
      pg_catalog.replace(new.first_name, E'\r\n', E'\n'),
      E'\r',
      E'\n'
    ),
    '^[[:space:]]+|[[:space:]]+$',
    '',
    'g'
  );
  new.last_name := pg_catalog.regexp_replace(
    pg_catalog.replace(
      pg_catalog.replace(new.last_name, E'\r\n', E'\n'),
      E'\r',
      E'\n'
    ),
    '^[[:space:]]+|[[:space:]]+$',
    '',
    'g'
  );

  if pg_catalog.char_length(new.first_name) not between 1 and 100
    or pg_catalog.char_length(new.last_name) not between 1 and 100 then
    raise exception using
      errcode = case
        when pg_catalog.char_length(new.first_name) > 100
          or pg_catalog.char_length(new.last_name) > 100
        then '22001'
        else '23514'
      end,
      message = case
        when pg_catalog.char_length(new.first_name) > 100
          or pg_catalog.char_length(new.last_name) > 100
        then 'profile_name_too_long'
        else 'profile_name_required'
      end;
  end if;

  if tg_op = 'INSERT' and requires_name_change then
    raise exception using
      errcode = '42501',
      message = 'profile_name_change_required';
  end if;

  new.school := derived_school;
  return new;
end;
$$;

alter function private.protect_profile_identity_fields() owner to postgres;
revoke all on function private.protect_profile_identity_fields()
from public, anon, authenticated, service_role;

drop trigger if exists protect_profile_identity_fields on public.profiles;
create trigger protect_profile_identity_fields
before insert or update of first_name, last_name, school on public.profiles
for each row execute function private.protect_profile_identity_fields();

alter table public.profiles
  drop constraint if exists profiles_bio_length_check;

create or replace function private.enforce_profile_bio_length()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Validate only newly supplied bio values. An unchanged legacy value over the
  -- new limit must not block an avatar update or a trusted name-sanction action.
  if (tg_op = 'INSERT' or new.bio is distinct from old.bio)
    and new.bio is not null then
    new.bio := pg_catalog.replace(
      pg_catalog.replace(new.bio, E'\r\n', E'\n'),
      E'\r',
      E'\n'
    );
  end if;

  if (tg_op = 'INSERT' or new.bio is distinct from old.bio)
    and new.bio is not null
    and pg_catalog.char_length(new.bio) > 1000 then
    raise exception using
      errcode = '22001',
      message = 'profile_bio_too_long';
  end if;

  return new;
end;
$$;

alter function private.enforce_profile_bio_length() owner to postgres;
revoke all on function private.enforce_profile_bio_length()
from public, anon, authenticated, service_role;

drop trigger if exists enforce_profile_bio_length on public.profiles;
create trigger enforce_profile_bio_length
before insert or update of bio on public.profiles
for each row execute function private.enforce_profile_bio_length();

comment on function private.enforce_profile_bio_length() is
  'Limits newly supplied profile bios to 1000 characters without invalidating unchanged legacy rows.';

-- Profile identity changes are performed by a server route that authenticates
-- the user with the cookie client, then invokes this service-only boundary.
-- Locking auth.users makes the profile write and force-name flag clear one
-- transaction, and serializes them against the administrator force-name saga.
create schema if not exists profile_action_private;
revoke all on schema profile_action_private
from public, anon, authenticated, service_role;

create or replace function profile_action_private.save_profile_identity_impl(
  p_subject_user_id uuid,
  p_first_name text,
  p_last_name text,
  p_name_fingerprint text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_role text := coalesce(auth.jwt() ->> 'role', '');
  normalized_first_name text := pg_catalog.regexp_replace(
    pg_catalog.replace(
      pg_catalog.replace(coalesce(p_first_name, ''), E'\r\n', E'\n'),
      E'\r',
      E'\n'
    ),
    '^[[:space:]]+|[[:space:]]+$',
    '',
    'g'
  );
  normalized_last_name text := pg_catalog.regexp_replace(
    pg_catalog.replace(
      pg_catalog.replace(coalesce(p_last_name, ''), E'\r\n', E'\n'),
      E'\r',
      E'\n'
    ),
    '^[[:space:]]+|[[:space:]]+$',
    '',
    'g'
  );
  account_email text;
  live_metadata jsonb;
  school_name text;
  force_name_change_was_required boolean;
  rejected_fingerprint text;
  pending_operation record;
  latest_operation record;
  recovered_metadata jsonb;
  live_matches_desired boolean;
begin
  if caller_role <> 'service_role' or p_subject_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'profile_identity_service_role_required';
  end if;

  if pg_catalog.char_length(normalized_first_name) not between 1 and 100
    or pg_catalog.char_length(normalized_last_name) not between 1 and 100 then
    raise exception using
      errcode = case
        when pg_catalog.char_length(normalized_first_name) > 100
          or pg_catalog.char_length(normalized_last_name) > 100
        then '22001'
        else '23514'
      end,
      message = case
        when pg_catalog.char_length(normalized_first_name) > 100
          or pg_catalog.char_length(normalized_last_name) > 100
        then 'profile_name_too_long'
        else 'profile_name_required'
      end;
  end if;

  if p_name_fingerprint is null
    or p_name_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'profile_name_fingerprint_invalid';
  end if;

  select account.email, coalesce(account.raw_app_meta_data, '{}'::jsonb)
  into account_email, live_metadata
  from auth.users account
  where account.id = p_subject_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'profile_account_not_found';
  end if;

  if exists (
    select 1
    from public.user_status status
    where status.user_id = p_subject_user_id
      and status.is_banned
      and (
        status.banned_until is null
        or status.banned_until > pg_catalog.statement_timestamp()
      )
  ) then
    raise exception using errcode = '42501', message = 'account_is_banned';
  end if;

  -- Moderator force-name paths lock the actor, then this subject Auth row, then
  -- the operation. Following their subject-before-operation order avoids a
  -- completion/compliance deadlock and prevents a new operation from being
  -- inserted after this point until the subject lock is released.
  select
    operation.id,
    operation.created_at,
    operation.desired_metadata,
    operation.rollback_metadata
  into pending_operation
  from moderation_action_private.force_name_operations operation
  where operation.subject_user_id_snapshot = p_subject_user_id
    and operation.status = 'pending'
  order by operation.created_at desc, operation.id
  limit 1
  for update;

  if found then
    if pending_operation.created_at >
      pg_catalog.statement_timestamp() - interval '15 minutes' then
      return null;
    end if;

    live_matches_desired :=
      coalesce(live_metadata -> 'force_name_change', 'null'::jsonb)
        is not distinct from coalesce(
          pending_operation.desired_metadata -> 'force_name_change',
          'null'::jsonb
        )
      and coalesce(
        live_metadata -> 'force_name_change_rejected_name_fingerprint',
        'null'::jsonb
      ) is not distinct from coalesce(
        pending_operation.desired_metadata ->
          'force_name_change_rejected_name_fingerprint',
        'null'::jsonb
      )
      and coalesce(
        live_metadata -> 'force_name_change_rejected_name_fingerprints',
        'null'::jsonb
      ) is not distinct from coalesce(
        pending_operation.desired_metadata ->
          'force_name_change_rejected_name_fingerprints',
        'null'::jsonb
      );

    if live_matches_desired then
      -- Complete the same exact compensation the server saga would perform:
      -- restore only the three force-name keys while preserving unrelated app
      -- metadata, keep reports open, and durably mark the operation aborted.
      recovered_metadata := live_metadata;
      if pending_operation.rollback_metadata ? 'force_name_change' then
        recovered_metadata := pg_catalog.jsonb_set(
          recovered_metadata,
          '{force_name_change}',
          pending_operation.rollback_metadata -> 'force_name_change',
          true
        );
      else
        recovered_metadata := recovered_metadata - 'force_name_change';
      end if;
      if pending_operation.rollback_metadata ?
        'force_name_change_rejected_name_fingerprint' then
        recovered_metadata := pg_catalog.jsonb_set(
          recovered_metadata,
          '{force_name_change_rejected_name_fingerprint}',
          pending_operation.rollback_metadata ->
            'force_name_change_rejected_name_fingerprint',
          true
        );
      else
        recovered_metadata := recovered_metadata -
          'force_name_change_rejected_name_fingerprint';
      end if;
      if pending_operation.rollback_metadata ?
        'force_name_change_rejected_name_fingerprints' then
        recovered_metadata := pg_catalog.jsonb_set(
          recovered_metadata,
          '{force_name_change_rejected_name_fingerprints}',
          pending_operation.rollback_metadata ->
            'force_name_change_rejected_name_fingerprints',
          true
        );
      else
        recovered_metadata := recovered_metadata -
          'force_name_change_rejected_name_fingerprints';
      end if;

      update auth.users
      set raw_app_meta_data = recovered_metadata,
          updated_at = pg_catalog.statement_timestamp()
      where id = p_subject_user_id;
      update moderation_action_private.force_name_operations
      set status = 'aborted',
          completed_at = pg_catalog.statement_timestamp()
      where id = pending_operation.id
        and status = 'pending';
      return null;
    end if;

    update moderation_action_private.force_name_operations
    set status = 'reconciliation_required',
        completed_at = pg_catalog.statement_timestamp()
    where id = pending_operation.id
      and status = 'pending';
    return null;
  end if;

  -- An unexpected stale Auth mutation remains blocked until a later app-driven
  -- moderator operation supersedes it. A newer completed/aborted operation is
  -- authoritative, so reconciliation never becomes a permanent manual-DB lock.
  select operation.status, operation.desired_metadata
  into latest_operation
  from moderation_action_private.force_name_operations operation
  where operation.subject_user_id_snapshot = p_subject_user_id
  order by operation.created_at desc, operation.id desc
  limit 1;
  if found
    and latest_operation.status = 'reconciliation_required'
    and live_metadata -> 'force_name_change' = 'true'::jsonb then
    return null;
  end if;

  if pg_catalog.jsonb_typeof(
    live_metadata -> 'force_name_change_rejected_name_fingerprint'
  ) = 'string' then
    rejected_fingerprint := live_metadata ->>
      'force_name_change_rejected_name_fingerprint';
    if rejected_fingerprint = p_name_fingerprint then
      raise exception using errcode = '23514', message = 'profile_name_rejected';
    end if;
  end if;

  if pg_catalog.jsonb_typeof(
    live_metadata -> 'force_name_change_rejected_name_fingerprints'
  ) = 'array' and exists (
    select 1
    from pg_catalog.jsonb_array_elements_text(
      live_metadata -> 'force_name_change_rejected_name_fingerprints'
    ) rejected(value)
    where rejected.value = p_name_fingerprint
  ) then
    raise exception using errcode = '23514', message = 'profile_name_rejected';
  end if;

  school_name := private.toronto_school_name_for_email(account_email);
  if school_name is null then
    raise exception using
      errcode = '23514',
      message = 'profile_school_email_not_allowed';
  end if;

  force_name_change_was_required := coalesce(
    live_metadata -> 'force_name_change' = 'true'::jsonb,
    false
  );

  update public.profiles
  set first_name = normalized_first_name,
      last_name = normalized_last_name,
      school = school_name
  where id = p_subject_user_id;

  if not found then
    -- Registration creates the profile before a force-name sanction can exist.
    -- Never clear an active sanction by synthesizing a missing subject row.
    if force_name_change_was_required then
      raise exception using
        errcode = 'P0002',
        message = 'profile_subject_not_found';
    end if;

    insert into public.profiles (id, first_name, last_name, school)
    values (
      p_subject_user_id,
      normalized_first_name,
      normalized_last_name,
      school_name
    );
  end if;

  if force_name_change_was_required then
    update auth.users
    set raw_app_meta_data = live_metadata - 'force_name_change',
        updated_at = pg_catalog.statement_timestamp()
    where id = p_subject_user_id;
  end if;

  return force_name_change_was_required;
end;
$$;

alter function profile_action_private.save_profile_identity_impl(
  uuid, text, text, text
) owner to postgres;
revoke all on function profile_action_private.save_profile_identity_impl(
  uuid, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function profile_action_private.save_profile_identity_impl(
  uuid, text, text, text
) to service_role;

create or replace function public.save_profile_identity_from_server(
  p_subject_user_id uuid,
  p_first_name text,
  p_last_name text,
  p_name_fingerprint text
)
returns boolean
language sql
security invoker
set search_path = ''
begin atomic
  select profile_action_private.save_profile_identity_impl(
    p_subject_user_id,
    p_first_name,
    p_last_name,
    p_name_fingerprint
  );
end;

alter function public.save_profile_identity_from_server(
  uuid, text, text, text
) owner to postgres;
revoke all on function public.save_profile_identity_from_server(
  uuid, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.save_profile_identity_from_server(
  uuid, text, text, text
) to service_role;

comment on function public.save_profile_identity_from_server(
  uuid, text, text, text
) is
  'Service-only atomic profile identity write and force-name completion boundary. The public wrapper remains SECURITY INVOKER; its implementation is hidden.';
