import { initPanel, notifyError } from "/js/app.js";
import { esc, toast, withBusy, fmtPhone, maskPhoneInput, isValidPhone, confirmDialog } from "/js/ui.js";
import { currentPushState, enablePush, disablePush, sendTestPush, getPrefs, savePrefs, cleanupPushOnLogout } from "/js/push.js";
import { onInstallAvailable, promptInstall, isStandalone, isIOS } from "/js/pwa.js";

const ctx = await initPanel({ active: "config" });
if (ctx) main(ctx);

async function main({ supabase, shop, user }) {
  const $ = id => document.getElementById(id);
  const PLAN = { chatbot: "Chatbot", site: "Site", complete: "Completo" };
  const STATUS = { active: "Ativa", demo: "Demonstração", suspended: "Suspensa", cancelled: "Cancelada" };
  $("accEmail").textContent = user.email;

  // ------------------------------------------------ dados da barbearia
  const [{ data: b, error: be }, { data: st }] = await Promise.all([
    supabase.from("barbershops").select("name,whatsapp,email,address,plan,status,slug").eq("id", shop.id).single(),
    supabase.from("barbershop_settings").select("reminder_minutes").eq("barbershop_id", shop.id).single(),
  ]);
  if (be) notifyError(be);
  if (b) {
    $("fName").value = b.name || ""; $("fWhats").value = b.whatsapp ? fmtPhone(b.whatsapp) : ""; $("fEmail").value = b.email || ""; $("fAddress").value = b.address || "";
  }
  maskPhoneInput($("fWhats"));
  $("saveShop").onclick = e => withBusy(e.target, async () => {
    const name = $("fName").value.trim(), wa = $("fWhats").value.trim(), email = $("fEmail").value.trim();
    if (name.length < 2) return toast("Informe o nome.", "error");
    if (wa && !isValidPhone(wa)) return toast("WhatsApp inválido.", "error");
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast("E-mail inválido.", "error");
    const { error } = await supabase.from("barbershops").update({ name, whatsapp: wa ? wa.replace(/\D/g, "").replace(/^(?!55)(\d{10,11})$/, "55$1") : null, email: email || null, address: $("fAddress").value.trim() || null }).eq("id", shop.id);
    if (error) return notifyError(error);
    toast("Dados salvos.", "success");
  });

  // ------------------------------------------------ plano e links
  const plan = b?.plan || shop.plan;
  $("planInfo").innerHTML = `<span>Plano atual: <span class="badge">${PLAN[plan]}</span></span>
    <span>Situação: <span class="badge ${b?.status === "active" ? "ok" : b?.status === "demo" ? "warn" : "off"}">${STATUS[b?.status || shop.status]}</span></span>
    <span>Site e agendamento público: <span class="badge ${shop.features.site ? "ok" : "off"}">${shop.features.site ? "Incluso" : "Não incluso"}</span></span>
    <span>Chatbot: <span class="badge ${shop.features.chatbot ? "ok" : "off"}">${shop.features.chatbot ? "Incluso" : "Não incluso"}</span></span>
    <span class="hint">Para alterar o plano, fale com a <a href="https://visionariodev.com.br" target="_blank" rel="noopener" style="color:#7dd3fc">Visionário Dev</a>.</span>`;
  const links = [];
  if (shop.features.site) links.push(["Link de agendamento", `${location.origin}/link-agendamento/?barbearia=${encodeURIComponent(shop.slug)}`]);
  if (shop.features.chatbot) links.push(["Link do chatbot", `${location.origin}/chatbot/?barbearia=${encodeURIComponent(shop.slug)}`]);
  $("links").innerHTML = links.map(([l, u], i) => `<small class="hint">${l}</small><div class="linkrow"><code>${esc(u)}</code><button type="button" class="ui-btn small" data-copy="${i}">Copiar</button><a class="ui-btn small" href="${esc(u)}" target="_blank" rel="noopener">Abrir</a></div>`).join("");
  $("links").querySelectorAll("[data-copy]").forEach(btn => btn.onclick = async () => {
    const u = links[+btn.dataset.copy][1];
    try { await navigator.clipboard.writeText(u); toast("Link copiado!", "success"); } catch { toast(u, "info", 8000); }
  });

  // ------------------------------------------------ notificações push
  async function renderPush() {
    const st = await currentPushState(shop.id).catch(() => ({ state: "error" }));
    const map = {
      enabled: ['<span class="badge ok">Notificações ativadas</span><span class="badge">Dispositivo registrado</span>', ""],
      default: ['<span class="badge warn">Notificações desativadas</span>', "Toque em “Ativar notificações” e permita quando o navegador perguntar."],
      granted_no_sub: ['<span class="badge warn">Permitido, mas aparelho não registrado</span>', "Toque em “Ativar notificações” para registrar este aparelho."],
      denied: ['<span class="badge off">Permissão negada</span>', isIOS() ? "Abra Ajustes → Notificações → BarberSaaS e permita as notificações." : "Libere as notificações nas configurações do site no navegador (ícone de cadeado ao lado do endereço) e recarregue."],
      unsupported: ['<span class="badge off">Não suportado</span>', st.message || "Este navegador não suporta notificações push."],
      error: ['<span class="badge off">Erro ao verificar</span>', st.message || "Tente novamente em instantes."],
    };
    const [html, hint] = map[st.state] || map.error;
    $("pushState").innerHTML = html;
    let extra = "";
    if (st.device?.last_error && st.device.failure_count > 0) extra = ` Último erro de entrega registrado; envie um teste para verificar.`;
    $("pushHint").textContent = (hint + extra).trim();
    $("pushEnable").hidden = st.state === "enabled" || st.state === "unsupported";
    $("pushTest").hidden = st.state !== "enabled";
    $("pushDisable").hidden = st.state !== "enabled";
    if (shop.support_mode) { $("pushEnable").hidden = true; $("pushHint").textContent = "Em modo suporte, as notificações não são ativadas para o administrador."; }
  }
  $("pushEnable").onclick = e => withBusy(e.target, async () => {
    try { await enablePush(shop.id); toast("Notificações ativadas neste aparelho.", "success"); }
    catch (err) {
      const msg = err.code === "denied" ? "Permissão não concedida." : err.code === "vapid_not_configured" ? "As notificações ainda não foram configuradas no servidor (chaves VAPID). Fale com o suporte." : err.message || "Não foi possível ativar.";
      toast(msg, "error", 6000);
    }
    renderPush();
  }, "Ativando...");
  $("pushTest").onclick = e => withBusy(e.target, async () => {
    try {
      const r = await sendTestPush(shop.id);
      if (r.queued) toast("Teste enviado para a fila. Deve chegar em instantes.", "success");
      else if (r.sent > 0) toast(`Notificação enviada para ${r.sent} de ${r.devices} aparelho(s).`, "success");
      else toast("Nenhum aparelho recebeu. A inscrição pode ter expirado — ative novamente.", "error", 6000);
    } catch (err) {
      toast({ NO_DEVICE: "Ative as notificações neste aparelho primeiro.", RATE_LIMIT: "Muitos testes seguidos. Aguarde alguns minutos.", vapid_not_configured: "Chaves VAPID não configuradas no servidor." }[err.code] || "Falha ao enviar o teste.", "error", 6000);
    }
    renderPush();
  }, "Enviando...");
  $("pushDisable").onclick = async () => {
    if (!(await confirmDialog({ title: "Desativar notificações", message: "Este aparelho deixará de receber notificações.", confirmText: "Desativar" }))) return;
    await disablePush().catch(err => notifyError(err));
    toast("Notificações desativadas neste aparelho.", "success"); renderPush();
  };
  try {
    const prefs = await getPrefs(shop.id, user.id);
    document.querySelectorAll("[data-pref]").forEach(cb => {
      cb.checked = prefs[cb.dataset.pref] !== false;
      cb.onchange = async () => {
        const next = Object.fromEntries([...document.querySelectorAll("[data-pref]")].map(x => [x.dataset.pref, x.checked]));
        try { await savePrefs(shop.id, user.id, next); toast("Preferência salva.", "success", 1500); } catch (err) { cb.checked = !cb.checked; notifyError(err); }
      };
    });
  } catch (err) { if (!shop.support_mode) notifyError(err); document.querySelectorAll("[data-pref]").forEach(cb => (cb.disabled = !!shop.support_mode)); }
  $("reminderMin").value = String(st?.reminder_minutes || 30);
  $("reminderMin").onchange = async () => {
    const { error } = await supabase.from("barbershop_settings").update({ reminder_minutes: +$("reminderMin").value }).eq("barbershop_id", shop.id);
    if (error) return notifyError(error);
    toast("Antecedência do lembrete salva.", "success", 1500);
  };
  renderPush();

  // ------------------------------------------------ instalação PWA
  if (isStandalone()) $("installHint").textContent = "✓ Você está usando o aplicativo instalado.";
  else if (isIOS()) $("installHint").innerHTML = "No iPhone/iPad: abra este site no <b>Safari</b>, toque em <b>Compartilhar</b> e depois em <b>“Adicionar à Tela de Início”</b>. Depois abra pelo ícone para usar como app e ativar notificações.";
  onInstallAvailable(available => { $("installBtn").hidden = !available; });
  $("installBtn").onclick = async () => { if (await promptInstall()) toast("Aplicativo instalado!", "success"); };

  // ------------------------------------------------ conta
  $("savePw").onclick = e => withBusy(e.target, async () => {
    const p1 = $("newPw").value, p2 = $("newPw2").value;
    if (p1.length < 8) return toast("Use pelo menos 8 caracteres.", "error");
    if (p1 !== p2) return toast("As senhas não conferem.", "error");
    const { error } = await supabase.auth.updateUser({ password: p1 });
    if (error) return toast(/same/i.test(error.message) ? "A nova senha deve ser diferente da atual." : /reauth|recent/i.test(error.message) ? "Por segurança, saia e entre novamente antes de trocar a senha." : "Não foi possível alterar a senha.", "error", 6000);
    $("newPw").value = $("newPw2").value = "";
    toast("Senha alterada.", "success");
  });
  $("logoutAll").onclick = async () => {
    if (!(await confirmDialog({ title: "Sair de todos os dispositivos", message: "Todas as sessões (celulares, computadores e o app instalado) serão encerradas.", confirmText: "Sair de todos", danger: true }))) return;
    await cleanupPushOnLogout();
    const { error } = await supabase.auth.signOut({ scope: "global" });
    if (error) return notifyError(error);
    location.replace("/login/");
  };
}
