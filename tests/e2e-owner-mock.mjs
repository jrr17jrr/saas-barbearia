// Owner/DEV panel smoke test with a mocked Supabase backend (no real data touched).
// Verifies pages render without JS errors, main buttons open their dialogs, and
// writes are sent with the expected payloads. Usage: node tests/e2e-owner-mock.mjs [screenshotDir]
import puppeteer from "puppeteer-core";
const BASE = process.env.BASE || "http://localhost:5173", out = process.argv[2] || null;
const REF = "idtvkslyyexwbqcgrozh";
const SHOP = "11111111-1111-4111-8111-111111111111", OTHER = "22222222-2222-4222-8222-222222222222";
const USER = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "dono@teste.local", aud: "authenticated", role: "authenticated" };
const spKey = (o = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() + o * 864e5));
const at = (o, hm) => new Date(`${spKey(o)}T${hm}:00-03:00`).toISOString();
const svc = [{ id: "s1", name: "Corte", description: "Clássico", price: 35, duration_minutes: 30, active: true, sort_order: 1 }, { id: "s2", name: "Barba", description: null, price: 25, duration_minutes: 30, active: false, sort_order: 2 }];
const appts = [
  { id: "a1", client_id: "c1", client_name: "Cliente Um", client_whatsapp: "21999990001", starts_at: at(0, "10:00"), ends_at: at(0, "10:30"), status: "confirmed", price: 35, service_id: "s1", services: { name: "Corte" }, created_at: at(-1, "10:00") },
  { id: "a2", client_id: "c2", client_name: "Cliente Dois", client_whatsapp: "21999990002", starts_at: at(0, "08:00"), ends_at: at(0, "08:30"), status: "completed", price: 35, service_id: "s1", services: { name: "Corte" }, created_at: at(-1, "10:00") },
  { id: "a3", client_id: "c1", client_name: "Cliente Um", client_whatsapp: "21999990001", starts_at: at(1, "11:00"), ends_at: at(1, "11:30"), status: "pending", price: 35, service_id: "s1", services: { name: "Corte" }, created_at: at(-1, "10:00") },
];
const db = (admin) => ({
  profiles: [{ id: USER.id, is_platform_admin: admin, full_name: "Dono Teste", email: USER.email }],
  barbershop_members: admin ? [] : [{ barbershop_id: SHOP, user_id: USER.id, role: "owner", created_at: at(-10, "10:00") }],
  barbershops: [{ id: SHOP, name: "Barbearia Mock", slug: "barbearia-mock", status: "active", plan: "complete", is_demo: false, theme: "cyan", primary_color: "#08a9df", background_color: "#0b1220", card_color: "#131e31", created_at: at(-10, "10:00"), public_status_text: "Aberto agora" }, { id: OTHER, name: "Outra Demo", slug: "outra-demo", status: "demo", plan: "site", is_demo: true, created_at: at(-20, "10:00") }],
  barbershop_settings: [{ barbershop_id: SHOP, chatbot_enabled: true, chatbot_name: "Bot", chatbot_greeting: "Oi", chatbot_sync_with_site: true, chatbot_theme: "cyan", site_enabled: true }],
  services: svc,
  appointments: appts,
  clients: [{ id: "c1", name: "Cliente Um", whatsapp: "21999990001", phone: null, created_at: at(-5, "10:00") }, { id: "c2", name: "Cliente Dois", whatsapp: "21999990002", phone: null, created_at: at(-5, "10:00") }],
  business_hours: [0, 1, 2, 3, 4, 5, 6].map(d => ({ id: "h" + d, weekday: d, is_open: d !== 0, opens_at: d ? "09:00:00" : null, closes_at: d ? "19:00:00" : null })),
  blocked_times: [{ id: "b1", starts_at: at(0, "12:00"), ends_at: at(0, "13:00"), reason: "Almoço" }],
  push_subscriptions: [],
});
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new" });
const results = [];
const ok = (name, pass, info = "") => { results.push(pass); console.log(`${pass ? "PASS" : "FAIL"} ${name}${info ? " — " + info : ""}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));
async function open(path, { admin = false, vp = { width: 1280, height: 900 } } = {}) {
  const p = await browser.newPage(); await p.setViewport(vp);
  const data = db(admin), writes = [], errors = [];
  p.on("pageerror", e => errors.push(e.message));
  p.on("console", m => { if (m.type() === "error" && !/WebSocket|realtime|favicon|Failed to load resource/i.test(m.text())) errors.push(m.text()); });
  p.on("dialog", d => d.accept());
  await p.setRequestInterception(true);
  p.on("request", req => {
    const url = new URL(req.url());
    if (!url.hostname.startsWith(REF)) return req.continue();
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*", "Access-Control-Expose-Headers": "Content-Range" };
    if (req.method() === "OPTIONS") return req.respond({ status: 204, headers: cors });
    const send = (body, status = 200, extra = {}) => req.respond({ status, headers: { ...cors, ...extra }, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/auth/v1/user") return send(USER);
    if (url.pathname.startsWith("/functions/v1/")) { writes.push({ fn: url.pathname, body: req.postData() }); return send({ publicKey: "BElmockkey", sent: 1 }); }
    if (url.pathname.startsWith("/rest/v1/rpc/available_booking_slots")) return send(["09:00", "09:30", "10:30"].map(t => ({ slot_start: at(1, t) })));
    if (url.pathname.startsWith("/rest/v1/rpc/")) { writes.push({ rpc: url.pathname, body: req.postData() }); return send("new-id"); }
    if (url.pathname.startsWith("/storage/")) { writes.push({ storage: url.pathname }); return send({ Key: "x" }); }
    const table = url.pathname.replace("/rest/v1/", "");
    if (req.method() !== "GET" && req.method() !== "HEAD") { writes.push({ table, method: req.method(), query: url.search, body: req.postData() }); return send(req.method() === "POST" ? [{ id: OTHER }] : [], req.method() === "DELETE" ? 200 : 201); }
    let rows = data[table] ?? [];
    for (const [k, v] of url.searchParams) { if (v.startsWith("eq.")) rows = rows.filter(r => r[k] === undefined || String(r[k]) === v.slice(3)); }
    if (req.method() === "HEAD") return req.respond({ status: 200, headers: { ...cors, "Content-Range": `0-0/${rows.length}` } });
    const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
    return send(single ? rows[0] ?? null : rows, single && !rows[0] ? 406 : 200);
  });
  await p.evaluateOnNewDocument((ref, user) => {
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({ access_token: "mock", refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user }));
  }, REF, USER);
  await p.goto(BASE + path, { waitUntil: "networkidle2", timeout: 30000 });
  await wait(800);
  return { p, writes, errors };
}
const text = (p, sel) => p.$eval(sel, e => e.textContent.trim()).catch(() => null);
const shot = async (p, name) => { if (out) await p.screenshot({ path: `${out}/${name}.png`, fullPage: true }); };

{ const { p, errors } = await open("/dashboard/");
  ok("dashboard: greeting", (await text(p, "#greeting"))?.includes("Barbearia Mock"));
  ok("dashboard: today count (excludes nothing cancelled)", (await text(p, "#kpiToday")) === "2", await text(p, "#kpiToday"));
  ok("dashboard: revenue = completed only", /35,00/.test(await text(p, "#kpiRevenue")), await text(p, "#kpiRevenue"));
  ok("dashboard: today rows", (await p.$$("#todayRows tr")).length === 2);
  ok("dashboard: plan menu (complete shows chatbot+site)", await p.$$eval(".menu a[hidden]", e => e.length) === 0);
  ok("dashboard: push link added", !!await p.$("#pushLink"));
  await shot(p, "owner-dashboard");
  ok("dashboard: no JS errors", !errors.length, errors.join(" ; ")); await p.close(); }

{ const { p, writes, errors } = await open("/agendamentos/");
  ok("agenda: day list (appointments + block)", (await p.$$("#timeline .slot")).length === 4, (await p.$$("#timeline .slot")).length + " linhas");
  const btn = (await p.$$("#timeline .slot-actions button"))[0]; await btn.click(); await wait(300);
  ok("agenda: manage modal", (await p.$$("#apptActions button")).length >= 3);
  const confirmBtn = (await p.$$("#apptActions button")).find(async b => true);
  const labels = await p.$$eval("#apptActions button", e => e.map(x => x.textContent));
  const idx = labels.indexOf("Cliente faltou"); (await p.$$("#apptActions button"))[idx].click(); await wait(600);
  const w = writes.find(x => x.table === "appointments" && x.method === "PATCH");
  ok("agenda: no-show sends PATCH status=no_show", w && JSON.parse(w.body).status === "no_show" && /barbershop_id=eq/.test(w.query), w?.body);
  await p.click("#weekView"); await wait(500);
  ok("agenda: week view 7 days", (await p.$$("#weekGrid .week-day")).length === 7);
  await shot(p, "owner-agenda-week");
  await p.click("#todayView"); await wait(400); await p.click("#newBtn"); await wait(600);
  ok("agenda: new booking shows free slots", (await p.$$("#slotGrid button")).length === 3);
  await p.type("#bookingForm [name=name]", "Novo Cliente"); await p.type("#bookingForm [name=phone]", "21988887777");
  await (await p.$$("#slotGrid button"))[1].click(); await p.click("#bookingSubmit"); await wait(600);
  const r = writes.find(x => x.rpc?.includes("create_public_booking"));
  ok("agenda: booking via create_public_booking", r && JSON.parse(r.body).p_slug === "barbearia-mock", r?.body);
  await p.click("#blockBtn"); await wait(300);
  await p.type("#blockForm [name=start]", "1400"); await p.type("#blockForm [name=end]", "1500"); await p.click("#blockForm [type=submit]"); await wait(500);
  const bw = writes.find(x => x.table === "blocked_times" && x.method === "POST");
  ok("agenda: block saved with -03:00", bw && JSON.parse(bw.body).starts_at.endsWith("T17:00:00.000Z"), bw?.body);
  ok("agenda: no JS errors", !errors.length, errors.join(" ; ")); await p.close(); }

{ const { p, writes, errors } = await open("/servicos/", { vp: { width: 390, height: 844, isMobile: true } });
  ok("serviços: list", (await p.$$("#services .service")).length === 2);
  await (await p.$$("#services .service button"))[1].click(); await wait(500);
  const w = writes.find(x => x.table === "services" && x.method === "PATCH");
  ok("serviços: deactivate sends active=false", w && JSON.parse(w.body).active === false, w?.body);
  await p.click("#add"); await wait(300);
  ok("serviços: modal form", !!await p.$("#serviceModal.open form.bs-form"));
  await shot(p, "owner-servicos-mobile");
  ok("serviços: no JS errors", !errors.length, errors.join(" ; ")); await p.close(); }

{ const { p, errors } = await open("/clientes/");
  ok("clientes: list", (await p.$$("#clientList .client-row")).length === 2);
  await p.type("#search", "99990002"); await wait(200);
  ok("clientes: search by phone", (await p.$$("#clientList .client-row")).length === 1);
  await p.click("#clientList .client-row button"); await wait(300);
  ok("clientes: history modal", (await p.$$("#pHistory > div")).length === 1);
  await shot(p, "owner-clientes");
  ok("clientes: no JS errors", !errors.length, errors.join(" ; ")); await p.close(); }

{ const { p, errors } = await open("/lucros/");
  const cards = await p.$$eval(".cards .card h2", e => e.map(x => x.textContent));
  ok("financeiro: today = completed only", /35,00/.test(cards[0]), cards.join(" | "));
  ok("financeiro: history 6 months", (await p.$$("#history .service-profit")).length === 6);
  await shot(p, "owner-financeiro");
  ok("financeiro: no JS errors", !errors.length, errors.join(" ; ")); await p.close(); }

{ const { p, writes, errors } = await open("/horarios/");
  ok("horários: 7 days", (await p.$$("#week .day-row")).length === 7);
  await p.click("#saveHours"); await wait(800);
  ok("horários: saves 7 rows", writes.filter(x => x.table === "business_hours").length === 7);
  ok("horários: no JS errors", !errors.length, errors.join(" ; ")); await p.close(); }

{ const { p, writes, errors } = await open("/editar-link/");
  ok("meu site: name loaded", (await p.$eval("#shopName", e => e.value)) === "Barbearia Mock");
  await p.click('.theme-option[data-theme="gold"]'); await p.click("#saveBtn"); await wait(500);
  const w = writes.find(x => x.table === "barbershops");
  ok("meu site: saves theme colors", w && JSON.parse(w.body).primary_color === "#d6a83b", w?.body?.slice(0, 120));
  ok("meu site: preview link has ?loja=", (await p.$eval("a.preview", e => e.getAttribute("href"))).includes("loja=barbearia-mock"));
  ok("meu site: no JS errors", !errors.length, errors.join(" ; ")); await p.close(); }

{ const { p, writes, errors } = await open("/chatbot-config/");
  ok("chatbot config: link has ?loja=", (await text(p, "#linkText"))?.includes("loja=barbearia-mock"));
  await p.click("#save"); await wait(500);
  ok("chatbot config: upsert settings", writes.some(x => x.table === "barbershop_settings"));
  ok("chatbot config: no JS errors", !errors.length, errors.join(" ; ")); await p.close(); }

{ const { p, writes, errors } = await open("/dev/", { admin: true });
  ok("dev: lists shops", (await p.$$("#shops .shop")).length === 2);
  ok("dev: stats", (await p.$$("#stats .stat")).length === 6);
  await p.click('button[data-act="edit"]'); await wait(300);
  await p.select("#shopForm [name=plan]", "site"); await p.click("#shopForm [type=submit]"); await wait(600);
  const w = writes.find(x => x.table === "barbershops" && x.method === "PATCH");
  ok("dev: plan change sent", w && JSON.parse(w.body).plan === "site", w?.body?.slice(0, 80));
  await p.click('button[data-act="owners"]'); await wait(600);
  await p.type("#ownerForm [name=name]", "Novo Dono"); await p.type("#ownerForm [name=email]", "novo@teste.local"); await p.click("#ownerForm [type=submit]"); await wait(600);
  const fn = writes.find(x => x.fn?.includes("create-barbershop-owner"));
  const body = fn && JSON.parse(fn.body);
  ok("dev: create owner with strong generated password", body && body.password.length >= 16 && body.barbershop_id === SHOP, body ? "len " + body.password.length : "");
  ok("dev: credentials shown once", !!await text(p, "#newPass"));
  await p.keyboard.press("Escape"); await wait(200);
  await p.click('button[data-act="suspend"]'); await wait(500);
  ok("dev: suspend sends status", writes.some(x => x.table === "barbershops" && x.body?.includes('"suspended"')));
  await shot(p, "dev-panel");
  ok("dev: no JS errors", !errors.length, errors.join(" ; ")); await p.close(); }

{ const { p } = await open("/dashboard/", { admin: true }); await wait(800);
  ok("admin without support shop → /dev/", p.url().includes("/dev/"), p.url()); await p.close(); }

await browser.close();
const failed = results.filter(x => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
