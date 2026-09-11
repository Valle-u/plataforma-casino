/**
 * La línea de tiempo del contacto — roadmap **4.3**.
 *
 * ## Qué va acá y qué no
 *
 * **No es un registro de lo que se habló.** Los mensajes ya están a la vista en
 * el hilo, y duplicarlos acá no agregaría nada. Lo que va son las cosas que
 * pasan **alrededor** de la conversación y que, si no se anotan cuando pasan,
 * **no se pueden reconstruir después**:
 *
 * | Evento | Por qué no se puede reconstruir |
 * |---|---|
 * | `link` / `unlink` | El vínculo es una columna que se pisa. Después del cambio no queda rastro de que hubo otro antes, ni de quién lo hizo. |
 * | `alta` | El jugador queda creado, pero nada dice que salió **de esta conversación** — y de eso dependen las comisiones (**D9**). |
 * | `estado` | `crm_conversations.status` es mutable y sin historial. Mirando los mensajes no hay forma de saber cuándo se resolvió ni quién. |
 * | `aviso` | El aviso de **D8** sale para otra bandeja y **no deja nada en ésta**. Sin esto, "¿le avisamos al cajero?" no tiene respuesta. |
 *
 * Los tramos (**4.4**) son otra cosa y tienen su propia tabla: ahí se mide, acá
 * se cuenta qué pasó.
 *
 * ## Escribir no puede voltear la operación
 *
 * `anotar()` **nunca tira**. Dejar de vincular un contacto porque falló el
 * insert de la auditoría sería cambiar algo que el operador pidió por un
 * registro que —hasta esta tanda— nadie miraba. El precio es que un fallo de
 * escritura pasa desapercibido; el alternativo es peor.
 *
 * ## Aislamiento
 *
 * Los eventos cuelgan del **contacto**, y por **D6** un contacto es de una
 * bandeja. O sea que la línea de tiempo hereda el aislamiento sin necesitar
 * reglas propias: no existe un contacto compartido del que se pueda leer la
 * actividad de otra red.
 */

import { Injectable, Logger } from '@nestjs/common';
import { desc, eq, inArray } from 'drizzle-orm';
import { crmTimelineEvents, users } from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';

/** Cuántos eventos trae la ficha. Alcanza para ver la historia de un contacto. */
const TOPE = 50;

/** Un evento, como lo ve la pantalla. */
export interface EventoDeLaLinea {
  id: string;
  /** `link` | `unlink` | `alta` | `estado` | `aviso`. Texto libre a propósito. */
  type: string;
  summary: string;
  occurredAt: string;
  /** Quién lo hizo. `null` si el evento no tiene actor o el usuario ya no está. */
  actor: { id: string; username: string } | null;
}

@Injectable()
export class CrmTimelineService {
  private readonly logger = new Logger(CrmTimelineService.name);

  /**
   * Deja constancia. **No tira nunca** — ver el docblock.
   *
   * `metadata` guarda los ids (`actorId`, `userId`) y el `summary` el texto ya
   * armado. Se guardan los dos porque sirven para cosas distintas: el texto es
   * lo que se lee, los ids son lo que se puede cruzar después.
   */
  async anotar(
    db: TenantDb,
    evento: {
      contactId: string;
      type: string;
      summary: string;
      metadata?: Record<string, string>;
    },
  ): Promise<void> {
    try {
      await db.insert(crmTimelineEvents).values({
        contactId: evento.contactId,
        type: evento.type,
        summary: evento.summary,
        metadata: evento.metadata ?? {},
      });
    } catch (err) {
      this.logger.warn(
        `No se pudo anotar "${evento.type}" del contacto ${evento.contactId}: ` +
          `${(err as Error).message}`,
      );
    }
  }

  /**
   * La línea de tiempo de un contacto, de lo más nuevo a lo más viejo.
   *
   * ⚠️ **No valida acceso.** El que llama tiene que haber pasado por
   * `assertAccess` — igual que las notas y las etiquetas.
   *
   * Los nombres de los actores se resuelven **en una consulta**, no una por
   * evento: una ficha con cincuenta eventos serían cincuenta viajes a la base
   * para mostrar una columna.
   */
  async listar(db: TenantDb, contactId: string): Promise<EventoDeLaLinea[]> {
    const filas = await db
      .select()
      .from(crmTimelineEvents)
      .where(eq(crmTimelineEvents.contactId, contactId))
      .orderBy(desc(crmTimelineEvents.occurredAt))
      .limit(TOPE);

    if (filas.length === 0) return [];

    const idsDeActores = [
      ...new Set(
        filas
          .map((f) => actorDe(f.metadata))
          .filter((id): id is string => id !== null),
      ),
    ];

    const porId = new Map<string, string>();
    if (idsDeActores.length > 0) {
      const encontrados = await db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(inArray(users.id, idsDeActores));
      for (const u of encontrados) porId.set(u.id, u.username);
    }

    return filas.map((f) => {
      const actorId = actorDe(f.metadata);
      const username = actorId ? porId.get(actorId) : undefined;
      return {
        id: f.id,
        type: f.type,
        summary: f.summary,
        occurredAt: f.occurredAt.toISOString(),
        // Sin username = el usuario ya no está. El evento **igual se muestra**:
        // que el actor haya desaparecido no borra que la cosa pasó.
        actor: actorId && username ? { id: actorId, username } : null,
      };
    });
  }
}

/**
 * El `actorId` de un `metadata` que es `jsonb`, o sea `unknown`.
 *
 * Se comprueba en vez de castear: la columna es texto libre y una fila vieja —o
 * escrita por otro camino— puede no tener la forma esperada. Un `metadata` raro
 * tiene que dar un evento sin actor, no romper la ficha entera.
 */
function actorDe(metadata: unknown): string | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  const actorId = (metadata as Record<string, unknown>).actorId;
  return typeof actorId === 'string' && actorId ? actorId : null;
}
