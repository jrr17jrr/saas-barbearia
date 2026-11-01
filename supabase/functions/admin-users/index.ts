// admin-users: operações que exigem a Admin API do Auth (somente administrador DEV).
//   POST { action: 'invite_owner', shop_id }   → convida o e-mail do proprietário cadastrado na barbearia
//   POST { action: 'send_reset', email }       → envia e-mail de redefinição de senha
// O vínculo usuário ↔ barbearia é criado pelo banco quando o e-mail for confirmado.
import { json, log, serviceClient, userFromRequest } from '../_shared/common.ts';

const APP_URL = Deno.env.get('APP_URL') ?? 'https://saas-barbearia-swart.vercel.app';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return json(req, { ok: true });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);
  const user = await userFromRequest(req);
  if (!user) return json(req, { error: 'unauthorized' }, 401);
  const { data: isAdmin } = await user.client.rpc('is_platform_admin');
  if (isAdmin !== true) return json(req, { error: 'forbidden' }, 403);

  let body: any = {};
  try { body = await req.json(); } catch { /* vazio */ }
  const admin = serviceClient();

  if (body.action === 'invite_owner') {
    const { data: shop, error } = await admin.from('barbershops').select('id, name, owner_email, owner_user_id').eq('id', body.shop_id).maybeSingle();
    if (error || !shop) return json(req, { error: 'not_found' }, 404);
    if (!shop.owner_email) return json(req, { error: 'owner_email_missing' }, 400);
    const redirectTo = `${APP_URL}/redefinir-senha/`;
    const { error: invErr } = await admin.auth.admin.inviteUserByEmail(shop.owner_email, {
      redirectTo, data: { full_name: null, invited_for: shop.name },
    });
    if (invErr) {
      // Usuário já existe: envia link de definição de senha em vez de convite
      if (/already|registered|exists/i.test(invErr.message)) {
        const { error: rErr } = await admin.auth.resetPasswordForEmail(shop.owner_email, { redirectTo });
        log('admin.invite_owner.existing', { shop: shop.id, by: user.userId, error: rErr?.message });
        if (rErr) return json(req, { error: 'reset_failed' }, 500);
        return json(req, { ok: true, mode: 'reset' });
      }
      log('admin.invite_owner.error', { shop: shop.id, error: invErr.message });
      return json(req, { error: 'invite_failed', detail: invErr.message }, 500);
    }
    await admin.from('audit_log').insert({ actor_id: user.userId, barbershop_id: shop.id, action: 'owner.invite', details: { email: shop.owner_email } });
    log('admin.invite_owner.ok', { shop: shop.id, by: user.userId });
    return json(req, { ok: true, mode: 'invite' });
  }

  if (body.action === 'send_reset' && typeof body.email === 'string') {
    const { error } = await admin.auth.resetPasswordForEmail(body.email.trim().toLowerCase(), { redirectTo: `${APP_URL}/redefinir-senha/` });
    if (error) return json(req, { error: 'reset_failed' }, 500);
    return json(req, { ok: true });
  }
  return json(req, { error: 'bad_request' }, 400);
});
