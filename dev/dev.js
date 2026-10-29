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
