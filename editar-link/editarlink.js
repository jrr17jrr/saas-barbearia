import { initPanel, notifyError } from "/js/app.js";
import { esc, brl, toast, withBusy, THEMES, isLightColor, fmtPhone, maskPhoneInput, isValidPhone, safeUrl, errorMessage, setState } from "/js/ui.js";
import { uploadShopImage } from "/js/upload.js";

const ctx = await initPanel({ active: "site", feature: "site" });
if (ctx && !ctx.locked) main(ctx);

async function main({ supabase, shop }) {
  const area = document.getElementById("formArea");
  const publicUrl = `${location.origin}/link-agendamento/?barbearia=${encodeURIComponent(shop.slug)}`;
  document.getElementById("viewSite").href = publicUrl;

  const [b, st, sv] = await Promise.all([
    supabase.from("barbershops").select("*").eq("id", shop.id).single(),
    supabase.from("barbershop_settings").select("*").eq("barbershop_id", shop.id).single(),
    supabase.from("services").select("name,price,duration_minutes,description,image_url,active").eq("barbershop_id", shop.id).eq("active", true).order("sort_order"),
  ]);
  if (b.error || st.error || sv.error) return setState(area, "error", errorMessage(b.error || st.error || sv.error), () => location.reload());
  area.replaceChildren(document.getElementById("formTpl").content.cloneNode(true));
  const $ = id => document.getElementById(id);
  const data = b.data;
  let logo = data.logo_url || null;
  let colors = { primary: data.primary_color || THEMES.cyan.primary, background: data.background_color || THEMES.cyan.background, card: data.card_color || THEMES.cyan.card };
  let theme = THEMES[data.theme] ? data.theme : "cyan";

  $("publicLink").textContent = publicUrl;
  $("shareWa").href = `https://wa.me/?text=${encodeURIComponent(`Agende seu horário na ${data.name}: ${publicUrl}`)}`;
  $("copyLink").onclick = async () => { try { await navigator.clipboard.writeText(publicUrl); toast("Link copiado!", "success"); } catch { toast(publicUrl, "info", 8000); } };
  $("siteEnabled").checked = st.data.site_enabled !== false;
  $("shopName").value = data.name || "";
  if (![...$("shopStatus").options].some(o => o.value === data.public_status_text) && data.public_status_text) $("shopStatus").insertAdjacentHTML("beforeend", `<option>${esc(data.public_status_text)}</option>`);
  $("shopStatus").value = data.public_status_text || "Aberto agora";
  $("shopDescription").value = data.description || "";
  $("address").value = data.address || "";
  $("whatsapp").value = data.whatsapp ? fmtPhone(data.whatsapp) : "";
  maskPhoneInput($("whatsapp"));
  for (const k of ["instagram", "facebook", "tiktok"]) $(k).value = data[k] || "";
  for (const k of ["instagram", "whatsapp", "facebook", "tiktok"]) $(k + "Enabled").checked = !!data[k + "_enabled"];
  $("rating").value = data.google_rating ?? "5.0";
  $("reviewLink").value = data.review_link || "";
  $("mapsLink").value = data.maps_link || "";
  $("logoPreview").src = safeUrl(logo) || "/img/logo.png";

  $("serviceList").innerHTML = sv.data.length ? sv.data.map(s => `<div class="site-service"><img src="${esc(safeUrl(s.image_url) || "/img/disfarcado.jpg")}" alt=""><div><b>${esc(s.name)}</b><small>${esc(s.description || "")}</small></div><div class="meta">${s.duration_minutes} min • ${brl(s.price)}</div></div>`).join("")
    : `<p class="ui-muted">Nenhum serviço ativo. <a href="/servicos/" style="color:#7dd3fc">Cadastre seus serviços</a>.</p>`;
  $("previewServices").innerHTML = sv.data.slice(0, 2).map(s => `<div class="preview-service"><span></span><div><b>${esc(s.name)}</b><small>${s.duration_minutes} min · ${brl(s.price)}</small></div><button type="button" tabindex="-1">Agendar</button></div>`).join("");

  function syncColorInputs() { $("cPrimary").value = colors.primary; $("cBackground").value = colors.background; $("cCard").value = colors.card; }
  function selectTheme(name) {
    theme = name; colors = { primary: THEMES[name].primary, background: THEMES[name].background, card: THEMES[name].card };
    syncColorInputs(); updatePreview();
  }
  function updatePreview() {
    document.querySelectorAll(".theme-option").forEach(x => { const on = x.dataset.theme === theme; x.classList.toggle("active", on); x.setAttribute("aria-pressed", String(on)); });
    const page = document.querySelector("#livePreview .preview-page");
    page.style.setProperty("--p", colors.primary); page.style.setProperty("--bg", colors.background); page.style.setProperty("--card", colors.card);
    page.classList.toggle("light-text", isLightColor(colors.background));
    $("previewName").textContent = $("shopName").value || "Sua barbearia";
    $("previewStatus").textContent = "● " + $("shopStatus").value;
    $("previewLogo").src = $("logoPreview").src;
    const on = { instagram: $("instagramEnabled").checked, whatsapp: $("whatsappEnabled").checked, facebook: $("facebookEnabled").checked, tiktok: $("tiktokEnabled").checked };
    document.querySelectorAll("#previewSocial [data-social]").forEach(x => x.classList.toggle("hidden", !on[x.dataset.social]));
  }
  document.querySelectorAll(".theme-option").forEach(btn => btn.onclick = () => selectTheme(btn.dataset.theme));
  ["cPrimary", "cBackground", "cCard"].forEach(id => $(id).addEventListener("input", () => {
    colors = { primary: $("cPrimary").value, background: $("cBackground").value, card: $("cCard").value }; updatePreview();
  }));
  ["shopName", "shopStatus", "instagramEnabled", "whatsappEnabled", "facebookEnabled", "tiktokEnabled"].forEach(id => $(id).addEventListener("input", updatePreview));
  $("logoInput").onchange = async e => {
    try { logo = await uploadShopImage(shop.id, e.target.files[0], "logo"); $("logoPreview").src = logo; updatePreview(); toast("Logo enviada. Clique em Salvar para publicar.", "success"); }
    catch (err) { notifyError(err, err.message); }
    e.target.value = "";
  };
  $("removeLogo").onclick = () => { logo = null; $("logoPreview").src = "/img/logo.png"; updatePreview(); };
  syncColorInputs(); updatePreview();

  $("saveBtn").onclick = e => withBusy(e.target, async () => {
    const name = $("shopName").value.trim();
    if (name.length < 2) return toast("Informe o nome da barbearia.", "error");
    const wa = $("whatsapp").value.trim();
    if (wa && !isValidPhone(wa)) return toast("WhatsApp inválido.", "error");
    for (const id of ["reviewLink", "mapsLink"]) if ($(id).value.trim() && !safeUrl($(id).value.trim())) return toast("Informe links completos começando com https://", "error");
    const rating = $("rating").value === "" ? null : Math.min(5, Math.max(0, Number($("rating").value)));
    const patch = {
      name, public_status_text: $("shopStatus").value, description: $("shopDescription").value.trim() || null,
      address: $("address").value.trim() || null, whatsapp: wa ? wa.replace(/\D/g, "").replace(/^(?!55)(\d{10,11})$/, "55$1") : null,
      instagram: $("instagram").value.trim() || null, facebook: $("facebook").value.trim() || null, tiktok: $("tiktok").value.trim() || null,
      instagram_enabled: $("instagramEnabled").checked, whatsapp_enabled: $("whatsappEnabled").checked, facebook_enabled: $("facebookEnabled").checked, tiktok_enabled: $("tiktokEnabled").checked,
      theme, primary_color: colors.primary, background_color: colors.background, card_color: colors.card,
      google_rating: rating, review_link: $("reviewLink").value.trim() || null, maps_link: $("mapsLink").value.trim() || null, logo_url: logo,
    };
    const [r1, r2] = await Promise.all([
      supabase.from("barbershops").update(patch).eq("id", shop.id),
      supabase.from("barbershop_settings").update({ site_enabled: $("siteEnabled").checked }).eq("barbershop_id", shop.id),
    ]);
    if (r1.error || r2.error) return notifyError(r1.error || r2.error);
    $("saveState").textContent = "Alterações publicadas no site ✓";
    toast("Site atualizado.", "success");
  });
}
