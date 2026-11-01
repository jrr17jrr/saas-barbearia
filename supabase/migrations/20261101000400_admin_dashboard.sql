-- =====================================================================
-- BarberSaaS · 04 · Administração DEV, dashboard, financeiro, clientes
-- Regra de faturamento: SOMENTE atendimentos com status 'completed'.
-- 'cancelled' e 'no_show' nunca somam receita. 'confirmed' = previsão.
-- =====================================================================

create or replace function private.require_admin()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
end $$;

create or replace function private.slugify(p text)
returns text language sql immutable set search_path = '' as $$
  select trim(both '-' from regexp_replace(
    translate(lower(coalesce(p, '')),
      'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
    '[^a-z0-9]+', '-', 'g'));
$$;

-- ---------------------------------------------------------------------
-- DEV: listagem com métricas
-- ---------------------------------------------------------------------
create or replace function public.admin_list_barbershops(p_search text default null)
returns table(
  id uuid, name text, slug text, status text, plan text, owner_name text, owner_email text,
  owner_user_id uuid, whatsapp text, address text, created_at timestamptz, last_access_at timestamptz,
  clients_count bigint, appointments_count bigint, upcoming_count bigint, members_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return query
  select b.id, b.name, b.slug, b.status, b.plan, b.owner_name,
    coalesce(b.owner_email, (select u.email::text from auth.users u where u.id = b.owner_user_id)),
    b.owner_user_id, b.whatsapp, b.address, b.created_at,
    (select max(pr.last_seen_at) from public.barbershop_members m join public.profiles pr on pr.id = m.user_id where m.barbershop_id = b.id),
    (select count(*) from public.clients c where c.barbershop_id = b.id),
    (select count(*) from public.appointments a where a.barbershop_id = b.id),
    (select count(*) from public.appointments a where a.barbershop_id = b.id and a.status = 'confirmed' and a.starts_at > now()),
    (select count(*) from public.barbershop_members m where m.barbershop_id = b.id)
  from public.barbershops b
  where p_search is null or p_search = ''
     or b.name ilike '%' || p_search || '%' or b.slug ilike '%' || p_search || '%'
     or coalesce(b.owner_name, '') ilike '%' || p_search || '%'
     or coalesce(b.owner_email, '') ilike '%' || p_search || '%'
     or coalesce(b.whatsapp, '') like '%' || regexp_replace(p_search, '\D', '', 'g') || '%' and regexp_replace(p_search, '\D', '', 'g') <> ''
  order by b.created_at desc;
end $$;

-- DEV: criar barbearia (onboarding completo via trigger bootstrap)
create or replace function public.admin_create_barbershop(
  p_name text, p_slug text default null, p_owner_name text default null, p_owner_email text default null,
  p_whatsapp text default null, p_address text default null, p_plan text default 'complete',
  p_status text default 'active')
returns public.barbershops language plpgsql volatile security definer set search_path = '' as $$
declare v_slug text; v_base text; v_i int := 1; v_row public.barbershops; v_user uuid;
begin
  perform private.require_admin();
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'INVALID_NAME' using errcode = '22023'; end if;
  v_base := private.slugify(coalesce(nullif(trim(p_slug), ''), p_name));
  if length(v_base) < 3 then v_base := v_base || '-barbearia'; end if;
  v_slug := v_base;
  while exists (select 1 from public.barbershops where slug = v_slug) loop
    v_i := v_i + 1; v_slug := v_base || '-' || v_i;
  end loop;

  insert into public.barbershops (name, slug, owner_name, owner_email, whatsapp, phone, address, plan, status, is_demo)
  values (trim(p_name), v_slug, nullif(trim(coalesce(p_owner_name, '')), ''), nullif(lower(trim(coalesce(p_owner_email, ''))), ''),
    private.normalize_phone(p_whatsapp), private.normalize_phone(p_whatsapp), nullif(trim(coalesce(p_address, '')), ''),
    coalesce(p_plan, 'complete'), coalesce(p_status, 'active'), p_status = 'demo')
  returning * into v_row;

  -- Se o proprietário já tem conta confirmada, vincula imediatamente
  if v_row.owner_email is not null then
    select u.id into v_user from auth.users u where lower(u.email) = v_row.owner_email and u.email_confirmed_at is not null;
    if v_user is not null then
      insert into public.barbershop_members (barbershop_id, user_id, role) values (v_row.id, v_user, 'owner')
      on conflict (barbershop_id, user_id) do nothing;
      update public.barbershops set owner_user_id = v_user where id = v_row.id returning * into v_row;
      update public.professionals set user_id = v_user
      where barbershop_id = v_row.id and user_id is null
        and id = (select id from public.professionals where barbershop_id = v_row.id order by sort_order, created_at limit 1);
    end if;
  end if;

  insert into public.audit_log (actor_id, barbershop_id, action, details)
  values ((select auth.uid()), v_row.id, 'barbershop.create', jsonb_build_object('slug', v_slug, 'plan', v_row.plan, 'status', v_row.status));
  return v_row;
end $$;

-- DEV: editar qualquer campo (inclusive plano/status/slug)
create or replace function public.admin_update_barbershop(p_id uuid, p_patch jsonb)
returns public.barbershops language plpgsql volatile security definer set search_path = '' as $$
declare v_row public.barbershops; v_old public.barbershops; v_user uuid; v_slug text;
begin
  perform private.require_admin();
  select * into v_old from public.barbershops where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_patch ? 'slug' then
    v_slug := private.slugify(p_patch ->> 'slug');
    if exists (select 1 from public.barbershops where slug = v_slug and id <> p_id) then
      raise exception 'SLUG_TAKEN' using errcode = '23505'; end if;
  end if;

  update public.barbershops set
    name        = coalesce(nullif(trim(p_patch ->> 'name'), ''), name),
    slug        = coalesce(v_slug, slug),
    status      = coalesce(p_patch ->> 'status', status),
    plan        = coalesce(p_patch ->> 'plan', plan),
    owner_name  = case when p_patch ? 'owner_name' then nullif(trim(p_patch ->> 'owner_name'), '') else owner_name end,
    owner_email = case when p_patch ? 'owner_email' then nullif(lower(trim(p_patch ->> 'owner_email')), '') else owner_email end,
    whatsapp    = case when p_patch ? 'whatsapp' then private.normalize_phone(p_patch ->> 'whatsapp') else whatsapp end,
    address     = case when p_patch ? 'address' then nullif(trim(p_patch ->> 'address'), '') else address end,
    admin_notes = case when p_patch ? 'admin_notes' then p_patch ->> 'admin_notes' else admin_notes end
  where id = p_id returning * into v_row;

  if v_row.owner_email is not null and v_row.owner_email is distinct from v_old.owner_email then
    select u.id into v_user from auth.users u where lower(u.email) = v_row.owner_email and u.email_confirmed_at is not null;
    if v_user is not null then
      insert into public.barbershop_members (barbershop_id, user_id, role) values (p_id, v_user, 'owner')
      on conflict (barbershop_id, user_id) do nothing;
      update public.barbershops set owner_user_id = v_user where id = p_id returning * into v_row;
    end if;
  end if;

  insert into public.audit_log (actor_id, barbershop_id, action, details)
  values ((select auth.uid()), p_id, 'barbershop.update', p_patch - 'admin_notes');
  return v_row;
end $$;

-- DEV: registro de acesso em modo suporte (auditoria)
create or replace function public.admin_start_support(p_shop_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v public.barbershops;
begin
  perform private.require_admin();
  select * into v from public.barbershops where id = p_shop_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.audit_log (actor_id, barbershop_id, action) values ((select auth.uid()), p_shop_id, 'support.start');
  return jsonb_build_object('id', v.id, 'name', v.name, 'slug', v.slug);
end $$;

-- DEV: membros de uma barbearia
create or replace function public.admin_shop_members(p_shop_id uuid)
returns table(user_id uuid, email text, role text, last_seen_at timestamptz, confirmed boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return query select m.user_id, u.email::text, m.role, p.last_seen_at, u.email_confirmed_at is not null
  from public.barbershop_members m join auth.users u on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id where m.barbershop_id = p_shop_id order by m.created_at;
end $$;

-- DEV: remover vínculo de usuário
create or replace function public.admin_remove_member(p_shop_id uuid, p_user_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.require_admin();
  delete from public.barbershop_members where barbershop_id = p_shop_id and user_id = p_user_id;
  delete from public.push_subscriptions where barbershop_id = p_shop_id and user_id = p_user_id;
  insert into public.audit_log (actor_id, barbershop_id, action, details)
  values ((select auth.uid()), p_shop_id, 'member.remove', jsonb_build_object('user_id', p_user_id));
end $$;

-- ---------------------------------------------------------------------
-- Contexto do painel: quais barbearias o usuário acessa e com quais recursos
-- ---------------------------------------------------------------------
create or replace function public.my_context()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  return jsonb_build_object(
    'user_id', v_uid,
    'is_platform_admin', private.is_platform_admin(),
    'profile', (select jsonb_build_object('full_name', p.full_name, 'email', p.email) from public.profiles p where p.id = v_uid),
    'shops', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'name', b.name, 'slug', b.slug, 'status', b.status, 'plan', b.plan, 'role', m.role,
        'features', jsonb_build_object('site', private.plan_has(b.plan, 'site'), 'chatbot', private.plan_has(b.plan, 'chatbot')))
        order by m.created_at)
      from public.barbershop_members m join public.barbershops b on b.id = m.barbershop_id
      where m.user_id = v_uid), '[]'::jsonb));
end $$;

create or replace function public.shop_context(p_shop_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v public.barbershops; v_role text;
begin
  if not private.can_access_shop(p_shop_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into v from public.barbershops where id = p_shop_id;
  select role into v_role from public.barbershop_members where barbershop_id = p_shop_id and user_id = (select auth.uid());
  return jsonb_build_object('id', v.id, 'name', v.name, 'slug', v.slug, 'status', v.status, 'plan', v.plan,
    'timezone', v.timezone, 'role', coalesce(v_role, 'support'),
    'support_mode', v_role is null,
    'features', jsonb_build_object('site', private.plan_has(v.plan, 'site'), 'chatbot', private.plan_has(v.plan, 'chatbot')));
end $$;

create or replace function public.touch_last_seen()
returns void language sql volatile security definer set search_path = '' as $$
  update public.profiles set last_seen_at = now()
  where id = (select auth.uid()) and (last_seen_at is null or last_seen_at < now() - interval '5 minutes');
$$;

-- ---------------------------------------------------------------------
-- Dashboard (números reais)
-- ---------------------------------------------------------------------
create or replace function public.shop_dashboard(p_shop_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_tz text; v_today date; v_d0 timestamptz; v_d1 timestamptz; v_m0 timestamptz; v_m1 timestamptz;
begin
  if not private.can_access_shop(p_shop_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select timezone into v_tz from public.barbershops where id = p_shop_id;
  v_today := (now() at time zone v_tz)::date;
  v_d0 := v_today::timestamp at time zone v_tz; v_d1 := (v_today + 1)::timestamp at time zone v_tz;
  v_m0 := date_trunc('month', v_today)::timestamp at time zone v_tz;
  v_m1 := (date_trunc('month', v_today) + interval '1 month')::timestamp at time zone v_tz;

  return jsonb_build_object(
    'today', v_today,
    'today_total', (select count(*) from public.appointments where barbershop_id = p_shop_id and starts_at >= v_d0 and starts_at < v_d1 and status <> 'cancelled'),
    'today_confirmed', (select count(*) from public.appointments where barbershop_id = p_shop_id and starts_at >= v_d0 and starts_at < v_d1 and status = 'confirmed'),
    'today_completed', (select count(*) from public.appointments where barbershop_id = p_shop_id and starts_at >= v_d0 and starts_at < v_d1 and status = 'completed'),
    'yesterday_total', (select count(*) from public.appointments where barbershop_id = p_shop_id and starts_at >= v_d0 - interval '1 day' and starts_at < v_d0 and status <> 'cancelled'),
    'upcoming_count', (select count(*) from public.appointments where barbershop_id = p_shop_id and status = 'confirmed' and starts_at >= now()),
    'clients_total', (select count(*) from public.clients where barbershop_id = p_shop_id),
    'clients_month', (select count(distinct client_id) from public.appointments where barbershop_id = p_shop_id and starts_at >= v_m0 and starts_at < v_m1 and status in ('confirmed','completed')),
    'revenue_today', (select coalesce(sum(price), 0) from public.appointments where barbershop_id = p_shop_id and status = 'completed' and starts_at >= v_d0 and starts_at < v_d1),
    'revenue_week', (select coalesce(sum(price), 0) from public.appointments where barbershop_id = p_shop_id and status = 'completed' and starts_at >= (date_trunc('week', v_today)::timestamp at time zone v_tz) and starts_at < v_d1),
    'revenue_month', (select coalesce(sum(price), 0) from public.appointments where barbershop_id = p_shop_id and status = 'completed' and starts_at >= v_m0 and starts_at < v_m1),
    'expected_today', (select coalesce(sum(price), 0) from public.appointments where barbershop_id = p_shop_id and status = 'confirmed' and starts_at >= v_d0 and starts_at < v_d1),
    'month_completed', (select count(*) from public.appointments where barbershop_id = p_shop_id and status = 'completed' and starts_at >= v_m0 and starts_at < v_m1),
    'month_cancelled', (select count(*) from public.appointments where barbershop_id = p_shop_id and status = 'cancelled' and starts_at >= v_m0 and starts_at < v_m1),
    'month_no_show', (select count(*) from public.appointments where barbershop_id = p_shop_id and status = 'no_show' and starts_at >= v_m0 and starts_at < v_m1),
    'top_service', (select jsonb_build_object('name', service_name, 'count', count(*)) from public.appointments
       where barbershop_id = p_shop_id and status = 'completed' and starts_at >= v_m0 and starts_at < v_m1
       group by service_name order by count(*) desc, service_name limit 1),
    'top_professional', (select jsonb_build_object('name', p.name, 'count', count(*)) from public.appointments a
       join public.professionals p on p.id = a.professional_id
       where a.barbershop_id = p_shop_id and a.status = 'completed' and a.starts_at >= v_m0 and a.starts_at < v_m1
       group by p.name order by count(*) desc, p.name limit 1),
    'today_list', coalesce((select jsonb_agg(x order by x.starts_at) from (
       select a.id, a.starts_at, a.ends_at, a.client_name, a.service_name, a.status, a.price, p.name as professional_name
       from public.appointments a left join public.professionals p on p.id = a.professional_id
       where a.barbershop_id = p_shop_id and a.starts_at >= v_d0 and a.starts_at < v_d1 order by a.starts_at limit 50) x), '[]'::jsonb),
    'next_list', coalesce((select jsonb_agg(x order by x.starts_at) from (
       select a.id, a.starts_at, a.client_name, a.service_name, p.name as professional_name
       from public.appointments a left join public.professionals p on p.id = a.professional_id
       where a.barbershop_id = p_shop_id and a.status = 'confirmed' and a.starts_at >= now() order by a.starts_at limit 6) x), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------
-- Financeiro
-- ---------------------------------------------------------------------
create or replace function public.shop_finance(p_shop_id uuid, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_tz text; v_today date; v_from date; v_to date; v_f timestamptz; v_t timestamptz;
begin
  if not private.can_access_shop(p_shop_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select timezone into v_tz from public.barbershops where id = p_shop_id;
  v_today := (now() at time zone v_tz)::date;
  v_from := coalesce(p_from, date_trunc('month', v_today)::date);
  v_to := coalesce(p_to, v_today);
  if v_to < v_from or v_to - v_from > 400 then raise exception 'INVALID_RANGE' using errcode = '22023'; end if;
  v_f := v_from::timestamp at time zone v_tz; v_t := (v_to + 1)::timestamp at time zone v_tz;

  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'revenue_today', (select coalesce(sum(price), 0) from public.appointments where barbershop_id = p_shop_id and status = 'completed'
       and starts_at >= v_today::timestamp at time zone v_tz and starts_at < (v_today + 1)::timestamp at time zone v_tz),
    'revenue_week', (select coalesce(sum(price), 0) from public.appointments where barbershop_id = p_shop_id and status = 'completed'
       and starts_at >= date_trunc('week', v_today)::timestamp at time zone v_tz and starts_at < (v_today + 1)::timestamp at time zone v_tz),
    'revenue_month', (select coalesce(sum(price), 0) from public.appointments where barbershop_id = p_shop_id and status = 'completed'
       and starts_at >= date_trunc('month', v_today)::timestamp at time zone v_tz and starts_at < (date_trunc('month', v_today) + interval '1 month')::timestamp at time zone v_tz),
    'revenue_prev_month', (select coalesce(sum(price), 0) from public.appointments where barbershop_id = p_shop_id and status = 'completed'
       and starts_at >= (date_trunc('month', v_today) - interval '1 month')::timestamp at time zone v_tz and starts_at < date_trunc('month', v_today)::timestamp at time zone v_tz),
    'period', (select jsonb_build_object(
        'revenue', coalesce(sum(price) filter (where status = 'completed'), 0),
        'completed', count(*) filter (where status = 'completed'),
        'cancelled', count(*) filter (where status = 'cancelled'),
        'no_show', count(*) filter (where status = 'no_show'),
        'confirmed', count(*) filter (where status = 'confirmed'),
        'expected', coalesce(sum(price) filter (where status = 'confirmed'), 0),
        'avg_ticket', coalesce(round(avg(price) filter (where status = 'completed'), 2), 0))
      from public.appointments where barbershop_id = p_shop_id and starts_at >= v_f and starts_at < v_t),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('date', d, 'revenue', r, 'count', c) order by d) from (
        select (starts_at at time zone v_tz)::date d, sum(price) r, count(*) c from public.appointments
        where barbershop_id = p_shop_id and status = 'completed' and starts_at >= v_f and starts_at < v_t group by 1) x), '[]'::jsonb),
    'by_service', coalesce((select jsonb_agg(jsonb_build_object('name', n, 'revenue', r, 'count', c) order by r desc) from (
        select coalesce(service_name, 'Serviço') n, sum(price) r, count(*) c from public.appointments
        where barbershop_id = p_shop_id and status = 'completed' and starts_at >= v_f and starts_at < v_t group by 1) x), '[]'::jsonb),
    'by_professional', coalesce((select jsonb_agg(jsonb_build_object('name', n, 'revenue', r, 'count', c) order by r desc) from (
        select p.name n, sum(a.price) r, count(*) c from public.appointments a join public.professionals p on p.id = a.professional_id
        where a.barbershop_id = p_shop_id and a.status = 'completed' and a.starts_at >= v_f and a.starts_at < v_t group by 1) x), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(x order by x.starts_at desc) from (
        select a.id, a.starts_at, a.client_name, a.service_name, a.price, a.status, p.name as professional_name
        from public.appointments a left join public.professionals p on p.id = a.professional_id
        where a.barbershop_id = p_shop_id and a.starts_at >= v_f and a.starts_at < v_t and a.status in ('completed','cancelled','no_show')
        order by a.starts_at desc limit 200) x), '[]'::jsonb),
    'monthly', coalesce((select jsonb_agg(jsonb_build_object('month', m, 'revenue', r, 'count', c) order by m) from (
        select to_char(date_trunc('month', starts_at at time zone v_tz), 'YYYY-MM') m, sum(price) r, count(*) c
        from public.appointments where barbershop_id = p_shop_id and status = 'completed'
          and starts_at >= (date_trunc('month', v_today) - interval '5 months')::timestamp at time zone v_tz
        group by 1) x), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------
-- Clientes com estatísticas reais
-- ---------------------------------------------------------------------
create or replace function public.shop_clients(p_shop_id uuid, p_search text default null, p_limit int default 200)
returns table(id uuid, name text, whatsapp text, phone text, notes text, created_at timestamptz,
  visits_count bigint, total_spent numeric, first_visit_at timestamptz, last_visit_at timestamptz,
  next_appointment_at timestamptz, no_show_count bigint, favorite_service text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_access_shop(p_shop_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return query
  select c.id, c.name, c.whatsapp, c.phone, c.notes, c.created_at,
    count(a.id) filter (where a.status = 'completed'),
    coalesce(sum(a.price) filter (where a.status = 'completed'), 0),
    min(a.starts_at) filter (where a.status = 'completed'),
    max(a.starts_at) filter (where a.status = 'completed'),
    min(a.starts_at) filter (where a.status = 'confirmed' and a.starts_at > now()),
    count(a.id) filter (where a.status = 'no_show'),
    (select a2.service_name from public.appointments a2 where a2.client_id = c.id and a2.status = 'completed'
      group by a2.service_name order by count(*) desc limit 1)
  from public.clients c
  left join public.appointments a on a.client_id = c.id
  where c.barbershop_id = p_shop_id
    and (p_search is null or p_search = '' or c.name ilike '%' || p_search || '%'
         or (regexp_replace(p_search, '\D', '', 'g') <> '' and c.whatsapp like '%' || regexp_replace(p_search, '\D', '', 'g') || '%'))
  group by c.id
  order by count(a.id) filter (where a.status = 'completed') desc, c.name
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end $$;
