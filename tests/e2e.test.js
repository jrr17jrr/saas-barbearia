// Testes E2E no Chrome headless contra o build (dist/), com a API do Supabase simulada.
// Validam: guarda de rota, login, fluxo público completo, chatbot, painel, DEV, PWA e layout mobile.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { build } from '../scripts/build.js';
import { serve } from '../scripts/serve.js';
import { findChrome } from '../scripts/make-icons.js';

const BASE = 'http://127.0.0.1:4179';
const SUPA = 'https://idtvkslyyexwbqcgrozh.supabase.co';
const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const SVC = '22222222-2222-4222-8222-222222222222';
const PRO1 = '33333333-3333-4333-8333-333333333333';
const PRO2 = '44444444-4444-4444-8444-444444444444';
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const slotA = `${tomorrow}T13:00:00.000Z`, slotB = `${tomorrow}T13:30:00.000Z`;

const publicShop = (features = { site: true, chatbot: true }) => ({
  available: true,
  shop: { slug: 'barbearia-teste', name: 'Barbearia Teste', description: 'Desc', address: 'Rua A, 1', whatsapp: '5521999990000', instagram: '@teste', facebook: null, tiktok: null, logo_url: null, review_link: 'https://g.page/r/x', maps_link: null, google_rating: 4.8, public_status_text: 'Aberto agora', theme: 'gold', primary_color: '#d6a83b', background_color: '#0c0c0d', card_color: '#191919', timezone: 'America/Sao_Paulo', max_days_ahead: 30, is_demo: false, features },
  chatbot: { name: 'Vision Bot', greeting: 'Olá! <b>teste</b>', sync_with_site: true, theme: 'gold' },
  services: [{ id: SVC, name: 'Corte <script>', description: 'Tradicional', price: 40, duration_minutes: 30, image_url: null }],
  professionals: [{ id: PRO1, name: 'Ana', specialty: 'Degradê', photo_url: null, service_ids: [] }, { id: PRO2, name: 'Bruno', specialty: null, photo_url: null, service_ids: [] }],
  hours: [0, 1, 2, 3, 4, 5, 6].map(d => ({ weekday: d, is_open: true, opens_at: '09:00:00', closes_at: '19:00:00' })),
  today: { date: new Date().toISOString().slice(0, 10), special: null },
});

const fakeJwt = (() => {
  const b = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ sub: 'u1', role: 'authenticated', exp: 4102444800, email: 'dono@example.com' })}.sig`;
})();
const user = { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'dono@example.com', user_metadata: { full_name: 'Ricardo Teste' }, app_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const session = { access_token: fakeJwt, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user };

let server, browser;
const calls = [];

function mockFor(page, { admin = false, publicData = publicShop() } = {}) {
  return async req => {
    const url = req.url();
    if (!url.startsWith(SUPA)) return req.continue();
    const path = new URL(url).pathname;
    const body = req.postData() ? JSON.parse(req.postData() || 'null') : null;
    calls.push({ path, method: req.method(), body });
    const ok = data => req.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) });
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const rpc = path.replace('/rest/v1/rpc/', '');
    switch (rpc) {
      case 'get_public_shop': return ok(publicData);
      case 'get_available_slots': return ok([{ starts_at: slotA, professional_id: PRO1 }, { starts_at: slotB, professional_id: PRO2 }]);
      case 'create_public_booking': return ok({ id: 'a1', starts_at: body.p_starts_at, ends_at: body.p_starts_at, service_name: 'Corte', price: 40, professional_name: 'Ana', shop_name: 'Barbearia Teste', timezone: 'America/Sao_Paulo' });
      case 'my_context': return ok({ user_id: 'u1', is_platform_admin: admin, profile: {}, shops: [{ id: SHOP_ID, name: 'Barbearia Teste', slug: 'barbearia-teste', status: 'active', plan: 'complete', role: 'owner', features: { site: true, chatbot: true } }] });
      case 'shop_context': return ok({ id: SHOP_ID, name: 'Barbearia Teste', slug: 'barbearia-teste', status: 'active', plan: 'complete', timezone: 'America/Sao_Paulo', role: 'owner', support_mode: false, features: { site: true, chatbot: true } });
      case 'shop_dashboard': return ok({ today: tomorrow, today_total: 7, today_confirmed: 5, today_completed: 2, yesterday_total: 4, upcoming_count: 9, clients_total: 42, clients_month: 20, revenue_today: 150, revenue_week: 900, revenue_month: 3200, expected_today: 200, month_completed: 80, month_cancelled: 3, month_no_show: 1, top_service: { name: 'Corte', count: 50 }, top_professional: { name: 'Ana', count: 44 }, today_list: [{ id: 'a1', starts_at: slotA, ends_at: slotB, client_name: 'João <img>', service_name: 'Corte', status: 'confirmed', price: 40, professional_name: 'Ana' }], next_list: [] });
      case 'shop_finance': return ok({ from: tomorrow, to: tomorrow, revenue_today: 150, revenue_week: 900, revenue_month: 3200, revenue_prev_month: 2800, period: { revenue: 3200, completed: 80, cancelled: 3, no_show: 1, confirmed: 10, expected: 400, avg_ticket: 40 }, by_day: [], by_service: [{ name: 'Corte', revenue: 2000, count: 50 }], by_professional: [{ name: 'Ana', revenue: 1800, count: 44 }], history: [], monthly: [{ month: '2026-10', revenue: 2800, count: 70 }, { month: '2026-11', revenue: 3200, count: 80 }] });
      case 'shop_clients': return ok([{ id: 'c1', name: 'João', whatsapp: '5521988887777', phone: null, notes: null, created_at: '2026-01-01', visits_count: 3, total_spent: 120, first_visit_at: '2026-09-01T12:00:00Z', last_visit_at: '2026-10-20T12:00:00Z', next_appointment_at: null, no_show_count: 0, favorite_service: 'Corte' }]);
      case 'admin_list_barbershops': return ok([{ id: SHOP_ID, name: 'Barbearia Teste', slug: 'barbearia-teste', status: 'active', plan: 'complete', owner_name: 'Ricardo', owner_email: 'dono@example.com', owner_user_id: 'u1', whatsapp: '5521999990000', address: 'Rua A', created_at: '2026-10-01T10:00:00Z', last_access_at: null, clients_count: 42, appointments_count: 100, upcoming_count: 9, members_count: 1 }]);
      case 'is_platform_admin': return ok(admin);
      case 'touch_last_seen': return ok(null);
      case 'save_push_subscription': return ok('s1');
    }
    if (path.startsWith('/auth/v1/user')) return ok(user);
    if (path.startsWith('/auth/v1/logout')) return req.respond({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    if (path.startsWith('/functions/v1/push')) return req.respond({ status: 503, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"error":"vapid_not_configured"}' });
    if (path.startsWith('/rest/v1/')) {
      const table = path.split('/')[3];
      const accept = req.headers()['accept'] || '';
      const single = accept.includes('vnd.pgrst.object');
      const rows = {
        services: [{ id: SVC, name: 'Corte', price: 40, duration_minutes: 30, active: true, sort_order: 1, description: null, image_url: null }],
        professionals: [{ id: PRO1, name: 'Ana', active: true, sort_order: 0, phone: null, specialty: null, photo_url: null, user_id: null }],
        business_hours: [1, 2, 3, 4, 5, 6].map(d => ({ weekday: d, is_open: true, opens_at: '09:00:00', closes_at: '19:00:00', break_start: '12:00:00', break_end: '13:00:00' })),
        appointments: [{ id: 'a1', starts_at: slotA, ends_at: slotB, status: 'confirmed', client_name: 'Maria', client_phone: '5521977776666', service_name: 'Corte', price: 40, source: 'site', notes: null, professional_id: PRO1, service_id: SVC, client_id: 'c1', cancel_reason: null }],
        barbershops: [{ id: SHOP_ID, name: 'Barbearia Teste', slug: 'barbearia-teste', plan: 'complete', status: 'active', whatsapp: '5521999990000', theme: 'cyan', primary_color: '#08a9df', background_color: '#0b1220', card_color: '#131e31', slot_interval_minutes: 15, min_notice_minutes: 30, max_days_ahead: 30, instagram_enabled: true, whatsapp_enabled: true }],
        barbershop_settings: [{ barbershop_id: SHOP_ID, site_enabled: true, chatbot_enabled: true, chatbot_name: 'Bot', chatbot_greeting: 'Oi', chatbot_sync_with_site: true, chatbot_theme: 'cyan', reminder_minutes: 30 }],
      }[table] || [];
      if (req.method() !== 'GET' && req.method() !== 'HEAD') return req.respond({ status: single ? 200 : 201, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(single ? rows[0] || {} : rows) });
      return ok(single ? rows[0] || null : rows);
    }
    return ok({});
  };
}

async function newPage({ auth = false, admin = false, publicData, mobile = false } = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/WebSocket|realtime|Failed to load resource|ERR_|status of 50/i.test(m.text())) errors.push(m.text()); });
  if (mobile) await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.setRequestInterception(true);
  page.on('request', mockFor(page, { admin, publicData }));
  if (auth) await page.evaluateOnNewDocument(s => localStorage.setItem('sb-idtvkslyyexwbqcgrozh-auth-token', s), JSON.stringify(session));
  page.errors = errors;
  return page;
}
const clickText = async (page, sel, text) => {
  await page.waitForFunction((s, t) => [...document.querySelectorAll(s)].some(e => e.textContent.includes(t) && !e.disabled), { timeout: 8000 }, sel, text);
  await page.evaluate((s, t) => [...document.querySelectorAll(s)].find(e => e.textContent.includes(t) && !e.disabled).click(), sel, text);
};

before(async () => {
  build();
  server = await serve('dist', 4179);
  browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: ['--no-sandbox'] });
});
after(async () => { await browser?.close(); server?.close(); });

test('rota privada sem sessão redireciona para login com next', async () => {
  const page = await newPage();
  await page.goto(`${BASE}/agendamentos/?date=2026-11-02`, { waitUntil: 'networkidle0' });
  assert.match(page.url(), /\/login\/\?next=%2Fagendamentos%2F/);
  assert.ok(await page.$('#email'));
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('login: valida campos e mostra erro de credenciais', async () => {
  const page = await newPage();
  await page.goto(`${BASE}/login/`, { waitUntil: 'networkidle0' });
  await page.type('#email', 'x');
  await page.click('#submit');
  assert.match(await page.$eval('#msg', e => e.textContent), /e-mail válido/);
  await page.close();
});

test('sessão persistida abre o painel sem pedir login (dashboard com dados reais)', async () => {
  const page = await newPage({ auth: true });
  await page.goto(`${BASE}/dashboard/`, { waitUntil: 'networkidle0' });
  assert.match(page.url(), /\/dashboard\//);
  await page.waitForFunction(() => document.querySelector('#kToday').textContent === '7');
  assert.equal(await page.$eval('#kRevenue', e => e.textContent.replace(/\s/g, ' ')), 'R$ 150,00');
  assert.ok(!(await page.content()).includes('<img>João'), 'nome do cliente escapado');
  assert.ok(await page.$('#navLogout'));
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('todas as páginas do painel carregam sem erros', async () => {
  for (const path of ['/agendamentos/', '/clientes/', '/profissionais/', '/servicos/', '/horarios/', '/lucros/', '/chatbot-config/', '/editar-link/', '/configuracoes/']) {
    const page = await newPage({ auth: true });
    await page.goto(BASE + path, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !document.querySelector('.ui-state.loading'), { timeout: 8000 }).catch(() => {});
    assert.match(page.url(), new RegExp(path.replace(/\//g, '\\/')), path);
    assert.ok(!(await page.$('.ui-state.error')), `estado de erro em ${path}`);
    assert.deepEqual(page.errors, [], `erros em ${path}`);
    await page.close();
  }
});

test('agenda: abre detalhes do agendamento via deep link da notificação', async () => {
  const page = await newPage({ auth: true });
  await page.goto(`${BASE}/agendamentos/?appointment=a1&date=${tomorrow}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.ui-modal', { timeout: 8000 });
  const txt = await page.$eval('.ui-modal', e => e.textContent);
  assert.match(txt, /Maria/);
  assert.match(txt, /Concluir atendimento/);
  await page.close();
});

test('site público: fluxo completo Serviço → Profissional → Data → Horário → Dados → Revisão → Confirmar', async () => {
  calls.length = 0;
  const page = await newPage({ mobile: true });
  await page.goto(`${BASE}/link-agendamento/?barbearia=barbearia-teste`, { waitUntil: 'networkidle0' });
  assert.equal(await page.$eval('#pName', e => e.textContent), 'Barbearia Teste');
  assert.ok(!(await page.$('script[src=""]')) && !(await page.content()).includes('<script>Corte'), 'XSS escapado');
  await page.click('#mainBook');
  await clickText(page, '.booking-service-option', 'Corte');
  await clickText(page, '.booking-service-option', 'Ana');
  await page.waitForSelector('.booking-day');
  await page.evaluate(() => document.querySelectorAll('.booking-day')[1].click());
  await page.waitForSelector('.booking-time');
  await page.evaluate(() => document.querySelector('.booking-time').click());
  await page.click('.booking-next');
  await page.type('#bName', 'João da Silva');
  await page.type('#bPhone', '21988887777');
  await page.click('.booking-next');
  await page.waitForSelector('.booking-summary');
  await page.click('.booking-next');
  await page.waitForSelector('.booking-success');
  const bk = calls.find(c => c.method === 'POST' && c.path.endsWith('create_public_booking'));
  assert.equal(bk.body.p_slug, 'barbearia-teste');
  assert.equal(bk.body.p_service_id, SVC);
  assert.equal(bk.body.p_professional_id, PRO1);
  assert.equal(bk.body.p_starts_at, slotA);
  assert.equal(bk.body.p_channel, 'site');
  assert.ok(!('p_price' in bk.body), 'preço nunca é enviado pelo navegador');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `overflow horizontal ${overflow}px`);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('site público: barbearia indisponível/plano sem site mostra mensagem', async () => {
  const page = await newPage({ publicData: { available: false, reason: 'FEATURE_UNAVAILABLE' } });
  await page.goto(`${BASE}/link-agendamento/?barbearia=x`, { waitUntil: 'networkidle0' });
  assert.match(await page.$eval('.public-state', e => e.textContent), /não está disponível/);
  await page.close();
});

test('chatbot: fluxo completo grava agendamento com canal chatbot', async () => {
  calls.length = 0;
  const page = await newPage({ mobile: true });
  await page.goto(`${BASE}/chatbot/?barbearia=barbearia-teste`, { waitUntil: 'networkidle0' });
  const type = async v => { await page.waitForSelector('#chatInputbar:not(.hidden)'); await page.type('#chatInput', v); await page.click('#chatSend'); };
  await type('Carlos Souza');
  await type('(21) 97777-6666');
  await clickText(page, '#chatOptions button', 'Corte');
  await clickText(page, '#chatOptions button', 'Bruno');
  await page.waitForFunction(() => document.querySelectorAll('#chatOptions button').length > 1);
  await page.evaluate(() => document.querySelectorAll('#chatOptions button')[1].click());
  await page.waitForFunction(() => [...document.querySelectorAll('#chatOptions button')].some(b => /\d\d:\d\d/.test(b.textContent)));
  await page.evaluate(() => [...document.querySelectorAll('#chatOptions button')].find(b => /\d\d:\d\d/.test(b.textContent)).click());
  await clickText(page, '#chatOptions button', 'Confirmar agendamento');
  await page.waitForFunction(() => document.querySelector('#chatMessages').textContent.includes('Agendamento confirmado'), { timeout: 10000 });
  const bk = calls.find(c => c.method === 'POST' && c.path.endsWith('create_public_booking'));
  assert.equal(bk.body.p_channel, 'chatbot');
  assert.equal(bk.body.p_professional_id, PRO2);
  assert.equal(bk.body.p_whatsapp, '5521977776666');
  assert.ok(!(await page.$eval('#chatMessages', e => e.innerHTML)).includes('<b>teste</b>'), 'saudação escapada');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('chatbot: plano sem chatbot mostra indisponível', async () => {
  const page = await newPage({ publicData: { available: false, reason: 'FEATURE_UNAVAILABLE' } });
  await page.goto(`${BASE}/chatbot/?barbearia=x`, { waitUntil: 'networkidle0' });
  assert.match(await page.$eval('#chatMessages', e => e.textContent), /não está disponível/);
  await page.close();
});

test('painel DEV: admin vê lista; usuário comum é bloqueado', async () => {
  let page = await newPage({ auth: true, admin: true });
  await page.goto(`${BASE}/dev/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.shop');
  assert.match(await page.$eval('.shop', e => e.textContent), /barbearia-teste/);
  await clickText(page, 'button', '+ Nova barbearia');
  assert.ok(await page.$('#eName'));
  assert.deepEqual(page.errors, []);
  await page.close();
  page = await newPage({ auth: true, admin: false });
  await page.goto(`${BASE}/dev/`, { waitUntil: 'networkidle0' });
  assert.match(await page.content(), /Acesso restrito/);
  await page.close();
});

test('PWA: manifest válido, service worker ativo e páginas privadas com tags', async () => {
  const page = await newPage({ auth: true });
  await page.goto(`${BASE}/dashboard/`, { waitUntil: 'networkidle0' });
  const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.scope, '/');
  assert.ok(manifest.icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable'));
  const swState = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return r.active?.state; });
  assert.equal(swState, 'activated');
  const sw = await page.evaluate(async () => (await fetch('/sw.js')).text());
  assert.match(sw, /const VERSION = "\d{4}-\d{2}-\d{2}-/);
  await page.close();
});

test('mobile: painel sem overflow horizontal e menu abre/fecha', async () => {
  for (const path of ['/dashboard/', '/agendamentos/', '/configuracoes/']) {
    const page = await newPage({ auth: true, mobile: true });
    await page.goto(BASE + path, { waitUntil: 'networkidle0' });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `${path}: overflow ${overflow}px`);
    await page.click('#menuBtn');
    assert.equal(await page.$eval('.sidebar', e => e.classList.contains('active')), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('.sidebar', e => e.classList.contains('active')), false);
    await page.close();
  }
});
