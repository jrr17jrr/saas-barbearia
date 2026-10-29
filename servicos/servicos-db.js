import {supabase} from "../shared/supabase-client.js";
import {ownerContext} from "../shared/owner-context.js";
const ctx=await ownerContext();
const box=document.getElementById("services");
const modal=document.getElementById("serviceModal");
const body=document.getElementById("serviceBody");
let services=[];
const currency=v=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(v)||0);
async function load(){
 const {data,error}=await supabase.from("services").select("id,name,price,duration_minutes,active").eq("barbershop_id",ctx.shop.id).order("sort_order");
 if(error){box.textContent="Erro ao carregar serviços: "+error.message;return;}
 services=data;
 box.replaceChildren();
 if(!data.length)box.textContent="Nenhum serviço cadastrado.";
 for(const s of data){
 const item=document.createElement("div");item.className="service";
 const name=document.createElement("div");const title=document.createElement("b");title.textContent=s.name;name.append(title);
 const price=document.createElement("div");price.textContent=currency(s.price);
 const duration=document.createElement("div");duration.textContent=s.duration_minutes+" min";
 const edit=document.createElement("button");edit.textContent="Editar";edit.onclick=()=>open(s);
 item.append(name,price,duration,edit);box.append(item);
 }
}
function open(s){
 body.replaceChildren();
 const form=document.createElement("form");
 form.innerHTML='<h2>Serviço</h2><label>Nome <input name="name" required maxlength="100"></label><label>Preço <input name="price" type="number" min="0" step="0.01" required></label><label>Duração (min) <input name="duration" type="number" min="5" max="480" required></label><label><input name="active" type="checkbox"> Ativo</label><button type="submit">Salvar</button><button type="button" id="cancelService">Cancelar</button><p id="serviceError" role="alert"></p>';
 form.elements.name.value=s?.name||"";
 form.elements.price.value=s?.price??"";
 form.elements.duration.value=s?.duration_minutes??30;
 form.elements.active.checked=s?.active??true;
 form.querySelector("#cancelService").onclick=()=>modal.classList.remove("open");
 form.onsubmit=async e=>{
 e.preventDefault();
 const payload={name:form.elements.name.value.trim(),price:Number(form.elements.price.value),duration_minutes:Number(form.elements.duration.value),active:form.elements.active.checked,barbershop_id:ctx.shop.id};
 const query=s?supabase.from("services").update(payload).eq("id",s.id).eq("barbershop_id",ctx.shop.id):supabase.from("services").insert(payload);
 const {error}=await query;
 if(error){form.querySelector("#serviceError").textContent=error.message;return;}
 modal.classList.remove("open");await load();
 };
 body.append(form);modal.classList.add("open");
}
if(ctx){document.getElementById("add").onclick=()=>open(null);await load();}
