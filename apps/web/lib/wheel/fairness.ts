/**
 * Verificación del sobre cerrado en el cliente — `docs/27-ruleta-diaria.md` §8.
 *
 * El backend publica la huella antes de girar (`GET /:id/commitment`) y revela
 * la semilla al terminar (`POST /:id/spin`). Con WebCrypto el navegador puede
 * recomprobar por sí mismo dos cosas:
 *
 *   1. que la semilla revelada produce la huella que se vio antes del giro
 *      (SHA-256), y
 *   2. que esa semilla, mezclada con la del jugador y el día, da el gajo que
 *      salió (HMAC-SHA256, primeros 52 bits → 0..1 → gajo por acumulados).
 *
 * La derivación es un espejo EXACTO de `WheelFairnessService.valorDelSorteo`.
 * Si esto no matchea el backend, la verificación deja de tener sentido.
 */

const enc = new TextEncoder();

export function supportsWebCrypto(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * El valor del sorteo en [0, 1). HMAC-SHA256(serverSeed, `${clientSeed}:${dayAnchor}`),
 * primeros 52 bits. Mismo algoritmo que `valorDelSorteo` del backend.
 */
export async function hmacRng(
  serverSeed: string,
  clientSeed: string,
  dayAnchor: string,
): Promise<number> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(serverSeed),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    enc.encode(`${clientSeed}:${dayAnchor}`),
  );
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return Number.parseInt(hex.slice(0, 13), 16) / 2 ** 52;
}

/** Gajo que toca un rng dado, por probabilidades acumuladas (mismo orden que el config). */
export function segmentIndexForRng(
  segments: ReadonlyArray<{ probability: number }>,
  rng: number,
): number {
  let accumulated = 0;
  for (let i = 0; i < segments.length; i += 1) {
    accumulated += segments[i]!.probability;
    if (rng < accumulated) return i;
  }
  return segments.length - 1;
}

export interface SpinChecks {
  /** ¿SHA-256(semilla) === huella publicada antes de girar? */
  fingerprint: boolean;
  /** ¿La semilla, derivada, da el gajo que salió? */
  segment: boolean;
  rngLocal: number | null;
}

export interface RevealInput {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  dayAnchor: string;
  expectedSegmentIndex: number;
  segments: ReadonlyArray<{ probability: number }>;
}

/** Corre las dos comprobaciones del sobre ya abierto. */
export async function verifyReveal({
  serverSeed,
  serverSeedHash,
  clientSeed,
  dayAnchor,
  expectedSegmentIndex,
  segments,
}: RevealInput): Promise<SpinChecks> {
  const fingerprint = (await sha256Hex(serverSeed)) === serverSeedHash;
  const rngLocal = await hmacRng(serverSeed, clientSeed, dayAnchor);
  const segment = segmentIndexForRng(segments, rngLocal) === expectedSegmentIndex;
  return { fingerprint, segment, rngLocal };
}