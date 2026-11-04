-- =====================================================================
-- BarberSaaS · 05 · Notificações Web Push (outbox idempotente)
-- Fluxo: appointments (trigger) → notification_outbox → Edge Function
-- push-dispatch (acordada por pg_net imediatamente e pelo Cron a cada minuto)
-- → web push para os dispositivos dos responsáveis da barbearia.
-- =====================================================================

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions add column if not exists auth text;
alter table public.push_subscriptions add column if not exists device_label text;
alter table public.push_subscriptions add column if not exists updated_at timestamptz not null default now();
alter table public.push_subscriptions add column if not exists last_success_at timestamptz;
alter table public.push_subscriptions add column if not exists failure_count integer not null default 0;
alter table public.push_subscriptions add column if not exists last_error text;
-- remove duplicatas antigas antes do índice único
delete from public.push_subscriptions a using public.push_subscriptions b
  where a.endpoint = b.endpoint and a.barbershop_id = b.barbershop_id and a.created_at < b.created_at;
create unique index if not exists push_subscriptions_shop_endpoint on public.push_subscriptions(barbershop_id, endpoint);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
drop trigger if exists push_subscriptions_updated_at on public.push_subscriptions;
create trigger push_subscriptions_updated_at before update on public.push_subscriptions
  for each row execute function private.set_updated_at();

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;
drop policy if exists push_subscriptions_own_select on public.push_subscriptions;
create policy push_subscriptions_own_select on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists push_subscriptions_own_delete on public.push_subscriptions;
create policy push_subscriptions_own_delete on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- Preferências por usuário e barbearia
create table if not exists public.notification_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  new_booking boolean not null default true,
  cancellation boolean not null default true,
  reschedule boolean not null default true,
  reminder boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, barbershop_id)
);
create index if not exists notification_preferences_shop_idx on public.notification_preferences(barbershop_id);
alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from anon, authenticated;
grant select, insert, update on public.notification_preferences to authenticated;
grant all on public.notification_preferences to service_role;
drop policy if exists notification_preferences_own on public.notification_preferences;
create policy notification_preferences_own on public.notification_preferences for all to authenticated
  using (user_id = (select auth.uid()) and barbershop_id in (select private.my_shop_ids()))
  with check (user_id = (select auth.uid()) and barbershop_id in (select private.my_shop_ids()));

-- Outbox (idempotência garantida por dedupe_key único)
create table if not exists public.notification_outbox (
  id bigint generated always as identity primary key,
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete cascade,
  kind text not null check (kind in ('new_booking', 'cancellation', 'reschedule', 'reminder', 'test')),
  dedupe_key text not null unique,
  title text not null,
  body text not null,
  url text not null default '/agendamentos/',
  target_user_id uuid references auth.users(id) on delete cascade,
  exclude_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  sent_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
alter table public.notification_outbox add column if not exists claimed_at timestamptz;
alter table public.notification_outbox add column if not exists next_attempt_at timestamptz not null default now();
create index if not exists notification_outbox_pending_idx on public.notification_outbox(created_at) where status in ('pending', 'processing');

-- Entregas por dispositivo: garante que um retry NUNCA reenvia para quem já recebeu
-- (idempotência evento × dispositivo, mesmo com duas execuções do dispatcher).
create table if not exists public.notification_deliveries (
  outbox_id bigint not null references public.notification_outbox(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  delivered_at timestamptz not null default now(),
  primary key (outbox_id, subscription_id)
);
create index if not exists notification_deliveries_subscription_idx on public.notification_deliveries(subscription_id);
alter table public.notification_deliveries enable row level security;
revoke all on public.notification_deliveries from anon, authenticated;
grant all on public.notification_deliveries to service_role;
create index if not exists notification_outbox_shop_idx on public.notification_outbox(barbershop_id);
create index if not exists notification_outbox_appointment_idx on public.notification_outbox(appointment_id);
alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from anon, authenticated;
grant all on public.notification_outbox to service_role;
-- Diagnóstico: somente o admin DEV lê a fila (escrita apenas por funções/service_role)
grant select on public.notification_outbox to authenticated;
drop policy if exists notification_outbox_admin_select on public.notification_outbox;
create policy notification_outbox_admin_select on public.notification_outbox for select to authenticated
  using (private.is_platform_admin());
grant select on public.booking_rate_events to authenticated;
drop policy if exists booking_rate_events_admin_select on public.booking_rate_events;
create policy booking_rate_events_admin_select on public.booking_rate_events for select to authenticated
  using (private.is_platform_admin());

-- Configuração interna (sem segredos em texto: segredos ficam no Vault)
create table if not exists private.app_config (
  key text primary key,
  value text not null
);
insert into private.app_config (key, value) values
  ('project_url', 'https://idtvkslyyexwbqcgrozh.supabase.co'),
  ('app_url', 'https://saas-barbearia-swart.vercel.app')
on conflict (key) do nothing;
revoke all on private.app_config from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Formatação de mensagens
-- ---------------------------------------------------------------------
create or replace function private.fmt_when(p_ts timestamptz, p_tz text)
returns text language plpgsql stable set search_path = '' as $$
declare v_local timestamp := p_ts at time zone p_tz; v_today date := (now() at time zone p_tz)::date;
begin
  return case
    when v_local::date = v_today then 'Hoje'
    when v_local::date = v_today + 1 then 'Amanhã'
    else to_char(v_local, 'DD/MM') end || ' às ' || to_char(v_local, 'HH24:MI');
end $$;

create or replace function private.enqueue_notification(
  p_appt public.appointments, p_kind text, p_dedupe text, p_title text, p_body text, p_exclude uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notification_outbox (barbershop_id, appointment_id, kind, dedupe_key, title, body, url, exclude_user_id)
  values (p_appt.barbershop_id, p_appt.id, p_kind, p_dedupe, p_title, left(p_body, 240),
    '/agendamentos/?appointment=' || p_appt.id || '&date=' ||
      to_char(p_appt.starts_at at time zone coalesce((select timezone from public.barbershops where id = p_appt.barbershop_id), 'America/Sao_Paulo'), 'YYYY-MM-DD'),
    p_exclude)
  on conflict (dedupe_key) do nothing;
end $$;

create or replace function private.appointments_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_tz text; v_actor uuid := (select auth.uid()); v_who text;
begin
  select timezone into v_tz from public.barbershops where id = new.barbershop_id;
  v_who := coalesce(nullif(split_part(new.client_name, ' ', 1), ''), 'Cliente');
  if tg_op = 'INSERT' then
    if new.status = 'confirmed' then
      -- Ex.: "João agendou Corte + Barba para amanhã às 14:00."
      perform private.enqueue_notification(new, 'new_booking', 'new:' || new.id, 'Novo agendamento!',
        v_who || ' agendou ' || coalesce(new.service_name, 'um horário') || ' para ' ||
        lower(private.fmt_when(new.starts_at, v_tz)) || '.', v_actor);
    end if;
  elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    perform private.enqueue_notification(new, 'cancellation', 'cancel:' || new.id || ':' || extract(epoch from now())::bigint,
      'Agendamento cancelado',
      v_who || ' cancelou ' || coalesce(new.service_name, 'o horário') || ' de ' ||
      lower(private.fmt_when(new.starts_at, v_tz)) || '.', v_actor);
  elsif new.status = 'confirmed' and (new.starts_at is distinct from old.starts_at or new.professional_id is distinct from old.professional_id) then
    perform private.enqueue_notification(new, 'reschedule',
      'resched:' || new.id || ':' || extract(epoch from new.starts_at)::bigint || ':' || new.professional_id,
      'Agendamento remarcado',
      v_who || ' · ' || coalesce(new.service_name, '') || ' agora ' ||
      lower(private.fmt_when(new.starts_at, v_tz)) || '.', v_actor);
  end if;
  return null;
end $$;
drop trigger if exists appointments_notify on public.appointments;
create trigger appointments_notify after insert or update of status, starts_at, professional_id on public.appointments
  for each row execute function private.appointments_notify();

-- Lembretes: idempotentes (reminder_sent_at + dedupe_key)
create or replace function private.enqueue_due_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; v_count int := 0;
begin
  for r in
    select a.*, s.reminder_minutes, b.timezone
    from public.appointments a
    join public.barbershops b on b.id = a.barbershop_id and b.status in ('active', 'demo')
    join public.barbershop_settings s on s.barbershop_id = a.barbershop_id
    where a.status = 'confirmed' and a.reminder_sent_at is null
      and a.starts_at > now()
      and a.starts_at <= now() + make_interval(mins => s.reminder_minutes)
    for update of a skip locked
  loop
    insert into public.notification_outbox (barbershop_id, appointment_id, kind, dedupe_key, title, body, url)
    values (r.barbershop_id, r.id, 'reminder', 'reminder:' || r.id || ':' || extract(epoch from r.starts_at)::bigint,
      'Próximo atendimento',
      coalesce(nullif(split_part(r.client_name, ' ', 1), ''), 'Cliente') || ' está agendado para daqui a ' ||
        greatest(1, round(extract(epoch from (r.starts_at - now())) / 60))::int || ' minutos (' ||
        coalesce(r.service_name, 'atendimento') || ' às ' || to_char(r.starts_at at time zone r.timezone, 'HH24:MI') || ').',
      '/agendamentos/?appointment=' || r.id || '&date=' || to_char(r.starts_at at time zone r.timezone, 'YYYY-MM-DD'))
    on conflict (dedupe_key) do nothing;
    update public.appointments set reminder_sent_at = now() where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- RPCs para o navegador (usuário autenticado)
-- ---------------------------------------------------------------------
create or replace function public.save_push_subscription(
  p_shop_id uuid, p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null, p_device_label text default null)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.can_access_shop(p_shop_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'INVALID_SUBSCRIPTION' using errcode = '22023'; end if;
  if (select count(*) from public.push_subscriptions where user_id = v_uid) >= 20 then
    delete from public.push_subscriptions where id = (select id from public.push_subscriptions where user_id = v_uid order by updated_at limit 1);
  end if;
  insert into public.push_subscriptions (barbershop_id, user_id, endpoint, p256dh, auth, user_agent, device_label)
  values (p_shop_id, v_uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300), left(p_device_label, 80))
  on conflict (barbershop_id, endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh,
    auth = excluded.auth, user_agent = excluded.user_agent, device_label = coalesce(excluded.device_label, public.push_subscriptions.device_label),
    failure_count = 0, last_error = null
  returning id into v_id;
  insert into public.notification_preferences (user_id, barbershop_id) values (v_uid, p_shop_id) on conflict do nothing;
  return v_id;
end $$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void language sql volatile security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = (select auth.uid());
$$;

-- Teste: enfileira notificação apenas para os dispositivos do próprio usuário (máx. 5/10min)
create or replace function public.enqueue_test_notification(p_shop_id uuid)
returns bigint language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_id bigint;
begin
  if v_uid is null or not private.can_access_shop(p_shop_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if not exists (select 1 from public.push_subscriptions where user_id = v_uid and barbershop_id = p_shop_id) then
    raise exception 'NO_DEVICE' using errcode = 'P0001'; end if;
  if (select count(*) from public.notification_outbox where kind = 'test' and target_user_id = v_uid
      and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'RATE_LIMIT' using errcode = 'P0001'; end if;
  insert into public.notification_outbox (barbershop_id, kind, dedupe_key, title, body, url, target_user_id)
  values (p_shop_id, 'test', 'test:' || v_uid || ':' || gen_random_uuid(), 'BarberSaaS',
    'As notificações estão funcionando neste aparelho.', '/configuracoes/#notificacoes', v_uid)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- RPCs para a Edge Function (somente service_role)
-- ---------------------------------------------------------------------
-- Máximo de tentativas por evento antes de marcar como 'failed'
create or replace function private.outbox_max_attempts()
returns int language sql immutable set search_path = '' as $$ select 5 $$;

-- Descarta eventos que perderam o sentido antes do envio (ex.: lembrete de um
-- agendamento cancelado/remarcado; aviso de novo agendamento já cancelado).
create or replace function private.skip_stale_outbox()
returns int language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  update public.notification_outbox o set status = 'skipped', processed_at = now(), last_error = 'stale'
  from public.appointments a
  where a.id = o.appointment_id and o.status = 'pending'
    and ((o.kind = 'reminder' and (a.status <> 'confirmed'
            or o.dedupe_key <> 'reminder:' || a.id || ':' || extract(epoch from a.starts_at)::bigint
            or a.starts_at <= now()))
      or (o.kind in ('new_booking', 'reschedule') and a.status = 'cancelled'));
  get diagnostics v = row_count;
  return v;
end $$;

create or replace function public.dispatch_claim(p_limit int default 50)
returns setof public.notification_outbox language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.enqueue_due_reminders();
  perform private.skip_stale_outbox();
  -- Esgotou as tentativas → falha definitiva
  update public.notification_outbox set status = 'failed', processed_at = now(), last_error = coalesce(last_error, 'max attempts')
  where status = 'processing' and attempts >= private.outbox_max_attempts() and claimed_at < now() - interval '2 minutes';
  return query
  update public.notification_outbox o set status = 'processing', attempts = o.attempts + 1, claimed_at = now()
  where o.id in (
    select id from public.notification_outbox
    where (status = 'pending' and next_attempt_at <= now())
       -- execução anterior morreu no meio (timeout): reprocessa sem duplicar (ver notification_deliveries)
       or (status = 'processing' and attempts < private.outbox_max_attempts() and claimed_at < now() - interval '2 minutes')
    order by created_at limit least(greatest(p_limit, 1), 200)
    for update skip locked)
  returning o.*;
end $$;

create or replace function public.dispatch_targets(p_outbox_id bigint)
returns table(subscription_id uuid, endpoint text, p256dh text, auth text)
language plpgsql stable security definer set search_path = '' as $$
declare o public.notification_outbox;
begin
  select * into o from public.notification_outbox where id = p_outbox_id;
  if not found then return; end if;
  return query
  select s.id, s.endpoint, s.p256dh, s.auth
  from public.push_subscriptions s
  left join public.notification_preferences np on np.user_id = s.user_id and np.barbershop_id = s.barbershop_id
  where s.barbershop_id = o.barbershop_id
    and s.auth is not null and s.p256dh is not null
    -- já entregue a este dispositivo numa tentativa anterior → não reenviar
    and not exists (select 1 from public.notification_deliveries d where d.outbox_id = o.id and d.subscription_id = s.id)
    and (o.target_user_id is null or s.user_id = o.target_user_id)
    and (o.exclude_user_id is null or s.user_id <> o.exclude_user_id or o.kind = 'reminder')
    -- usuário ainda precisa ter acesso à barbearia (ex.: vínculo removido)
    and (exists (select 1 from public.barbershop_members m where m.barbershop_id = s.barbershop_id and m.user_id = s.user_id)
         or exists (select 1 from public.platform_admins pa where pa.user_id = s.user_id))
    and case o.kind
      when 'new_booking' then coalesce(np.new_booking, true)
      when 'cancellation' then coalesce(np.cancellation, true)
      when 'reschedule' then coalesce(np.reschedule, true)
      when 'reminder' then coalesce(np.reminder, true)
      else true end;
end $$;

-- Finaliza uma tentativa.
--   p_status = 'sent' | 'skipped' | 'failed' → estado final
--   p_status = 'retry' → falha temporária: volta para 'pending' com backoff
--                         (1, 4, 9, 16 min) ou 'failed' ao esgotar as tentativas.
create or replace function public.dispatch_complete(p_outbox_id bigint, p_status text, p_sent int, p_error text default null)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare v_attempts int; v_final text;
begin
  if p_status not in ('sent', 'skipped', 'failed', 'retry', 'pending') then
    raise exception 'INVALID_STATUS' using errcode = '22023'; end if;
  select attempts into v_attempts from public.notification_outbox where id = p_outbox_id;
  if not found then return null; end if;
  if p_status in ('retry', 'pending') then
    v_final := case when v_attempts >= private.outbox_max_attempts() then 'failed' else 'pending' end;
  else
    v_final := p_status;
  end if;
  update public.notification_outbox set
    status = v_final,
    sent_count = sent_count + greatest(coalesce(p_sent, 0), 0),
    last_error = left(p_error, 500),
    next_attempt_at = case when v_final = 'pending' then now() + make_interval(mins => greatest(v_attempts, 1) * greatest(v_attempts, 1)) else next_attempt_at end,
    processed_at = case when v_final = 'pending' then null else now() end
  where id = p_outbox_id;
  return v_final;
end $$;

-- Resultado do envio para UM dispositivo.
--   ok   → registra a entrega (idempotência) e zera falhas
--   gone → HTTP 404/410: inscrição revogada/expirada → remove
--   erro temporário → só incrementa falhas (a limpeza diária remove após 5)
create or replace function public.dispatch_record_delivery(
  p_outbox_id bigint, p_subscription_id uuid, p_ok boolean, p_gone boolean, p_error text default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_gone then
    delete from public.push_subscriptions where id = p_subscription_id;
  elsif p_ok then
    insert into public.notification_deliveries (outbox_id, subscription_id) values (p_outbox_id, p_subscription_id)
    on conflict do nothing;
    update public.push_subscriptions set last_success_at = now(), failure_count = 0, last_error = null where id = p_subscription_id;
  else
    update public.push_subscriptions set failure_count = failure_count + 1, last_error = left(p_error, 300) where id = p_subscription_id;
  end if;
end $$;

-- Verificação do segredo usado pelo Cron/pg_net para chamar a Edge Function
create or replace function public.dispatch_verify_secret(p_secret text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  if p_secret is null or length(p_secret) < 32 then return false; end if;
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into v using 'barbersaas_dispatch_secret';
  exception when others then return false;
  end;
  return v is not null and v = p_secret;
end $$;

-- ---------------------------------------------------------------------
-- Acorda a Edge Function de envio (pg_net assíncrono; nunca bloqueia a reserva)
-- ---------------------------------------------------------------------
create or replace function private.wake_dispatcher()
returns void language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then return; end if;
  select value into v_url from private.app_config where key = 'project_url';
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into v_secret using 'barbersaas_dispatch_secret';
  exception when others then return;
  end;
  if v_url is null or v_secret is null then return; end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 5000)'
    using v_url || '/functions/v1/push-dispatch',
          jsonb_build_object('content-type', 'application/json', 'x-dispatch-secret', v_secret),
          '{"source":"db"}'::jsonb;
exception when others then
  raise warning 'wake_dispatcher falhou: %', sqlerrm;
end $$;

create or replace function private.outbox_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.wake_dispatcher();
  return null;
end $$;
drop trigger if exists notification_outbox_wake on public.notification_outbox;
create trigger notification_outbox_wake after insert on public.notification_outbox
  for each statement execute function private.outbox_after_insert();

-- Ciclo do Cron: gera lembretes e só chama a Edge Function se houver pendências
create or replace function private.run_notification_cycle()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.enqueue_due_reminders();
  perform private.skip_stale_outbox();
  if exists (select 1 from public.notification_outbox
             where (status = 'pending' and next_attempt_at <= now())
                or (status = 'processing' and claimed_at < now() - interval '2 minutes')) then
    perform private.wake_dispatcher();
  end if;
end $$;

-- Manutenção diária
create or replace function private.maintenance()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_subs int; v_rate int; v_outbox int;
begin
  delete from public.push_subscriptions
  where failure_count >= 5 or (coalesce(last_success_at, updated_at) < now() - interval '120 days');
  get diagnostics v_subs = row_count;
  delete from public.booking_rate_events where created_at < now() - interval '2 days';
  get diagnostics v_rate = row_count;
  delete from public.notification_outbox where created_at < now() - interval '30 days';
  get diagnostics v_outbox = row_count;
  update public.notification_outbox set status = 'failed', processed_at = now(), last_error = coalesce(last_error, 'max attempts')
  where status = 'processing' and attempts >= private.outbox_max_attempts() and claimed_at < now() - interval '1 hour';
  return jsonb_build_object('subscriptions_removed', v_subs, 'rate_events_removed', v_rate, 'outbox_removed', v_outbox);
end $$;
