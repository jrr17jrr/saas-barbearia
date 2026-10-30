import {supabase} from "../shared/supabase-client.js";
import {ownerContext} from "../shared/owner-context.js";
import {THEMES,brl,esc,toast,errorText,hasSite} from "../shared/utils.js";
const ctx=await ownerContext();
if(ctx){
const $=id=>document.getElementById(id);
const LOGO_BUCKET="logos",MAX_LOGO=2*1024*1024,LOGO_TYPES={"image/png":"png","image/jpeg":"jpg","image/webp":"webp"};
const {data:shop,error}=await supabase.from("barbershops").select("name,description,address,whatsapp,instagram,facebook,tiktok,theme,primary_color,background_color,card_color,review_link,maps_link,public_status_text,logo_url").eq("id",ctx.shop.id).single();
if(error){$("saveState").textContent=errorText(error);}
else{
const fields={shopName:"name",shopDescription:"description",shopStatus:"public_status_text",address:"address",whatsapp:"whatsapp",instagram:"instagram",facebook:"facebook",tiktok:"tiktok",reviewLink:"review_link",mapsLink:"maps_link"};
const statusSelect=$("shopStatus");
if(shop.public_status_text&&![...statusSelect.options].some(o=>o.value===shop.public_status_text)){const o=document.createElement("option");o.textContent=shop.public_status_text;statusSelect.prepend(o);}
for(const [id,key] of Object.entries(fields))if($(id))$(id).value=shop[key]||"";
if(!shop.public_status_text)statusSelect.selectedIndex=0;
// Social toggles: a network is shown when it has a value; the switch clears/keeps it.
for(const key of ["instagram","facebook","tiktok"]){const sw=$(key+"Enabled");sw.checked=!!shop[key];$(key).disabled=!sw.checked;sw.onchange=()=>{$(key).disabled=!sw.checked;updatePreview();};}
$("whatsappEnabled").checked=!!shop.whatsapp;$("whatsappEnabled").onchange=()=>updatePreview();
const rating=$("rating")?.closest("label");if(rating)rating.style.display="none";
let selected=THEMES[shop.theme]?shop.theme:"cyan",logoUrl=shop.logo_url||null;
const markTheme=()=>document.querySelectorAll(".theme-option").forEach(x=>x.classList.toggle("active",x.dataset.theme===selected));
for(const btn of document.querySelectorAll(".theme-option"))btn.onclick=()=>{selected=btn.dataset.theme;markTheme();updatePreview();};
function updatePreview(){
 $("previewName").textContent=$("shopName").value||ctx.shop.name;
 $("previewStatus").textContent="● "+($("shopStatus").value||"");
 const t=THEMES[selected],p=$("livePreview");
 p.style.setProperty("--site-primary",t.primary);p.style.setProperty("--site-bg",t.background);p.style.setProperty("--site-card",t.card);
 p.style.setProperty("--preview-primary",t.primary);p.style.setProperty("--preview-bg",t.background);p.style.setProperty("--preview-card",t.card);
 const preview=p.querySelector(".preview-page");if(preview){preview.style.background=t.background;preview.style.color=selected==="light"?"#111827":"#fff";}
 p.querySelectorAll(".preview-cta,.preview-service button").forEach(b=>{b.style.background=t.primary;b.style.color=selected==="gold"?"#111":"#fff";});
 p.querySelectorAll(".preview-card").forEach(c=>c.style.background=t.card);
 const src=logoUrl||"/img/logo.png";$("logoPreview").src=src;$("previewLogo").src=src;
 for(const i of p.querySelectorAll("[data-social]")){const k=i.dataset.social;i.style.display=(k==="whatsapp"?$("whatsappEnabled").checked&&$("whatsapp").value.trim():$(k+"Enabled").checked&&$(k).value.trim())?"":"none";}
}
for(const id of Object.keys(fields))$(id)?.addEventListener("input",updatePreview);
markTheme();updatePreview();
// Services preview reflects the real catalog (managed in Serviços).
const {data:services}=await supabase.from("services").select("name,price,duration_minutes,active").eq("barbershop_id",ctx.shop.id).eq("active",true).order("sort_order").limit(6);
$("serviceList").innerHTML=(services||[]).map(s=>'<div class="service-item" style="display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid #26344a"><span>'+esc(s.name)+'</span><small>'+s.duration_minutes+' min • '+esc(brl(s.price))+'</small></div>').join("")||'<p class="empty-note">Nenhum serviço ativo.</p>';
const previewCard=document.querySelector(".preview-card");
if(previewCard&&services?.length){previewCard.innerHTML="<strong>Serviços</strong>"+services.slice(0,3).map(s=>'<div class="preview-service"><span></span><div><b>'+esc(s.name)+'</b><small>'+s.duration_minutes+' min · '+esc(brl(s.price))+'</small></div><button>Agendar</button></div>').join("");updatePreview();}
$("newService").textContent="Gerenciar serviços";$("newService").onclick=()=>location.assign("/servicos/");
$("logoInput").onchange=async()=>{
 const file=$("logoInput").files[0];if(!file)return;
 const ext=LOGO_TYPES[file.type];
 if(!ext){toast("Use uma imagem PNG, JPG ou WEBP.","error");$("logoInput").value="";return;}
 if(file.size>MAX_LOGO){toast("A logo deve ter no máximo 2 MB.","error");$("logoInput").value="";return;}
 $("saveState").textContent="Enviando logo...";
 const path=ctx.shop.id+"/logo-"+Date.now()+"."+ext;
 const {error:upError}=await supabase.storage.from(LOGO_BUCKET).upload(path,file,{contentType:file.type,cacheControl:"3600",upsert:false});
 $("logoInput").value="";
 if(upError){$("saveState").textContent="Não foi possível enviar a logo: "+errorText(upError);return;}
 logoUrl=supabase.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
 const {error:saveError}=await supabase.from("barbershops").update({logo_url:logoUrl}).eq("id",ctx.shop.id);
 $("saveState").textContent=saveError?errorText(saveError):"Logo atualizada.";updatePreview();
};
const save=$("saveBtn").cloneNode(true);$("saveBtn").replaceWith(save);
save.onclick=async()=>{
 if(!hasSite(ctx.shop.plan)){$("saveState").textContent="Seu plano não inclui site.";return;}
 const payload={};for(const [id,key] of Object.entries(fields))payload[key]=$(id)?.value.trim()||null;
 for(const key of ["instagram","facebook","tiktok"])if(!$(key+"Enabled").checked)payload[key]=null;
 if(!$("whatsappEnabled").checked)payload.whatsapp=null;
 if(!payload.name){$("saveState").textContent="Informe o nome da barbearia.";return;}
 for(const key of ["review_link","maps_link"])if(payload[key]&&!/^https:\/\//i.test(payload[key])){$("saveState").textContent="Os links de avaliação e mapa devem começar com https://";return;}
 payload.theme=selected;
 [payload.primary_color,payload.background_color,payload.card_color]=[THEMES[selected].primary,THEMES[selected].background,THEMES[selected].card];
 save.disabled=true;
 const {error:saveError}=await supabase.from("barbershops").update(payload).eq("id",ctx.shop.id);
 save.disabled=false;
 $("saveState").textContent=saveError?errorText(saveError):"Dados do site salvos.";
 if(!saveError)toast("Site atualizado.","success");
};
$("saveState").textContent="Edite e clique em salvar para publicar as alterações.";
const siteUrl="/link-agendamento/?loja="+encodeURIComponent(ctx.shop.slug);
document.querySelector("a.preview").href=siteUrl;
const link=document.createElement("a");link.href=siteUrl;link.target="_blank";link.rel="noopener";link.textContent="Abrir site público";link.style.cssText="margin-right:15px;color:#19b8ed";save.before(link);
}
}
