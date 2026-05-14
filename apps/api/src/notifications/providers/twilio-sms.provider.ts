/**
 * TwilioSmsProvider — envío real via Twilio REST API.
 *
 * Diseño:
 *   - **Sin SDK npm**: usamos `fetch` directo a la API REST de Twilio.
 *     Razón: evita arrastrar una dependencia con su árbol completo
 *     (~3MB) cuando solo necesitamos POST a 1 endpoint. Trade-off:
 *     no manejamos retries/throttling automáticos del SDK — los
 *     hacemos nosotros si emergen. Para MVP, suficiente.
 *   - Auth: HTTP Basic con `<accountSid>:<authToken>`.
 *   - Endpoint: `https://api.twilio.com/2010-04-01/Accounts/<sid>/Messages.json`.
 *   - Body: x-www-form-urlencoded con `To`, `From`, `Body`.
 *   - Errors: si Twilio responde 4xx/5xx, parseamos el JSON de error
 *     (`{code, message, more_info}`) y tiramos con mensaje legible.
 *
 * Config (via env):
 *   - `TWILIO_ACCOUNT_SID` — identificador de cuenta (empieza con AC...).
 *   - `TWILIO_AUTH_TOKEN` — secret de auth.
 *   - `TWILIO_FROM_NUMBER` — número emisor en formato E.164 (e.g. +14155552671).
 *
 * Si alguna falta, el module factory NO instancia este provider — usa
 * el `ConsoleSmsProvider` fallback. La validación de env la hace el
 * factory; este constructor ya recibe los 3 valores garantizados.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { SmsMessage, SmsProvider } from './sms-provider.interface';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  /** Override para testing — point al mock server. Default = Twilio prod. */
  apiBaseUrl?: string;
}

@Injectable()
export class TwilioSmsProvider implements SmsProvider {
  private readonly logger = new Logger('TwilioSmsProvider');
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(private readonly config: TwilioConfig) {
    this.baseUrl =
      config.apiBaseUrl ??
      `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
    // HTTP Basic auth header. Base64(accountSid:authToken).
    const creds = Buffer.from(`${config.accountSid}:${config.authToken}`).toString(
      'base64',
    );
    this.authHeader = `Basic ${creds}`;
  }

  async send(msg: SmsMessage): Promise<void> {
    const body = new URLSearchParams({
      To: msg.to,
      From: this.config.fromNumber,
      Body: msg.body,
    });

    let res: Response;
    try {
      res = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });
    } catch (err) {
      // Network error / DNS / connection refused. Re-throw con contexto.
      throw new Error(`twilio_network_error: ${(err as Error).message}`);
    }

    if (!res.ok) {
      // Twilio devuelve JSON: { code: 21211, message: "...", more_info: "..." }
      let detail = '';
      try {
        const json = (await res.json()) as {
          code?: number;
          message?: string;
        };
        detail = `twilio_${json.code ?? res.status}: ${json.message ?? 'sin mensaje'}`;
      } catch {
        detail = `twilio_http_${res.status}`;
      }
      throw new Error(detail);
    }

    this.logger.debug(
      `SMS enviado via Twilio a ${msg.to} (tenant=${msg.tenantSlug ?? 'unknown'})`,
    );
  }
}
