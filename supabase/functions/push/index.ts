// push: usado pelo painel (usuário autenticado).
//   GET  → { publicKey }  chave VAPID pública (não é segredo)
//   POST { action: 'test', shop_id } → envia notificação de teste aos dispositivos do próprio usuário
import { json, log, serviceClient, userFromRequest } from '../_shared/common.ts';
import { deliver, vapidConfigured, vapidPublicKey } from '../_shared/dispatch.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return json(req, { ok: true });
  const user = await userFromRequest(req);
  if (!user) return json(req, { error: 'unauthorized' }, 401);

  if (req.method === 'GET') {
    if (!vapidConfigured()) return json(req, { error: 'vapid_not_configured' }, 503);
    return json(req, { publicKey: vapidPublicKey() });
  }
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { /* corpo vazio */ }
  if (body.action !== 'test' || typeof body.shop_id !== 'string') return json(req, { error: 'bad_request' }, 400);
  if (!vapidConfigured()) return json(req, { error: 'vapid_not_configured' }, 503);

  // Enfileira COMO o usuário (valida acesso à barbearia, dispositivo e limite)
  const { data: outboxId, error } = await user.client.rpc('enqueue_test_notification', { p_shop_id: body.shop_id });
  if (error) {
    const code = /NO_DEVICE|RATE_LIMIT|FORBIDDEN/.exec(error.message)?.[0] ?? 'enqueue_failed';
    return json(req, { error: code }, code === 'FORBIDDEN' ? 403 : 400);
  }
  const admin = serviceClient();
  const { data: claimed } = await admin.from('notification_outbox')
    .update({ status: 'processing', attempts: 1 }).eq('id', outboxId).eq('status', 'pending').select('*').maybeSingle();
  if (!claimed) return json(req, { ok: true, queued: true }); // já pego pelo dispatcher
  const r = await deliver(admin, claimed);
  log('push.test', { user: user.userId, shop: body.shop_id, sent: r.sent, devices: r.results.length });
  return json(req, {
    ok: r.sent > 0, sent: r.sent, devices: r.results.length,
    results: r.results.map(x => ({ ok: x.ok, gone: x.gone, status: x.status })),
  });
});
