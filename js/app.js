// Bootstrap das páginas privadas do painel.
// Responsável por: sessão, guarda de rota, contexto da barbearia (tenant), modo suporte
// do DEV, barbearia suspensa, menu único, logout, last_seen, PWA e Realtime.
import { supabase } from "/supabase-client.js";
import { esc, toast, errorMessage } from "/js/ui.js";
import { registerServiceWorker } from "/js/pwa.js";
import { cleanupPushOnLogout, refreshPushRegistration } from "/js/push.js";

export { supabase };

const SHOP_KEY = "barbersaas.shop";
const SUPPORT_KEY = "barbersaas.supportShop";

const ICONS = {
  dashboard: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/><path d="M9.5 20v-6h5v6"/>',
  agenda: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  clientes: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  profissionais: '<circle cx="12" cy="7" r="4"/><path d="M5 21v-1a7 7 0 0 1 14 0v1"/><path d="m15.5 13.5 2 2 3.5-3.5"/>',
  servicos: '<circle cx="6" cy="7" r="3"/><circle cx="6" cy="17" r="3"/><path d="m8.6 8.5 11.4 6.5M8.6 15.5 20 9M8.5 8.5 4 4"/>',
  horarios: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  financeiro: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M7 10h10M7 16h5"/><circle cx="17" cy="15" r="1"/>',
  chatbot: '<path d="M21 12a8 8 0 0 1-8 8H7l-4 2 1.5-4A8 8 0 1 1 21 12Z"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>',
  site: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
  config: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  dev: '<path d="m8 9-4 3 4 3M16 9l4 3-4 3M13.5 6l-3 12"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
};
const NAV = [
  { key: "dashboard", href: "/dashboard/", label: "Dashboard" },
  { key: "agenda", href: "/agendamentos/", label: "Agenda" },
  { key: "clientes", href: "/clientes/", label: "Clientes" },
  { key: "profissionais", href: "/profissionais/", label: "Profissionais" },
  { key: "servicos", href: "/servicos/", label: "Serviços" },
  { key: "horarios", href: "/horarios/", label: "Horários" },
  { key: "financeiro", href: "/lucros/", label: "Financeiro" },
  { key: "chatbot", href: "/chatbot-config/", label: "Chatbot", feature: "chatbot" },
  { key: "site", href: "/editar-link/", label: "Meu site", feature: "site" },
  { key: "config", href: "/configuracoes/", label: "Configurações" },
];
const icon = k => `<span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${ICONS[k]}</svg></span>`;

export function loginUrl() {
  return "/login/?next=" + encodeURIComponent(location.pathname + location.search + location.hash);
}

export async function logout() {
  await cleanupPushOnLogout();
  sessionStorage.removeItem(SUPPORT_KEY);
  await supabase.auth.signOut({ scope: "local" }).catch(() => {});
  location.replace("/login/");
}

function renderNav(active, shop, isAdmin) {
  const nav = document.querySelector(".sidebar .menu");
  if (!nav) return;
  nav.setAttribute("aria-label", "Menu principal");
  nav.innerHTML = NAV.map(n => {
    const locked = n.feature && !shop?.features?.[n.feature];
    return `<a href="${n.href}" class="${n.key === active ? "active" : ""}${locked ? " locked" : ""}" ${n.key === active ? 'aria-current="page"' : ""}>${icon(n.key)}${n.label}${locked ? '<span class="nav-lock" title="Não incluso no plano">🔒</span>' : ""}</a>`;
  }).join("") +
    (isAdmin ? `<a href="/dev/" class="nav-dev">${icon("dev")}Painel DEV</a>` : "") +
    `<button type="button" class="nav-logout" id="navLogout">${icon("logout")}Sair</button>`;
  document.getElementById("navLogout").onclick = logout;
  const logo = document.querySelector(".sidebar .logo");
  if (logo && shop && !logo.querySelector(".shop-name")) {
    logo.insertAdjacentHTML("beforeend", `<small class="shop-name" title="${esc(shop.name)}">${esc(shop.name)}</small>`);
  }
  const btn = document.getElementById("menuBtn");
  if (btn) { btn.setAttribute("aria-label", "Abrir menu"); btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-controls", "sidebar"); }
  document.querySelector(".sidebar")?.setAttribute("id", "sidebar");
}

function fullScreenMessage(title, message, actions = "") {
  document.body.innerHTML = `<main class="ui-fullscreen"><div class="ui-fullscreen-card"><h1>Barber<span>SaaS</span></h1><h2>${esc(title)}</h2><p>${esc(message)}</p><div class="ui-actions">${actions}<button type="button" class="ui-btn" id="fsLogout">Sair</button></div></div></main>`;
  document.getElementById("fsLogout").onclick = logout;
}

function supportBanner(shop) {
  const bar = document.createElement("div");
  bar.className = "support-banner";
  bar.setAttribute("role", "status");
  bar.innerHTML = `<span>Modo suporte: <b>${esc(shop.name)}</b></span><button type="button" id="leaveSupport">Sair do modo suporte</button>`;
  document.body.prepend(bar);
  document.body.classList.add("has-support-banner");
  document.getElementById("leaveSupport").onclick = () => { sessionStorage.removeItem(SUPPORT_KEY); location.href = "/dev/"; };
}

export function lockedFeature(container, feature) {
  const label = feature === "chatbot" ? "Chatbot" : "Site e agendamento público";
  container.innerHTML = `<section class="ui-locked"><div>🔒</div><h2>${label} não incluso no seu plano</h2>
    <p>Seu plano atual não inclui este recurso. Fale com a Visionário Dev para fazer upgrade para o plano ${feature === "chatbot" ? "Chatbot ou Completo" : "Site ou Completo"}.</p>
    <a class="ui-btn primary" href="https://visionariodev.com.br" target="_blank" rel="noopener">Falar com a Visionário Dev</a></section>`;
}

let authListenerSet = false;
function watchAuth() {
  if (authListenerSet) return;
  authListenerSet = true;
  supabase.auth.onAuthStateChange((event, session) => {
    // SIGNED_OUT ocorre em logout explícito, revogação ou refresh token inválido.
    if (event === "SIGNED_OUT" || (event === "TOKEN_REFRESHED" && !session)) {
      location.replace(loginUrl());
    }
  });
}

/**
 * Inicializa uma página privada.
 * @returns {Promise<{user, shop, isAdmin, tz, supabase}|null>}
 */
export async function initPanel({ active, feature } = {}) {
  registerServiceWorker();
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) { location.replace(loginUrl()); return null; }
  watchAuth();

  let ctx;
  try {
    const { data, error: e } = await supabase.rpc("my_context");
    if (e) throw e;
    ctx = data;
  } catch (e) {
    if (/JWT|AUTH_REQUIRED|401|refresh/i.test(String(e?.message || e?.code))) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      location.replace(loginUrl());
      return null;
    }
    fullScreenMessage("Não foi possível carregar", errorMessage(e), `<button type="button" class="ui-btn primary" onclick="location.reload()">Tentar novamente</button>`);
    return null;
  }

  const isAdmin = !!ctx.is_platform_admin;
  let shopId = null;
  const support = isAdmin ? sessionStorage.getItem(SUPPORT_KEY) : null;
  if (support) shopId = support;
  else {
    const saved = localStorage.getItem(SHOP_KEY);
    shopId = ctx.shops.find(s => s.id === saved)?.id || ctx.shops[0]?.id || null;
  }
  if (!shopId) {
    if (isAdmin) { location.replace("/dev/"); return null; }
    fullScreenMessage("Conta sem barbearia vinculada", "Sua conta ainda não foi vinculada a uma barbearia. Fale com a Visionário Dev para concluir a ativação.");
    return null;
  }

  const { data: shop, error: shopErr } = await supabase.rpc("shop_context", { p_shop_id: shopId });
  if (shopErr || !shop) {
    sessionStorage.removeItem(SUPPORT_KEY); localStorage.removeItem(SHOP_KEY);
    fullScreenMessage("Barbearia indisponível", errorMessage(shopErr), `<button type="button" class="ui-btn primary" onclick="location.reload()">Tentar novamente</button>`);
    return null;
  }
  if (!support) localStorage.setItem(SHOP_KEY, shop.id);
  if (!isAdmin && (shop.status === "suspended" || shop.status === "cancelled")) {
    fullScreenMessage(shop.status === "suspended" ? "Acesso suspenso" : "Assinatura cancelada",
      "O acesso ao painel desta barbearia está temporariamente indisponível. Fale com a Visionário Dev para regularizar.",
      `<a class="ui-btn primary" href="https://visionariodev.com.br" target="_blank" rel="noopener">Falar com o suporte</a>`);
    return null;
  }

  renderNav(active, shop, isAdmin);
  if (shop.support_mode) supportBanner(shop);
  if (shop.status === "demo") document.body.classList.add("is-demo");

  // last_seen (no máximo a cada 5 min por aba)
  const last = +sessionStorage.getItem("barbersaas.seen") || 0;
  if (Date.now() - last > 5 * 60 * 1000) {
    sessionStorage.setItem("barbersaas.seen", String(Date.now()));
    supabase.rpc("touch_last_seen").then(() => {}, () => {});
  }
  if (!shop.support_mode) refreshPushRegistration(shop.id);

  const result = { user: session.user, shop, isAdmin, tz: shop.timezone || "America/Sao_Paulo", supabase };
  if (feature && !shop.features?.[feature]) {
    const main = document.querySelector("main.content .container") || document.querySelector("main.content");
    if (main) lockedFeature(main, feature);
    result.locked = true;
  }
  return result;
}

/**
 * Realtime de agendamentos da barbearia (um canal por página, removido ao sair).
 * onChange é chamado com debounce para evitar recargas em rajada.
 */
export function watchAppointments(shopId, onChange, { debounceMs = 600 } = {}) {
  let timer;
  const channel = supabase.channel(`appointments-${shopId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "appointments", filter: `barbershop_id=eq.${shopId}` }, payload => {
      clearTimeout(timer);
      timer = setTimeout(() => onChange(payload), debounceMs);
    })
    .subscribe();
  const stop = () => { clearTimeout(timer); supabase.removeChannel(channel); };
  window.addEventListener("pagehide", stop, { once: true });
  // ao voltar do background, recarrega (eventos podem ter sido perdidos com o app suspenso)
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") onChange({ type: "resume" }); });
  return stop;
}

export function notifyError(e, fallback) {
  console.error("[barbersaas]", e);
  toast(errorMessage(e, fallback), "error", 4500);
}
