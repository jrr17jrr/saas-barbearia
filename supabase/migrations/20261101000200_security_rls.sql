-- =====================================================================
-- BarberSaaS · 02 · Segurança: helpers, Auth, RLS, grants
-- Recria TODAS as policies das tabelas gerenciadas para um estado conhecido.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Cargos (re-assegurado aqui porque a 01 pode ter sido aplicada no banco
-- real numa versão compatível com o legado 'barber'). Idempotente.
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.barbershop_members'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%role%'
  loop
    execute format('alter table public.barbershop_members drop constraint %I', r.conname);
  end loop;
  update public.barbershop_members set role = case
      when role is null then 'owner'::public.member_role
      when lower(role::text) in ('owner','dono','proprietario') then 'owner'::public.member_role
      when lower(role::text) in ('manager','admin','gerente') then 'manager'::public.member_role
      else 'barber'::public.member_role end
    where role is null or role::text not in ('owner','manager','barber');
  alter table public.barbershop_members add constraint barbershop_members_role_check
    check (role in ('owner','manager','barber'));
end $$;

-- ---------------------------------------------------------------------
-- Helpers de autorização (schema private não é exposto pela API)
-- ---------------------------------------------------------------------
create or replace function private.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = (select auth.uid()));
$$;

-- Membro com acesso EFETIVO: barbearia suspensa/cancelada bloqueia o tenant no
-- banco (não só no front). O admin DEV continua acessando via is_platform_admin().
create or replace function private.is_shop_member(p_shop uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.barbershop_members m
    join public.barbershops b on b.id = m.barbershop_id
    where m.barbershop_id = p_shop and m.user_id = (select auth.uid())
      and b.status in ('active', 'demo')
  );
$$;

create or replace function private.can_access_shop(p_shop uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_shop_member(p_shop) or private.is_platform_admin();
$$;

-- Barbearias às quais o usuário atual tem acesso (para policies com IN, mais rápidas)
create or replace function private.my_shop_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.barbershop_id from public.barbershop_members m
  join public.barbershops b on b.id = m.barbershop_id
  where m.user_id = (select auth.uid()) and b.status in ('active', 'demo');
$$;

-- Wrapper público (já existia). Só informa o status do PRÓPRIO usuário.
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_platform_admin();
$$;

-- Planos → recursos (feature gating único usado pelo banco e pelo front)
create or replace function private.plan_has(p_plan text, p_feature text)
returns boolean language sql immutable set search_path = '' as $$
  select case p_feature
    when 'site' then p_plan in ('site', 'complete')
    when 'chatbot' then p_plan in ('chatbot', 'complete')
    else false end;
$$;

-- ---------------------------------------------------------------------
-- Auth: perfil automático, admin DEV e vínculo de proprietário pendente
-- ---------------------------------------------------------------------
create or replace function private.handle_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do update set email = excluded.email;

  -- Somente após o e-mail ser CONFIRMADO (prova de posse da caixa de entrada).
  if new.email_confirmed_at is not null then
    if lower(new.email) = 'visionariodev@gmail.com' then
      insert into public.platform_admins (user_id, note) values (new.id, 'Administrador DEV da plataforma')
      on conflict (user_id) do nothing;
    end if;

    -- Barbearias criadas pelo DEV aguardando este e-mail como proprietário
    insert into public.barbershop_members (barbershop_id, user_id, role)
    select b.id, new.id, 'owner' from public.barbershops b
    where lower(b.owner_email) = lower(new.email)
    on conflict (barbershop_id, user_id) do nothing;

    update public.barbershops set owner_user_id = new.id
    where lower(owner_email) = lower(new.email) and owner_user_id is null;

    update public.professionals p set user_id = new.id
    from public.barbershops b
    where b.id = p.barbershop_id and b.owner_user_id = new.id and p.user_id is null
      and p.id = (select p2.id from public.professionals p2 where p2.barbershop_id = b.id order by p2.sort_order, p2.created_at limit 1)
      and not exists (select 1 from public.professionals p3 where p3.barbershop_id = b.id and p3.user_id = new.id);
  end if;
  return new;
end $$;

drop trigger if exists barbersaas_on_auth_user on auth.users;
create trigger barbersaas_on_auth_user
  after insert or update of email, email_confirmed_at on auth.users
  for each row execute function private.handle_auth_user();

-- Backfill: perfis faltantes + admin DEV e proprietários pendentes já confirmados
insert into public.profiles (id, email)
select u.id, u.email from auth.users u
on conflict (id) do nothing;

-- SEGURANÇA: entre a aplicação da 01 e desta 02, platform_admins ficou sem RLS e com
-- INSERT liberado para anon/authenticated no banco real (confirmado em 2026-11-03).
-- Como ela passa a ser a fonte de autorização AGORA, removemos qualquer linha que não
-- seja o admin DEV legítimo (e-mail confirmado). Novos admins: inserir via SQL depois.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'platform_admins'
                 and policyname = 'platform_admins_select') then
    delete from public.platform_admins pa
    where not exists (select 1 from auth.users u where u.id = pa.user_id
                      and lower(u.email) = 'visionariodev@gmail.com' and u.email_confirmed_at is not null);
  end if;
end $$;

insert into public.platform_admins (user_id, note)
select u.id, 'Administrador DEV da plataforma' from auth.users u
where lower(u.email) = 'visionariodev@gmail.com' and u.email_confirmed_at is not null
on conflict (user_id) do nothing;

insert into public.barbershop_members (barbershop_id, user_id, role)
select b.id, u.id, 'owner' from public.barbershops b
join auth.users u on lower(u.email) = lower(b.owner_email) and u.email_confirmed_at is not null
on conflict (barbershop_id, user_id) do nothing;

-- A coluna antiga profiles.is_platform_admin deixa de ser fonte de autorização.
-- Ela é mantida (código legado pode gravá-la), mas passa a ser apenas um espelho
-- somente-leitura de platform_admins, impossível de forjar pelo navegador.
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
drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
update public.profiles set id = id;

create or replace function private.platform_admins_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set is_platform_admin = is_platform_admin
  where id = coalesce(new.user_id, old.user_id);
  return null;
end $$;
drop trigger if exists platform_admins_sync on public.platform_admins;
create trigger platform_admins_sync after insert or delete on public.platform_admins
  for each row execute function private.platform_admins_sync();

-- ---------------------------------------------------------------------
-- Proteção de campos administrativos de barbershops
-- (plano, status, slug, demo, proprietário só mudam pelo DEV)
-- ---------------------------------------------------------------------
create or replace function private.barbershops_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- service_role / postgres (migrations, Edge Functions) e admin DEV podem tudo
  if (select auth.uid()) is null or private.is_platform_admin() then
    if new.status = 'suspended' and old.status is distinct from 'suspended' then new.suspended_at := now(); end if;
    if new.status = 'cancelled' and old.status is distinct from 'cancelled' then new.cancelled_at := now(); end if;
    if new.status in ('active', 'demo') then new.suspended_at := null; new.cancelled_at := null; end if;
    new.is_demo := (new.status = 'demo');
    return new;
  end if;
  if new.plan is distinct from old.plan
     or new.status is distinct from old.status
     or new.slug is distinct from old.slug
     or new.is_demo is distinct from old.is_demo
     or new.owner_user_id is distinct from old.owner_user_id
     or new.owner_email is distinct from old.owner_email
     or new.admin_notes is distinct from old.admin_notes
     or new.suspended_at is distinct from old.suspended_at
     or new.cancelled_at is distinct from old.cancelled_at then
    raise exception 'Somente o administrador da plataforma pode alterar plano, status ou slug.'
      using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists barbershops_guard on public.barbershops;
create trigger barbershops_guard before update on public.barbershops
  for each row execute function private.barbershops_guard();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in (
      'platform_admins','profiles','barbershops','barbershop_members','barbershop_settings',
      'services','professionals','professional_services','professional_hours','business_hours',
      'special_days','blocked_times','clients','appointments','booking_rate_events','audit_log',
      'push_subscriptions')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

alter table public.platform_admins enable row level security;
alter table public.profiles enable row level security;
alter table public.barbershops enable row level security;
alter table public.barbershop_members enable row level security;
alter table public.barbershop_settings enable row level security;
alter table public.services enable row level security;
alter table public.professionals enable row level security;
alter table public.professional_services enable row level security;
alter table public.professional_hours enable row level security;
alter table public.business_hours enable row level security;
alter table public.special_days enable row level security;
alter table public.blocked_times enable row level security;
alter table public.clients enable row level security;
alter table public.appointments enable row level security;
alter table public.booking_rate_events enable row level security;
alter table public.audit_log enable row level security;

-- Grants: anon NÃO acessa tabelas diretamente (somente RPCs públicas).
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
grant select on public.platform_admins to authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, phone, last_seen_at) on public.profiles to authenticated;
grant select on public.barbershops to authenticated;
grant update (name, owner_name, phone, whatsapp, email, address, description, instagram, facebook, tiktok,
  instagram_enabled, whatsapp_enabled, facebook_enabled, tiktok_enabled, logo_url, background_image_url,
  review_link, maps_link, google_rating, public_status_text, theme, primary_color, background_color, card_color,
  timezone, slot_interval_minutes, min_notice_minutes, max_days_ahead) on public.barbershops to authenticated;
grant select on public.barbershop_members to authenticated;
grant select, update on public.barbershop_settings to authenticated;
grant select, insert, update, delete on public.services, public.professionals, public.professional_services,
  public.professional_hours, public.business_hours, public.special_days, public.blocked_times, public.clients
  to authenticated;
grant select, update on public.appointments to authenticated;
grant select on public.audit_log to authenticated;
grant all on all tables in schema public to service_role;

-- platform_admins: cada um vê apenas a si; admin vê todos. Escrita só via SQL/service_role.
create policy platform_admins_select on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()) or private.is_platform_admin());

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.is_platform_admin());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- barbershops
create policy barbershops_select on public.barbershops for select to authenticated
  using (id in (select private.my_shop_ids()) or private.is_platform_admin());
create policy barbershops_update on public.barbershops for update to authenticated
  using (id in (select private.my_shop_ids()) or private.is_platform_admin())
  with check (id in (select private.my_shop_ids()) or private.is_platform_admin());

-- barbershop_members: usuário vê os próprios vínculos; admin vê todos; escrita só admin (via RPC)
create policy members_select on public.barbershop_members for select to authenticated
  using (user_id = (select auth.uid()) or private.is_platform_admin());

-- Tabelas do tenant: acesso total para membros da barbearia e admin DEV
do $$
declare t text;
begin
  foreach t in array array['barbershop_settings','services','professionals','professional_services',
    'professional_hours','business_hours','special_days','blocked_times','clients','appointments']
  loop
    execute format($f$create policy %1$s_tenant_select on public.%1$I for select to authenticated
      using (barbershop_id in (select private.my_shop_ids()) or private.is_platform_admin())$f$, t);
    execute format($f$create policy %1$s_tenant_insert on public.%1$I for insert to authenticated
      with check (barbershop_id in (select private.my_shop_ids()) or private.is_platform_admin())$f$, t);
    execute format($f$create policy %1$s_tenant_update on public.%1$I for update to authenticated
      using (barbershop_id in (select private.my_shop_ids()) or private.is_platform_admin())
      with check (barbershop_id in (select private.my_shop_ids()) or private.is_platform_admin())$f$, t);
    execute format($f$create policy %1$s_tenant_delete on public.%1$I for delete to authenticated
      using (barbershop_id in (select private.my_shop_ids()) or private.is_platform_admin())$f$, t);
  end loop;
end $$;

-- audit_log: somente admin lê
create policy audit_log_admin_select on public.audit_log for select to authenticated
  using (private.is_platform_admin());

-- booking_rate_events: sem policies (somente funções SECURITY DEFINER)

-- Agendamentos: membros alteram somente campos operacionais
revoke update on public.appointments from authenticated;
grant update (status, notes, client_name, client_phone, cancel_reason) on public.appointments to authenticated;

-- Validação/timestamps de status em qualquer caminho de escrita
create or replace function private.appointments_status_stamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.cancelled_at := case when new.status = 'cancelled' then coalesce(new.cancelled_at, now()) end;
    new.completed_at := case when new.status = 'completed' then coalesce(new.completed_at, now()) end;
    new.no_show_at   := case when new.status = 'no_show' then coalesce(new.no_show_at, now()) end;
  end if;
  return new;
end $$;
drop trigger if exists appointments_status_stamp on public.appointments;
create trigger appointments_status_stamp before update on public.appointments
  for each row execute function private.appointments_status_stamp();
