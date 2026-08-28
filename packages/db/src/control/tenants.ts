/**
 * Tabla `tenants` (DB de control).
 *
 * Registro central de cada cliente operador de la plataforma.
 * Cada tenant tiene su propia DB Postgres separada (multi-tenancy física).
 *
 * Referencia en docs/04-modelo-datos.md §2 y docs/02-arquitectura.md §4.
 */

import { pgTable, text, uuid, timestamp, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';
import { tenantPlans } from './tenant-plans';

/**
 * Estados posibles de un tenant.
 *  - active:     operando normalmente.
 *  - suspended:  pausado (deuda, problema reportado, sanción).
 *  - onboarding: provisioning en curso (DB creándose, etc.).
 *  - deleted:    soft-deleted, datos archivados.
 */
export const tenantStatusEnum = pgEnum('tenant_status', [
  'active',
  'suspended',
  'onboarding',
  'deleted',
]);

export const tenants = pgTable('tenants', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => generateUuidV7()),

  /** Slug URL-safe único, usado para nombrar la DB del tenant. */
  slug: text('slug').notNull().unique(),

  /** Nombre comercial visible (ej: "Casino Pampa"). */
  name: text('name').notNull(),

  /**
   * Nombre de la DB Postgres asignada a este tenant.
   * Convención: `tenant_<slug>` (con guiones bajos).
   * Almacenado explícito para soportar sharding futuro a otros hosts.
   */
  dbName: text('db_name').notNull().unique(),

  /**
   * Host de la DB del tenant. Por default 'localhost' o el del cluster compartido.
   * Cuando un tenant se mueve a host dedicado (sharding), se actualiza.
   */
  dbHost: text('db_host').notNull().default('localhost'),

  /** Estado actual del tenant. */
  status: tenantStatusEnum('status').notNull().default('onboarding'),

  /** Plan comercial al que está suscrito. */
  planId: uuid('plan_id')
    .notNull()
    .references(() => tenantPlans.id, { onDelete: 'restrict' }),

  /** Email de contacto principal del tenant (admin del operador). */
  contactEmail: text('contact_email').notNull(),

  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),

  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),

  /** Soft delete: marcar fecha en lugar de borrar. NULL si está activo. */
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),

  /**
   * Callback token del proveedor Palace Casino (Seamless wallet).
   * Seteado por el admin del tenant desde /admin/settings.
   * El callback del proveedor NO incluye identificador de tenant — resolvemos
   * el tenant con una query: WHERE palace_callback_token = $1.
   * NULL si el tenant no usa Palace.
   */
  palaceCallbackToken: text('palace_callback_token'),

  /**
   * Agent code del proveedor Forever (2º proveedor seamless). El callback de
   * Forever tampoco incluye tenant: resolvemos con WHERE forever_agent_code = $1
   * (viene en el header X-Forever-Sig-Agent + en el body). NULL si el tenant no
   * usa Forever. La verificación de firma Ed25519 usa la public key del tenant
   * (game_provider.forever.callback_verify_public_key en tenant_settings).
   */
  foreverAgentCode: text('forever_agent_code'),

  /**
   * Callback token del proveedor Gregmorn Hub (3er proveedor seamless).
   *
   * A diferencia de Palace y Forever, el callback de Gregmorn **no trae ningún
   * dato del que se pueda deducir el tenant**: ni token en el body, ni agent
   * code en un header. Lo que sí tiene es que la `callbackUrl` se manda por
   * request en cada `openGame`, así que el discriminador viaja en la URL:
   *   POST /api/v1/game-provider/gregmorn/callback/:token
   *
   * Resolvemos con WHERE gregmorn_callback_token = $1 y recién entonces
   * verificamos la firma HMAC con la `secret_api_key` de ESE tenant
   * (game_provider.gregmorn.secret_api_key en tenant_settings). El token no
   * autentica — solo elige de quién es la clave. NULL si el tenant no usa
   * Gregmorn.
   */
  gregmornCallbackToken: text('gregmorn_callback_token'),
}, (table) => [
  uniqueIndex('tenants_palace_callback_token_unique').on(table.palaceCallbackToken),
  uniqueIndex('tenants_forever_agent_code_unique').on(table.foreverAgentCode),
  uniqueIndex('tenants_gregmorn_callback_token_unique').on(table.gregmornCallbackToken),
]);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
