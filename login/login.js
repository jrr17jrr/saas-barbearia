import { supabase } from "/supabase-client.js";
import { registerServiceWorker } from "/js/pwa.js";

registerServiceWorker();
const $ = id => document.getElementById(id);
const form = $("form"), msg = $("msg"), submit = $("submit");
let mode = "login";

function safeNext() {
  const n = new URLSearchParams(location.search).get("next") || "";
  // apenas caminhos internos (evita open redirect)
  return /^\/(?!\/)[^\s]*$/.test(n) && !n.startsWith("/login") ? n : null;
}
function say(text, ok = false) { msg.textContent = text; msg.className = "msg" + (ok ? " ok" : ""); }

async function goAfterLogin() {
  const next = safeNext();
  if (next) return location.replace(next);
  const { data } = await supabase.rpc("my_context");
  if (data?.is_platform_admin && !data.shops?.length) return location.replace("/dev/");
  location.replace("/dashboard/");
}

// Já logado? (sessão persistida) → segue direto
const { data: { session } } = await supabase.auth.getSession();
if (session) goAfterLogin();

if (new URLSearchParams(location.search).get("expired")) say("Sua sessão expirou. Entre novamente.");

$("togglePw").onclick = () => {
  const p = $("password"), show = p.type === "password";
  p.type = show ? "text" : "password";
  $("togglePw").textContent = show ? "Ocultar" : "Mostrar";
  $("togglePw").setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha");
};

function setMode(m) {
  mode = m;
  $("passwordWrap").hidden = m === "forgot";
  $("password").required = m !== "forgot";
  submit.textContent = m === "forgot" ? "Enviar link de redefinição" : "Entrar";
  $("forgot").textContent = m === "forgot" ? "Voltar para o login" : "Esqueci minha senha";
  $("subtitle").textContent = m === "forgot" ? "Informe seu e-mail para receber o link de redefinição." : "Entre para administrar sua barbearia.";
  say("");
}
$("forgot").onclick = () => setMode(mode === "forgot" ? "login" : "forgot");

form.addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("email").value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return say("Informe um e-mail válido.");
  submit.disabled = true;
  try {
    if (mode === "forgot") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/redefinir-senha/` });
      if (error && !/rate|limit/i.test(error.message)) throw error;
      // Mensagem neutra (não revela se o e-mail existe)
      say("Se este e-mail estiver cadastrado, você receberá um link para redefinir a senha.", true);
      return;
    }
    const password = $("password").value;
    if (password.length < 6) return say("A senha precisa ter pelo menos 6 caracteres.");
    submit.textContent = "Entrando...";
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (/Email not confirmed/i.test(error.message)) return say("Confirme seu e-mail pelo link enviado antes de entrar.");
      if (/Invalid login credentials/i.test(error.message)) return say("E-mail ou senha incorretos.");
      if (/rate|too many/i.test(error.message)) return say("Muitas tentativas. Aguarde alguns minutos.");
      throw error;
    }
    say("Login realizado. Abrindo painel...", true);
    await goAfterLogin();
  } catch (err) {
    console.error(err);
    say(/fetch|network/i.test(String(err?.message)) ? "Sem conexão com o servidor. Verifique a internet." : "Não foi possível concluir agora. Tente novamente.");
  } finally {
    submit.disabled = false;
    if (mode === "login") submit.textContent = "Entrar";
  }
});
