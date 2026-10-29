import {supabase,currentUser,platformAdmin} from "../shared/supabase-client.js";
const $=id=>document.getElementById(id);let shops=[];
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const user=await currentUser();
if(user){
 if(!await platformAdmin(user)){location.replace("/dashboard/");}
 else await load();
}
$("logout").onclick=async()=>{await supabase.auth.signOut();location.replace("/login/");};
$("newShop").onclick=()=>{$("formbox").classList.toggle("open");};
$("name").oninput=()=>{if(!$("slug").dataset.edited)$("slug").value=$("name").value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");};
$("slug").oninput=()=>{$("slug").dataset.edited="1";};
async function load(){
 const {data,error}=await supabase.from("barbershops").select("id,name,slug,owner_name,phone,plan,status,is_demo").order("created_at",{ascending:false});
 if(error){$("shops").textContent=error.message;return;}
 shops=data||[];
 $("stats").innerHTML=[["Barbearias",shops.length],["Ativas",shops.filter(s=>s.status==="active").length],["Suspensas",shops.filter(s=>s.status==="suspended").length],["Demonstração",shops.filter(s=>s.is_demo).length]].map(([k,v])=>'<div class="stat"><small>'+k+'</small><b>'+v+'</b></div>').join("");
 $("shops").innerHTML=shops.map(s=>'<article class="shop"><div><b>'+esc(s.name)+'</b><small>/'+esc(s.slug)+' • '+esc(s.plan)+' • '+esc(s.status)+'</small></div><div class="actions"><button data-id="'+s.id+'" data-action="toggle">'+(s.status==="suspended"?"Ativar":"Suspender")+'</button></div></article>').join("");
}
$("saveShop").onclick=async()=>{
 const name=$("name").value.trim(),slug=$("slug").value.trim().toLowerCase();
 if(!name||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)){alert("Informe nome e slug válido.");return;}
 $("saveShop").disabled=true;
 const {error}=await supabase.from("barbershops").insert({name,slug,owner_name:$("owner").value.trim()||null,phone:$("phone").value.trim()||null,whatsapp:$("phone").value.trim()||null,plan:$("plan").value,status:$("status").value});
 $("saveShop").disabled=false;
 if(error){alert(error.message);return;}
 $("formbox").classList.remove("open");await load();
};
$("shops").onclick=async e=>{
 const btn=e.target.closest("button[data-id]");if(!btn)return;
 const shop=shops.find(s=>s.id===btn.dataset.id);if(!shop)return;
 const status=shop.status==="suspended"?"active":"suspended";
 if(!confirm("Alterar "+shop.name+" para "+status+"?"))return;
 const {error}=await supabase.from("barbershops").update({status}).eq("id",shop.id);
 if(error)alert(error.message);else await load();
};

const panel=document.createElement("section");panel.className="formbox open";panel.innerHTML='<h2>Gerenciar barbearia</h2><select id="manageShop"></select><input id="manageName" placeholder="Nome"><input id="manageOwner" placeholder="Responsável"><input id="managePhone" placeholder="WhatsApp"><select id="managePlan"><option value="site">Site</option><option value="chatbot">Chatbot</option><option value="complete">Completo</option></select><button id="manageSave" class="primary full">Salvar alterações</button><p id="manageResult" class="full"></p>';
document.querySelector(".wrap").append(panel);
function fillManage(){
 const select=document.getElementById("manageShop");const selected=select.value;
 select.replaceChildren();for(const s of shops){const opt=document.createElement("option");opt.value=s.id;opt.textContent=s.name;select.append(opt);}
 if(shops.some(s=>s.id===selected))select.value=selected;
 const s=shops.find(x=>x.id===select.value);if(!s)return;
 document.getElementById("manageName").value=s.name||"";
 document.getElementById("manageOwner").value=s.owner_name||"";
 document.getElementById("managePhone").value=s.phone||"";
 document.getElementById("managePlan").value=s.plan;
}
document.getElementById("manageShop").onchange=fillManage;
document.getElementById("manageSave").onclick=async()=>{
 const id=document.getElementById("manageShop").value;
 if(!id)return;
 const name=document.getElementById("manageName").value.trim();
 if(!name){document.getElementById("manageResult").textContent="Informe o nome.";return;}
 const phone=document.getElementById("managePhone").value.trim();
 const {error}=await supabase.from("barbershops").update({name,owner_name:document.getElementById("manageOwner").value.trim(),phone,whatsapp:phone,plan:document.getElementById("managePlan").value}).eq("id",id);
 document.getElementById("manageResult").textContent=error?error.message:"Dados atualizados.";
 if(!error)await load();
};
const originalLoad=load;
load=async function(){await originalLoad();fillManage();};
fillManage();

const ownerPanel=document.createElement("section");
ownerPanel.className="formbox open";
ownerPanel.innerHTML='<h2>Criar acesso do proprietário</h2><select id="ownerShop"></select><input id="ownerFullName" placeholder="Nome do proprietário" autocomplete="name"><input id="ownerEmail" placeholder="E-mail de acesso" type="email" autocomplete="off"><input id="ownerPassword" placeholder="Senha inicial (mínimo 10 caracteres)" type="password" autocomplete="new-password"><button id="createOwner" class="primary full">Criar conta</button><p class="full" id="ownerFeedback" role="status"></p>';
document.querySelector(".wrap").append(ownerPanel);
function fillOwnerShops(){const el=document.getElementById("ownerShop"),previous=el.value;el.replaceChildren();for(const s of shops){const option=document.createElement("option");option.value=s.id;option.textContent=s.name;el.append(option);}if(shops.some(s=>s.id===previous))el.value=previous;}
document.getElementById("createOwner").onclick=async()=>{
const button=document.getElementById("createOwner"),feedback=document.getElementById("ownerFeedback");
button.disabled=true;feedback.textContent="Criando conta...";
const {data,error}=await supabase.functions.invoke("create-barbershop-owner",{body:{action:"create_owner",barbershop_id:document.getElementById("ownerShop").value,name:document.getElementById("ownerFullName").value,email:document.getElementById("ownerEmail").value,password:document.getElementById("ownerPassword").value}});
button.disabled=false;
feedback.textContent=error?(data?.error||error.message):(data?.error||"Conta criada. Envie o e-mail e a senha inicial ao proprietário por um canal seguro.");
if(!error&&!data?.error)document.getElementById("ownerPassword").value="";
};
const previousLoad=load;
load=async function(){await previousLoad();fillOwnerShops();};
fillOwnerShops();
