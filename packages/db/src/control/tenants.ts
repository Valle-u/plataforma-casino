/**
 * Tabla `tenants` (DB de control).
 *
 * Registro central de cada cliente operador de la plataforma.
 * Cada tenant tiene su propia DB Postgres separada (multi-tenancy física).
 *
 * Referencia en docs/04-modelo-datos.md §2 y docs/02-arquitectura.md §4.
 */

import { pgTable, text, uuid, timestamp, pgEnum } from 'drizzle-orm/pg-core';
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
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
