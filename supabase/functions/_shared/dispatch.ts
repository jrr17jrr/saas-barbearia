// Envio de Web Push a partir da notification_outbox.
import webpush from 'npm:web-push@3.6.7';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.95.0';
import { log } from './common.ts';

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:visionariodev@gmail.com';

export const vapidConfigured = () => Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
export const vapidPublicKey = () => VAPID_PUBLIC_KEY;

let configured = false;
function ensureVapid() {
  if (!configured) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    configured = true;
  }
}

type Outbox = {
  id: number; kind: string; title: string; body: string; url: string; appointment_id: string | null; barbershop_id: string;
};
export type DeliveryResult = { subscription_id: string; ok: boolean; gone: boolean; status?: number; error?: string };

export async function deliver(admin: SupabaseClient, o: Outbox): Promise<{ sent: number; results: DeliveryResult[] }> {
  ensureVapid();
  const { data: targets, error } = await admin.rpc('dispatch_targets', { p_outbox_id: o.id });
  if (error) throw new Error(`dispatch_targets: ${error.message}`);
  const payload = JSON.stringify({
    title: o.title, body: o.body, url: o.url, kind: o.kind,
    tag: o.appointment_id ? `appt-${o.appointment_id}-${o.kind}` : `barbersaas-${o.id}`,
    appointment_id: o.appointment_id,
  });
  const results: DeliveryResult[] = await Promise.all((targets ?? []).map(async (t: any) => {
    try {
      const res = await webpush.sendNotification(
        { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
        payload,
        { TTL: o.kind === 'reminder' ? 1800 : 86400, urgency: 'high' },
      );
      return { subscription_id: t.subscription_id, ok: true, gone: false, status: res.statusCode };
    } catch (e: any) {
      const status = e?.statusCode as number | undefined;
      // 404/410 = subscription expirada/revogada → remover
      const gone = status === 404 || status === 410;
      return { subscription_id: t.subscription_id, ok: false, gone, status, error: String(e?.body || e?.message || e).slice(0, 300) };
    }
  }));
  // Registra cada dispositivo: entregues ficam em notification_deliveries e NUNCA
  // recebem o mesmo evento de novo; 404/410 removem a inscrição.
  await Promise.all(results.map(r => admin.rpc('dispatch_record_delivery', {
    p_outbox_id: o.id, p_subscription_id: r.subscription_id, p_ok: r.ok, p_gone: r.gone, p_error: r.error ?? null,
  })));
  const sent = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok && !r.gone);
  // Falha temporária (5xx, 429, rede) em algum dispositivo → retry com backoff só para os que faltam.
  const status = failed.length ? 'retry' : (targets ?? []).length === 0 ? 'skipped' : sent > 0 ? 'sent' : 'skipped';
  const { data: finalStatus } = await admin.rpc('dispatch_complete', {
    p_outbox_id: o.id, p_status: status, p_sent: sent, p_error: failed[0] ? `HTTP ${failed[0].status ?? '-'}: ${failed[0].error}` : null,
  });
  log('push.outbox', {
    outbox: o.id, kind: o.kind, shop: o.barbershop_id, targets: (targets ?? []).length, sent,
    gone: results.filter(r => r.gone).length, failed: failed.length, status: finalStatus ?? status,
  });
  return { sent, results };
}
