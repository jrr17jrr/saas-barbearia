// Shared helpers. All agenda dates use America/Sao_Paulo (UTC-03:00, no DST since 2019).
export const TZ="America/Sao_Paulo";
export const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
export const brl=v=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(v)||0);
export const dayKey=(date=new Date())=>new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
export const dayStart=key=>new Date(key+"T00:00:00-03:00");
export const addDays=(key,n)=>{const d=dayStart(key);d.setUTCDate(d.getUTCDate()+n);return dayKey(d);};
export const weekday=key=>new Date(key+"T12:00:00-03:00").getUTCDay();
export const weekStart=key=>addDays(key,-((weekday(key)+6)%7));
export const monthStart=key=>key.slice(0,8)+"01";
export const hm=iso=>new Date(iso).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit",timeZone:TZ});
export const dateLabel=(key,opts={weekday:"long",day:"numeric",month:"long"})=>new Date(key+"T12:00:00-03:00").toLocaleDateString("pt-BR",{...opts,timeZone:TZ});
export const dateTime=iso=>new Date(iso).toLocaleString("pt-BR",{timeZone:TZ,day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
export const digits=v=>String(v||"").replace(/\D/g,"");
export const waLink=(phone,text)=>{let n=digits(phone);if(!n)return null;if(n.length<=11)n="55"+n;return "https://wa.me/"+n+(text?"?text="+encodeURIComponent(text):"");};
export const STATUS={pending:"Pendente",confirmed:"Confirmado",completed:"Concluído",cancelled:"Cancelado",no_show:"Faltou"};
export const statusLabel=s=>STATUS[s]||s||"—";
// Statuses that still occupy the agenda / count as an attended booking.
export const ACTIVE_STATUSES=["pending","confirmed"];
export const PLAN={site:"Site",chatbot:"Chatbot",complete:"Completo"};
export const SHOP_STATUS={active:"Ativa",demo:"Demonstração",suspended:"Suspensa",cancelled:"Cancelada"};
export const hasSite=plan=>plan==="site"||plan==="complete";
export const hasChatbot=plan=>plan==="chatbot"||plan==="complete";
export const THEMES={cyan:{primary:"#08a9df",background:"#0b1220",card:"#131e31"},gold:{primary:"#d6a83b",background:"#0c0c0d",card:"#191919"},light:{primary:"#2563eb",background:"#f5f7fa",card:"#ffffff"},red:{primary:"#e63946",background:"#0b0b0d",card:"#19191d"}};
const isLight=hex=>{const c=String(hex||"#000000").replace("#","");const r=parseInt(c.slice(0,2),16),g=parseInt(c.slice(2,4),16),b=parseInt(c.slice(4,6),16);return (r*299+g*587+b*114)/1000>170;};
// Applies the shop identity (colors) as CSS variables used by public pages.
export function applyTheme(shop,root=document.documentElement){
 const base=THEMES[shop?.theme]||THEMES.cyan;
 const primary=shop?.primary_color||base.primary,background=shop?.background_color||base.background,card=shop?.card_color||base.card;
 const light=isLight(background);
 const vars={"--site-primary":primary,"--site-primary-text":isLight(primary)?"#111827":"#ffffff","--site-bg":background,"--site-card":card,"--site-text":light?"#111827":"#ffffff","--site-muted":light?"#64748b":"#8190a5","--site-surface":light?"#f1f5f9":"#0d1728","--site-border":light?"#dbe3ee":"#223149"};
 for(const [k,v] of Object.entries(vars))root.style.setProperty(k,v);
 const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=primary;
}
export function toast(text,kind="info"){
 const el=document.createElement("div");el.className="bs-toast "+kind;el.setAttribute("role","status");el.textContent=text;
 el.style.cssText="position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:5000;max-width:min(92vw,460px);padding:13px 18px;border-radius:12px;font:500 14px Poppins,Arial,sans-serif;box-shadow:0 12px 30px rgba(0,0,0,.35);color:#fff;background:"+(kind==="error"?"#b91c1c":kind==="success"?"#15803d":"#14243c");
 document.body.append(el);setTimeout(()=>el.remove(),4500);
}
// Friendly message for Supabase/PostgREST errors.
export function errorText(error){
 if(!error)return "";
 const m=error.message||String(error);
 if(/Failed to fetch|NetworkError/i.test(m))return "Sem conexão. Verifique a internet e tente novamente.";
 if(error.code==="42501"||/row-level security|permission denied/i.test(m))return "Você não tem permissão para esta ação.";
 if(error.code==="23505")return "Já existe um registro com esses dados.";
 if(error.code==="23503")return "Este registro está vinculado a outros dados.";
 return m;
}
