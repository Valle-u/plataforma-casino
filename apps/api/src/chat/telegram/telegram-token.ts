/**
 * El token de un bot de Telegram: validarlo, taparlo y armar su URL.
 *
 * Sin red y sin base: es lo que se puede verificar antes de hablar con nadie.
 * (`descifrar` es cripto pura, no habla con nadie tampoco.)
 *
 * ## Por qué validar la forma antes de llamar a Telegram
 *
 * Porque el error de Telegram para un token mal pegado es `401 Unauthorized`, y
 * eso se lee como *"el token es de otro"* o *"lo revocaron"*. Un operador que
 * pegó de más —o que pegó el nombre del bot en vez del token— se queda mirando
 * un 401 sin entender. Acá el mensaje puede decir qué está mal.
 */

/**
 * Un token de bot tiene la forma `<id del bot>:<secreto>`.
 *
 * El id son dígitos (el user id del bot en Telegram) y el secreto son al menos
 * 35 caracteres de un alfabeto seguro para URLs. No está documentado como
 * contrato, así que **se valida con holgura**: lo justo para atajar un
 * copiar-pegar roto, sin rechazar un token válido si Telegram cambia el largo.
 */
import { descifrar } from '../../common/secreto-cifrado';

const FORMA = /^(\d{6,20}):([A-Za-z0-9_-]{30,})$/;

export class TokenDeBotInvalidoError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'TokenDeBotInvalidoError';
  }
}

/** El id del bot que va adentro del token. Tira si la forma no cierra. */
export function idDelBot(token: string): string {
  const m = FORMA.exec(token.trim());
  if (!m) {
    throw new TokenDeBotInvalidoError(
      'El token no tiene la forma que da BotFather (algo como ' +
        '`7891234567:AAF-xYz...`). Fijate de haberlo copiado entero.',
    );
  }
  return m[1]!;
}

/** ¿La forma cierra? Para preguntar sin tirar. */
export function pareceTokenDeBot(token: string): boolean {
  return FORMA.test(token.trim());
}

/**
 * El token tapado, para logs y mensajes de error.
 *
 * Deja el id del bot —que es público: cualquiera que hable con el bot lo ve— y
 * tapa el secreto. Sin esto, un token entero termina en Axiom el día que
 * alguien agregue un `logger.debug` "para ver qué llega".
 *
 * ⚠️ **Nunca loguear el token sin pasar por acá.**
 */
export function taparToken(token: string): string {
  const limpio = token.trim();
  const m = FORMA.exec(limpio);
  if (!m) return '***';
  return `${m[1]}:${'*'.repeat(6)}`;
}

/**
 * La URL a la que Telegram nos va a mandar los updates.
 *
 * ```
 * https://api.miamihub.vip/api/v1/crm/telegram/webhook/<slug>/<canal>
 * ```
 *
 * **Los dos segmentos hacen falta y ninguno autentica.** El slug resuelve de
 * qué casino es —Telegram no manda `Host`, igual que los proveedores de juego—
 * y el id del canal, de quién es la bandeja (**D1**, **D2**).
 *
 * Lo que autentica es el header `X-Telegram-Bot-Api-Secret-Token`, que Telegram
 * devuelve en cada update si se lo registramos en `setWebhook`.
 */
export function urlDelWebhook(
  baseApiPublica: string,
  tenantSlug: string,
  channelId: string,
): string {
  const base = baseApiPublica.replace(/\/+$/, '');
  return `${base}/api/v1/crm/telegram/webhook/${encodeURIComponent(tenantSlug)}/${channelId}`;
}

/**
 * El link que el operador le pasa a sus jugadores.
 *
 * ⚠️ Existe por una restricción de Telegram que no se puede saltear: **un bot
 * sólo puede hablarle a quien le escribió primero.** No hay forma de que el bot
 * inicie la conversación. Así que sin este link el canal no arranca nunca, y la
 * pantalla tiene que mostrarlo — no es un adorno.
 */
export function linkDelBot(username: string): string {
  return `https://t.me/${username.replace(/^@/, '')}`;
}

/**
 * El token del bot de un canal, descifrado. `null` si no se puede.
 *
 * Vive acá y no en cada servicio porque **lo necesitan los dos lados**: el que
 * recibe (para bajar los adjuntos antes de que venza la ruta) y el que
 * responde. Con una copia en cada uno, un cambio en cómo se guarda el token
 * —el formato de `cifrar()`, la clave, el nombre del campo— se arregla en un
 * lado y en el otro no, y el que quede viejo falla devolviendo `null`, o sea
 * **en silencio**.
 *
 * Devuelve `null` en vez de tirar a propósito: sin clave en el entorno, o con
 * un token cifrado con una clave que ya no está, no hay nada que el operador
 * pueda hacer en ese instante. Quien llama decide qué contarle.
 */
export function tokenDelCanal(canal: { config: unknown }): string | null {
  const cifrado = (canal.config as { token?: string } | null)?.token;
  if (!cifrado) return null;
  try {
    return descifrar(cifrado);
  } catch {
    return null;
  }
}
