-- Enable row-level multi-user updates for field app.
-- Apply once after review. No business rows are changed or deleted.
do $$ declare t text;
begin
  foreach t in array array['field_tasks','field_logs','field_photos','field_receipts','field_material_requests','field_dispatch']
  loop
    if to_regclass('public.' || t) is not null
       and not exists (
         select 1 from pg_publication_tables
         where pubname='supabase_realtime' and schemaname='public' and tablename=t
       ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
