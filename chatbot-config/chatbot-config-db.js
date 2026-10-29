import {supabase} from "../shared/supabase-client.js";
import {ownerContext} from "../shared/owner-context.js";
const ctx=await ownerContext();
if(ctx){
const $=id=>document.getElementById(id);
const themes={cyan:"#08a9df",gold:"#d6a83b",light:"#2563eb",red:"#e63946"};
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
$("linkText").textContent=location.origin+"/chatbot/?loja="+ctx.shop.slug;
};
document.querySelectorAll(".theme-option").forEach(btn=>btn.onclick=()=>{theme=btn.dataset.theme;render();});
$("name").oninput=render;$("greeting").oninput=render;
$("copy").onclick=async()=>{await navigator.clipboard.writeText(location.origin+"/chatbot/?loja="+ctx.shop.slug);$("state").textContent="Link copiado.";};
$("save").onclick=async()=>{
const payload={barbershop_id:ctx.shop.id,chatbot_enabled:$("enabled").checked,chatbot_name:$("name").value.trim()||"Assistente",chatbot_greeting:$("greeting").value.trim(),chatbot_sync_with_site:$("syncWithSite").checked,chatbot_theme:theme};
const {error:saveError}=await supabase.from("barbershop_settings").upsert(payload,{onConflict:"barbershop_id"});
$("state").textContent=saveError?saveError.message:"Configurações salvas.";
};
render();
}
}
