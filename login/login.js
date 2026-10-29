import { supabase, platformAdmin } from "../shared/supabase-client.js";
const form=document.getElementById("form");
const msg=document.getElementById("msg");
const email=document.getElementById("email");
const password=document.getElementById("password");
async function enter(user){
 const isAdmin=await platformAdmin(user);
 window.location.assign(isAdmin?"/dev/":"/dashboard/");
}
form.addEventListener("submit",async event=>{
 event.preventDefault();
 const button=document.getElementById("submit");
 button.disabled=true;
 msg.textContent="Verificando acesso...";
 const {data,error}=await supabase.auth.signInWithPassword({email:email.value.trim(),password:password.value});
 if(error){msg.textContent="Não foi possível entrar. Confira seus dados.";button.disabled=false;return;}
 try{await enter(data.user);}catch{msg.textContent="Não foi possível verificar as permissões.";button.disabled=false;}
});
document.getElementById("forgot").addEventListener("click",async()=>{
 if(!email.value.trim()){msg.textContent="Informe seu e-mail.";return;}
 const {error}=await supabase.auth.resetPasswordForEmail(email.value.trim(),{redirectTo:location.origin+"/login/"});
 msg.textContent=error?"Não foi possível solicitar a recuperação.":"Confira seu e-mail para recuperar o acesso.";
});
document.getElementById("first").addEventListener("click",()=>{
 msg.textContent="O primeiro administrador deve ser autorizado no Supabase. O cadastro público está desativado.";
});

if(location.hash.includes("type=recovery")||new URLSearchParams(location.search).get("type")==="recovery"){
 document.getElementById("subtitle").textContent="Defina uma nova senha para sua conta.";
 document.getElementById("submit").textContent="Atualizar senha";
 email.required=false;email.closest("label")?.remove();
 form.onsubmit=async event=>{
 event.preventDefault();if(password.value.length<10){msg.textContent="Use uma senha com pelo menos 10 caracteres.";return;}
 const {error}=await supabase.auth.updateUser({password:password.value});
 msg.textContent=error?error.message:"Senha atualizada. Faça login novamente.";
 if(!error){await supabase.auth.signOut();location.hash="";location.replace("/login/");}
 };
}
