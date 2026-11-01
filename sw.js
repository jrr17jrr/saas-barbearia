/* BarberSaaS service worker
 * - Navegação e arquivos do app: network-first (sempre busca a versão nova; cache só para offline).
 *   Isso evita o "PWA preso em versão antiga".
 * - Supabase/API e outros domínios: nunca interceptados (dados sempre do servidor, sessão intacta).
 * - Nova versão: instala e espera; a página mostra "Nova versão disponível" e envia SKIP_WAITING.
 * - Push: exibe a notificação e, ao tocar, abre/foca a Agenda no agendamento correspondente.
 */
const VERSION = "2026-11-01.1";
const CACHE = `barbersaas-${VERSION}`;
const PRECACHE = [
  "/offline.html", "/menu.css", "/ui.css", "/menu.js", "/supabase-client.js",
  "/js/app.js", "/js/ui.js", "/js/pwa.js", "/js/push.js",
  "/icons/icon-192.png", "/icons/icon-512.png", "/manifest.webmanifest",
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).catch(() => {}));
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith("barbersaas-") && k !== CACHE).map(k => caches.delete(k)));
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, CDNs, fontes: direto na rede
  if (url.pathname === "/sw.js") return;

  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        const res = preload || await fetch(req);
        if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone())).catch(() => {});
        return res;
      } catch {
        return (await caches.match(req)) || (await caches.match("/offline.html"));
      }
    })());
    return;
  }

  if (/\.(?:js|css|png|jpg|jpeg|webp|svg|webmanifest|ico)$/.test(url.pathname)) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req, { cache: "no-cache" });
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); }
        return res;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        throw new Error("offline");
      }
    })());
  }
});

// ------------------------------------------------------------------ Web Push
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "BarberSaaS", body: event.data?.text() || "" }; }
  const title = data.title || "BarberSaaS";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || "/agendamentos/", appointment_id: data.appointment_id || null },
    vibrate: [80, 40, 80],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/agendamentos/", self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = all.find(c => new URL(c.url).origin === self.location.origin);
    if (client) {
      await client.focus();
      if ("navigate" in client) return client.navigate(target.href);
      return;
    }
    return self.clients.openWindow(target.href);
  })());
});

// Navegador renovou a subscription: o painel re-registra ao abrir (refreshPushRegistration)
self.addEventListener("pushsubscriptionchange", () => {});
