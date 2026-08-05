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
  'notifications.sms_enabled': z.boolean(),
  'notifications.push_enabled': z.boolean(),

  // Retención de notifs leídas/enviadas en días. El dispatcher purga
  // entries viejas para evitar crecimiento ilimitado. Default 180d.
  'notifications.retention_days': z
    .number()
    .int({ message: 'notifications.retention_days debe ser entero.' })
    .min(7, { message: 'mínimo 7 días.' })
    .max(3650, { message: 'máximo 3650 días.' }),

  // ── branding (Sprint 29: aplicado al player vía /tenant/info) ───────
  // Color primario del tenant — pisa `--color-accent` en el CSS del
  // player. Formato hex #RRGGBB (con #, 6 dígitos hex). Si no se setea,
  // el player usa el accent default del DS.
  'branding.primary_color': z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, {
      message: 'Debe ser hex #RRGGBB (6 dígitos hex con #).',
    }),

  // URL HTTPS del logo del tenant — se renderiza en `PlayerHeader` y
  // como favicon dinámico. Si no se setea, el player usa el BrandMark
  // SVG default. Sin upload propio en MVP: el admin sube su imagen a
  // un host externo (S3, imgur, propio CDN) y pega la URL acá.
  'branding.logo_url': z
    .string()
    .url({ message: 'Debe ser una URL válida.' })
    .startsWith('https://', { message: 'Debe ser HTTPS por seguridad.' })
    .max(500, { message: 'URL muy larga (máx 500 chars).' }),

  // ── commissions (apps/api/src/commissions/network-commissions.service.ts) ─
  // F1 · Deducciones operativas del socio DEPENDIENTE.
  //
  // Al liquidar la comisión mensual, el motor descuenta 3 items:
  //   sueldos + bank_cost + platform_cost. Estos dos settings controlan los
  //   últimos dos (los sueldos vienen de employee_salaries).
  //
  // Los socios INDEPENDIENTES NO sufren estas deducciones (compraron fichas
  // al por mayor, la comisión no aplica) — el motor los saltea.
  //
  // Costo bancario proporcional: fracción de la NetWin de la sub-red del
  // socio que se le imputa como costo bancario / transaccional. Se resta
  // ANTES del cap final. Rango [0, 1]; default 0.01 (1%).
  //
  // Ejemplo: NetWin sub-red = 1.000.000, pct = 0.01 → costo bancario = 10.000.
  'commissions.bank_cost_pct_of_netwin': z
    .number()
    .min(0, { message: 'commissions.bank_cost_pct_of_netwin debe ser >= 0.' })
    .max(1, {
      message:
        'commissions.bank_cost_pct_of_netwin debe ser <= 1 (fracción, no porcentaje: 0.01 = 1%).',
    }),

  // Costo de plataforma FLAT mensual del socio dep — monto fijo que la
  // plataforma cobra por proveerle el panel. Se resta como línea única del
  // gross. Default 0 (deshabilitado). Debe ser monto en la moneda del tenant.
  'commissions.platform_cost_flat': z
    .number()
    .min(0, { message: 'commissions.platform_cost_flat debe ser >= 0.' }),

  // ── treasury (apps/api/src/house/house.service.ts) ──────────────────
  // TOPE MENSUAL de creación de fichas (mint). El único minteo hoy es
  // `injectBudget`; este setting lo capa por mes calendario UTC. La suma
  // de `house_capital_injections.amount` WHERE type='budget' del mes en
  // curso no puede superar este tope (salvo el modo `fondeo`, que lo
  // bypasea a propósito y queda auditado). Default alto (1e12 = "sin
  // límite práctico") hasta que el admin lo configure. Debe ser >= 0.
  'treasury.monthly_mint_budget': z
    .number()
    .min(0, { message: 'treasury.monthly_mint_budget debe ser >= 0.' }),

  // ── games / Palace Casino (apps/api/src/games/providers/palace) ───────
  // URL base de la Main API de Palace. Default del cliente:
  // https://agent.goldslotpalase.com
  'palace.api_url': z
    .string()
    .url({ message: 'palace.api_url debe ser una URL válida.' })
    .startsWith('https://', { message: 'palace.api_url debe usar HTTPS.' })
    .max(500, { message: 'palace.api_url muy larga (máx 500 chars).' }),

  // Token Bearer para autenticar contra la Main API de Palace.
  'palace.api_token': z.string().min(1, { message: 'palace.api_token no puede estar vacío.' }),

  // Idioma default para requests a Palace (default 4 en el cliente).
  'palace.default_lang': z
    .number()
    .int({ message: 'palace.default_lang debe ser entero.' })
    .min(0, { message: 'palace.default_lang debe ser >= 0.' }),
};

/**
 * Helper para los tests / docs: lista de keys con schema declarado.
 */
export const REGISTERED_SETTING_KEYS = Object.keys(SETTING_SCHEMAS);
