import { initPanel, notifyError } from "/js/app.js";
import { toast, withBusy, THEMES, isLightColor } from "/js/ui.js";

const ctx = await initPanel({ active: "chatbot", feature: "chatbot" });
if (ctx && !ctx.locked) main(ctx);

async function main({ supabase, shop }) {
  const $ = id => document.getElementById(id);
  const url = `${location.origin}/chatbot/?barbearia=${encodeURIComponent(shop.slug)}`;
  $("linkText").textContent = url;
  $("openBot").href = url;

  const [st, b] = await Promise.all([
    supabase.from("barbershop_settings").select("*").eq("barbershop_id", shop.id).single(),
    supabase.from("barbershops").select("theme,primary_color,background_color,card_color").eq("id", shop.id).single(),
  ]);
  if (st.error || b.error) return notifyError(st.error || b.error, "Não foi possível carregar as configurações do chatbot.");
  const set = st.data, siteTheme = THEMES[b.data.theme] ? b.data.theme : "cyan";
  const siteColors = { primary: b.data.primary_color, background: b.data.background_color, card: b.data.card_color };
  let botTheme = THEMES[set.chatbot_theme] ? set.chatbot_theme : siteTheme;

  $("enabled").checked = set.chatbot_enabled !== false;
  $("name").value = set.chatbot_name || "Assistente Barber";
  $("greeting").value = set.chatbot_greeting || "Olá! Vou te ajudar a agendar seu horário.";
  $("syncWithSite").checked = set.chatbot_sync_with_site !== false;

  function colorsNow() { return $("syncWithSite").checked ? siteColors : THEMES[botTheme]; }
  function apply() {
    const c = colorsNow(), phone = $("phone");
    $("pname").textContent = $("name").value || "Assistente";
    $("avatar").textContent = ($("name").value || "A").charAt(0).toUpperCase();
    $("pgreeting").textContent = $("greeting").value || "Olá!";
    phone.style.setProperty("--p", c.primary); phone.style.setProperty("--bg", c.background); phone.style.setProperty("--card", c.card);
    phone.style.setProperty("--text", isLightColor(c.background) ? "#111827" : "#fff");
    phone.style.setProperty("--card-text", isLightColor(c.card) ? "#111827" : "#fff");
    phone.style.setProperty("--primary-text", isLightColor(c.primary) ? "#111827" : "#fff");
    const active = $("syncWithSite").checked ? siteTheme : botTheme;
    document.querySelectorAll(".theme-option").forEach(x => { x.classList.toggle("active", x.dataset.theme === active); x.setAttribute("aria-pressed", String(x.dataset.theme === active)); });
    $("chatThemeGrid").classList.toggle("disabled", $("syncWithSite").checked);
    $("syncStatus").textContent = $("syncWithSite").checked ? `Usando as cores do seu site (${THEMES[siteTheme].label}).` : "Tema independente do site.";
  }
  document.querySelectorAll(".theme-option").forEach(btn => btn.onclick = () => { if (!$("syncWithSite").checked) { botTheme = btn.dataset.theme; apply(); } });
  ["name", "greeting"].forEach(id => $(id).addEventListener("input", apply));
  $("syncWithSite").onchange = apply;
  $("copy").onclick = async () => { try { await navigator.clipboard.writeText(url); $("copy").textContent = "Copiado ✓"; setTimeout(() => ($("copy").textContent = "Copiar link"), 1600); } catch { toast(url, "info", 8000); } };
  $("save").onclick = e => withBusy(e.target, async () => {
    const { error } = await supabase.from("barbershop_settings").update({
      chatbot_enabled: $("enabled").checked, chatbot_name: $("name").value.trim() || "Assistente Barber",
      chatbot_greeting: $("greeting").value.trim() || "Olá! Vou te ajudar a agendar seu horário.",
      chatbot_sync_with_site: $("syncWithSite").checked, chatbot_theme: $("syncWithSite").checked ? siteTheme : botTheme,
    }).eq("barbershop_id", shop.id);
    if (error) return notifyError(error);
    $("state").textContent = "Alterações salvas ✓";
    toast("Chatbot atualizado.", "success");
    setTimeout(() => ($("state").textContent = ""), 2500);
  });
  apply();
}
