-- Reconstrução do schema que já existia em produção (levantado via REST em 2026-11-01).
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, email text, full_name text,
  is_platform_admin boolean default false, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.barbershops (id uuid primary key default gen_random_uuid(), name text not null, slug text unique not null,
  status text default 'active', plan text default 'complete', owner_name text, phone text, whatsapp text, address text,
  instagram text, logo_url text, theme text default 'cyan', primary_color text default '#08a9df', background_color text default '#0b1220',
  card_color text default '#131e31', is_demo boolean default false, created_at timestamptz default now(), updated_at timestamptz default now(),
  description text, facebook text, tiktok text, review_link text, maps_link text, public_status_text text default 'Aberto agora');
create table public.barbershop_members (id uuid primary key default gen_random_uuid(), barbershop_id uuid references public.barbershops(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade, role text default 'owner', created_at timestamptz default now());
create table public.services (id uuid primary key default gen_random_uuid(), barbershop_id uuid references public.barbershops(id) on delete cascade,
  name text not null, description text, price numeric(10,2) default 0, duration_minutes int default 30, active boolean default true,
  sort_order int default 0, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.clients (id uuid primary key default gen_random_uuid(), barbershop_id uuid references public.barbershops(id) on delete cascade,
  name text not null, phone text, whatsapp text, notes text, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.appointments (id uuid primary key default gen_random_uuid(), barbershop_id uuid references public.barbershops(id) on delete cascade,
  client_id uuid references public.clients(id), service_id uuid references public.services(id), starts_at timestamptz not null, ends_at timestamptz not null,
  status text default 'confirmed', price numeric(10,2) default 0, notes text, client_name text, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.business_hours (id uuid primary key default gen_random_uuid(), barbershop_id uuid references public.barbershops(id) on delete cascade,
  weekday int not null, is_open boolean default true, opens_at time, closes_at time);
create table public.barbershop_settings (barbershop_id uuid primary key references public.barbershops(id) on delete cascade,
  site_enabled boolean default true, chatbot_enabled boolean default true, chatbot_name text, chatbot_greeting text,
  chatbot_sync_with_site boolean default true, chatbot_theme text default 'cyan', updated_at timestamptz default now());
create table public.blocked_times (id uuid primary key default gen_random_uuid(), barbershop_id uuid references public.barbershops(id) on delete cascade,
  starts_at timestamptz not null, ends_at timestamptz not null, reason text, created_at timestamptz default now());
create table public.push_subscriptions (id uuid primary key default gen_random_uuid(), barbershop_id uuid references public.barbershops(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade, endpoint text not null, p256dh text, user_agent text, created_at timestamptz default now());
create or replace function public.is_platform_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_platform_admin from public.profiles where id = auth.uid()), false) $$;
-- políticas antigas permissivas (devem ser removidas pela migration)
alter table public.barbershops enable row level security;
create policy "public read barbershops" on public.barbershops for select using (true);
alter table public.services enable row level security;
create policy "public read services" on public.services for select using (true);
alter table public.business_hours enable row level security;
create policy "public read hours" on public.business_hours for select using (true);
alter table public.barbershop_settings enable row level security;
create policy "public read settings" on public.barbershop_settings for select using (true);
alter table public.profiles enable row level security;
create policy "own profile" on public.profiles for all using (id = auth.uid());
grant select on all tables in schema public to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
-- dados existentes
insert into public.barbershops (id, name, slug, status, plan, owner_name, is_demo) values
  ('11b26428-f91f-4fc4-b910-31788c443ca1', 'Barbearia Vision', 'barbearia-vision', 'demo', 'complete', 'Visionário Dev', true),
  ('94dd3644-3fc6-4399-adc3-0e0aebd175eb', 'Barbearia teste 1', 'barbearia-teste-1', 'active', 'complete', 'Ricardo', false);
insert into public.services (barbershop_id, name, price, duration_minutes, sort_order) values
  ('11b26428-f91f-4fc4-b910-31788c443ca1', 'Corte', 35, 30, 1),
  ('11b26428-f91f-4fc4-b910-31788c443ca1', 'Barba', 25, 30, 2),
  ('11b26428-f91f-4fc4-b910-31788c443ca1', 'Corte + Barba', 55, 60, 3);
insert into public.business_hours (barbershop_id, weekday, is_open, opens_at, closes_at)
  select '11b26428-f91f-4fc4-b910-31788c443ca1', d, d <> 0, case when d <> 0 then '09:00'::time end, case when d <> 0 then '19:00'::time end from generate_series(0,6) d;
insert into public.business_hours (barbershop_id, weekday, is_open, opens_at, closes_at)
  select '94dd3644-3fc6-4399-adc3-0e0aebd175eb', d, d <> 0, case when d <> 0 then '09:00'::time end, case when d <> 0 then '19:00'::time end from generate_series(0,6) d;
insert into public.barbershop_settings (barbershop_id, chatbot_name, chatbot_greeting) values
  ('11b26428-f91f-4fc4-b910-31788c443ca1', 'Vision Bot', 'Olá!'), ('94dd3644-3fc6-4399-adc3-0e0aebd175eb', 'Bot', 'Olá!');
