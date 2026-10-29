const site=JSON.parse(localStorage.getItem("barberSite")||"{}");
const fallback={enabled:true,name:"Assistente Barber",greeting:"Olá! Vou te ajudar a agendar seu horário.",colors:{primary:"#08a9df",background:"#0b1220",card:"#131e31"}};
let saved=JSON.parse(localStorage.getItem("barberChatbot")||"null");
let bot=saved||{...fallback,...(site.chatbot||{}),colors:site.chatbot?.colors||site.colors||fallback.colors};

const enabledEl=document.getElementById("enabled");
const nameEl=document.getElementById("name");
const greetingEl=document.getElementById("greeting");
const primaryEl=document.getElementById("primary");
const backgroundEl=document.getElementById("background");
const cardEl=document.getElementById("card");
const phoneEl=document.getElementById("phone");
const pnameEl=document.getElementById("pname");
const avatarEl=document.getElementById("avatar");
const pgreetingEl=document.getElementById("pgreeting");
const copyEl=document.getElementById("copy");
const saveEl=document.getElementById("save");
const stateEl=document.getElementById("state");

function isLight(hex){const c=(hex||"#000000").replace("#","");const r=parseInt(c.slice(0,2),16),g=parseInt(c.slice(2,4),16),b=parseInt(c.slice(4,6),16);return(r*299+g*587+b*114)/1000>170}
function applyPreview(){
 const p=primaryEl.value||fallback.colors.primary,bg=backgroundEl.value||fallback.colors.background,card=cardEl.value||fallback.colors.card;
 pnameEl.textContent=nameEl.value||fallback.name;
 avatarEl.textContent=(nameEl.value||"A").charAt(0).toUpperCase();
 pgreetingEl.textContent=greetingEl.value||fallback.greeting;
 phoneEl.style.setProperty("--p",p);
 phoneEl.style.setProperty("--bg",bg);
 phoneEl.style.setProperty("--card",card);
 phoneEl.style.setProperty("--text",isLight(bg)?"#111827":"#ffffff");
 phoneEl.style.setProperty("--surface",isLight(bg)?"#f1f5f9":"#0d1728");
 phoneEl.style.setProperty("--border",isLight(bg)?"#dbe3ee":"#223149");
}
function load(){
 const colors=bot.colors||fallback.colors;
 enabledEl.checked=bot.enabled!==false;
 nameEl.value=bot.name||fallback.name;
 greetingEl.value=bot.greeting||fallback.greeting;
 primaryEl.value=colors.primary||fallback.colors.primary;
 backgroundEl.value=colors.background||fallback.colors.background;
 cardEl.value=colors.card||fallback.colors.card;
 applyPreview();
}
[nameEl,greetingEl,primaryEl,backgroundEl,cardEl].forEach(el=>{
 el.addEventListener("input",applyPreview);
 el.addEventListener("change",applyPreview);
});
copyEl.onclick=async()=>{const url=new URL("/chatbot/index.html",location.origin).href;try{await navigator.clipboard.writeText(url);copyEl.textContent="Copiado ✓";setTimeout(()=>copyEl.textContent="Copiar link",1600)}catch(e){prompt("Copie o link:",url)}};
saveEl.onclick=()=>{
 bot={enabled:enabledEl.checked,name:nameEl.value.trim()||fallback.name,greeting:greetingEl.value.trim()||fallback.greeting,colors:{primary:primaryEl.value,background:backgroundEl.value,card:cardEl.value}};
 localStorage.setItem("barberChatbot",JSON.stringify(bot));
 applyPreview();
 stateEl.textContent="Alterações salvas neste navegador ✓";
 setTimeout(()=>stateEl.textContent="",2200);
};
load();