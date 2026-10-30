import {supabase} from "../shared/supabase-client.js";
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),slug=params.get("loja");
const messages=$("chatMessages"),options=$("chatOptions"),bar=$("chatInputbar"),input=$("chatInput");
function say(message,isUser=false){const el=document.createElement("div");el.className="msg"+(isUser?" user":"");el.textContent=message;messages.append(el);messages.scrollTop=messages.scrollHeight;}
function choose(items,callback){options.replaceChildren();bar.classList.add("hidden");for(const item of items){const button=document.createElement("button");button.textContent=item.label;button.onclick=()=>{say(item.label,true);options.replaceChildren();callback(item.value);};options.append(button);}}
function ask(placeholder,callback){options.replaceChildren();bar.classList.remove("hidden");input.placeholder=placeholder;input.value="";const send=()=>{const value=input.value.trim();if(!value)return;say(value,true);bar.classList.add("hidden");callback(value);};$("chatSend").onclick=send;input.onkeydown=e=>{if(e.key==="Enter")send();};}
if(!slug||!/^[a-z0-9-]+$/.test(slug)){say("Link de atendimento inválido.");}
else{
const {data:shop,error}=await supabase.from("barbershops").select("id,name,logo_url,plan,status").eq("slug",slug).in("status",["active","demo"]).maybeSingle();
if(error||!shop||shop.plan==="site"){say("Chatbot indisponível para esta barbearia.");}
else{
const [{data:settings},{data:services},{data:hours}]=await Promise.all([
supabase.from("barbershop_settings").select("chatbot_enabled,chatbot_name,chatbot_greeting").eq("barbershop_id",shop.id).maybeSingle(),
supabase.from("services").select("id,name,price,duration_minutes").eq("barbershop_id",shop.id).eq("active",true).order("sort_order"),
supabase.from("business_hours").select("weekday,is_open,opens_at,closes_at").eq("barbershop_id",shop.id)
]);
$("shopName").textContent=shop.name;if(shop.logo_url)$("shopLogo").src=shop.logo_url;
$("botName").textContent=settings?.chatbot_name||"Assistente";
if(settings?.chatbot_enabled===false){say("Atendimento pelo chatbot desativado.");}
else if(!services?.length){say("Nenhum serviço disponível no momento.");}
else{
const state={};
say(settings?.chatbot_greeting||"Olá! Vou ajudar você a agendar seu horário.");
function begin(){say("Qual é seu nome?");ask("Seu nome",name=>{if(name.length<2){say("Informe seu nome completo.");return begin();}state.name=name;phone();});}
function phone(){say("Qual é seu WhatsApp com DDD?");ask("21999999999",value=>{if(value.replace(/\D/g,"").length<10){say("Número inválido.");return phone();}state.phone=value;service();});}
function service(){say("Escolha o serviço:");choose(services.map(s=>({label:s.name+" • R$ "+Number(s.price).toFixed(2),value:s})),s=>{state.service=s;pickDate();});}
function pickDate(){say("Escolha o dia:");const dates=[];for(let i=0;i<14;i++){const date=new Date();date.setHours(12,0,0,0);date.setDate(date.getDate()+i);const h=hours?.find(x=>x.weekday===date.getDay());if(h?.is_open)dates.push({label:date.toLocaleDateString("pt-BR",{weekday:"short",day:"2-digit",month:"2-digit"}),value:date});}if(!dates.length){say("Sem expediente configurado para os próximos dias.");return;}choose(dates,date=>{state.date=date;pickTime();});}
async function pickTime(){say("Consultando horários disponíveis...");const day=[state.date.getFullYear(),String(state.date.getMonth()+1).padStart(2,"0"),String(state.date.getDate()).padStart(2,"0")].join("-");const {data,error}=await supabase.rpc("available_booking_slots",{p_slug:slug,p_service_id:state.service.id,p_day:day});if(error){say("Não foi possível consultar os horários: "+error.message);choose([{label:"Escolher outra data",value:1}],pickDate);return;}const slots=(data||[]).map(s=>{const date=new Date(s.slot_start);return {label:date.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit",timeZone:"America/Sao_Paulo"}),value:date};});if(!slots.length){say("Não há horários livres neste dia.");choose([{label:"Escolher outra data",value:1}],pickDate);return;}say("Escolha um horário disponível:");choose(slots,date=>{state.starts=date;review();});}
function review(){say("Confira: "+state.name+" • "+state.service.name+" • "+state.starts.toLocaleString("pt-BR")+" • "+state.phone);choose([{label:"Confirmar",value:true},{label:"Alterar",value:false}],async ok=>{if(!ok)return service();say("Verificando e registrando seu horário...");const {error:bookingError}=await supabase.rpc("create_public_booking",{p_slug:slug,p_service_id:state.service.id,p_client_name:state.name,p_client_whatsapp:state.phone,p_starts_at:state.starts.toISOString()});if(bookingError){say("Não foi possível reservar: "+bookingError.message);say("Escolha outro horário.");return pickTime();}say("Agendamento confirmado!");choose([{label:"Agendar outro horário",value:1}],begin);});}
begin();
}
}
}
