import {supabase} from "../shared/supabase-client.js";
import {ownerContext} from "../shared/owner-context.js";
const ctx=await ownerContext();
if(ctx){
 const now=new Date(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate()),month=new Date(now.getFullYear(),now.getMonth(),1),week=new Date(today);
 week.setDate(today.getDate()-((today.getDay()+6)%7));
 const {data,error}=await supabase.from("appointments").select("client_name,price,starts_at,services(name)").eq("barbershop_id",ctx.shop.id).eq("status","completed").gte("starts_at",(week<month?week:month).toISOString()).order("starts_at",{ascending:false});
 if(!error){
 const all=data||[],sum=a=>a.reduce((n,x)=>n+Number(x.price||0),0),fmt=v=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(v);
 const todayItems=all.filter(a=>new Date(a.starts_at)>=today),weekItems=all.filter(a=>new Date(a.starts_at)>=week);
 const monthItems=all.filter(a=>new Date(a.starts_at)>=month);
 const values=[sum(todayItems),sum(weekItems),sum(monthItems),monthItems.length?sum(monthItems)/monthItems.length:0];
 document.querySelectorAll(".cards .card").forEach((card,i)=>{card.querySelector("h2").textContent=fmt(values[i]);const p=card.querySelector("p");if(p)p.textContent=[todayItems.length+" atendimentos",weekItems.length+" atendimentos",monthItems.length+" serviços","Por atendimento"][i];});
 const boxes=document.querySelectorAll(".finance-box");
 if(boxes[0]){boxes[0].querySelectorAll(".payment").forEach(n=>n.remove());for(const a of all.slice(0,5)){const row=document.createElement("div");row.className="payment";row.textContent=a.client_name+" • "+(a.services?.name||"Serviço")+" — "+fmt(a.price);boxes[0].append(row);}}
 if(boxes[1]){boxes[1].querySelectorAll(".service-profit").forEach(n=>n.remove());const counts=new Map();all.forEach(a=>counts.set(a.services?.name||"Serviço",(counts.get(a.services?.name||"Serviço")||0)+1));for(const [name,n] of [...counts].sort((a,b)=>b[1]-a[1]).slice(0,5)){const row=document.createElement("div");row.className="service-profit";row.textContent=name+" — "+n;boxes[1].append(row);}}
 }
}
