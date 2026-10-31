-- Web Push for new bookings.
-- Idempotent: safe to run more than once. Review before applying (push_subscriptions already exists).

-- 1) Subscriptions table: make sure the columns used by shared/booking-alerts.js and push-notify exist.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.push_subscriptions add column if not exists barbershop_id uuid references public.barbershops(id) on delete cascade;
alter table public.push_subscriptions add column if not exists endpoint text;
alter table public.push_subscriptions add column if not exists p256dh text;
alter table public.push_subscriptions add column if not exists auth text;
alter table public.push_subscriptions add column if not exists user_agent text;
alter table public.push_subscriptions add column if not exists created_at timestamptz not null default now();
alter table public.push_subscriptions add column if not exists last_seen_at timestamptz;
alter table public.push_subscriptions add column if not exists last_used_at timestamptz;
create unique index if not exists push_subscriptions_endpoint_key on public.push_subscriptions(endpoint);
create index if not exists push_subscriptions_shop_idx on public.push_subscriptions(barbershop_id, user_id);

-- 2) RLS: each user manages only their own devices, and only for shops they belong to.
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.barbershop_members m where m.barbershop_id = push_subscriptions.barbershop_id and m.user_id = (select auth.uid()))
  );
create policy push_subscriptions_update_own on public.push_subscriptions
  for update to authenticated using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.barbershop_members m where m.barbershop_id = push_subscriptions.barbershop_id and m.user_id = (select auth.uid()))
  );
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.push_subscriptions from anon;

-- 3) Trigger: every new appointment calls the push-notify Edge Function asynchronously (pg_net).
--    URL and shared secret live in Vault, never in the repository:
--      select vault.create_secret('https://idtvkslyyexwbqcgrozh.supabase.co/functions/v1/push-notify', 'push_notify_url');
--      select vault.create_secret('<mesmo valor de PUSH_WEBHOOK_SECRET>', 'push_webhook_secret');
create extension if not exists pg_net with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.notify_new_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  fn_url text;
  fn_secret text;
begin
  select decrypted_secret into fn_url from vault.decrypted_secrets where name = 'push_notify_url' limit 1;
  select decrypted_secret into fn_secret from vault.decrypted_secrets where name = 'push_webhook_secret' limit 1;
  if fn_url is null or fn_secret is null then
    return new;
  end if;
  perform net.http_post(
    url := fn_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', fn_secret),
    body := jsonb_build_object('action', 'new_booking', 'appointment_id', new.id)
  );
  return new;
exception when others then
  -- Notifications must never block a booking.
  raise warning 'notify_new_booking failed: %', sqlerrm;
  return new;
end;
$$;
revoke all on function private.notify_new_booking() from public, anon, authenticated;

drop trigger if exists appointments_push_notify on public.appointments;
create trigger appointments_push_notify
  after insert on public.appointments
  for each row execute function private.notify_new_booking();
