// BarberSaaS service worker: offline fallback for static files and Web Push notifications.
const CACHE="barbersaas-v2";
self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",event=>{event.waitUntil((async()=>{for(const key of await caches.keys())if(key!==CACHE)await caches.delete(key);await self.clients.claim();})());});
self.addEventListener("fetch",event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=="GET"||url.origin!==self.location.origin)return;
 // Network first: data always comes fresh from Supabase; cache only serves offline.
 event.respondWith(fetch(request).then(response=>{if(response.ok&&response.type==="basic"){const copy=response.clone();caches.open(CACHE).then(c=>c.put(request,copy));}return response;}).catch(async()=>(await caches.match(request))||(await caches.match(url.pathname.endsWith("/")?url.pathname+"index.html":url.pathname))||Response.error()));
});
self.addEventListener("push",event=>{
 let data={};
 try{data=event.data?.json()||{};}catch{data={body:event.data?.text()};}
 const url=typeof data.url==="string"&&data.url.startsWith("/")?data.url:"/agendamentos/";
 event.waitUntil((async()=>{
  await self.registration.showNotification(data.title||"Novo agendamento",{body:data.body||"Confira sua agenda.",icon:"/img/icon-192.png",tag:data.tag||"booking",renotify:true,data:{url},timestamp:Date.now()});
  for(const client of await self.clients.matchAll({type:"window",includeUncontrolled:true}))client.postMessage({type:"new-booking",payload:data});
 })());
});
self.addEventListener("notificationclick",event=>{
 event.notification.close();
 const target=new URL(event.notification.data?.url||"/agendamentos/",self.location.origin).href;
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
  for(const client of windows){if(new URL(client.url).origin===self.location.origin&&"focus" in client){await client.focus();if("navigate" in client)return client.navigate(target);return;}}
  return self.clients.openWindow(target);
 })());
});
// Browser rotated the subscription: open pages re-sync it with the server on next load.
self.addEventListener("pushsubscriptionchange",event=>{
 event.waitUntil((async()=>{for(const client of await self.clients.matchAll({type:"window",includeUncontrolled:true}))client.postMessage({type:"resubscribe"});})());
});
