// API pública (sem login) usada pelo site e pelo chatbot. Toda validação real acontece no banco.
import { supabase } from "/supabase-client.js";
import { dateKey, addDays, weekday, isLightColor, THEMES } from "/js/ui.js";

export function slugFromUrl() {
  const p = new URLSearchParams(location.search);
  return (p.get("barbearia") || p.get("b") || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
}

export async function loadPublicShop(slug, channel = "site") {
  if (!slug) return { available: false, reason: "SHOP_NOT_FOUND" };
  const { data, error } = await supabase.rpc("get_public_shop", { p_slug: slug, p_channel: channel });
  if (error) throw error;
  return data;
}

export async function getSlots(slug, serviceId, date, professionalId, channel = "site") {
  const { data, error } = await supabase.rpc("get_available_slots", {
    p_slug: slug, p_service_id: serviceId, p_date: date, p_professional_id: professionalId || null, p_channel: channel,
  });
  if (error) throw error;
  return data;
}

export async function book({ slug, serviceId, startsAt, name, whatsapp, professionalId, channel = "site" }) {
  const { data, error } = await supabase.rpc("create_public_booking", {
    p_slug: slug, p_service_id: serviceId, p_starts_at: startsAt, p_name: name, p_whatsapp: whatsapp,
    p_professional_id: professionalId || null, p_channel: channel,
  });
  if (error) throw error;
  return data;
}

// Profissionais aptos a um serviço (sem lista = todos)
export function prosForService(data, serviceId) {
  return data.professionals.filter(p => !p.service_ids?.length || p.service_ids.includes(serviceId));
}

// Próximos dias em que a barbearia abre (o servidor ainda valida dias especiais/bloqueios)
export function upcomingDays(data, count = 14) {
  const tz = data.shop.timezone || "America/Sao_Paulo";
  const today = dateKey(new Date(), tz);
  const max = Math.min(count, data.shop.max_days_ahead || 30);
  const openDays = new Set(data.hours.filter(h => h.is_open).map(h => h.weekday));
  const out = [];
  for (let i = 0; i <= max && out.length < count; i++) {
    const k = addDays(today, i);
    if (openDays.size === 0 || openDays.has(weekday(k))) out.push({ key: k, today: i === 0, tomorrow: i === 1 });
  }
  return out;
}

export function themeColors(shop, chatbot) {
  if (chatbot && chatbot.sync_with_site === false && THEMES[chatbot.theme]) return THEMES[chatbot.theme];
  return { primary: shop.primary_color || THEMES.cyan.primary, background: shop.background_color || THEMES.cyan.background, card: shop.card_color || THEMES.cyan.card };
}

export function applySiteTheme(colors) {
  const r = document.documentElement.style, light = isLightColor(colors.background);
  r.setProperty("--site-primary", colors.primary);
  r.setProperty("--site-primary-text", isLightColor(colors.primary) ? "#111827" : "#ffffff");
  r.setProperty("--site-bg", colors.background);
  r.setProperty("--site-card", colors.card);
  r.setProperty("--site-text", light ? "#111827" : "#ffffff");
  r.setProperty("--site-muted", light ? "#64748b" : "#8190a5");
  r.setProperty("--site-surface", light ? "#f1f5f9" : "#0d1728");
  r.setProperty("--site-border", light ? "#dbe3ee" : "#223149");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", colors.background);
}

export const unavailableText = reason => ({
  SHOP_NOT_FOUND: "Barbearia não encontrada. Confira o link recebido.",
  SHOP_UNAVAILABLE: "Esta barbearia não está recebendo agendamentos online no momento.",
  FEATURE_UNAVAILABLE: "O agendamento online não está disponível para esta barbearia.",
}[reason] || "Página indisponível no momento.");
