import {supabase} from "../shared/supabase-client.js";
import {ownerContext} from "../shared/owner-context.js";
const ctx=await ownerContext();
if(ctx){
 const start=new Date();start.setHours(0,0,0,0);
 const end=new Date(start);end.setDate(end.getDate()+1);
 const month=new Date(start.getFullYear(),start.getMonth(),1);
 const week=new Date(start);week.setDate(start.getDate()-((start.getDay()+6)%7));

 const [appointments,clients]=await Promise.all([
 supabase.from("appointments").select("client_name,starts_at,status,price,services(name)").eq("barbershop_id",ctx.shop.id).gte("starts_at",(week<month?week:month).toISOString()).order("starts_at"),
 supabase.from("clients").select("id").eq("barbershop_id",ctx.shop.id)
 ]);
 if(appointments.error||clients.error){
 document.querySelector(".topbar p").textContent="Não foi possível carregar os dados.";
 }else{
 const all=appointments.data||[];
 const today=all.filter(a=>new Date(a.starts_at)>=start&&new Date(a.starts_at)<end);
 const completed=all.filter(a=>a.status==="completed");
 const total=items=>items.reduce((sum,a)=>sum+Number(a.price||0),0);
 const money=v=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(v);
 const cards=document.querySelectorAll(".cards .card h2");
 const values=[today.length,money(total(today.filter(a=>a.status==="completed"))),clients.data.length,completed.length];
 cards.forEach((node,i)=>node.textContent=values[i]);
 document.querySelector(".topbar p").textContent="Visão geral de "+ctx.shop.name;
 const tbody=document.querySelector(".agenda tbody");
 tbody.replaceChildren();
 for(const a of today){
 const row=document.createElement("tr");
 const fields=[new Date(a.starts_at).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}),a.client_name,a.services?.name||"Serviço","—",a.status];
 for(const value of fields){const td=document.createElement("td");td.textContent=value;row.append(td);}
 tbody.append(row);
 }
 if(!today.length){const row=document.createElement("tr");const td=document.createElement("td");td.colSpan=5;td.textContent="Sem agendamentos hoje.";row.append(td);tbody.append(row);}
 document.querySelectorAll(".clients .client").forEach(node=>node.remove());
 document.querySelectorAll(".cards .card small").forEach(node=>node.textContent="Dados atualizados");
 const moneyToday=document.querySelector(".finance .money h1");
 if(moneyToday)moneyToday.textContent=money(total(today.filter(a=>a.status==="completed")));
 const week=new Date(start);week.setDate(start.getDate()-((start.getDay()+6)%7));
 const totals=[completed.filter(a=>new Date(a.starts_at)>=week),completed.filter(a=>new Date(a.starts_at)>=month)];
 document.querySelectorAll(".finance-item strong").forEach((node,i)=>node.textContent=money(total(totals[i])));
 }
}
