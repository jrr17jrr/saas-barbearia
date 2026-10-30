import {supabase} from "../shared/supabase-client.js";
import {esc,brl,dayKey,addDays,weekday,hm,dateLabel,digits,applyTheme,hasSite,hasChatbot} from "../shared/utils.js";
const slug=new URLSearchParams(location.search).get("loja");
const $=s=>document.querySelector(s);
const images=["/img/disfarcado.jpg","/img/barba.jpg","/img/reflexo.jpg"];
function unavailable(text){
 document.querySelector(".container").innerHTML='<img src="/img/logo.png" class="logo" alt=""><h1>Agendamento indisponível</h1><p style="color:var(--site-muted,#8190a5);margin-top:12px"></p><footer class="visionario-credit"><a href="https://visionariodev.com.br" target="_blank" rel="noopener">Desenvolvido por Visionário Dev</a></footer>';
 document.querySelector(".container p").textContent=text;
}
const socialHref=(key,value)=>{
 if(!value)return null;let v=String(value).trim();
 if(key==="whatsapp"){let n=digits(v);if(n.length<10)return null;if(n.length<=11)n="55"+n;return "https://wa.me/"+n;}
 if(/^https:\/\//i.test(v))return v;
 if(/^http:\/\//i.test(v))return v.replace(/^http:/i,"https:");
 v=v.replace(/^@/,"");
 return {instagram:"https://instagram.com/",tiktok:"https://www.tiktok.com/@",facebook:"https://facebook.com/"}[key]+encodeURIComponent(v);
};
const safeUrl=v=>/^https:\/\//i.test(String(v||"").trim())?String(v).trim():null;
async function main(){
 if(!slug||!/^[a-z0-9-]+$/.test(slug))return unavailable("Link de barbearia inválido. Confira o endereço enviado pela barbearia.");
 const {data:shop,error}=await supabase.from("barbershops").select("id,name,slug,status,plan,description,address,whatsapp,instagram,facebook,tiktok,theme,primary_color,background_color,card_color,review_link,maps_link,public_status_text,logo_url").eq("slug",slug).in("status",["active","demo"]).maybeSingle();
 if(error)return unavailable("Não foi possível carregar a página. Tente novamente em instantes.");
 if(!shop||!hasSite(shop.plan))return unavailable("Esta barbearia não está recebendo agendamentos pelo site no momento.");
 applyTheme(shop);
 const [{data:settings},{data:services},{data:hours}]=await Promise.all([
  supabase.from("barbershop_settings").select("site_enabled,chatbot_enabled").eq("barbershop_id",shop.id).maybeSingle(),
  supabase.from("services").select("id,name,description,price,duration_minutes").eq("barbershop_id",shop.id).eq("active",true).order("sort_order"),
  supabase.from("business_hours").select("weekday,is_open,opens_at,closes_at").eq("barbershop_id",shop.id)
 ]);
 if(settings?.site_enabled===false)return unavailable("O agendamento online desta barbearia está desativado no momento.");
 document.title=shop.name+" | Agendar horário";
 $(".container > h1").textContent=shop.name;
 if(shop.logo_url&&/^https:\/\//.test(shop.logo_url)){$(".container > .logo").src=shop.logo_url;}
 $(".container > .logo").alt="Logo "+shop.name;
 const status=$(".status");status.lastChild.textContent=" "+(shop.public_status_text||"Agende seu horário");
 if(shop.description){const p=document.createElement("p");p.className="shop-description";p.style.cssText="color:var(--site-muted);margin:10px auto 0;max-width:520px;font-size:14px";p.textContent=shop.description;status.after(p);}
 const today=dayKey(),h=hours?.find(x=>x.weekday===weekday(today));
 const info=document.querySelectorAll(".info-card b");
 info[0].textContent=h?.is_open?String(h.opens_at).slice(0,5)+" — "+String(h.closes_at).slice(0,5):"Fechado hoje";
 if(shop.address)info[1].textContent=shop.address;else info[1].closest(".info-card").style.display="none";
 info[2].textContent="Consultando...";
 const social=[...document.querySelectorAll(".social a")],keys=["instagram","whatsapp","facebook","tiktok"];
 social.forEach((a,i)=>{const href=socialHref(keys[i],shop[keys[i]]);if(!href){a.style.display="none";return;}a.href=href;a.target="_blank";a.rel="noopener";});
 const review=safeUrl(shop.review_link);if(review){$(".review-btn").href=review;$(".review-btn").target="_blank";$(".review-btn").rel="noopener";}else $(".reviews").style.display="none";
 const maps=safeUrl(shop.maps_link);
 if(shop.address||maps){
  $(".location iframe").src="https://www.google.com/maps?q="+encodeURIComponent(shop.address||shop.name)+"&output=embed";
  const route=$(".route-btn");route.href=maps||"https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(shop.address);route.target="_blank";route.rel="noopener";
 }else $(".location").style.display="none";
 const section=$(".services");
 if(!services?.length){section.innerHTML="<h2>Serviços</h2><p style=\"color:var(--site-muted)\">Nenhum serviço disponível no momento.</p>";$(".main-schedule-btn").style.display="none";info[2].textContent="—";return;}
 section.innerHTML="<h2>Serviços</h2>"+services.map((s,i)=>'<div class="service-card"><img src="'+images[i%images.length]+'" alt="" loading="lazy"><div class="service-info"><h3>'+esc(s.name)+'</h3><p>'+esc(s.description||"")+'</p><div class="details"><span>'+s.duration_minutes+' min</span><span>'+esc(brl(s.price))+'</span></div><a href="#" class="schedule-btn" data-service="'+i+'">Agendar</a></div></div>').join("");
 const shortest=[...services].sort((a,b)=>a.duration_minutes-b.duration_minutes)[0];
 supabase.rpc("available_booking_slots",{p_slug:slug,p_service_id:shortest.id,p_day:today}).then(({data,error})=>{info[2].textContent=error?"—":(data?.length?data.length+" horários livres":"Sem horários livres");});
 booking(shop,services,hours||[]);
 if(hasChatbot(shop.plan)&&settings?.chatbot_enabled!==false){
  const a=document.createElement("a");a.className="chatbot-launch";a.href="/chatbot/?loja="+encodeURIComponent(slug);a.textContent="Conversar e agendar";a.style.textDecoration="none";document.body.append(a);
 }
}
function booking(shop,services,hours){
 document.body.insertAdjacentHTML("beforeend",'<div class="booking-overlay" id="bookingOverlay" role="dialog" aria-modal="true" aria-label="Agendar horário"><div class="booking-modal"><div class="booking-handle"></div><div class="booking-header"><div><small>'+esc(shop.name)+'</small><h2>Agendar horário</h2></div><button class="booking-close" aria-label="Fechar">×</button></div><div class="booking-progress"><span></span><span></span><span></span><span></span></div><div id="bookingContent"></div></div></div>');
 const overlay=document.getElementById("bookingOverlay"),content=document.getElementById("bookingContent");
 let state={};
 const progress=n=>document.querySelectorAll(".booking-progress span").forEach((x,i)=>x.classList.toggle("active",i<n));
 const selected=()=>'<div class="booking-selected"><b>'+esc(state.service.name)+'</b><small>'+state.service.duration_minutes+' min • '+esc(brl(state.service.price))+'</small></div>';
 const open=service=>{state={service,day:null,slot:null,name:"",phone:""};overlay.classList.add("open");document.body.classList.add("booking-open");service?renderDate():renderServices();};
 const close=()=>{overlay.classList.remove("open");document.body.classList.remove("booking-open");};
 function renderServices(){
  progress(1);
  content.innerHTML='<p class="booking-step-title">Escolha o serviço</p><div class="booking-service-list">'+services.map((s,i)=>'<button class="booking-service-option" data-i="'+i+'"><div><b>'+esc(s.name)+'</b><small>'+esc(s.description||"")+'</small></div><span>'+esc(brl(s.price))+'<small>'+s.duration_minutes+' min</small></span></button>').join("")+'</div>';
  content.querySelectorAll("[data-i]").forEach(b=>b.onclick=()=>{state.service=services[+b.dataset.i];renderDate();});
 }
 function renderDate(){
  progress(2);
  const days=[];for(let i=0;i<21&&days.length<10;i++){const key=addDays(dayKey(),i);const h=hours.find(x=>x.weekday===weekday(key));if(h?.is_open)days.push(key);}
  content.innerHTML=selected()+'<p class="booking-step-title">Escolha o dia</p><div class="booking-days">'+(days.map((k,i)=>'<button class="booking-day" data-day="'+k+'"><b>'+(k===dayKey()?"HOJE":esc(dateLabel(k,{weekday:"short"}).replace(".","").toUpperCase()))+'</b><small>'+k.slice(8)+'/'+k.slice(5,7)+'</small></button>').join("")||"<p>Sem dias de atendimento configurados.</p>")+'</div><div class="booking-actions"><button class="booking-back">Voltar</button><button class="booking-next" disabled>Ver horários</button></div>';
  const next=content.querySelector(".booking-next");
  content.querySelectorAll(".booking-day").forEach(b=>b.onclick=()=>{content.querySelectorAll(".booking-day").forEach(x=>x.classList.toggle("active",x===b));state.day=b.dataset.day;next.disabled=false;});
  content.querySelector(".booking-back").onclick=renderServices;next.onclick=renderTime;
 }
 async function renderTime(){
  progress(3);
  content.innerHTML='<div class="booking-selected"><b>'+esc(state.service.name)+'</b><small>'+esc(dateLabel(state.day))+'</small></div><p class="booking-step-title">Horários disponíveis</p><div class="booking-times"><p>Consultando horários livres...</p></div><div class="booking-actions"><button class="booking-back">Voltar</button><button class="booking-next" disabled>Continuar</button></div>';
  content.querySelector(".booking-back").onclick=renderDate;
  const {data,error}=await supabase.rpc("available_booking_slots",{p_slug:slug,p_service_id:state.service.id,p_day:state.day});
  const box=content.querySelector(".booking-times");if(!box)return;
  if(error){box.innerHTML='<p>Não foi possível consultar os horários. Tente novamente.</p>';return;}
  if(!data?.length){box.innerHTML='<p>Não há horários livres neste dia. Escolha outra data.</p>';return;}
  box.innerHTML=data.map(s=>'<button class="booking-time" data-slot="'+esc(s.slot_start)+'">'+hm(s.slot_start)+'</button>').join("");
  const next=content.querySelector(".booking-next");
  box.querySelectorAll(".booking-time").forEach(b=>b.onclick=()=>{box.querySelectorAll(".booking-time").forEach(x=>x.classList.toggle("active",x===b));state.slot=b.dataset.slot;next.disabled=false;});
  next.onclick=renderData;
 }
 function renderData(){
  progress(4);
  content.innerHTML='<div class="booking-selected"><b>'+esc(dateLabel(state.day,{weekday:"short",day:"2-digit",month:"2-digit"}))+' às '+hm(state.slot)+'</b><small>'+esc(state.service.name)+' • '+esc(brl(state.service.price))+'</small></div><p class="booking-step-title">Seus dados</p><label class="booking-label">Nome<input id="bookingName" autocomplete="name" maxlength="100" placeholder="Ex.: João Silva"></label><label class="booking-label">WhatsApp<input id="bookingPhone" inputmode="tel" autocomplete="tel" placeholder="(21) 99999-9999"></label><p class="booking-demo-note" id="bookingError" role="alert"></p><div class="booking-actions"><button class="booking-back">Voltar</button><button class="booking-next">Revisar agendamento</button></div>';
  document.getElementById("bookingName").value=state.name;document.getElementById("bookingPhone").value=state.phone;
  content.querySelector(".booking-back").onclick=renderTime;
  content.querySelector(".booking-next").onclick=()=>{state.name=document.getElementById("bookingName").value.trim();state.phone=document.getElementById("bookingPhone").value.trim();if(state.name.length<2){document.getElementById("bookingError").textContent="Informe seu nome.";return;}if(digits(state.phone).length<10){document.getElementById("bookingError").textContent="Informe seu WhatsApp com DDD.";return;}renderConfirm();};
 }
 function renderConfirm(){
  progress(4);
  content.innerHTML='<p class="booking-step-title">Confira seu agendamento</p><div class="booking-summary"><b>'+esc(state.service.name)+'</b><span>📅 '+esc(dateLabel(state.day))+'</span><span>🕒 '+hm(state.slot)+'</span><span>⏱ '+state.service.duration_minutes+' min</span><span>💰 '+esc(brl(state.service.price))+'</span><span>👤 '+esc(state.name)+'</span><span>📱 '+esc(state.phone)+'</span></div><p class="booking-demo-note" id="bookingError" role="alert"></p><div class="booking-actions"><button class="booking-back">Voltar</button><button class="booking-next">Confirmar agendamento</button></div>';
  content.querySelector(".booking-back").onclick=renderData;
  const confirmBtn=content.querySelector(".booking-next");
  confirmBtn.onclick=async()=>{
   confirmBtn.disabled=true;confirmBtn.textContent="Confirmando...";
   const {error}=await supabase.rpc("create_public_booking",{p_slug:slug,p_service_id:state.service.id,p_client_name:state.name,p_client_whatsapp:state.phone,p_starts_at:new Date(state.slot).toISOString()});
   if(error){
    const taken=/indispon/i.test(error.message);
    document.getElementById("bookingError").textContent=taken?"Este horário acabou de ser reservado por outra pessoa. Escolha outro horário.":"Não foi possível agendar: "+error.message;
    confirmBtn.disabled=false;confirmBtn.textContent=taken?"Escolher outro horário":"Tentar novamente";
    if(taken)confirmBtn.onclick=renderTime;
    return;
   }
   const wa=socialHref("whatsapp",shop.whatsapp);
   content.innerHTML='<div class="booking-success"><div>✓</div><h3>Agendamento confirmado!</h3><p>'+esc(state.service.name)+'<br>'+esc(dateLabel(state.day))+' às '+hm(state.slot)+'</p><small>Guarde esta informação. Em caso de imprevisto, avise a barbearia.</small>'+(wa?'<a class="booking-next" style="display:block;text-align:center;text-decoration:none;margin-top:10px" target="_blank" rel="noopener" href="'+esc(wa+"?text="+encodeURIComponent("Olá! Acabei de agendar "+state.service.name+" em "+dateLabel(state.day,{day:"2-digit",month:"2-digit"})+" às "+hm(state.slot)+". Nome: "+state.name))+'">Avisar no WhatsApp</a>':"")+'<button class="booking-next" id="bookingDone">Fechar</button></div>';
   document.getElementById("bookingDone").onclick=close;
  };
 }
 document.querySelector(".main-schedule-btn").addEventListener("click",e=>{e.preventDefault();open(null);});
 document.querySelector(".services").addEventListener("click",e=>{const b=e.target.closest(".schedule-btn");if(!b)return;e.preventDefault();open(services[+b.dataset.service]);});
 overlay.querySelector(".booking-close").onclick=close;
 overlay.addEventListener("click",e=>{if(e.target===overlay)close();});
 document.addEventListener("keydown",e=>{if(e.key==="Escape")close();});
}
await main();
