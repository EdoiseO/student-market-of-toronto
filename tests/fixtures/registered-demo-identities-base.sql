-- Synthetic records only; no operational registry mappings are imported.
create role anon;
create role authenticated;
create role service_role bypassrls;
create role supabase_auth_admin;
create role helper_acl_probe;
create schema auth;
create schema moderation_action_private;
grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select jsonb_build_object('role', auth.role(), 'sub', auth.uid())
$$;
create table auth.users (
  id uuid primary key,
  email text unique,
  deleted_at timestamptz,
  raw_user_meta_data jsonb not null default '{"first_name":"Original","last_name":"Student"}',
  raw_app_meta_data jsonb not null default '{}',
  encrypted_password text not null default 'unchanged-fixture-password-hash',
  updated_at timestamptz not null default now()
);
grant select, insert, update on auth.users to supabase_auth_admin;
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  school text,
  bio text
);
create table public.listings (
  id uuid primary key,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text not null
);
create table public.listing_images (
  id uuid primary key,
  listing_id uuid not null references public.listings(id) on delete cascade,
  storage_path text not null
);
create table public.conversations (
  id uuid primary key,
  seller_id uuid not null references public.profiles(id),
  buyer_id uuid not null references public.profiles(id),
  listing_id uuid not null references public.listings(id)
);
create table public.user_status (
  user_id uuid primary key,
  is_banned boolean not null default false,
  banned_until timestamptz
);
create table moderation_action_private.force_name_operations (
  id uuid primary key,
  subject_user_id_snapshot uuid,
  status text,
  created_at timestamptz,
  completed_at timestamptz,
  desired_metadata jsonb,
  rollback_metadata jsonb
);
