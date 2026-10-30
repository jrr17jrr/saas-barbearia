import {supabase} from "../shared/supabase-client.js";
import {ownerContext} from "../shared/owner-context.js";
const ctx=await ownerContext();
if(ctx){
const $=id=>document.getElementById(id);
const themes={cyan:"#08a9df",gold:"#d6a83b",light:"#2563eb",red:"#e63946"};
const publicLink=location.origin+"/chatbot/?loja="+encodeURIComponent(ctx.shop.slug);
$("linkText").textContent=publicLink.replace(/^https?:\/\//,"");document.querySelector("a.open").href=publicLink;
const {data:settings,error}=await supabase.from("barbershop_settings").select("chatbot_enabled,chatbot_name,chatbot_greeting,chatbot_sync_with_site,chatbot_theme").eq("barbershop_id",ctx.shop.id).maybeSingle();
if(error)$("state").textContent=error.message;
else{
$("enabled").checked=settings?.chatbot_enabled??true;
$("name").value=settings?.chatbot_name||"Assistente";
$("greeting").value=settings?.chatbot_greeting||"Olá! Vou ajudar você a agendar.";
$("syncWithSite").checked=settings?.chatbot_sync_with_site??true;
let theme=settings?.chatbot_theme||"cyan";
const render=()=>{
$("pname").textContent=$("name").value;
$("pgreeting").textContent=$("greeting").value;
$("avatar").textContent=($("name").value||"A").slice(0,1);
$("phone").style.setProperty("--p",themes[theme]||themes.cyan);
document.querySelectorAll(".theme-option").forEach(b=>b.classList.toggle("active",b.dataset.theme===theme));
$("chatThemeGrid").style.opacity=$("syncWithSite").checked?".45":"1";$("syncStatus").textContent=$("syncWithSite").checked?"O chatbot usa as mesmas cores do seu site.":"Tema próprio do chatbot.";

};
document.querySelectorAll(".theme-option").forEach(btn=>btn.onclick=()=>{theme=btn.dataset.theme;if($("syncWithSite").checked)$("syncWithSite").checked=false;render();});
$("name").oninput=render;$("greeting").oninput=render;$("syncWithSite").onchange=render;
$("copy").onclick=async()=>{try{await navigator.clipboard.writeText(publicLink);$("state").textContent="Link copiado.";}catch{$("state").textContent=publicLink;}};
$("save").onclick=async()=>{$("save").disabled=true;
if(ctx.shop.plan==="site"){$("state").textContent="Seu plano não inclui chatbot.";$("save").disabled=false;return;}
const payload={barbershop_id:ctx.shop.id,chatbot_enabled:$("enabled").checked,chatbot_name:$("name").value.trim()||"Assistente",chatbot_greeting:$("greeting").value.trim(),chatbot_sync_with_site:$("syncWithSite").checked,chatbot_theme:theme};
const {error:saveError}=await supabase.from("barbershop_settings").upsert(payload,{onConflict:"barbershop_id"});
$("state").textContent=saveError?saveError.message:"Configurações salvas.";$("save").disabled=false;
};
render();
}
}
