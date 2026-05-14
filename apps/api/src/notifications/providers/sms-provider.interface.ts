/**
 * Abstract del proveedor de SMS.
 *
 * Análogo a `EmailProvider`. Implementaciones:
 *   - `ConsoleSmsProvider` (default dev): loguea con prefijo.
 *   - `TwilioSmsProvider`: REST API de Twilio (sin SDK npm, fetch directo
 *     para evitar dependencia pesada y mantener portabilidad).
 *
 * Diseño:
 *   - `send` devuelve void en éxito y tira en falla. El dispatcher marca
 *     la notif como 'failed' con `error` poblado.
 *   - Sin reintentos automáticos en el provider — decisión del dispatcher
 *     (hoy: no reintenta, futuro: backoff exponencial con max attempts).
 *   - El número destinatario llega como string. El provider valida
 *     formato si su API lo requiere (e.g. Twilio quiere E.164 "+549...").
 *     Si el number es inválido el provider tira con mensaje claro.
 */

export interface SmsMessage {
  /** Número destinatario. Idealmente E.164 ("+5491133334444"). */
  to: string;
  /** Cuerpo del mensaje. SMS suele cortar a 160 chars — provider decide. */
  body: string;
  /** Identificador del tenant para logs / from-resolution. */
  tenantSlug?: string;
}

export interface SmsProvider {
  send(msg: SmsMessage): Promise<void>;
}

/** DI token. */
export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
