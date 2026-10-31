import {supabase} from "../shared/supabase-client.js";
import {ownerContext} from "../shared/owner-context.js";
import {brl,dayKey,dayStart,addDays,weekStart,monthStart,dateTime,errorText} from "../shared/utils.js";
const ctx=await ownerContext();
if(ctx){
 // Revenue only counts completed appointments; cancelled/no-show are reported separately.
 const today=dayKey(),week=weekStart(today),month=monthStart(today);
 const historyStart=(()=>{const [y,m]=month.split("-").map(Number);const d=new Date(Date.UTC(y,m-1-5,1));return d.toISOString().slice(0,10);})();
 const from=[week,month,historyStart].sort()[0];
 const {data,error}=await supabase.from("appointments").select("client_name,price,starts_at,status,services(name)").eq("barbershop_id",ctx.shop.id).in("status",["completed","cancelled","no_show"]).gte("starts_at",dayStart(from).toISOString()).lt("starts_at",dayStart(addDays(today,1)).toISOString()).order("starts_at",{ascending:false});
 const boxes=document.querySelectorAll(".finance-box");
 const fill=(box,rows,empty)=>{box.querySelectorAll(".payment,.service-profit,.empty-note").forEach(n=>n.remove());if(!rows.length){const p=document.createElement("p");p.className="empty-note";p.textContent=empty;box.append(p);}for(const r of rows)box.append(r);};
 const row=(cls,title,sub,value)=>{const el=document.createElement("div");el.className=cls;if(cls==="payment"){el.innerHTML="<div><h3></h3><p></p></div><strong></strong>";el.querySelector("h3").textContent=title;el.querySelector("p").textContent=sub;el.querySelector("strong").textContent=value;}else{el.innerHTML="<span></span><strong></strong>";el.querySelector("span").textContent=title;el.querySelector("strong").textContent=value;}return el;};
 if(error){document.querySelector(".topbar p").textContent="Não foi possível carregar o financeiro: "+errorText(error);}
 else{
  const all=data||[],done=all.filter(a=>a.status==="completed");
  const since=key=>a=>new Date(a.starts_at).getTime()>=dayStart(key).getTime();
  const sum=a=>a.reduce((n,x)=>n+Number(x.price||0),0);
  const todayItems=done.filter(since(today)),weekItems=done.filter(since(week)),monthItems=done.filter(since(month));
  const values=[sum(todayItems),sum(weekItems),sum(monthItems),monthItems.length?sum(monthItems)/monthItems.length:0];
  const notes=[todayItems.length+" atendimento(s)",weekItems.length+" atendimento(s)",monthItems.length+" atendimento(s)","Por atendimento no mês"];
  document.querySelectorAll(".cards .card").forEach((card,i)=>{card.querySelector("h2").textContent=brl(values[i]);card.querySelector("p").textContent=notes[i];});
  fill(boxes[0],done.slice(0,8).map(a=>row("payment",a.client_name,(a.services?.name||"Serviço")+" • "+dateTime(a.starts_at),brl(a.price))),"Nenhum atendimento concluído ainda. Marque os atendimentos como “Concluído” na Agenda.");
  const counts=new Map();for(const a of monthItems){const k=a.services?.name||"Serviço";const c=counts.get(k)||{n:0,v:0};c.n++;c.v+=Number(a.price||0);counts.set(k,c);}
  fill(boxes[1],[...counts].sort((a,b)=>b[1].v-a[1].v).slice(0,6).map(([name,c])=>row("service-profit",name+" ("+c.n+")",null,brl(c.v))),"Sem dados neste mês.");
  const months=[];for(let i=0;i<6;i++){const [y,m]=historyStart.split("-").map(Number);const d=new Date(Date.UTC(y,m-1+i,1));months.push(d.toISOString().slice(0,7));}
  fill(boxes[2],months.reverse().map(k=>{const items=done.filter(a=>dayKey(new Date(a.starts_at)).startsWith(k));const label=new Date(k+"-15T12:00:00Z").toLocaleDateString("pt-BR",{month:"long",year:"numeric"});return row("service-profit",label+" • "+items.length+" atend.",null,brl(sum(items)));}),"Sem histórico.");
  const lost=all.filter(a=>a.status!=="completed"&&since(month)(a));
  const cancelled=lost.filter(a=>a.status==="cancelled"),missed=lost.filter(a=>a.status==="no_show");
  fill(boxes[3],[row("service-profit","Cancelados ("+cancelled.length+")",null,brl(sum(cancelled))),row("service-profit","Faltas ("+missed.length+")",null,brl(sum(missed)))],"");
 }
}
