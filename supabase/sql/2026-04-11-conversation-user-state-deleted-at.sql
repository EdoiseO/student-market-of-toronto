alter table public.conversation_user_state
add column if not exists deleted_at timestamptz;
