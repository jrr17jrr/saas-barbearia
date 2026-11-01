// Utilitários de interface compartilhados (sem dependências).

export const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const brl = v => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const DEFAULT_TZ = "America/Sao_Paulo";

// ------------------------------------------------------------------ datas no fuso da barbearia
export function dateKey(d = new Date(), tz = DEFAULT_TZ) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
}
export function fmtTime(d, tz = DEFAULT_TZ) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(d));
}
export function fmtDate(d, tz = DEFAULT_TZ, opts = { day: "2-digit", month: "2-digit" }) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: tz, ...opts }).format(new Date(d));
}
export function fmtDateLong(key) {
  const [y, m, d] = key.split("-").map(Number);
  const s = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export function addDays(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n, 12));
  return dt.toISOString().slice(0, 10);
}
export function weekday(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}
export const WEEKDAYS_SHORT = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];
export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

// Converte data+hora locais de um fuso em ISO UTC (correto mesmo com mudança de fuso).
export function zonedToISO(key, hhmm, tz = DEFAULT_TZ) {
  const [y, m, d] = key.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  let guess = Date.UTC(y, m - 1, d, h, mi);
  for (let i = 0; i < 2; i++) guess = Date.UTC(y, m - 1, d, h, mi) - tzOffsetMs(guess, tz);
  return new Date(guess).toISOString();
}
function tzOffsetMs(utcMs, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs;
}

// ------------------------------------------------------------------ telefone
export function phoneDigits(v) { return String(v || "").replace(/\D/g, ""); }
export function normalizePhone(v) {
  const d = phoneDigits(v);
  if (!d) return "";
  return d.length === 10 || d.length === 11 ? "55" + d : d;
}
export function isValidPhone(v) { const n = normalizePhone(v); return n.length >= 12 && n.length <= 13; }
export function fmtPhone(v) {
  let d = phoneDigits(v);
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return v || "";
}
export function maskPhoneInput(input) {
  input.addEventListener("input", () => {
    const d = phoneDigits(input.value).slice(0, 11);
    input.value = d.length > 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
      : d.length > 6 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
      : d.length > 2 ? `(${d.slice(0, 2)}) ${d.slice(2)}` : d;
  });
}
export const waLink = (phone, text = "") => `https://wa.me/${normalizePhone(phone)}${text ? "?text=" + encodeURIComponent(text) : ""}`;

// ------------------------------------------------------------------ mensagens de erro (sem detalhes sensíveis)
const ERRORS = {
  SLOT_UNAVAILABLE: "Esse horário acabou de ficar indisponível. Escolha outro horário.",
  SERVICE_NOT_FOUND: "Serviço indisponível.",
  PROFESSIONAL_NOT_FOUND: "Profissional indisponível.",
  SHOP_NOT_FOUND: "Barbearia não encontrada.",
  SHOP_UNAVAILABLE: "Esta barbearia não está recebendo agendamentos no momento.",
  FEATURE_UNAVAILABLE: "Este recurso não está disponível para esta barbearia.",
  INVALID_NAME: "Informe um nome válido.",
  INVALID_PHONE: "Informe um WhatsApp válido com DDD.",
  RATE_LIMIT: "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.",
  TOO_MANY_ACTIVE: "Você já possui agendamentos ativos suficientes nesta barbearia. Fale com a barbearia pelo WhatsApp.",
  INVALID_STATUS: "Este agendamento não permite essa ação.",
  NOT_FOUND: "Registro não encontrado.",
  FORBIDDEN: "Você não tem permissão para esta ação.",
  NO_DEVICE: "Ative as notificações neste aparelho primeiro.",
  SLUG_TAKEN: "Esse endereço (slug) já está em uso.",
  INVALID_RANGE: "Período inválido.",
};
export function errorMessage(err, fallback = "Não foi possível concluir. Verifique sua conexão e tente novamente.") {
  const msg = String(err?.message || err || "");
  for (const code of Object.keys(ERRORS)) if (msg.includes(code)) return ERRORS[code];
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return "Sem conexão com o servidor. Verifique a internet.";
  if (/foreign key|violates foreign/i.test(msg)) return "Este registro possui histórico vinculado e não pode ser excluído. Desative-o.";
  if (/duplicate key|unique/i.test(msg)) return "Já existe um registro com esses dados.";
  if (/JWT|token|session/i.test(msg)) return "Sua sessão expirou. Entre novamente.";
  return fallback;
}

// ------------------------------------------------------------------ toasts
let toastBox;
export function toast(message, type = "info", ms = 3200) {
  if (!toastBox) {
    toastBox = document.createElement("div");
    toastBox.className = "ui-toasts";
    toastBox.setAttribute("role", "status");
    toastBox.setAttribute("aria-live", "polite");
    document.body.appendChild(toastBox);
  }
  const t = document.createElement("div");
  t.className = `ui-toast ${type}`;
  t.textContent = message;
  toastBox.appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, ms);
}

// ------------------------------------------------------------------ modal acessível
let modalLayer, lastFocus;
export function openModal(html, { onClose, labelledBy = "uiModalTitle", wide = false } = {}) {
  closeModal();
  lastFocus = document.activeElement;
  modalLayer = document.createElement("div");
  modalLayer.className = "ui-modal-layer";
  modalLayer.innerHTML = `<div class="ui-modal${wide ? " wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="${labelledBy}">${html}</div>`;
  document.body.appendChild(modalLayer);
  document.body.classList.add("ui-modal-open");
  modalLayer.addEventListener("click", e => { if (e.target === modalLayer) closeModal(); });
  modalLayer.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => closeModal()));
  modalLayer._onClose = onClose;
  const focusable = modalLayer.querySelector("input,select,textarea,button:not([data-close])") || modalLayer.querySelector("button");
  setTimeout(() => focusable?.focus(), 30);
  return modalLayer.querySelector(".ui-modal");
}
export function closeModal() {
  if (!modalLayer) return;
  const cb = modalLayer._onClose;
  modalLayer.remove();
  modalLayer = null;
  document.body.classList.remove("ui-modal-open");
  lastFocus?.focus?.();
  cb?.();
}
if (typeof document !== "undefined") document.addEventListener("keydown", e => { if (e.key === "Escape" && modalLayer) closeModal(); });

export function modalHead(title, eyebrow = "") {
  return `<div class="ui-modal-head"><div>${eyebrow ? `<small>${esc(eyebrow)}</small>` : ""}<h2 id="uiModalTitle">${esc(title)}</h2></div><button type="button" class="ui-icon-btn" data-close aria-label="Fechar">×</button></div>`;
}

export function confirmDialog({ title, message, confirmText = "Confirmar", danger = false }) {
  return new Promise(resolve => {
    let decided = false;
    const m = openModal(`${modalHead(title)}<p class="ui-muted">${esc(message)}</p>
      <div class="ui-actions"><button type="button" class="ui-btn" data-close>Voltar</button>
      <button type="button" class="ui-btn ${danger ? "danger" : "primary"}" id="uiConfirmOk">${esc(confirmText)}</button></div>`,
      { onClose: () => { if (!decided) resolve(false); } });
    m.querySelector("#uiConfirmOk").onclick = () => { decided = true; closeModal(); resolve(true); };
  });
}

// ------------------------------------------------------------------ estados: carregando / vazio / erro
export function stateHTML(kind, message = "", retry = false) {
  if (kind === "loading") return `<div class="ui-state loading" role="status"><span class="ui-spinner" aria-hidden="true"></span><span>${esc(message || "Carregando...")}</span></div>`;
  if (kind === "empty") return `<div class="ui-state empty">${esc(message || "Nada por aqui ainda.")}</div>`;
  return `<div class="ui-state error" role="alert"><span>${esc(message || "Não foi possível carregar.")}</span>${retry ? `<button type="button" class="ui-btn" data-retry>Tentar novamente</button>` : ""}</div>`;
}
export function setState(el, kind, message, onRetry) {
  el.innerHTML = stateHTML(kind, message, !!onRetry);
  if (onRetry) el.querySelector("[data-retry]")?.addEventListener("click", onRetry);
}

// Botão com estado de carregamento; nunca diz "salvo" se houve erro.
export async function withBusy(btn, fn, busyText = "Salvando...") {
  if (!btn) return fn();
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  btn.textContent = busyText;
  try { return await fn(); }
  finally { btn.disabled = false; btn.removeAttribute("aria-busy"); btn.innerHTML = original; }
}

export function debounce(fn, ms = 300) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const THEMES = {
  cyan: { primary: "#08a9df", background: "#0b1220", card: "#131e31", label: "Ciano" },
  gold: { primary: "#d6a83b", background: "#0c0c0d", card: "#191919", label: "Dourado" },
  light: { primary: "#2563eb", background: "#f5f7fa", card: "#ffffff", label: "Claro" },
  red: { primary: "#e63946", background: "#0b0b0d", card: "#19191d", label: "Vermelho" },
};
export function isLightColor(hex) {
  const c = String(hex || "#000000").replace("#", "");
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 170;
}
export function safeUrl(u) {
  try { const x = new URL(u); return ["https:", "http:"].includes(x.protocol) ? x.href : ""; } catch { return ""; }
}
export function socialUrl(kind, value) {
  if (!value) return "";
  const v = String(value).trim();
  if (/^https?:\/\//i.test(v)) return safeUrl(v);
  const handle = v.replace(/^@/, "").replace(/[^a-zA-Z0-9._-]/g, "");
  if (!handle) return "";
  if (kind === "instagram") return `https://instagram.com/${handle}`;
  if (kind === "tiktok") return `https://tiktok.com/@${handle}`;
  if (kind === "facebook") return `https://facebook.com/${handle}`;
  return "";
}
