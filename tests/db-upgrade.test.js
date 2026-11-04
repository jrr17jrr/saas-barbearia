// Cenário real de produção (2026-11-03): a migration 01 foi aplicada sozinha e as tabelas
// novas ficaram sem RLS e com INSERT para anon. Este teste reproduz esse estado
// intermediário e garante que a 02 fecha a brecha e remove dados forjados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, as, expectError } from './helpers/db.js';

test('upgrade a partir do estado real (01 aplicada sem RLS): admin forjado é removido e a brecha fecha', async () => {
  let forged, legit;
  const db = await createDb({
    afterFile: async (f, db) => {
      if (!f.startsWith('20261101000100')) return;
      // Simula o estado exposto: anon com escrita direta (default privileges do Supabase)
      await db.exec('grant all on public.platform_admins, public.professionals to anon, authenticated');
      forged = (await db.query(`insert into auth.users (email, email_confirmed_at) values ('atacante@example.com', now()) returning id`)).rows[0].id;
      legit = (await db.query(`insert into auth.users (email, email_confirmed_at) values ('visionariodev@gmail.com', now()) returning id`)).rows[0].id;
      await as(db, { role: 'anon' }, tx => tx.query('insert into public.platform_admins (user_id) values ($1)', [forged]));
      const n = await db.query('select count(*)::int c from public.platform_admins');
      assert.equal(n.rows[0].c, 1, 'estado intermediário reproduzido (escrita anônima possível)');
    },
  });

  const admins = (await db.query('select user_id from public.platform_admins')).rows.map(r => r.user_id);
  assert.deepEqual(admins, [legit], 'somente o admin DEV legítimo permanece');
  const r = await as(db, { role: 'authenticated', uid: forged }, tx => tx.query('select public.is_platform_admin() v'));
  assert.equal(r.rows[0].v, false);

  await expectError(as(db, { role: 'anon' }, tx => tx.query('insert into public.platform_admins (user_id) values ($1)', [forged])), /permission denied/);
  await expectError(as(db, { role: 'authenticated', uid: forged }, tx => tx.query('insert into public.platform_admins (user_id) values ($1)', [forged])), /permission denied/);
  await expectError(as(db, { role: 'anon' }, tx => tx.query(`select * from public.professionals`)), /permission denied/);
  for (const t of ['platform_admins', 'professionals', 'professional_services', 'professional_hours', 'special_days', 'booking_rate_events', 'audit_log']) {
    const rls = await db.query(`select relrowsecurity from pg_class where oid = $1::regclass`, [`public.${t}`]);
    assert.equal(rls.rows[0].relrowsecurity, true, `RLS ativa em ${t}`);
  }
  await db.close();
});

test('SQL de emergência é idempotente e compatível com as migrations seguintes', async () => {
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync(new URL('../supabase/manual/00_emergencia_rls.sql', import.meta.url), 'utf8');
  let forged;
  const db = await createDb({
    afterFile: async (f, db) => {
      if (!f.startsWith('20261101000100')) return;
      await db.exec('grant all on public.platform_admins to anon, authenticated');
      forged = (await db.query(`insert into auth.users (email, email_confirmed_at) values ('x@example.com', now()) returning id`)).rows[0].id;
      await db.query('insert into public.platform_admins (user_id) values ($1)', [forged]);
      await db.exec(sql);
      await db.exec(sql); // duas vezes
      assert.equal((await db.query('select count(*)::int c from public.platform_admins')).rows[0].c, 0);
      await expectError(as(db, { role: 'anon' }, tx => tx.query('select * from public.platform_admins')), /permission denied/);
      // site público legado continua lendo a vitrine enquanto as RPCs não existem
      const shops = await as(db, { role: 'anon' }, tx => tx.query('select name, slug from public.barbershops'));
      assert.ok(shops.rows.length >= 1);
      await expectError(as(db, { role: 'anon' }, tx => tx.query('select admin_notes from public.barbershops')), /permission denied/);
    },
  });
  assert.equal((await db.query('select count(*)::int c from public.platform_admins')).rows[0].c, 0);
  await db.close();
});
