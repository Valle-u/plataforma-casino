/**
 * redact.ts — utilidad central para sanitizar PII / secretos antes de
 * loguear o persistir en `audit_log`.
 *
 * Sprint 51.10 — Polish MVP.
 *
 * Lista negra de keys (insensitive). Cualquier valor cuya KEY (no value)
 * matchee uno de estos patterns se reemplaza por `[REDACTED]`:
 *   - password, passwordHash, currentPassword, newPassword
 *   - token, refreshToken, accessToken, idempotencyKey
 *   - secret, twoFaSecret, totpSecret
 *   - otp, recoveryCode(s), backupCode(s)
 *   - apiKey, privateKey
 *   - cvv, cvc, cardNumber, pan
 *
 * No tocamos por defecto:
 *   - email, phone, cbu, alias — son audit-relevantes y el operador
 *     necesita verlos para conciliar. Si emerge necesidad de blindar
 *     estos en algún contexto, usar `redactSensitive(obj, { extra: [...] })`.
 *
 * **No mutamos el objeto original** — devolvemos una copia profunda
 * con los valores reemplazados. Si el input no es un object/array,
 * lo devolvemos tal cual (no rompe primitives).
 *
 * Ciclos: si hay referencia circular, devolvemos `[CIRCULAR]` para esa
 * key (no entramos en loop infinito).
 */

const DEFAULT_SENSITIVE_KEYS = new Set<string>([
  // passwords
  'password',
  'passwordhash',
  'password_hash',
  'currentpassword',
  'current_password',
  'newpassword',
  'new_password',
  'pwd',

  // tokens
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'idtoken',
  'id_token',
  'idempotencykey',
  'idempotency_key',

  // 2FA
  'secret',
  'twofasecret',
  'two_fa_secret',
  'totpsecret',
  'totp_secret',
  'otp',
  'recoverycode',
  'recovery_code',
  'recoverycodes',
  'recovery_codes',
  'backupcode',
  'backup_code',
  'backupcodes',
  'backup_codes',

  // API/private keys
  'apikey',
  'api_key',
  'privatekey',
  'private_key',
  'r2_access_key_id',
  'r2_secret_access_key',

  // tarjetas (no usamos hoy, defensivo para el futuro)
  'cvv',
  'cvc',
  'cardnumber',
  'card_number',
  'pan',

  // headers HTTP sensibles
  'authorization',
  'cookie',
  'set-cookie',
]);

const REDACTED = '[REDACTED]';
const CIRCULAR = '[CIRCULAR]';

export interface RedactOptions {
  /** Keys adicionales a redactar además del set por defecto. */
  extra?: string[];
  /** Si true, también redacta `email` y `phone`. Default false. */
  redactEmailPhone?: boolean;
  /** Profundidad máxima de recursión. Default 10. */
  maxDepth?: number;
}

export function redactSensitive<T>(input: T, options: RedactOptions = {}): T {
  const sensitive = new Set(DEFAULT_SENSITIVE_KEYS);
  for (const k of options.extra ?? []) sensitive.add(k.toLowerCase());
  if (options.redactEmailPhone) {
    sensitive.add('email');
    sensitive.add('phone');
    sensitive.add('phonenumber');
    sensitive.add('phone_number');
  }
  const maxDepth = options.maxDepth ?? 10;
  const seen = new WeakSet<object>();

  const walk = (value: unknown, depth: number): unknown => {
    if (depth > maxDepth) return REDACTED;
    if (value === null || value === undefined) return value;
    if (typeof value !== 'object') return value;
    if (seen.has(value)) return CIRCULAR;
    seen.add(value);

    if (Array.isArray(value)) {
      return value.map((v) => walk(v, depth + 1));
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (sensitive.has(k.toLowerCase())) {
        out[k] = REDACTED;
      } else {
        out[k] = walk(v, depth + 1);
      }
    }
    return out;
  };

  return walk(input, 0) as T;
}

/**
 * Hash corto y estable de un identificador para usar en LOGS — permite
 * correlar intentos sucesivos del mismo user sin leakear el valor
 * literal. NO usar para deduplicación o lookup en DB (las colisiones
 * existen — esperamos ~1 cada 4 mil millones con 8 chars hex).
 *
 *   hashForLog('cliente42@gmail.com') → 'usr_3f8a2b1c'
 *
 * Caso típico: `logger.warn(\`Login fallido user=${hashForLog(username)}\`)`.
 * Si querés un prefijo diferente, pasalo: `hashForLog(value, 'email')` →
 * `'email_3f8a2b1c'`.
 */
import { createHash } from 'crypto';

export function hashForLog(value: string, prefix = 'usr'): string {
  const h = createHash('sha256').update(value).digest('hex').slice(0, 8);
  return `${prefix}_${h}`;
}

/**
 * Helper específico para HTTP requests — sanitiza body + headers
 * comunes. Devuelve un objeto plano listo para meter en logs de error.
 */
export function redactHttpRequest(req: {
  body?: unknown;
  headers?: Record<string, unknown>;
  query?: unknown;
  params?: unknown;
}): {
  body: unknown;
  headers: unknown;
  query: unknown;
  params: unknown;
} {
  return {
    body: redactSensitive(req.body ?? null),
    headers: redactSensitive(req.headers ?? null),
    query: redactSensitive(req.query ?? null),
    params: redactSensitive(req.params ?? null),
  };
}
