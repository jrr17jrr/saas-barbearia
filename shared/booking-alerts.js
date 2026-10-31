// New-booking alerts for owners: Web Push (works with the app closed) + realtime toast while open.
import {supabase} from "./supabase-client.js";
import {ownerContext} from "./owner-context.js";
import {swReady} from "./pwa.js";
import {hm,toast,errorText} from "./utils.js";
const ctx=await ownerContext();
const FN="push-notify";
const supported="serviceWorker" in navigator&&"PushManager" in window&&"Notification" in window;
const isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
const standalone=matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;
const b64ToBytes=b64=>{const s=(b64+"=".repeat((4-b64.length%4)%4)).replace(/-/g,"+").replace(/_/g,"/");return Uint8Array.from(atob(s),c=>c.charCodeAt(0));};
const keyOf=(sub,name)=>{const k=sub.getKey(name);return k?btoa(String.fromCharCode(...new Uint8Array(k))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""):null;};
async function publicKey(){
 const {data,error}=await supabase.functions.invoke(FN,{body:{action:"public_key"}});
 if(error||!data?.publicKey)throw new Error("Notificações ainda não configuradas no servidor.");
 return data.publicKey;
}
async function save(sub){
 const {error}=await supabase.from("push_subscriptions").upsert({user_id:ctx.user.id,barbershop_id:ctx.shop.id,endpoint:sub.endpoint,p256dh:keyOf(sub,"p256dh"),auth:keyOf(sub,"auth"),user_agent:navigator.userAgent.slice(0,300),last_seen_at:new Date().toISOString()},{onConflict:"endpoint"});
 if(error)throw error;
}
async function subscribe(){
 const reg=await swReady;if(!reg)throw new Error("Instale o app (HTTPS) para receber notificações.");
 const permission=await Notification.requestPermission();
 if(permission!=="granted")throw new Error("Permissão de notificação negada. Libere nas configurações do navegador.");
 let sub=await reg.pushManager.getSubscription();
 if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToBytes(await publicKey())});
 await save(sub);return sub;
}
async function unsubscribe(){
 const reg=await swReady;const sub=await reg?.pushManager.getSubscription();
 if(sub){await supabase.from("push_subscriptions").delete().eq("endpoint",sub.endpoint).eq("user_id",ctx.user.id);await sub.unsubscribe();}
}
async function current(){if(!supported||Notification.permission!=="granted")return null;const reg=await swReady;return reg?await reg.pushManager.getSubscription():null;}
function dialog(html){
 const layer=document.createElement("div");layer.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:4000;display:flex;align-items:center;justify-content:center;padding:16px";
 layer.innerHTML='<div class="bs-dialog">'+html+'<div class="bs-actions" id="pushActions"></div><p class="bs-error" id="pushError" role="alert"></p></div>';
 layer.addEventListener("click",e=>{if(e.target===layer)layer.remove();});
 document.body.append(layer);return layer;
}
async function openPanel(){
 if(isIOS&&!standalone){
  const l=dialog('<h2>Notificações no iPhone</h2><ol style="margin:10px 0 0 18px;line-height:1.7;color:#cbd5e1"><li>Abra este painel no <b>Safari</b>.</li><li>Toque em <b>Compartilhar</b> (quadrado com seta).</li><li>Escolha <b>Adicionar à Tela de Início</b>.</li><li>Abra o BarberSaaS pelo ícone e toque em <b>Notificações</b> → <b>Ativar</b>.</li></ol><p style="color:#94a3b8;font-size:13px;margin-top:10px">Requer iOS 16.4 ou superior.</p>');
  const ok=document.createElement("button");ok.textContent="Entendi";ok.className="primary";ok.onclick=()=>l.remove();l.querySelector("#pushActions").append(ok);return;
 }
 if(!supported){const l=dialog('<h2>Notificações</h2><p style="color:#cbd5e1">Este navegador não suporta notificações push. Use Chrome, Edge, Firefox ou o app instalado no iPhone.</p>');const ok=document.createElement("button");ok.textContent="Fechar";ok.onclick=()=>l.remove();l.querySelector("#pushActions").append(ok);return;}
 const sub=await current();
 const l=dialog('<h2>Notificações de agendamento</h2><p style="color:#cbd5e1">'+(sub?"Ativas neste dispositivo. Você será avisado de novos agendamentos mesmo com o app fechado.":"Receba um aviso neste dispositivo sempre que um cliente agendar, mesmo com o app fechado.")+'</p>');
 const actions=l.querySelector("#pushActions"),err=l.querySelector("#pushError");
 const btn=(label,cls,fn)=>{const b=document.createElement("button");b.textContent=label;if(cls)b.className=cls;b.onclick=async()=>{b.disabled=true;err.textContent="";try{await fn();}catch(e){err.textContent=errorText(e);}b.disabled=false;};actions.append(b);};
 if(sub){
  btn("Enviar teste","primary",async()=>{const {data,error}=await supabase.functions.invoke(FN,{body:{action:"test",barbershop_id:ctx.shop.id}});if(error||data?.error)throw new Error(data?.error||"Falha ao enviar teste.");toast("Teste enviado para "+(data?.sent??0)+" dispositivo(s).","success");});
  btn("Desativar","danger",async()=>{await unsubscribe();toast("Notificações desativadas neste dispositivo.");l.remove();refresh();});
 }else btn("Ativar notificações","primary",async()=>{await subscribe();toast("Notificações ativadas!","success");l.remove();refresh();});
 btn("Fechar","",()=>l.remove());
}
let floating=null;
async function refresh(){
 const sub=await current().catch(()=>null);
 const link=document.getElementById("pushLink");if(link)link.textContent=sub?"🔔 Notificações ativas":"🔔 Notificações";
 if(sub){floating?.remove();floating=null;return;}
 if(!floating&&!sessionStorage.getItem("pushDismissed")){
  floating=document.createElement("button");floating.type="button";floating.className="push-btn";floating.textContent="🔔 Ativar avisos de agendamento";
  floating.onclick=openPanel;
  const x=document.createElement("span");x.textContent=" ×";x.setAttribute("aria-label","Dispensar");x.style.cssText="margin-left:8px;font-size:16px;opacity:.7";x.onclick=e=>{e.stopPropagation();sessionStorage.setItem("pushDismissed","1");floating.remove();floating=null;};floating.append(x);
  document.body.append(floating);
 }
}
if(ctx&&!ctx.support){
 const menu=document.querySelector(".sidebar .menu");
 if(menu&&!document.getElementById("pushLink")){const a=document.createElement("a");a.href="#";a.id="pushLink";a.textContent="🔔 Notificações";a.onclick=e=>{e.preventDefault();openPanel();};document.getElementById("logoutLink")?menu.insertBefore(a,document.getElementById("logoutLink")):menu.append(a);}
 await refresh();
 // Keep the server copy fresh (endpoints can rotate).
 current().then(sub=>sub&&save(sub)).catch(()=>{});
 navigator.serviceWorker?.addEventListener("message",e=>{
  if(e.data?.type==="resubscribe")subscribe().catch(()=>{});
  if(e.data?.type==="new-booking")window.dispatchEvent(new CustomEvent("barbersaas:new-booking"));
 });
}
if(ctx){
 supabase.channel("appointments-"+ctx.shop.id).on("postgres_changes",{event:"INSERT",schema:"public",table:"appointments",filter:"barbershop_id=eq."+ctx.shop.id},payload=>{
  const a=payload.new||{};
  toast("Novo agendamento: "+(a.client_name||"cliente")+(a.starts_at?" às "+hm(a.starts_at):""),"success");
  window.dispatchEvent(new CustomEvent("barbersaas:new-booking"));
 }).subscribe();
}
