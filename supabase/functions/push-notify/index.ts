// push-notify: Web Push for new bookings.
// Actions:
//  - public_key  (anyone)               → returns the VAPID public key
//  - test        (logged-in owner)      → sends a test push to the caller's own devices
//  - new_booking (database trigger only, header x-push-secret) → notifies every member of the shop
// Secrets (supabase secrets set ...): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_WEBHOOK_SECRET.
// Deploy with: supabase functions deploy push-notify --no-verify-jwt  (auth is checked below per action)
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const env = (k: string) => Deno.env.get(k) ?? "";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

function timingSafeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type Sub = { id: string; endpoint: string; p256dh: string; auth: string };

async function sendAll(subs: Sub[], payload: Record<string, unknown>) {
  webpush.setVapidDetails(env("VAPID_SUBJECT") || "mailto:visionariodev@gmail.com", env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));
  let sent = 0;
  const expired: string[] = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600, urgency: "high" });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) expired.push(s.id); // subscription no longer valid
      else console.error("push failed", code, (e as Error).message);
    }
  }));
  if (expired.length) await admin.from("push_subscriptions").delete().in("id", expired);
  if (sent) await admin.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).in("id", subs.filter((s) => !expired.includes(s.id)).map((s) => s.id));
  return { sent, expired: expired.length };
}

const fmt = (iso: string) => {
  const d = new Date(iso);
  const day = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
  const time = d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
  return { day, time, key };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }

  if (body.action === "public_key") {
    const key = env("VAPID_PUBLIC_KEY");
    return key ? json({ publicKey: key }) : json({ error: "VAPID não configurado" }, 503);
  }

  if (body.action === "new_booking") {
    if (!timingSafeEqual(req.headers.get("x-push-secret") ?? "", env("PUSH_WEBHOOK_SECRET"))) return json({ error: "Não autorizado" }, 401);
    const id = String(body.appointment_id ?? "");
    const { data: appt, error } = await admin.from("appointments")
      .select("id, barbershop_id, client_name, starts_at, services(name)").eq("id", id).maybeSingle();
    if (error || !appt) return json({ error: "Agendamento não encontrado" }, 404);
    const { data: members } = await admin.from("barbershop_members").select("user_id").eq("barbershop_id", appt.barbershop_id);
    const userIds = (members ?? []).map((m) => m.user_id);
    if (!userIds.length) return json({ sent: 0 });
    const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth")
      .eq("barbershop_id", appt.barbershop_id).in("user_id", userIds);
    const when = fmt(appt.starts_at);
    // deno-lint-ignore no-explicit-any
    const service = (appt as any).services?.name ?? "Serviço";
    const result = await sendAll(subs ?? [], {
      title: "Novo agendamento",
      body: `${appt.client_name} • ${service} • ${when.day} às ${when.time}`,
      url: `/agendamentos/?dia=${when.key}`,
      tag: `booking-${appt.id}`,
    });
    return json(result);
  }

  if (body.action === "test") {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "Login obrigatório" }, 401);
    const shopId = String(body.barbershop_id ?? "");
    const { data: member } = await admin.from("barbershop_members").select("user_id").eq("barbershop_id", shopId).eq("user_id", user.id).maybeSingle();
    if (!member) return json({ error: "Sem acesso a esta barbearia" }, 403);
    const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", user.id).eq("barbershop_id", shopId);
    if (!subs?.length) return json({ error: "Nenhum dispositivo inscrito" }, 404);
    return json(await sendAll(subs, { title: "BarberSaaS", body: "Notificações funcionando! Você será avisado a cada novo agendamento.", url: "/agendamentos/", tag: "test" }));
  }

  return json({ error: "Ação inválida" }, 400);
});
