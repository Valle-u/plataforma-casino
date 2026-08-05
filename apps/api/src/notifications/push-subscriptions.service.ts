/**
 * PushSubscriptionsService — CRUD de suscripciones web-push por tenant.
 *
 * Una suscripción = un dispositivo. `endpoint` es la URL única que el
 * dispositivo registra contra el push service, por eso funciona como
 * clave de dedupe: el mismo dispositivo que re-registra NO duplica fila
 * (upsert idempotente que además re-asigna al user actual — útil si un
 * dispositivo cambia de cuenta).
 *
 * El dispatcher de notificaciones usa `listForUser` para saber a qué
 * endpoints enviar cuando hay una notif `channel='web_push'` pendiente.
 */

import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { pushSubscriptions, type NewPushSubscription } from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';

export interface UpsertPushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  deviceLabel?: string | null;
}

@Injectable()
export class PushSubscriptionsService {
  /**
   * Registra/actualiza una suscripción del user. Idempotente por
   * endpoint: si ya existe, actualiza claves + label + lastSeenAt.
   */
  async upsert(
    db: TenantDb,
    userId: string,
    input: UpsertPushSubscriptionInput,
  ) {
    const existing = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, input.endpoint))
      .limit(1);
    const now = new Date();
    if (existing[0]) {
      const updated = await db
        .update(pushSubscriptions)
        .set({
          userId,
          p256dh: input.p256dh,
          auth: input.auth,
          deviceLabel: input.deviceLabel ?? existing[0].deviceLabel,
          lastSeenAt: now,
        })
        .where(eq(pushSubscriptions.id, existing[0].id))
        .returning();
      return updated[0]!;
    }
    const row: NewPushSubscription = {
      userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      deviceLabel: input.deviceLabel ?? null,
    };
    const inserted = await db
      .insert(pushSubscriptions)
      .values(row)
      .returning();
    return inserted[0]!;
  }

  /** Todas las suscripciones del user (hot path del dispatcher). */
  listForUser(db: TenantDb, userId: string) {
    return db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .orderBy(pushSubscriptions.createdAt);
  }

  /**
   * Borra una suscripción SIEMPRE que sea del user, identificada por su
   * `endpoint` (URL única del dispositivo). Devuelve true si se borró,
   * false si no existía (o no era del user).
   */
  async deleteForUserByEndpoint(
    db: TenantDb,
    userId: string,
    endpoint: string,
  ): Promise<boolean> {
    const deleted = await db
      .delete(pushSubscriptions)
      .where(
        eq(pushSubscriptions.endpoint, endpoint) &&
          eq(pushSubscriptions.userId, userId),
      )
      .returning({ id: pushSubscriptions.id });
    return deleted.length > 0;
  }

  /** Borrado interno (sin scope) — usado por el dispatcher en 404/410. */
  async deleteById(db: TenantDb, id: string): Promise<void> {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
  }

  /** Marca lastSeenAt (entrega exitosa del dispatcher). */
  async touchLastSeen(db: TenantDb, id: string): Promise<void> {
    await db
      .update(pushSubscriptions)
      .set({ lastSeenAt: new Date() })
      .where(eq(pushSubscriptions.id, id));
  }
}
