/**
 * ForeverSigner — firma Ed25519 de requests + verificación de callbacks.
 *
 * Replica EXACTAMENTE el SDK oficial de Forever (`forever-packet-signer.js`,
 * ver docs/forever/02-signing.md) pero con `node:crypto` nativo (Node 18+
 * soporta Ed25519) en vez de `@noble/ed25519`, para no sumar dependencia.
 *
 * Canonical string (lo que se firma):
 *   v1\n<agentCode>\n<timestampMs>\n<nonce>\n<sha256HexDelBody>
 *
 * Headers de firma:
 *   X-Forever-Sig-Alg       = Ed25519
 *   X-Forever-Sig-Agent     = agentCode
 *   X-Forever-Sig-Timestamp = epoch ms
 *   X-Forever-Sig-Nonce     = 16 bytes hex
 *   X-Forever-Sig-BodyHash  = sha256 hex del body crudo (utf-8)
 *   X-Forever-Sig-Value     = firma Ed25519 del canonical, base64url sin padding
 *
 * Las claves llegan en base64 (32 bytes c/u): la privada es el SEED Ed25519, la
 * pública el punto. `node:crypto` necesita KeyObjects, así que envolvemos los
 * 32 bytes crudos en el DER fijo de PKCS8 (privada) / SPKI (pública).
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from 'node:crypto';

/**
 * Nombres de header en el casing canónico del SDK (para MANDAR). HTTP los trata
 * case-insensitive, pero se envían así para máxima compatibilidad con Forever.
 * Al VERIFICAR callbacks entrantes se leen case-insensitive (NestJS los baja a
 * lowercase) — ver `headerLookup` en verifyForeverCallback.
 */
export const FOREVER_SIG_HEADERS = {
  ALG: 'X-Forever-Sig-Alg',
  AGENT: 'X-Forever-Sig-Agent',
  TIMESTAMP: 'X-Forever-Sig-Timestamp',
  NONCE: 'X-Forever-Sig-Nonce',
  BODY_HASH: 'X-Forever-Sig-BodyHash',
  VALUE: 'X-Forever-Sig-Value',
} as const;

export const FOREVER_SIG_ALG = 'Ed25519';
const CANONICAL_VERSION = 'v1';

/** Ventana anti-replay para verificar callbacks entrantes (SDK: 5 min). */
export const FOREVER_SIG_MAX_SKEW_MS = 5 * 60 * 1000;

/** DER prefijos fijos para envolver claves Ed25519 crudas (RFC 8410). */
const PKCS8_ED25519_PREFIX = Buffer.from(
  '302e020100300506032b657004220420',
  'hex',
);
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export interface ForeverSignResult {
  bodyHash: string;
  canonical: string;
  timestampMs: number;
  nonce: string;
  /** Firma base64url (sin padding). */
  signature: string;
  /** Headers listos para adjuntar al request HTTP (claves lowercase). */
  headers: Record<string, string>;
}

export interface ForeverVerifyResult {
  verified: boolean;
  error: string;
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text ?? '', 'utf8').digest('hex');
}

function buildCanonical(
  agentCode: string,
  timestampMs: number,
  nonce: string,
  bodySha256Hex: string,
): string {
  return [
    CANONICAL_VERSION,
    agentCode ?? '',
    String(timestampMs),
    nonce ?? '',
    bodySha256Hex ?? '',
  ].join('\n');
}

function base64UrlEncode(bytes: Buffer): string {
  return bytes
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Envuelve el seed privado crudo (32 bytes base64) en un KeyObject PKCS8. */
function privateKeyFromRaw(privateKeyBase64: string): KeyObject {
  const raw = Buffer.from(privateKeyBase64, 'base64');
  if (raw.length !== 32) {
    throw new Error(
      `Clave privada Ed25519 inválida: se esperaban 32 bytes, hay ${raw.length}.`,
    );
  }
  return createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, raw]),
    format: 'der',
    type: 'pkcs8',
  });
}

/** Envuelve la clave pública cruda (32 bytes base64) en un KeyObject SPKI. */
function publicKeyFromRaw(publicKeyBase64: string): KeyObject {
  const raw = Buffer.from(publicKeyBase64, 'base64');
  if (raw.length !== 32) {
    throw new Error(
      `Clave pública Ed25519 inválida: se esperaban 32 bytes, hay ${raw.length}.`,
    );
  }
  return createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, raw]),
    format: 'der',
    type: 'spki',
  });
}

function randomNonce(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Firma un request para la Main API de Forever. Devuelve los headers
 * `X-Forever-Sig-*` a adjuntar + material de debug (canonical, bodyHash).
 *
 * `body` es el JSON crudo (string) que se manda como cuerpo — el mismo string
 * debe viajar en el request (el hash se calcula sobre esos bytes exactos).
 */
export function signForeverRequest(params: {
  agentCode: string;
  privateKeyBase64: string;
  body: string;
  /** Default Date.now(). Inyectable para tests. */
  timestampMs?: number;
  /** Default aleatorio. Inyectable para tests. */
  nonce?: string;
}): ForeverSignResult {
  const bodyHash = sha256Hex(params.body);
  const ts = params.timestampMs ?? Date.now();
  const nonce = params.nonce?.trim() ? params.nonce : randomNonce();
  const canonical = buildCanonical(params.agentCode, ts, nonce, bodyHash);

  const signature = edSign(
    null,
    Buffer.from(canonical, 'utf8'),
    privateKeyFromRaw(params.privateKeyBase64),
  );
  const sigValue = base64UrlEncode(signature);

  return {
    bodyHash,
    canonical,
    timestampMs: ts,
    nonce,
    signature: sigValue,
    headers: {
      [FOREVER_SIG_HEADERS.ALG]: FOREVER_SIG_ALG,
      [FOREVER_SIG_HEADERS.AGENT]: params.agentCode,
      [FOREVER_SIG_HEADERS.TIMESTAMP]: String(ts),
      [FOREVER_SIG_HEADERS.NONCE]: nonce,
      [FOREVER_SIG_HEADERS.BODY_HASH]: bodyHash,
      [FOREVER_SIG_HEADERS.VALUE]: sigValue,
    },
  };
}

/**
 * Verifica la firma de un callback ENTRANTE de Forever. `headers` con claves
 * lowercase (como los entrega NestJS). `body` es el body crudo recibido.
 *
 * Chequea, en orden: presencia de firma, match del bodyHash, ventana anti-replay
 * (±5 min), alg == Ed25519, agent == esperado, y por último la firma Ed25519.
 */
export function verifyForeverCallback(params: {
  publicKeyBase64: string;
  agentCode: string;
  body: string;
  headers: Record<string, string | undefined>;
  /** Default Date.now(). Inyectable para tests. */
  nowMs?: number;
}): ForeverVerifyResult {
  // Lectura case-insensitive: NestJS entrega los headers en lowercase.
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(params.headers)) {
    if (v !== undefined) lower[k.toLowerCase()] = v;
  }
  const get = (name: string): string | undefined => lower[name.toLowerCase()];

  const sigValue = get(FOREVER_SIG_HEADERS.VALUE);
  if (!sigValue) return { verified: false, error: 'No signature headers' };

  const bodyHash = sha256Hex(params.body);
  if (
    bodyHash.toLowerCase() !==
    String(get(FOREVER_SIG_HEADERS.BODY_HASH) ?? '').toLowerCase()
  ) {
    return { verified: false, error: 'Body hash mismatch' };
  }

  const ts = Number(get(FOREVER_SIG_HEADERS.TIMESTAMP));
  const now = params.nowMs ?? Date.now();
  if (!Number.isFinite(ts) || Math.abs(now - ts) > FOREVER_SIG_MAX_SKEW_MS) {
    return { verified: false, error: 'Signature expired' };
  }

  if (get(FOREVER_SIG_HEADERS.ALG) !== FOREVER_SIG_ALG) {
    return { verified: false, error: 'Invalid signature algorithm' };
  }
  if (get(FOREVER_SIG_HEADERS.AGENT) !== params.agentCode) {
    return { verified: false, error: 'Signature agent mismatch' };
  }

  const canonical = buildCanonical(
    params.agentCode,
    ts,
    get(FOREVER_SIG_HEADERS.NONCE) ?? '',
    get(FOREVER_SIG_HEADERS.BODY_HASH) ?? '',
  );

  let verified = false;
  try {
    verified = edVerify(
      null,
      Buffer.from(canonical, 'utf8'),
      publicKeyFromRaw(params.publicKeyBase64),
      base64UrlDecode(sigValue),
    );
  } catch (err) {
    return { verified: false, error: (err as Error).message };
  }

  return { verified, error: verified ? '' : 'Invalid signature' };
}
