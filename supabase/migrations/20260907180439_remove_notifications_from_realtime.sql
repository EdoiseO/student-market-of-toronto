-- Legacy notification rows can be hard-deleted. Remove their direct publication;
-- existing recipient-scoped signals and all other publication members remain.
do $migration$
begin
  if exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime drop table public.notifications;
  end if;
end
$migration$;
