-- Read-only RLS / privilege audit. Run in the Supabase SQL editor and review the output.

-- 1) Tables in public without RLS (should return no rows).
select c.relname as table_without_rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- 2) All policies, to review who can do what.
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies where schemaname in ('public', 'storage') order by tablename, cmd;

-- 3) SECURITY DEFINER functions and who can execute them.
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
       p.proconfig as settings
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef order by 1;

-- 4) Extensions living in public (advisor warning).
select e.extname, n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where n.nspname = 'public';

-- 5) Triggers on appointments/barbershops (plan protection, guards, push).
select event_object_table, trigger_name, action_timing, event_manipulation
from information_schema.triggers where event_object_schema = 'public' order by 1, 2;

-- 6) Who is a platform admin.
select p.id, u.email, p.is_platform_admin from public.profiles p join auth.users u on u.id = p.id where p.is_platform_admin;

-- 7) Does the DEV account exist and is its e-mail confirmed?
select id, email, email_confirmed_at, last_sign_in_at from auth.users where email = 'visionariodev@gmail.com';
