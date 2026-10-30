-- Security hardening (Security Advisor + booking abuse). Idempotent. Review before applying.

-- 1) btree_gist in public (advisor: extension_in_public). Moving it keeps existing
--    exclusion constraints working (they reference operator classes by OID).
create schema if not exists extensions;
do $$
begin
  if exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
             where e.extname = 'btree_gist' and n.nspname = 'public') then
    execute 'alter extension btree_gist set schema extensions';
  end if;
end $$;

-- 2) SECURITY DEFINER functions callable by anon (advisor: *_security_definer_function_executable).
--    Public booking RPCs stay open to anon by design (documented exception).
--    Functions used inside RLS policies keep their grants: revoking them would break the policies.
--    Every other SECURITY DEFINER function in public loses EXECUTE for PUBLIC/anon;
--    authenticated and service_role keep it explicitly.
do $$
declare
  f record;
  allow_anon constant text[] := array['create_public_booking', 'available_booking_slots'];
begin
  for f in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args,
           p.prorettype = 'pg_catalog.trigger'::regtype as is_trigger
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    if f.proname = any(allow_anon) then
      execute format('grant execute on function public.%I(%s) to anon, authenticated', f.proname, f.args);
      continue;
    end if;
    if exists (select 1 from pg_policies pol
               where coalesce(pol.qual, '') ~ ('\m' || f.proname || '\M')
                  or coalesce(pol.with_check, '') ~ ('\m' || f.proname || '\M')) then
      raise notice 'kept grants on %(%) (used by RLS policies)', f.proname, f.args;
      continue;
    end if;
    execute format('revoke execute on function public.%I(%s) from public, anon', f.proname, f.args);
    if not f.is_trigger then
      execute format('grant execute on function public.%I(%s) to authenticated, service_role', f.proname, f.args);
    end if;
    raise notice 'revoked anon execute on %(%)', f.proname, f.args;
  end loop;
end $$;

-- 3) Bookings: only for active/demo shops, and basic anti-spam.
--    Runs for every insert path (public RPC, chatbot, owner panel).
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.guard_new_appointment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  shop_status text;
  phone text := regexp_replace(coalesce(new.client_whatsapp, ''), '\D', '', 'g');
begin
  select status into shop_status from public.barbershops where id = new.barbershop_id;
  if shop_status is null or shop_status not in ('active', 'demo') then
    raise exception 'Barbearia indisponível para agendamentos' using errcode = 'P0001';
  end if;
  -- At most 3 future open bookings per WhatsApp number in the same shop.
  if phone <> '' and (
    select count(*) from public.appointments a
    where a.barbershop_id = new.barbershop_id
      and regexp_replace(coalesce(a.client_whatsapp, ''), '\D', '', 'g') = phone
      and a.status in ('pending', 'confirmed')
      and a.starts_at > now()
  ) >= 3 then
    raise exception 'Limite de agendamentos em aberto para este WhatsApp' using errcode = 'P0001';
  end if;
  -- Burst protection: at most 20 new bookings per shop per 5 minutes.
  if (
    select count(*) from public.appointments a
    where a.barbershop_id = new.barbershop_id and a.created_at > now() - interval '5 minutes'
  ) >= 20 then
    raise exception 'Muitos agendamentos em sequência. Tente novamente em alguns minutos.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_new_appointment() from public, anon, authenticated;

drop trigger if exists appointments_guard_new on public.appointments;
create trigger appointments_guard_new
  before insert on public.appointments
  for each row execute function private.guard_new_appointment();

create index if not exists appointments_shop_phone_idx on public.appointments (barbershop_id, client_whatsapp);
create index if not exists appointments_shop_created_idx on public.appointments (barbershop_id, created_at);
