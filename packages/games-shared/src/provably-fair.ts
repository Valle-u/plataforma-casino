/**
 * Provably Fair — primitives compartidos entre juegos propios.
 *
 * Implementa el patrón commit-reveal con hash chain documentado en
 * `docs/own-games/00-overview.md §5`. Usado por todos los juegos
 * propios (jokers-jewels, crash, mines, etc.) para garantizar que
 * los rounds NO se manipulan después del hecho.
 *
 * Flow:
 *
 *   1. Server arranca con un `serverSeed` random (32 bytes).
 *   2. Server publica `commitHash = SHA256(serverSeed)` al cliente
 *      ANTES de cualquier spin.
 *   3. Cliente provee su propia `clientSeed` (custom o auto-generada).
 *   4. Por cada round con `nonce` incremental:
 *        roundSeed = SHA256(serverSeed + clientSeed + nonce)
 *   5. `roundSeed` alimenta el RNG determinístico del juego.
 *   6. Después de cada round, server REVELA el `serverSeed` (en
 *      rotación periódica, no después de cada round individual).
 *   7. Cliente verifica:
 *      a. SHA256(serverSeed) === commitHash (servidor no hizo trampa).
 *      b. roundSeed_calculada === roundSeed_observada (math correcto).
 *
 * Por qué este patrón:
 *   - Si el server cambia el serverSeed después de un round, el
 *     commitHash deja de cumplir → cliente detecta inmediatamente.
 *   - Si el cliente quiere influir, su clientSeed es input — pero NO
 *     puede predecir el resultado porque no conoce el serverSeed hasta
 *     después.
 *   - Estándar de la industria (Spribe/Aviator, Stake Originals, etc.).
 */

import { createHash, randomBytes } from 'crypto';

/**
 * Genera un nuevo serverSeed criptográficamente seguro + su commitHash.
 *
 * El serverSeed se almacena en la DB del juego asociado al jugador
 * (o sesión). El commitHash se publica al cliente vía endpoint
 * `GET /games/<slug>/active-seed` (o similar) ANTES de cualquier spin.
 */
export function newServerSeed(): { seed: Buffer; commitHash: string } {
  const seed = randomBytes(32);
  const commitHash = createHash('sha256').update(seed).digest('hex');
  return { seed, commitHash };
}

/**
 * Calcula el seed determinístico de un round individual.
 *
 * Entrada: serverSeed (Buffer del server) + clientSeed (string editable
 * por el jugador) + nonce (entero incremental, único por par
 * serverSeed/clientSeed).
 *
 * Salida: Buffer de 32 bytes que alimenta el RNG del juego.
 *
 * Reproducibilidad: si el cliente conoce los 3 inputs (post-revelación
 * del serverSeed), puede recrear el resultado del round exacto.
 */
export function computeRoundSeed(
  serverSeed: Buffer,
  clientSeed: string,
  nonce: number,
): Buffer {
  return createHash('sha256')
    .update(serverSeed)
    .update(clientSeed)
    .update(nonce.toString())
    .digest();
}

/**
 * Verifica que un commitHash publicado se corresponda con el
 * serverSeed revelado. Lo usa el cliente para validar fairness
 * después de la rotación de seeds. También útil en tests del backend.
 */
export function verifyCommit(serverSeed: Buffer, commitHash: string): boolean {
  const recomputed = createHash('sha256').update(serverSeed).digest('hex');
  return recomputed === commitHash;
}

/**
 * Valida un clientSeed provisto por el jugador.
 *
 * Reglas:
 *   - Entre 1 y 128 caracteres (UTF-8).
 *   - Solo ASCII printable (no caracteres de control).
 *   - Si el cliente manda algo inválido, el server cae a un
 *     auto-generated seed para no romper el flow.
 */
export function isValidClientSeed(s: string): boolean {
  if (typeof s !== 'string') return false;
  if (s.length < 1 || s.length > 128) return false;
  // ASCII printable (0x20-0x7E)
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

/**
 * Genera un clientSeed default cuando el jugador no provee uno.
 * 16 hex chars random — corto pero suficientemente entrópico.
 */
export function newClientSeedDefault(): string {
  return randomBytes(8).toString('hex');
}
