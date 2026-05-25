/**
 * RNG determinístico desde seed — primitive para todos los juegos propios.
 *
 * Estandariza CÓMO se consume el roundSeed (32 bytes del SHA256 de
 * provably-fair) para generar números pseudoaleatorios reproducibles.
 *
 * Diseño:
 *   - Seed inicial: 32 bytes (256 bits) del SHA256 del provably-fair.
 *   - Cada llamada a `next()` produce 1 float en [0, 1) consumiendo
 *     8 bytes (64 bits) del estado interno.
 *   - Cuando se acaban los bytes del seed, se re-genera el estado
 *     haciendo SHA256(estado_actual). Esto permite extraer ilimitados
 *     números pseudoaleatorios sin perder determinismo.
 *
 * Por qué no Math.random():
 *   - Math.random no es seedable, no es reproducible.
 *
 * Por qué no crypto.randomInt():
 *   - Tampoco es seedable (usa /dev/urandom internamente).
 *
 * Por qué no librerías externas (seedrandom, etc.):
 *   - Para evitar dependencia. Esta implementación es 50 líneas, audit-
 *     able, y usa solo `crypto` (built-in de Node).
 *
 * Compatibilidad cliente: este código corre solo en Node (el cliente
 * NO ejecuta math, solo dibuja outcomes que llegan del server).
 */

import { createHash } from 'crypto';

/**
 * Crea un RNG determinístico a partir de un seed de 32 bytes.
 *
 * El RNG expone:
 *   - `next()` → float en [0, 1) — uso típico.
 *   - `nextInt(maxExclusive)` → int en [0, maxExclusive) — útil para
 *     elegir stop de reel strip.
 *   - `pick(arr)` → elemento random de un array — uso common para
 *     elegir símbolos.
 */
export interface DeterministicRng {
  next(): number;
  nextInt(maxExclusive: number): number;
  pick<T>(arr: readonly T[]): T;
}

/**
 * Factory: crea un nuevo RNG a partir de un seed.
 *
 * Implementación: usa el seed como buffer de bytes. Consume 8 bytes a la
 * vez para producir un uint64 que se normaliza a [0, 1). Cuando se
 * agotan los bytes, hace SHA256 del último bloque para producir 32 más.
 */
export function createDeterministicRng(seed: Buffer): DeterministicRng {
  if (seed.length !== 32) {
    throw new Error(
      `createDeterministicRng: seed debe ser exactamente 32 bytes, recibí ${seed.length}`,
    );
  }

  let buffer = Buffer.from(seed);
  let offset = 0;

  function ensureBytes(n: number): void {
    if (offset + n > buffer.length) {
      // Re-generamos el buffer haciendo SHA256(buffer + offset). Esto
      // produce un nuevo bloque de 32 bytes determinístico desde el
      // estado actual.
      buffer = createHash('sha256').update(buffer).digest();
      offset = 0;
    }
  }

  function nextU64(): bigint {
    ensureBytes(8);
    // Leemos 8 bytes como uint64 big-endian.
    const hi = BigInt(buffer.readUInt32BE(offset));
    const lo = BigInt(buffer.readUInt32BE(offset + 4));
    offset += 8;
    return (hi << 32n) | lo;
  }

  return {
    next(): number {
      // Normalizamos uint64 a [0, 1). Dividimos por 2^64.
      // Usamos Number() porque float64 tiene 53 bits de mantissa —
      // perdemos los 11 bits menos significativos del uint64 pero eso
      // es OK para generar floats uniformes en [0, 1).
      const u = nextU64();
      // 2^53 - 1 = 9007199254740991 (Number.MAX_SAFE_INTEGER)
      // Tomamos los top 53 bits del uint64 para preservar precisión.
      const top53 = Number(u >> 11n);
      return top53 / 2 ** 53;
    },
    nextInt(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new Error(
          `nextInt: maxExclusive debe ser entero > 0, recibí ${maxExclusive}`,
        );
      }
      // Multiplicamos un float [0,1) por maxExclusive y truncamos.
      // Para max <= 2^53 esto da distribución uniforme.
      return Math.floor(this.next() * maxExclusive);
    },
    pick<T>(arr: readonly T[]): T {
      if (arr.length === 0) {
        throw new Error('pick: array vacío');
      }
      const item = arr[this.nextInt(arr.length)];
      // arr[i] devuelve T | undefined en TS strict — sabemos que i está
      // en rango por construcción del nextInt.
      return item as T;
    },
  };
}
