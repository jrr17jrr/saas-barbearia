import { initPanel, notifyError } from "/js/app.js";
import { esc, setState, stateHTML, openModal, closeModal, modalHead, toast, withBusy, fmtPhone, maskPhoneInput, isValidPhone, errorMessage, WEEKDAYS, safeUrl } from "/js/ui.js";
import { uploadShopImage } from "/js/upload.js";

const ctx = await initPanel({ active: "profissionais" });
if (ctx) {
  const { supabase, shop } = ctx;
  const box = document.getElementById("pros");
  let pros = [], services = [], links = [], phours = [];

  async function load() {
    setState(box, "loading");
    const [p, s, l, h] = await Promise.all([
      supabase.from("professionals").select("*").eq("barbershop_id", shop.id).order("sort_order").order("name"),
      supabase.from("services").select("id,name,active").eq("barbershop_id", shop.id).order("sort_order"),
      supabase.from("professional_services").select("*").eq("barbershop_id", shop.id),
      supabase.from("professional_hours").select("*").eq("barbershop_id", shop.id),
    ]);
    if (p.error || s.error || l.error || h.error) return setState(box, "error", errorMessage(p.error || s.error || l.error || h.error), load);
    pros = p.data; services = s.data; links = l.data; phours = h.data;
    if (!pros.length) { box.innerHTML = stateHTML("empty", "Nenhum profissional. Cadastre ao menos um para receber agendamentos."); return; }
    box.innerHTML = pros.map((x, i) => {
      const mine = links.filter(k => k.professional_id === x.id);
      const svc = mine.length ? services.filter(s => mine.some(k => k.service_id === s.id)).map(s => s.name).join(", ") : "Todos os serviços";
      const photo = safeUrl(x.photo_url);
      return `<div class="pro ${x.active ? "" : "inactive"}">${photo ? `<img src="${esc(photo)}" alt="">` : `<div class="ph" aria-hidden="true">${esc(x.name.charAt(0).toUpperCase())}</div>`}
        <div><b>${esc(x.name)}</b> ${x.active ? "" : '<small style="display:inline;color:#fca5a5">· inativo</small>'}
        <small>${esc(x.specialty || "")}${x.phone ? " · " + fmtPhone(x.phone) : ""}</small><small>${esc(svc)}</small>
        <small>${phours.some(h => h.professional_id === x.id) ? "Horário individual configurado" : "Segue o horário da barbearia"}${x.user_id ? " · possui login" : ""}</small></div>
        <div class="row-actions"><button type="button" data-edit="${i}">Editar</button><button type="button" data-hours="${i}">Horários</button><button type="button" data-toggle="${i}">${x.active ? "Desativar" : "Ativar"}</button></div></div>`;
    }).join("");
    box.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => edit(pros[+b.dataset.edit]));
    box.querySelectorAll("[data-hours]").forEach(b => b.onclick = () => hoursForm(pros[+b.dataset.hours]));
    box.querySelectorAll("[data-toggle]").forEach(b => b.onclick = () => toggle(pros[+b.dataset.toggle], b));
  }

  async function toggle(p, btn) {
    if (p.active && pros.filter(x => x.active).length === 1) return toast("Mantenha pelo menos um profissional ativo.", "error");
    if (p.active) {
      const { count } = await supabase.from("appointments").select("id", { count: "exact", head: true }).eq("professional_id", p.id).eq("status", "confirmed").gte("starts_at", new Date().toISOString());
      if (count) toast(`${p.name} tem ${count} agendamento(s) futuro(s). Eles continuam na agenda; remarque se necessário.`, "info", 6000);
    }
    await withBusy(btn, async () => {
      const { error } = await supabase.from("professionals").update({ active: !p.active }).eq("id", p.id);
      if (error) return notifyError(error);
      toast(p.active ? "Profissional desativado." : "Profissional ativado.", "success"); load();
    }, "...");
  }

  function edit(p = null) {
    let photoUrl = p?.photo_url || null;
    const mine = p ? links.filter(k => k.professional_id === p.id) : [];
    const does = sid => !p || !mine.length || mine.some(k => k.service_id === sid);
    const m = openModal(`${modalHead(p ? "Editar profissional" : "Novo profissional", "Profissionais")}
      <label class="ui-field">Nome<input id="n" maxlength="60" value="${esc(p?.name || "")}"></label>
      <div class="ui-grid2"><label class="ui-field">Telefone<input id="ph" inputmode="tel" value="${esc(p?.phone ? fmtPhone(p.phone) : "")}"></label>
      <label class="ui-field">Especialidade<input id="sp" maxlength="60" value="${esc(p?.specialty || "")}" placeholder="Ex.: Degradê, barba"></label></div>
      <div class="ui-grid2"><label class="ui-field">Foto<input id="photo" type="file" accept="image/png,image/jpeg,image/webp"></label>
      <label class="ui-field">Ordem<input id="o" type="number" value="${p?.sort_order ?? pros.length}"></label></div>
      <label class="ui-check"><input type="checkbox" id="act" ${p?.active === false ? "" : "checked"}> Ativo (aparece para clientes)</label>
      <p class="ui-muted" style="margin-top:8px">Serviços que realiza:</p>
      <div class="box">${services.map(s => `<label class="ui-check"><input type="checkbox" data-svc="${s.id}" ${does(s.id) ? "checked" : ""}> ${esc(s.name)}${s.active ? "" : " (inativo)"}</label>`).join("") || '<small class="ui-muted">Nenhum serviço cadastrado.</small>'}</div>
      <div class="ui-actions"><button type="button" class="ui-btn" data-close>Cancelar</button><button type="button" class="ui-btn primary" id="save">Salvar</button></div>`);
    maskPhoneInput(m.querySelector("#ph"));
    m.querySelector("#photo").onchange = async e => {
      try { photoUrl = await uploadShopImage(shop.id, e.target.files[0], "pro"); toast("Foto enviada.", "success"); }
      catch (err) { notifyError(err, err.message); e.target.value = ""; }
    };
    m.querySelector("#save").onclick = e => withBusy(e.target, async () => {
      const row = { name: m.querySelector("#n").value.trim(), phone: m.querySelector("#ph").value.replace(/\D/g, "") || null, specialty: m.querySelector("#sp").value.trim() || null,
        sort_order: parseInt(m.querySelector("#o").value, 10) || 0, active: m.querySelector("#act").checked, photo_url: photoUrl };
      if (row.name.length < 2) return toast("Informe o nome.", "error");
      if (row.phone && !isValidPhone(row.phone)) return toast("Telefone inválido.", "error");
      if (p && p.active && !row.active && pros.filter(x => x.active).length === 1) return toast("Mantenha pelo menos um profissional ativo.", "error");
      const res = p ? await supabase.from("professionals").update(row).eq("id", p.id).select().single()
        : await supabase.from("professionals").insert({ ...row, barbershop_id: shop.id }).select().single();
      if (res.error) return notifyError(res.error);
      const pid = res.data.id;
      const checked = [...m.querySelectorAll("[data-svc]")].filter(c => c.checked).map(c => c.dataset.svc);
      // todos marcados = sem restrição (realiza qualquer serviço, inclusive novos)
      const del = await supabase.from("professional_services").delete().eq("professional_id", pid);
      if (del.error) return notifyError(del.error);
      if (checked.length && checked.length < services.length) {
        const ins = await supabase.from("professional_services").insert(checked.map(sid => ({ professional_id: pid, service_id: sid, barbershop_id: shop.id })));
        if (ins.error) return notifyError(ins.error);
      }
      if (!checked.length) toast("Nenhum serviço marcado: o profissional realizará todos os serviços.", "info", 5000);
      closeModal(); toast("Profissional salvo.", "success"); load();
    });
  }

  function hoursForm(p) {
    const mine = phours.filter(h => h.professional_id === p.id);
    const order = [1, 2, 3, 4, 5, 6, 0];
    const m = openModal(`${modalHead("Horário de " + p.name, "Horário individual")}
      <p class="ui-muted">“Igual à barbearia” usa o expediente geral. Escolha “Personalizado” para um horário diferente ou “Folga” para o dia em que não atende.</p>
      <div class="box">${order.map(d => {
        const h = mine.find(x => x.weekday === d);
        const mode = !h ? "shop" : h.is_working ? "custom" : "off";
        return `<div class="hrow" data-day="${d}"><b>${WEEKDAYS[d]}</b><div class="times">
          <select data-mode aria-label="Modo ${WEEKDAYS[d]}"><option value="shop" ${mode === "shop" ? "selected" : ""}>Igual à barbearia</option><option value="custom" ${mode === "custom" ? "selected" : ""}>Personalizado</option><option value="off" ${mode === "off" ? "selected" : ""}>Folga</option></select>
          <span data-custom ${mode === "custom" ? "" : "hidden"}><input type="time" data-open value="${h?.opens_at?.slice(0, 5) || "09:00"}" aria-label="Início"> até <input type="time" data-close value="${h?.closes_at?.slice(0, 5) || "18:00"}" aria-label="Fim">
          <br><small class="ui-muted">Intervalo:</small> <input type="time" data-bs value="${h?.break_start?.slice(0, 5) || ""}" aria-label="Início do intervalo"> – <input type="time" data-be value="${h?.break_end?.slice(0, 5) || ""}" aria-label="Fim do intervalo"></span></div></div>`;
      }).join("")}</div>
      <div class="ui-actions"><button type="button" class="ui-btn" data-close>Cancelar</button><button type="button" class="ui-btn primary" id="saveH">Salvar horários</button></div>`, { wide: true });
    m.querySelectorAll("[data-mode]").forEach(s => s.onchange = () => { s.parentElement.querySelector("[data-custom]").hidden = s.value !== "custom"; });
    m.querySelector("#saveH").onclick = e => withBusy(e.target, async () => {
      const rows = [];
      for (const r of m.querySelectorAll(".hrow")) {
        const mode = r.querySelector("[data-mode]").value, d = +r.dataset.day;
        if (mode === "shop") continue;
        if (mode === "off") { rows.push({ professional_id: p.id, barbershop_id: shop.id, weekday: d, is_working: false }); continue; }
        const o = r.querySelector("[data-open]").value, c = r.querySelector("[data-close]").value, bs = r.querySelector("[data-bs]").value || null, be = r.querySelector("[data-be]").value || null;
        if (!o || !c || o >= c) return toast(`${WEEKDAYS[d]}: horário inválido.`, "error");
        if ((bs && !be) || (!bs && be) || (bs && be && bs >= be)) return toast(`${WEEKDAYS[d]}: intervalo inválido.`, "error");
        rows.push({ professional_id: p.id, barbershop_id: shop.id, weekday: d, is_working: true, opens_at: o, closes_at: c, break_start: bs, break_end: be });
      }
      const del = await supabase.from("professional_hours").delete().eq("professional_id", p.id);
      if (del.error) return notifyError(del.error);
      if (rows.length) { const ins = await supabase.from("professional_hours").insert(rows); if (ins.error) return notifyError(ins.error); }
      closeModal(); toast("Horários salvos.", "success"); load();
    });
  }

  document.getElementById("add").onclick = () => edit();
  load();
}
