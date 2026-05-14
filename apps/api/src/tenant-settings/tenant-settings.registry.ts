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

  // ── tenant_settings (self) ──────────────────────────────────────────
  // Retención del history en días. Cron diario purga entries con
  // changed_at < NOW() - N days. Min 7 (no perder visibility de la
  // última semana). Max 3650 (~10 años).
  'tenant_settings.history_retention_days': z
    .number()
    .int({ message: 'tenant_settings.history_retention_days debe ser entero.' })
    .min(7, { message: 'mínimo 7 días.' })
    .max(3650, { message: 'máximo 3650 días (~10 años).' }),

  // ── notifications (apps/api/src/notifications) ──────────────────────
  // Master switches por channel. Si false, el dispatcher salta las
  // notifs de ese channel (quedan en pending forever — útil para
  // pausar envíos temporalmente sin perder el queue).
  'notifications.email_enabled': z.boolean(),
  'notifications.in_app_enabled': z.boolean(),

  // Retención de notifs leídas/enviadas en días. El dispatcher purga
  // entries viejas para evitar crecimiento ilimitado. Default 180d.
  'notifications.retention_days': z
    .number()
    .int({ message: 'notifications.retention_days debe ser entero.' })
    .min(7, { message: 'mínimo 7 días.' })
    .max(3650, { message: 'máximo 3650 días.' }),
};

/**
 * Helper para los tests / docs: lista de keys con schema declarado.
 */
export const REGISTERED_SETTING_KEYS = Object.keys(SETTING_SCHEMAS);
