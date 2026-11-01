import { esc, isLightColor, safeUrl, errorMessage } from "/js/ui.js";
import { slugFromUrl, loadPublicShop, themeColors, unavailableText } from "/js/public-api.js";
import { createChatbot } from "/js/chatbot-engine.js";

const $ = id => document.getElementById(id);
const slug = slugFromUrl();
const msgs = $("chatMessages");

function applyTheme(c) {
  const r = document.documentElement.style;
  r.setProperty("--p", c.primary); r.setProperty("--pt", isLightColor(c.primary) ? "#111827" : "#fff");
  r.setProperty("--bg", c.background); r.setProperty("--card", c.card);
  r.setProperty("--text", isLightColor(c.background) ? "#111827" : "#fff");
  r.setProperty("--card-text", isLightColor(c.card) ? "#111827" : "#fff");
  r.setProperty("--muted", isLightColor(c.background) ? "#64748b" : "#8190a5");
  r.setProperty("--surface", isLightColor(c.card) ? "#f1f5f9" : "#0d1728");
  r.setProperty("--surface-text", isLightColor(c.card) ? "#111827" : "#ffffff");
  r.setProperty("--border", isLightColor(c.background) ? "#dbe3ee" : "#223149");
  document.querySelector('meta[name="theme-color"]').setAttribute("content", c.background);
}
const fail = text => { $("shopName").textContent = "Agendamento online"; msgs.innerHTML = `<div class="state">${esc(text)}</div>`; };

try {
  const data = await loadPublicShop(slug, "chatbot");
  if (!data.available) fail(unavailableText(data.reason));
  else {
    applyTheme(themeColors(data.shop, data.chatbot));
    document.title = `${data.shop.name} | Agendamento por chat`;
    $("shopName").textContent = data.shop.name;
    const logo = safeUrl(data.shop.logo_url); if (logo) $("shopLogo").src = logo;
    $("shopLogo").alt = `Logo ${data.shop.name}`;
    const name = data.chatbot?.name || "Assistente Barber";
    $("botName").textContent = name;
    document.querySelector(".avatar").textContent = name.charAt(0).toUpperCase();
    if (data.shop.features?.site) { $("backSite").hidden = false; $("backSite").href = `/link-agendamento/?barbearia=${encodeURIComponent(slug)}`; }
    createChatbot({ data, slug, msgs, opts: $("chatOptions"), bar: $("chatInputbar"), input: $("chatInput"), send: $("chatSend") }).start();
  }
} catch (e) {
  fail(errorMessage(e, "Não foi possível carregar o chat. Verifique sua conexão."));
}
