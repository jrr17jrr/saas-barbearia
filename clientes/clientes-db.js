import {supabase} from "../shared/supabase-client.js";
import {ownerContext} from "../shared/owner-context.js";
import {brl,esc,digits,dayKey,monthStart,dayStart,dateTime,statusLabel,waLink,toast,errorText} from "../shared/utils.js";
const ctx=await ownerContext();
if(ctx){
 const $=id=>document.getElementById(id);
 const list=$("clientList"),search=$("search"),modal=$("clientModal"),body=$("clientModalBody");
 let clients=[],appointments=[];
 const closeModal=()=>modal.classList.remove("open");
 modal.addEventListener("click",e=>{if(e.target===modal)closeModal();});
 document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal();});
 const phoneOf=c=>c.whatsapp||c.phone||"";
 // Appointments are linked by client_id; older rows may only carry the WhatsApp number.
 const historyOf=c=>appointments.filter(a=>a.client_id===c.id||(!a.client_id&&digits(phoneOf(c))&&digits(a.client_whatsapp)===digits(phoneOf(c))));
 const completed=c=>historyOf(c).filter(a=>a.status==="completed");
 async function load(){
  const [clientResult,appointmentResult]=await Promise.all([
   supabase.from("clients").select("id,name,phone,whatsapp,created_at").eq("barbershop_id",ctx.shop.id).order("name"),
   supabase.from("appointments").select("id,client_id,client_whatsapp,status,price,starts_at,services(name)").eq("barbershop_id",ctx.shop.id).order("starts_at",{ascending:false})
  ]);
  if(clientResult.error||appointmentResult.error){list.textContent="Erro ao carregar clientes: "+errorText(clientResult.error||appointmentResult.error);return;}
  clients=clientResult.data||[];appointments=appointmentResult.data||[];
  const highlights=document.querySelectorAll(".highlights b"),spans=document.querySelectorAll(".highlights span");
  highlights[0].textContent=clients.length;
  const loyal=[...clients].sort((a,b)=>completed(b).length-completed(a).length)[0];
  highlights[1].textContent=loyal&&completed(loyal).length?loyal.name:"—";
  if(spans[0])spans[0].textContent=loyal&&completed(loyal).length?completed(loyal).length+" atendimentos":"";
  const from=dayStart(monthStart(dayKey())).getTime();
  highlights[2].textContent=clients.filter(c=>completed(c).some(a=>new Date(a.starts_at).getTime()>=from)).length;
  render();
 }
 function render(){
  list.replaceChildren();
  const q=search.value.trim().toLowerCase(),qd=digits(q);
  const filtered=clients.filter(c=>c.name.toLowerCase().includes(q)||(qd&&digits(phoneOf(c)).includes(qd)));
  for(const c of filtered){
   const done=completed(c),last=historyOf(c)[0];
   const row=document.createElement("div");row.className="client-row";
   const name=document.createElement("b");name.textContent=c.name;
   const phone=document.createElement("span");phone.textContent=phoneOf(c)||"Sem telefone";
   const visits=document.createElement("span");visits.textContent=done.length+" atendimento"+(done.length===1?"":"s");
   const lastEl=document.createElement("span");lastEl.textContent=last?"Último: "+dateTime(last.starts_at).slice(0,10):"Sem agendamentos";
   const btn=document.createElement("button");btn.textContent="Ver histórico";btn.onclick=()=>profile(c);
   row.append(name,phone,visits,lastEl,btn);list.append(row);
  }
  if(!filtered.length){const p=document.createElement("p");p.className="empty-note";p.textContent=clients.length?"Nenhum cliente encontrado.":"Nenhum cliente ainda. Os clientes aparecem aqui automaticamente quando agendam.";list.append(p);}
 }
 function profile(c){
  const all=historyOf(c),done=completed(c),spent=done.reduce((n,a)=>n+Number(a.price||0),0);
  const missed=all.filter(a=>a.status==="no_show").length;
  body.innerHTML='<div class="profile"><div class="profile-head"><div><h2></h2><small id="pPhone"></small></div><button class="close" id="pClose" aria-label="Fechar">×</button></div><div class="stats"><div><small>Atendimentos</small><b>'+done.length+'</b></div><div><small>Total gasto</small><b>'+esc(brl(spent))+'</b></div><div><small>Faltas</small><b>'+missed+'</b></div></div><div class="bs-actions"><button id="pEdit">Editar dados</button><button id="pWhats" class="primary">WhatsApp</button></div><h3 style="margin-top:16px">Histórico</h3><div class="history" id="pHistory"></div></div>';
  body.querySelector("h2").textContent=c.name;$("pPhone").textContent=phoneOf(c)||"Sem telefone";
  $("pClose").onclick=closeModal;$("pEdit").onclick=()=>edit(c);
  const link=waLink(phoneOf(c),"Olá, "+c.name+"! Aqui é da "+ctx.shop.name+".");
  if(link)$("pWhats").onclick=()=>window.open(link,"_blank","noopener");else $("pWhats").disabled=true;
  const hist=$("pHistory");
  for(const a of all.slice(0,30)){const d=document.createElement("div");d.innerHTML='<b></b><br><small></small> <span class="st st-'+esc(a.status)+'">'+esc(statusLabel(a.status))+'</span>';d.querySelector("b").textContent=a.services?.name||"Serviço";d.querySelector("small").textContent=dateTime(a.starts_at)+" • "+brl(a.price);hist.append(d);}
  if(!all.length)hist.textContent="Nenhum agendamento registrado.";
  modal.classList.add("open");
 }
 function edit(c){
  body.innerHTML='<form class="profile bs-form" id="clientForm"><h2>'+(c?"Editar cliente":"Novo cliente")+'</h2><label>Nome<input name="name" required minlength="2" maxlength="100"></label><label>WhatsApp<input name="whatsapp" inputmode="tel" placeholder="(21) 99999-9999"></label><div class="bs-actions"><button type="submit" class="primary">Salvar</button><button type="button" id="cCancel">Cancelar</button></div><p class="bs-error" id="clientError" role="alert"></p></form>';
  const form=$("clientForm");form.elements.name.value=c?.name||"";form.elements.whatsapp.value=c?phoneOf(c):"";
  $("cCancel").onclick=closeModal;
  form.onsubmit=async e=>{
   e.preventDefault();
   const name=form.elements.name.value.trim(),whatsapp=form.elements.whatsapp.value.trim();
   if(whatsapp&&digits(whatsapp).length<10){$("clientError").textContent="Informe o WhatsApp com DDD.";return;}
   const payload={name,whatsapp:whatsapp||null,phone:whatsapp||null};
   const {error}=c?await supabase.from("clients").update(payload).eq("id",c.id).eq("barbershop_id",ctx.shop.id):await supabase.from("clients").insert({...payload,barbershop_id:ctx.shop.id});
   if(error){$("clientError").textContent=errorText(error);return;}
   toast("Cliente salvo.","success");closeModal();await load();
  };
  modal.classList.add("open");form.elements.name.focus();
 }
 $("newClient").onclick=()=>edit(null);
 search.addEventListener("input",render);
 await load();
}
