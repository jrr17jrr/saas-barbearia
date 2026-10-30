import {supabase} from "../shared/supabase-client.js";
const $=id=>document.getElementById(id),slug=new URLSearchParams(location.search).get("loja");
const status=$("status");
if(!slug||!/^[a-z0-9-]+$/.test(slug)){status.textContent="Link de barbearia inválido.";$("booking").hidden=true;}
else{
const {data:shop,error}=await supabase.from("barbershops").select("id,name,status,plan").eq("slug",slug).in("status",["active","demo"]).maybeSingle();
if(error||!shop||shop.plan==="chatbot"){status.textContent="Agendamento indisponível para esta barbearia.";$("booking").hidden=true;}
else{
$("shopName").textContent=shop.name;
const {data:settings}=await supabase.from("barbershop_settings").select("site_enabled").eq("barbershop_id",shop.id).maybeSingle();
if(settings?.site_enabled===false){status.textContent="Agendamento online desativado.";$("booking").hidden=true;}
else{
const {data:services,error:serviceError}=await supabase.from("services").select("id,name,price,duration_minutes").eq("barbershop_id",shop.id).eq("active",true).order("sort_order");
if(serviceError||!services?.length){status.textContent="Nenhum serviço disponível.";$("booking").hidden=true;}
else{
for(const s of services){const opt=document.createElement("option");opt.value=s.id;opt.textContent=s.name+" — "+new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(s.price)+" • "+s.duration_minutes+" min";$("service").append(opt);}
const today=new Date();$("date").max=(()=>{const d=new Date();d.setDate(d.getDate()+90);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");})();$("date").min=[today.getFullYear(),String(today.getMonth()+1).padStart(2,"0"),String(today.getDate()).padStart(2,"0")].join("-");
const time=$("time"),selector=document.createElement("select");selector.id="availableTime";selector.required=true;time.replaceWith(selector);const label=selector.closest("label");if(label)label.firstChild.textContent="Horários disponíveis";
async function loadSlots(){selector.replaceChildren();const opt=document.createElement("option");opt.value="";opt.textContent="Selecione um horário";selector.append(opt);selector.disabled=true;if(!$("date").value||!$("service").value)return;status.textContent="Consultando horários disponíveis...";const {data,error}=await supabase.rpc("available_booking_slots",{p_slug:slug,p_service_id:$("service").value,p_day:$("date").value});if(error){status.textContent="Erro ao consultar horários: "+error.message;return;}for(const slot of data||[]){const date=new Date(slot.slot_start);const option=document.createElement("option");option.value=slot.slot_start;option.textContent=date.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit",timeZone:"America/Sao_Paulo"});selector.append(option);}selector.disabled=!(data||[]).length;status.textContent=selector.disabled?"Sem horários disponíveis para esta data.":"Escolha um dos horários livres.";}
$("date").addEventListener("change",loadSlots);$("service").addEventListener("change",loadSlots);
$("booking").onsubmit=async event=>{
event.preventDefault();const starts=new Date(selector.value);
if(!Number.isFinite(starts.getTime())||starts<=new Date()){status.textContent="Escolha uma data e horário futuros.";return;}
$("submit").disabled=true;status.textContent="Confirmando disponibilidade...";
const {error:bookingError}=await supabase.rpc("create_public_booking",{p_slug:slug,p_service_id:$("service").value,p_client_name:$("name").value.trim(),p_client_whatsapp:$("phone").value,p_starts_at:starts.toISOString()});
$("submit").disabled=false;
if(bookingError){status.textContent="Não foi possível agendar: "+bookingError.message;await loadSlots();return;}
status.textContent="Agendamento registrado com sucesso!";$("booking").reset();await loadSlots();status.textContent="Agendamento registrado com sucesso!";
};
}
}
}
}
