// Verificação de produção SOMENTE LEITURA (não grava nada): `npm run smoke`
// Confere pela API pública se migrations, RLS e Edge Functions estão no ar.
import { readFileSync } from 'node:fs';

// Lê URL e chave publishable (pública) do próprio cliente do app — fonte única.
const client = readFileSync(new URL('../supabase-client.js', import.meta.url), 'utf8');
const URL_ = /SUPABASE_URL = "([^"]+)"/.exec(client)[1];
const KEY = /SUPABASE_PUBLISHABLE_KEY = "([^"]+)"/.exec(client)[1];

const APP = process.env.APP_URL || 'https://saas-barbearia-swart.vercel.app';
const H = { apikey: KEY, 'Content-Type': 'application/json' };
const results = [];
const check = async (name, fn) => {
  try { const r = await fn(); results.push([r === true ? 'OK ' : 'FALHA', name, r === true ? '' : r]); }
  catch (e) { results.push(['FALHA', name, e.message]); }
};
const rest = (path, init = {}) => fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
const body = async r => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };

await check('Migration 03: RPC get_public_shop existe', async () => {
  const r = await rest('rpc/get_public_shop', { method: 'POST', body: JSON.stringify({ p_slug: 'barbearia-vision' }) });
  const j = await body(r);
  return r.ok && typeof j === 'object' && 'available' in j ? true : `HTTP ${r.status} ${JSON.stringify(j).slice(0, 120)}`;
});
await check('Migration 05: tabela notification_outbox existe (anon sem acesso)', async () => {
  const j = await body(await rest('notification_outbox?select=id&limit=1'));
  return j?.code === 'PGRST205' ? 'tabela inexistente (migration 05 não aplicada)' : (Array.isArray(j) && j.length ? 'anon LÊ a fila!' : true);
});
for (const t of ['platform_admins', 'professionals', 'clients', 'appointments', 'push_subscriptions', 'audit_log', 'booking_rate_events', 'barbershop_members', 'profiles']) {
  await check(`RLS/grants: anon não lê ${t}`, async () => {
    const r = await rest(`${t}?select=*&limit=1`);
    const j = await body(r);
    if (r.status === 401 || r.status === 403 || j?.code === '42501') return true;
    return Array.isArray(j) && j.length === 0 ? `anon tem SELECT (0 linhas visíveis agora) — migration 02 pendente` : `anon recebeu ${JSON.stringify(j).slice(0, 80)}`;
  });
}
await check('Migration 02: anon NÃO lê owner_email/admin_notes de barbershops', async () => {
  const r = await rest('barbershops?select=owner_email,admin_notes&limit=1');
  return r.ok ? 'anon lê colunas privadas de barbershops' : true;
});
await check('Edge Function push-dispatch: sem segredo → 401', async () => {
  const r = await fetch(`${URL_}/functions/v1/push-dispatch`, { method: 'POST', headers: H, body: '{}' });
  return r.status === 401 ? true : `HTTP ${r.status} (404 = função não publicada)`;
});
await check('Edge Function push: sem login → 401', async () => {
  const r = await fetch(`${URL_}/functions/v1/push`, { headers: H });
  return r.status === 401 ? true : `HTTP ${r.status} (404 = função não publicada)`;
});
await check('Vercel: site no ar e service worker sem cache', async () => {
  const [home, sw] = await Promise.all([fetch(APP), fetch(`${APP}/sw.js`)]);
  if (!home.ok) return `home HTTP ${home.status}`;
  if (!sw.ok) return `sw.js HTTP ${sw.status}`;
  return /no-cache|no-store/.test(sw.headers.get('cache-control') || '') ? true : 'sw.js com cache';
});
await check('Vercel: manifest PWA', async () => {
  const r = await fetch(`${APP}/manifest.webmanifest`);
  const j = await r.json();
  return j.display === 'standalone' && j.start_url && j.icons?.length ? true : 'manifest incompleto';
});

for (const [s, n, d] of results) console.log(`${s}  ${n}${d ? `  → ${d}` : ''}`);
const fails = results.filter(r => r[0] === 'FALHA').length;
console.log(`\n${results.length - fails}/${results.length} verificações OK`);
process.exitCode = fails ? 1 : 0;
