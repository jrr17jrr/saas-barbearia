import {supabase,currentUser,platformAdmin} from "../shared/supabase-client.js";
import {esc,PLAN,SHOP_STATUS,THEMES,toast,errorText,dayKey,addDays,dayStart} from "../shared/utils.js";
const $=id=>document.getElementById(id);
const layer=$("layer"),dialog=$("dialog");
let shops=[];
const user=await currentUser();
if(user&&!await platformAdmin(user))location.replace("/dashboard/");
else if(user)init();
function close(){layer.classList.remove("open");}
layer.addEventListener("click",e=>{if(e.target===layer)close();});
document.addEventListener("keydown",e=>{if(e.key==="Escape")close();});
function open(html){dialog.innerHTML=html;layer.classList.add("open");dialog.querySelector("input,select,button")?.focus();}
const slugify=v=>v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60);
const randomPassword=()=>{const chars="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";const a=new Uint32Array(16);crypto.getRandomValues(a);return [...a].map(n=>chars[n%chars.length]).join("");};
async function init(){
 sessionStorage.removeItem("supportShop");
 $("logout").onclick=async()=>{await supabase.auth.signOut();location.replace("/login/");};
 $("newShop").onclick=()=>editShop(null);
 for(const id of ["search","filterStatus","filterPlan"])$(id).addEventListener("input",render);
 $("shops").addEventListener("click",onAction);
 await load();
}
async function load(){
 const {data,error}=await supabase.from("barbershops").select("id,name,slug,owner_name,phone,whatsapp,address,plan,status,is_demo,theme,primary_color,background_color,card_color,logo_url,created_at").order("created_at",{ascending:false});
 if(error){$("shops").textContent="Erro ao carregar: "+errorText(error);return;}
 shops=data||[];render();stats();
}
async function stats(){
 const count=s=>shops.filter(x=>x.status===s).length;
 const since=dayStart(addDays(dayKey(),-30)).toISOString();
 const {count:appts,error}=await supabase.from("appointments").select("id",{count:"exact",head:true}).gte("created_at",since);
 const items=[["Barbearias",shops.length],["Ativas",count("active")],["Demonstração",count("demo")],["Suspensas",count("suspended")],["Canceladas",count("cancelled")],["Agendamentos (30 dias)",error?"—":appts]];
 $("stats").innerHTML=items.map(([k,v])=>'<div class="stat"><small>'+esc(k)+'</small><b>'+esc(v)+'</b></div>').join("");
}
function render(){
 const q=$("search").value.trim().toLowerCase(),st=$("filterStatus").value,pl=$("filterPlan").value;
 const list=shops.filter(s=>(!q||[s.name,s.slug,s.owner_name].some(v=>String(v||"").toLowerCase().includes(q)))&&(!st||s.status===st)&&(!pl||s.plan===pl));
 $("shops").innerHTML=list.map(s=>{
  const site="/link-agendamento/?loja="+encodeURIComponent(s.slug),bot="/chatbot/?loja="+encodeURIComponent(s.slug);
  const toggle=s.status==="active"||s.status==="demo"?'<button data-act="suspend" data-id="'+s.id+'">Suspender</button>':'<button data-act="activate" data-id="'+s.id+'">Reativar</button>';
  return '<article class="shop"><div><b>'+esc(s.name)+'</b><span class="pill s-'+esc(s.status)+'">'+esc(SHOP_STATUS[s.status]||s.status)+'</span><span class="pill p-plan">'+esc(PLAN[s.plan]||s.plan)+'</span>'+(s.is_demo?'<span class="pill s-demo">Demo</span>':'')+'<small>/'+esc(s.slug)+(s.owner_name?' • '+esc(s.owner_name):'')+(s.whatsapp?' • '+esc(s.whatsapp):'')+'</small></div><div class="actions"><button data-act="edit" data-id="'+s.id+'">Editar</button><button data-act="owners" data-id="'+s.id+'">Acessos</button><button data-act="support" data-id="'+s.id+'">Suporte</button>'+toggle+(s.plan!=="chatbot"?'<a href="'+site+'" target="_blank" rel="noopener">Site ↗</a>':'')+(s.plan!=="site"?'<a href="'+bot+'" target="_blank" rel="noopener">Chatbot ↗</a>':'')+'</div></article>';
 }).join("")||'<p class="muted">Nenhuma barbearia encontrada.</p>';
}
async function setStatus(shop,status){
 const msg={suspended:"Suspender "+shop.name+"? O painel e os agendamentos públicos ficam bloqueados.",active:"Reativar "+shop.name+"?",cancelled:"Cancelar "+shop.name+"? O painel e os agendamentos públicos ficam bloqueados. Os dados são mantidos."}[status];
 if(msg&&!confirm(msg))return;
 const {error}=await supabase.from("barbershops").update({status}).eq("id",shop.id);
 if(error)toast(errorText(error),"error");else{toast("Status atualizado.","success");await load();}
}
async function onAction(e){
 const btn=e.target.closest("button[data-act]");if(!btn)return;
 const shop=shops.find(s=>s.id===btn.dataset.id);if(!shop)return;
 if(btn.dataset.act==="edit")editShop(shop);
 if(btn.dataset.act==="owners")owners(shop);
 if(btn.dataset.act==="suspend")setStatus(shop,"suspended");
 if(btn.dataset.act==="activate")setStatus(shop,shop.is_demo?"demo":"active");
 if(btn.dataset.act==="support"){sessionStorage.setItem("supportShop",shop.id);location.assign("/dashboard/");}
}
function editShop(shop){
 const s=shop||{plan:"complete",status:"active",theme:"cyan",primary_color:THEMES.cyan.primary,background_color:THEMES.cyan.background,card_color:THEMES.cyan.card};
 open('<h2>'+(shop?"Editar barbearia":"Nova barbearia")+'</h2><form id="shopForm" class="grid2"><label class="full">Nome<input name="name" required maxlength="100"></label><label>Slug (link)<input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxlength="60"></label><label>Responsável<input name="owner_name" maxlength="100"></label><label>WhatsApp<input name="whatsapp" inputmode="tel"></label><label>Endereço<input name="address" maxlength="200"></label><label>Plano<select name="plan"><option value="site">Site</option><option value="chatbot">Chatbot</option><option value="complete">Completo</option></select></label><label>Status<select name="status"><option value="active">Ativa</option><option value="demo">Demonstração</option><option value="suspended">Suspensa</option><option value="cancelled">Cancelada</option></select></label><label class="full" style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="is_demo" style="width:auto"> Barbearia de demonstração</label><label>Tema base<select name="theme"><option value="cyan">Ciano</option><option value="gold">Dourado</option><option value="light">Claro</option><option value="red">Vermelho</option></select></label><div><span class="muted">Cores (principal, fundo, cartões)</span><div class="colors"><input type="color" name="primary_color" aria-label="Cor principal"><input type="color" name="background_color" aria-label="Cor de fundo"><input type="color" name="card_color" aria-label="Cor dos cartões"></div></div>'+(shop?'<label class="full">Logo (PNG/JPG/WEBP até 2 MB)<input type="file" name="logo" accept="image/png,image/jpeg,image/webp"></label>':'')+'<div class="bs-actions full"><button type="submit" class="primary">Salvar</button><button type="button" id="cancelEdit">Fechar</button>'+(shop&&shop.status!=="cancelled"?'<button type="button" class="danger" id="cancelShop">Cancelar contrato</button>':'')+'</div><p class="bs-error full" id="shopError" role="alert"></p></form>');
 const f=$("shopForm");
 for(const k of ["name","slug","owner_name","whatsapp","address","plan","status","theme","primary_color","background_color","card_color"])f.elements[k].value=s[k]||f.elements[k].value;
 f.elements.is_demo.checked=!!s.is_demo;
 if(!shop)f.elements.name.oninput=()=>{if(!f.elements.slug.dataset.edited)f.elements.slug.value=slugify(f.elements.name.value);};
 f.elements.slug.oninput=()=>f.elements.slug.dataset.edited="1";
 f.elements.theme.onchange=()=>{const t=THEMES[f.elements.theme.value];f.elements.primary_color.value=t.primary;f.elements.background_color.value=t.background;f.elements.card_color.value=t.card;};
 f.elements.status.onchange=()=>{if(f.elements.status.value==="demo")f.elements.is_demo.checked=true;};
 $("cancelEdit").onclick=close;
 if($("cancelShop"))$("cancelShop").onclick=async()=>{close();await setStatus(shop,"cancelled");};
 f.onsubmit=async e=>{
  e.preventDefault();const err=$("shopError");err.textContent="";
  const payload={name:f.elements.name.value.trim(),slug:f.elements.slug.value.trim().toLowerCase(),owner_name:f.elements.owner_name.value.trim()||null,whatsapp:f.elements.whatsapp.value.trim()||null,phone:f.elements.whatsapp.value.trim()||null,address:f.elements.address.value.trim()||null,plan:f.elements.plan.value,status:f.elements.status.value,is_demo:f.elements.is_demo.checked,theme:f.elements.theme.value,primary_color:f.elements.primary_color.value,background_color:f.elements.background_color.value,card_color:f.elements.card_color.value};
  if(!payload.name||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(payload.slug)){err.textContent="Informe nome e um slug válido (letras minúsculas, números e hífen).";return;}
  const submit=f.querySelector('[type="submit"]');submit.disabled=true;
  let id=shop?.id,error;
  if(shop)({error}=await supabase.from("barbershops").update(payload).eq("id",shop.id));
  else{const r=await supabase.from("barbershops").insert(payload).select("id").single();error=r.error;id=r.data?.id;if(!error)await setupDefaults(id);}
  if(!error&&shop&&f.elements.logo?.files[0])error=await uploadLogo(id,f.elements.logo.files[0]);
  submit.disabled=false;
  if(error){err.textContent=errorText(error);return;}
  toast(shop?"Barbearia atualizada.":"Barbearia criada. Agora crie o acesso do proprietário.","success");close();await load();
  if(!shop)owners(shops.find(x=>x.id===id));
 };
}
// New shops start with settings and a Mon–Sat 09:00–19:00 schedule (editable by the owner).
async function setupDefaults(id){
 await supabase.from("barbershop_settings").upsert({barbershop_id:id},{onConflict:"barbershop_id",ignoreDuplicates:true});
 const {data:existing}=await supabase.from("business_hours").select("weekday").eq("barbershop_id",id);
 const have=new Set((existing||[]).map(x=>x.weekday));
 const rows=[0,1,2,3,4,5,6].filter(d=>!have.has(d)).map(d=>({barbershop_id:id,weekday:d,is_open:d!==0,opens_at:d?"09:00":null,closes_at:d?"19:00":null}));
 if(rows.length)await supabase.from("business_hours").insert(rows);
}
async function uploadLogo(id,file){
 const ext={"image/png":"png","image/jpeg":"jpg","image/webp":"webp"}[file.type];
 if(!ext)return {message:"Use uma imagem PNG, JPG ou WEBP."};
 if(file.size>2*1024*1024)return {message:"A logo deve ter no máximo 2 MB."};
 const path=id+"/logo-"+Date.now()+"."+ext;
 const {error}=await supabase.storage.from("logos").upload(path,file,{contentType:file.type,upsert:false});
 if(error)return error;
 const url=supabase.storage.from("logos").getPublicUrl(path).data.publicUrl;
 const r=await supabase.from("barbershops").update({logo_url:url}).eq("id",id);
 return r.error;
}
async function owners(shop){
 if(!shop)return;
 open('<h2>Acessos • '+esc(shop.name)+'</h2><div id="memberList" class="muted">Carregando...</div><h3 style="margin-top:18px">Criar acesso do proprietário</h3><form id="ownerForm" class="bs-form"><label>Nome<input name="name" required maxlength="100" autocomplete="off"></label><label>E-mail<input name="email" type="email" required autocomplete="off"></label><p class="muted">Uma senha inicial forte será gerada e exibida uma única vez. O proprietário pode trocá-la em “Esqueci minha senha”.</p><div class="bs-actions"><button type="submit" class="primary">Criar conta</button><button type="button" id="closeOwners">Fechar</button></div><p class="bs-error" id="ownerError" role="alert"></p><div id="ownerResult"></div></form>');
 $("closeOwners").onclick=close;
 await listMembers(shop);
 const f=$("ownerForm");
 f.onsubmit=async e=>{
  e.preventDefault();$("ownerError").textContent="";
  const password=randomPassword(),submit=f.querySelector('[type="submit"]');submit.disabled=true;
  const {data,error}=await supabase.functions.invoke("create-barbershop-owner",{body:{action:"create_owner",barbershop_id:shop.id,name:f.elements.name.value.trim(),email:f.elements.email.value.trim(),password}});
  submit.disabled=false;
  let message=data?.error;
  if(error&&!message){try{message=(await error.context?.json?.())?.error;}catch{}message=message||error.message;}
  if(message){$("ownerError").textContent=message;return;}
  const email=f.elements.email.value.trim();f.reset();
  $("ownerResult").innerHTML='<div class="member" style="display:block"><b>Conta criada</b><small>Envie por um canal seguro e peça para trocar a senha no primeiro acesso.</small><p style="margin:8px 0 0">E-mail: <code id="newEmail"></code><br>Senha inicial: <code id="newPass"></code></p><div class="bs-actions"><button type="button" id="copyCred">Copiar dados</button></div></div>';
  $("newEmail").textContent=email;$("newPass").textContent=password;
  $("copyCred").onclick=async()=>{try{await navigator.clipboard.writeText("Acesso BarberSaaS\nLink: "+location.origin+"/login/\nE-mail: "+email+"\nSenha inicial: "+password);toast("Copiado.","success");}catch{toast("Copie manualmente.","error");}};
  await listMembers(shop);
 };
}
async function listMembers(shop){
 const box=$("memberList");
 const {data,error}=await supabase.from("barbershop_members").select("user_id,role,created_at").eq("barbershop_id",shop.id);
 if(error){box.textContent="Erro ao carregar acessos: "+errorText(error);return;}
 if(!data?.length){box.textContent="Nenhum proprietário vinculado ainda.";return;}
 const {data:profiles}=await supabase.from("profiles").select("*").in("id",data.map(m=>m.user_id));
 box.replaceChildren();
 for(const m of data){
  const p=(profiles||[]).find(x=>x.id===m.user_id)||{};
  const row=document.createElement("div");row.className="member";
  row.innerHTML='<div><b></b><small></small></div><div class="actions"></div>';
  row.querySelector("b").textContent=p.full_name||p.name||p.email||m.user_id;
  row.querySelector("small").textContent=(p.email&&(p.full_name||p.name)?p.email+" • ":"")+(m.role||"owner");
  const actions=row.querySelector(".actions");
  if(p.email){const reset=document.createElement("button");reset.textContent="Enviar redefinição de senha";reset.onclick=async()=>{const {error:e}=await supabase.auth.resetPasswordForEmail(p.email,{redirectTo:location.origin+"/login/"});toast(e?errorText(e):"E-mail de redefinição enviado.",e?"error":"success");};actions.append(reset);}
  const remove=document.createElement("button");remove.className="danger";remove.textContent="Remover acesso";
  remove.onclick=async()=>{if(!confirm("Remover o acesso deste usuário à "+shop.name+"? A conta de login continua existindo."))return;const {error:e}=await supabase.from("barbershop_members").delete().eq("barbershop_id",shop.id).eq("user_id",m.user_id);if(e)toast(errorText(e),"error");else{toast("Acesso removido.","success");listMembers(shop);}};
  actions.append(remove);box.append(row);
 }
}
