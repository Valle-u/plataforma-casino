/**
 * Helpers para refresh tokens de sesión.
 *
 * Diseño:
 *   - Token = 32 bytes random codificados base64url (~43 chars). 256 bits de entropía.
 *   - Storage = SHA-256 hex (deterministic → permite lookup por hash en DB).
 *
 * Por qué SHA-256 y no Argon2:
 *   - El refresh token YA ES random fuerte (256 bits). No hace falta protección
 *     contra brute force a nivel de hash.
 *   - SHA-256 es determinístico → mismo token = mismo hash = lookup en DB.
 *   - Argon2 tiene salt random → mismo token = hashes distintos → no se puede lookup.
 *   - Argon2 es ~100ms/op, SHA-256 es ~0.001ms/op. Para algo que se hace en cada
 *     request, SHA-256 es la elección obvia.
 *
 * Uso típico:
 *   const refreshToken = generateRefreshToken();           // dárselo al cliente
 *   const hash = hashRefreshToken(refreshToken);           // guardar en DB
 *   // ...después...
 *   const incomingHash = hashRefreshToken(received);
 *   const session = await db.query.where(eq(tokenHash, incomingHash));
 */

import { createHash, randomBytes } from 'node:crypto';

/**
 * Genera un refresh token nuevo. Cliente lo guarda; nunca pasa por DB en plano.
 */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Hashea un refresh token con SHA-256 para storage / lookup.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
