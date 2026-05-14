/**
 * NotificationTemplatesService — CRUD de overrides per-tenant del
 * subject/body de cada `kind` de notification.
 *
 * API:
 *   - `list(db)`: todos los overrides.
 *   - `findByKind(db, kind)`: uno (o null).
 *   - `upsert(db, kind, params, actorId)`: crea o actualiza.
 *   - `delete(db, kind)`: borra el override → vuelve al default hardcoded.
 *
 * Validaciones:
 *   - `kind` debe estar en `REGISTERED_NOTIFICATION_KINDS` — sin esto
 *     el admin podría crear overrides "huérfanos" que nunca se usan.
 *
 * Sin transacción: las ops son single-row, atomicas por sí mismas.
 */

import { BadRequestException, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  notificationTemplates,
  type NewNotificationTemplate,
  type NotificationTemplate,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { REGISTERED_NOTIFICATION_KINDS } from './notifications.templates';

export interface UpsertTemplateParams {
  subjectTemplate: string;
  bodyTemplate: string;
  enabled?: boolean;
}

@Injectable()
export class NotificationTemplatesService {
  /**
   * Asegura que `kind` esté registrado en código. Tira BadRequest si no.
   * Protección contra typos del admin que crearían overrides huérfanos.
   */
  private assertKindRegistered(kind: string): void {
    if (!REGISTERED_NOTIFICATION_KINDS.includes(kind)) {
      throw new BadRequestException({
        message: `Kind '${kind}' no está registrado. Kinds válidos: ${REGISTERED_NOTIFICATION_KINDS.join(', ')}`,
        error: 'NOTIFICATION_KIND_NOT_REGISTERED',
      });
    }
  }

  async list(db: TenantDb): Promise<NotificationTemplate[]> {
    return db.select().from(notificationTemplates).orderBy(notificationTemplates.kind);
  }

  async findByKind(
    db: TenantDb,
    kind: string,
  ): Promise<NotificationTemplate | null> {
    const rows = await db
      .select()
      .from(notificationTemplates)
      .where(eq(notificationTemplates.kind, kind))
      .limit(1);
    return rows[0] ?? null;
  }

  async upsert(
    db: TenantDb,
    kind: string,
    params: UpsertTemplateParams,
    actorUserId: string,
  ): Promise<NotificationTemplate> {
    this.assertKindRegistered(kind);

    const enabled = params.enabled ?? true;
    const row: NewNotificationTemplate = {
      kind,
      subjectTemplate: params.subjectTemplate,
      bodyTemplate: params.bodyTemplate,
      enabled,
      updatedByUserId: actorUserId,
      updatedAt: new Date(),
    };
    const result = await db
      .insert(notificationTemplates)
      .values(row)
      .onConflictDoUpdate({
        target: notificationTemplates.kind,
        set: {
          subjectTemplate: row.subjectTemplate,
          bodyTemplate: row.bodyTemplate,
          enabled,
          updatedByUserId: actorUserId,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result[0]!;
  }

  /**
   * Borra el override. Idempotent — si no existía, no hace nada.
   * Devuelve true si borró, false si no había nada.
   */
  async delete(db: TenantDb, kind: string): Promise<boolean> {
    const deleted = await db
      .delete(notificationTemplates)
      .where(eq(notificationTemplates.kind, kind))
      .returning({ id: notificationTemplates.id });
    return deleted.length > 0;
  }
}
