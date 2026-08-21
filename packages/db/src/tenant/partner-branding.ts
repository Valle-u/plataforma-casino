/**
 * Tabla `partner_branding` (DB de tenant).
 *
 * Diseño propio de un SOCIO INDEPENDIENTE. Cada socio independiente puede tener
 * su propia versión visual del casino (colores, logo, nombre, banners) que ve
 * su sub-red. Un socio = un diseño (unique en `owner_user_id`). Si un socio NO
 * tiene fila acá, su red ve el diseño default del tenant (`tenant_settings`).
 *
 * El `config` tiene la MISMA forma que el `design.config` del tenant
 * (colors/texts/brand/slides), para reusar el mismo editor y el mismo render.
 *
 * Feature: "diseño por socio independiente" (Etapa 1). Aditiva — no toca nada
 * existente; los tenants/socios que no la usan ven el default de siempre.
 */

import { jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';
import { users } from './users';

export const partnerBranding = pgTable('partner_branding', {
  id: uuid('id').primaryKey().$defaultFn(generateUuidV7),

  /** El socio independiente dueño de este diseño. Único: 1 diseño por socio. */
  ownerUserId: uuid('owner_user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),

  /**
   * Diseño completo (misma forma que `design.config` del tenant):
   * `{ colors, texts, brand, slides }`. Libre (jsonb) — lo interpreta el mismo
   * render del player que ya existe.
   */
  config: jsonb('config').notNull().default({}),

  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export type PartnerBranding = typeof partnerBranding.$inferSelect;
export type NewPartnerBranding = typeof partnerBranding.$inferInsert;
