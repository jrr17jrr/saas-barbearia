import {supabase} from "../shared/supabase-client.js";
import {ownerContext} from "../shared/owner-context.js";
const ctx=await ownerContext();
if(ctx){
const $=id=>document.getElementById(id);
const {data:shop,error}=await supabase.from("barbershops").select("name,description,address,whatsapp,instagram,facebook,tiktok,theme,primary_color,background_color,card_color,review_link,maps_link,public_status_text,logo_url").eq("id",ctx.shop.id).single();
if(error){$("saveState").textContent=error.message;}
else{
const fields={shopName:"name",shopDescription:"description",shopStatus:"public_status_text",address:"address",whatsapp:"whatsapp",instagram:"instagram",facebook:"facebook",tiktok:"tiktok",reviewLink:"review_link",mapsLink:"maps_link"};
for(const [id,key] of Object.entries(fields))if($(id))$(id).value=shop[key]||"";
const themes={cyan:["#08a9df","#0b1220","#131e31"],gold:["#d6a83b","#0c0c0d","#191919"],light:["#2563eb","#f5f7fa","#ffffff"],red:["#e63946","#0b0b0d","#19191d"]};
let selected=shop.theme||"cyan";
for(const btn of document.querySelectorAll(".theme-option"))btn.onclick=()=>{selected=btn.dataset.theme;document.querySelectorAll(".theme-option").forEach(x=>x.classList.toggle("active",x===btn));};
const original=$("saveBtn").cloneNode(true);$("saveBtn").replaceWith(original);
original.onclick=async()=>{
if(ctx.shop.plan==="chatbot"){$("saveState").textContent="Seu plano não inclui site.";return;}
const payload={};for(const [id,key] of Object.entries(fields))payload[key]=$(id)?.value.trim()||null;
payload.theme=selected;
[payload.primary_color,payload.background_color,payload.card_color]=themes[selected]||themes.cyan;
const {error:saveError}=await supabase.from("barbershops").update(payload).eq("id",ctx.shop.id);
$("saveState").textContent=saveError?saveError.message:"Dados do site salvos no Supabase.";
};
$("saveState").textContent="Os dados desta barbearia estão conectados ao Supabase.";
const link=document.createElement("a");link.href="/reservar/?loja="+encodeURIComponent(ctx.shop.slug);link.target="_blank";link.rel="noopener";link.textContent="Abrir agendamento público";link.style.marginRight="15px";original.before(link);
}
}
