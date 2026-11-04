-- =====================================================================
-- BarberSaaS · EMERGÊNCIA · fechar brechas do banco real ANTES do db push
--
-- Use SOMENTE se não for possível rodar `npx supabase db push` imediatamente.
-- Supabase Dashboard → SQL Editor → colar tudo → Run. Pode rodar mais de uma vez.
-- Totalmente compatível com as migrations 02..06 (que recriam tudo depois).
--
-- Brechas confirmadas em 2026-11-03 (via API pública, sem gravar nada):
--   * platform_admins, professionals, professional_services, professional_hours,
--     special_days, booking_rate_events, audit_log: SEM RLS e com INSERT para anon
--   * barbershops: anon lê owner_email, admin_notes etc.
--   * profiles: policy legada "own profile" permite ao usuário marcar o próprio
--     is_platform_admin = true (e a função legada is_platform_admin() lê esse campo)
-- =====================================================================

-- 1) Tabelas novas: RLS ligada e nada para anon
do $$
declare t text;
begin
  foreach t in array array['platform_admins','professionals','professional_services','professional_hours',
                           'special_days','booking_rate_events','audit_log']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('revoke all on public.%I from anon', t);
    end if;
  end loop;
end $$;
revoke insert, update, delete, truncate on public.platform_admins, public.audit_log, public.booking_rate_events from authenticated;

-- 2) Remove admins forjados (somente o admin DEV legítimo, com e-mail confirmado)
delete from public.platform_admins pa
where not exists (select 1 from auth.users u where u.id = pa.user_id
                  and lower(u.email) = 'visionariodev@gmail.com' and u.email_confirmed_at is not null);
insert into public.platform_admins (user_id, note)
select u.id, 'Administrador DEV da plataforma' from auth.users u
where lower(u.email) = 'visionariodev@gmail.com' and u.email_confirmed_at is not null
on conflict (user_id) do nothing;

-- 3) Autorização de admin passa a vir SOMENTE de platform_admins
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = (select auth.uid()));
$$;
-- profiles.is_platform_admin vira espelho somente-leitura (mesmos nomes da migration 02)
alter table public.profiles add column if not exists is_platform_admin boolean not null default false;
create or replace function private.profiles_mirror_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.is_platform_admin := exists (select 1 from public.platform_admins where user_id = new.id);
  return new;
end $$;
drop trigger if exists profiles_mirror_admin on public.profiles;
create trigger profiles_mirror_admin before insert or update on public.profiles
  for each row execute function private.profiles_mirror_admin();
update public.profiles set id = id;

-- 4) Policies mínimas (a migration 02 apaga e recria todas com os helpers definitivos)
drop policy if exists emergency_platform_admins_self on public.platform_admins;
create policy emergency_platform_admins_self on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()));
do $$
declare t text;
begin
  foreach t in array array['professionals','professional_services','professional_hours','special_days']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists emergency_%1$s_members on public.%1$I', t);
      execute format($f$create policy emergency_%1$s_members on public.%1$I for all to authenticated
        using (barbershop_id in (select m.barbershop_id from public.barbershop_members m where m.user_id = (select auth.uid()))
               or public.is_platform_admin())
        with check (barbershop_id in (select m.barbershop_id from public.barbershop_members m where m.user_id = (select auth.uid()))
               or public.is_platform_admin())$f$, t);
    end if;
  end loop;
end $$;
drop policy if exists emergency_audit_log_admin on public.audit_log;
create policy emergency_audit_log_admin on public.audit_log for select to authenticated
  using (public.is_platform_admin());

-- 5) barbershops: anon só enxerga colunas públicas da vitrine
revoke select on public.barbershops from anon;
grant select (id, name, slug, status, plan, phone, whatsapp, address, instagram, facebook, tiktok, logo_url,
  description, review_link, maps_link, public_status_text, theme, primary_color, background_color, card_color,
  is_demo, google_rating, instagram_enabled, whatsapp_enabled, facebook_enabled, tiktok_enabled,
  background_image_url, timezone, created_at, updated_at) on public.barbershops to anon;

-- Verificação (deve listar todas com rowsecurity = true):
-- select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1;
