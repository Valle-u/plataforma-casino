/**
 * Abstract del proveedor de Web Push.
 *
 * Análogo a `EmailProvider` / `SmsProvider`. Implementaciones:
 *   - `ConsolePushProvider` (default dev/tests): loguea con prefijo.
 *   - `WebPushProvider`: protocolo Web Push estándar (VAPID) usando la
 *     lib `web-push`. Requiere VAPID keys en env.
 *
 * Diseño:
 *   - `send` devuelve void en éxito y tira en falla. El dispatcher
 *     marca la notif como 'failed' con `error` poblado.
 *   - Si el push service responde 404/410 (dispositivo desinstalado /
 *     endpoint expirado), el provider tira `PushSubscriptionGoneError` —
 *     el dispatcher borra la suscripción y sigue con las demás.
 *   - El payload que llega al service worker es JSON:
 *     `{ title, body, url, icon }` (ver `public/sw.js` en apps/web).
 */

export interface PushSubscriptionKeys {
  /** URL única que el dispositivo registró contra el push service. */
  endpoint: string;
  /** Clave pública de cifrado (base64url). */
  p256dh: string;
  /** Secreto de autenticación (base64url). */
  auth: string;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Deep link (path relativo dentro de la SPA). */
  url: string;
  icon?: string;
  tenantSlug?: string;
}

export interface PushProvider {
  /** Tira en error. Caller hace fail-soft. */
  send(subscription: PushSubscriptionKeys, msg: PushMessage): Promise<void>;
}

/** DI token. */
export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');
