/**
 * La firma con la que Meta prueba que un webhook es suyo (**3.2**).
 *
 * ```
 * X-Hub-Signature-256: sha256=<HMAC-SHA256(bytes crudos del body, APP SECRET)>
 * ```
 *
 * ## ⚠️ Sobre los BYTES CRUDOS, nunca sobre el JSON re-serializado
 *
 * Es la trampa que arruina esta clase de integración. `JSON.stringify` de lo que
 * parseó Nest **no devuelve los mismos bytes** que mandó Meta: cambia el escapado
 * de unicode, la notación de los números, los espacios. Cualquiera de esas
 * diferencias cambia el HMAC y la firma no valida — y falla de la peor forma
 * posible, **de a ratos**, según qué caracteres traiga el mensaje. Un acento en
 * el nombre de alguien alcanza.
 *
 * Nest ya arranca con `rawBody: true` (`apps/api/src/main.ts`), así que se
 * verifica contra `req.rawBody`. Es el mismo camino que ya usa el callback de
 * Gregmorn, por la misma razón.
 *
 * ## En qué se diferencia de Telegram, y por qué eso mejora el orden
 *
 * En Telegram el secreto es **por canal** (`crm_channels.webhook_secret`), así
 * que hay que resolver el tenant y el canal **antes** de poder verificar nada:
 * un request falso ya costó dos consultas.
 *
 * Acá el App Secret es **uno solo y nuestro** (**D23**), así que se verifica
 * **antes de tocar la base**. Lo que no está firmado no llega a consultar nada.
 *
 * Y por eso mismo **D20 no le aplica**: D20 cifra los secretos de canal porque
 * *son de los socios* y salen del VPS en el backup todas las mañanas. El App
 * Secret es nuestro y vive en el entorno, que no viaja en el dump. Lo que sí
 * queda bajo D20 es el token de acceso de cada WABA, que es del socio.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Header donde Meta manda la firma. */
export const HEADER_FIRMA = 'x-hub-signature-256';

/** Prefijo con el que Meta etiqueta el algoritmo. */
const PREFIJO = 'sha256=';

/**
 * ¿Este cuerpo viene firmado con nuestro App Secret?
 *
 * `crudo` son los bytes exactos que llegaron. `appSecret` sale del entorno.
 *
 * Devuelve `false` —y no tira— para todo lo que no valide: falta el header, no
 * hay secreto configurado, la firma no coincide. El que llama decide qué hacer,
 * y en un webhook eso **siempre es responder 200 sin procesar**, porque un error
 * le dice a Meta que reintente.
 */
export function firmaDeMetaValida(params: {
  crudo: Buffer | string | undefined;
  firmaRecibida: string | undefined;
  appSecret: string | undefined;
}): boolean {
  const { crudo, firmaRecibida, appSecret } = params;

  // Sin secreto configurado no se puede verificar nada, y **no verificar no es
  // lo mismo que aceptar**: sin esto, un entorno al que le falta la variable
  // aceptaría cualquier cosa que le peguen al webhook. Es el mismo criterio que
  // D20 con `cifrar()`: antes que un fallback silencioso, que no funcione.
  if (!appSecret) return false;
  if (!firmaRecibida) return false;
  if (crudo === undefined) return false;

  const recibida = firmaRecibida.trim().toLowerCase();
  if (!recibida.startsWith(PREFIJO)) return false;

  const esperada = firmarComoMeta(crudo, appSecret);
  return igualEnTiempoConstante(recibida, esperada);
}

/**
 * La firma tal como la manda Meta, con su prefijo.
 *
 * Exportada porque **es lo que hace que esto se pueda probar sin Meta**: los
 * tests fabrican firmas con esta misma función y el webhook las valida. Sin eso,
 * el 3.2 no se podría verificar hasta que la cuenta de Meta salga del trámite.
 */
export function firmarComoMeta(
  crudo: Buffer | string,
  appSecret: string,
): string {
  const hmac = createHmac('sha256', appSecret);
  // El Buffer se hashea tal cual; un string se toma como utf-8, que es lo que
  // devuelve `rawBody.toString('utf8')`.
  hmac.update(typeof crudo === 'string' ? Buffer.from(crudo, 'utf8') : crudo);
  return `${PREFIJO}${hmac.digest('hex')}`;
}

/**
 * Compara dos firmas en tiempo constante.
 *
 * Un `===` sobre el hex corta apenas encuentra el primer byte distinto, y ese
 * tiempo se puede medir: con suficientes intentos se reconstruye una firma
 * válida byte a byte. El largo se compara antes porque `timingSafeEqual` exige
 * buffers iguales, y no filtra nada — el largo de un HMAC-SHA256 es siempre el
 * mismo y es público.
 */
function igualEnTiempoConstante(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
