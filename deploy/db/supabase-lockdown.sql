-- Supabase-резерв: схема public не должна быть видна через REST API Supabase (PostgREST, ключ anon).
-- Отзываем права у anon/authenticated и включаем RLS (политик нет — доступ только владельцу; подписка
-- пишет от имени владельца таблиц, RLS её не ограничивает). Повторный запуск безопасен; деплой гоняет после миграций.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
REVOKE USAGE ON SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;
SELECT 'без RLS: ' || count(*) FILTER (WHERE NOT rowsecurity) || ' из ' || count(*) FROM pg_tables WHERE schemaname = 'public';
SELECT 'права anon/authenticated: ' || count(*) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('anon','authenticated');
SELECT 'владелец не я: ' || count(*) FROM pg_tables WHERE schemaname = 'public' AND tableowner <> current_user;
