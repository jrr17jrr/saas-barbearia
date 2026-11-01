import { initPanel, watchAppointments, notifyError } from "/js/app.js";
import {
  esc, brl, fmtTime, fmtDateLong, dateKey, addDays, weekday, zonedToISO, WEEKDAYS_SHORT,
  openModal, closeModal, modalHead, confirmDialog, toast, setState, stateHTML, withBusy, errorMessage,
  fmtPhone, waLink, maskPhoneInput, isValidPhone, debounce,
} from "/js/ui.js";

const ctx = await initPanel({ active: "agenda" });
if (ctx) main(ctx);

function main({ supabase, shop, tz }) {
  const $ = id => document.getElementById(id);
  const STATUS = { confirmed: "Confirmado", completed: "Concluído", cancelled: "Cancelado", no_show: "Faltou" };
  const SOURCE = { panel: "Painel", site: "Site", chatbot: "Chatbot" };
  const params = new URLSearchParams(location.search);
  let view = "day";
  let current = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") || "") ? params.get("date") : dateKey(new Date(), tz);
  let services = [], pros = [], hours = [], dayData = { appts: [], blocks: [] };

  // ---------------------------------------------------------------- dados base
  async function loadBase() {
    const [s, p, h] = await Promise.all([
      supabase.from("services").select("id,name,price,duration_minutes,active").eq("barbershop_id", shop.id).order("sort_order"),
      supabase.from("professionals").select("id,name,active,sort_order").eq("barbershop_id", shop.id).order("sort_order"),
      supabase.from("business_hours").select("*").eq("barbershop_id", shop.id),
    ]);
    if (s.error || p.error || h.error) throw s.error || p.error || h.error;
    services = s.data; pros = p.data; hours = h.data;
    $("proFilter").innerHTML = `<option value="">Todos os profissionais</option>` + pros.map(x => `<option value="${x.id}">${esc(x.name)}${x.active ? "" : " (inativo)"}</option>`).join("");
  }

  function rangeFor(key, days) {
    return { from: zonedToISO(key, "00:00", tz), to: zonedToISO(addDays(key, days), "00:00", tz) };
  }
  async function fetchRange(key, days) {
    const { from, to } = rangeFor(key, days);
    const pro = $("proFilter").value;
    let qa = supabase.from("appointments").select("id,starts_at,ends_at,status,client_name,client_phone,service_name,price,source,notes,professional_id,service_id,client_id,cancel_reason")
      .eq("barbershop_id", shop.id).gte("starts_at", from).lt("starts_at", to).order("starts_at");
    let qb = supabase.from("blocked_times").select("id,starts_at,ends_at,reason,professional_id")
      .eq("barbershop_id", shop.id).lt("starts_at", to).gt("ends_at", from).order("starts_at");
    if (pro) { qa = qa.eq("professional_id", pro); qb = qb.or(`professional_id.is.null,professional_id.eq.${pro}`); }
    const [a, b] = await Promise.all([qa, qb]);
    if (a.error || b.error) throw a.error || b.error;
    return { appts: a.data, blocks: b.data };
  }
  const proName = id => pros.find(p => p.id === id)?.name || "";

  // ---------------------------------------------------------------- render dia
  async function renderDay() {
    const box = $("timeline");
    setState(box, "loading");
    $("dayTitle").textContent = fmtDateLong(current) + (current === dateKey(new Date(), tz) ? " · Hoje" : "");
    $("datePick").value = current;
    const h = hours.find(x => x.weekday === weekday(current));
    $("dayHours").textContent = h?.is_open ? `Expediente ${h.opens_at.slice(0, 5)} — ${h.closes_at.slice(0, 5)}${h.break_start ? ` · intervalo ${h.break_start.slice(0, 5)}–${h.break_end.slice(0, 5)}` : ""}` : "Barbearia fechada neste dia";
    try {
      dayData = await fetchRange(current, 1);
    } catch (e) {
      setState(box, "error", errorMessage(e, "Não foi possível carregar a agenda."), renderDay);
      return;
    }
    const all = dayData.appts;
    $("sTotal").textContent = all.filter(a => a.status !== "cancelled").length;
    $("sDone").textContent = all.filter(a => a.status === "completed").length;
    $("sLost").textContent = `${all.filter(a => a.status === "cancelled").length} · ${all.filter(a => a.status === "no_show").length}`;
    $("sBlocks").textContent = dayData.blocks.length;

    const showCancelled = $("showCancelled").checked;
    const items = [
      ...all.filter(a => showCancelled || a.status !== "cancelled").map(a => ({ t: a.starts_at, kind: "appt", a })),
      ...dayData.blocks.map(b => ({ t: b.starts_at, kind: "block", b })),
    ].sort((x, y) => new Date(x.t) - new Date(y.t));
    if (!items.length) {
      box.innerHTML = stateHTML("empty", "Nenhum agendamento ou bloqueio neste dia.") +
        `<div style="text-align:center"><button class="ui-btn primary" type="button" id="emptyNew">+ Novo agendamento</button></div>`;
      $("emptyNew").onclick = () => newAppointment();
      return;
    }
    box.innerHTML = items.map(it => {
      if (it.kind === "block") {
        const b = it.b;
        return `<div class="slot blocked"><div class="slot-time">${fmtTime(b.starts_at, tz)}</div><div class="slot-main"><div><b>Horário bloqueado</b>
          <small>${esc(b.reason || "Bloqueio")} · até ${fmtTime(b.ends_at, tz)} · ${b.professional_id ? esc(proName(b.professional_id)) : "Todos"}</small></div><span class="tag block">Bloqueado</span></div>
          <div class="slot-actions"><button type="button" data-unblock="${b.id}">Desbloquear</button></div></div>`;
      }
      const a = it.a;
      return `<div class="slot ${a.status}"><div class="slot-time">${fmtTime(a.starts_at, tz)}</div><div class="slot-main"><div><b>${esc(a.client_name || "Cliente")}</b>
        <small>${esc(a.service_name || "")} • até ${fmtTime(a.ends_at, tz)}</small><small class="pro">${esc(proName(a.professional_id))}${a.source !== "panel" ? " · via " + SOURCE[a.source] : ""}</small></div>
        <span class="status-pill ${a.status}">${STATUS[a.status]}</span></div>
        <div class="slot-actions"><button type="button" data-open="${a.id}">Gerenciar</button>${a.client_phone ? `<button type="button" class="whatsapp" data-msg="${a.id}">Avisar cliente</button>` : ""}</div></div>`;
    }).join("");
    box.querySelectorAll("[data-open]").forEach(b => b.onclick = () => details(b.dataset.open));
    box.querySelectorAll("[data-msg]").forEach(b => b.onclick = () => messages(dayData.appts.find(a => a.id === b.dataset.msg)));
    box.querySelectorAll("[data-unblock]").forEach(b => b.onclick = () => unblock(b.dataset.unblock));
  }

  // ---------------------------------------------------------------- render semana
  function weekStart(key) { const wd = weekday(key); return addDays(key, wd === 0 ? -6 : 1 - wd); }
  async function renderWeek() {
    const grid = $("weekGrid");
    const start = weekStart(current);
    $("dayTitle").textContent = `Semana de ${start.split("-").reverse().slice(0, 2).join("/")} a ${addDays(start, 6).split("-").reverse().slice(0, 2).join("/")}`;
    $("dayHours").textContent = "Toque em um dia para ver os detalhes";
    setState(grid, "loading");
    let data;
    try { data = await fetchRange(start, 7); } catch (e) { setState(grid, "error", errorMessage(e), renderWeek); return; }
    const today = dateKey(new Date(), tz);
    const all = data.appts.filter(a => $("showCancelled").checked || a.status !== "cancelled");
    $("sTotal").textContent = data.appts.filter(a => a.status !== "cancelled").length;
    $("sDone").textContent = data.appts.filter(a => a.status === "completed").length;
    $("sLost").textContent = `${data.appts.filter(a => a.status === "cancelled").length} · ${data.appts.filter(a => a.status === "no_show").length}`;
    $("sBlocks").textContent = data.blocks.length;
    grid.innerHTML = Array.from({ length: 7 }, (_, i) => {
      const k = addDays(start, i);
      const items = [
        ...all.filter(a => dateKey(a.starts_at, tz) === k).map(a => `<button type="button" class="week-item ${a.status}" data-open="${a.id}"><span>${fmtTime(a.starts_at, tz)}</span><b>${esc(a.client_name || "Cliente")}</b><small>${esc(a.service_name || "")}</small></button>`),
        ...data.blocks.filter(b => dateKey(b.starts_at, tz) === k).map(b => `<button type="button" class="week-item block" disabled><span>${fmtTime(b.starts_at, tz)}</span><b>${esc(b.reason || "Bloqueio")}</b><small>Bloqueado</small></button>`),
      ];
      return `<div class="week-day ${k === today ? "today" : ""} mobile-selected"><div class="week-day-head"><span>${WEEKDAYS_SHORT[weekday(k)]}</span><b>${k.slice(8)}</b>${k === today ? "<small>Hoje</small>" : ""}<button type="button" data-day="${k}">Ver dia</button></div>
        <div class="week-items">${items.join("") || '<small style="color:#64748b;padding:6px">Livre</small>'}</div></div>`;
    }).join("");
    grid.querySelectorAll("[data-open]").forEach(b => b.onclick = () => details(b.dataset.open));
    grid.querySelectorAll("[data-day]").forEach(b => b.onclick = () => { current = b.dataset.day; setView("day"); });
  }

  function render() { return view === "day" ? renderDay() : renderWeek(); }
  function setView(v) {
    view = v;
    const week = v === "week";
    $("timeline").style.display = week ? "none" : "grid";
    $("weekGrid").classList.toggle("show", week);
    $("todayView").classList.toggle("active", !week); $("todayView").setAttribute("aria-selected", String(!week));
    $("weekView").classList.toggle("active", week); $("weekView").setAttribute("aria-selected", String(week));
    render();
  }
  $("todayView").onclick = () => setView("day");
  $("weekView").onclick = () => setView("week");
  $("prev").onclick = () => { current = addDays(current, view === "week" ? -7 : -1); render(); };
  $("next").onclick = () => { current = addDays(current, view === "week" ? 7 : 1); render(); };
  $("goToday").onclick = () => { current = dateKey(new Date(), tz); render(); };
  $("datePick").onchange = e => { if (e.target.value) { current = e.target.value; render(); } };
  $("proFilter").onchange = render;
  $("showCancelled").onchange = render;

  // ---------------------------------------------------------------- detalhes / ações
  async function fetchAppt(id) {
    const { data, error } = await supabase.from("appointments").select("*").eq("id", id).eq("barbershop_id", shop.id).maybeSingle();
    if (error) throw error;
    return data;
  }
  async function details(id) {
    let a;
    try { a = await fetchAppt(id); } catch (e) { return notifyError(e); }
    if (!a) return toast("Agendamento não encontrado.", "error");
    const actions = a.status === "confirmed"
      ? `<button type="button" class="ui-btn primary" data-act="completed">✓ Concluir atendimento</button>
         <button type="button" class="ui-btn" data-act="reschedule">📅 Remarcar</button>
         <button type="button" class="ui-btn" data-act="no_show">⚠ Marcar falta</button>
         <button type="button" class="ui-btn danger" data-act="cancelled">✕ Cancelar</button>`
      : `<button type="button" class="ui-btn" data-act="confirmed">↺ Voltar para confirmado</button>`;
    const m = openModal(`${modalHead(a.client_name || "Cliente", "Agendamento")}
      <div class="ui-detail">
        <span>🕐 ${fmtDateLong(dateKey(a.starts_at, tz))} · ${fmtTime(a.starts_at, tz)}–${fmtTime(a.ends_at, tz)}</span>
        <span>✂️ ${esc(a.service_name || "")} · ${brl(a.price)}</span>
        <span>💈 ${esc(proName(a.professional_id))}</span>
        ${a.client_phone ? `<span>📱 <a href="${waLink(a.client_phone)}" target="_blank" rel="noopener" style="color:#7dd3fc">${fmtPhone(a.client_phone)}</a></span>` : ""}
        <span>Origem: ${SOURCE[a.source]} · Status: <span class="status-pill ${a.status}">${STATUS[a.status]}</span></span>
        ${a.cancel_reason ? `<span>Motivo: ${esc(a.cancel_reason)}</span>` : ""}
      </div>
      <label class="ui-field">Observações<textarea id="apptNotes" maxlength="500">${esc(a.notes || "")}</textarea></label>
      <button type="button" class="ui-btn small" id="saveNotes">Salvar observação</button>
      <div class="ui-actions" style="display:grid;grid-template-columns:1fr 1fr">${actions}${a.client_phone ? `<button type="button" class="ui-btn" data-act="msg">💬 Avisar cliente</button>` : ""}</div>`);
    m.querySelector("#saveNotes").onclick = e => withBusy(e.target, async () => {
      const { error } = await supabase.from("appointments").update({ notes: m.querySelector("#apptNotes").value.trim() || null }).eq("id", a.id);
      if (error) return notifyError(error);
      toast("Observação salva.", "success");
    });
    m.querySelectorAll("[data-act]").forEach(b => b.onclick = async () => {
      const act = b.dataset.act;
      if (act === "reschedule") return reschedule(a);
      if (act === "msg") return messages(a);
      let reason = null;
      if (act === "cancelled") {
        const ok = await confirmDialog({ title: "Cancelar agendamento", message: `Cancelar o horário de ${a.client_name || "cliente"}? O horário será liberado.`, confirmText: "Cancelar horário", danger: true });
        if (!ok) return details(a.id);
      }
      if (act === "no_show") {
        const ok = await confirmDialog({ title: "Marcar falta", message: "O cliente não compareceu? A falta não entra no faturamento.", confirmText: "Marcar falta" });
        if (!ok) return details(a.id);
      }
      const { error } = await supabase.rpc("set_appointment_status", { p_appointment_id: a.id, p_status: act, p_reason: reason });
      if (error) return notifyError(error);
      closeModal();
      toast({ completed: "Atendimento concluído.", cancelled: "Agendamento cancelado.", no_show: "Falta registrada.", confirmed: "Agendamento reativado." }[act], "success");
      if (act === "cancelled" && a.client_phone) messages({ ...a, status: "cancelled" }, "cancel");
      render();
    });
  }

  // Seletor de horários usando o MESMO motor do site/chatbot
  async function slotPicker(container, { serviceId, proId, date, excludeId, onPick }) {
    setState(container, "loading", "Buscando horários livres...");
    const { data, error } = await supabase.rpc("panel_available_slots", {
      p_shop_id: shop.id, p_service_id: serviceId, p_date: date, p_professional_id: proId || null, p_exclude_appointment_id: excludeId || null,
    });
    if (error) return setState(container, "error", errorMessage(error));
    const nowMs = Date.now();
    const slots = data.filter(s => new Date(s.starts_at).getTime() > nowMs - 15 * 60000 || date < dateKey(new Date(), tz));
    if (!slots.length) return setState(container, "empty", "Nenhum horário livre nesta data.");
    container.innerHTML = `<div class="ui-slots">${slots.map((s, i) => `<button type="button" data-i="${i}" aria-pressed="false">${fmtTime(s.starts_at, tz)}</button>`).join("")}</div>`;
    container.querySelectorAll("button").forEach(b => b.onclick = () => {
      container.querySelectorAll("button").forEach(x => { x.classList.remove("selected"); x.setAttribute("aria-pressed", "false"); });
      b.classList.add("selected"); b.setAttribute("aria-pressed", "true");
      onPick(slots[+b.dataset.i]);
    });
  }

  function reschedule(a) {
    let picked = null;
    const m = openModal(`${modalHead("Remarcar", a.client_name || "Cliente")}
      <div class="ui-detail"><span>Atual: ${fmtDateLong(dateKey(a.starts_at, tz))} às ${fmtTime(a.starts_at, tz)}</span><span>${esc(a.service_name || "")}</span></div>
      <div class="ui-grid2"><label class="ui-field">Nova data<input type="date" id="rDate" value="${dateKey(a.starts_at, tz)}"></label>
      <label class="ui-field">Profissional<select id="rPro">${pros.filter(p => p.active || p.id === a.professional_id).map(p => `<option value="${p.id}" ${p.id === a.professional_id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label></div>
      <p class="ui-muted">Somente horários realmente livres:</p><div id="rSlots"></div>
      <div class="ui-actions"><button type="button" class="ui-btn" id="rBack">Voltar</button><button type="button" class="ui-btn primary" id="rOk" disabled>Confirmar remarcação</button></div>`);
    const load = () => { picked = null; m.querySelector("#rOk").disabled = true; slotPicker(m.querySelector("#rSlots"), { serviceId: a.service_id, proId: m.querySelector("#rPro").value, date: m.querySelector("#rDate").value, excludeId: a.id, onPick: s => { picked = s; m.querySelector("#rOk").disabled = false; } }); };
    m.querySelector("#rDate").onchange = load; m.querySelector("#rPro").onchange = load;
    m.querySelector("#rBack").onclick = () => details(a.id);
    m.querySelector("#rOk").onclick = e => withBusy(e.target, async () => {
      const { data, error } = await supabase.rpc("reschedule_appointment", { p_appointment_id: a.id, p_starts_at: picked.starts_at, p_professional_id: m.querySelector("#rPro").value });
      if (error) { notifyError(error); return load(); }
      closeModal(); toast("Horário remarcado.", "success");
      current = dateKey(data.starts_at, tz); render();
      if (a.client_phone) messages({ ...a, starts_at: data.starts_at }, "reschedule");
    });
    load();
  }

  // ---------------------------------------------------------------- novo agendamento
  function newAppointment() {
    const active = services.filter(s => s.active);
    if (!active.length) return toast("Cadastre um serviço ativo antes de agendar.", "error");
    let picked = null, clientId = null;
    const m = openModal(`${modalHead("Novo agendamento", "Agenda")}
      <label class="ui-field">Serviço<select id="nService">${active.map(s => `<option value="${s.id}">${esc(s.name)} · ${s.duration_minutes} min · ${brl(s.price)}</option>`).join("")}</select></label>
      <div class="ui-grid2"><label class="ui-field">Profissional<select id="nPro"><option value="">Qualquer disponível</option>${pros.filter(p => p.active).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></label>
      <label class="ui-field">Data<input type="date" id="nDate" value="${current}"></label></div>
      <div id="nSlots"></div>
      <label class="ui-field">Cliente<input id="nName" autocomplete="off" maxlength="80" placeholder="Nome ou busque um cliente"></label>
      <div class="client-suggest" id="nSuggest"></div>
      <label class="ui-field">WhatsApp<input id="nPhone" inputmode="tel" placeholder="(21) 99999-9999"></label>
      <label class="ui-field">Observações<input id="nNotes" maxlength="300"></label>
      <div class="ui-actions"><button type="button" class="ui-btn" data-close>Cancelar</button><button type="button" class="ui-btn primary" id="nOk" disabled>Agendar</button></div>`, { wide: true });
    const svc = m.querySelector("#nService"), pro = m.querySelector("#nPro"), date = m.querySelector("#nDate");
    maskPhoneInput(m.querySelector("#nPhone"));
    const load = () => { picked = null; m.querySelector("#nOk").disabled = true; slotPicker(m.querySelector("#nSlots"), { serviceId: svc.value, proId: pro.value, date: date.value, onPick: s => { picked = s; m.querySelector("#nOk").disabled = false; } }); };
    svc.onchange = load; pro.onchange = load; date.onchange = load; load();
    const search = debounce(async q => {
      clientId = null;
      const box = m.querySelector("#nSuggest");
      if (q.length < 2) { box.innerHTML = ""; return; }
      const { data } = await supabase.rpc("shop_clients", { p_shop_id: shop.id, p_search: q, p_limit: 5 });
      box.innerHTML = (data || []).map((c, i) => `<button type="button" data-i="${i}">${esc(c.name)} <small style="color:#94a3b8">${fmtPhone(c.whatsapp)}</small></button>`).join("");
      box.querySelectorAll("button").forEach(b => b.onclick = () => {
        const c = data[+b.dataset.i]; clientId = c.id;
        m.querySelector("#nName").value = c.name; m.querySelector("#nPhone").value = fmtPhone(c.whatsapp); box.innerHTML = "";
      });
    }, 300);
    m.querySelector("#nName").oninput = e => search(e.target.value.trim());
    m.querySelector("#nOk").onclick = e => withBusy(e.target, async () => {
      const name = m.querySelector("#nName").value.trim(), phone = m.querySelector("#nPhone").value.trim();
      if (name.length < 2) return toast("Informe o nome do cliente.", "error");
      if (phone && !isValidPhone(phone)) return toast("WhatsApp inválido.", "error");
      const { data, error } = await supabase.rpc("panel_create_appointment", {
        p_shop_id: shop.id, p_service_id: svc.value, p_starts_at: picked.starts_at, p_client_name: name,
        p_client_phone: phone || null, p_professional_id: pro.value || picked.professional_id, p_client_id: clientId, p_notes: m.querySelector("#nNotes").value,
      });
      if (error) { notifyError(error); return load(); }
      closeModal(); toast("Agendamento criado.", "success");
      current = dateKey(data.starts_at, tz); render();
    }, "Agendando...");
  }
  $("newBtn").onclick = () => newAppointment();

  // ---------------------------------------------------------------- bloqueios
  function blockForm() {
    const m = openModal(`${modalHead("Bloquear horário", "Agenda")}
      <label class="ui-field">Data<input type="date" id="bDate" value="${current}"></label>
      <div class="ui-grid2"><label class="ui-field">De<input type="time" id="bFrom" value="12:00" step="300"></label><label class="ui-field">Até<input type="time" id="bTo" value="13:00" step="300"></label></div>
      <label class="ui-field">Profissional<select id="bPro"><option value="">Todos (bloqueio geral)</option>${pros.filter(p => p.active).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></label>
      <label class="ui-field">Motivo<input id="bReason" maxlength="80" placeholder="Ex.: almoço, compromisso"></label>
      <label class="ui-field">Repetição<select id="bRepeat"><option value="0">Somente este dia</option><option value="w4">Mesmo dia da semana por 4 semanas</option><option value="w8">Mesmo dia da semana por 8 semanas</option><option value="wd2">Todos os dias úteis por 2 semanas</option></select></label>
      <div class="ui-actions"><button type="button" class="ui-btn" data-close>Cancelar</button><button type="button" class="ui-btn primary" id="bOk">Salvar bloqueio</button></div>`);
    m.querySelector("#bOk").onclick = e => withBusy(e.target, async () => {
      const d = m.querySelector("#bDate").value, f = m.querySelector("#bFrom").value, t = m.querySelector("#bTo").value;
      if (!d || !f || !t || t <= f) return toast("Informe um intervalo válido.", "error");
      const rep = m.querySelector("#bRepeat").value;
      let dates = [d];
      if (rep.startsWith("w") && !rep.startsWith("wd")) dates = Array.from({ length: +rep.slice(1) }, (_, i) => addDays(d, i * 7));
      if (rep === "wd2") dates = Array.from({ length: 14 }, (_, i) => addDays(d, i)).filter(k => ![0, 6].includes(weekday(k)));
      const rows = dates.map(k => ({ barbershop_id: shop.id, professional_id: m.querySelector("#bPro").value || null, starts_at: zonedToISO(k, f, tz), ends_at: zonedToISO(k, t, tz), reason: m.querySelector("#bReason").value.trim() || null }));
      const { error } = await supabase.from("blocked_times").insert(rows);
      if (error) return notifyError(error);
      // aviso se o bloqueio cobre agendamentos existentes
      let q = supabase.from("appointments").select("id").eq("barbershop_id", shop.id).eq("status", "confirmed")
        .lt("starts_at", rows[0].ends_at).gt("ends_at", rows[0].starts_at);
      if (rows[0].professional_id) q = q.eq("professional_id", rows[0].professional_id);
      const { data: overlaps } = await q;
      closeModal();
      toast(rows.length > 1 ? `${rows.length} bloqueios criados.` : "Horário bloqueado.", "success");
      if (overlaps?.length) toast("Atenção: existem agendamentos confirmados nesse período. Remarque ou cancele se necessário.", "info", 6000);
      render();
    });
  }
  $("blockBtn").onclick = blockForm;
  async function unblock(id) {
    const ok = await confirmDialog({ title: "Desbloquear horário", message: "Este horário voltará a ficar disponível para clientes.", confirmText: "Desbloquear" });
    if (!ok) return;
    const { error } = await supabase.from("blocked_times").delete().eq("id", id);
    if (error) return notifyError(error);
    toast("Horário desbloqueado.", "success"); render();
  }

  // ---------------------------------------------------------------- mensagens WhatsApp (abre o WhatsApp do próprio dono, sem custo)
  const templates = {
    confirm: a => `Olá, ${a.client_name}! Passando para confirmar seu horário na ${shop.name} em ${fmtDateLong(dateKey(a.starts_at, tz))} às ${fmtTime(a.starts_at, tz)}. Podemos confirmar?`,
    reschedule: a => `Olá, ${a.client_name}! Seu horário na ${shop.name} foi ajustado para ${fmtDateLong(dateKey(a.starts_at, tz))} às ${fmtTime(a.starts_at, tz)}. Está tudo certo para você?`,
    delay: a => `Olá, ${a.client_name}! Tivemos um pequeno atraso nos atendimentos. Em breve te atualizo sobre seu horário.`,
    cancel: a => `Olá, ${a.client_name}! Infelizmente precisaremos cancelar seu horário de ${fmtDateLong(dateKey(a.starts_at, tz))} às ${fmtTime(a.starts_at, tz)}. Me chama para encontrarmos um novo horário.`,
  };
  function messages(a, preset) {
    if (!a?.client_phone) return;
    if (preset) return preview(a, preset);
    const m = openModal(`${modalHead("Avisar cliente", a.client_name)}<p class="ui-muted">Escolha uma mensagem. Você pode editar antes de abrir o WhatsApp.</p>
      <div class="msg-options">${[["confirm", "Confirmar horário", "Confirmar presença"], ["reschedule", "Novo horário", "Informar remarcação"], ["delay", "Aviso de atraso", "Informar atraso"], ["cancel", "Cancelamento", "Avisar cancelamento"]]
        .map(([k, t, s]) => `<button type="button" data-k="${k}"><b>${t}</b><small>${s}</small></button>`).join("")}</div>`);
    m.querySelectorAll("[data-k]").forEach(b => b.onclick = () => preview(a, b.dataset.k));
  }
  function preview(a, k) {
    const m = openModal(`${modalHead("Conferir mensagem", a.client_name)}<label class="ui-field">Mensagem<textarea id="msgText" rows="6">${esc(templates[k](a))}</textarea></label>
      <div class="ui-actions"><button type="button" class="ui-btn" data-close>Fechar</button><button type="button" class="ui-btn primary" id="openWa">Abrir WhatsApp</button></div>`);
    m.querySelector("#openWa").onclick = () => window.open(waLink(a.client_phone, m.querySelector("#msgText").value), "_blank", "noopener");
  }

  // ---------------------------------------------------------------- init
  (async () => {
    try { await loadBase(); } catch (e) { setState($("timeline"), "error", errorMessage(e), () => location.reload()); return; }
    await render();
    const deep = params.get("appointment");
    if (deep) { details(deep); history.replaceState(null, "", "/agendamentos/"); }
    watchAppointments(shop.id, () => render());
  })();
}
