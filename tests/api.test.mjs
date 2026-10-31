// API/RLS tests as the anonymous (public) role. Read-only by default.
//   node tests/api.test.mjs            → read-only checks
//   node tests/api.test.mjs --write    → also runs the concurrent-booking test
//                                        (creates ONE appointment in the demo shop; cancel it afterwards)
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, TEST_SLUG (default barbearia-vision)
const URL_ = process.env.SUPABASE_URL || "https://idtvkslyyexwbqcgrozh.supabase.co";
const KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_egcj7b6mw6w9Q-7obapuMw_yCWxizD1";
const SLUG = process.env.TEST_SLUG || "barbearia-vision";
const WRITE = process.argv.includes("--write");
const H = { apikey: KEY, "Content-Type": "application/json" };
const results = [];
const check = (name, pass, info = "") => { results.push(pass); console.log(`${pass ? "PASS" : "FAIL"} ${name}${info ? " — " + info : ""}`); };
const rest = (path, init = {}) => fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...H, ...init.headers } }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
const rpc = (fn, args) => rest(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
const spDay = (offset) => { const d = new Date(Date.now() + offset * 864e5); return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d); };
const weekday = (key) => new Date(key + "T12:00:00-03:00").getUTCDay();
const spTime = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

const { body: shops } = await rest(`barbershops?select=id,status,plan&slug=eq.${SLUG}`);
const shop = shops?.[0];
check("demo shop readable publicly", !!shop, shop ? `${shop.status}/${shop.plan}` : "not found");
if (!shop) process.exit(1);
const { body: services } = await rest(`services?select=id,name,duration_minutes&barbershop_id=eq.${shop.id}&active=eq.true&order=duration_minutes`);
const { body: hours } = await rest(`business_hours?select=weekday,is_open,opens_at,closes_at&barbershop_id=eq.${shop.id}`);
const short = services[0], long = services.at(-1);
const openDay = [...Array(14).keys()].map(i => spDay(i + 1)).find(k => hours.find(h => h.weekday === weekday(k))?.is_open);
const closedDay = [...Array(14).keys()].map(i => spDay(i + 1)).find(k => !hours.find(h => h.weekday === weekday(k))?.is_open);
const hoursOf = (k) => hours.find(h => h.weekday === weekday(k));

// Availability
const slots = (service, day) => rpc("available_booking_slots", { p_slug: SLUG, p_service_id: service.id, p_day: day });
const a = await slots(short, openDay);
check("slots on open day", a.status === 200 && a.body.length > 0, `${a.body?.length} slots on ${openDay}`);
const h = hoursOf(openDay);
check("first slot = opening time (America/Sao_Paulo)", spTime(a.body[0].slot_start) === h.opens_at.slice(0, 5), spTime(a.body[0].slot_start));
const lastEnd = new Date(new Date(a.body.at(-1).slot_start).getTime() + short.duration_minutes * 6e4);
check("last slot ends by closing time", spTime(lastEnd.toISOString()) <= h.closes_at.slice(0, 5), spTime(lastEnd.toISOString()));
const b = await slots(long, openDay);
check("longer service → fewer/equal slots", b.body.length <= a.body.length, `${long.duration_minutes}min: ${b.body.length} vs ${short.duration_minutes}min: ${a.body.length}`);
if (closedDay) { const c = await slots(short, closedDay); check("closed day → no slots", c.body.length === 0, closedDay); }
check("past day → no slots", (await slots(short, spDay(-3))).body.length === 0);
const today = (await slots(short, spDay(0))).body;
check("today → no past slots", today.every(s => new Date(s.slot_start) > new Date()), `${today.length} slots`);
check("unknown slug → no slots", (await rpc("available_booking_slots", { p_slug: "nao-existe-xyz", p_service_id: short.id, p_day: openDay })).body?.length === 0);

// Booking validation (all must be rejected; nothing is created)
const book = (startsAt, name = "TESTE AUTOMATIZADO", phone = "21999990000", service = short) =>
  rpc("create_public_booking", { p_slug: SLUG, p_service_id: service.id, p_client_name: name, p_client_whatsapp: phone, p_starts_at: startsAt });
const at = (day, hm) => new Date(`${day}T${hm}:00-03:00`).toISOString();
check("reject past time", (await book(at(spDay(-2), "10:00"))).status >= 400);
if (closedDay) check("reject closed day", (await book(at(closedDay, "10:00"))).status >= 400);
check("reject before opening", (await book(at(openDay, "06:00"))).status >= 400);
check("reject after closing", (await book(at(openDay, "23:00"))).status >= 400);
check("reject invalid phone", (await book(a.body[0].slot_start, "TESTE", "12")).status >= 400);
check("reject empty name", (await book(a.body[0].slot_start, "")).status >= 400);

// RLS as anon
const read = async (t) => (await rest(`${t}?select=*&limit=5`)).body;
check("anon cannot read appointments", Array.isArray(await read("appointments")) && (await read("appointments")).length === 0);
check("anon cannot read clients", (await read("clients")).length === 0);
check("anon cannot read profiles", (await read("profiles")).length === 0);
check("anon cannot read members", (await read("barbershop_members")).length === 0);
check("anon cannot read push_subscriptions", (await read("push_subscriptions")).length === 0);
const upd = await rest(`barbershops?id=eq.${shop.id}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ plan: "site" }) });
check("anon cannot change plan", Array.isArray(upd.body) ? upd.body.length === 0 : upd.status >= 400);
for (const [t, row] of [["barbershops", { name: "x", slug: "x-anon-test" }], ["services", { barbershop_id: shop.id, name: "x", price: 1, duration_minutes: 30 }], ["appointments", { barbershop_id: shop.id, client_name: "x" }]]) {
  const r = await rest(t, { method: "POST", body: JSON.stringify(row) });
  check(`anon cannot insert ${t}`, r.status >= 400, String(r.status));
}
const fn = await fetch(`${URL_}/functions/v1/create-barbershop-owner`, { method: "POST", headers: H, body: "{}" });
check("create-barbershop-owner requires login", fn.status >= 400, String(fn.status));
const signup = await fetch(`${URL_}/auth/v1/signup`, { method: "POST", headers: H, body: JSON.stringify({ email: "x", password: "x" }) }).then(r => r.json());
check("public signup disabled", /signup.*(disabled|not allowed)/i.test(JSON.stringify(signup)), signup.msg || signup.error_code);

// Concurrency (writes one appointment)
if (WRITE) {
  const day = [...Array(30).keys()].map(i => spDay(i + 20)).find(k => hoursOf(k)?.is_open);
  const free = (await slots(short, day)).body;
  const target = free[Math.floor(free.length / 2)].slot_start;
  const tries = await Promise.all([1, 2, 3, 4].map(i => book(target, `TESTE CONCORRENCIA ${i} (pode cancelar)`, `2199999100${i}`)));
  const okCount = tries.filter(r => r.status === 200).length;
  check("simultaneous bookings: exactly one wins", okCount === 1, `${okCount} succeeded at ${day} ${spTime(target)}`);
  const after = (await slots(short, day)).body;
  check("slot disappears after booking", !after.some(s => s.slot_start === target) && after.length === free.length - 1);
}
const failed = results.filter(x => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
