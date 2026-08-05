/**
 * ConsolePushProvider — default no-op para dev / tests / MVP sin VAPID.
 *
 * Loguea con prefijo `[PUSH]` para que sea facil grep en logs. Sin envío
 * real. Cuando el proyecto configure VAPID keys en env, el module factory
 * instancia `WebPushProvider` y este queda como fallback para local dev.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { PushMessage, PushProvider, PushSubscriptionKeys } from './push-provider.interface';

@Injectable()
export class ConsolePushProvider implements PushProvider {
  private readonly logger = new Logger('ConsolePushProvider');

  send(subscription: PushSubscriptionKeys, msg: PushMessage): Promise<void> {
    this.logger.log(
      `[PUSH] to=${subscription.endpoint.slice(0, 60)}... tenant=${msg.tenantSlug ?? 'unknown'} ` +
        `title="${msg.title}" url=${msg.url}`,
    );
    this.logger.debug(`[PUSH BODY] ${msg.body}`);
    return Promise.resolve();
  }
}
