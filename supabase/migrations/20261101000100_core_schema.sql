-- =====================================================================
-- BarberSaaS · 01 · Schema base multi-tenant
-- Idempotente: pode ser aplicada sobre o schema que já existia em produção
-- (profiles, barbershops, barbershop_members, services, clients,
--  appointments, business_hours, barbershop_settings, blocked_times,
--  push_subscriptions).
-- =====================================================================

create extension if not exists btree_gist with schema extensions;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, anon, service_role;

-- ---------------------------------------------------------------------
-- Utilitários
-- ---------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Normaliza telefone brasileiro para apenas dígitos com DDI 55.
create or replace function private.normalize_phone(p text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p is null then null
    when length(regexp_replace(p, '\D', '', 'g')) in (10, 11)
      then '55' || regexp_replace(p, '\D', '', 'g')
    when regexp_replace(p, '\D', '', 'g') = '' then null
    else regexp_replace(p, '\D', '', 'g')
  end
$$;

-- ---------------------------------------------------------------------
-- Administradores da plataforma (autorização NUNCA vem de user_metadata)
-- ---------------------------------------------------------------------
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists last_seen_at timestamptz;

-- ---------------------------------------------------------------------
-- barbershops
-- ---------------------------------------------------------------------
create table if not exists public.barbershops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active',
  plan text not null default 'complete',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.barbershops add column if not exists owner_name text;
alter table public.barbershops add column if not exists phone text;
alter table public.barbershops add column if not exists whatsapp text;
alter table public.barbershops add column if not exists address text;
alter table public.barbershops add column if not exists instagram text;
alter table public.barbershops add column if not exists facebook text;
alter table public.barbershops add column if not exists tiktok text;
alter table public.barbershops add column if not exists logo_url text;
alter table public.barbershops add column if not exists description text;
alter table public.barbershops add column if not exists review_link text;
alter table public.barbershops add column if not exists maps_link text;
alter table public.barbershops add column if not exists public_status_text text default 'Aberto agora';
alter table public.barbershops add column if not exists theme text default 'cyan';
alter table public.barbershops add column if not exists primary_color text default '#08a9df';
alter table public.barbershops add column if not exists background_color text default '#0b1220';
alter table public.barbershops add column if not exists card_color text default '#131e31';
alter table public.barbershops add column if not exists is_demo boolean not null default false;
-- novos
alter table public.barbershops add column if not exists owner_user_id uuid references auth.users(id) on delete set null;
alter table public.barbershops add column if not exists owner_email text;
alter table public.barbershops add column if not exists email text;
alter table public.barbershops add column if not exists google_rating numeric(2,1) default 5.0;
alter table public.barbershops add column if not exists instagram_enabled boolean not null default true;
alter table public.barbershops add column if not exists whatsapp_enabled boolean not null default true;
alter table public.barbershops add column if not exists facebook_enabled boolean not null default false;
alter table public.barbershops add column if not exists tiktok_enabled boolean not null default false;
alter table public.barbershops add column if not exists background_image_url text;
alter table public.barbershops add column if not exists timezone text not null default 'America/Sao_Paulo';
alter table public.barbershops add column if not exists slot_interval_minutes integer not null default 15;
alter table public.barbershops add column if not exists min_notice_minutes integer not null default 30;
alter table public.barbershops add column if not exists max_days_ahead integer not null default 30;
alter table public.barbershops add column if not exists suspended_at timestamptz;
alter table public.barbershops add column if not exists cancelled_at timestamptz;
alter table public.barbershops add column if not exists admin_notes text;

update public.barbershops set status = 'active' where status is null or status not in ('active','suspended','cancelled','demo');
update public.barbershops set plan = 'complete' where plan is null or plan not in ('chatbot','site','complete');

alter table public.barbershops drop constraint if exists barbershops_status_check;
alter table public.barbershops add constraint barbershops_status_check check (status in ('active','suspended','cancelled','demo'));
alter table public.barbershops drop constraint if exists barbershops_plan_check;
alter table public.barbershops add constraint barbershops_plan_check check (plan in ('chatbot','site','complete'));
alter table public.barbershops drop constraint if exists barbershops_slug_format;
alter table public.barbershops add constraint barbershops_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 60);
alter table public.barbershops drop constraint if exists barbershops_booking_rules;
alter table public.barbershops add constraint barbershops_booking_rules check (
  slot_interval_minutes between 5 and 120 and min_notice_minutes between 0 and 10080 and max_days_ahead between 1 and 365);
alter table public.barbershops drop constraint if exists barbershops_theme_check;
alter table public.barbershops add constraint barbershops_theme_check check (theme is null or theme in ('cyan','gold','light','red'));
create index if not exists barbershops_owner_user_idx on public.barbershops(owner_user_id);
create index if not exists barbershops_owner_email_idx on public.barbershops(lower(owner_email));

drop trigger if exists barbershops_updated_at on public.barbershops;
create trigger barbershops_updated_at before update on public.barbershops
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- barbershop_members (usuário ↔ barbearia)
-- ---------------------------------------------------------------------
create table if not exists public.barbershop_members (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner',
  created_at timestamptz not null default now()
);
update public.barbershop_members set role = 'owner' where role is null or role not in ('owner','manager','staff');
alter table public.barbershop_members drop constraint if exists barbershop_members_role_check;
alter table public.barbershop_members add constraint barbershop_members_role_check check (role in ('owner','manager','staff'));
create unique index if not exists barbershop_members_unique on public.barbershop_members(barbershop_id, user_id);
create index if not exists barbershop_members_user_idx on public.barbershop_members(user_id);

-- ---------------------------------------------------------------------
-- barbershop_settings
-- ---------------------------------------------------------------------
create table if not exists public.barbershop_settings (
  barbershop_id uuid primary key references public.barbershops(id) on delete cascade,
  site_enabled boolean not null default true,
  chatbot_enabled boolean not null default true,
  chatbot_name text default 'Assistente Barber',
  chatbot_greeting text default 'Olá! Vou te ajudar a agendar seu horário.',
  chatbot_sync_with_site boolean not null default true,
  chatbot_theme text default 'cyan',
  updated_at timestamptz not null default now()
);
alter table public.barbershop_settings add column if not exists reminder_minutes integer not null default 30;
alter table public.barbershop_settings drop constraint if exists barbershop_settings_reminder_check;
alter table public.barbershop_settings add constraint barbershop_settings_reminder_check check (reminder_minutes between 5 and 1440);
drop trigger if exists barbershop_settings_updated_at on public.barbershop_settings;
create trigger barbershop_settings_updated_at before update on public.barbershop_settings
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- services
-- ---------------------------------------------------------------------
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  name text not null,
  description text,
  price numeric(10,2) not null default 0,
  duration_minutes integer not null default 30,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.services add column if not exists image_url text;
alter table public.services drop constraint if exists services_values_check;
alter table public.services add constraint services_values_check check (price >= 0 and duration_minutes between 5 and 600 and length(trim(name)) > 0);
create unique index if not exists services_id_shop_key on public.services(id, barbershop_id);
create index if not exists services_shop_idx on public.services(barbershop_id, sort_order);
drop trigger if exists services_updated_at on public.services;
create trigger services_updated_at before update on public.services
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- professionals (barbeiros). user_id opcional: preparado para login futuro.
-- ---------------------------------------------------------------------
create table if not exists public.professionals (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null check (length(trim(name)) > 0),
  phone text,
  specialty text,
  photo_url text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists professionals_id_shop_key on public.professionals(id, barbershop_id);
create unique index if not exists professionals_user_unique on public.professionals(barbershop_id, user_id) where user_id is not null;
create index if not exists professionals_shop_idx on public.professionals(barbershop_id, sort_order);
create index if not exists professionals_user_idx on public.professionals(user_id) where user_id is not null;
drop trigger if exists professionals_updated_at on public.professionals;
create trigger professionals_updated_at before update on public.professionals
  for each row execute function private.set_updated_at();

-- Quais serviços cada profissional realiza. Profissional sem nenhuma linha = realiza todos.
create table if not exists public.professional_services (
  professional_id uuid not null,
  service_id uuid not null,
  barbershop_id uuid not null,
  primary key (professional_id, service_id),
  foreign key (professional_id, barbershop_id) references public.professionals(id, barbershop_id) on delete cascade,
  foreign key (service_id, barbershop_id) references public.services(id, barbershop_id) on delete cascade
);
create index if not exists professional_services_service_idx on public.professional_services(service_id);
create index if not exists professional_services_shop_idx on public.professional_services(barbershop_id);

-- Horário individual (opcional). Sem linha para o dia = segue o horário da barbearia.
create table if not exists public.professional_hours (
  professional_id uuid not null,
  barbershop_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  is_working boolean not null default true,
  opens_at time,
  closes_at time,
  break_start time,
  break_end time,
  primary key (professional_id, weekday),
  foreign key (professional_id, barbershop_id) references public.professionals(id, barbershop_id) on delete cascade,
  check (not is_working or opens_at is null or closes_at is null or opens_at < closes_at),
  check ((break_start is null) = (break_end is null) and (break_start is null or break_start < break_end))
);
create index if not exists professional_hours_shop_idx on public.professional_hours(barbershop_id);

-- ---------------------------------------------------------------------
-- business_hours (horário semanal da barbearia)
-- ---------------------------------------------------------------------
create table if not exists public.business_hours (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  weekday smallint not null,
  is_open boolean not null default true,
  opens_at time,
  closes_at time
);
alter table public.business_hours add column if not exists break_start time;
alter table public.business_hours add column if not exists break_end time;
alter table public.business_hours drop constraint if exists business_hours_weekday_check;
alter table public.business_hours add constraint business_hours_weekday_check check (weekday between 0 and 6);
alter table public.business_hours drop constraint if exists business_hours_times_check;
alter table public.business_hours add constraint business_hours_times_check check (
  (not is_open or (opens_at is not null and closes_at is not null and opens_at < closes_at))
  and ((break_start is null) = (break_end is null))
  and (break_start is null or break_start < break_end));
create unique index if not exists business_hours_shop_weekday on public.business_hours(barbershop_id, weekday);

-- Horários especiais (feriado, dia fechado, expediente diferente numa data)
create table if not exists public.special_days (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  date date not null,
  is_closed boolean not null default true,
  opens_at time,
  closes_at time,
  break_start time,
  break_end time,
  note text,
  created_at timestamptz not null default now(),
  unique (barbershop_id, date),
  check (is_closed or (opens_at is not null and closes_at is not null and opens_at < closes_at)),
  check ((break_start is null) = (break_end is null) and (break_start is null or break_start < break_end))
);

-- ---------------------------------------------------------------------
-- blocked_times (bloqueio geral: professional_id nulo; ou por profissional)
-- ---------------------------------------------------------------------
create table if not exists public.blocked_times (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.blocked_times add column if not exists professional_id uuid;
alter table public.blocked_times add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.blocked_times drop constraint if exists blocked_times_range_check;
alter table public.blocked_times add constraint blocked_times_range_check check (ends_at > starts_at);
alter table public.blocked_times drop constraint if exists blocked_times_professional_fk;
alter table public.blocked_times add constraint blocked_times_professional_fk
  foreign key (professional_id, barbershop_id) references public.professionals(id, barbershop_id) on delete cascade;
create index if not exists blocked_times_shop_range on public.blocked_times using gist (barbershop_id, tstzrange(starts_at, ends_at));
create index if not exists blocked_times_professional_idx on public.blocked_times(professional_id) where professional_id is not null;

-- ---------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  name text not null,
  phone text,
  whatsapp text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create or replace function private.clients_normalize()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.whatsapp := private.normalize_phone(new.whatsapp);
  new.phone := nullif(regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), '');
  new.name := trim(new.name);
  return new;
end $$;
drop trigger if exists clients_normalize on public.clients;
create trigger clients_normalize before insert or update on public.clients
  for each row execute function private.clients_normalize();
drop trigger if exists clients_updated_at on public.clients;
create trigger clients_updated_at before update on public.clients
  for each row execute function private.set_updated_at();
update public.clients set whatsapp = whatsapp; -- reaplica normalização
create unique index if not exists clients_id_shop_key on public.clients(id, barbershop_id);
-- Mesmo WhatsApp não duplica dentro da barbearia; pode existir em barbearias diferentes.
create unique index if not exists clients_shop_whatsapp_unique on public.clients(barbershop_id, whatsapp) where whatsapp is not null;
create index if not exists clients_shop_name_idx on public.clients(barbershop_id, lower(name));

-- ---------------------------------------------------------------------
-- appointments
-- ---------------------------------------------------------------------
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  client_id uuid,
  service_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmed',
  price numeric(10,2) not null default 0,
  notes text,
  client_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.appointments add column if not exists professional_id uuid;
alter table public.appointments add column if not exists client_phone text;
alter table public.appointments add column if not exists service_name text;
alter table public.appointments add column if not exists duration_minutes integer;
alter table public.appointments add column if not exists source text not null default 'panel';
alter table public.appointments add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.appointments add column if not exists cancelled_at timestamptz;
alter table public.appointments add column if not exists completed_at timestamptz;
alter table public.appointments add column if not exists no_show_at timestamptz;
alter table public.appointments add column if not exists cancel_reason text;
alter table public.appointments add column if not exists reminder_sent_at timestamptz;

update public.appointments set status = case lower(status)
  when 'confirmado' then 'confirmed' when 'pending' then 'confirmed' when 'pendente' then 'confirmed'
  when 'concluido' then 'completed' when 'concluído' then 'completed' when 'done' then 'completed'
  when 'cancelado' then 'cancelled' when 'canceled' then 'cancelled'
  when 'faltou' then 'no_show' when 'noshow' then 'no_show'
  else lower(status) end
where status not in ('confirmed','completed','cancelled','no_show');
update public.appointments set status = 'confirmed' where status not in ('confirmed','completed','cancelled','no_show');

alter table public.appointments drop constraint if exists appointments_status_check;
alter table public.appointments add constraint appointments_status_check check (status in ('confirmed','completed','cancelled','no_show'));
alter table public.appointments drop constraint if exists appointments_source_check;
alter table public.appointments add constraint appointments_source_check check (source in ('panel','site','chatbot'));
alter table public.appointments drop constraint if exists appointments_range_check;
alter table public.appointments add constraint appointments_range_check check (ends_at > starts_at and price >= 0);

-- Integridade multi-tenant: serviço/cliente/profissional precisam ser da MESMA barbearia.
alter table public.appointments drop constraint if exists appointments_service_shop_fk;
alter table public.appointments add constraint appointments_service_shop_fk
  foreign key (service_id, barbershop_id) references public.services(id, barbershop_id) on delete restrict;
alter table public.appointments drop constraint if exists appointments_client_shop_fk;
alter table public.appointments add constraint appointments_client_shop_fk
  foreign key (client_id, barbershop_id) references public.clients(id, barbershop_id) on delete restrict;
alter table public.appointments drop constraint if exists appointments_professional_shop_fk;
alter table public.appointments add constraint appointments_professional_shop_fk
  foreign key (professional_id, barbershop_id) references public.professionals(id, barbershop_id) on delete restrict;

create index if not exists appointments_shop_start_idx on public.appointments(barbershop_id, starts_at);
create index if not exists appointments_client_idx on public.appointments(client_id);
create index if not exists appointments_service_idx on public.appointments(service_id);
create index if not exists appointments_professional_start_idx on public.appointments(professional_id, starts_at);
create index if not exists appointments_reminder_idx on public.appointments(starts_at) where status = 'confirmed' and reminder_sent_at is null;

drop trigger if exists appointments_updated_at on public.appointments;
create trigger appointments_updated_at before update on public.appointments
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- Onboarding automático: toda barbearia nova nasce pronta para uso.
-- ---------------------------------------------------------------------
create or replace function private.bootstrap_barbershop(p_shop uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_shop public.barbershops;
begin
  select * into v_shop from public.barbershops where id = p_shop;
  if not found then return; end if;

  insert into public.barbershop_settings (barbershop_id, chatbot_name, chatbot_greeting, chatbot_theme)
  values (p_shop, 'Assistente ' || split_part(v_shop.name, ' ', 1), 'Olá! Vou te ajudar a agendar seu horário.', coalesce(v_shop.theme, 'cyan'))
  on conflict (barbershop_id) do nothing;

  insert into public.business_hours (barbershop_id, weekday, is_open, opens_at, closes_at, break_start, break_end)
  select p_shop, d,
         d <> 0,
         case when d = 0 then null when d = 6 then time '09:00' else time '09:00' end,
         case when d = 0 then null when d = 6 then time '17:00' else time '19:00' end,
         case when d between 1 and 5 then time '12:00' end,
         case when d between 1 and 5 then time '13:00' end
  from generate_series(0, 6) d
  on conflict (barbershop_id, weekday) do nothing;

  if not exists (select 1 from public.professionals where barbershop_id = p_shop) then
    insert into public.professionals (barbershop_id, name, user_id, sort_order)
    values (p_shop, coalesce(nullif(trim(v_shop.owner_name), ''), 'Profissional'), v_shop.owner_user_id, 0);
  end if;
end $$;

create or replace function private.barbershops_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.bootstrap_barbershop(new.id);
  return null;
end $$;
drop trigger if exists barbershops_bootstrap on public.barbershops;
create trigger barbershops_bootstrap after insert on public.barbershops
  for each row execute function private.barbershops_after_insert();

-- Backfill das barbearias existentes (não sobrescreve nada que já exista)
do $$
declare r record;
begin
  for r in select id from public.barbershops loop
    perform private.bootstrap_barbershop(r.id);
  end loop;
end $$;

-- Agendamentos antigos sem profissional recebem o primeiro profissional da barbearia
update public.appointments a
set professional_id = (select p.id from public.professionals p where p.barbershop_id = a.barbershop_id order by p.sort_order, p.created_at limit 1)
where a.professional_id is null;
do $$
begin
  if not exists (select 1 from public.appointments where professional_id is null) then
    alter table public.appointments alter column professional_id set not null;
  end if;
end $$;

-- Proteção definitiva contra conflito/concorrência no banco:
-- o mesmo profissional nunca tem dois atendimentos ativos sobrepostos.
alter table public.appointments drop constraint if exists appointments_no_overlap;
alter table public.appointments add constraint appointments_no_overlap
  exclude using gist (professional_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
  where (status in ('confirmed', 'completed'));

-- ---------------------------------------------------------------------
-- Rate limit do agendamento público e auditoria
-- ---------------------------------------------------------------------
create table if not exists public.booking_rate_events (
  id bigint generated always as identity primary key,
  bucket text not null,
  created_at timestamptz not null default now()
);
create index if not exists booking_rate_events_bucket_idx on public.booking_rate_events(bucket, created_at);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  barbershop_id uuid references public.barbershops(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_shop_idx on public.audit_log(barbershop_id, created_at desc);
create index if not exists audit_log_actor_idx on public.audit_log(actor_id);
