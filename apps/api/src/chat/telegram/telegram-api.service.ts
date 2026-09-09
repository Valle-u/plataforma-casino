/**
 * Cliente de la API de Telegram. Sólo lo que hace falta para vincular un bot.
 *
 * ## Lo que este archivo cuida
 *
 * **El token nunca sale en un error.** Va en la URL —así lo pide Telegram— así
 * que cualquier mensaje que incluya la URL incluye la credencial. Todo lo que
 * se tira o se loguea pasa por `taparToken`.
 *
 * **Un fallo de Telegram no es un 500 nuestro.** Si el token es de otro, o si
 * la URL del webhook no le gusta, eso es un error del operador o de la
 * configuración: tiene que llegar como un mensaje que se entienda, no como
 * "Internal Server Error".
 *
 * **Timeout corto.** Esto corre adentro de un request del panel: si Telegram no
 * contesta, el operador tiene que ver un error, no una pantalla colgada.
 */

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { taparToken } from './telegram-token';

const BASE = 'https://api.telegram.org';

/** Telegram suele responder en menos de un segundo. */
const TIMEOUT_MS = 10_000;

/** Lo que devuelve `getMe`, recortado a lo que usamos. */
export interface BotDeTelegram {
  id: number;
  username: string;
  firstName: string;
}

/** La forma de toda respuesta de la API de Telegram. */
interface RespuestaTelegram<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

@Injectable()
export class TelegramApiService {
  private readonly logger = new Logger(TelegramApiService.name);

  /**
   * ¿El token es válido, y de qué bot?
   *
   * Es la primera llamada al vincular: sin esto se guardaría un token que no
   * sirve y el operador se enteraría cuando nadie le escriba.
   */
  async getMe(token: string): Promise<BotDeTelegram> {
    const r = await this.llamar<{
      id: number;
      username?: string;
      first_name?: string;
    }>(token, 'getMe');

    if (!r.username) {
      // Un bot siempre tiene username. Si no vino, el token es de una cuenta
      // que no es un bot — o Telegram cambió algo que hay que mirar.
      throw new BadRequestException({
        message: 'Ese token no parece ser de un bot.',
        error: 'TELEGRAM_NOT_A_BOT',
      });
    }

    return {
      id: r.id,
      username: r.username,
      firstName: r.first_name ?? r.username,
    };
  }

  /**
   * Le dice a Telegram a dónde mandar los updates.
   *
   * `secretToken` es lo que después nos devuelve en cada update, en el header
   * `X-Telegram-Bot-Api-Secret-Token`: **es lo único que autentica** los
   * mensajes entrantes. Sin él, cualquiera que sepa la URL nos inyecta
   * conversaciones.
   *
   * `allowed_updates` acota a lo que sabemos procesar. Sin eso Telegram manda
   * de todo —encuestas, reacciones, miembros que entran a un grupo— y cada uno
   * cuesta un request y una fila de crudo para terminar descartado.
   */
  async setWebhook(
    token: string,
    url: string,
    secretToken: string,
  ): Promise<void> {
    await this.llamar(token, 'setWebhook', {
      url,
      secret_token: secretToken,
      allowed_updates: ['message', 'edited_message'],
      // Si el bot venía de otro lado con updates encolados, no los queremos:
      // serían mensajes viejos entrando de golpe como si fueran nuevos.
      drop_pending_updates: true,
    });
  }

  /** Corta el webhook. Se usa al desvincular. */
  async deleteWebhook(token: string): Promise<void> {
    await this.llamar(token, 'deleteWebhook', { drop_pending_updates: true });
  }

  /**
   * Una llamada a la API, con el token tapado en todo lo que salga de acá.
   *
   * ⚠️ El token va **en la URL** porque así lo pide Telegram. Por eso ningún
   * error puede incluir la URL cruda: sería filtrar la credencial en un log.
   */
  private async llamar<T>(
    token: string,
    metodo: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${BASE}/bot${token}/${metodo}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      // Red caída, DNS, timeout. No es culpa del operador y no dice nada de su
      // token, así que se distingue del caso de abajo.
      this.logger.warn(
        `Telegram ${metodo} no respondió (${taparToken(token)}): ${(err as Error).message}`,
      );
      throw new BadRequestException({
        message: 'No se pudo hablar con Telegram. Probá de nuevo en un minuto.',
        error: 'TELEGRAM_UNREACHABLE',
      });
    }

    const json = (await res.json().catch(() => null)) as RespuestaTelegram<T> | null;

    if (!json?.ok) {
      const detalle = json?.description ?? `HTTP ${res.status}`;
      this.logger.warn(
        `Telegram ${metodo} rechazó (${taparToken(token)}): ${detalle}`,
      );
      throw new BadRequestException({
        // La descripción de Telegram es útil y no trae el token: dice cosas
        // como "Unauthorized" o "Bad Request: bad webhook: HTTPS url must be
        // provided". Se pasa tal cual para que el operador sepa qué pasó.
        message: `Telegram rechazó la operación: ${detalle}`,
        error: 'TELEGRAM_REJECTED',
      });
    }

    return json.result as T;
  }
}
