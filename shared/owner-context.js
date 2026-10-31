import { supabase, currentUser, platformAdmin } from "./supabase-client.js";
import { hasSite, hasChatbot } from "./utils.js";
const SUPPORT_KEY="supportShop";
function blockPage(text){
 document.body.innerHTML='<main style="min-height:100vh;display:grid;place-items:center;padding:24px;background:#0b1220;color:#fff;font-family:Poppins,Arial,sans-serif;text-align:center"><div><h1 style="margin-bottom:10px">BarberSaaS</h1><p id="blockedText" style="color:#94a3b8;max-width:420px"></p><p style="margin-top:18px"><a href="/login/" id="blockedExit" style="color:#19b8ed">Sair</a></p></div></main>';
 document.getElementById("blockedText").textContent=text;
 document.getElementById("blockedExit").onclick=async e=>{e.preventDefault();sessionStorage.removeItem(SUPPORT_KEY);await supabase.auth.signOut();location.replace("/login/");};
}
// Hides menu entries the contracted plan does not include.
function applyPlanToMenu(plan){
 for(const a of document.querySelectorAll(".sidebar .menu a")){
  const href=a.getAttribute("href")||"";
  if(href.startsWith("/chatbot-config")&&!hasChatbot(plan))a.hidden=true;
  if(href.startsWith("/editar-link")&&!hasSite(plan))a.hidden=true;
 }
}
function addLogout(){
 const menu=document.querySelector(".sidebar .menu");if(!menu||document.getElementById("logoutLink"))return;
 const a=document.createElement("a");a.href="#";a.id="logoutLink";a.textContent="Sair";a.style.marginTop="12px";
 a.onclick=async e=>{e.preventDefault();sessionStorage.removeItem(SUPPORT_KEY);await supabase.auth.signOut();location.replace("/login/");};
 menu.append(a);
}
function supportBanner(shop){
 const bar=document.createElement("div");
 bar.style.cssText="position:sticky;top:0;z-index:2500;background:#7c2d12;color:#fff;padding:9px 14px;font:500 13px Poppins,Arial,sans-serif;display:flex;gap:12px;justify-content:center;align-items:center;flex-wrap:wrap";
 const text=document.createElement("span");text.textContent="Modo suporte DEV • "+shop.name;
 const exit=document.createElement("a");exit.href="/dev/";exit.textContent="Voltar ao painel DEV";exit.style.color="#fde68a";
 exit.onclick=()=>sessionStorage.removeItem(SUPPORT_KEY);
 bar.append(text,exit);document.body.prepend(bar);
}
let cached=null;
export function ownerContext(){return cached??=load();}
async function load(){
 const user=await currentUser();
 if(!user)return null;
 const {data,error}=await supabase.from("barbershop_members").select("barbershop_id,role").eq("user_id",user.id).limit(1).maybeSingle();
 if(error)throw error;
 let shopId=data?.barbershop_id,role=data?.role,support=false;
 if(!shopId){
  if(!await platformAdmin(user)){blockPage("Conta sem barbearia vinculada. Contate o administrador.");return null;}
  shopId=sessionStorage.getItem(SUPPORT_KEY);
  if(!shopId){location.replace("/dev/");return null;}
  role="support";support=true;
 }
 const {data:shop,error:shopError}=await supabase.from("barbershops").select("id,name,slug,status,plan,is_demo,logo_url").eq("id",shopId).single();
 if(shopError)throw shopError;
 if(!support&&(shop.status==="suspended"||shop.status==="cancelled")){
  blockPage(shop.status==="suspended"?"Acesso suspenso. Contate a Visionário Dev para regularizar.":"Esta conta foi cancelada. Contate a Visionário Dev.");
  return null;
 }
 applyPlanToMenu(shop.plan);addLogout();
 if(support)supportBanner(shop);
 return {user,shop,role,support};
}
