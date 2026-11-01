// Cliente Supabase único do BarberSaaS.
// A chave publishable é pública por definição (protegida por RLS). NUNCA colocar service_role/secret aqui.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.95.0/+esm";

export const SUPABASE_URL = "https://idtvkslyyexwbqcgrozh.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_egcj7b6mw6w9Q-7obapuMw_yCWxizD1";

// Sessão persistente e segura:
//  - persistSession: sessão fica no localStorage (sobrevive a fechar o app/PWA)
//  - autoRefreshToken: o SDK renova o access token antes de expirar e ao voltar do background
//  - detectSessionInUrl: necessário para links de convite/recuperação de senha
//  - storageKey padrão mantido para não deslogar quem já está logado
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "implicit",
  },
  realtime: { params: { eventsPerSecond: 5 } },
});

export async function session() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export const brl = v => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
