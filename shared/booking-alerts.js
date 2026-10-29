import {supabase} from "./supabase-client.js";
import {ownerContext} from "./owner-context.js";
const ctx=await ownerContext();
if(ctx){
const button=document.createElement("button");button.textContent="Ativar avisos";button.type="button";button.style.cssText="position:fixed;right:16px;bottom:16px;z-index:1000;padding:12px;border-radius:12px;background:#08a9df;color:#07111f;border:0;cursor:pointer;font-weight:700";
document.body.append(button);
button.onclick=async()=>{if(!("Notification" in window)){alert("Este navegador não suporta notificações.");return;}const permission=await Notification.requestPermission();button.textContent=permission==="granted"?"Avisos ativos nesta aba":"Avisos bloqueados";};
supabase.channel("appointments-"+ctx.shop.id).on("postgres_changes",{event:"INSERT",schema:"public",table:"appointments",filter:"barbershop_id=eq."+ctx.shop.id},payload=>{
const title="Novo agendamento",body=payload.new?.client_name||"Um cliente agendou um horário.";
if("Notification" in window&&Notification.permission==="granted"&&document.visibilityState==="visible")new Notification(title,{body});
const toast=document.createElement("div");toast.textContent=title+": "+body;toast.style.cssText="position:fixed;bottom:75px;right:16px;z-index:1000;background:#14243c;color:white;padding:16px;border-radius:12px";document.body.append(toast);setTimeout(()=>toast.remove(),8000);
}).subscribe();
}
