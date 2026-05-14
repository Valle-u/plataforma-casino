/**
 * Tabla `notification_templates` (DB de tenant).
 *
 * Overrides por tenant del subject/body de cada `kind` de notification.
 * Si una entry existe y `enabled=true`, el `NotificationsService.enqueue`
 * la usa en lugar del template hardcoded del código.
 *
 * Diseño:
 *   - `kind` UNIQUE — un override por kind, por tenant.
 *   - `subject_template` + `body_template`: strings con placeholders
 *     `{{varName}}` que el renderer reemplaza con el payload.
 *   - Sin lógica condicional (if/else) — overrides son texto plano.
 *     Los defaults en código sí pueden tener condicionales (e.g.
 *     `if (externalRef)`). Trade-off MVP: admin gana customización,
 *     pierde lógica. Aceptable — los textos editables raramente la
 *     necesitan.
 *   - `enabled` boolean — toggle sin borrar el override. Si false, el
 *     enqueue vuelve a usar el default hardcoded.
 *   - Audit: `updated_by_user_id` + `updated_at`. Cambios también
 *     graban entry en `audit_log` (action `tenant.notification_template.set`
 *     / `.unset`).
 *   - Sin FK al "registro de kinds" porque los kinds viven en código
 *     (mapa en `notifications.templates.ts`). El controller valida que
 *     el kind exista al momento del PATCH.
 */

import {
  boolean,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';
import { users } from './users';

export const notificationTemplates = pgTable('notification_templates', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => generateUuidV7()),

  /** Discriminador del template — único por tenant. */
  kind: text('kind').notNull().unique(),

  /** Template del subject con `{{vars}}`. */
  subjectTemplate: text('subject_template').notNull(),

  /** Template del body con `{{vars}}`. */
  bodyTemplate: text('body_template').notNull(),

  /**
   * Toggle del override sin borrarlo. Si false, el enqueue usa el default
   * hardcoded como si no existiera la fila.
   */
  enabled: boolean('enabled').notNull().default(true),

  updatedByUserId: uuid('updated_by_user_id').references(() => users.id),

  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),

  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export type NotificationTemplate = typeof notificationTemplates.$inferSelect;
export type NewNotificationTemplate = typeof notificationTemplates.$inferInsert;
