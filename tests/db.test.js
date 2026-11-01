// Testes do banco (migrations reais aplicadas em Postgres PGlite sobre o schema legado).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, as, createUser, expectError } from './helpers/db.js';

const VISION = '11b26428-f91f-4fc4-b910-31788c443ca1';
let db, adminId, ownerA, ownerB, outsider, shopA, shopB, svcA, svcA60, svcB, proA1, proA2, proB, day;

const iso = (d, hhmm) => `${d}T${hhmm}:00-03:00`; // America/Sao_Paulo (sem horário de verão)
const rpc = (tx, fn, args) => tx.query(`select * from public.${fn}(${Object.keys(args).map((k, i) => `${k} => $${i + 1}`).join(', ')})`, Object.values(args));

before(async () => {
  db = await createDb({ applyTwice: true });
  adminId = await createUser(db, 'visionariodev@gmail.com');
  ownerA = await createUser(db, 'dono.a@example.com');
  ownerB = await createUser(db, 'dono.b@example.com');
  outsider = await createUser(db, 'intruso@example.com');

  // Próxima terça-feira com pelo menos 2 dias de folga (data de teste estável)
  day = (await db.query(`select d::date::text as d from generate_series((now() at time zone 'America/Sao_Paulo')::date + 2,
    (now() at time zone 'America/Sao_Paulo')::date + 9, '1 day') d where extract(dow from d) = 2 limit 1`)).rows[0].d;

  await as(db, { role: 'authenticated', uid: adminId }, async tx => {
    shopA = (await rpc(tx, 'admin_create_barbershop', { p_name: 'Barbearia Alfa', p_owner_name: 'Ana', p_owner_email: 'dono.a@example.com', p_whatsapp: '(21) 99999-0001', p_plan: 'complete' })).rows[0];
    shopB = (await rpc(tx, 'admin_create_barbershop', { p_name: 'Barbearia Beta', p_owner_email: 'DONO.B@example.com', p_plan: 'site' })).rows[0];
  });
  // dados de cada tenant criados pelo próprio dono
  await as(db, { role: 'authenticated', uid: ownerA }, async tx => {
    svcA = (await tx.query(`insert into public.services (barbershop_id, name, price, duration_minutes) values ($1, 'Corte', 40, 30) returning *`, [shopA.id])).rows[0];
    svcA60 = (await tx.query(`insert into public.services (barbershop_id, name, price, duration_minutes) values ($1, 'Corte + Barba', 70, 60) returning *`, [shopA.id])).rows[0];
    proA1 = (await tx.query(`select * from public.professionals where barbershop_id = $1`, [shopA.id])).rows[0];
    proA2 = (await tx.query(`insert into public.professionals (barbershop_id, name, sort_order) values ($1, 'Bruno', 1) returning *`, [shopA.id])).rows[0];
  });
  await as(db, { role: 'authenticated', uid: ownerB }, async tx => {
    svcB = (await tx.query(`insert into public.services (barbershop_id, name, price, duration_minutes) values ($1, 'Corte B', 30, 30) returning *`, [shopB.id])).rows[0];
    proB = (await tx.query(`select * from public.professionals where barbershop_id = $1`, [shopB.id])).rows[0];
  });
});

// ------------------------------------------------------------------ Auth / admin
test('admin DEV é reconhecido somente pela tabela platform_admins', async () => {
  const r = await as(db, { role: 'authenticated', uid: adminId }, tx => tx.query('select public.is_platform_admin() v'));
  assert.equal(r.rows[0].v, true);
  const r2 = await as(db, { role: 'authenticated', uid: ownerA }, tx => tx.query('select public.is_platform_admin() v'));
  assert.equal(r2.rows[0].v, false);
});

test('e-mail do admin NÃO confirmado não vira admin', async () => {
  const db2 = await createDb();
  const id = await createUser(db2, 'visionariodev@gmail.com', { confirmed: false });
  assert.equal((await db2.query('select count(*)::int c from public.platform_admins')).rows[0].c, 0);
  await db2.query('update auth.users set email_confirmed_at = now() where id = $1', [id]);
  assert.equal((await db2.query('select count(*)::int c from public.platform_admins')).rows[0].c, 1);
});

test('usuário não consegue se promover a admin pelo perfil', async () => {
  await expectError(as(db, { role: 'authenticated', uid: ownerA }, tx =>
    tx.query('update public.profiles set is_platform_admin = true where id = $1', [ownerA])), /permission denied/);
  await expectError(as(db, { role: 'authenticated', uid: ownerA }, tx =>
    tx.query('insert into public.platform_admins (user_id) values ($1)', [ownerA])), /permission denied/);
});

test('proprietário com conta confirmada é vinculado automaticamente na criação', async () => {
  const ctx = await as(db, { role: 'authenticated', uid: ownerB }, tx => tx.query('select public.my_context() c'));
  assert.equal(ctx.rows[0].c.shops.length, 1);
  assert.equal(ctx.rows[0].c.shops[0].slug, 'barbearia-beta');
  assert.equal(ctx.rows[0].c.shops[0].features.chatbot, false);
});

test('proprietário que cria conta depois é vinculado ao confirmar e-mail', async () => {
  const s = await as(db, { role: 'authenticated', uid: adminId }, tx =>
    rpc(tx, 'admin_create_barbershop', { p_name: 'Barbearia Gama', p_owner_email: 'gama@example.com' }));
  const uid = await createUser(db, 'gama@example.com', { confirmed: false });
  let ctx = await as(db, { role: 'authenticated', uid }, tx => tx.query('select public.my_context() c'));
  assert.equal(ctx.rows[0].c.shops.length, 0);
  await db.query('update auth.users set email_confirmed_at = now() where id = $1', [uid]);
  ctx = await as(db, { role: 'authenticated', uid }, tx => tx.query('select public.my_context() c'));
  assert.equal(ctx.rows[0].c.shops[0].id, s.rows[0].id);
});

test('onboarding cria settings, horários e profissional padrão', async () => {
  const r = await db.query(`select
    (select count(*)::int from public.barbershop_settings where barbershop_id = $1) s,
    (select count(*)::int from public.business_hours where barbershop_id = $1) h,
    (select count(*)::int from public.professionals where barbershop_id = $1) p`, [shopA.id]);
  assert.deepEqual(r.rows[0], { s: 1, h: 7, p: 2 });
  assert.equal(shopA.slug, 'barbearia-alfa');
  assert.equal(shopA.whatsapp, '5521999990001');
});

test('slug duplicado recebe sufixo único', async () => {
  const r = await as(db, { role: 'authenticated', uid: adminId }, tx => rpc(tx, 'admin_create_barbershop', { p_name: 'Barbearia Alfa' }));
  assert.equal(r.rows[0].slug, 'barbearia-alfa-2');
});

test('funções administrativas recusam usuário comum', async () => {
  await expectError(as(db, { role: 'authenticated', uid: ownerA }, tx => rpc(tx, 'admin_list_barbershops', {})), /FORBIDDEN/);
  await expectError(as(db, { role: 'authenticated', uid: ownerA }, tx => rpc(tx, 'admin_update_barbershop', { p_id: shopA.id, p_patch: { plan: 'chatbot' } })), /FORBIDDEN/);
  await expectError(as(db, { role: 'anon' }, tx => rpc(tx, 'admin_list_barbershops', {})), /permission denied/);
});

test('admin lista barbearias com métricas e pesquisa', async () => {
  const r = await as(db, { role: 'authenticated', uid: adminId }, tx => rpc(tx, 'admin_list_barbershops', { p_search: 'alfa' }));
  assert.ok(r.rows.length >= 1);
  assert.ok(r.rows.every(x => /alfa/i.test(x.name + x.slug)));
});

// ------------------------------------------------------------------ Planos / guard
test('dono NÃO altera o próprio plano/status/slug', async () => {
  for (const col of ["plan = 'complete'", "status = 'active'", "slug = 'novo-slug'"]) {
    await expectError(as(db, { role: 'authenticated', uid: ownerB }, tx =>
      tx.query(`update public.barbershops set ${col} where id = $1`, [shopB.id])), /permission denied|Somente o administrador/);
  }
  // mas altera dados do site
  await as(db, { role: 'authenticated', uid: ownerB }, tx =>
    tx.query(`update public.barbershops set description = 'Nova descrição', theme = 'gold' where id = $1`, [shopB.id]));
});

test('admin altera plano e status; suspensão registra data', async () => {
  const r = await as(db, { role: 'authenticated', uid: adminId }, tx =>
    rpc(tx, 'admin_update_barbershop', { p_id: shopB.id, p_patch: { status: 'suspended' } }));
  assert.equal(r.rows[0].status, 'suspended');
  assert.ok(r.rows[0].suspended_at);
  const pub = await as(db, { role: 'anon' }, tx => tx.query(`select public.get_public_shop('barbearia-beta') j`));
  assert.equal(pub.rows[0].j.available, false);
  await expectError(as(db, { role: 'anon' }, tx => rpc(tx, 'create_public_booking', {
    p_slug: 'barbearia-beta', p_service_id: svcB.id, p_starts_at: iso(day, '10:00'), p_name: 'João', p_whatsapp: '21988887777' })), /SHOP_UNAVAILABLE/);
  const r2 = await as(db, { role: 'authenticated', uid: adminId }, tx =>
    rpc(tx, 'admin_update_barbershop', { p_id: shopB.id, p_patch: { status: 'active' } }));
  assert.equal(r2.rows[0].suspended_at, null);
});

test('plano SITE não libera chatbot; plano CHATBOT não libera site', async () => {
  await expectError(as(db, { role: 'anon' }, tx => rpc(tx, 'get_available_slots', {
    p_slug: 'barbearia-beta', p_service_id: svcB.id, p_date: day, p_channel: 'chatbot' })), /FEATURE_UNAVAILABLE/);
  const site = await as(db, { role: 'anon' }, tx => rpc(tx, 'get_available_slots', { p_slug: 'barbearia-beta', p_service_id: svcB.id, p_date: day }));
  assert.ok(site.rows.length > 0);
  await as(db, { role: 'authenticated', uid: adminId }, tx => rpc(tx, 'admin_update_barbershop', { p_id: shopB.id, p_patch: { plan: 'chatbot' } }));
  const pub = await as(db, { role: 'anon' }, tx => tx.query(`select public.get_public_shop('barbearia-beta', 'site') j`));
  assert.equal(pub.rows[0].j.reason, 'FEATURE_UNAVAILABLE');
  const bot = await as(db, { role: 'anon' }, tx => tx.query(`select public.get_public_shop('barbearia-beta', 'chatbot') j`));
  assert.equal(bot.rows[0].j.available, true);
  await as(db, { role: 'authenticated', uid: adminId }, tx => rpc(tx, 'admin_update_barbershop', { p_id: shopB.id, p_patch: { plan: 'site' } }));
});

// ------------------------------------------------------------------ Multi-tenant
test('anon não lê nenhuma tabela diretamente', async () => {
  for (const t of ['barbershops', 'clients', 'appointments', 'services', 'professionals', 'business_hours', 'profiles']) {
    await expectError(as(db, { role: 'anon' }, tx => tx.query(`select * from public.${t} limit 1`)), /permission denied/);
  }
});

test('barbearia A não enxerga dados da B e vice-versa', async () => {
  await as(db, { role: 'authenticated', uid: ownerB }, tx =>
    tx.query(`insert into public.clients (barbershop_id, name, whatsapp) values ($1, 'Cliente B', '21911112222')`, [shopB.id]));
  for (const [uid, mine, other] of [[ownerA, shopA.id, shopB.id], [ownerB, shopB.id, shopA.id]]) {
    await as(db, { role: 'authenticated', uid }, async tx => {
      for (const t of ['clients', 'appointments', 'services', 'professionals', 'business_hours', 'barbershop_settings', 'blocked_times']) {
        const r = await tx.query(`select count(*)::int c from public.${t} where barbershop_id = $1`, [other]);
        assert.equal(r.rows[0].c, 0, `${t} vazou`);
      }
      const shops = await tx.query('select id from public.barbershops');
      assert.deepEqual(shops.rows.map(x => x.id), [mine]);
    });
    for (const fn of ['shop_dashboard', 'shop_finance', 'shop_clients']) {
      await expectError(as(db, { role: 'authenticated', uid }, tx => rpc(tx, fn, { p_shop_id: other })), /FORBIDDEN/);
    }
  }
});

test('não é possível inserir/mover dados para outra barbearia', async () => {
  await expectError(as(db, { role: 'authenticated', uid: ownerA }, tx =>
    tx.query(`insert into public.services (barbershop_id, name, price, duration_minutes) values ($1, 'X', 1, 30)`, [shopB.id])), /row-level security/);
  const r = await as(db, { role: 'authenticated', uid: ownerA }, tx =>
    tx.query(`update public.services set barbershop_id = $1 where id = $2`, [shopB.id, svcA.id]).catch(e => e));
  assert.match(String(r.message), /row-level security|violates/);
  // profissional de A não pode receber serviço de B (FK composta)
  await expectError(as(db, { role: 'authenticated', uid: ownerA }, tx =>
    tx.query(`insert into public.professional_services (professional_id, service_id, barbershop_id) values ($1, $2, $3)`, [proA1.id, svcB.id, shopA.id])), /foreign key/);
});

test('usuário sem vínculo não vê nada', async () => {
  const r = await as(db, { role: 'authenticated', uid: outsider }, tx => tx.query('select count(*)::int c from public.barbershops'));
  assert.equal(r.rows[0].c, 0);
  await as(db, { role: 'authenticated', uid: outsider }, async tx => {
    await expectError(rpc(tx, 'panel_create_appointment', { p_shop_id: shopA.id, p_service_id: svcA.id, p_starts_at: iso(day, '10:00'), p_client_name: 'X' }), /FORBIDDEN/);
  });
});

test('admin em modo suporte acessa a barbearia e o acesso é auditado', async () => {
  await as(db, { role: 'authenticated', uid: adminId }, async tx => {
    await rpc(tx, 'admin_start_support', { p_shop_id: shopA.id });
    const ctx = (await tx.query('select public.shop_context($1) c', [shopA.id])).rows[0].c;
    assert.equal(ctx.support_mode, true);
    const r = await tx.query('select count(*)::int c from public.services where barbershop_id = $1', [shopA.id]);
    assert.ok(r.rows[0].c >= 2);
    const a = await tx.query(`select count(*)::int c from public.audit_log where action = 'support.start'`);
    assert.equal(a.rows[0].c, 1);
  });
});

// ------------------------------------------------------------------ Disponibilidade
test('motor de disponibilidade respeita expediente, intervalo e duração', async () => {
  const r = await as(db, { role: 'anon' }, tx => rpc(tx, 'get_available_slots', {
    p_slug: 'barbearia-alfa', p_service_id: svcA60.id, p_date: day, p_professional_id: proA1.id }));
  const times = r.rows.map(x => new Date(x.starts_at).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }));
  assert.equal(times[0], '09:00');
  assert.ok(times.includes('11:00'));
  assert.ok(!times.includes('11:15'), '11:15 + 60min invade o almoço 12:00-13:00');
  assert.ok(!times.includes('12:00') && !times.includes('12:30'));
  assert.ok(times.includes('13:00'));
  assert.equal(times.at(-1), '18:00', 'último início que termina às 19:00');
});

test('domingo (fechado) e datas passadas não têm horários', async () => {
  const sunday = (await db.query(`select d::date::text as d from generate_series(current_date + 1, current_date + 8, '1 day') d where extract(dow from d) = 0 limit 1`)).rows[0].d;
  const r = await as(db, { role: 'anon' }, tx => rpc(tx, 'get_available_slots', { p_slug: 'barbearia-alfa', p_service_id: svcA.id, p_date: sunday }));
  assert.equal(r.rows.length, 0);
  const past = await as(db, { role: 'anon' }, tx => rpc(tx, 'get_available_slots', { p_slug: 'barbearia-alfa', p_service_id: svcA.id, p_date: '2020-01-07' }));
  assert.equal(past.rows.length, 0);
});

test('dia especial fechado e horário individual do profissional', async () => {
  await as(db, { role: 'authenticated', uid: ownerA }, async tx => {
    await tx.query(`insert into public.professional_hours (professional_id, barbershop_id, weekday, is_working, opens_at, closes_at) values ($1, $2, 2, true, '14:00', '16:00')`, [proA2.id, shopA.id]);
  });
  const r = await as(db, { role: 'anon' }, tx => rpc(tx, 'get_available_slots', { p_slug: 'barbearia-alfa', p_service_id: svcA.id, p_date: day, p_professional_id: proA2.id }));
  const hours = r.rows.map(x => new Date(x.starts_at).getTime());
  assert.ok(hours.length > 0);
  assert.equal(new Date(Math.min(...hours)).toISOString(), new Date(iso(day, '14:00')).toISOString());
  assert.equal(new Date(Math.max(...hours)).toISOString(), new Date(iso(day, '15:30')).toISOString());

  await as(db, { role: 'authenticated', uid: ownerA }, tx => tx.query(`insert into public.special_days (barbershop_id, date, is_closed, note) values ($1, $2, true, 'Feriado')`, [shopA.id, day]));
  const closed = await as(db, { role: 'anon' }, tx => rpc(tx, 'get_available_slots', { p_slug: 'barbearia-alfa', p_service_id: svcA.id, p_date: day }));
  assert.equal(closed.rows.length, 0);
  await as(db, { role: 'authenticated', uid: ownerA }, tx => tx.query(`delete from public.special_days where barbershop_id = $1`, [shopA.id]));
  await as(db, { role: 'authenticated', uid: ownerA }, tx => tx.query(`delete from public.professional_hours where professional_id = $1`, [proA2.id]));
});

test('profissional que não realiza o serviço não é oferecido', async () => {
  await as(db, { role: 'authenticated', uid: ownerA }, tx =>
    tx.query(`insert into public.professional_services (professional_id, service_id, barbershop_id) values ($1, $2, $3)`, [proA2.id, svcA60.id, shopA.id]));
  const r = await as(db, { role: 'anon' }, tx => rpc(tx, 'get_available_slots', { p_slug: 'barbearia-alfa', p_service_id: svcA.id, p_date: day, p_professional_id: proA2.id }));
  assert.equal(r.rows.length, 0);
  await as(db, { role: 'authenticated', uid: ownerA }, tx => tx.query(`delete from public.professional_services where professional_id = $1`, [proA2.id]));
});

test('bloqueio geral e por profissional removem horários; desbloqueio devolve', async () => {
  const count = async pro => (await as(db, { role: 'anon' }, tx => rpc(tx, 'get_available_slots', { p_slug: 'barbearia-alfa', p_service_id: svcA.id, p_date: day, p_professional_id: pro }))).rows.length;
  const before1 = await count(proA1.id), before2 = await count(proA2.id);
  const b = await as(db, { role: 'authenticated', uid: ownerA }, tx =>
    tx.query(`insert into public.blocked_times (barbershop_id, professional_id, starts_at, ends_at, reason) values ($1, $2, $3, $4, 'Médico') returning id`, [shopA.id, proA1.id, iso(day, '15:00'), iso(day, '16:00')]));
  assert.ok(await count(proA1.id) < before1);
  assert.equal(await count(proA2.id), before2);
  const g = await as(db, { role: 'authenticated', uid: ownerA }, tx =>
    tx.query(`insert into public.blocked_times (barbershop_id, starts_at, ends_at, reason) values ($1, $2, $3, 'Geral') returning id`, [shopA.id, iso(day, '17:00'), iso(day, '18:00')]));
  assert.ok(await count(proA2.id) < before2);
  await as(db, { role: 'authenticated', uid: ownerA }, tx => tx.query(`delete from public.blocked_times where id = any($1)`, [[b.rows[0].id, g.rows[0].id]]));
  assert.equal(await count(proA1.id), before1);
});

// ------------------------------------------------------------------ Agendamento público
let publicAppt;
test('agendamento público cria cliente e agendamento com preço do banco', async () => {
  const r = await as(db, { role: 'anon', headers: { 'x-forwarded-for': '10.0.0.1' } }, tx => rpc(tx, 'create_public_booking', {
    p_slug: 'barbearia-alfa', p_service_id: svcA.id, p_starts_at: iso(day, '10:00'), p_name: '  João   Silva ', p_whatsapp: '(21) 98888-7777', p_professional_id: proA1.id }));
  publicAppt = r.rows[0].create_public_booking;
  assert.equal(Number(publicAppt.price), 40);
  assert.equal(publicAppt.professional_name, proA1.name);
  const a = await db.query('select * from public.appointments where id = $1', [publicAppt.id]);
  assert.equal(a.rows[0].source, 'site');
  assert.equal(a.rows[0].client_name, 'João Silva');
  assert.equal(a.rows[0].client_phone, '5521988887777');
});

test('horário reservado deixa de ser oferecido e não pode ser reservado de novo', async () => {
  const r = await as(db, { role: 'anon' }, tx => rpc(tx, 'get_available_slots', { p_slug: 'barbearia-alfa', p_service_id: svcA.id, p_date: day, p_professional_id: proA1.id }));
  const set = new Set(r.rows.map(x => new Date(x.starts_at).toISOString()));
  assert.ok(!set.has(new Date(iso(day, '10:00')).toISOString()));
  assert.ok(!set.has(new Date(iso(day, '09:45')).toISOString()), '09:45 + 30min sobrepõe 10:00');
  await expectError(as(db, { role: 'anon' }, tx => rpc(tx, 'create_public_booking', {
    p_slug: 'barbearia-alfa', p_service_id: svcA.id, p_starts_at: iso(day, '10:00'), p_name: 'Maria', p_whatsapp: '21977776666', p_professional_id: proA1.id })), /SLOT_UNAVAILABLE/);
  await expectError(as(db, { role: 'anon' }, tx => rpc(tx, 'create_public_booking', {
    p_slug: 'barbearia-alfa', p_service_id: svcA60.id, p_starts_at: iso(day, '09:30'), p_name: 'Maria', p_whatsapp: '21977776666', p_professional_id: proA1.id })), /SLOT_UNAVAILABLE/);
});

test('"sem preferência" escolhe outro profissional livre no mesmo horário', async () => {
  const r = await as(db, { role: 'anon' }, tx => rpc(tx, 'create_public_booking', {
    p_slug: 'barbearia-alfa', p_service_id: svcA.id, p_starts_at: iso(day, '10:00'), p_name: 'Pedro', p_whatsapp: '21966665555' }));
  assert.equal(r.rows[0].create_public_booking.professional_name, 'Bruno');
});

test('cliente existente (mesmo WhatsApp) é reaproveitado e não tem dados sobrescritos', async () => {
  await as(db, { role: 'anon' }, tx => rpc(tx, 'create_public_booking', {
    p_slug: 'barbearia-alfa', p_service_id: svcA.id, p_starts_at: iso(day, '14:00'), p_name: 'Nome Falso', p_whatsapp: '5521988887777', p_professional_id: proA1.id }));
  const c = await db.query(`select name from public.clients where barbershop_id = $1 and whatsapp = '5521988887777'`, [shopA.id]);
  assert.equal(c.rows.length, 1);
  assert.equal(c.rows[0].name, 'João Silva');
});

test('mesmo WhatsApp pode ser cliente de barbearias diferentes', async () => {
  await as(db, { role: 'anon' }, tx => rpc(tx, 'create_public_booking', {
    p_slug: 'barbearia-beta', p_service_id: svcB.id, p_starts_at: iso(day, '10:00'), p_name: 'João Silva', p_whatsapp: '21988887777' }));
  const c = await db.query(`select count(*)::int c from public.clients where whatsapp = '5521988887777'`);
  assert.equal(c.rows[0].c, 2);
});

test('público não agenda serviço/profissional de outra barbearia', async () => {
  await expectError(as(db, { role: 'anon' }, tx => rpc(tx, 'create_public_booking', {
    p_slug: 'barbearia-alfa', p_service_id: svcB.id, p_starts_at: iso(day, '16:00'), p_name: 'Hacker', p_whatsapp: '21955554444' })), /SERVICE_NOT_FOUND/);
  await expectError(as(db, { role: 'anon' }, tx => rpc(tx, 'create_public_booking', {
    p_slug: 'barbearia-alfa', p_service_id: svcA.id, p_starts_at: iso(day, '16:00'), p_name: 'Hacker', p_whatsapp: '21955554444', p_professional_id: proB.id })), /SLOT_UNAVAILABLE|PROFESSIONAL_NOT_FOUND/);
});

test('validação de nome, telefone e horário fora da grade', async () => {
  await expectError(as(db, { role: 'anon' }, tx => rpc(tx, 'create_public_booking', {
    p_slug: 'barbearia-alfa', p_service_id: svcA.id, p_starts_at: iso(day, '16:00'), p_name: 'A', p_whatsapp: '21955554444' })), /INVALID_NAME/);
  await expectError(as(db, { role: 'anon' }, tx => rpc(tx, 'create_public_booking', {
    p_slug: 'barbearia-alfa', p_service_id: svcA.id, p_starts_at: iso(day, '16:00'), p_name: '<script>', p_whatsapp: '21955554444' })), /INVALID_NAME/);
  await expectError(as(db, { role: 'anon' }, tx => rpc(tx, 'create_public_booking', {
    p_slug: 'barbearia-alfa', p_service_id: svcA.id, p_starts_at: iso(day, '16:00'), p_name: 'Carlos', p_whatsapp: '123' })), /INVALID_PHONE/);
  await expectError(as(db, { role: 'anon' }, tx => rpc(tx, 'create_public_booking', {
    p_slug: 'barbearia-alfa', p_service_id: svcA.id, p_starts_at: iso(day, '16:07'), p_name: 'Carlos', p_whatsapp: '21955554444' })), /SLOT_UNAVAILABLE/);
  await expectError(as(db, { role: 'anon' }, tx => rpc(tx, 'create_public_booking', {
    p_slug: 'barbearia-alfa', p_service_id: svcA.id, p_starts_at: iso(day, '22:00'), p_name: 'Carlos', p_whatsapp: '21955554444' })), /SLOT_UNAVAILABLE/);
});

test('rate limit por telefone e limite de reservas ativas', async () => {
  const book = (t, phone) => as(db, { role: 'anon' }, tx => rpc(tx, 'create_public_booking', {
    p_slug: 'barbearia-alfa', p_service_id: svcA.id, p_starts_at: iso(day, t), p_name: 'Spammer', p_whatsapp: phone }));
  await book('15:00', '21944443333'); await book('15:30', '21944443333'); await book('16:00', '21944443333');
  await expectError(book('16:30', '21944443333'), /TOO_MANY_ACTIVE|RATE_LIMIT/);
});

test('rate limit por IP', async () => {
  const ip = { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' };
  await db.query(`insert into public.booking_rate_events (bucket) select 'ip:203.0.113.9' from generate_series(1, 12)`);
  await expectError(as(db, { role: 'anon', headers: ip }, tx => rpc(tx, 'create_public_booking', {
    p_slug: 'barbearia-alfa', p_service_id: svcA.id, p_starts_at: iso(day, '17:00'), p_name: 'Bot', p_whatsapp: '21933332222' })), /RATE_LIMIT/);
});

test('concorrência: exclusion constraint impede sobreposição mesmo sem a função', async () => {
  const c = (await db.query(`select id from public.clients where barbershop_id = $1 limit 1`, [shopA.id])).rows[0].id;
  await expectError(db.query(`insert into public.appointments (barbershop_id, client_id, service_id, professional_id, starts_at, ends_at, price)
    values ($1, $2, $3, $4, $5, $6, 40)`, [shopA.id, c, svcA.id, proA1.id, iso(day, '10:15'), iso(day, '10:45')]), /appointments_no_overlap/);
});

test('concorrência: duas reservas simultâneas no mesmo horário → apenas uma vence', async () => {
  const attempt = (name, phone) => as(db, { role: 'anon' }, tx => rpc(tx, 'create_public_booking', {
    p_slug: 'barbearia-alfa', p_service_id: svcA.id, p_starts_at: iso(day, '18:30'), p_name: name, p_whatsapp: phone, p_professional_id: proA1.id }));
  const results = await Promise.allSettled([attempt('Cliente Um', '21922221111'), attempt('Cliente Dois', '21922220000')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /SLOT_UNAVAILABLE/);
});

// ------------------------------------------------------------------ Agenda (painel)
let panelAppt;
test('painel cria agendamento manual, remarca, conclui, falta e cancela', async () => {
  await as(db, { role: 'authenticated', uid: ownerA }, async tx => {
    panelAppt = (await rpc(tx, 'panel_create_appointment', { p_shop_id: shopA.id, p_service_id: svcA60.id, p_starts_at: iso(day, '11:00'), p_client_name: 'Walk-in', p_client_phone: '21911110000', p_professional_id: proA1.id })).rows[0];
    assert.equal(panelAppt.source, 'panel');
    assert.equal(Number(panelAppt.price), 70);
  });
  await expectError(as(db, { role: 'authenticated', uid: ownerA }, tx => rpc(tx, 'reschedule_appointment', { p_appointment_id: panelAppt.id, p_starts_at: iso(day, '09:30') })), /SLOT_UNAVAILABLE/);
  await as(db, { role: 'authenticated', uid: ownerA }, async tx => {
    const moved = (await rpc(tx, 'reschedule_appointment', { p_appointment_id: panelAppt.id, p_starts_at: iso(day, '11:00'), p_professional_id: proA2.id })).rows[0];
    assert.equal(moved.professional_id, proA2.id);
    const done = (await rpc(tx, 'set_appointment_status', { p_appointment_id: panelAppt.id, p_status: 'completed' })).rows[0];
    assert.ok(done.completed_at);
  });
  await as(db, { role: 'authenticated', uid: ownerA }, async tx => {
    const ns = (await rpc(tx, 'set_appointment_status', { p_appointment_id: publicAppt.id, p_status: 'no_show' })).rows[0];
    assert.ok(ns.no_show_at);
  });
  await expectError(as(db, { role: 'authenticated', uid: ownerB }, tx => rpc(tx, 'set_appointment_status', { p_appointment_id: panelAppt.id, p_status: 'cancelled' })), /NOT_FOUND/);
});

test('cancelamento libera o horário para nova reserva', async () => {
  const a = await as(db, { role: 'authenticated', uid: ownerA }, tx =>
    rpc(tx, 'panel_create_appointment', { p_shop_id: shopA.id, p_service_id: svcA.id, p_starts_at: iso(day, '13:00'), p_client_name: 'Temp', p_professional_id: proA1.id }));
  await as(db, { role: 'authenticated', uid: ownerA }, tx => rpc(tx, 'set_appointment_status', { p_appointment_id: a.rows[0].id, p_status: 'cancelled', p_reason: 'Cliente desistiu' }));
  const r = await as(db, { role: 'anon' }, tx => rpc(tx, 'create_public_booking', {
    p_slug: 'barbearia-alfa', p_service_id: svcA.id, p_starts_at: iso(day, '13:00'), p_name: 'Novo', p_whatsapp: '21900001111', p_professional_id: proA1.id }));
  assert.ok(r.rows[0].create_public_booking.id);
});

test('dono não altera preço/horário diretamente (somente via RPC validada)', async () => {
  await expectError(as(db, { role: 'authenticated', uid: ownerA }, tx => tx.query(`update public.appointments set price = 0 where id = $1`, [panelAppt.id])), /permission denied/);
  await expectError(as(db, { role: 'authenticated', uid: ownerA }, tx => tx.query(`update public.appointments set starts_at = now() where id = $1`, [panelAppt.id])), /permission denied/);
  await expectError(as(db, { role: 'authenticated', uid: ownerA }, tx => tx.query(`insert into public.appointments (barbershop_id, starts_at, ends_at, professional_id) values ($1, now(), now() + interval '1h', $2)`, [shopA.id, proA1.id])), /permission denied/);
});

test('serviço com histórico não pode ser excluído (apenas desativado)', async () => {
  await expectError(as(db, { role: 'authenticated', uid: ownerA }, tx => tx.query('delete from public.services where id = $1', [svcA60.id])), /foreign key|violates/);
  const s = await as(db, { role: 'authenticated', uid: ownerA }, async tx => {
    const n = (await tx.query(`insert into public.services (barbershop_id, name, price, duration_minutes) values ($1, 'Temporário', 10, 15) returning id`, [shopA.id])).rows[0].id;
    await tx.query('delete from public.services where id = $1', [n]);
    return (await tx.query('select count(*)::int c from public.services where id = $1', [n])).rows[0].c;
  });
  assert.equal(s, 0);
});

// ------------------------------------------------------------------ Financeiro / dashboard
test('financeiro: somente concluídos entram; ticket médio correto', async () => {
  // Concluído no passado para entrar no mês corrente com segurança
  const pastClient = (await db.query(`select id from public.clients where barbershop_id = $1 limit 1`, [shopA.id])).rows[0].id;
  const today = (await db.query(`select (now() at time zone 'America/Sao_Paulo')::date::text d`)).rows[0].d;
  await db.query(`insert into public.appointments (barbershop_id, client_id, service_id, professional_id, starts_at, ends_at, status, price, service_name, client_name)
    values ($1, $2, $3, $4, ($5::date + time '00:01') at time zone 'America/Sao_Paulo', ($5::date + time '00:31') at time zone 'America/Sao_Paulo', 'completed', 40, 'Corte', 'Hist 1'),
           ($1, $2, $3, $4, ($5::date + time '00:31') at time zone 'America/Sao_Paulo', ($5::date + time '01:01') at time zone 'America/Sao_Paulo', 'cancelled', 999, 'Corte', 'Hist 2')`,
    [shopA.id, pastClient, svcA.id, proA2.id, today]);
  const f = (await as(db, { role: 'authenticated', uid: ownerA }, tx => tx.query(`select public.shop_finance($1, $2::date, $3::date) j`, [shopA.id, today, day]))).rows[0].j;
  // concluídos no período: hoje 40 + panelAppt 70 (dia de teste) = 110; cancelado 999 e falta (publicAppt) não entram
  assert.equal(Number(f.period.revenue), 110);
  assert.equal(f.period.completed, 2);
  assert.equal(Number(f.period.avg_ticket), 55);
  assert.ok(f.period.cancelled >= 1);
  assert.equal(f.period.no_show, 1);
  assert.equal(Number(f.revenue_today), 40);
  const d = (await as(db, { role: 'authenticated', uid: ownerA }, tx => tx.query(`select public.shop_dashboard($1) j`, [shopA.id]))).rows[0].j;
  assert.equal(Number(d.revenue_today), 40);
  assert.ok(d.upcoming_count >= 1);
  assert.ok(d.clients_total >= 1);
});

test('clientes: estatísticas de atendimentos e total gasto', async () => {
  const r = await as(db, { role: 'authenticated', uid: ownerA }, tx => rpc(tx, 'shop_clients', { p_shop_id: shopA.id, p_search: 'walk' }));
  assert.equal(r.rows.length, 1);
  assert.equal(Number(r.rows[0].visits_count), 1);
  assert.equal(Number(r.rows[0].total_spent), 70);
});

// ------------------------------------------------------------------ Notificações
test('novo agendamento público gera notificação idempotente; ação do próprio dono não notifica ele', async () => {
  const o = await db.query(`select kind, dedupe_key, exclude_user_id, url from public.notification_outbox where appointment_id = $1`, [publicAppt.id]);
  assert.equal(o.rows.filter(x => x.kind === 'new_booking').length, 1);
  assert.match(o.rows[0].url, /^\/agendamentos\/\?appointment=/);
  const p = await db.query(`select exclude_user_id from public.notification_outbox where appointment_id = $1 and kind = 'new_booking'`, [panelAppt.id]);
  assert.equal(p.rows[0].exclude_user_id, ownerA);
});

test('push: subscription salva, alvo respeita tenant/preferências e inválida é removida', async () => {
  const subId = await as(db, { role: 'authenticated', uid: ownerA }, async tx =>
    (await rpc(tx, 'save_push_subscription', { p_shop_id: shopA.id, p_endpoint: 'https://push.example/abc', p_p256dh: 'k', p_auth: 'a', p_user_agent: 'test' })).rows[0].save_push_subscription);
  await expectError(as(db, { role: 'authenticated', uid: ownerA }, tx =>
    rpc(tx, 'save_push_subscription', { p_shop_id: shopB.id, p_endpoint: 'https://push.example/x', p_p256dh: 'k', p_auth: 'a' })), /FORBIDDEN/);
  // re-registro do mesmo endpoint não duplica
  await as(db, { role: 'authenticated', uid: ownerA }, tx => rpc(tx, 'save_push_subscription', { p_shop_id: shopA.id, p_endpoint: 'https://push.example/abc', p_p256dh: 'k2', p_auth: 'a2' }));
  assert.equal((await db.query(`select count(*)::int c from public.push_subscriptions where endpoint = 'https://push.example/abc'`)).rows[0].c, 1);

  const outbox = (await db.query(`select id from public.notification_outbox where appointment_id = $1 and kind = 'new_booking'`, [publicAppt.id])).rows[0].id;
  let t = await db.query('select * from public.dispatch_targets($1)', [outbox]);
  assert.equal(t.rows.length, 1);
  await as(db, { role: 'authenticated', uid: ownerA }, tx => tx.query(`update public.notification_preferences set new_booking = false where user_id = $1`, [ownerA]));
  t = await db.query('select * from public.dispatch_targets($1)', [outbox]);
  assert.equal(t.rows.length, 0);
  await db.query('select public.dispatch_subscription_result($1, false, true)', [subId]);
  assert.equal((await db.query(`select count(*)::int c from public.push_subscriptions where id = $1`, [subId])).rows[0].c, 0);
});

test('push: outro usuário não lê subscriptions alheias; anon não chama funções de envio', async () => {
  await as(db, { role: 'authenticated', uid: ownerA }, tx => rpc(tx, 'save_push_subscription', { p_shop_id: shopA.id, p_endpoint: 'https://push.example/def', p_p256dh: 'k', p_auth: 'a' }));
  const r = await as(db, { role: 'authenticated', uid: ownerB }, tx => tx.query('select count(*)::int c from public.push_subscriptions'));
  assert.equal(r.rows[0].c, 0);
  await expectError(as(db, { role: 'anon' }, tx => tx.query('select * from public.dispatch_claim(10)')), /permission denied/);
  await expectError(as(db, { role: 'authenticated', uid: ownerA }, tx => tx.query('select * from public.dispatch_claim(10)')), /permission denied/);
});

test('notificação de teste só para o próprio usuário e com limite', async () => {
  await as(db, { role: 'authenticated', uid: ownerA }, tx => tx.query(`update public.notification_preferences set new_booking = true where user_id = $1`, [ownerA]));
  const id = await as(db, { role: 'authenticated', uid: ownerA }, async tx => (await rpc(tx, 'enqueue_test_notification', { p_shop_id: shopA.id })).rows[0].enqueue_test_notification);
  const t = await db.query('select * from public.dispatch_targets($1)', [id]);
  assert.equal(t.rows.length, 1);
  await expectError(as(db, { role: 'authenticated', uid: ownerB }, tx => rpc(tx, 'enqueue_test_notification', { p_shop_id: shopB.id })), /NO_DEVICE/);
  for (let i = 0; i < 4; i++) await as(db, { role: 'authenticated', uid: ownerA }, tx => rpc(tx, 'enqueue_test_notification', { p_shop_id: shopA.id }));
  await expectError(as(db, { role: 'authenticated', uid: ownerA }, tx => rpc(tx, 'enqueue_test_notification', { p_shop_id: shopA.id })), /RATE_LIMIT/);
});

test('cancelamento e remarcação geram notificações; lembrete é enviado uma única vez', async () => {
  const a = await as(db, { role: 'authenticated', uid: ownerA }, tx =>
    rpc(tx, 'panel_create_appointment', { p_shop_id: shopA.id, p_service_id: svcA.id, p_starts_at: iso(day, '16:30'), p_client_name: 'Lembrar', p_professional_id: proA2.id }));
  const id = a.rows[0].id;
  await as(db, { role: 'authenticated', uid: ownerA }, tx => rpc(tx, 'reschedule_appointment', { p_appointment_id: id, p_starts_at: iso(day, '17:30') }));
  const kinds = (await db.query('select kind from public.notification_outbox where appointment_id = $1 order by id', [id])).rows.map(r => r.kind);
  assert.deepEqual(kinds, ['new_booking', 'reschedule']);
  // aproxima o atendimento para dentro da janela de lembrete
  await db.query(`update public.appointments set starts_at = now() + interval '20 minutes', ends_at = now() + interval '50 minutes' where id = $1`, [id]).catch(() => {});
  const n1 = (await db.query('select private.enqueue_due_reminders() n')).rows[0].n;
  const n2 = (await db.query('select private.enqueue_due_reminders() n')).rows[0].n;
  assert.ok(n1 >= 1);
  assert.equal(n2, 0);
  assert.equal((await db.query(`select count(*)::int c from public.notification_outbox where appointment_id = $1 and kind = 'reminder'`, [id])).rows[0].c, 1);
  await as(db, { role: 'authenticated', uid: ownerA }, tx => rpc(tx, 'set_appointment_status', { p_appointment_id: id, p_status: 'cancelled' }));
  assert.equal((await db.query(`select count(*)::int c from public.notification_outbox where appointment_id = $1 and kind = 'cancellation'`, [id])).rows[0].c, 1);
});

test('dispatch_claim não entrega a mesma notificação duas vezes', async () => {
  const first = await db.query('select id from public.dispatch_claim(500)');
  const second = await db.query('select id from public.dispatch_claim(500)');
  assert.ok(first.rows.length > 0);
  assert.equal(second.rows.length, 0);
});

test('manutenção remove subscriptions com falhas repetidas', async () => {
  await db.query(`update public.push_subscriptions set failure_count = 5`);
  const r = (await db.query('select private.maintenance() j')).rows[0].j;
  assert.ok(r.subscriptions_removed >= 1);
});

test('dados legados preservados (Barbearia Vision continua com serviços e horários)', async () => {
  const r = await as(db, { role: 'anon' }, tx => tx.query(`select public.get_public_shop('barbearia-vision') j`));
  assert.equal(r.rows[0].j.available, true);
  assert.equal(r.rows[0].j.services.length, 3);
  assert.equal(r.rows[0].j.professionals.length, 1);
  assert.equal(r.rows[0].j.shop.is_demo, true);
  assert.ok(!('owner_name' in r.rows[0].j.shop), 'não expõe dados privados');
  const h = await db.query(`select count(*)::int c from public.business_hours where barbershop_id = $1`, [VISION]);
  assert.equal(h.rows[0].c, 7);
});
