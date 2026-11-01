// Recuperação de senha e aceite de convite (links do Supabase Auth).
import { supabase } from "/supabase-client.js";

const $ = id => document.getElementById(id);
const say = (t, ok = false) => { $("msg").textContent = t; $("msg").className = "msg" + (ok ? " ok" : ""); };
const hash = new URLSearchParams(location.hash.slice(1));
const query = new URLSearchParams(location.search);

if (hash.get("error") || query.get("error")) {
  $("info").innerHTML = 'Este link expirou ou já foi utilizado. <a href="/login/">Solicite um novo link</a>.';
} else {
  // detectSessionInUrl processa o token do link; aguardamos a sessão ficar disponível
  let ready = false;
  const show = () => {
    if (ready) return; ready = true;
    $("info").textContent = hash.get("type") === "invite" ? "Bem-vindo! Crie sua senha de acesso ao painel." : "Crie uma nova senha para sua conta.";
    $("form").hidden = false;
    $("p1").focus();
  };
  supabase.auth.onAuthStateChange((event, session) => {
    if (session && ["PASSWORD_RECOVERY", "SIGNED_IN", "INITIAL_SESSION"].includes(event)) show();
  });
  const { data: { session } } = await supabase.auth.getSession();
  if (session) show();
  setTimeout(() => { if (!ready) $("info").innerHTML = 'Link inválido ou expirado. <a href="/login/">Solicite um novo link</a>.'; }, 6000);
}

$("form").addEventListener("submit", async e => {
  e.preventDefault();
  const p1 = $("p1").value, p2 = $("p2").value;
  if (p1.length < 8) return say("Use pelo menos 8 caracteres.");
  if (p1 !== p2) return say("As senhas não conferem.");
  $("submit").disabled = true;
  try {
    const { error } = await supabase.auth.updateUser({ password: p1 });
    if (error) throw error;
    say("Senha salva! Abrindo o painel...", true);
    history.replaceState(null, "", "/redefinir-senha/");
    setTimeout(() => location.replace("/dashboard/"), 900);
  } catch (err) {
    say(/weak|short|characters/i.test(err.message) ? "Senha muito fraca. Use letras e números." :
      /same/i.test(err.message) ? "A nova senha precisa ser diferente da anterior." : "Não foi possível salvar. Solicite um novo link.");
  } finally { $("submit").disabled = false; }
});
