/**
 * GregmornSigner — firma HMAC-SHA256 de requests + verificación de callbacks.
 *
 * Un solo esquema para las dos direcciones (ver docs/gregmorn/02-signing.md):
 *
 *   X-Signature = HMAC-SHA256(bytes crudos del body, secret_api_key) en HEX
 *
 * Bastante más simple que el Ed25519 de Forever: no hay canonical string, ni
 * nonce, ni timestamp, ni par de claves por sentido. Una sola clave simétrica
 * (`secret_api_key`), por tenant, distinta entre Stage y Prod.
 *
 * ⚠️ **La firma se calcula sobre los BYTES EXACTOS del body, no sobre el JSON
 * re-serializado.** Si se parsea y se vuelve a serializar, cualquier diferencia
 * (orden de claves, espacios, escapado unicode, notación de números) cambia los
 * bytes y la firma no valida. Al VERIFICAR hay que usar `req.rawBody` — Nest ya
 * arranca con `rawBody: true` en `apps/api/src/main.ts`. Al FIRMAR hay que
 * serializar una sola vez y mandar ese mismo string como body.
 *
 * No hay ventana anti-replay: su esquema no incluye timestamp. La defensa en
 * profundidad es la allowlist de IP (`3.78.156.229`) a nivel Cloudflare — que
 * NO reemplaza a la firma.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Header donde viaja la firma, en las dos direcciones. */
export const GREGMORN_SIG_HEADER = 'X-Signature';

export interface GregmornVerifyResult {
  verified: boolean;
  error: string;
}

/**
 * HMAC-SHA256 hex del body crudo con la `secret_api_key`.
 *
 * `body` es el string exacto que viaja (o que se recibió) como cuerpo. Se
 * hashean sus bytes utf-8.
 */
export function signGregmornBody(body: string, secretApiKey: string): string {
  return createHmac('sha256', secretApiKey)
    .update(body ?? '', 'utf8')
    .digest('hex');
}

/**
 * Headers listos para adjuntar a un request saliente firmado (`openGame`).
 *
 * El `body` que se pasa acá tiene que ser EL MISMO string que se manda como
 * cuerpo del request.
 */
export function signGregmornRequest(params: {
  body: string;
  secretApiKey: string;
}): { signature: string; headers: Record<string, string> } {
  const signature = signGregmornBody(params.body, params.secretApiKey);
  return {
    signature,
    headers: { [GREGMORN_SIG_HEADER]: signature },
  };
}

/**
 * Verifica la firma de un callback ENTRANTE.
 *
 * `body` es el body CRUDO recibido (`req.rawBody.toString('utf8')`), nunca el
 * parseado y re-serializado. `headers` con las claves como las entrega NestJS
 * (lowercase); igual se leen case-insensitive.
 *
 * La comparación es en **tiempo constante** (`timingSafeEqual`): un `===` sobre
 * el hex filtra información por el tiempo que tarda en cortar, y con eso se
 * puede llegar a construir una firma válida byte a byte.
 */
export function verifyGregmornCallback(params: {
  body: string;
  secretApiKey: string;
  headers: Record<string, string | string[] | undefined>;
}): GregmornVerifyResult {
  const received = readHeader(params.headers, GREGMORN_SIG_HEADER);
  if (!received) return { verified: false, error: 'No signature header' };

  if (!params.secretApiKey) {
    return { verified: false, error: 'Missing secret_api_key' };
  }

  const expected = signGregmornBody(params.body, params.secretApiKey);
  return signaturesMatch(received, expected)
    ? { verified: true, error: '' }
    : { verified: false, error: 'Invalid signature' };
}

/**
 * Compara dos firmas hex en tiempo constante.
 *
 * `timingSafeEqual` exige buffers del mismo largo, así que un largo distinto se
 * corta antes. No filtra nada útil: el largo de un HMAC-SHA256 hex es siempre 64
 * y es público.
 */
function signaturesMatch(received: string, expected: string): boolean {
  const a = Buffer.from(received.trim().toLowerCase(), 'utf8');
  const b = Buffer.from(expected.toLowerCase(), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Lee un header case-insensitive, quedándose con el primer valor si es array. */
function readHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== target) continue;
    const raw = Array.isArray(value) ? value[0] : value;
    return raw?.trim() ? raw : undefined;
  }
  return undefined;
}
