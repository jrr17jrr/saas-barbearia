-- =====================================================================
-- BarberSaaS · 03 · Motor ÚNICO de disponibilidade + agendamento
-- Site, chatbot e painel usam exatamente private.compute_slots().
-- =====================================================================

-- Expediente efetivo de um profissional numa data (já considerando
-- dia especial, horário da barbearia e horário individual).
create or replace function private.effective_hours(p_professional uuid, p_date date)
returns table(opens_at time, closes_at time, break1_start time, break1_end time, break2_start time, break2_end time)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_shop uuid; v_wd int := extract(dow from p_date)::int;
  v_open time; v_close time; v_b1s time; v_b1e time;
  v_sd public.special_days; v_bh public.business_hours; v_ph public.professional_hours;
begin
  select barbershop_id into v_shop from public.professionals where id = p_professional;
  if v_shop is null then return; end if;

  select * into v_sd from public.special_days where barbershop_id = v_shop and date = p_date;
  if found then
    if v_sd.is_closed then return; end if;
    v_open := v_sd.opens_at; v_close := v_sd.closes_at; v_b1s := v_sd.break_start; v_b1e := v_sd.break_end;
  else
    select * into v_bh from public.business_hours where barbershop_id = v_shop and weekday = v_wd;
    if not found or not v_bh.is_open then return; end if;
    v_open := v_bh.opens_at; v_close := v_bh.closes_at; v_b1s := v_bh.break_start; v_b1e := v_bh.break_end;
  end if;

  select * into v_ph from public.professional_hours where professional_id = p_professional and weekday = v_wd;
  if found then
    if not v_ph.is_working then return; end if;
    v_open := greatest(v_open, coalesce(v_ph.opens_at, v_open));
    v_close := least(v_close, coalesce(v_ph.closes_at, v_close));
  end if;
  if v_open is null or v_close is null or v_open >= v_close then return; end if;

  return query select v_open, v_close, v_b1s, v_b1e,
    case when v_ph.professional_id is not null then v_ph.break_start end,
    case when v_ph.professional_id is not null then v_ph.break_end end;
end $$;

-- Núcleo do cálculo de horários livres.
--   p_professional nulo = todos os profissionais aptos ao serviço.
--   p_enforce_window   = aplica antecedência mínima/limite de dias (público). O painel
--                        pode lançar encaixes no passado/futuro distante, mas NUNCA conflitos.
create or replace function private.compute_slots(
  p_shop uuid, p_service uuid, p_professional uuid, p_date date,
  p_exclude_appointment uuid default null, p_enforce_window boolean default true)
returns table(starts_at timestamptz, ends_at timestamptz, professional_id uuid, professional_sort int)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_shop public.barbershops; v_dur int; v_tz text; v_step int; v_today date;
begin
  select * into v_shop from public.barbershops where id = p_shop;
  if not found then return; end if;
  select s.duration_minutes into v_dur from public.services s
    where s.id = p_service and s.barbershop_id = p_shop and s.active;
  if v_dur is null then return; end if;

  v_tz := coalesce(v_shop.timezone, 'America/Sao_Paulo');
  v_step := greatest(5, coalesce(v_shop.slot_interval_minutes, 15));
  v_today := (now() at time zone v_tz)::date;
  if p_enforce_window and (p_date < v_today or p_date > v_today + v_shop.max_days_ahead) then return; end if;

  return query
  with pros as (
    select p.id, p.sort_order from public.professionals p
    where p.barbershop_id = p_shop and p.active
      and (p_professional is null or p.id = p_professional)
      and (not exists (select 1 from public.professional_services ps where ps.professional_id = p.id)
           or exists (select 1 from public.professional_services ps where ps.professional_id = p.id and ps.service_id = p_service))
  ), hrs as (
    select pr.id, pr.sort_order, h.*
    from pros pr cross join lateral private.effective_hours(pr.id, p_date) h
  ), cand as (
    select h.id as pid, h.sort_order, g.t as s, g.t + make_interval(mins => v_dur) as e,
      h.break1_start, h.break1_end, h.break2_start, h.break2_end
    from hrs h
    cross join lateral generate_series(
      (p_date + h.opens_at) at time zone v_tz,
      ((p_date + h.closes_at) at time zone v_tz) - make_interval(mins => v_dur),
      make_interval(mins => v_step)) as g(t)
  )
  select c.s, c.e, c.pid, c.sort_order
  from cand c
  where (not p_enforce_window or c.s >= now() + make_interval(mins => v_shop.min_notice_minutes))
    and (c.break1_start is null or not (tstzrange(c.s, c.e, '[)') && tstzrange((p_date + c.break1_start) at time zone v_tz, (p_date + c.break1_end) at time zone v_tz, '[)')))
    and (c.break2_start is null or not (tstzrange(c.s, c.e, '[)') && tstzrange((p_date + c.break2_start) at time zone v_tz, (p_date + c.break2_end) at time zone v_tz, '[)')))
    and not exists (
      select 1 from public.blocked_times b
      where b.barbershop_id = p_shop and (b.professional_id is null or b.professional_id = c.pid)
        and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(c.s, c.e, '[)'))
    and not exists (
      select 1 from public.appointments a
      where a.professional_id = c.pid and a.status in ('confirmed', 'completed')
        and (p_exclude_appointment is null or a.id <> p_exclude_appointment)
        and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(c.s, c.e, '[)'))
  order by c.s, c.sort_order;
end $$;

-- Barbearia publicamente disponível para um canal (site/chatbot)?
create or replace function private.public_shop(p_slug text, p_channel text)
returns public.barbershops language plpgsql stable security definer set search_path = '' as $$
declare v public.barbershops; v_set public.barbershop_settings;
begin
  select * into v from public.barbershops where slug = lower(trim(p_slug));
  if not found then raise exception 'SHOP_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.status not in ('active', 'demo') then raise exception 'SHOP_UNAVAILABLE' using errcode = 'P0001'; end if;
  select * into v_set from public.barbershop_settings where barbershop_id = v.id;
  if p_channel = 'chatbot' then
    if not private.plan_has(v.plan, 'chatbot') or not coalesce(v_set.chatbot_enabled, true) then
      raise exception 'FEATURE_UNAVAILABLE' using errcode = 'P0001'; end if;
  else
    if not private.plan_has(v.plan, 'site') or not coalesce(v_set.site_enabled, true) then
      raise exception 'FEATURE_UNAVAILABLE' using errcode = 'P0001'; end if;
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- RPC pública: dados da vitrine (somente campos públicos, nunca IDs privados de clientes)
-- ---------------------------------------------------------------------
create or replace function public.get_public_shop(p_slug text, p_channel text default 'site')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v public.barbershops; v_set public.barbershop_settings; v_today date;
begin
  begin
    v := private.public_shop(p_slug, p_channel);
  exception when others then
    return jsonb_build_object('available', false, 'reason', sqlerrm);
  end;
  select * into v_set from public.barbershop_settings where barbershop_id = v.id;
  v_today := (now() at time zone v.timezone)::date;
  return jsonb_build_object(
    'available', true,
    'shop', jsonb_build_object(
      'slug', v.slug, 'name', v.name, 'description', v.description, 'address', v.address,
      'whatsapp', case when v.whatsapp_enabled then v.whatsapp end,
      'instagram', case when v.instagram_enabled then v.instagram end,
      'facebook', case when v.facebook_enabled then v.facebook end,
      'tiktok', case when v.tiktok_enabled then v.tiktok end,
      'logo_url', v.logo_url, 'background_image_url', v.background_image_url,
      'review_link', v.review_link, 'maps_link', v.maps_link, 'google_rating', v.google_rating,
      'public_status_text', v.public_status_text, 'theme', v.theme,
      'primary_color', v.primary_color, 'background_color', v.background_color, 'card_color', v.card_color,
      'timezone', v.timezone, 'max_days_ahead', v.max_days_ahead, 'is_demo', v.status = 'demo',
      'features', jsonb_build_object(
        'site', private.plan_has(v.plan, 'site') and coalesce(v_set.site_enabled, true),
        'chatbot', private.plan_has(v.plan, 'chatbot') and coalesce(v_set.chatbot_enabled, true))),
    'chatbot', jsonb_build_object(
      'name', v_set.chatbot_name, 'greeting', v_set.chatbot_greeting,
      'sync_with_site', v_set.chatbot_sync_with_site, 'theme', v_set.chatbot_theme),
    'services', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'description', s.description, 'price', s.price,
        'duration_minutes', s.duration_minutes, 'image_url', s.image_url) order by s.sort_order, s.name)
      from public.services s where s.barbershop_id = v.id and s.active), '[]'::jsonb),
    'professionals', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'specialty', p.specialty, 'photo_url', p.photo_url,
        'service_ids', coalesce((select jsonb_agg(ps.service_id) from public.professional_services ps where ps.professional_id = p.id), '[]'::jsonb))
        order by p.sort_order, p.name)
      from public.professionals p where p.barbershop_id = v.id and p.active), '[]'::jsonb),
    'hours', coalesce((select jsonb_agg(jsonb_build_object(
        'weekday', h.weekday, 'is_open', h.is_open, 'opens_at', h.opens_at, 'closes_at', h.closes_at) order by h.weekday)
      from public.business_hours h where h.barbershop_id = v.id), '[]'::jsonb),
    'today', jsonb_build_object('date', v_today,
      'special', (select jsonb_build_object('is_closed', d.is_closed, 'opens_at', d.opens_at, 'closes_at', d.closes_at, 'note', d.note)
                  from public.special_days d where d.barbershop_id = v.id and d.date = v_today))
  );
end $$;

-- RPC pública: horários livres (site e chatbot)
create or replace function public.get_available_slots(
  p_slug text, p_service_id uuid, p_date date, p_professional_id uuid default null, p_channel text default 'site')
returns table(starts_at timestamptz, professional_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare v public.barbershops;
begin
  v := private.public_shop(p_slug, p_channel);
  return query
    select distinct on (c.starts_at) c.starts_at, c.professional_id
    from private.compute_slots(v.id, p_service_id, p_professional_id, p_date, null, true) c
    order by c.starts_at, c.professional_sort;
end $$;

-- RPC do painel: horários livres (com opção de ignorar a própria reserva ao remarcar)
create or replace function public.panel_available_slots(
  p_shop_id uuid, p_service_id uuid, p_date date, p_professional_id uuid default null,
  p_exclude_appointment_id uuid default null)
returns table(starts_at timestamptz, professional_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_access_shop(p_shop_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return query
    select distinct on (c.starts_at) c.starts_at, c.professional_id
    from private.compute_slots(p_shop_id, p_service_id, p_professional_id, p_date, p_exclude_appointment_id, false) c
    order by c.starts_at, c.professional_sort;
end $$;

-- ---------------------------------------------------------------------
-- Núcleo de reserva (com lock por profissional + exclusion constraint)
-- ---------------------------------------------------------------------
create or replace function private.book(
  p_shop uuid, p_service uuid, p_professional uuid, p_starts_at timestamptz,
  p_client_id uuid, p_client_name text, p_client_phone text, p_source text,
  p_enforce_window boolean, p_notes text default null, p_update_client boolean default false)
returns public.appointments language plpgsql security definer set search_path = '' as $$
declare
  v_shop public.barbershops; v_service public.services; v_pro uuid; v_client uuid;
  v_phone text := private.normalize_phone(p_client_phone); v_date date; v_row public.appointments;
begin
  select * into v_shop from public.barbershops where id = p_shop;
  select * into v_service from public.services where id = p_service and barbershop_id = p_shop and active;
  if v_service.id is null then raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0001'; end if;
  v_date := (p_starts_at at time zone v_shop.timezone)::date;

  -- Escolhe o profissional (ou o primeiro livre quando "sem preferência")
  if p_professional is null then
    select c.professional_id into v_pro
    from private.compute_slots(p_shop, p_service, null, v_date, null, p_enforce_window) c
    where c.starts_at = p_starts_at order by c.professional_sort limit 1;
    if v_pro is null then raise exception 'SLOT_UNAVAILABLE' using errcode = 'P0001'; end if;
  else
    v_pro := p_professional;
  end if;

  -- Serializa reservas concorrentes do mesmo profissional
  perform 1 from public.professionals where id = v_pro and barbershop_id = p_shop for update;
  if not found then raise exception 'PROFESSIONAL_NOT_FOUND' using errcode = 'P0001'; end if;

  -- Revalida no servidor, já com o lock adquirido
  if not exists (
    select 1 from private.compute_slots(p_shop, p_service, v_pro, v_date, null, p_enforce_window) c
    where c.starts_at = p_starts_at) then
    raise exception 'SLOT_UNAVAILABLE' using errcode = 'P0001';
  end if;

  -- Cliente: reaproveita pelo WhatsApp dentro da MESMA barbearia
  if p_client_id is not null then
    select id into v_client from public.clients where id = p_client_id and barbershop_id = p_shop;
    if v_client is null then raise exception 'CLIENT_NOT_FOUND' using errcode = 'P0001'; end if;
  elsif v_phone is not null then
    select id into v_client from public.clients where barbershop_id = p_shop and whatsapp = v_phone;
    if v_client is null then
      begin
        insert into public.clients (barbershop_id, name, whatsapp) values (p_shop, p_client_name, v_phone)
        returning id into v_client;
      exception when unique_violation then
        select id into v_client from public.clients where barbershop_id = p_shop and whatsapp = v_phone;
      end;
    elsif p_update_client then
      update public.clients set name = p_client_name where id = v_client;
    end if;
  else
    insert into public.clients (barbershop_id, name) values (p_shop, p_client_name) returning id into v_client;
  end if;

  begin
    insert into public.appointments (barbershop_id, client_id, service_id, professional_id, starts_at, ends_at,
      status, price, client_name, client_phone, service_name, duration_minutes, source, notes, created_by)
    values (p_shop, v_client, v_service.id, v_pro, p_starts_at,
      p_starts_at + make_interval(mins => v_service.duration_minutes),
      'confirmed', v_service.price, p_client_name, v_phone, v_service.name, v_service.duration_minutes,
      p_source, p_notes, (select auth.uid()))
    returning * into v_row;
  exception when exclusion_violation then
    raise exception 'SLOT_UNAVAILABLE' using errcode = 'P0001';
  end;
  return v_row;
end $$;

-- ---------------------------------------------------------------------
-- RPC pública de agendamento (site e chatbot). Cliente não cria conta.
-- Preço, duração, profissional e barbearia são SEMPRE determinados no banco.
-- ---------------------------------------------------------------------
create or replace function public.create_public_booking(
  p_slug text, p_service_id uuid, p_starts_at timestamptz, p_name text, p_whatsapp text,
  p_professional_id uuid default null, p_channel text default 'site')
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.barbershops; v_name text := trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_phone text := private.normalize_phone(p_whatsapp); v_ip text; v_row public.appointments; v_pro_name text;
  v_headers jsonb;
begin
  if p_channel not in ('site', 'chatbot') then raise exception 'INVALID_CHANNEL' using errcode = '22023'; end if;
  v := private.public_shop(p_slug, p_channel);

  if length(v_name) < 2 or length(v_name) > 80 or v_name ~ '[<>{}]' then
    raise exception 'INVALID_NAME' using errcode = '22023'; end if;
  if v_phone is null or length(v_phone) not between 12 and 13 then
    raise exception 'INVALID_PHONE' using errcode = '22023'; end if;

  -- Rate limit (anti-spam) por telefone e por IP
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then v_headers := null; end;
  v_ip := split_part(coalesce(v_headers ->> 'cf-connecting-ip', v_headers ->> 'x-real-ip', v_headers ->> 'x-forwarded-for', ''), ',', 1);

  if (select count(*) from public.booking_rate_events
      where bucket = 'phone:' || v.id || ':' || v_phone and created_at > now() - interval '1 hour') >= 4 then
    raise exception 'RATE_LIMIT' using errcode = 'P0001'; end if;
  if v_ip <> '' and (select count(*) from public.booking_rate_events
      where bucket = 'ip:' || v_ip and created_at > now() - interval '1 hour') >= 12 then
    raise exception 'RATE_LIMIT' using errcode = 'P0001'; end if;
  if (select count(*) from public.appointments a
      where a.barbershop_id = v.id and a.client_phone = v_phone and a.status = 'confirmed' and a.starts_at > now()) >= 3 then
    raise exception 'TOO_MANY_ACTIVE' using errcode = 'P0001'; end if;

  insert into public.booking_rate_events (bucket) values ('phone:' || v.id || ':' || v_phone);
  if v_ip <> '' then insert into public.booking_rate_events (bucket) values ('ip:' || v_ip); end if;

  v_row := private.book(v.id, p_service_id, p_professional_id, p_starts_at, null, v_name, v_phone, p_channel, true);
  select name into v_pro_name from public.professionals where id = v_row.professional_id;

  return jsonb_build_object(
    'id', v_row.id, 'starts_at', v_row.starts_at, 'ends_at', v_row.ends_at,
    'service_name', v_row.service_name, 'price', v_row.price, 'professional_name', v_pro_name,
    'shop_name', v.name, 'timezone', v.timezone);
end $$;

-- ---------------------------------------------------------------------
-- RPCs do painel
-- ---------------------------------------------------------------------
create or replace function public.panel_create_appointment(
  p_shop_id uuid, p_service_id uuid, p_starts_at timestamptz, p_client_name text,
  p_client_phone text default null, p_professional_id uuid default null,
  p_client_id uuid default null, p_notes text default null)
returns public.appointments language plpgsql volatile security definer set search_path = '' as $$
declare v_name text := trim(coalesce(p_client_name, ''));
begin
  if not private.can_access_shop(p_shop_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_client_id is null and length(v_name) < 2 then raise exception 'INVALID_NAME' using errcode = '22023'; end if;
  if p_client_id is not null and v_name = '' then
    select name into v_name from public.clients where id = p_client_id and barbershop_id = p_shop_id;
  end if;
  return private.book(p_shop_id, p_service_id, p_professional_id, p_starts_at, p_client_id, v_name,
    p_client_phone, 'panel', false, nullif(trim(coalesce(p_notes, '')), ''), true);
end $$;

create or replace function public.reschedule_appointment(
  p_appointment_id uuid, p_starts_at timestamptz, p_professional_id uuid default null)
returns public.appointments language plpgsql volatile security definer set search_path = '' as $$
declare v_a public.appointments; v_pro uuid; v_tz text; v_row public.appointments;
begin
  select * into v_a from public.appointments where id = p_appointment_id for update;
  if not found or not private.can_access_shop(v_a.barbershop_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_a.status <> 'confirmed' then raise exception 'INVALID_STATUS' using errcode = 'P0001'; end if;
  v_pro := coalesce(p_professional_id, v_a.professional_id);
  select timezone into v_tz from public.barbershops where id = v_a.barbershop_id;

  perform 1 from public.professionals where id = v_pro and barbershop_id = v_a.barbershop_id for update;
  if not found then raise exception 'PROFESSIONAL_NOT_FOUND' using errcode = 'P0001'; end if;
  if not exists (
    select 1 from private.compute_slots(v_a.barbershop_id, v_a.service_id, v_pro,
      (p_starts_at at time zone v_tz)::date, v_a.id, false) c where c.starts_at = p_starts_at) then
    raise exception 'SLOT_UNAVAILABLE' using errcode = 'P0001';
  end if;
  begin
    update public.appointments set starts_at = p_starts_at,
      ends_at = p_starts_at + make_interval(mins => coalesce(v_a.duration_minutes, extract(epoch from (v_a.ends_at - v_a.starts_at))::int / 60)),
      professional_id = v_pro, reminder_sent_at = null
    where id = v_a.id returning * into v_row;
  exception when exclusion_violation then
    raise exception 'SLOT_UNAVAILABLE' using errcode = 'P0001';
  end;
  return v_row;
end $$;

create or replace function public.set_appointment_status(p_appointment_id uuid, p_status text, p_reason text default null)
returns public.appointments language plpgsql volatile security definer set search_path = '' as $$
declare v_a public.appointments; v_row public.appointments;
begin
  if p_status not in ('confirmed', 'completed', 'cancelled', 'no_show') then
    raise exception 'INVALID_STATUS' using errcode = '22023'; end if;
  select * into v_a from public.appointments where id = p_appointment_id for update;
  if not found or not private.can_access_shop(v_a.barbershop_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  begin
    update public.appointments set status = p_status,
      cancel_reason = case when p_status = 'cancelled' then nullif(trim(coalesce(p_reason, '')), '') else cancel_reason end
    where id = v_a.id returning * into v_row;
  exception when exclusion_violation then
    -- reativar um cancelado cujo horário já foi ocupado
    raise exception 'SLOT_UNAVAILABLE' using errcode = 'P0001';
  end;
  return v_row;
end $$;
