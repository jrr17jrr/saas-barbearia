import {supabase} from "../shared/supabase-client.js";
import {ownerContext} from "../shared/owner-context.js";
import {esc,brl,dayKey,dayStart,addDays,weekday,weekStart,hm,dateLabel,statusLabel,waLink,toast,errorText,ACTIVE_STATUSES} from "../shared/utils.js";
const ctx=await ownerContext();
if(ctx){
const shop=ctx.shop,$=id=>document.getElementById(id);
const timeline=$("timeline"),weekGrid=$("weekGrid"),weekNav=$("weekNav"),mobileDays=$("mobileDays"),layer=$("modalLayer"),modal=$("modal");
const params=new URLSearchParams(location.search);
let view="day",selected=/^\d{4}-\d{2}-\d{2}$/.test(params.get("dia")||"")?params.get("dia"):dayKey();
let services=[],hours=[],appointments=[],blocks=[];
const dateInput=document.createElement("input");dateInput.type="date";dateInput.value=selected;dateInput.setAttribute("aria-label","Data da agenda");
dateInput.style.cssText="padding:10px;border-radius:10px;border:1px solid #334155;background:#1e293b;color:#fff;color-scheme:dark";
document.querySelector(".top-actions").prepend(dateInput);
function close(){layer.classList.remove("open");}
layer.onclick=e=>{if(e.target===layer)close();};
document.addEventListener("keydown",e=>{if(e.key==="Escape")close();});
function show(title,html){modal.innerHTML='<div class="modal-head"><h2>'+esc(title)+'</h2><button id="closeModal" aria-label="Fechar">×</button></div>'+html;layer.classList.add("open");$("closeModal").onclick=close;}
const range=()=>view==="week"?[weekStart(selected),addDays(weekStart(selected),7)]:[selected,addDays(selected,1)];
async function loadStatic(){
 const [s,h]=await Promise.all([
  supabase.from("services").select("id,name,price,duration_minutes").eq("barbershop_id",shop.id).eq("active",true).order("sort_order"),
  supabase.from("business_hours").select("weekday,is_open,opens_at,closes_at").eq("barbershop_id",shop.id)
 ]);
 services=s.data||[];hours=h.data||[];
}
async function load(){
 const [from,to]=range();
 timeline.setAttribute("aria-busy","true");
 const results=await Promise.all([
  supabase.from("appointments").select("id,client_name,client_whatsapp,starts_at,ends_at,status,price,service_id,services(name)").eq("barbershop_id",shop.id).gte("starts_at",dayStart(from).toISOString()).lt("starts_at",dayStart(to).toISOString()).order("starts_at"),
  supabase.from("blocked_times").select("id,starts_at,ends_at,reason").eq("barbershop_id",shop.id).lt("starts_at",dayStart(to).toISOString()).gt("ends_at",dayStart(from).toISOString()).order("starts_at")
 ]);
 timeline.removeAttribute("aria-busy");
 const failed=results.find(x=>x.error);
 if(failed){timeline.textContent="Não foi possível carregar a agenda: "+errorText(failed.error);return;}
 appointments=results[0].data||[];blocks=results[1].data||[];
 render();summary();
}
const onDay=(list,key)=>list.filter(x=>dayKey(new Date(x.starts_at))===key);
function hoursText(key){const h=hours.find(x=>x.weekday===weekday(key));return h?.is_open?"Expediente "+String(h.opens_at).slice(0,5)+" — "+String(h.closes_at).slice(0,5):"Fechado neste dia";}
function render(){
 const isWeek=view==="week";
 $("todayView").classList.toggle("active",!isWeek);$("weekView").classList.toggle("active",isWeek);
 timeline.style.display=isWeek?"none":"";weekGrid.classList.toggle("show",isWeek);weekNav.classList.toggle("show",isWeek);mobileDays.classList.toggle("show",isWeek);
 if(isWeek)renderWeek();else renderDay();
}
function apptRow(a){
 const row=document.createElement("div");row.className="slot";
 const time=document.createElement("div");time.className="slot-time";time.textContent=hm(a.starts_at);
 const info=document.createElement("div");info.className="slot-main";
 info.innerHTML='<div><b></b><small></small></div><span class="st st-'+esc(a.status)+'">'+esc(statusLabel(a.status))+'</span>';
 info.querySelector("b").textContent=a.client_name;
 info.querySelector("small").textContent=(a.services?.name||"Serviço")+" • "+hm(a.starts_at)+"–"+hm(a.ends_at)+" • "+brl(a.price);
 const actions=document.createElement("div");actions.className="slot-actions";
 const manageBtn=document.createElement("button");manageBtn.textContent="Gerenciar";manageBtn.onclick=()=>manage(a);
 actions.append(manageBtn);
 const link=waLink(a.client_whatsapp);
 if(link){const wa=document.createElement("button");wa.className="whatsapp";wa.textContent="WhatsApp";wa.onclick=()=>openWhatsApp(a);actions.append(wa);}
 row.append(time,info,actions);return row;
}
function blockRow(b){
 const row=document.createElement("div");row.className="slot blocked";
 const time=document.createElement("div");time.className="slot-time";time.textContent=hm(b.starts_at);
 const info=document.createElement("div");info.className="slot-main";info.innerHTML='<div><b>Bloqueado</b><small></small></div><span class="tag block">Bloqueio</span>';
 info.querySelector("small").textContent=hm(b.starts_at)+" — "+hm(b.ends_at)+(b.reason?" • "+b.reason:"");
 const actions=document.createElement("div");actions.className="slot-actions";
 const btn=document.createElement("button");btn.textContent="Liberar";btn.onclick=()=>removeBlock(b);actions.append(btn);
 row.append(time,info,actions);return row;
}
function renderDay(){
 $("dayTitle").textContent=dateLabel(selected);
 $("dayHours").textContent=hoursText(selected);
 timeline.replaceChildren();
 const items=[...appointments.map(a=>({t:a.starts_at,el:()=>apptRow(a)})),...blocks.map(b=>({t:b.starts_at,el:()=>blockRow(b)}))].sort((x,y)=>new Date(x.t)-new Date(y.t));
 for(const item of items)timeline.append(item.el());
 if(!items.length){const p=document.createElement("p");p.className="empty-note";p.textContent="Nenhum agendamento ou bloqueio nesta data.";timeline.append(p);}
}
function renderWeek(){
 const first=weekStart(selected),last=addDays(first,6);
 $("weekLabel").textContent=dateLabel(first,{day:"2-digit",month:"short"})+" — "+dateLabel(last,{day:"2-digit",month:"short"});
 $("dayTitle").textContent="Semana";$("dayHours").textContent="Toque em um agendamento para gerenciar.";
 weekGrid.replaceChildren();mobileDays.replaceChildren();
 weekGrid.style.gridTemplateColumns="repeat(7,minmax(118px,1fr))";
 const mobileSel=selected>=first&&selected<=last?selected:first;
 for(let i=0;i<7;i++){
  const key=addDays(first,i);
  const col=document.createElement("div");col.className="week-day"+(key===dayKey()?" today":"")+(key===mobileSel?" mobile-selected":"");
  const dayAppts=onDay(appointments,key),dayBlocks=onDay(blocks,key);
  col.innerHTML='<div class="week-day-head"><span>'+esc(dateLabel(key,{weekday:"short"}))+'</span><b>'+key.slice(8)+'</b><small>'+dayAppts.filter(a=>a.status!=="cancelled").length+'</small></div><div class="week-items"></div>';
  const list=col.querySelector(".week-items");
  const entries=[...dayAppts.map(a=>({t:a.starts_at,a})),...dayBlocks.map(bl=>({t:bl.starts_at,bl}))].sort((x,y)=>new Date(x.t)-new Date(y.t));
  for(const {a,bl} of entries){if(a){const b=document.createElement("button");b.className="week-item";b.innerHTML="<span></span><b></b><small></small>";b.querySelector("span").textContent=hm(a.starts_at);b.querySelector("b").textContent=a.client_name;b.querySelector("small").textContent=(a.services?.name||"Serviço")+" • "+statusLabel(a.status);if(a.status==="cancelled")b.style.opacity=".5";b.onclick=()=>manage(a);list.append(b);}else{const b=document.createElement("button");b.className="week-item block";b.innerHTML="<span></span><b>Bloqueado</b><small></small>";b.querySelector("span").textContent=hm(bl.starts_at)+"–"+hm(bl.ends_at);b.querySelector("small").textContent=bl.reason||"";b.onclick=()=>removeBlock(bl);list.append(b);}}
  if(!dayAppts.length&&!dayBlocks.length){const s=document.createElement("small");s.className="empty-note";s.style.padding="6px";s.textContent=hours.find(x=>x.weekday===weekday(key))?.is_open?"Livre":"Fechado";list.append(s);}
  const open=document.createElement("button");open.className="week-item free";open.innerHTML="<b>Ver dia</b>";open.onclick=()=>{selected=key;dateInput.value=key;view="day";load();};list.append(open);
  weekGrid.append(col);
  const m=document.createElement("button");m.className=key===mobileSel?"active":"";m.innerHTML="<b>"+esc(dateLabel(key,{weekday:"short"}))+"</b><span>"+key.slice(8)+"</span>";
  m.onclick=()=>{mobileDays.querySelectorAll("button").forEach(x=>x.classList.toggle("active",x===m));weekGrid.querySelectorAll(".week-day").forEach((c,j)=>c.classList.toggle("mobile-selected",j===i));};
  mobileDays.append(m);
 }
}
async function summary(){
 const values=document.querySelectorAll(".summary strong"),small=document.querySelectorAll(".summary small");
 const scope=view==="week"?appointments:onDay(appointments,selected),scopeBlocks=view==="week"?blocks:onDay(blocks,selected);
 small[0].textContent=view==="week"?"Agendados na semana":"Agendados no dia";
 values[0].textContent=scope.filter(a=>ACTIVE_STATUSES.includes(a.status)).length;
 values[2].textContent=scopeBlocks.length;
 values[3].textContent=scope.filter(a=>a.status==="completed").length;
 values[1].textContent="—";
 if(view==="day"&&services.length){
  const shortest=[...services].sort((a,b)=>a.duration_minutes-b.duration_minutes)[0];
  const {data,error}=await supabase.rpc("available_booking_slots",{p_slug:shop.slug,p_service_id:shortest.id,p_day:selected});
  values[1].textContent=error?"—":(data||[]).length;
  small[1].textContent="Horários livres ("+shortest.duration_minutes+" min)";
 }else small[1].textContent="Horários livres";
}
async function setStatus(a,status){
 const {error}=await supabase.from("appointments").update({status}).eq("id",a.id).eq("barbershop_id",shop.id);
 if(error){toast(errorText(error),"error");return false;}
 toast({confirmed:"Agendamento confirmado.",completed:"Atendimento concluído.",no_show:"Falta registrada.",cancelled:"Agendamento cancelado. O horário foi liberado.",pending:"Agendamento voltou para pendente."}[status]||"Status atualizado.","success");close();await load();return true;
}
function openWhatsApp(a,text){
 const msg=text||("Olá, "+a.client_name+"! Aqui é da "+shop.name+". Sobre seu horário de "+dateLabel(dayKey(new Date(a.starts_at)),{day:"2-digit",month:"2-digit"})+" às "+hm(a.starts_at)+".");
 const link=waLink(a.client_whatsapp,msg);if(link)window.open(link,"_blank","noopener");
}
function manage(a){
 const when=dateLabel(dayKey(new Date(a.starts_at)),{weekday:"long",day:"2-digit",month:"long"})+" • "+hm(a.starts_at)+"–"+hm(a.ends_at);
 const actions=[["confirmed","Confirmar"],["completed","Concluir atendimento"],["no_show","Cliente faltou"],["cancelled","Cancelar"],["pending","Voltar para pendente"]].filter(([s])=>s!==a.status);
 show(a.client_name,'<div class="detail-card"><span><b>Serviço:</b> '+esc(a.services?.name||"Serviço")+'</span><span><b>Quando:</b> '+esc(when)+'</span><span><b>Valor:</b> '+esc(brl(a.price))+'</span><span><b>WhatsApp:</b> '+esc(a.client_whatsapp||"—")+'</span><span><b>Status:</b> <span class="st st-'+esc(a.status)+'">'+esc(statusLabel(a.status))+'</span></span></div><div class="action-grid" id="apptActions"></div><p class="muted" style="margin-top:14px;font-size:13px">Mensagens rápidas no WhatsApp</p><div class="message-options" id="msgOptions"></div>');
 const grid=$("apptActions");
 for(const [status,label] of actions){const b=document.createElement("button");b.textContent=label;if(status==="cancelled")b.style.borderColor="#7f1d1d";b.onclick=async()=>{if(status==="cancelled"&&!confirm("Cancelar o agendamento de "+a.client_name+"? O horário volta a ficar livre."))return;b.disabled=true;if(!await setStatus(a,status))b.disabled=false;};grid.append(b);}
 const time=hm(a.starts_at),day=dateLabel(dayKey(new Date(a.starts_at)),{day:"2-digit",month:"2-digit"});
 const templates=[["Confirmar horário","Olá, "+a.client_name+"! Seu horário na "+shop.name+" está confirmado para "+day+" às "+time+". Até lá!"],["Lembrete","Olá, "+a.client_name+"! Passando para lembrar do seu horário hoje às "+time+" na "+shop.name+"."],["Remarcar","Olá, "+a.client_name+"! Precisamos remarcar seu horário de "+day+" às "+time+". Qual outro horário fica bom para você?"]];
 if(a.client_whatsapp)for(const [label,text] of templates){const b=document.createElement("button");b.className="message-option";b.innerHTML="<b></b><small></small>";b.querySelector("b").textContent=label;b.querySelector("small").textContent=text;b.onclick=()=>openWhatsApp(a,text);$("msgOptions").append(b);}
 else $("msgOptions").textContent="Cliente sem WhatsApp informado.";
}
function booking(){
 if(!services.length){show("Novo agendamento",'<p class="muted">Cadastre ao menos um serviço ativo antes de agendar.</p><div class="modal-actions"><button onclick="location.href=\'/servicos/\'">Ir para Serviços</button></div>');return;}
 const key=selected<dayKey()?dayKey():selected;
 show("Novo agendamento",'<form id="bookingForm" class="bs-form"><label>Nome do cliente<input name="name" required minlength="2" maxlength="100" autocomplete="off"></label><label>WhatsApp<input name="phone" required inputmode="tel" placeholder="(21) 99999-9999"></label><label>Serviço<select name="service" required>'+services.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+' • '+s.duration_minutes+' min • '+esc(brl(s.price))+'</option>').join("")+'</select></label><label>Data<input name="day" type="date" required min="'+dayKey()+'" value="'+key+'"></label><p class="muted" style="font-size:13px">Horários livres</p><div class="available-grid" id="slotGrid"></div><input type="hidden" name="slot"><div class="bs-actions"><button type="submit" class="primary" id="bookingSubmit">Agendar</button></div><p class="bs-error" id="bookingError" role="alert"></p></form>');
 const form=$("bookingForm"),grid=$("slotGrid");
 async function slots(){
  grid.textContent="Consultando...";form.elements.slot.value="";
  const {data,error}=await supabase.rpc("available_booking_slots",{p_slug:shop.slug,p_service_id:form.elements.service.value,p_day:form.elements.day.value});
  grid.replaceChildren();
  if(error){grid.textContent=errorText(error);return;}
  if(!data?.length){grid.textContent="Sem horários livres nesta data.";return;}
  for(const s of data){const b=document.createElement("button");b.type="button";b.textContent=hm(s.slot_start);b.onclick=()=>{grid.querySelectorAll("button").forEach(x=>x.classList.toggle("selected",x===b));form.elements.slot.value=s.slot_start;};grid.append(b);}
 }
 form.elements.service.onchange=slots;form.elements.day.onchange=slots;slots();
 form.onsubmit=async e=>{
  e.preventDefault();const err=$("bookingError");err.textContent="";
  if(!form.elements.slot.value){err.textContent="Escolha um horário livre.";return;}
  if(form.elements.phone.value.replace(/\D/g,"").length<10){err.textContent="Informe o WhatsApp com DDD.";return;}
  $("bookingSubmit").disabled=true;
  const {error}=await supabase.rpc("create_public_booking",{p_slug:shop.slug,p_service_id:form.elements.service.value,p_client_name:form.elements.name.value.trim(),p_client_whatsapp:form.elements.phone.value.trim(),p_starts_at:new Date(form.elements.slot.value).toISOString()});
  $("bookingSubmit").disabled=false;
  if(error){err.textContent=errorText(error);await slots();return;}
  toast("Agendamento criado.","success");close();selected=form.elements.day.value;dateInput.value=selected;await load();
 };
}
function block(){
 show("Bloquear horário",'<form id="blockForm" class="bs-form"><label>Data<input name="day" type="date" required value="'+selected+'"></label><label>Início<input name="start" type="time" required></label><label>Fim<input name="end" type="time" required></label><label>Motivo<input name="reason" maxlength="120" placeholder="Almoço, compromisso..."></label><div class="bs-actions"><button type="submit" class="primary">Salvar bloqueio</button></div><p class="bs-error" id="blockError" role="alert"></p></form>');
 $("blockForm").onsubmit=async e=>{
  e.preventDefault();const form=e.currentTarget;
  const begins=new Date(form.elements.day.value+"T"+form.elements.start.value+":00-03:00"),ends=new Date(form.elements.day.value+"T"+form.elements.end.value+":00-03:00");
  if(ends<=begins){$("blockError").textContent="O fim deve ser depois do início.";return;}
  const {error}=await supabase.from("blocked_times").insert({barbershop_id:shop.id,starts_at:begins.toISOString(),ends_at:ends.toISOString(),reason:form.elements.reason.value.trim()||null});
  if(error)$("blockError").textContent=errorText(error);else{toast("Horário bloqueado.","success");close();await load();}
 };
}
async function removeBlock(b){
 if(!confirm("Liberar o bloqueio de "+hm(b.starts_at)+" — "+hm(b.ends_at)+"?"))return;
 const {error}=await supabase.from("blocked_times").delete().eq("id",b.id).eq("barbershop_id",shop.id);
 if(error)toast(errorText(error),"error");else{toast("Bloqueio removido.","success");await load();}
}
$("newBtn").onclick=booking;$("blockBtn").onclick=block;
dateInput.onchange=()=>{if(dateInput.value){selected=dateInput.value;load();}};
$("todayView").onclick=()=>{view="day";selected=dayKey();dateInput.value=selected;load();};
$("weekView").onclick=()=>{view="week";load();};
$("prevWeek").onclick=()=>{selected=addDays(selected,-7);dateInput.value=selected;load();};
$("nextWeek").onclick=()=>{selected=addDays(selected,7);dateInput.value=selected;load();};
$("todayView").textContent="Dia";
await loadStatic();await load();
window.addEventListener("barbersaas:new-booking",load);
}
