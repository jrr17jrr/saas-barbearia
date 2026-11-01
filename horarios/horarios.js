import { initPanel, notifyError } from "/js/app.js";
import { esc, setState, stateHTML, openModal, closeModal, modalHead, toast, withBusy, confirmDialog, errorMessage, WEEKDAYS, fmtTime, fmtDate, dateKey } from "/js/ui.js";

const ctx = await initPanel({ active: "horarios" });
if (ctx) {
  const { supabase, shop, tz } = ctx;
  const $ = id => document.getElementById(id);
  const ORDER = [1, 2, 3, 4, 5, 6, 0];
  let hours = [], pros = [];
  const t5 = v => (v || "").slice(0, 5);

  async function loadHours() {
    setState($("week"), "loading");
    const { data, error } = await supabase.from("business_hours").select("*").eq("barbershop_id", shop.id);
    if (error) return setState($("week"), "error", errorMessage(error), loadHours);
    hours = ORDER.map(d => data.find(h => h.weekday === d) || { weekday: d, is_open: false, opens_at: "09:00", closes_at: "18:00" });
    $("week").innerHTML = hours.map((h, i) => `<div class="day-row ${h.is_open ? "" : "closed"}" data-i="${i}">
      <b>${WEEKDAYS[h.weekday]}</b>
      <label><input type="checkbox" data-open ${h.is_open ? "checked" : ""} aria-label="${WEEKDAYS[h.weekday]} aberto"> Aberto</label>
      <div class="day-times"><input type="time" data-from value="${t5(h.opens_at) || "09:00"}" aria-label="Abertura"> até <input type="time" data-to value="${t5(h.closes_at) || "18:00"}" aria-label="Fechamento">
      <small>Intervalo</small><input type="time" data-bs value="${t5(h.break_start)}" aria-label="Início do intervalo"> – <input type="time" data-be value="${t5(h.break_end)}" aria-label="Fim do intervalo"></div></div>`).join("");
    $("week").querySelectorAll("[data-open]").forEach(cb => cb.onchange = () => cb.closest(".day-row").classList.toggle("closed", !cb.checked));
  }

  $("saveHours").onclick = e => withBusy(e.target, async () => {
    const rows = [];
    for (const r of $("week").querySelectorAll(".day-row")) {
      const h = hours[+r.dataset.i], open = r.querySelector("[data-open]").checked;
      const from = r.querySelector("[data-from]").value, to = r.querySelector("[data-to]").value;
      const bs = r.querySelector("[data-bs]").value || null, be = r.querySelector("[data-be]").value || null;
      if (open && (!from || !to || from >= to)) return toast(`${WEEKDAYS[h.weekday]}: abertura deve ser antes do fechamento.`, "error");
      if ((bs && !be) || (!bs && be) || (bs && be && (bs >= be || bs < from || be > to))) return toast(`${WEEKDAYS[h.weekday]}: intervalo inválido.`, "error");
      rows.push({ barbershop_id: shop.id, weekday: h.weekday, is_open: open, opens_at: open ? from : null, closes_at: open ? to : null, break_start: open ? bs : null, break_end: open ? be : null });
    }
    const { error } = await supabase.from("business_hours").upsert(rows, { onConflict: "barbershop_id,weekday" });
    if (error) return notifyError(error);
    toast("Horários salvos.", "success");
  });

  async function loadRules() {
    const { data, error } = await supabase.from("barbershops").select("slot_interval_minutes,min_notice_minutes,max_days_ahead").eq("id", shop.id).single();
    if (error) return notifyError(error);
    const setSel = (id, v) => { const s = $(id); if (![...s.options].some(o => +o.value === v)) s.insertAdjacentHTML("beforeend", `<option value="${v}">${v}</option>`); s.value = String(v); };
    setSel("rInterval", data.slot_interval_minutes); setSel("rNotice", data.min_notice_minutes); setSel("rAhead", data.max_days_ahead);
  }
  $("saveRules").onclick = e => withBusy(e.target, async () => {
    const { error } = await supabase.from("barbershops").update({ slot_interval_minutes: +$("rInterval").value, min_notice_minutes: +$("rNotice").value, max_days_ahead: +$("rAhead").value }).eq("id", shop.id);
    if (error) return notifyError(error);
    toast("Regras salvas.", "success");
  });

  async function loadSpecials() {
    setState($("specials"), "loading");
    const { data, error } = await supabase.from("special_days").select("*").eq("barbershop_id", shop.id).gte("date", dateKey(new Date(), tz)).order("date");
    if (error) return setState($("specials"), "error", errorMessage(error), loadSpecials);
    $("specials").innerHTML = data.length ? data.map(s => `<div class="block-row"><div><b>${s.date.split("-").reverse().join("/")}</b><small>${esc(s.note || "")}</small></div>
      <span>${s.is_closed ? "Fechado" : t5(s.opens_at) + " – " + t5(s.closes_at)}</span><span>${s.break_start ? "Intervalo " + t5(s.break_start) + "–" + t5(s.break_end) : ""}</span>
      <button type="button" data-del="${s.id}">Remover</button></div>`).join("") : stateHTML("empty", "Nenhum dia especial cadastrado.");
    $("specials").querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
      const { error: e } = await supabase.from("special_days").delete().eq("id", b.dataset.del);
      if (e) return notifyError(e);
      toast("Dia especial removido.", "success"); loadSpecials();
    });
  }
  $("addSpecial").onclick = () => {
    const m = openModal(`${modalHead("Dia especial", "Horários")}
      <label class="ui-field">Data<input type="date" id="sDate" min="${dateKey(new Date(), tz)}"></label>
      <label class="ui-field">Tipo<select id="sType"><option value="closed">Fechado o dia todo</option><option value="custom">Expediente diferente</option></select></label>
      <div id="sCustom" hidden><div class="ui-grid2"><label class="ui-field">Abre<input type="time" id="sFrom" value="09:00"></label><label class="ui-field">Fecha<input type="time" id="sTo" value="13:00"></label></div></div>
      <label class="ui-field">Observação<input id="sNote" maxlength="80" placeholder="Ex.: Feriado"></label>
      <div class="ui-actions"><button type="button" class="ui-btn" data-close>Cancelar</button><button type="button" class="ui-btn primary" id="sOk">Salvar</button></div>`);
    m.querySelector("#sType").onchange = e => { m.querySelector("#sCustom").hidden = e.target.value !== "custom"; };
    m.querySelector("#sOk").onclick = e => withBusy(e.target, async () => {
      const date = m.querySelector("#sDate").value, closed = m.querySelector("#sType").value === "closed";
      const from = m.querySelector("#sFrom").value, to = m.querySelector("#sTo").value;
      if (!date) return toast("Informe a data.", "error");
      if (!closed && (!from || !to || from >= to)) return toast("Horário inválido.", "error");
      const { error } = await supabase.from("special_days").upsert({ barbershop_id: shop.id, date, is_closed: closed, opens_at: closed ? null : from, closes_at: closed ? null : to, note: m.querySelector("#sNote").value.trim() || null }, { onConflict: "barbershop_id,date" });
      if (error) return notifyError(error);
      closeModal(); toast("Dia especial salvo.", "success"); loadSpecials();
    });
  };

  async function loadBlocks() {
    setState($("blocks"), "loading");
    const [b, p] = await Promise.all([
      supabase.from("blocked_times").select("*").eq("barbershop_id", shop.id).gte("ends_at", new Date().toISOString()).order("starts_at").limit(100),
      supabase.from("professionals").select("id,name").eq("barbershop_id", shop.id),
    ]);
    if (b.error || p.error) return setState($("blocks"), "error", errorMessage(b.error || p.error), loadBlocks);
    pros = p.data;
    $("blocks").innerHTML = b.data.length ? b.data.map(x => `<div class="block-row"><div><b>${esc(x.reason || "Bloqueio")}</b><small>${fmtDate(x.starts_at, tz, { weekday: "short", day: "2-digit", month: "2-digit" })} · ${x.professional_id ? esc(pros.find(q => q.id === x.professional_id)?.name || "") : "Todos"}</small></div>
      <span>${fmtTime(x.starts_at, tz)}</span><span>${fmtTime(x.ends_at, tz)}</span><button type="button" data-del="${x.id}">Desbloquear</button></div>`).join("") : stateHTML("empty", "Nenhum bloqueio futuro.");
    $("blocks").querySelectorAll("[data-del]").forEach(btn => btn.onclick = async () => {
      if (!(await confirmDialog({ title: "Desbloquear", message: "O horário voltará a ficar disponível.", confirmText: "Desbloquear" }))) return;
      const { error } = await supabase.from("blocked_times").delete().eq("id", btn.dataset.del);
      if (error) return notifyError(error);
      toast("Bloqueio removido.", "success"); loadBlocks();
    });
  }

  loadHours(); loadRules(); loadSpecials(); loadBlocks();
}
