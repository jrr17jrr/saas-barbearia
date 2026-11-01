// push-dispatch: processa a fila de notificações (acionada por pg_net e pelo Cron).
// Autenticação: header x-dispatch-secret validado contra o segredo guardado no Vault.
import { json, log, serviceClient } from '../_shared/common.ts';
import { deliver, vapidConfigured } from '../_shared/dispatch.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return json(req, { ok: true });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);

  const admin = serviceClient();
  const secret = req.headers.get('x-dispatch-secret') ?? '';
  const { data: valid, error: vErr } = await admin.rpc('dispatch_verify_secret', { p_secret: secret });
  if (vErr || valid !== true) {
    log('push.dispatch.unauthorized', { reason: vErr?.message ?? 'invalid_secret' });
    return json(req, { error: 'unauthorized' }, 401);
  }
  if (!vapidConfigured()) {
    log('push.dispatch.not_configured');
    return json(req, { error: 'vapid_not_configured' }, 503);
  }

  let processed = 0, sent = 0;
  for (let round = 0; round < 5; round++) {
    const { data: batch, error } = await admin.rpc('dispatch_claim', { p_limit: 50 });
    if (error) {
      log('push.dispatch.claim_error', { error: error.message });
      return json(req, { error: 'claim_failed' }, 500);
    }
    if (!batch?.length) break;
    for (const o of batch) {
      try {
        const r = await deliver(admin, o);
        processed++; sent += r.sent;
      } catch (e) {
        log('push.dispatch.deliver_error', { outbox: o.id, error: String(e) });
        await admin.rpc('dispatch_complete', { p_outbox_id: o.id, p_status: 'pending', p_sent: 0, p_error: String(e) });
      }
    }
  }
  return json(req, { ok: true, processed, sent });
});
