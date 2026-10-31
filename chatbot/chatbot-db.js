import {supabase} from "../shared/supabase-client.js";
import {THEMES,hasChatbot,brl} from "../shared/utils.js";
const isLight=hex=>{const c=String(hex||"#000000").replace("#","");const r=parseInt(c.slice(0,2),16),g=parseInt(c.slice(2,4),16),b=parseInt(c.slice(4,6),16);return (r*299+g*587+b*114)/1000>170;};
function applyChatTheme(shop,settings){const preset=settings?.chatbot_sync_with_site===false?THEMES[settings?.chatbot_theme]:null;const t=preset||{primary:shop.primary_color||THEMES.cyan.primary,background:shop.background_color||THEMES.cyan.background,card:shop.card_color||THEMES.cyan.card};const light=isLight(t.background),cardLight=isLight(t.card);const v={"--p":t.primary,"--pt":isLight(t.primary)?"#111827":"#fff","--bg":t.background,"--card":t.card,"--surface":light?"#f1f5f9":"#0d1728","--text":light?"#111827":"#fff","--card-text":cardLight?"#111827":"#fff","--surface-text":light?"#111827":"#fff","--muted":light?"#64748b":"#8190a5","--border":light?"#dbe3ee":"#223149"};for(const [k,x] of Object.entries(v))document.documentElement.style.setProperty(k,x);}
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),slug=params.get("loja");
const messages=$("chatMessages"),options=$("chatOptions"),bar=$("chatInputbar"),input=$("chatInput");
function say(message,isUser=false){const el=document.createElement("div");el.className="msg"+(isUser?" user":"");el.textContent=message;messages.append(el);messages.scrollTop=messages.scrollHeight;}
function choose(items,callback,cls=""){options.replaceChildren();options.className="options"+(cls?" "+cls:"");bar.classList.add("hidden");for(const item of items){const button=document.createElement("button");button.textContent=item.label;button.onclick=()=>{say(item.label,true);options.replaceChildren();callback(item.value);};options.append(button);}}
function ask(placeholder,callback){options.replaceChildren();bar.classList.remove("hidden");input.placeholder=placeholder;input.value="";const send=()=>{const value=input.value.trim();if(!value)return;say(value,true);bar.classList.add("hidden");callback(value);};$("chatSend").onclick=send;input.onkeydown=e=>{if(e.key==="Enter")send();};}
if(!slug||!/^[a-z0-9-]+$/.test(slug)){say("Link de atendimento inválido.");}
else{
const {data:shop,error}=await supabase.from("barbershops").select("id,name,logo_url,plan,status,theme,primary_color,background_color,card_color").eq("slug",slug).in("status",["active","demo"]).maybeSingle();
if(error||!shop||!hasChatbot(shop.plan)){say("Chatbot indisponível para esta barbearia.");}
else{
const [{data:settings},{data:services},{data:hours}]=await Promise.all([
supabase.from("barbershop_settings").select("chatbot_enabled,chatbot_name,chatbot_greeting,chatbot_sync_with_site,chatbot_theme").eq("barbershop_id",shop.id).maybeSingle(),
supabase.from("services").select("id,name,price,duration_minutes").eq("barbershop_id",shop.id).eq("active",true).order("sort_order"),
supabase.from("business_hours").select("weekday,is_open,opens_at,closes_at").eq("barbershop_id",shop.id)
]);
applyChatTheme(shop,settings);document.title=shop.name+" | Agendamento";$("shopName").textContent=shop.name;if(shop.logo_url&&/^https:\/\//.test(shop.logo_url))$("shopLogo").src=shop.logo_url;$("shopLogo").alt="Logo "+shop.name;document.querySelector(".avatar").textContent=(settings?.chatbot_name||"A").slice(0,1).toUpperCase();
$("botName").textContent=settings?.chatbot_name||"Assistente";
if(settings?.chatbot_enabled===false){say("Atendimento pelo chatbot desativado.");}
else if(!services?.length){say("Nenhum serviço disponível no momento.");}
else{
const state={};
say(settings?.chatbot_greeting||"Olá! Vou ajudar você a agendar seu horário.");
function begin(){say("Qual é seu nome?");ask("Seu nome",name=>{if(name.length<2){say("Informe seu nome completo.");return begin();}state.name=name;phone();});}
function phone(){say("Qual é seu WhatsApp com DDD?");ask("21999999999",value=>{if(value.replace(/\D/g,"").length<10){say("Número inválido.");return phone();}state.phone=value;service();});}
function service(){say("Escolha o serviço:");choose(services.map(s=>({label:s.name+" • "+brl(s.price)+" • "+s.duration_minutes+" min",value:s})),s=>{state.service=s;pickDate();});}
function pickDate(){say("Escolha o dia:");const dates=[];for(let i=0;i<14;i++){const date=new Date();date.setHours(12,0,0,0);date.setDate(date.getDate()+i);const h=hours?.find(x=>x.weekday===date.getDay());if(h?.is_open)dates.push({label:date.toLocaleDateString("pt-BR",{weekday:"short",day:"2-digit",month:"2-digit"}),value:date});}if(!dates.length){say("Sem expediente configurado para os próximos dias.");return;}choose(dates,date=>{state.date=date;pickTime();});}
async function pickTime(){say("Consultando horários disponíveis...");const day=[state.date.getFullYear(),String(state.date.getMonth()+1).padStart(2,"0"),String(state.date.getDate()).padStart(2,"0")].join("-");const {data,error}=await supabase.rpc("available_booking_slots",{p_slug:slug,p_service_id:state.service.id,p_day:day});if(error){say("Não foi possível consultar os horários: "+error.message);choose([{label:"Escolher outra data",value:1}],pickDate);return;}const slots=(data||[]).map(s=>{const date=new Date(s.slot_start);return {label:date.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit",timeZone:"America/Sao_Paulo"}),value:date};});if(!slots.length){say("Não há horários livres neste dia.");choose([{label:"Escolher outra data",value:1}],pickDate);return;}say("Escolha um horário disponível:");choose(slots,date=>{state.starts=date;review();},"times");}
function review(){say("Confira: "+state.name+" • "+state.service.name+" • "+state.starts.toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo",weekday:"short",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})+" • "+state.phone);choose([{label:"Confirmar",value:true},{label:"Alterar",value:false}],async ok=>{if(!ok)return service();say("Verificando e registrando seu horário...");const {error:bookingError}=await supabase.rpc("create_public_booking",{p_slug:slug,p_service_id:state.service.id,p_client_name:state.name,p_client_whatsapp:state.phone,p_starts_at:state.starts.toISOString()});if(bookingError){say("Não foi possível reservar: "+bookingError.message);say("Escolha outro horário.");return pickTime();}say("Agendamento confirmado!");choose([{label:"Agendar outro horário",value:1}],begin);});}
begin();
}
}
}
