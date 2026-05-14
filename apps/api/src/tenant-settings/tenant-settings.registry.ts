/**
 * Registry de schemas Zod por key de `tenant_settings`.
 *
 * Cada key conocida del sistema declara su shape esperada. El endpoint
 * `PATCH /tenant/settings/:key` valida el `value` contra el schema antes
 * de persistir. Keys NO registradas se aceptan tal cual (forward-compat
 * — permite que el admin setee custom settings sin code change).
 *
 * Convención: keys hardcoded acá (no importadas de cada módulo) para
 * evitar dependencias circulares — `fraud-detection.service.ts` ya
 * importa de `tenant-settings`, y un import inverso crearía un ciclo.
 * El costo es duplicar el string literal — si se cambia hay que tocar
 * ambos lados. Mitigación: tests que prueban el flow real garantizan
 * que el key del registry y el del service estén alineados.
 *
 * Cuando crezca el catálogo de keys, considerar:
 *   - Per-módulo registry contribuido via DI.
 *   - Constantes compartidas en `@casino/shared` package.
 */

import { z, type ZodSchema } from 'zod';

/**
 * Map de key → schema Zod. Comentarios documentan a qué módulo pertenece.
 */
export const SETTING_SCHEMAS: Record<string, ZodSchema> = {
  // ── fraud (apps/api/src/fraud/fraud-detection.service.ts) ───────────
  // Threshold para que un par de cuentas pase a `status='suspected'`
  // en el scan. Default 70.
  'fraud.suspected_threshold': z
    .number()
    .min(0, { message: 'fraud.suspected_threshold debe ser >= 0' })
    .max(100, { message: 'fraud.suspected_threshold debe ser <= 100' }),

  // Threshold para bloqueo automático de welcome bonus + warning en
  // grant manual. Default 90.
  'fraud.welcome_block_threshold': z
    .number()
    .min(0, { message: 'fraud.welcome_block_threshold debe ser >= 0' })
    .max(100, { message: 'fraud.welcome_block_threshold debe ser <= 100' }),
};

/**
 * Helper para los tests / docs: lista de keys con schema declarado.
 */
export const REGISTERED_SETTING_KEYS = Object.keys(SETTING_SCHEMAS);
