const themes={
 cyan:{primary:"#08a9df",background:"#0b1220",card:"#131e31"},
 gold:{primary:"#d6a83b",background:"#0c0c0d",card:"#191919"},
 light:{primary:"#2563eb",background:"#f5f7fa",card:"#ffffff"},
 red:{primary:"#e63946",background:"#0b0b0d",card:"#19191d"}
};
const site=JSON.parse(localStorage.getItem("barberSite")||"{}");
const fallback={enabled:true,name:"Assistente Barber",greeting:"Olá! Vou te ajudar a agendar seu horário.",syncWithSite:true,theme:site.theme||"cyan"};
let bot=JSON.parse(localStorage.getItem("barberChatbot")||"null")||fallback;
const enabledEl=document.getElementById("enabled"),nameEl=document.getElementById("name"),greetingEl=document.getElementById("greeting"),syncEl=document.getElementById("syncWithSite"),phoneEl=document.getElementById("phone"),pnameEl=document.getElementById("pname"),avatarEl=document.getElementById("avatar"),pgreetingEl=document.getElementById("pgreeting"),copyEl=document.getElementById("copy"),saveEl=document.getElementById("save"),stateEl=document.getElementById("state"),syncStatusEl=document.getElementById("syncStatus");
function isLight(hex){const c=(hex||"#000").replace("#",""),r=parseInt(c.slice(0,2),16),g=parseInt(c.slice(2,4),16),b=parseInt(c.slice(4,6),16);return(r*299+g*587+b*114)/1000>170}
function currentTheme(){return syncEl.checked?(site.theme&&themes[site.theme]?site.theme:"cyan"):(themes[bot.theme]?bot.theme:"cyan")}
function applyPreview(){
 const key=currentTheme(),colors=themes[key];
 pnameEl.textContent=nameEl.value||fallback.name;avatarEl.textContent=(nameEl.value||"A")[0].toUpperCase();pgreetingEl.textContent=greetingEl.value||fallback.greeting;
 phoneEl.style.setProperty("--p",colors.primary);phoneEl.style.setProperty("--bg",colors.background);phoneEl.style.setProperty("--card",colors.card);phoneEl.style.setProperty("--text",isLight(colors.background)?"#111827":"#fff");phoneEl.style.setProperty("--card-text",isLight(colors.card)?"#111827":"#fff");phoneEl.style.setProperty("--primary-text",isLight(colors.primary)?"#111827":"#fff");
 document.querySelectorAll(".theme-option").forEach(x=>x.classList.toggle("active",x.dataset.theme===key));
 document.getElementById("chatThemeGrid").classList.toggle("disabled",syncEl.checked);
 syncStatusEl.textContent=syncEl.checked?"Usando o tema "+({cyan:"Ciano",gold:"Dourado",light:"Claro",red:"Vermelho"}[key])+" do seu site.":"Tema independente do site.";
}
function load(){enabledEl.checked=bot.enabled!==false;nameEl.value=bot.name||fallback.name;greetingEl.value=bot.greeting||fallback.greeting;syncEl.checked=bot.syncWithSite!==false;bot.theme=themes[bot.theme]?bot.theme:(site.theme||"cyan");applyPreview()}
document.querySelectorAll(".theme-option").forEach(btn=>btn.onclick=()=>{if(syncEl.checked)return;bot.theme=btn.dataset.theme;applyPreview()});
[nameEl,greetingEl].forEach(el=>el.addEventListener("input",applyPreview));
syncEl.onchange=()=>{if(syncEl.checked)bot.theme=site.theme||"cyan";applyPreview()};
copyEl.onclick=async()=>{const url=new URL("/chatbot/index.html",location.origin).href;try{await navigator.clipboard.writeText(url);copyEl.textContent="Copiado ✓";setTimeout(()=>copyEl.textContent="Copiar link",1600)}catch(e){prompt("Copie o link:",url)}};
saveEl.onclick=()=>{const key=currentTheme();bot={enabled:enabledEl.checked,name:nameEl.value.trim()||fallback.name,greeting:greetingEl.value.trim()||fallback.greeting,syncWithSite:syncEl.checked,theme:key,colors:{...themes[key]}};localStorage.setItem("barberChatbot",JSON.stringify(bot));if(syncEl.checked){const latest=JSON.parse(localStorage.getItem("barberSite")||"{}");latest.theme=key;latest.colors={...themes[key]};localStorage.setItem("barberSite",JSON.stringify(latest))}stateEl.textContent="Alterações salvas neste navegador ✓";setTimeout(()=>stateEl.textContent="",2200);applyPreview()};
load();