-- =====================================================================
-- BarberSaaS · 06 · Grants de funções, Realtime, Storage, Vault e Cron
-- =====================================================================

-- ---------------------------------------------------------------------
-- Funções: por padrão ninguém executa; liberamos explicitamente.
-- ---------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;

-- Helpers usados dentro de policies/triggers executados como o próprio usuário
grant execute on function private.is_platform_admin() to authenticated;
grant execute on function private.is_shop_member(uuid) to authenticated;
grant execute on function private.can_access_shop(uuid) to authenticated;
grant execute on function private.my_shop_ids() to authenticated;
grant execute on function private.normalize_phone(text) to authenticated, anon;
grant execute on function private.set_updated_at() to authenticated;
grant execute on function private.plan_has(text, text) to authenticated, anon;

-- Público (site / chatbot, sem login)
grant execute on function public.get_public_shop(text, text) to anon, authenticated;
grant execute on function public.get_available_slots(text, uuid, date, uuid, text) to anon, authenticated;
grant execute on function public.create_public_booking(text, uuid, timestamptz, text, text, uuid, text) to anon, authenticated;

-- Painel (usuário autenticado; cada função valida o tenant internamente)
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.my_context() to authenticated;
grant execute on function public.shop_context(uuid) to authenticated;
grant execute on function public.touch_last_seen() to authenticated;
grant execute on function public.panel_available_slots(uuid, uuid, date, uuid, uuid) to authenticated;
grant execute on function public.panel_create_appointment(uuid, uuid, timestamptz, text, text, uuid, uuid, text) to authenticated;
grant execute on function public.reschedule_appointment(uuid, timestamptz, uuid) to authenticated;
grant execute on function public.set_appointment_status(uuid, text, text) to authenticated;
grant execute on function public.shop_dashboard(uuid) to authenticated;
grant execute on function public.shop_finance(uuid, date, date) to authenticated;
grant execute on function public.shop_clients(uuid, text, int) to authenticated;
grant execute on function public.save_push_subscription(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;
grant execute on function public.enqueue_test_notification(uuid) to authenticated;

-- DEV (cada função exige platform_admins)
grant execute on function public.admin_list_barbershops(text) to authenticated;
grant execute on function public.admin_create_barbershop(text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.admin_update_barbershop(uuid, jsonb) to authenticated;
grant execute on function public.admin_start_support(uuid) to authenticated;
grant execute on function public.admin_shop_members(uuid) to authenticated;
grant execute on function public.admin_remove_member(uuid, uuid) to authenticated;

-- Edge Functions (service_role)
grant execute on all functions in schema public to service_role;
grant execute on all functions in schema private to service_role;

-- ---------------------------------------------------------------------
-- Realtime: somente agendamentos (agenda + dashboard). RLS é respeitada.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                     and schemaname = 'public' and tablename = 'appointments') then
    alter publication supabase_realtime add table public.appointments;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Storage: logos, fotos de profissionais e imagens do site
-- Caminho obrigatório: <barbershop_id>/<arquivo>
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage')
     and exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('shop-assets', 'shop-assets', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
    on conflict (id) do update set public = true, file_size_limit = 2097152,
      allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

    execute 'drop policy if exists "shop-assets insert by members" on storage.objects';
    execute 'drop policy if exists "shop-assets update by members" on storage.objects';
    execute 'drop policy if exists "shop-assets delete by members" on storage.objects';
    execute $p$create policy "shop-assets insert by members" on storage.objects for insert to authenticated
      with check (bucket_id = 'shop-assets' and private.can_access_shop(((storage.foldername(name))[1])::uuid))$p$;
    execute $p$create policy "shop-assets update by members" on storage.objects for update to authenticated
      using (bucket_id = 'shop-assets' and private.can_access_shop(((storage.foldername(name))[1])::uuid))$p$;
    execute $p$create policy "shop-assets delete by members" on storage.objects for delete to authenticated
      using (bucket_id = 'shop-assets' and private.can_access_shop(((storage.foldername(name))[1])::uuid))$p$;
    -- leitura: bucket público serve arquivos por URL; sem policy de SELECT evitamos listagem.
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Vault: segredo interno para o Cron/pg_net chamarem a Edge Function.
-- Gerado aleatoriamente aqui; nunca aparece no repositório.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'supabase_vault') then
    if not exists (select 1 from vault.secrets where name = 'barbersaas_dispatch_secret') then
      perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'barbersaas_dispatch_secret',
        'BarberSaaS: autentica chamadas do Cron/pg_net para a Edge Function push-dispatch');
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- pg_net + pg_cron (somente onde disponíveis: Supabase hospedado)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- 1) Envio de notificações + lembretes (a cada minuto; só chama HTTP se houver pendência)
    perform cron.unschedule(jobid) from cron.job where jobname = 'barbersaas-notifications';
    perform cron.schedule('barbersaas-notifications', '* * * * *', 'select private.run_notification_cycle()');
    -- 2) Manutenção diária às 06:17 UTC (03:17 em Brasília)
    perform cron.unschedule(jobid) from cron.job where jobname = 'barbersaas-maintenance';
    perform cron.schedule('barbersaas-maintenance', '17 6 * * *', 'select private.maintenance()');
  end if;
end $$;
