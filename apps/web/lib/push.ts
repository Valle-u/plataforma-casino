/**
 * Web Push helpers (Fase 3) — suscripción del dispositivo del user.
 *
 * El flujo (requiere gesto del user en iOS):
 *   1. `Notification.requestPermission()` → 'granted'.
 *   2. Registramos/obtenemos el service worker.
 *   3. `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: <VAPID pública> })`
 *      → el browser genera endpoint + claves de cifrado.
 *   4. POST de la suscripción al backend (`/tenant/push-subscriptions`).
 *
 * Fail-soft total: cualquier falla devuelve false/null y NO rompe la UI.
 */

import { apiDelete, apiGet, apiPost } from '@/lib/api-client';

const DISMISS_KEY_PREFIX = 'casino_push_prompt_dismissed_';

export type PushPanel = 'admin' | 'player';

export function isPushSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function hasPushDismissed(panel: PushPanel): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY_PREFIX + panel) === '1';
  } catch {
    return false;
  }
}

export function setPushDismissed(panel: PushPanel): void {
  try {
    window.localStorage.setItem(DISMISS_KEY_PREFIX + panel, '1');
  } catch {
    /* noop */
  }
}

function urlBase64ToUint8Array(base64Url: string) {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(base64 + padding);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return existing;
  return navigator.serviceWorker.register('/sw.js');
}

async function fetchVapidPublicKey(): Promise<string | null> {
  try {
    const res = await apiGet<{ publicKey: string | null }>(
      '/tenant/push-subscriptions/vapid-public-key',
    );
    return res.publicKey;
  } catch {
    return null;
  }
}

/** Suscripción actual del dispositivo (null si no hay / no soporta). */
export async function getPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  try {
    const reg = await getRegistration();
    return reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Pide permiso y suscribe el dispositivo. Devuelve true si quedó
 * suscrito (o ya lo estaba). Llamar desde un handler de click.
 */
export async function subscribeToPush(): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    let permission = Notification.permission;
    if (permission === 'denied') return false;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') return false;

    const reg = await getRegistration();
    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      const publicKey = await fetchVapidPublicKey();
      if (!publicKey) return false;
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    if (!subscription) return false;

    const keys = subscription.toJSON() as { p256dh?: string; auth?: string };
    if (!subscription.endpoint || !keys.p256dh || !keys.auth) return false;

    await apiPost('/tenant/push-subscriptions', {
      endpoint: subscription.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      deviceLabel: (navigator.userAgent ?? '').slice(0, 200),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Desuscribe el dispositivo (dar de baja). Best-effort: si el
 * backend no responde, el push service igual deja de entregar.
 */
export async function unsubscribePush(): Promise<void> {
  if (!isPushSupported()) return;
  try {
    const reg = await getRegistration();
    const subscription = await reg.pushManager.getSubscription();
    if (!subscription) return;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    if (endpoint) {
      await apiDelete('/tenant/push-subscriptions', {
        json: { endpoint },
      }).catch(() => {
        /* noop — el push service dejó de entregar igual */
      });
    }
  } catch {
    /* noop */
  }
}
