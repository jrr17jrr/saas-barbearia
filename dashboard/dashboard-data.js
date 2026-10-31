import {supabase} from "../shared/supabase-client.js";
import {ownerContext} from "../shared/owner-context.js";
import {brl,dayKey,dayStart,addDays,weekStart,monthStart,hm,statusLabel,esc,ACTIVE_STATUSES} from "../shared/utils.js";
const ctx=await ownerContext();
if(ctx){
 const $=id=>document.getElementById(id);
 const today=dayKey(),tomorrow=addDays(today,1),week=weekStart(today),month=monthStart(today);
 const from=week<month?week:month;
 async function load(){
  const [appointments,upcoming]=await Promise.all([
   supabase.from("appointments").select("id,client_name,client_whatsapp,client_id,starts_at,status,price,services(name)").eq("barbershop_id",ctx.shop.id).gte("starts_at",dayStart(from).toISOString()).lt("starts_at",dayStart(tomorrow).toISOString()).order("starts_at"),
   supabase.from("appointments").select("client_name,starts_at,status,services(name)").eq("barbershop_id",ctx.shop.id).in("status",ACTIVE_STATUSES).gte("starts_at",new Date().toISOString()).order("starts_at").limit(5)
  ]);
  if(appointments.error||upcoming.error){$("greeting").textContent="Não foi possível carregar os dados. Atualize a página.";return;}
  const all=appointments.data||[];
  const inRange=(a,start,end)=>{const t=new Date(a.starts_at).getTime();return t>=dayStart(start).getTime()&&(!end||t<dayStart(end).getTime());};
  const done=all.filter(a=>a.status==="completed");
  const sum=list=>list.reduce((n,a)=>n+Number(a.price||0),0);
  const todayAll=all.filter(a=>inRange(a,today,tomorrow));
  const todayDone=done.filter(a=>inRange(a,today,tomorrow));
  const monthDone=done.filter(a=>inRange(a,month));
  const weekDone=done.filter(a=>inRange(a,week));
  const todayBooked=todayAll.filter(a=>a.status!=="cancelled");
  $("greeting").textContent="Visão geral de "+ctx.shop.name;
  $("kpiToday").textContent=todayBooked.length;
  $("kpiTodayNote").textContent=todayAll.filter(a=>ACTIVE_STATUSES.includes(a.status)).length+" a atender • "+todayDone.length+" concluídos";
  $("kpiRevenue").textContent=brl(sum(todayDone));
  $("kpiClients").textContent=new Set(monthDone.map(a=>a.client_id||a.client_whatsapp||a.client_name)).size;
  $("kpiServices").textContent=monthDone.length;
  $("finToday").textContent=brl(sum(todayDone));
  $("finWeek").textContent=brl(sum(weekDone));
  $("finMonth").textContent=brl(sum(monthDone));
  $("finTicket").textContent=brl(monthDone.length?sum(monthDone)/monthDone.length:0);
  const tbody=$("todayRows");tbody.replaceChildren();
  for(const a of todayAll){
   const row=document.createElement("tr");
   for(const value of [hm(a.starts_at),a.client_name,a.services?.name||"Serviço",brl(a.price)]){const td=document.createElement("td");td.textContent=value;row.append(td);}
   const td=document.createElement("td");td.innerHTML='<span class="st st-'+esc(a.status)+'">'+esc(statusLabel(a.status))+'</span>';row.append(td);
   tbody.append(row);
  }
  if(!todayAll.length)tbody.innerHTML='<tr><td colspan="5">Sem agendamentos hoje.</td></tr>';
  const box=$("upcoming");box.querySelectorAll(".client,.empty-note").forEach(n=>n.remove());
  for(const a of upcoming.data||[]){
   const item=document.createElement("div");item.className="client";
   item.innerHTML='<div class="avatar"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg></div><div><h3></h3><p></p></div>';
   item.querySelector("h3").textContent=a.client_name;
   const day=dayKey(new Date(a.starts_at));
   item.querySelector("p").textContent=(day===today?"Hoje":new Date(a.starts_at).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit",timeZone:"America/Sao_Paulo"}))+" • "+hm(a.starts_at)+" • "+(a.services?.name||"Serviço");
   box.append(item);
  }
  if(!(upcoming.data||[]).length){const p=document.createElement("p");p.className="empty-note";p.textContent="Nenhum próximo cliente agendado.";box.append(p);}
 }
 await load();
 window.addEventListener("barbersaas:new-booking",load);
}
