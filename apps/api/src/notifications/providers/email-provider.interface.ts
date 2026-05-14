/**
 * Abstract del proveedor de email.
 *
 * El dispatcher cron usa este token para enviar emails. Implementaciones:
 *   - `ConsoleEmailProvider` (default): loguea con prefijo. Sin envío real.
 *   - `SmtpEmailProvider` (futuro): wireup con nodemailer.
 *   - Provider-specific (futuro): SendGrid / AWS SES / Postmark.
 *
 * Diseño:
 *   - `send` devuelve void en éxito y tira en falla. El dispatcher
 *     marca la notif como 'failed' con `error` poblado.
 *   - Sin reintentos automáticos en el provider — el dispatcher es
 *     quien decide si reintenta (hoy: NO reintenta, futuro: backoff
 *     exponencial con max attempts).
 */

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
  /** Identificador del tenant para from-address resolution / logs. */
  tenantSlug?: string;
}

export interface EmailProvider {
  /** Tira en error. Caller hace fail-soft. */
  send(msg: EmailMessage): Promise<void>;
}

/** DI token. */
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
