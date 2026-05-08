/**
 * Tabla `tenant_domains` (DB de control).
 *
 * Cada tenant puede tener múltiples dominios apuntando a su instancia:
 *   - dominio principal del sitio jugador (ej: 'casinopampa.com')
 *   - subdominios (ej: 'panel.casinopampa.com')
 *   - aliases viejos que redirigen al primario
 *
 * El TenantResolver middleware del backend usa esta tabla para mapear
 * el header Host del request → tenant_id correspondiente.
 *
 * Referencia en docs/04-modelo-datos.md §2.
 */

import { pgTable, text, uuid, timestamp, boolean } from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';
import { tenants } from './tenants';

export const tenantDomains = pgTable('tenant_domains', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => generateUuidV7()),

  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),

  /** Dominio completo (ej: 'casinopampa.com'). Único globalmente. */
  domain: text('domain').notNull().unique(),

  /**
   * Marca si éste es el dominio "principal" del tenant.
   * Solo uno puede ser true por tenant (validado a nivel app).
   */
  isPrimary: boolean('is_primary').notNull().default(false),

  /**
   * Timestamp de cuando se verificó el DNS.
   * NULL = pendiente de verificación.
   */
  verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }),

  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export type TenantDomain = typeof tenantDomains.$inferSelect;
export type NewTenantDomain = typeof tenantDomains.$inferInsert;
