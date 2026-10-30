-- Cross-tenant isolation test. Run in the Supabase SQL editor (as postgres).
-- Impersonates the first owner of shop A via request.jwt.claims and checks that
-- nothing from any other shop is visible or writable. Everything is rolled back.
-- Requires at least one owner (barbershop_members) and a second shop.
begin;
create temp table _ctx on commit drop as
select m.user_id, m.barbershop_id as own_shop,
       (select id from public.barbershops b where b.id <> m.barbershop_id order by created_at limit 1) as other_shop
from public.barbershop_members m
join public.profiles p on p.id = m.user_id and not coalesce(p.is_platform_admin, false)
limit 1;
grant select on _ctx to authenticated;

do $$
declare c record;
begin
  select * into c from _ctx;
  if c.user_id is null or c.other_shop is null then
    raise exception 'Precisa de um proprietário vinculado e de uma segunda barbearia para o teste.';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', c.user_id, 'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare c record; n int; failures int := 0;
begin
  select * into c from _ctx;
  select count(*) into n from public.appointments where barbershop_id = c.other_shop;
  if n > 0 then failures := failures + 1; raise warning 'FAIL: vê % agendamentos de outra barbearia', n; else raise notice 'PASS: agendamentos isolados'; end if;
  select count(*) into n from public.clients where barbershop_id = c.other_shop;
  if n > 0 then failures := failures + 1; raise warning 'FAIL: vê % clientes de outra barbearia', n; else raise notice 'PASS: clientes isolados'; end if;
  select count(*) into n from public.barbershop_members where barbershop_id = c.other_shop;
  if n > 0 then failures := failures + 1; raise warning 'FAIL: vê membros de outra barbearia'; else raise notice 'PASS: membros isolados'; end if;
  select count(*) into n from public.push_subscriptions where user_id <> c.user_id;
  if n > 0 then failures := failures + 1; raise warning 'FAIL: vê inscrições push de outros usuários'; else raise notice 'PASS: push isolado'; end if;

  update public.services set price = price where barbershop_id = c.other_shop;
  get diagnostics n = row_count;
  if n > 0 then failures := failures + 1; raise warning 'FAIL: alterou serviços de outra barbearia'; else raise notice 'PASS: não altera serviços alheios'; end if;
  update public.appointments set status = status where barbershop_id = c.other_shop;
  get diagnostics n = row_count;
  if n > 0 then failures := failures + 1; raise warning 'FAIL: alterou agendamentos de outra barbearia'; else raise notice 'PASS: não altera agendamentos alheios'; end if;
  delete from public.blocked_times where barbershop_id = c.other_shop;
  get diagnostics n = row_count;
  if n > 0 then failures := failures + 1; raise warning 'FAIL: apagou bloqueios de outra barbearia'; else raise notice 'PASS: não apaga bloqueios alheios'; end if;

  begin
    insert into public.services (barbershop_id, name, price, duration_minutes) values (c.other_shop, 'x', 1, 30);
    failures := failures + 1; raise warning 'FAIL: inseriu serviço em outra barbearia';
  exception when others then raise notice 'PASS: não insere em outra barbearia (%)', sqlerrm;
  end;
  begin
    update public.barbershops set plan = case plan when 'complete' then 'site' else 'complete' end where id = c.own_shop;
    get diagnostics n = row_count;
    if n > 0 then failures := failures + 1; raise warning 'FAIL: proprietário alterou o próprio plano'; else raise notice 'PASS: plano protegido'; end if;
  exception when others then raise notice 'PASS: plano protegido (%)', sqlerrm;
  end;
  begin
    update public.barbershops set status = 'active' where id = c.own_shop and status <> 'active';
    update public.barbershops set status = 'demo' where id = c.own_shop;
    get diagnostics n = row_count;
    if n > 0 then failures := failures + 1; raise warning 'FAIL: proprietário alterou o próprio status'; else raise notice 'PASS: status protegido'; end if;
  exception when others then raise notice 'PASS: status protegido (%)', sqlerrm;
  end;
  begin
    insert into public.barbershop_members (barbershop_id, user_id, role) values (c.other_shop, c.user_id, 'owner');
    failures := failures + 1; raise warning 'FAIL: proprietário se vinculou a outra barbearia';
  exception when others then raise notice 'PASS: não se vincula a outra barbearia (%)', sqlerrm;
  end;
  raise notice '=== % falha(s) ===', failures;
end $$;
rollback;
