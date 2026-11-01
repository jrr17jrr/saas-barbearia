import { initPanel, notifyError } from "/js/app.js";
import { esc, brl, setState, stateHTML, openModal, closeModal, modalHead, toast, withBusy, confirmDialog, errorMessage } from "/js/ui.js";
import { uploadShopImage } from "/js/upload.js";

const ctx = await initPanel({ active: "servicos" });
if (ctx) {
  const { supabase, shop } = ctx;
  const box = document.getElementById("services");
  let services = [], pros = [], links = [];

  async function load() {
    setState(box, "loading");
    const [s, p, l] = await Promise.all([
      supabase.from("services").select("*").eq("barbershop_id", shop.id).order("sort_order").order("name"),
      supabase.from("professionals").select("id,name,active").eq("barbershop_id", shop.id).order("sort_order"),
      supabase.from("professional_services").select("professional_id,service_id").eq("barbershop_id", shop.id),
    ]);
    if (s.error || p.error || l.error) return setState(box, "error", errorMessage(s.error || p.error || l.error), load);
    services = s.data; pros = p.data; links = l.data;
    if (!services.length) {
      box.innerHTML = stateHTML("empty", "Nenhum serviço cadastrado. Cadastre o primeiro para liberar agendamentos.");
      return;
    }
    box.innerHTML = services.map((x, i) => {
      const who = whoDoes(x.id);
      return `<div class="service ${x.active ? "" : "inactive"}"><div><b>${esc(x.name)}</b>
        <small class="${x.active ? "active-tag" : "inactive-tag"}">● ${x.active ? "Ativo" : "Inativo"}</small><small>${esc(who)}</small></div>
        <div><small>Preço</small><b>${brl(x.price)}</b></div><div><small>Duração</small><b>${x.duration_minutes} min</b></div>
        <div class="row-actions"><button type="button" data-edit="${i}">Editar</button><button type="button" data-toggle="${i}">${x.active ? "Desativar" : "Ativar"}</button></div></div>`;
    }).join("");
    box.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => edit(services[+b.dataset.edit]));
    box.querySelectorAll("[data-toggle]").forEach(b => b.onclick = () => toggle(services[+b.dataset.toggle], b));
  }

  // Profissional sem nenhum vínculo = realiza todos os serviços
  function proDoes(proId, serviceId) {
    const mine = links.filter(l => l.professional_id === proId);
    return !mine.length || mine.some(l => l.service_id === serviceId);
  }
  function whoDoes(serviceId) {
    const active = pros.filter(p => p.active);
    const doers = active.filter(p => proDoes(p.id, serviceId));
    if (!doers.length) return "⚠ Nenhum profissional realiza";
    return doers.length === active.length ? "Todos os profissionais" : doers.map(p => p.name).join(", ");
  }

  async function toggle(s, btn) {
    await withBusy(btn, async () => {
      const { error } = await supabase.from("services").update({ active: !s.active }).eq("id", s.id);
      if (error) return notifyError(error);
      toast(s.active ? "Serviço desativado." : "Serviço ativado.", "success"); load();
    }, "...");
  }

  function edit(s = null) {
    let imageUrl = s?.image_url || null;
    const m = openModal(`${modalHead(s ? "Editar serviço" : "Novo serviço", "Serviços")}
      <label class="ui-field">Nome<input id="n" maxlength="60" value="${esc(s?.name || "")}"></label>
      <label class="ui-field">Descrição<input id="desc" maxlength="160" value="${esc(s?.description || "")}"></label>
      <div class="ui-grid2"><label class="ui-field">Preço (R$)<input id="p" type="number" min="0" step="0.01" inputmode="decimal" value="${s?.price ?? ""}"></label>
      <label class="ui-field">Duração (min)<input id="d" type="number" min="5" max="600" step="5" inputmode="numeric" value="${s?.duration_minutes ?? 30}"></label></div>
      <div class="ui-grid2"><label class="ui-field">Ordem de exibição<input id="o" type="number" step="1" value="${s?.sort_order ?? services.length + 1}"></label>
      <label class="ui-field">Imagem (opcional)<input id="img" type="file" accept="image/png,image/jpeg,image/webp"></label></div>
      <label class="ui-check"><input type="checkbox" id="act" ${s?.active === false ? "" : "checked"}> Serviço ativo</label>
      <p class="ui-muted" style="margin-top:8px">Profissionais que realizam:</p>
      <div class="pros-check">${pros.map(p => `<label class="ui-check"><input type="checkbox" data-pro="${p.id}" ${!s || proDoes(p.id, s.id) ? "checked" : ""}> ${esc(p.name)}${p.active ? "" : " (inativo)"}</label>`).join("") || '<small class="ui-muted">Cadastre profissionais em Profissionais.</small>'}</div>
      <div class="ui-actions">${s ? '<button type="button" class="ui-btn danger" id="del">Excluir</button>' : ""}<button type="button" class="ui-btn" data-close>Cancelar</button><button type="button" class="ui-btn primary" id="save">Salvar</button></div>`);
    m.querySelector("#img").onchange = async e => {
      try { imageUrl = await uploadShopImage(shop.id, e.target.files[0], "service"); toast("Imagem enviada.", "success"); }
      catch (err) { notifyError(err, err.message); e.target.value = ""; }
    };
    m.querySelector("#save").onclick = e => withBusy(e.target, async () => {
      const row = {
        name: m.querySelector("#n").value.trim(), description: m.querySelector("#desc").value.trim() || null,
        price: Number(m.querySelector("#p").value), duration_minutes: parseInt(m.querySelector("#d").value, 10),
        sort_order: parseInt(m.querySelector("#o").value, 10) || 0, active: m.querySelector("#act").checked, image_url: imageUrl,
      };
      if (row.name.length < 2) return toast("Informe o nome do serviço.", "error");
      if (!(row.price >= 0)) return toast("Preço inválido.", "error");
      if (!(row.duration_minutes >= 5 && row.duration_minutes <= 600)) return toast("Duração deve ser entre 5 e 600 minutos.", "error");
      const res = s ? await supabase.from("services").update(row).eq("id", s.id).select().single()
        : await supabase.from("services").insert({ ...row, barbershop_id: shop.id }).select().single();
      if (res.error) return notifyError(res.error);
      // vínculos profissional ↔ serviço
      const sid = res.data.id;
      for (const cb of m.querySelectorAll("[data-pro]")) {
        const pid = cb.dataset.pro, mine = links.filter(l => l.professional_id === pid);
        const doesNow = !mine.length || mine.some(l => l.service_id === sid);
        if (cb.checked === doesNow) continue;
        if (!cb.checked) {
          // passa a ter lista explícita: todos os serviços atuais menos este
          const rows = (mine.length ? mine.map(l => l.service_id) : services.map(x => x.id)).filter(id => id !== sid)
            .map(id => ({ professional_id: pid, service_id: id, barbershop_id: shop.id }));
          if (!mine.length && rows.length) { const r = await supabase.from("professional_services").insert(rows); if (r.error) return notifyError(r.error); }
          else { const r = await supabase.from("professional_services").delete().eq("professional_id", pid).eq("service_id", sid); if (r.error) return notifyError(r.error); }
          if (!rows.length) toast(`Atenção: ${pros.find(p => p.id === pid)?.name} ficou sem serviços e passará a realizar todos.`, "info", 5000);
        } else {
          const r = await supabase.from("professional_services").insert({ professional_id: pid, service_id: sid, barbershop_id: shop.id });
          if (r.error) return notifyError(r.error);
        }
      }
      closeModal(); toast("Serviço salvo.", "success"); load();
    });
    m.querySelector("#del")?.addEventListener("click", async () => {
      const ok = await confirmDialog({ title: "Excluir serviço", message: `Excluir "${s.name}"? Serviços com histórico de agendamentos não podem ser excluídos — nesse caso, desative.`, confirmText: "Excluir", danger: true });
      if (!ok) return;
      const { error } = await supabase.from("services").delete().eq("id", s.id);
      if (error) return notifyError(error);
      toast("Serviço excluído.", "success"); load();
    });
  }

  document.getElementById("add").onclick = () => edit();
  load();
}
