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
const today=new Date();$("date").min=[today.getFullYear(),String(today.getMonth()+1).padStart(2,"0"),String(today.getDate()).padStart(2,"0")].join("-");
$("booking").onsubmit=async event=>{
event.preventDefault();const starts=new Date($("date").value+"T"+$("time").value+":00");
if(!Number.isFinite(starts.getTime())||starts<=new Date()){status.textContent="Escolha uma data e horário futuros.";return;}
$("submit").disabled=true;status.textContent="Confirmando disponibilidade...";
const {error:bookingError}=await supabase.rpc("create_public_booking",{p_slug:slug,p_service_id:$("service").value,p_client_name:$("name").value.trim(),p_client_whatsapp:$("phone").value,p_starts_at:starts.toISOString()});
$("submit").disabled=false;
if(bookingError){status.textContent="Não foi possível agendar: "+bookingError.message;return;}
status.textContent="Agendamento registrado com sucesso!";$("booking").reset();
};
}
}
}
}
