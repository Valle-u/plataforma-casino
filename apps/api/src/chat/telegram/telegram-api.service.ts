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

/** Subir un archivo tarda más. Tope del adjunto: 5 MB. */
const TIMEOUT_ARCHIVO_MS = 45_000;

/** Lo que devuelve `getMe`, recortado a lo que usamos. */
export interface BotDeTelegram {
  id: number;
  username: string;
  firstName: string;
}

/**
 * Lo que Telegram dice sobre el webhook de un bot, recortado a lo accionable.
 *
 * No trae el token ni el `secret_token`: la URL lleva el slug del tenant y el
 * id del canal, que ya se ven en la pantalla.
 */
export interface InfoDelWebhook {
  /** La URL registrada, o `null` si no hay webhook. */
  url: string | null;
  /** Updates que Telegram tiene encolados sin poder entregar. */
  pendientes: number;
  /** A qué IP resolvió. Sirve para saber si pegó al servidor correcto. */
  ip: string | null;
  ultimoErrorEn: Date | null;
  /** Lo que dijo Telegram al fallar la entrega. Es lo accionable. */
  ultimoError: string | null;
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

  /**
   * La ruta temporal para descargar un archivo. `null` si no vino.
   *
   * ⚠️ **Esta ruta vence** —alrededor de una hora— y ahí el archivo es
   * irrecuperable: el `file_id` sigue existiendo pero ya no resuelve a nada
   * descargable. Es la razón por la que los adjuntos se bajan en el mismo
   * camino del webhook y no en una cola para después.
   */
  async getFilePath(token: string, fileId: string): Promise<string | null> {
    const r = await this.llamar<{ file_path?: string }>(token, 'getFile', {
      file_id: fileId,
    });
    return r.file_path ?? null;
  }

  /**
   * Manda un mensaje de texto al chat. Devuelve el `message_id` que le asignó
   * Telegram (**2.7**).
   *
   * ## Lo que hay que saber de este método
   *
   * **Un bot no puede iniciar una conversación.** Sólo le puede escribir a
   * quien le escribió primero. Acá siempre es una respuesta a alguien que ya
   * escribió, así que no es un problema — pero es la razón por la que no existe
   * ni puede existir un "mandarle un mensaje a este teléfono".
   *
   * **No hay ventana de 24 horas.** Eso es de WhatsApp (**D13**, etapa 3). En
   * Telegram, si la persona escribió alguna vez, el bot le puede contestar
   * cuando quiera.
   *
   * **`parse_mode` va sin setear, a propósito.** Con `Markdown` o `HTML`,
   * cualquier `_`, `*` o `<` que el operador escriba de forma natural hace que
   * Telegram rechace el mensaje entero por sintaxis inválida — o peor, se lo
   * coma y mande el texto mutilado. Sin `parse_mode` el texto sale literal, que
   * es lo que el operador escribió.
   */
  async sendMessage(
    token: string,
    chatId: string,
    texto: string,
  ): Promise<string> {
    const r = await this.llamar<{ message_id?: number }>(
      token,
      'sendMessage',
      { chat_id: chatId, text: texto },
    );
    return String(r.message_id ?? '');
  }

  /**
   * Manda un archivo al chat, subiendo los bytes (**2.8**).
   *
   * ## Siempre `sendDocument`, nunca `sendPhoto`
   *
   * `sendPhoto` **recomprime la imagen del lado de Telegram**. Para una foto de
   * vacaciones da igual; para un **comprobante** no: un CBU, un CUIT o un monto
   * chico pueden quedar ilegibles, y esos archivos son documentos financieros.
   *
   * `sendDocument` entrega el archivo **exacto**. El jugador lo ve como adjunto
   * con miniatura en vez de foto inline — se pierde un poco de estética y se
   * gana que el número se lea.
   *
   * Es el mismo criterio que ya se aplicó del lado que recibe, donde se elige
   * la foto **más grande que entre** justamente para que se pueda leer.
   *
   * ## Por qué se suben los bytes y no se pasa una URL
   *
   * Telegram acepta una URL y la baja él. Sería menos código, pero: los
   * adjuntos son privados y firmados (**D12**), o sea que la URL vence; si
   * Telegram la baja tarde o reintenta, ya no resuelve. Y cuando falla, lo que
   * contesta es *"wrong file identifier/HTTP URL specified"*, que no le dice
   * nada a nadie. Subiendo los bytes, el error que se ve es el real.
   */
  async sendDocument(
    token: string,
    chatId: string,
    archivo: { bytes: Buffer; nombre: string; mime: string },
  ): Promise<string> {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append(
      'document',
      new Blob([new Uint8Array(archivo.bytes)], { type: archivo.mime }),
      archivo.nombre,
    );
    const r = await this.llamarMultipart<{ message_id?: number }>(
      token,
      'sendDocument',
      form,
    );
    return String(r.message_id ?? '');
  }

  /** Corta el webhook. Se usa al desvincular. */
  async deleteWebhook(token: string): Promise<void> {
    await this.llamar(token, 'deleteWebhook', { drop_pending_updates: true });
  }

  /**
   * Qué webhook tiene Telegram registrado para este bot, **según Telegram**.
   *
   * ## Por qué esto existe
   *
   * `setWebhook` devuelve OK con cualquier URL HTTPS bien formada: **Telegram no
   * la prueba al registrarla**. O sea que vincular un bot puede "salir bien" y
   * dejar los updates yendo a una URL que contesta 404, sin que nada del lado
   * nuestro se entere. El síntoma es una bandeja vacía, que es idéntica a "nadie
   * escribió todavía".
   *
   * Y hay un motivo concreto para dudar de la URL registrada: la arma
   * `baseApiPublica()` a partir de `x-forwarded-host`, y **Next pisa ese header
   * en el rewrite** con el host del cliente (es el bug del commit `9d87c69`, ver
   * el comentario en `apps/web/lib/api-client.ts`). Si el proxy de adelante no
   * lo vuelve a escribir, la URL queda apuntando al host de la web — donde
   * `/api/v1/*` no está ruteado.
   *
   * `last_error_message` es lo que cierra el caso: ahí Telegram dice literalmente
   * con qué se encontró al intentar entregar (*"Wrong response from the webhook:
   * 404 Not Found"*), y eso no se puede deducir de ningún lado nuestro.
   *
   * ⚠️ **Es de sólo lectura y no toca nada.** Preguntar no reconfigura el
   * webhook ni descarta updates encolados.
   */
  async getWebhookInfo(token: string): Promise<InfoDelWebhook> {
    const r = await this.llamar<{
      url?: string;
      pending_update_count?: number;
      ip_address?: string;
      last_error_date?: number;
      last_error_message?: string;
    }>(token, 'getWebhookInfo');

    return {
      // Telegram devuelve `""` —no `null`— cuando no hay webhook registrado.
      // Se normaliza acá para que la pantalla no tenga que distinguir dos
      // formas de "no hay".
      url: r.url?.trim() ? r.url : null,
      pendientes: r.pending_update_count ?? 0,
      ip: r.ip_address ?? null,
      // Viene en segundos desde epoch, como todo en Telegram.
      ultimoErrorEn: r.last_error_date ? new Date(r.last_error_date * 1000) : null,
      ultimoError: r.last_error_message ?? null,
    };
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
    return this.enviarPeticion<T>(token, metodo, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      timeoutMs: TIMEOUT_MS,
    });
  }

  /**
   * Igual que `llamar`, pero subiendo un archivo.
   *
   * Sin `Content-Type` propio: lo arma `FormData` con su boundary. Y con
   * **timeout más largo** — acá se están subiendo hasta 5 MB, no mandando una
   * línea de JSON.
   */
  private async llamarMultipart<T>(
    token: string,
    metodo: string,
    form: FormData,
  ): Promise<T> {
    return this.enviarPeticion<T>(token, metodo, {
      body: form,
      timeoutMs: TIMEOUT_ARCHIVO_MS,
    });
  }

  /**
   * El POST a Telegram, con el token tapado en todo lo que salga de acá.
   *
   * Las dos formas —JSON y multipart— pasan por acá **a propósito**: es el
   * único lugar donde se construye la URL con el token, y el único que traduce
   * un fallo de Telegram a un error que se entienda. Con dos copias, la
   * segunda se olvida de `taparToken` y la credencial termina en un log.
   */
  private async enviarPeticion<T>(
    token: string,
    metodo: string,
    opts: {
      headers?: Record<string, string>;
      /** JSON serializado, o el `FormData` de una subida. */
      body: string | FormData;
      timeoutMs: number;
    },
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${BASE}/bot${token}/${metodo}`, {
        method: 'POST',
        ...(opts.headers ? { headers: opts.headers } : {}),
        body: opts.body,
        signal: AbortSignal.timeout(opts.timeoutMs),
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
