import {supabase} from "../shared/supabase-client.js";
import {ownerContext} from "../shared/owner-context.js";
const ctx=await ownerContext();
if(ctx){
const shop=ctx.shop,day=new Date(),start=new Date(day.getFullYear(),day.getMonth(),day.getDate());
const dateInput=document.createElement("input");dateInput.type="date";dateInput.value=[start.getFullYear(),String(start.getMonth()+1).padStart(2,"0"),String(start.getDate()).padStart(2,"0")].join("-");
dateInput.style.cssText="padding:10px;border-radius:10px";
document.querySelector(".top-actions").prepend(dateInput);
const timeline=document.getElementById("timeline"),layer=document.getElementById("modalLayer"),modal=document.getElementById("modal");
let services=[],appointments=[],blocks=[];
const esc=v=>String(v??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function dateBounds(){const begin=new Date(dateInput.value+"T00:00:00");const end=new Date(begin);end.setDate(end.getDate()+1);return [begin,end];}
function close(){layer.classList.remove("open");}
layer.onclick=e=>{if(e.target===layer)close();};
function show(title,html){modal.innerHTML='<div class="modal-head"><h2>'+esc(title)+'</h2><button id="closeModal">×</button></div>'+html;layer.classList.add("open");document.getElementById("closeModal").onclick=close;}
async function load(){
const [begin,end]=dateBounds();
const results=await Promise.all([
 supabase.from("appointments").select("id,client_name,client_whatsapp,starts_at,ends_at,status,price,service_id,services(name)").eq("barbershop_id",shop.id).gte("starts_at",begin.toISOString()).lt("starts_at",end.toISOString()).order("starts_at"),
 supabase.from("blocked_times").select("id,starts_at,ends_at,reason").eq("barbershop_id",shop.id).lt("starts_at",end.toISOString()).gt("ends_at",begin.toISOString()),
 supabase.from("services").select("id,name,price,duration_minutes").eq("barbershop_id",shop.id).eq("active",true)
]);
if(results.some(x=>x.error)){timeline.textContent="Não foi possível carregar a agenda.";return;}
appointments=results[0].data;blocks=results[1].data;services=results[2].data;render();
}
function render(){
timeline.replaceChildren();
for(const a of appointments){
const row=document.createElement("div");row.className="slot";
const time=document.createElement("div");time.className="slot-time";time.textContent=new Date(a.starts_at).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
const info=document.createElement("div");info.className="slot-main";info.textContent=a.client_name+" • "+(a.services?.name||"Serviço")+" • "+a.status;
const actions=document.createElement("div");actions.className="slot-actions";
const button=document.createElement("button");button.textContent="Gerenciar";button.onclick=()=>manage(a);actions.append(button);
row.append(time,info,actions);timeline.append(row);
}
for(const b of blocks){
const row=document.createElement("div");row.className="slot blocked";
const info=document.createElement("div");info.className="slot-main";info.textContent="Bloqueado • "+new Date(b.starts_at).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})+" — "+new Date(b.ends_at).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})+" • "+(b.reason||"");
const btn=document.createElement("button");btn.textContent="Liberar";btn.onclick=async()=>{if(!confirm("Remover bloqueio?"))return;const {error}=await supabase.from("blocked_times").delete().eq("id",b.id).eq("barbershop_id",shop.id);if(error)alert(error.message);else await load();};
row.append(info,btn);timeline.append(row);
}
if(!appointments.length&&!blocks.length)timeline.textContent="Nenhum agendamento ou bloqueio nesta data.";
const summary=document.querySelectorAll(".summary strong");
const values=[appointments.filter(a=>!["cancelled","no_show"].includes(a.status)).length,"—",blocks.length,appointments.filter(a=>a.status==="completed").length];
summary.forEach((el,i)=>el.textContent=values[i]);
document.querySelector(".agenda-head h2").textContent=new Date(dateInput.value+"T12:00:00").toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"});
}
function manage(a){
show(a.client_name,'<p>'+esc(a.services?.name||"Serviço")+' • '+esc(a.status)+'</p><div class="modal-actions"><button id="confirmAppt">Confirmar</button><button id="completeAppt">Concluir</button><button id="cancelAppt">Cancelar</button><button id="notifyAppt">WhatsApp</button></div>');
for(const [id,status] of [["confirmAppt","confirmed"],["completeAppt","completed"],["cancelAppt","cancelled"]]){
document.getElementById(id).onclick=async()=>{if(status==="cancelled"&&!confirm("Cancelar agendamento?"))return;const {error}=await supabase.from("appointments").update({status}).eq("id",a.id).eq("barbershop_id",shop.id);if(error)alert(error.message);else{close();await load();}};
}
document.getElementById("notifyAppt").onclick=()=>{const phone=(a.client_whatsapp||"").replace(/\D/g,"");if(phone)window.open("https://wa.me/"+phone+"?text="+encodeURIComponent("Olá, "+a.client_name+"! Sobre seu horário na "+shop.name+"."),"_blank","noopener");};
}
function booking(){
show("Novo agendamento",'<form id="bookingForm"><label>Nome<input name="name" required minlength="2"></label><label>WhatsApp<input name="phone" required minlength="10"></label><label>Serviço<select name="service" required>'+services.map(s=>'<option value="'+s.id+'">'+esc(s.name)+'</option>').join("")+'</select></label><label>Horário<input name="time" type="time" required></label><button type="submit">Agendar</button><p id="bookingError" role="alert"></p></form>');
document.getElementById("bookingForm").onsubmit=async e=>{
e.preventDefault();const form=e.currentTarget;
const starts=new Date(dateInput.value+"T"+form.elements.time.value+":00");
if(starts<=new Date()){document.getElementById("bookingError").textContent="Escolha um horário futuro.";return;}
const {error}=await supabase.rpc("create_public_booking",{p_slug:shop.slug,p_service_id:form.elements.service.value,p_client_name:form.elements.name.value,p_client_whatsapp:form.elements.phone.value,p_starts_at:starts.toISOString()});
if(error)document.getElementById("bookingError").textContent=error.message;else{close();await load();}
};
}
function block(){
show("Bloquear horário",'<form id="blockForm"><label>Início<input name="start" type="time" required></label><label>Fim<input name="end" type="time" required></label><label>Motivo<input name="reason"></label><button type="submit">Salvar bloqueio</button><p id="blockError" role="alert"></p></form>');
document.getElementById("blockForm").onsubmit=async e=>{
e.preventDefault();const form=e.currentTarget;
const begins=new Date(dateInput.value+"T"+form.elements.start.value+":00"),ends=new Date(dateInput.value+"T"+form.elements.end.value+":00");
if(ends<=begins){document.getElementById("blockError").textContent="O fim deve ser depois do início.";return;}
const {error}=await supabase.from("blocked_times").insert({barbershop_id:shop.id,starts_at:begins.toISOString(),ends_at:ends.toISOString(),reason:form.elements.reason.value.trim()});
if(error)document.getElementById("blockError").textContent=error.message;else{close();await load();}
};
}
document.getElementById("newBtn").onclick=booking;
document.getElementById("blockBtn").onclick=block;
dateInput.onchange=load;
document.getElementById("weekView").onclick=()=>{dateInput.step="1";dateInput.focus();};
document.getElementById("todayView").onclick=()=>{dateInput.value=[start.getFullYear(),String(start.getMonth()+1).padStart(2,"0"),String(start.getDate()).padStart(2,"0")].join("-");load();};
await load();
}
