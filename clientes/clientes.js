import { initPanel, notifyError } from "/js/app.js";
import { esc, brl, fmtTime, fmtDate, dateKey, setState, stateHTML, openModal, closeModal, modalHead, toast, withBusy, fmtPhone, waLink, maskPhoneInput, isValidPhone, debounce, errorMessage } from "/js/ui.js";

const ctx = await initPanel({ active: "clientes" });
if (ctx) {
  const { supabase, shop, tz } = ctx;
  const $ = id => document.getElementById(id);
  const STATUS = { confirmed: "Confirmado", completed: "Concluído", cancelled: "Cancelado", no_show: "Faltou" };
  let list = [];

  async function load(q = "") {
    setState($("clientList"), "loading");
    const { data, error } = await supabase.rpc("shop_clients", { p_shop_id: shop.id, p_search: q || null, p_limit: 300 });
    if (error) return setState($("clientList"), "error", errorMessage(error), () => load(q));
    list = data;
    if (!q) {
      $("hTotal").textContent = data.length >= 300 ? "300+" : data.length;
      const loyal = data.find(c => Number(c.visits_count) > 0);
      $("hLoyal").textContent = loyal ? loyal.name : "—";
      $("hLoyalSub").textContent = loyal ? `${loyal.visits_count} atendimentos` : "Sem atendimentos concluídos";
      const month = dateKey(new Date(), tz).slice(0, 7);
      $("hReturn").textContent = data.filter(c => Number(c.visits_count) > 1 && c.last_visit_at && dateKey(c.last_visit_at, tz).startsWith(month)).length;
    }
    if (!data.length) {
      $("clientList").innerHTML = stateHTML("empty", q ? "Nenhum cliente encontrado." : "Nenhum cliente ainda. Eles aparecem automaticamente quando agendam pelo site, chatbot ou agenda.");
      return;
    }
    $("clientList").innerHTML = data.map((c, i) => `<div class="client-row">
      <b>${esc(c.name)}<small>${c.whatsapp ? fmtPhone(c.whatsapp) : "Sem WhatsApp"}</small></b>
      <span>${c.visits_count} atendimento${c.visits_count == 1 ? "" : "s"}</span>
      <span>${brl(c.total_spent)} gastos</span>
      <span>${c.last_visit_at ? "Última: " + fmtDate(c.last_visit_at, tz) : c.next_appointment_at ? "Próximo: " + fmtDate(c.next_appointment_at, tz) : "Sem visitas"}</span>
      <div class="actions"><button type="button" data-i="${i}">Ver histórico</button></div></div>`).join("");
    $("clientList").querySelectorAll("[data-i]").forEach(b => b.onclick = () => profile(list[+b.dataset.i]));
  }

  async function profile(c) {
    const m = openModal(`${modalHead(c.name, "Cliente")}
      <div class="stats"><div><small>Atendimentos</small><b>${c.visits_count}</b></div><div><small>Total gasto</small><b>${brl(c.total_spent)}</b></div><div><small>Favorito</small><b>${esc(c.favorite_service || "—")}</b></div></div>
      <div class="ui-detail">
        <span>Primeiro atendimento: ${c.first_visit_at ? fmtDate(c.first_visit_at, tz, { day: "2-digit", month: "2-digit", year: "numeric" }) : "—"}</span>
        <span>Último atendimento: ${c.last_visit_at ? fmtDate(c.last_visit_at, tz, { day: "2-digit", month: "2-digit", year: "numeric" }) : "—"}</span>
        <span>Faltas: ${c.no_show_count}</span>
        ${c.whatsapp ? `<span>WhatsApp: <a href="${waLink(c.whatsapp)}" target="_blank" rel="noopener" style="color:#7dd3fc">${fmtPhone(c.whatsapp)}</a></span>` : ""}
        ${c.notes ? `<span>Obs.: ${esc(c.notes)}</span>` : ""}
      </div>
      <h3 style="margin-top:10px">Histórico</h3><div class="history" id="hist"></div>
      <div class="ui-actions"><button type="button" class="ui-btn" id="editC">Editar dados</button><a class="ui-btn primary" href="/agendamentos/">Agendar</a></div>`, { wide: true });
    m.querySelector("#editC").onclick = () => edit(c);
    const box = m.querySelector("#hist");
    setState(box, "loading");
    const { data, error } = await supabase.from("appointments").select("id,starts_at,service_name,price,status").eq("barbershop_id", shop.id).eq("client_id", c.id).order("starts_at", { ascending: false }).limit(50);
    if (error) return setState(box, "error", errorMessage(error));
    box.innerHTML = data.length ? data.map(a => `<div class="history-item"><span>${fmtDate(a.starts_at, tz, { day: "2-digit", month: "2-digit", year: "2-digit" })} ${fmtTime(a.starts_at, tz)} • ${esc(a.service_name || "")} • ${brl(a.price)}</span><span class="status-pill ${a.status}">${STATUS[a.status]}</span></div>`).join("") : stateHTML("empty", "Sem histórico.");
  }

  function edit(c = null) {
    const m = openModal(`${modalHead(c ? "Editar cliente" : "Novo cliente", "Clientes")}
      <label class="ui-field">Nome<input id="cName" maxlength="80" value="${esc(c?.name || "")}" required></label>
      <div class="ui-grid2"><label class="ui-field">WhatsApp<input id="cWa" inputmode="tel" value="${esc(c?.whatsapp ? fmtPhone(c.whatsapp) : "")}"></label>
      <label class="ui-field">Telefone (opcional)<input id="cPhone" inputmode="tel" value="${esc(c?.phone || "")}"></label></div>
      <label class="ui-field">Observações<textarea id="cNotes" maxlength="500">${esc(c?.notes || "")}</textarea></label>
      <div class="ui-actions"><button type="button" class="ui-btn" data-close>Cancelar</button><button type="button" class="ui-btn primary" id="cSave">Salvar</button></div>`);
    maskPhoneInput(m.querySelector("#cWa"));
    m.querySelector("#cSave").onclick = e => withBusy(e.target, async () => {
      const row = { name: m.querySelector("#cName").value.trim(), whatsapp: m.querySelector("#cWa").value.trim() || null, phone: m.querySelector("#cPhone").value.trim() || null, notes: m.querySelector("#cNotes").value.trim() || null };
      if (row.name.length < 2) return toast("Informe o nome.", "error");
      if (row.whatsapp && !isValidPhone(row.whatsapp)) return toast("WhatsApp inválido.", "error");
      const res = c ? await supabase.from("clients").update(row).eq("id", c.id) : await supabase.from("clients").insert({ ...row, barbershop_id: shop.id });
      if (res.error) return notifyError(res.error, /unique|duplicate/.test(res.error.message) ? "Já existe um cliente com este WhatsApp." : undefined);
      closeModal(); toast("Cliente salvo.", "success"); load($("search").value.trim());
    });
  }

  $("addClient").onclick = () => edit();
  $("search").oninput = debounce(e => load(e.target.value.trim()), 350);
  load();
}
