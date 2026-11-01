import { esc, brl, fmtTime, fmtDate, WEEKDAYS_SHORT, weekday, isValidPhone, normalizePhone, fmtPhone, maskPhoneInput, errorMessage, safeUrl, socialUrl, waLink } from "/js/ui.js";
import { slugFromUrl, loadPublicShop, getSlots, book, prosForService, upcomingDays, themeColors, applySiteTheme, unavailableText } from "/js/public-api.js";

const app = document.getElementById("app");
const slug = slugFromUrl();

function fail(text) {
  app.innerHTML = `<div class="public-state"><div><h1 style="font-size:20px">Agendamento online</h1><p>${esc(text)}</p><p style="margin-top:20px;font-size:11px"><a href="https://visionariodev.com.br" target="_blank" rel="noopener" style="color:inherit">Desenvolvido por Visionário Dev</a></p></div></div>`;
}

let data;
try {
  data = await loadPublicShop(slug, "site");
} catch (e) {
  fail(errorMessage(e, "Não foi possível carregar a página. Verifique sua conexão."));
}
if (data && !data.available) fail(unavailableText(data.reason));
if (data?.available) render();

function render() {
  const { shop } = data;
  const tz = shop.timezone || "America/Sao_Paulo";
  applySiteTheme(themeColors(shop));
  document.title = `${shop.name} | Agendar horário`;
  app.replaceChildren(document.getElementById("pageTpl").content.cloneNode(true));
  const $ = id => document.getElementById(id);

  $("pName").textContent = shop.name;
  if (shop.is_demo) $("pName").insertAdjacentHTML("afterend", '<span class="demo-badge">Demonstração</span>');
  const logo = safeUrl(shop.logo_url); if (logo) $("pLogo").src = logo; $("pLogo").alt = `Logo ${shop.name}`;
  $("pStatus").querySelector("span").textContent = shop.public_status_text || "Aberto agora";
  if (/fechad|férias/i.test(shop.public_status_text || "")) $("pStatus").classList.remove("aberto");
  const sp = data.today?.special;
  const h = data.hours.find(x => x.weekday === weekday(data.today.date));
  $("pHours").textContent = sp ? (sp.is_closed ? "Fechado hoje" : `${sp.opens_at.slice(0, 5)} — ${sp.closes_at.slice(0, 5)}`) : h?.is_open ? `${h.opens_at.slice(0, 5)} — ${h.closes_at.slice(0, 5)}` : "Fechado hoje";
  if (shop.address) $("pAddress").textContent = shop.address; else $("pAddressCard").hidden = true;
  $("pServicesCount").textContent = `${data.services.length} disponíveis`;

  // redes
  const links = { instagram: socialUrl("instagram", shop.instagram), whatsapp: shop.whatsapp ? waLink(shop.whatsapp) : "", facebook: socialUrl("facebook", shop.facebook), tiktok: socialUrl("tiktok", shop.tiktok) };
  $("pSocial").querySelectorAll("[data-k]").forEach(a => { const u = links[a.dataset.k]; if (u) a.href = u; else a.remove(); });
  if (!$("pSocial").children.length) $("pSocial").remove();

  // serviços
  $("pServices").innerHTML = "<h2>Serviços</h2>" + (data.services.length ? data.services.map((s, i) => `<div class="service-card">
      <img src="${esc(safeUrl(s.image_url) || "/img/disfarcado.jpg")}" alt="${esc(s.name)}" loading="lazy">
      <div class="service-info"><h3>${esc(s.name)}</h3><p>${esc(s.description || "")}</p>
      <div class="details"><span>${s.duration_minutes >= 60 && s.duration_minutes % 60 === 0 ? s.duration_minutes / 60 + "h" : s.duration_minutes + " min"}</span><span>${brl(s.price)}</span></div>
      <a href="#" class="schedule-btn" data-service="${i}">Agendar</a></div></div>`).join("") : `<p style="color:var(--site-muted)">Nenhum serviço disponível no momento.</p>`);

  // avaliações e mapa
  const rating = Number(shop.google_rating);
  if (rating > 0 || shop.review_link) {
    $("pStars").innerHTML = Array.from({ length: 5 }, (_, i) => `<span style="opacity:${i < Math.round(rating) ? 1 : .3}">★</span>`).join("");
    $("pStars").setAttribute("aria-label", `${rating.toFixed(1)} de 5 estrelas`);
    $("pRating").textContent = rating > 0 ? `${rating.toFixed(1)} no Google` : "Avalie no Google";
    const rl = safeUrl(shop.review_link); if (rl) $("pReviewBtn").href = rl; else $("pReviewBtn").remove();
  } else $("pReviews").remove();
  const maps = safeUrl(shop.maps_link) || (shop.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shop.address)}` : "");
  if (shop.address) {
    $("pMap").innerHTML = `<iframe title="Mapa de ${esc(shop.name)}" src="https://www.google.com/maps?q=${encodeURIComponent(shop.address)}&output=embed" width="100%" height="320" style="border:0" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`;
    $("pRoute").href = maps;
  } else if (maps) { $("pMap").remove(); $("pRoute").href = maps; }
  else $("pLocation").remove();

  // chatbot (mesma lógica, página dedicada)
  if (shop.features?.chatbot) {
    document.body.insertAdjacentHTML("beforeend", `<a class="chatbot-launch" href="/chatbot/?barbearia=${encodeURIComponent(slug)}">Conversar e agendar</a>`);
  }

  setupBooking(tz);
}

function setupBooking(tz) {
  const { shop } = data;
  document.body.insertAdjacentHTML("beforeend", `
    <div class="booking-overlay" id="bookingOverlay" role="dialog" aria-modal="true" aria-labelledby="bookingTitle">
      <div class="booking-modal"><div class="booking-handle"></div>
        <div class="booking-header"><div><small>${esc(shop.name)}</small><h2 id="bookingTitle">Agendar horário</h2></div><button type="button" class="booking-close" aria-label="Fechar">×</button></div>
        <div class="booking-progress" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></div>
        <div id="bookingContent" aria-live="polite"></div>
      </div>
    </div>`);
  const overlay = document.getElementById("bookingOverlay"), content = document.getElementById("bookingContent");
  let st = {};

  const progress = n => document.querySelectorAll(".booking-progress span").forEach((x, i) => x.classList.toggle("active", i < n));
  const summary = () => `<div class="booking-selected"><b>${esc(st.service.name)}</b><small>${st.service.duration_minutes} min • ${brl(st.service.price)}${st.pro ? " • " + esc(st.pro.name) : ""}${st.slot ? " • " + fmtDate(st.slot.starts_at, tz) + " " + fmtTime(st.slot.starts_at, tz) : ""}</small></div>`;
  const actions = (nextLabel, disabled = true) => `<div class="booking-actions"><button type="button" class="booking-back">Voltar</button>${nextLabel ? `<button type="button" class="booking-next" ${disabled ? "disabled" : ""}>${nextLabel}</button>` : ""}</div>`;

  function open(service = null) {
    st = { name: st.name || "", phone: st.phone || "" };
    overlay.classList.add("open"); document.body.classList.add("booking-open");
    if (service) { st.service = service; proStep(); } else serviceStep();
    setTimeout(() => content.querySelector("button")?.focus(), 50);
  }
  function close() { overlay.classList.remove("open"); document.body.classList.remove("booking-open"); }

  function serviceStep() {
    progress(1);
    content.innerHTML = `<p class="booking-step-title">Escolha o serviço</p><div class="booking-service-list">${data.services.map((s, i) => `
      <button type="button" class="booking-service-option" data-i="${i}"><div><b>${esc(s.name)}</b><small>${esc(s.description || "")}</small></div><span>${brl(s.price)}<small>${s.duration_minutes} min</small></span></button>`).join("")}</div>`;
    content.querySelectorAll("[data-i]").forEach(b => b.onclick = () => { st.service = data.services[+b.dataset.i]; st.pro = undefined; proStep(); });
  }
  function proStep() {
    const pros = prosForService(data, st.service.id);
    if (pros.length <= 1) { st.pro = pros[0] || null; st.skipPro = true; return dateStep(); }
    st.skipPro = false;
    progress(2);
    content.innerHTML = summary() + `<p class="booking-step-title">Escolha o profissional</p><div class="booking-service-list">
      <button type="button" class="booking-service-option" data-p="-1"><div><b>Sem preferência</b><small>Primeiro profissional disponível</small></div></button>
      ${pros.map((p, i) => `<button type="button" class="booking-service-option" data-p="${i}"><div style="display:flex;gap:10px;align-items:center">${safeUrl(p.photo_url) ? `<img class="booking-pro-photo" src="${esc(safeUrl(p.photo_url))}" alt="">` : ""}<div><b>${esc(p.name)}</b><small>${esc(p.specialty || "")}</small></div></div></button>`).join("")}</div>${actions(null)}`;
    content.querySelectorAll("[data-p]").forEach(b => b.onclick = () => { st.pro = +b.dataset.p < 0 ? null : pros[+b.dataset.p]; dateStep(); });
    content.querySelector(".booking-back").onclick = serviceStep;
  }
  function dateStep() {
    progress(3); st.slot = null;
    const days = upcomingDays(data, 14);
    content.innerHTML = summary() + `<p class="booking-step-title">Escolha o dia</p><div class="booking-days">${days.map(d => `
      <button type="button" class="booking-day" data-d="${d.key}"><b>${d.today ? "HOJE" : WEEKDAYS_SHORT[weekday(d.key)]}</b><small>${d.key.slice(8)}/${d.key.slice(5, 7)}</small></button>`).join("") || '<p style="color:var(--site-muted)">Sem dias disponíveis.</p>'}</div>${actions(null)}`;
    content.querySelectorAll("[data-d]").forEach(b => b.onclick = () => { st.date = b.dataset.d; timeStep(); });
    content.querySelector(".booking-back").onclick = () => (st.skipPro ? serviceStep() : proStep());
  }
  async function timeStep() {
    progress(4);
    content.innerHTML = summary() + `<p class="booking-step-title">Horários disponíveis · ${fmtDate(st.date + "T12:00:00Z", "UTC", { weekday: "long", day: "2-digit", month: "2-digit" })}</p><div class="booking-times"><span class="ui-spinner"></span></div>${actions("Continuar")}`;
    content.querySelector(".booking-back").onclick = dateStep;
    const box = content.querySelector(".booking-times");
    let slots;
    try { slots = await getSlots(slug, st.service.id, st.date, st.pro?.id, "site"); }
    catch (e) { box.innerHTML = `<p class="booking-error">${esc(errorMessage(e))}</p>`; return; }
    if (!slots.length) { box.innerHTML = `<p class="booking-demo-note">Nenhum horário livre neste dia. Escolha outro dia.</p>`; return; }
    box.innerHTML = slots.map((s, i) => `<button type="button" class="booking-time" data-s="${i}" aria-pressed="false">${fmtTime(s.starts_at, tz)}</button>`).join("");
    const next = content.querySelector(".booking-next");
    box.querySelectorAll("[data-s]").forEach(b => b.onclick = () => {
      box.querySelectorAll(".booking-time").forEach(x => { x.classList.remove("active"); x.setAttribute("aria-pressed", "false"); });
      b.classList.add("active"); b.setAttribute("aria-pressed", "true"); st.slot = slots[+b.dataset.s]; next.disabled = false;
    });
    next.onclick = dataStep;
  }
  function dataStep() {
    progress(5);
    content.innerHTML = summary() + `<p class="booking-step-title">Seus dados</p>
      <label class="booking-label">Nome<input id="bName" autocomplete="name" maxlength="80" placeholder="Ex.: João Silva" value="${esc(st.name)}"></label>
      <label class="booking-label">WhatsApp<input id="bPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="(21) 99999-9999" value="${esc(st.phone)}"></label>
      <p class="booking-error" id="bErr" role="alert"></p>${actions("Revisar agendamento", false)}`;
    maskPhoneInput(document.getElementById("bPhone"));
    content.querySelector(".booking-back").onclick = timeStep;
    content.querySelector(".booking-next").onclick = () => {
      st.name = document.getElementById("bName").value.trim().replace(/\s+/g, " ");
      st.phone = document.getElementById("bPhone").value.trim();
      const err = document.getElementById("bErr");
      if (st.name.length < 2 || /[<>{}]/.test(st.name)) return (err.textContent = "Informe seu nome.");
      if (!isValidPhone(st.phone)) return (err.textContent = "Informe um WhatsApp válido com DDD.");
      reviewStep();
    };
  }
  function reviewStep() {
    progress(6);
    const proName = st.pro?.name || data.professionals.find(p => p.id === st.slot.professional_id)?.name;
    content.innerHTML = `<p class="booking-step-title">Confira seu agendamento</p><div class="booking-summary"><b>${esc(st.service.name)}</b>
      <span>📅 ${fmtDate(st.slot.starts_at, tz, { weekday: "long", day: "2-digit", month: "2-digit" })}</span><span>🕒 ${fmtTime(st.slot.starts_at, tz)}</span>
      <span>⏱ ${st.service.duration_minutes} min</span><span>💰 ${brl(st.service.price)}</span>${proName ? `<span>💈 ${esc(proName)}</span>` : ""}
      <span>👤 ${esc(st.name)}</span><span>📱 ${fmtPhone(normalizePhone(st.phone))}</span></div>
      <p class="booking-error" id="bErr" role="alert"></p>${actions("Confirmar agendamento", false)}`;
    content.querySelector(".booking-back").onclick = dataStep;
    const btn = content.querySelector(".booking-next");
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = "Confirmando...";
      try {
        const r = await book({ slug, serviceId: st.service.id, startsAt: st.slot.starts_at, name: st.name, whatsapp: st.phone, professionalId: st.pro?.id || st.slot.professional_id, channel: "site" });
        success(r);
      } catch (e) {
        document.getElementById("bErr").textContent = errorMessage(e);
        btn.disabled = false; btn.textContent = "Confirmar agendamento";
        if (String(e?.message).includes("SLOT_UNAVAILABLE")) { btn.textContent = "Escolher outro horário"; btn.onclick = timeStep; }
      }
    };
  }
  function success(r) {
    progress(6);
    const when = `${fmtDate(r.starts_at, tz, { weekday: "long", day: "2-digit", month: "2-digit" })} às ${fmtTime(r.starts_at, tz)}`;
    const wa = data.shop.whatsapp ? waLink(data.shop.whatsapp, `Olá! Acabei de agendar ${r.service_name} para ${when} pelo site. Nome: ${st.name}.`) : "";
    content.innerHTML = `<div class="booking-success"><div>✓</div><h3>Agendamento confirmado!</h3><p>${esc(r.service_name)}<br>${esc(when)}${r.professional_name ? `<br>com ${esc(r.professional_name)}` : ""}</p>
      <small>Guarde esta informação. Para remarcar ou cancelar, fale com a barbearia.</small>
      ${wa ? `<a class="booking-next" href="${wa}" target="_blank" rel="noopener" style="text-decoration:none;display:block;text-align:center;margin-top:10px">Avisar a barbearia no WhatsApp</a>` : ""}
      <button type="button" class="booking-back" style="margin-top:8px;width:100%">Fechar</button></div>`;
    content.querySelector(".booking-back").onclick = close;
  }

  document.getElementById("mainBook").addEventListener("click", e => { e.preventDefault(); if (data.services.length) open(); });
  document.querySelectorAll(".schedule-btn").forEach(b => b.addEventListener("click", e => { e.preventDefault(); open(data.services[+b.dataset.service]); }));
  overlay.querySelector(".booking-close").onclick = close;
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && overlay.classList.contains("open")) close(); });
  if (new URLSearchParams(location.search).has("agendar")) open();
}
