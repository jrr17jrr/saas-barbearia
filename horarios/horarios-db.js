import {supabase} from "../shared/supabase-client.js";
import {ownerContext} from "../shared/owner-context.js";
const ctx=await ownerContext();
if(ctx){
const days=["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];
const week=document.getElementById("week"),blocks=document.getElementById("blocks"),modal=document.getElementById("blockModal"),body=document.getElementById("blockBody");
let hours=[],blocked=[];
async function load(){
 const [h,b]=await Promise.all([supabase.from("business_hours").select("id,weekday,is_open,opens_at,closes_at").eq("barbershop_id",ctx.shop.id),supabase.from("blocked_times").select("id,starts_at,ends_at,reason").eq("barbershop_id",ctx.shop.id).gte("ends_at",new Date().toISOString()).order("starts_at")]);
 if(h.error||b.error){week.textContent="Erro ao carregar horários.";return;}
 hours=h.data;blocked=b.data;render();
}
function render(){
 week.replaceChildren();
 for(let i=0;i<7;i++){
 const item=hours.find(x=>x.weekday===i)||{weekday:i,is_open:false,opens_at:"08:00",closes_at:"17:00"};
 const row=document.createElement("div");row.className="day-row";
 const label=document.createElement("b");label.textContent=days[i];
 const active=document.createElement("input");active.type="checkbox";active.checked=item.is_open;active.dataset.day=i;active.dataset.field="is_open";
 const open=document.createElement("input");open.type="time";open.value=(item.opens_at||"08:00").slice(0,5);open.dataset.day=i;open.dataset.field="opens_at";
 const close=document.createElement("input");close.type="time";close.value=(item.closes_at||"17:00").slice(0,5);close.dataset.day=i;close.dataset.field="closes_at";
 row.append(label,active,open,document.createTextNode(" até "),close);week.append(row);
 }
 blocks.replaceChildren();
 for(const b of blocked){
 const row=document.createElement("div");row.className="block-row";
 const name=document.createElement("b");name.textContent=b.reason||"Bloqueado";
 const time=document.createElement("span");time.textContent=new Date(b.starts_at).toLocaleString("pt-BR")+" — "+new Date(b.ends_at).toLocaleString("pt-BR");
 const remove=document.createElement("button");remove.textContent="Remover";remove.onclick=async()=>{const {error}=await supabase.from("blocked_times").delete().eq("id",b.id).eq("barbershop_id",ctx.shop.id);if(error)alert(error.message);else load();};
 row.append(name,time,remove);blocks.append(row);
 }
 if(!blocked.length)blocks.textContent="Nenhum bloqueio futuro.";
}
document.getElementById("saveHours").onclick=async()=>{
 const rows=[...week.querySelectorAll(".day-row")];
 const payload=rows.map(row=>{const fields=row.querySelectorAll("input");return{barbershop_id:ctx.shop.id,weekday:Number(fields[0].dataset.day),is_open:fields[0].checked,opens_at:fields[1].value,closes_at:fields[2].value};});
 if(payload.some(x=>x.is_open&&x.closes_at<=x.opens_at)){alert("Confira os horários de abertura e fechamento.");return;}
 for(const entry of payload){
 const existing=hours.find(x=>x.weekday===entry.weekday);
 const query=existing?supabase.from("business_hours").update(entry).eq("id",existing.id).eq("barbershop_id",ctx.shop.id):supabase.from("business_hours").insert(entry);
 const {error}=await query;if(error){alert(error.message);return;}
 }
 alert("Horários salvos.");await load();
};
document.getElementById("addBlock").onclick=()=>{
 body.innerHTML='<form id="blockForm"><h2>Novo bloqueio</h2><label>Início<input type="datetime-local" name="start" required></label><label>Fim<input type="datetime-local" name="end" required></label><label>Motivo<input name="reason"></label><button>Salvar</button><button type="button" id="closeBlock">Cancelar</button><p id="blockError"></p></form>';
 modal.classList.add("open");document.getElementById("closeBlock").onclick=()=>modal.classList.remove("open");
 document.getElementById("blockForm").onsubmit=async e=>{
 e.preventDefault();const form=e.currentTarget,begin=new Date(form.elements.start.value),end=new Date(form.elements.end.value);
 if(end<=begin){document.getElementById("blockError").textContent="Horário final inválido.";return;}
 const {error}=await supabase.from("blocked_times").insert({barbershop_id:ctx.shop.id,starts_at:begin.toISOString(),ends_at:end.toISOString(),reason:form.elements.reason.value});
 if(error)document.getElementById("blockError").textContent=error.message;else{modal.classList.remove("open");await load();}
 };
};
await load();
}
