import { supabase, SUPABASE_URL } from "/supabase-client.js";
import { esc, toast, openModal, closeModal, modalHead, withBusy, confirmDialog, setState, stateHTML, errorMessage, fmtPhone, debounce, maskPhoneInput } from "/js/ui.js";
import { registerServiceWorker } from "/js/pwa.js";
import { logout, loginUrl } from "/js/app.js";

registerServiceWorker();
const $ = id => document.getElementById(id);
const PLAN = { complete: "Completo", site: "Site", chatbot: "Chatbot" };
const STATUS = { active: "Ativa", demo: "Demo", suspended: "Suspensa", cancelled: "Cancelada" };
let shops = [];

const { data: { session } } = await supabase.auth.getSession();
if (!session) location.replace(loginUrl());
else {
  const { data: isAdmin, error } = await supabase.rpc("is_platform_admin");
  if (error || isAdmin !== true) {
    document.body.innerHTML = `<main class="ui-fullscreen"><div class="ui-fullscreen-card"><h1>Barber<span>SaaS</span></h1><h2>Acesso restrito</h2><p>Esta área é exclusiva do administrador da plataforma.</p><div class="ui-actions"><a class="ui-btn primary" href="/dashboard/">Ir para o painel</a></div></div></main>`;
  } else init();
}
supabase.auth.onAuthStateChange(ev => { if (ev === "SIGNED_OUT") location.replace("/login/"); });

function init() {
  $("logout").onclick = logout;
  $("newShop").onclick = () => edit();
  $("search").oninput = debounce(load, 350);
  $("fStatus").onchange = render; $("fPlan").onchange = render;
  load();
}

async function load() {
  setState($("shops"), "loading");
  const { data, error } = await supabase.rpc("admin_list_barbershops", { p_search: $("search").value.trim() || null });
  if (error) return setState($("shops"), "error", errorMessage(error), load);
  shops = data;
  const c = s => data.filter(x => x.status === s).length;
  $("stats").innerHTML = `<div class="stat"><small>Barbearias</small><b>${data.length}</b></div><div class="stat"><small>Ativas</small><b>${c("active")}</b></div>
    <div class="stat"><small>Demo</small><b>${c("demo")}</b></div><div class="stat"><small>Suspensas</small><b>${c("suspended")}</b></div>
    <div class="stat"><small>Agendamentos</small><b>${data.reduce((a, x) => a + Number(x.appointments_count), 0)}</b></div>`;
  render();
}

const fmtDT = v => v ? new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

function render() {
  const fs = $("fStatus").value, fp = $("fPlan").value;
  const list = shops.filter(s => (!fs || s.status === fs) && (!fp || s.plan === fp));
  if (!list.length) return ($("shops").innerHTML = stateHTML("empty", shops.length ? "Nenhuma barbearia com esses filtros." : "Nenhuma barbearia cadastrada."));
  $("shops").innerHTML = list.map(s => `<article class="shop">
    <div><b>${esc(s.name)}</b><span class="badge st-${s.status}">${STATUS[s.status]}</span><span class="badge pl">${PLAN[s.plan]}</span>
      <small>/${esc(s.slug)} · criada em ${fmtDT(s.created_at)}</small>
      <small>${esc(s.owner_name || "Sem responsável")}${s.owner_email ? " · " + esc(s.owner_email) : ""}${s.owner_user_id ? " ✓" : s.owner_email ? " (aguardando ativação)" : ""}</small></div>
    <div class="meta"><span>📱 ${s.whatsapp ? fmtPhone(s.whatsapp) : "—"}</span><span>📍 ${esc(s.address || "—")}</span>
      <span>👥 ${s.clients_count} clientes · 📅 ${s.appointments_count} agend. (${s.upcoming_count} futuros)</span><span>Último acesso: ${fmtDT(s.last_access_at)}</span></div>
    <div class="actions"><button class="ui-btn small" type="button" data-details="${s.id}">Detalhes</button><button class="ui-btn small" type="button" data-edit="${s.id}">Editar</button><button class="ui-btn small primary" type="button" data-support="${s.id}">Acessar painel</button></div></article>`).join("");
  $("shops").querySelectorAll("[data-edit]").forEach(b => b.onclick = () => edit(shops.find(s => s.id === b.dataset.edit)));
  $("shops").querySelectorAll("[data-details]").forEach(b => b.onclick = () => details(shops.find(s => s.id === b.dataset.details)));
  $("shops").querySelectorAll("[data-support]").forEach(b => b.onclick = () => support(shops.find(s => s.id === b.dataset.support), b));
}

async function support(s, btn) {
  await withBusy(btn, async () => {
    const { error } = await supabase.rpc("admin_start_support", { p_shop_id: s.id });
    if (error) return toast(errorMessage(error), "error");
    sessionStorage.setItem("barbersaas.supportShop", s.id);
    location.href = "/dashboard/";
  }, "Abrindo...");
}

async function callAdminUsers(body) {
  const { data: { session: ss } } = await supabase.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-users`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${ss?.access_token}` }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function invite(s) {
  try {
    const r = await callAdminUsers({ action: "invite_owner", shop_id: s.id });
    toast(r.mode === "reset" ? "Usuário já existia: enviamos um link para definir a senha." : `Convite enviado para ${s.owner_email}.`, "success", 5000);
  } catch (e) {
    toast(/Failed to fetch|404/.test(e.message) ? "Edge Function admin-users não publicada. Veja o relatório de configuração." : `Falha ao enviar convite (${e.message}).`, "error", 7000);
  }
}

async function details(s) {
  const m = openModal(`${modalHead(s.name, "Detalhes")}
    <div class="ui-detail"><span>Slug: <b>${esc(s.slug)}</b></span><span>Status: ${STATUS[s.status]} · Plano: ${PLAN[s.plan]}</span>
    <span>Responsável: ${esc(s.owner_name || "—")} ${s.owner_email ? "· " + esc(s.owner_email) : ""}</span><span>WhatsApp: ${s.whatsapp ? fmtPhone(s.whatsapp) : "—"}</span>
    <span>Endereço: ${esc(s.address || "—")}</span><span>Criada em: ${fmtDT(s.created_at)} · Último acesso: ${fmtDT(s.last_access_at)}</span>
    <span>${s.clients_count} clientes · ${s.appointments_count} agendamentos · ${s.upcoming_count} futuros</span>
    <span>Site: <a style="color:#7dd3fc" href="/link-agendamento/?barbearia=${encodeURIComponent(s.slug)}" target="_blank" rel="noopener">abrir</a> · Chatbot: <a style="color:#7dd3fc" href="/chatbot/?barbearia=${encodeURIComponent(s.slug)}" target="_blank" rel="noopener">abrir</a></span></div>
    <h3 style="font-size:15px;margin-top:8px">Usuários com acesso</h3><div class="members" id="mList"></div>
    <h3 style="font-size:15px;margin-top:14px">Alterar situação</h3>
    <div class="ui-actions" style="display:grid;grid-template-columns:repeat(2,1fr)">
      <button type="button" class="ui-btn" data-st="active">Ativar</button><button type="button" class="ui-btn" data-st="demo">Colocar em demo</button>
      <button type="button" class="ui-btn danger" data-st="suspended">Suspender</button><button type="button" class="ui-btn danger" data-st="cancelled">Cancelar</button></div>
    <div class="ui-actions">${s.owner_email ? '<button type="button" class="ui-btn" id="inviteBtn">Enviar convite / link de senha ao responsável</button>' : '<small class="ui-muted">Cadastre o e-mail do responsável (Editar) para enviar o convite de acesso.</small>'}</div>`, { wide: true });
  m.querySelectorAll("[data-st]").forEach(b => { if (b.dataset.st === s.status) b.disabled = true; b.onclick = () => setStatus(s, b.dataset.st); });
  m.querySelector("#inviteBtn")?.addEventListener("click", e => withBusy(e.target, () => invite(s), "Enviando..."));
  const box = m.querySelector("#mList");
  setState(box, "loading");
  const { data, error } = await supabase.rpc("admin_shop_members", { p_shop_id: s.id });
  if (error) return setState(box, "error", errorMessage(error));
  box.innerHTML = data.length ? data.map(u => `<div><span>${esc(u.email)} · ${u.role}${u.confirmed ? "" : " (não confirmado)"}</span><span>Último acesso: ${fmtDT(u.last_seen_at)} <button type="button" class="ui-btn small danger" data-rm="${u.user_id}">Remover</button></span></div>`).join("")
    : stateHTML("empty", s.owner_email ? "Aguardando o responsável aceitar o convite." : "Nenhum usuário vinculado.");
  box.querySelectorAll("[data-rm]").forEach(b => b.onclick = async () => {
    if (!(await confirmDialog({ title: "Remover acesso", message: "Este usuário perderá o acesso ao painel desta barbearia.", confirmText: "Remover", danger: true }))) return;
    const { error: e } = await supabase.rpc("admin_remove_member", { p_shop_id: s.id, p_user_id: b.dataset.rm });
    if (e) return toast(errorMessage(e), "error");
    toast("Acesso removido.", "success"); load();
  });
}

async function setStatus(s, status) {
  const danger = status === "suspended" || status === "cancelled";
  if (danger && !(await confirmDialog({ title: `${STATUS[status]} barbearia`, message: `${s.name} perderá o acesso ao painel e o agendamento público será desativado.`, confirmText: "Confirmar", danger: true }))) return;
  const { error } = await supabase.rpc("admin_update_barbershop", { p_id: s.id, p_patch: { status } });
  if (error) return toast(errorMessage(error), "error");
  closeModal(); toast(`Situação alterada para ${STATUS[status]}.`, "success"); load();
}

function edit(s = null) {
  const m = openModal(`${modalHead(s ? "Editar barbearia" : "Nova barbearia", "Plataforma")}
    <div class="ui-grid2"><label class="ui-field">Nome da barbearia<input id="eName" maxlength="80" value="${esc(s?.name || "")}"></label>
    <label class="ui-field">Slug (endereço)<input id="eSlug" maxlength="60" value="${esc(s?.slug || "")}" placeholder="gerado automaticamente"><small>Ex.: barbearia-vision → /link-agendamento/?barbearia=barbearia-vision</small></label></div>
    <div class="ui-grid2"><label class="ui-field">Responsável<input id="eOwner" maxlength="80" value="${esc(s?.owner_name || "")}"></label>
    <label class="ui-field">E-mail do responsável (login)<input id="eEmail" type="email" maxlength="120" value="${esc(s?.owner_email || "")}"></label></div>
    <div class="ui-grid2"><label class="ui-field">WhatsApp<input id="eWa" inputmode="tel" value="${esc(s?.whatsapp ? fmtPhone(s.whatsapp) : "")}"></label>
    <label class="ui-field">Endereço<input id="eAddr" maxlength="160" value="${esc(s?.address || "")}"></label></div>
    <div class="ui-grid2"><label class="ui-field">Plano<select id="ePlan">${Object.entries(PLAN).map(([k, v]) => `<option value="${k}" ${s?.plan === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
    <label class="ui-field">Situação<select id="eStatus">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${(s?.status || "active") === k ? "selected" : ""}>${v}</option>`).join("")}</select></label></div>
    ${s ? "" : '<label class="ui-check"><input type="checkbox" id="eInvite" checked> Enviar convite de acesso para o e-mail do responsável</label>'}
    <p class="ui-muted" style="font-size:12px">A barbearia é criada já com configurações, horário padrão (seg–sex 09–19 com almoço, sáb 09–17) e um profissional inicial.</p>
    <div class="ui-actions"><button type="button" class="ui-btn" data-close>Cancelar</button><button type="button" class="ui-btn primary" id="eSave">${s ? "Salvar" : "Criar barbearia"}</button></div>`, { wide: true });
  maskPhoneInput(m.querySelector("#eWa"));
  m.querySelector("#eSave").onclick = e => withBusy(e.target, async () => {
    const v = id => m.querySelector(id).value.trim();
    const email = v("#eEmail").toLowerCase();
    if (v("#eName").length < 2) return toast("Informe o nome.", "error");
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast("E-mail inválido.", "error");
    if (v("#eSlug") && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v("#eSlug"))) return toast("Slug: use apenas letras minúsculas, números e hífens.", "error");
    if (s) {
      const { error } = await supabase.rpc("admin_update_barbershop", { p_id: s.id, p_patch: { name: v("#eName"), slug: v("#eSlug") || s.slug, owner_name: v("#eOwner"), owner_email: email, whatsapp: v("#eWa"), address: v("#eAddr"), plan: v("#ePlan"), status: v("#eStatus") } });
      if (error) return toast(errorMessage(error), "error");
      closeModal(); toast("Barbearia atualizada.", "success"); load();
      return;
    }
    const { data, error } = await supabase.rpc("admin_create_barbershop", { p_name: v("#eName"), p_slug: v("#eSlug") || null, p_owner_name: v("#eOwner") || null, p_owner_email: email || null, p_whatsapp: v("#eWa") || null, p_address: v("#eAddr") || null, p_plan: v("#ePlan"), p_status: v("#eStatus") });
    if (error) return toast(errorMessage(error), "error");
    closeModal(); toast(`Barbearia criada: /${data.slug}`, "success", 5000);
    if (email && m.querySelector("#eInvite")?.checked && !data.owner_user_id) await invite(data);
    load();
  }, s ? "Salvando..." : "Criando...");
}
