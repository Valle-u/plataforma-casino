/**
 * sha256Hex — hash del contenido de un archivo (Sprint 55).
 *
 * El dedupe de comprobantes por `receipt_storage_key` no alcanzaba porque el
 * storage key es un UUID random generado en CADA upload: el mismo archivo
 * subido dos veces producía dos keys distintos y pasaba el filtro. Este hash
 * del CONTENIDO es el token de dedupe real.
 */

import { createHash } from 'node:crypto';

export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
