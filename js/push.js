// Web Push no painel: permissão, subscription, registro no Supabase e teste.
import { supabase, SUPABASE_URL } from "/supabase-client.js";
import { isIOS, isStandalone, registerServiceWorker } from "/js/pwa.js";

export function pushSupport() {
  const hasSW = "serviceWorker" in navigator;
  const hasPush = "PushManager" in window;
  const hasNotif = "Notification" in window;
  if (hasSW && hasPush && hasNotif) return { supported: true };
  if (isIOS() && !isStandalone()) {
    return { supported: false, reason: "ios_not_installed", message: "No iPhone/iPad, as notificações só funcionam com o app instalado na Tela de Início (iOS 16.4 ou superior). Toque em Compartilhar → “Adicionar à Tela de Início” e abra pelo ícone." };
  }
  return { supported: false, reason: "unsupported", message: "Este navegador não suporta notificações push." };
}

async function getRegistration() {
  return (await navigator.serviceWorker.getRegistration("/")) || (await registerServiceWorker());
}

function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function callPushFunction(method, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/push`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* sem corpo */ }
  if (!res.ok) { const e = new Error(data.error || `HTTP ${res.status}`); e.code = data.error; e.status = res.status; throw e; }
  return data;
}

export async function currentPushState(shopId) {
  const support = pushSupport();
  if (!support.supported) return { state: "unsupported", ...support };
  if (Notification.permission === "denied") return { state: "denied" };
  const reg = await getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return { state: Notification.permission === "granted" ? "granted_no_sub" : "default" };
  const { data, error } = await supabase.from("push_subscriptions").select("id, created_at, last_success_at, failure_count, last_error").eq("endpoint", sub.endpoint).eq("barbershop_id", shopId).maybeSingle();
  if (error) return { state: "error", message: "Não foi possível verificar o registro deste aparelho." };
  return data ? { state: "enabled", device: data } : { state: "granted_no_sub" };
}

function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : "Dispositivo";
  const br = /Edg\//.test(ua) ? "Edge" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : "Navegador";
  return `${os} · ${br}${isStandalone() ? " (app)" : ""}`;
}

// Deve ser chamado a partir de um clique do usuário (exigência do iOS/Safari).
export async function enablePush(shopId) {
  const support = pushSupport();
  if (!support.supported) throw Object.assign(new Error(support.message), { code: support.reason });
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw Object.assign(new Error("Permissão de notificação não concedida."), { code: "denied" });
  const { publicKey } = await callPushFunction("GET");
  const reg = await getRegistration();
  if (!reg) throw new Error("Service worker indisponível.");
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // Se a chave VAPID mudou, recria a subscription
  if (sub && sub.options?.applicationServerKey && b64(sub.options.applicationServerKey) !== publicKey.replace(/=+$/, "")) {
    await sub.unsubscribe(); sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  const json = sub.toJSON();
  const { error } = await supabase.rpc("save_push_subscription", {
    p_shop_id: shopId, p_endpoint: json.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth,
    p_user_agent: navigator.userAgent, p_device_label: deviceLabel(),
  });
  if (error) throw error;
  return true;
}

export async function disablePush() {
  const reg = await navigator.serviceWorker?.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase.rpc("delete_push_subscription", { p_endpoint: sub.endpoint });
  await sub.unsubscribe().catch(() => {});
}

// Logout: remove a subscription deste aparelho para não receber notificações de outra conta.
export async function cleanupPushOnLogout() {
  try { await Promise.race([disablePush(), new Promise(r => setTimeout(r, 2500))]); } catch { /* ignora */ }
}

export async function sendTestPush(shopId) {
  return callPushFunction("POST", { action: "test", shop_id: shopId });
}

// Mantém o registro atualizado (ex.: navegador renovou a subscription)
export async function refreshPushRegistration(shopId) {
  try {
    if (!pushSupport().supported || Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    const json = sub.toJSON();
    await supabase.rpc("save_push_subscription", {
      p_shop_id: shopId, p_endpoint: json.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth,
      p_user_agent: navigator.userAgent, p_device_label: deviceLabel(),
    });
  } catch { /* silencioso */ }
}

export async function getPrefs(shopId, userId) {
  const { data, error } = await supabase.from("notification_preferences").select("*").eq("barbershop_id", shopId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data || { new_booking: true, cancellation: true, reschedule: true, reminder: true };
}
export async function savePrefs(shopId, userId, prefs) {
  const { error } = await supabase.from("notification_preferences").upsert({ user_id: userId, barbershop_id: shopId, ...prefs, updated_at: new Date().toISOString() });
  if (error) throw error;
}
