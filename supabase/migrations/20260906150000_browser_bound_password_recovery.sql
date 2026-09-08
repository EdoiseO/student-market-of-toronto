-- This table contains recovery-purpose PKCE verifiers, never Auth sessions.
create table public.password_recovery_intents (
  id uuid primary key,
  browser_hash text not null check (browser_hash ~ '^[0-9a-f]{64}$'),
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 254),
  purpose text not null default 'password_recovery' check (purpose = 'password_recovery'),
  verifier text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  consumed_at timestamptz,
  check (verifier is null or verifier ~ '^[A-Za-z0-9._~-]{43,128}/recovery$')
);
alter table public.password_recovery_intents enable row level security;
revoke all on public.password_recovery_intents from public, anon, authenticated;
grant select, insert, update, delete on public.password_recovery_intents to service_role;
create index password_recovery_intents_email_created on public.password_recovery_intents (email, created_at);
create index password_recovery_intents_browser_created on public.password_recovery_intents (browser_hash, created_at);

create function public.reserve_password_recovery_intent(p_id uuid, p_browser_hash text, p_email text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_id is null or p_browser_hash !~ '^[0-9a-f]{64}$' or
      p_email is null or p_email <> lower(btrim(p_email)) or length(p_email) not between 3 and 254 then
    return false;
  end if;
  -- The order is fixed; both per-address and per-browser limits are atomic.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('recovery-email:' || p_email, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('recovery-browser:' || p_browser_hash, 0));
  delete from public.password_recovery_intents where created_at < now() - interval '1 day';
  if exists (select 1 from public.password_recovery_intents where email = p_email and created_at > now() - interval '1 minute') or
      (select count(*) from public.password_recovery_intents where email = p_email and created_at > now() - interval '1 hour') >= 5 or
      (select count(*) from public.password_recovery_intents where browser_hash = p_browser_hash and created_at > now() - interval '1 hour') >= 20 then
    return false;
  end if;
  insert into public.password_recovery_intents (id, browser_hash, email) values (p_id, p_browser_hash, p_email);
  return true;
end;
$$;

create function public.claim_password_recovery_intent(p_id uuid, p_browser_hash text, p_email text)
returns table (email text, verifier text) language sql security definer set search_path = '' as $$
  update public.password_recovery_intents as intent set consumed_at = now(), verifier = null
  from (
    select id, verifier from public.password_recovery_intents
    where id = p_id and browser_hash = p_browser_hash and email = p_email
      and purpose = 'password_recovery' and expires_at > now() and consumed_at is null and verifier is not null
    for update
  ) as pending
  where intent.id = pending.id and intent.consumed_at is null
  returning intent.email, pending.verifier;
$$;
revoke all on function public.reserve_password_recovery_intent(uuid, text, text) from public, anon, authenticated;
revoke all on function public.claim_password_recovery_intent(uuid, text, text) from public, anon, authenticated;
grant execute on function public.reserve_password_recovery_intent(uuid, text, text) to service_role;
grant execute on function public.claim_password_recovery_intent(uuid, text, text) to service_role;
