// Motor do chatbot de agendamento. Usa a MESMA disponibilidade/reserva do site (RPCs do banco).
import { esc, brl, fmtTime, fmtDate, WEEKDAYS_SHORT, weekday, isValidPhone, normalizePhone, fmtPhone, errorMessage } from "/js/ui.js";
import { getSlots, book, prosForService, upcomingDays } from "/js/public-api.js";

export function createChatbot({ data, slug, msgs, opts, bar, input, send, typing = true }) {
  const tz = data.shop.timezone || "America/Sao_Paulo";
  const bot = data.chatbot || {};
  let state = {}, busy = false;
  const wait = ms => new Promise(r => setTimeout(r, typing ? ms : 0));
  const scroll = () => { msgs.scrollTop = msgs.scrollHeight; };

  function say(html, user = false) {
    const d = document.createElement("div");
    d.className = "msg " + (user ? "user" : "");
    d.innerHTML = html;
    msgs.appendChild(d); scroll();
  }
  async function botSay(html, delay = 550) {
    const t = document.createElement("div");
    t.className = "msg typing"; t.setAttribute("aria-label", "digitando"); t.innerHTML = "<i></i><i></i><i></i>";
    msgs.appendChild(t); scroll();
    await wait(delay); t.remove(); say(html);
  }
  function ask(placeholder, type, cb) {
    opts.innerHTML = ""; bar.classList.remove("hidden");
    input.placeholder = placeholder; input.value = ""; input.type = "text";
    input.inputMode = type === "tel" ? "tel" : "text";
    input.autocomplete = type === "tel" ? "tel" : "name";
    setTimeout(() => input.focus(), 50);
    const go = () => { const v = input.value.trim(); if (!v) return; say(esc(v), true); bar.classList.add("hidden"); cb(v); };
    send.onclick = go;
    input.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); go(); } };
  }
  function choose(items, cb, { columns } = {}) {
    bar.classList.add("hidden");
    opts.style.gridTemplateColumns = columns || "";
    opts.innerHTML = items.map((x, i) => `<button type="button" data-i="${i}">${x.label}</button>`).join("");
    opts.querySelectorAll("button").forEach(b => b.onclick = () => {
      if (busy) return;
      const x = items[+b.dataset.i];
      say(x.userLabel || x.label, true); opts.innerHTML = ""; cb(x.value);
    });
    opts.querySelector("button")?.focus({ preventScroll: true });
  }

  async function start() {
    msgs.innerHTML = ""; opts.innerHTML = ""; state = {};
    if (!data.services.length) return botSay("No momento não há serviços disponíveis para agendamento online. Entre em contato com a barbearia.", 300);
    await botSay(esc(bot.greeting || "Olá! Vou te ajudar a agendar seu horário."), 400);
    await botSay("Qual é o seu nome?", 500);
    askName();
  }
  function askName() {
    ask("Digite seu nome", "text", async v => {
      if (v.length < 2 || v.length > 80 || /[<>{}]/.test(v)) { await botSay("Pode me dizer seu nome completo, por favor?"); return askName(); }
      state.name = v.replace(/\s+/g, " ");
      await botSay(`Prazer, ${esc(state.name.split(" ")[0])}! Qual é o seu WhatsApp com DDD?`, 600);
      askPhone();
    });
  }
  function askPhone() {
    ask("(21) 99999-9999", "tel", async v => {
      if (!isValidPhone(v)) { await botSay("Esse número parece incompleto. Envie o WhatsApp com DDD, por exemplo (21) 99999-9999."); return askPhone(); }
      state.phone = normalizePhone(v);
      serviceStep();
    });
  }
  async function serviceStep() {
    await botSay("Qual serviço você quer agendar?", 550);
    choose(data.services.map(s => ({ label: `${esc(s.name)} — ${brl(s.price)} · ${s.duration_minutes} min`, value: s })), s => { state.service = s; proStep(); });
  }
  async function proStep() {
    const pros = prosForService(data, state.service.id);
    if (!pros.length) { await botSay("No momento nenhum profissional realiza esse serviço online. Escolha outro serviço."); return serviceStep(); }
    if (pros.length === 1) { state.pro = pros[0]; return dateStep(); }
    await botSay("Tem preferência de profissional?", 500);
    choose([{ label: "Sem preferência", value: null }, ...pros.map(p => ({ label: esc(p.name) + (p.specialty ? ` · <small>${esc(p.specialty)}</small>` : ""), userLabel: esc(p.name), value: p }))], p => { state.pro = p; dateStep(); });
  }
  async function dateStep() {
    await botSay("Escolha o melhor dia.", 500);
    const days = upcomingDays(data, 10);
    if (!days.length) return botSay("Não há dias disponíveis para agendamento no momento.");
    choose(days.map(d => ({ label: `${d.today ? "Hoje" : d.tomorrow ? "Amanhã" : WEEKDAYS_SHORT[weekday(d.key)]} · ${d.key.slice(8)}/${d.key.slice(5, 7)}`, value: d })), d => { state.date = d; timeStep(); });
  }
  async function timeStep() {
    await botSay("Verificando horários livres...", 300);
    let slots;
    try { slots = await getSlots(slug, state.service.id, state.date.key, state.pro?.id, "chatbot"); }
    catch (e) { await botSay(esc(errorMessage(e))); return choose([{ label: "Tentar novamente", value: 1 }], timeStep); }
    if (!slots.length) {
      await botSay("Esse dia não tem horários livres para esse serviço. Vamos escolher outro dia?", 500);
      return dateStep();
    }
    await botSay("Qual horário fica melhor?", 300);
    choose([...slots.slice(0, 24).map(s => ({ label: fmtTime(s.starts_at, tz), value: s })), { label: "↩ Outro dia", value: "back" }],
      s => { if (s === "back") return dateStep(); state.slot = s; review(); }, { columns: "repeat(3,1fr)" });
  }
  async function review() {
    const proName = state.pro?.name || data.professionals.find(p => p.id === state.slot.professional_id)?.name || "";
    await botSay(`<b>Confira seu agendamento</b><br>${esc(state.service.name)} · ${brl(state.service.price)}<br>${fmtDate(state.slot.starts_at, tz, { weekday: "long", day: "2-digit", month: "2-digit" })} às ${fmtTime(state.slot.starts_at, tz)}${proName ? `<br>com ${esc(proName)}` : ""}<br>${esc(state.name)} · ${fmtPhone(state.phone)}`, 650);
    choose([{ label: "✓ Confirmar agendamento", value: 1 }, { label: "Alterar horário", value: 2 }, { label: "Recomeçar", value: 0 }], async v => {
      if (v === 2) return timeStep();
      if (!v) return start();
      busy = true;
      await botSay("Confirmando...", 200);
      try {
        const r = await book({ slug, serviceId: state.service.id, startsAt: state.slot.starts_at, name: state.name, whatsapp: state.phone, professionalId: state.pro?.id || state.slot.professional_id, channel: "chatbot" });
        await botSay(`Tudo certo! ✅ Agendamento confirmado.<br><b>${esc(r.service_name)}</b><br>${fmtDate(r.starts_at, tz, { weekday: "long", day: "2-digit", month: "2-digit" })} às ${fmtTime(r.starts_at, tz)}${r.professional_name ? ` com ${esc(r.professional_name)}` : ""}`, 500);
        await botSay("Se precisar remarcar ou cancelar, fale com a barbearia pelo WhatsApp. Até logo! 👋", 500);
        opts.innerHTML = '<button type="button" id="chatAgain">Fazer outro agendamento</button>';
        opts.querySelector("#chatAgain").onclick = start;
      } catch (e) {
        const msg = String(e?.message || "");
        await botSay(esc(errorMessage(e)), 400);
        if (msg.includes("SLOT_UNAVAILABLE")) timeStep();
        else choose([{ label: "Tentar novamente", value: 1 }, { label: "Recomeçar", value: 0 }], v2 => (v2 ? review() : start()));
      } finally { busy = false; }
    });
  }
  return { start };
}
