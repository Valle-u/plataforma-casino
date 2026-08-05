/**
 * WebPushProvider — envío real via Web Push (protocolo estándar, VAPID).
 *
 * Usa la lib `web-push` (no SDK de un vendor específico): el mismo código
 * sirve para Android/Chrome (FCM), iOS/macOS (APNs) y desktop.
 *
 * Diseño:
 *   - `setVapidDetails` se llama una vez en el constructor con las 3
 *     env vars: subject (mailto), publicKey, privateKey.
 *   - `send` cifra el payload JSON `{title, body, url, icon}` contra el
 *     endpoint del dispositivo (ES con cifrado por autenticado) y lo
 *     envia al push service.
 *   - Si el push service responde 404/410 → la suscripción ya no existe
 *     (dispositivo desinstalado o endpoint expirado). Tiramos
 *     `PushSubscriptionGoneError` para que el dispatcher la borre.
 *   - Cualquier otro error (network, 5xx, VAPID inválido) → Error genérico.
 *
 * Config (via env):
 *   - `VAPID_PUBLIC_KEY` — clave pública VAPID (la exponemos al cliente
 *     para que la pase a `pushManager.subscribe`).
 *   - `VAPID_PRIVATE_KEY` — clave privada (NUNCA sale del servidor).
 *   - `VAPID_SUBJECT` — mailto o https del contacto (lo exige el protocolo).
 *
 * Si alguna falta, el module factory NO instancia este provider — usa el
 * `ConsolePushProvider` fallback. La validación de env la hace el factory;
 * este constructor ya recibe las 3 garantizadas.
 */

import { Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import type { PushMessage, PushProvider, PushSubscriptionKeys } from './push-provider.interface';

/**
 * Error tipado para suscripciones que ya no existen (404/410).
 * El dispatcher lo usa para borrar la suscripción del device.
 */
export class PushSubscriptionGoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PushSubscriptionGoneError';
  }
}

export interface WebPushConfig {
  vapidPublicKey: string;
  vapidPrivateKey: string;
  vapidSubject: string;
}

const TTL_SECONDS = 60 * 60 * 24; // 24h de vida del mensaje en el push service.

@Injectable()
export class WebPushProvider implements PushProvider {
  private readonly logger = new Logger('WebPushProvider');
  private readonly vapidPublicKey: string;

  constructor(config: WebPushConfig) {
    this.vapidPublicKey = config.vapidPublicKey;
    webpush.setVapidDetails(
      config.vapidSubject,
      config.vapidPublicKey,
      config.vapidPrivateKey,
    );
    this.logger.log('WebPushProvider inicializado con VAPID keys.');
  }

  /** Clave pública VAPID — el cliente la usa en `pushManager.subscribe`. */
  getPublicKey(): string {
    return this.vapidPublicKey;
  }

  async send(subscription: PushSubscriptionKeys, msg: PushMessage): Promise<void> {
    const payload = JSON.stringify({
      title: msg.title,
      body: msg.body,
      url: msg.url,
      icon: msg.icon ?? '/icons/icon-192.png',
    });
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        },
        payload,
        { TTL: TTL_SECONDS },
      );
      this.logger.debug(
        `Push enviada a ${subscription.endpoint.slice(0, 60)}... (tenant=${msg.tenantSlug ?? 'unknown'})`,
      );
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        throw new PushSubscriptionGoneError(`push_subscription_gone_${statusCode}`);
      }
      throw new Error(`push_send_failed: ${(err as Error).message}`);
    }
  }
}
