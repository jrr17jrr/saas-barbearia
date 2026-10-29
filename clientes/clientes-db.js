import {supabase} from "../shared/supabase-client.js";
import {ownerContext} from "../shared/owner-context.js";
const ctx=await ownerContext();
if(ctx){
 const list=document.getElementById("clientList"),search=document.getElementById("search");
 const [clientResult,appointmentResult]=await Promise.all([
 supabase.from("clients").select("id,name,phone,whatsapp").eq("barbershop_id",ctx.shop.id),
 supabase.from("appointments").select("client_id,client_whatsapp,status,price").eq("barbershop_id",ctx.shop.id)
 ]);
 if(clientResult.error||appointmentResult.error){list.textContent="Erro ao carregar clientes."; }
 else{
 const clients=clientResult.data||[],appointments=appointmentResult.data||[];
 const count=c=>appointments.filter(a=>a.client_id===c.id||(!a.client_id&&a.client_whatsapp===(c.whatsapp||c.phone))).length;
 const highlights=document.querySelectorAll(".highlights b");
 if(highlights[0])highlights[0].textContent=clients.length;
 if(highlights[1])highlights[1].textContent=clients.length?[...clients].sort((a,b)=>count(b)-count(a))[0].name:"Nenhum";
 if(highlights[2])highlights[2].textContent="—";
 function render(){
 list.replaceChildren();
 const filtered=clients.filter(c=>c.name.toLowerCase().includes(search.value.toLowerCase()));
 for(const c of filtered){
 const row=document.createElement("div");row.className="client-row";
 const name=document.createElement("b");name.textContent=c.name;
 const phone=document.createElement("span");phone.textContent=c.whatsapp||c.phone||"Sem telefone";
 const visits=document.createElement("span");visits.textContent=count(c)+" agendamentos";
 row.append(name,phone,visits);list.append(row);
 }
 if(!filtered.length)list.textContent="Nenhum cliente encontrado.";
 }
 search.addEventListener("input",render);render();
 }
}
