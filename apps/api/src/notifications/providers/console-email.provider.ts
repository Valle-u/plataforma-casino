/**
 * ConsoleEmailProvider — default no-op para dev / MVP.
 *
 * Loguea con prefijo `[EMAIL]` para que sea facil grep en logs. Sin
 * envío real. Cuando el proyecto agregue SMTP/SES/SendGrid, se cambia
 * el provider del module y este queda como fallback para local dev.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { EmailMessage, EmailProvider } from './email-provider.interface';

@Injectable()
export class ConsoleEmailProvider implements EmailProvider {
  private readonly logger = new Logger('ConsoleEmailProvider');

  send(msg: EmailMessage): Promise<void> {
    this.logger.log(
      `[EMAIL] to=${msg.to} tenant=${msg.tenantSlug ?? 'unknown'} ` +
        `subject="${msg.subject}"`,
    );
    // Body multiline en debug — evita ruido en logs normales.
    this.logger.debug(`[EMAIL BODY] ${msg.body}`);
    return Promise.resolve();
  }
}
