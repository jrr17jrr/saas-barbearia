document.addEventListener("DOMContentLoaded", () => {
  const isLightColor=hex=>{const c=(hex||"#000000").replace("#","");const r=parseInt(c.slice(0,2),16),g=parseInt(c.slice(2,4),16),b=parseInt(c.slice(4,6),16);return (r*299+g*587+b*114)/1000>170};
  const savedSite=JSON.parse(localStorage.getItem("barberSite")||"null");
  if(savedSite){
    const colors=savedSite.colors||{primary:"#08a9df",background:"#0b1220",card:"#131e31"};
    const light=isLightColor(colors.background),primaryLight=isLightColor(colors.primary);document.documentElement.style.setProperty("--site-primary",colors.primary);document.documentElement.style.setProperty("--site-primary-text",primaryLight?"#111827":"#ffffff");document.documentElement.style.setProperty("--site-bg",colors.background);document.documentElement.style.setProperty("--site-card",colors.card);document.documentElement.style.setProperty("--site-text",light?"#111827":"#ffffff");document.documentElement.style.setProperty("--site-muted",light?"#64748b":"#8190a5");document.documentElement.style.setProperty("--site-surface",light?"#f1f5f9":"#0d1728");document.documentElement.style.setProperty("--site-border",light?"#dbe3ee":"#223149");
    const title=document.querySelector(".container > h1"); if(title) title.textContent=savedSite.name||"Barbearia Vision";
    const logo=document.querySelector(".container > .logo"); if(logo&&savedSite.logo) logo.src=savedSite.logo;
    const status=document.querySelector(".status"); if(status) status.lastChild.textContent=" "+(savedSite.status||"Aberto agora");
    const info=document.querySelectorAll(".info-card b"); if(info[1]&&savedSite.address) info[1].textContent=savedSite.address;
    const social=document.querySelector(".social");if(social){const links=[{key:"instagram",enabled:savedSite.instagramEnabled!==false,value:savedSite.instagram},{key:"whatsapp",enabled:savedSite.whatsappEnabled!==false,value:savedSite.whatsapp},{key:"facebook",enabled:!!savedSite.facebookEnabled,value:savedSite.facebook},{key:"tiktok",enabled:savedSite.tiktokEnabled!==false,value:savedSite.tiktok}];[...social.children].forEach((a,i)=>{const s=links[i];if(!s?.enabled){a.style.display="none";return;}a.style.display="grid";if(s.value){let href=s.value;if(s.key==="whatsapp")href="https://wa.me/55"+s.value.replace(/\D/g,"");else if(!/^https?:/i.test(href)){if(s.key==="instagram")href="https://instagram.com/"+href.replace("@","");if(s.key==="tiktok")href="https://tiktok.com/@"+href.replace("@","");}a.href=href;a.target="_blank";}})}
    const section=document.querySelector(".services"); if(section&&savedSite.services?.length){section.innerHTML=`<h2>Serviços</h2>`+savedSite.services.map(s=>`<div class="service-card"><img src="${s.image||"/img/disfarcado.jpg"}" alt="${s.name}"><div class="service-info"><h3>${s.name}</h3><p>${s.description||""}</p><div class="details"><span>${s.duration} min</span><span>R$ ${s.price}</span></div><a href="#" class="schedule-btn">Agendar</a></div></div>`).join("");}
  }
  const services = [...document.querySelectorAll(".service-card")].map((card, index) => {
    const details = card.querySelectorAll(".details span");
    return {
      index,
      name: card.querySelector("h3")?.textContent.trim() || "Serviço",
      description: card.querySelector("p")?.textContent.trim() || "",
      duration: details[0]?.textContent.replace("⏱","").trim() || "",
      price: details[1]?.textContent.replace("💰","").trim() || ""
    };
  });

  document.body.insertAdjacentHTML("beforeend", `
    <div class="booking-overlay" id="bookingOverlay">
      <div class="booking-modal">
        <div class="booking-handle"></div>
        <div class="booking-header"><div><small>${savedSite?.name||"Barbearia Vision"}</small><h2>Agendar horário</h2></div><button class="booking-close" aria-label="Fechar">×</button></div>
        <div class="booking-progress"><span></span><span></span><span></span><span></span></div>
        <div id="bookingContent"></div>
      </div>
    </div>`);

  const overlay=document.getElementById("bookingOverlay"), content=document.getElementById("bookingContent");
  let state={service:null,date:null,time:null,name:"",phone:""};
  const labels=["DOM","SEG","TER","QUA","QUI","SEX","SÁB"];
  const times=["08:00","08:40","09:20","10:00","10:40","11:20","13:00","13:40","14:20","15:00","15:40","16:20","17:00"];

  function progress(n){document.querySelectorAll(".booking-progress span").forEach((x,i)=>x.classList.toggle("active",i<n));}
  function selectedService(){return `<div class="booking-selected"><b>${state.service.name}</b><small>${state.service.duration} • ${state.service.price}</small></div>`;}
  function open(service=null){state={service,date:null,time:null,name:"",phone:""};overlay.classList.add("open");document.body.classList.add("booking-open");service?renderDate():renderServices();}
  function close(){overlay.classList.remove("open");document.body.classList.remove("booking-open");}

  function renderServices(){
    progress(1);
    content.innerHTML=`<p class="booking-step-title">Escolha o serviço</p><div class="booking-service-list">${services.map(s=>`
      <button class="booking-service-option" data-service="${s.index}">
        <div><b>${s.name}</b><small>${s.description}</small></div><span>${s.price}<small>${s.duration}</small></span>
      </button>`).join("")}</div>`;
    content.querySelectorAll("[data-service]").forEach(btn=>btn.onclick=()=>{state.service=services[+btn.dataset.service];renderDate();});
  }

  function renderDate(){
    progress(2);
    let days="", cursor=new Date(), count=0;
    while(count<7){
      const d=new Date(cursor); d.setDate(cursor.getDate()+count);
      if(d.getDay()!==0){
        const key=d.toISOString().slice(0,10), today=count===0;
        days+=`<button class="booking-day" data-date="${key}" data-label="${today?"HOJE":labels[d.getDay()]} ${d.getDate()}"><b>${today?"HOJE":labels[d.getDay()]}</b><small>${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}</small></button>`;
      }
      count++;
    }
    content.innerHTML=selectedService()+`<p class="booking-step-title">Escolha o dia</p><div class="booking-days">${days}</div><div class="booking-actions"><button class="booking-back">Voltar</button><button class="booking-next" disabled>Ver horários</button></div>`;
    const next=content.querySelector(".booking-next");
    content.querySelectorAll(".booking-day").forEach(btn=>btn.onclick=()=>{content.querySelectorAll(".booking-day").forEach(x=>x.classList.remove("active"));btn.classList.add("active");state.date={key:btn.dataset.date,label:btn.dataset.label};next.disabled=false;});
    content.querySelector(".booking-back").onclick=renderServices; next.onclick=renderTime;
  }

  function renderTime(){
    progress(3);
    content.innerHTML=`<div class="booking-selected"><b>${state.service.name}</b><small>${state.date.label} • ${state.service.duration}</small></div><p class="booking-step-title">Horários disponíveis</p><div class="booking-times">${times.map((t,i)=>`<button class="booking-time" ${i===3||i===8?"disabled":""} data-time="${t}">${t}</button>`).join("")}</div><p class="booking-demo-note">Horários indisponíveis estão bloqueados. Nesta prévia, a disponibilidade ainda é demonstrativa.</p><div class="booking-actions"><button class="booking-back">Voltar</button><button class="booking-next" disabled>Continuar</button></div>`;
    const next=content.querySelector(".booking-next");
    content.querySelectorAll(".booking-time:not(:disabled)").forEach(btn=>btn.onclick=()=>{content.querySelectorAll(".booking-time").forEach(x=>x.classList.remove("active"));btn.classList.add("active");state.time=btn.dataset.time;next.disabled=false;});
    content.querySelector(".booking-back").onclick=renderDate;next.onclick=renderData;
  }

  function renderData(){
    progress(4);
    content.innerHTML=`<div class="booking-selected"><b>${state.date.label} às ${state.time}</b><small>${state.service.name} • ${state.service.price}</small></div><p class="booking-step-title">Seus dados</p><label class="booking-label">Nome<input id="bookingName" placeholder="Ex.: João Silva" value="${state.name}"></label><label class="booking-label">WhatsApp<input id="bookingPhone" inputmode="tel" placeholder="(21) 99999-9999" value="${state.phone}"></label><div class="booking-actions"><button class="booking-back">Voltar</button><button class="booking-next">Revisar agendamento</button></div>`;
    content.querySelector(".booking-back").onclick=renderTime;
    content.querySelector(".booking-next").onclick=()=>{state.name=document.getElementById("bookingName").value.trim();state.phone=document.getElementById("bookingPhone").value.trim();if(!state.name||!state.phone){alert("Preencha seu nome e WhatsApp.");return;}renderConfirm();};
  }

  function renderConfirm(){
    progress(4);
    content.innerHTML=`<p class="booking-step-title">Confira seu agendamento</p><div class="booking-summary"><b>${state.service.name}</b><span>📅 ${state.date.label}</span><span>🕒 ${state.time}</span><span>⏱ ${state.service.duration}</span><span>💰 ${state.service.price}</span><span>👤 ${state.name}</span><span>📱 ${state.phone}</span></div><div class="booking-actions"><button class="booking-back">Voltar</button><button class="booking-next">Confirmar agendamento</button></div>`;
    content.querySelector(".booking-back").onclick=renderData;
    content.querySelector(".booking-next").onclick=()=>{content.innerHTML=`<div class="booking-success"><div>✓</div><h3>Agendamento confirmado!</h3><p>${state.service.name}<br>${state.date.label} às ${state.time}</p><small>Prévia visual: o salvamento no banco será conectado na próxima etapa.</small><button class="booking-next">Fechar</button></div>`;content.querySelector(".booking-next").onclick=close;};
  }

  document.querySelector(".main-schedule-btn")?.addEventListener("click",e=>{e.preventDefault();open();});
  document.querySelectorAll(".schedule-btn").forEach((btn,i)=>btn.addEventListener("click",e=>{e.preventDefault();open(services[i]);}));
  document.querySelector(".booking-close").onclick=close;
  overlay.addEventListener("click",e=>{if(e.target===overlay)close();});
  document.addEventListener("keydown",e=>{if(e.key==="Escape")close();});

  // Chatbot: protótipo front-end, sem banco.
  const botCfg=savedSite?.chatbot||{enabled:true,name:"Assistente Barber",greeting:"Olá! Vou te ajudar a agendar seu horário."};
  if(botCfg.enabled!==false){
    document.body.insertAdjacentHTML("beforeend",`
      <button class="chatbot-launch" id="chatbotLaunch">${botCfg.button||"Conversar e agendar"}</button>
      <section class="chatbot-panel" id="chatbotPanel">
        <div class="chatbot-head"><div><b>${botCfg.name||"Assistente Barber"}</b><small>Agendamento online</small></div><button id="chatbotClose">×</button></div>
        <div class="chatbot-messages" id="chatMessages"></div>
        <div class="chat-options" id="chatOptions"></div>
        <div class="chat-inputbar hidden" id="chatInputbar"><input id="chatInput" autocomplete="off"><button id="chatSend">Enviar</button></div>
      </section>`);
    const panel=document.getElementById("chatbotPanel"),msgs=document.getElementById("chatMessages"),opts=document.getElementById("chatOptions"),bar=document.getElementById("chatInputbar"),input=document.getElementById("chatInput");
    let chat={step:"name",name:"",phone:"",service:null,date:null,time:null};
    const say=(txt,user=false)=>{msgs.insertAdjacentHTML("beforeend",`<div class="chat-msg ${user?"user":""}">${txt}</div>`);msgs.scrollTop=msgs.scrollHeight};
    const askInput=(placeholder,cb)=>{opts.innerHTML="";bar.classList.remove("hidden");input.placeholder=placeholder;input.value="";input.focus();const send=()=>{const v=input.value.trim();if(!v)return;say(v,true);bar.classList.add("hidden");cb(v)};document.getElementById("chatSend").onclick=send;input.onkeydown=e=>{if(e.key==="Enter")send()}};
    const choose=(items,cb)=>{bar.classList.add("hidden");opts.innerHTML=items.map((x,i)=>`<button data-i="${i}">${x.label}</button>`).join("");opts.querySelectorAll("button").forEach(b=>b.onclick=()=>{const x=items[+b.dataset.i];say(x.label,true);opts.innerHTML="";cb(x.value)})};
    function startChat(){msgs.innerHTML="";opts.innerHTML="";chat={};say(botCfg.greeting||"Olá! Vou te ajudar a agendar seu horário.");setTimeout(()=>{say("Qual é o seu nome?");askInput("Digite seu nome",v=>{chat.name=v;say(`Prazer, ${v}! Qual é o seu WhatsApp com DDD?`);askInput("(21) 99999-9999",v2=>{chat.phone=v2;chatService()})})},250)}
    function chatService(){say("Qual serviço você quer agendar?");choose(services.map(s=>({label:`${s.name} — ${s.price} · ${s.duration}`,value:s})),s=>{chat.service=s;chatDate()})}
    function chatDate(){say("Escolha o dia.");const arr=[];let d=new Date();for(let i=0;i<7;i++){const x=new Date(d);x.setDate(d.getDate()+i);if(x.getDay()!==0)arr.push({label:`${i===0?"Hoje":labels[x.getDay()]} · ${String(x.getDate()).padStart(2,"0")}/${String(x.getMonth()+1).padStart(2,"0")}`,value:{key:x.toISOString().slice(0,10),label:i===0?"Hoje":labels[x.getDay()]+" "+x.getDate()}})}choose(arr,v=>{chat.date=v;chatTime()})}
    function chatTime(){say("Qual horário fica melhor?");choose(times.filter((_,i)=>i!==3&&i!==8).map(t=>({label:t,value:t})),t=>{chat.time=t;chatReview()})}
    function chatReview(){say(`Confira: <b>${chat.service.name}</b><br>${chat.date.label} às ${chat.time}<br>${chat.name} · ${chat.phone}`);choose([{label:"Confirmar agendamento",value:true},{label:"Começar novamente",value:false}],ok=>{if(ok){say("Agendamento confirmado nesta prévia ✓");say("Quando conectarmos o Supabase, é aqui que ele será salvo na agenda.");opts.innerHTML='<button id="chatAgain">Fazer outro agendamento</button>';document.getElementById("chatAgain").onclick=startChat}else startChat()})}
    document.getElementById("chatbotLaunch").onclick=()=>{panel.classList.add("open");if(!msgs.children.length)startChat()};
    document.getElementById("chatbotClose").onclick=()=>panel.classList.remove("open");
  }
});