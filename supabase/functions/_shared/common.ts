// Utilitários compartilhados das Edge Functions do BarberSaaS.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.95.0';

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ??
  'https://saas-barbearia-swart.vercel.app,http://localhost:4173,http://127.0.0.1:4173').split(',').map(s => s.trim());

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowed = ALLOWED_ORIGINS.includes(origin) || /^https:\/\/saas-barbearia-[a-z0-9-]+\.vercel\.app$/.test(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-dispatch-secret',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Cliente que age COMO o usuário (RLS aplicada) + validação do JWT no servidor de Auth.
export async function userFromRequest(req: Request): Promise<{ client: SupabaseClient; userId: string } | null> {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const client = createClient(SUPABASE_URL, ANON_KEY || SERVICE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return { client, userId: data.user.id };
}

export function log(event: string, data: Record<string, unknown> = {}) {
  // Logs estruturados (visíveis em Edge Functions → Logs). Nunca registrar chaves/segredos.
  console.log(JSON.stringify({ event, ...data, at: new Date().toISOString() }));
}
