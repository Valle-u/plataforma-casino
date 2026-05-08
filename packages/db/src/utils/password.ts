/**
 * Helpers de hash y verificación de passwords con Argon2id.
 *
 * Decidido en docs/02-arquitectura.md y docs/12-seguridad-compliance.md §2.2:
 * Argon2id es el algoritmo elegido (más resistente a GPU que bcrypt).
 *
 * Usamos `@node-rs/argon2` — implementación en Rust con prebuilds para
 * Windows/Mac/Linux, no requiere compilación.
 *
 * Estos helpers viven en `@casino/db/utils` porque son usados tanto por
 * apps/api (al loguear) como por seeds/scripts (al insertar usuarios).
 *
 * Parámetros: usamos los defaults seguros de la librería (Argon2id, m=19MB,
 * t=2 iteraciones, p=1 lane). Suficiente para producción según OWASP.
 */

import { hash, verify } from '@node-rs/argon2';

/**
 * Hashea una password en plano.
 * @param plain Password en texto plano (lo que el usuario tipeó).
 * @returns Hash listo para guardar en `users.password_hash`.
 */
export async function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

/**
 * Verifica si una password en plano corresponde a un hash guardado.
 * @param hashed Hash guardado en DB (lo que devolvió hashPassword en su momento).
 * @param plain Password en texto plano que el usuario tipeó al loguearse.
 * @returns `true` si coinciden, `false` si no.
 */
export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    // Si el hash es malformado (corrupto, formato distinto), tratamos como no-match
    // en vez de lanzar. Evita que un hash basura tire 500 al server.
    return false;
  }
}
