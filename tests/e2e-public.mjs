// Read-only browser checks of public pages (no booking submitted).
import puppeteer from "puppeteer-core";
// Usage: npx serve-like static server on BASE, then: node tests/e2e-public.mjs [screenshotDir]
// Env: BASE (default http://localhost:5173), CHROME_PATH.
const BASE=process.env.BASE||"http://localhost:5173",out=process.argv[2]||".";
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:"new",args:["--no-sandbox"]});
const results=[];const ok=(name,pass,info="")=>{results.push({name,pass,info});console.log((pass?"PASS ":"FAIL ")+name+(info?" — "+info:""));};
async function page(url,vp={width:1280,height:900}){const p=await browser.newPage();await p.setViewport(vp);const errors=[];p.on("pageerror",e=>errors.push(e.message));p.on("console",m=>{if(m.type()==="error")errors.push(m.text());});await p.goto(BASE+url,{waitUntil:"networkidle0",timeout:30000});return {p,errors};}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
// Public site
{const {p,errors}=await page("/link-agendamento/?loja=barbearia-vision");
 const title=await p.$eval(".container > h1",e=>e.textContent);ok("site: shop name",title==="Barbearia Vision",title);
 const cards=await p.$$eval(".service-card h3",e=>e.map(x=>x.textContent));ok("site: real services",cards.length===3,cards.join(", "));
 const slots=await p.$$eval(".info-card b",e=>e.map(x=>x.textContent));ok("site: info cards",!slots.includes("Consultando..."),slots.join(" | "));
 await p.click(".service-card .schedule-btn");await wait(300);
 const days=await p.$$(".booking-day");ok("site: days listed",days.length>0,days.length+" dias");
 // pick the 2nd open day (tomorrow-ish) to have slots
 await days[Math.min(1,days.length-1)].click();await p.click(".booking-next");await wait(2500);
 const times=await p.$$eval(".booking-time",e=>e.map(x=>x.textContent));ok("site: real slots",times.length>0,times.length+" horários, primeiro "+times[0]);
 await p.screenshot({path:out+"/site-desktop.png"});
 ok("site: no JS errors",errors.filter(e=>!/favicon/.test(e)).length===0,errors.join(" ; "));await p.close();}
{const {p,errors}=await page("/link-agendamento/?loja=nao-existe",{width:390,height:844});const t=await p.$eval(".container h1",e=>e.textContent);ok("site: invalid slug message",/indispon/i.test(t),t);ok("site invalid: no JS errors",errors.length===0,errors.join(";"));await p.close();}
{const {p,errors}=await page("/link-agendamento/?loja=barbearia-vision",{width:390,height:844,isMobile:true,hasTouch:true});await p.screenshot({path:out+"/site-mobile.png",fullPage:true});const w=await p.evaluate(()=>document.documentElement.scrollWidth);ok("site mobile: no horizontal overflow",w<=390,"scrollWidth "+w);ok("site mobile: no JS errors",errors.length===0,errors.join(";"));await p.close();}
// Chatbot
{const {p,errors}=await page("/chatbot/?loja=barbearia-vision",{width:390,height:844,isMobile:true,hasTouch:true});
 const name=await p.$eval("#shopName",e=>e.textContent);ok("chatbot: shop name",name==="Barbearia Vision",name);
 const bot=await p.$eval("#botName",e=>e.textContent);ok("chatbot: bot name from settings",bot==="Vision Bot",bot);
 await p.type("#chatInput","Teste Navegador");await p.click("#chatSend");await wait(200);
 await p.type("#chatInput","21999990000");await p.click("#chatSend");await wait(200);
 const svc=await p.$$("#chatOptions button");ok("chatbot: services offered",svc.length===3,svc.length+"");
 await svc[0].click();await wait(200);const d=await p.$$("#chatOptions button");ok("chatbot: days offered",d.length>0,d.length+"");
 await d[Math.min(1,d.length-1)].click();await wait(2500);const t=await p.$$eval("#chatOptions button",e=>e.map(x=>x.textContent));ok("chatbot: real slots",t.length>1,t.length+" opções, primeira "+t[0]);
 await p.screenshot({path:out+"/chatbot-mobile.png"});
 ok("chatbot: no JS errors",errors.length===0,errors.join(";"));await p.close();}
// Reservar
{const {p,errors}=await page("/reservar/?loja=barbearia-vision",{width:390,height:844});const n=await p.$eval("#shopName",e=>e.textContent);ok("reservar: shop",n==="Barbearia Vision",n);ok("reservar: no JS errors",errors.length===0,errors.join(";"));await p.close();}
// Private pages must redirect to login when anonymous
{const p=await browser.newPage();for(const path of ["/dashboard/","/agendamentos/","/servicos/","/clientes/","/horarios/","/lucros/","/editar-link/","/chatbot-config/","/dev/"]){await p.goto(BASE+path,{waitUntil:"domcontentloaded"}).catch(()=>{});await p.waitForFunction(()=>location.pathname.startsWith("/login/"),{timeout:8000}).catch(()=>{});ok("anon redirect "+path,p.url().includes("/login/"),p.url());}await p.close();}
{const {p,errors}=await page("/login/",{width:390,height:844});ok("login: renders",!!await p.$("#email"));ok("login: no JS errors",errors.length===0,errors.join(";"));await p.close();}
// PWA basics
{const {p,errors}=await page("/login/");
 const sw=await p.evaluate(async()=>{const r=await navigator.serviceWorker.ready;return !!r.active;});ok("pwa: service worker active",sw);
 const m=await p.evaluate(async()=>{const r=await fetch("/manifest.webmanifest");const j=await r.json();const icons=await Promise.all(j.icons.map(i=>fetch(i.src).then(x=>x.ok)));return {display:j.display,icons:icons.every(Boolean),sizes:j.icons.map(i=>i.sizes).join(",")};});
 ok("pwa: manifest standalone + icons",m.display==="standalone"&&m.icons&&/192/.test(m.sizes)&&/512/.test(m.sizes),JSON.stringify(m));
 ok("pwa: push API available",await p.evaluate(()=>"PushManager" in window&&"Notification" in window));
 ok("pwa: no JS errors",errors.length===0,errors.join(";"));await p.close();}
await browser.close();
const failed=results.filter(r=>!r.pass).length;console.log(`\n${results.length-failed}/${results.length} passed`);process.exit(failed?1:0);
