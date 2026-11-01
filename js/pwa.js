// PWA: registro do service worker, aviso de nova versão e instalação.
// Estratégia anti "versão antiga presa": o SW nunca é servido do cache HTTP
// (updateViaCache: 'none' + Cache-Control no-cache na Vercel), verifica atualização
// ao abrir/voltar ao app e, quando há versão nova, oferece "Atualizar" (skipWaiting + reload).

let deferredInstall = null;
const listeners = new Set();
export const onInstallAvailable = fn => { listeners.add(fn); if (deferredInstall) fn(true); };

window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  deferredInstall = e;
  listeners.forEach(fn => fn(true));
});
window.addEventListener("appinstalled", () => { deferredInstall = null; listeners.forEach(fn => fn(false)); });

export const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export async function promptInstall() {
  if (!deferredInstall) return false;
  deferredInstall.prompt();
  const { outcome } = await deferredInstall.userChoice;
  deferredInstall = null;
  return outcome === "accepted";
}

function showUpdateBanner(reg) {
  if (document.getElementById("pwaUpdate")) return;
  const bar = document.createElement("div");
  bar.id = "pwaUpdate";
  bar.className = "pwa-update";
  bar.setAttribute("role", "alert");
  bar.innerHTML = `<span>Nova versão disponível</span><button type="button">Atualizar</button><button type="button" class="later" aria-label="Depois">×</button>`;
  document.body.appendChild(bar);
  bar.querySelector("button").onclick = () => {
    bar.querySelector("button").disabled = true;
    reg.waiting?.postMessage({ type: "SKIP_WAITING" });
  };
  bar.querySelector(".later").onclick = () => bar.remove();
}

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg);
    reg.addEventListener("updatefound", () => {
      const sw = reg.installing;
      sw?.addEventListener("statechange", () => {
        if (sw.state === "installed" && navigator.serviceWorker.controller) showUpdateBanner(reg);
      });
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
    // Verifica atualizações ao voltar para o app e a cada 30 min
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
    setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
    return reg;
  } catch (e) {
    console.warn("[pwa] falha ao registrar service worker", e);
    return null;
  }
}
