import {supabase} from "../shared/supabase-client.js";
import {ownerContext} from "../shared/owner-context.js";
import {brl,esc,toast,errorText} from "../shared/utils.js";
const ctx=await ownerContext();
const box=document.getElementById("services");
const modal=document.getElementById("serviceModal");
const body=document.getElementById("serviceBody");
let services=[];
const closeModal=()=>modal.classList.remove("open");
modal.addEventListener("click",e=>{if(e.target===modal)closeModal();});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal();});
async function load(){
 const {data,error}=await supabase.from("services").select("id,name,description,price,duration_minutes,active,sort_order").eq("barbershop_id",ctx.shop.id).order("sort_order").order("name");
 if(error){box.textContent="Erro ao carregar serviços: "+errorText(error);return;}
 services=data||[];
 box.replaceChildren();
 if(!services.length){const p=document.createElement("p");p.className="empty-note";p.textContent="Nenhum serviço cadastrado. Clique em “+ Novo serviço” para começar.";box.append(p);}
 for(const s of services){
  const item=document.createElement("div");item.className="service";if(!s.active)item.style.opacity=".6";
  const name=document.createElement("div");
  name.innerHTML='<b></b>'+(s.active?'<span class="bs-badge" style="background:#14532d;color:#bbf7d0">Ativo</span>':'<span class="bs-badge">Inativo</span>')+'<small></small>';
  name.querySelector("b").textContent=s.name;name.querySelector("small").textContent=s.description||"";
  const price=document.createElement("div");price.textContent=brl(s.price);
  const duration=document.createElement("div");duration.textContent=s.duration_minutes+" min";
  const actions=document.createElement("div");actions.style.cssText="display:flex;gap:6px;flex-wrap:wrap";
  const edit=document.createElement("button");edit.textContent="Editar";edit.onclick=()=>open(s);
  const toggle=document.createElement("button");toggle.textContent=s.active?"Desativar":"Ativar";toggle.onclick=()=>setActive(s,!s.active);
  actions.append(edit,toggle);
  item.append(name,price,duration,actions);box.append(item);
 }
}
async function setActive(s,active){
 const {error}=await supabase.from("services").update({active}).eq("id",s.id).eq("barbershop_id",ctx.shop.id);
 if(error)toast(errorText(error),"error");else{toast(active?"Serviço ativado.":"Serviço desativado. Ele não aparece mais para os clientes.","success");await load();}
}
async function remove(s){
 if(!confirm("Excluir o serviço “"+s.name+"”? Esta ação não pode ser desfeita."))return;
 const {error}=await supabase.from("services").delete().eq("id",s.id).eq("barbershop_id",ctx.shop.id);
 if(error){
  if(error.code==="23503"){if(confirm("Este serviço possui agendamentos e não pode ser excluído. Deseja desativá-lo?")){closeModal();await setActive(s,false);}return;}
  toast(errorText(error),"error");return;
 }
 toast("Serviço excluído.","success");closeModal();await load();
}
function open(s){
 body.replaceChildren();
 const form=document.createElement("form");form.className="form bs-form";
 form.innerHTML='<h2>'+(s?"Editar serviço":"Novo serviço")+'</h2><label>Nome<input name="name" required maxlength="100"></label><label>Descrição (opcional)<input name="description" maxlength="200"></label><label>Preço (R$)<input name="price" type="number" min="0" step="0.01" required inputmode="decimal"></label><label>Duração (minutos)<input name="duration" type="number" min="5" max="480" step="5" required></label><label>Ordem de exibição<input name="sort" type="number" min="0" max="999"></label><label class="check"><input name="active" type="checkbox"> Disponível para agendamento</label><div class="bs-actions"><button type="submit" class="primary">Salvar</button><button type="button" id="cancelService">Cancelar</button></div><p class="bs-error" id="serviceError" role="alert"></p>';
 form.elements.name.value=s?.name||"";
 form.elements.description.value=s?.description||"";
 form.elements.price.value=s?.price??"";
 form.elements.duration.value=s?.duration_minutes??30;
 form.elements.sort.value=s?.sort_order??(services.length+1);
 form.elements.active.checked=s?.active??true;
 if(s){const del=document.createElement("button");del.type="button";del.className="danger";del.textContent="Excluir";del.onclick=()=>remove(s);form.querySelector(".bs-actions").append(del);}
 form.querySelector("#cancelService").onclick=closeModal;
 form.onsubmit=async e=>{
  e.preventDefault();
  const payload={name:form.elements.name.value.trim(),description:form.elements.description.value.trim()||null,price:Number(form.elements.price.value),duration_minutes:Number(form.elements.duration.value),sort_order:Number(form.elements.sort.value)||0,active:form.elements.active.checked,barbershop_id:ctx.shop.id};
  if(!payload.name){form.querySelector("#serviceError").textContent="Informe o nome.";return;}
  const submit=form.querySelector('[type="submit"]');submit.disabled=true;
  const query=s?supabase.from("services").update(payload).eq("id",s.id).eq("barbershop_id",ctx.shop.id):supabase.from("services").insert(payload);
  const {error}=await query;submit.disabled=false;
  if(error){form.querySelector("#serviceError").textContent=errorText(error);return;}
  toast("Serviço salvo.","success");closeModal();await load();
 };
 body.append(form);modal.classList.add("open");form.elements.name.focus();
}
if(ctx){document.getElementById("add").onclick=()=>open(null);await load();}
