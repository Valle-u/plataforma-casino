/**
 * Cerrar la red de un socio independiente (**D14** + **D24**, roadmap **4.2**).
 *
 * # ⚠️ Esto ejecuta una excepción autorizada a la LEY R6
 *
 * **R6**: el admin ve de una red independiente **agregados, no el detalle
 * interno**. Y **D6** y **D7** lo llevan hasta el final en el CRM: el staff
 * central no ve las conversaciones de un cajero, ni sabe que existen.
 *
 * **D14 autoriza levantar eso cuando el socio deja de operar.** El staff central
 * —**incluidos los empleados**— pasa a leer el historial completo de esa red:
 * todo lo que ese socio y sus cajeros hablaron con sus jugadores, durante todos
 * los años que operó. Una salida no siempre es en buenos términos, y un socio
 * que se va peleado descubre que el casino ahora lee todo.
 *
 * Eso está **autorizado por el dueño** y anotado en `docs/LEYES.md` y en
 * `docs/DEVLOG.md` 2026-09-08. Este archivo lo ejecuta; no lo decide.
 *
 * # Los límites, que son lo que hace que la excepción sea una excepción
 *
 * 1. **Sólo redes cerradas.** Mientras el socio opera, valen D6 y D7 sin
 *    matices. No hay —ni puede haber— un botón de *"ver las conversaciones de
 *    Litoral"*.
 * 2. **Sólo visibilidad del CRM.** **E8 y P3 quedan intactos**: cerrar una red
 *    no habilita a nadie a tocar su plata.
 * 3. **El disparador es el cierre**, no una decisión discrecional. Por eso es
 *    una acción dedicada y no un efecto de desactivar un usuario — desactivar
 *    es un botón normal de operación, y si eso abriera el historial, la
 *    excepción no tendría disparador deliberado.
 * 4. **No se puede deshacer** (**D24**). Ver abajo.
 *
 * ## Lo que NO hace, y es deliberado: la plata sigue oculta
 *
 * D14 autoriza leer **el historial**. No dice nada sobre ver el saldo, y su
 * límite 2 insiste en que es *sólo visibilidad del CRM*. Así que después de
 * cerrar, `getContext` **sigue sin devolver la billetera** de esos jugadores:
 * siguen colgando de una rama independiente, y `redDelJugador` sigue diciendo
 * que no es la red de quien pregunta.
 *
 * Es la lectura **angosta** de una excepción a una ley, y se elige a propósito:
 * ampliarla es otra decisión, del dueño, no un efecto de rebote de ésta.
 *
 * ## Por qué es irreversible
 *
 * D14 lo anticipa: *"si el cierre se puede hacer y deshacer sin registro, la
 * excepción se convierte en un interruptor para leer la red de cualquiera"*.
 *
 * Con reversa, un admin cierra la red cinco minutos, lee años de conversaciones
 * y reabre. Queda auditado — pero **una auditoría sólo sirve si alguien la
 * lee**, y para cuando alguien la lea el daño ya está hecho. El `unique` de
 * `crm_network_closures.socio_user_id` hace que cerrar dos veces sea imposible,
 * y con eso, abrir y cerrar también.
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import {
  crmContactTags,
  crmContacts,
  crmConversations,
  crmNetworkClosures,
  crmTags,
  users,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';

/**
 * La transacción de una `TenantDb`. No es lo mismo que la conexión —no tiene
 * `$client`— y por eso no se puede pasar donde se espera una `TenantDb`.
 */
type TenantTx = Parameters<Parameters<TenantDb['transaction']>[0]>[0];
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import { AuditLogService } from '../audit/audit-log.service';

/** Lo que queda registrado en `audit_log`. */
export const ACCION_DE_AUDITORIA = 'crm.network.close';

/** El color de la etiqueta de origen. Gris: es un dato, no una alarma. */
const COLOR_DE_LA_ETIQUETA = '#8a8a8a';

export interface ResultadoDelCierre {
  closureId: string;
  contactosMovidos: number;
  conversacionesMovidas: number;
  etiqueta: string;
}

@Injectable()
export class CierreDeRedService {
  private readonly logger = new Logger(CierreDeRedService.name);

  constructor(
    private readonly hierarchy: UserHierarchyService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Cierra la red del socio y trae sus conversaciones a la bandeja central.
   *
   * Todo en **una transacción**: si algo falla, no puede quedar media red movida
   * sin la fila que explica por qué. Esa fila es lo único que separa lo
   * permitido de lo prohibido — contactos movidos sin ella serían
   * conversaciones de una red independiente sentadas en la bandeja central **sin
   * autorización que las respalde**.
   */
  async cerrar(
    db: TenantDb,
    params: {
      socioId: string;
      actorId: string;
      motivo: string;
      /** Para la auditoría. */
      ip?: string | null;
      userAgent?: string | null;
    },
  ): Promise<ResultadoDelCierre> {
    const motivo = params.motivo.trim();
    if (motivo.length < 10) {
      // Obligatorio y con sustancia: dentro de un año, esto es lo único que va
      // a explicar por qué el staff puede leer esas conversaciones.
      throw new BadRequestException({
        message:
          'Hace falta un motivo de al menos 10 caracteres: es lo que va a ' +
          'explicar después por qué se abrió el historial de esta red.',
        error: 'REASON_REQUIRED',
      });
    }

    const socio = (
      await db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          esIndependiente: users.isIndependentBranch,
        })
        .from(users)
        .where(eq(users.id, params.socioId))
        .limit(1)
    )[0];

    if (!socio) throw new NotFoundException('Ese usuario no existe.');

    // Cerrar "la red" de alguien que no es cabeza de una red independiente no
    // significa nada — y movería contactos que nunca estuvieron aislados.
    if (!socio.esIndependiente) {
      throw new BadRequestException({
        message: 'Ese usuario no es cabeza de una red independiente.',
        error: 'NOT_AN_INDEPENDENT_BRANCH',
      });
    }

    const yaCerrada = (
      await db
        .select({ id: crmNetworkClosures.id })
        .from(crmNetworkClosures)
        .where(eq(crmNetworkClosures.socioUserId, socio.id))
        .limit(1)
    )[0];
    if (yaCerrada) {
      throw new ConflictException({
        message: 'Esta red ya está cerrada. El cierre no se puede deshacer.',
        error: 'NETWORK_ALREADY_CLOSED',
      });
    }

    // El socio **y todos sus descendientes**: los contactos cuelgan de cada
    // operador, no del socio. Dejar afuera a los cajeros dejaría sus
    // conversaciones en bandejas que ya no atiende nadie.
    const dueños = [...(await this.hierarchy.getUserIdsInSubnetwork(db, socio.id))];
    const etiqueta = `Red de ${socio.displayName ?? socio.username}`;

    // La bandeja central se resuelve ANTES de abrir la transacción: es un dato
    // estable, y adentro obligaría a tipar la tx como si fuera la conexión.
    const admin = await this.hierarchy.getPrimaryAdminUserId(db);
    if (!admin) {
      throw new BadRequestException({
        message: 'No se pudo resolver la bandeja central.',
        error: 'CENTRAL_INBOX_NOT_RESOLVED',
      });
    }

    const resultado = await db.transaction(async (tx) => {
      const contactos = await tx
        .select({ id: crmContacts.id })
        .from(crmContacts)
        .where(inArray(crmContacts.ownerUserId, dueños));

      const ids = contactos.map((c) => c.id);

      let conversacionesMovidas = 0;
      if (ids.length > 0) {
        // `owner_user_id = NULL` es "central" (**D1**/**D6**). A partir de acá
        // el staff los ve como cualquier otro contacto.
        await tx
          .update(crmContacts)
          .set({ ownerUserId: null, updatedAt: new Date() })
          .where(inArray(crmContacts.id, ids));

        const movidas = await tx
          .update(crmConversations)
          .set({ assignedOperatorId: admin, updatedAt: new Date() })
          .where(inArray(crmConversations.contactId, ids))
          .returning({ id: crmConversations.id });
        conversacionesMovidas = movidas.length;

        await this.etiquetar(tx, ids, etiqueta);
      }

      const fila = (
        await tx
          .insert(crmNetworkClosures)
          .values({
            socioUserId: socio.id,
            closedBy: params.actorId,
            reason: motivo,
            contactsMoved: ids.length,
          })
          .returning({ id: crmNetworkClosures.id })
      )[0]!;

      return {
        closureId: fila.id,
        contactosMovidos: ids.length,
        conversacionesMovidas,
        etiqueta,
      };
    });

    // Fuera de la transacción: el cierre ya ocurrió y no se puede deshacer, así
    // que un fallo del `audit_log` no puede revertirlo. Igual se intenta — la
    // fila de `crm_network_closures` ya guarda quién y cuándo, así que la
    // garantía de D14 no depende de esto.
    await this.audit.record(db, {
      actorUserId: params.actorId,
      actionCode: ACCION_DE_AUDITORIA,
      targetType: 'user',
      targetId: socio.id,
      reason: motivo,
      metadata: {
        // Se deja escrito en la auditoría **qué se autorizó**, no sólo qué se
        // tocó: dentro de un año, "movió 340 contactos" no dice que a partir de
        // ahí el staff lee conversaciones que antes le estaban prohibidas.
        excepcion: 'D14 sobre LEY R6 — el staff central pasa a leer el historial',
        socio: socio.username,
        ...resultado,
      },
      ip: params.ip ?? null,
      userAgent: params.userAgent ?? null,
    });

    this.logger.warn(
      `⚠️ RED CERRADA (D14): ${socio.username} — ${resultado.contactosMovidos} ` +
        `contactos a la bandeja central. Cerró ${params.actorId}. Irreversible.`,
    );

    return resultado;
  }

  /**
   * La etiqueta que marca de qué red vienen (**D14**).
   *
   * Sin esto, el staff atiende a gente sin saber de dónde salió — y el historial
   * que está leyendo pierde el único contexto que lo explica.
   *
   * Se reusa la etiqueta si ya existe: cerrar dos redes distintas no puede
   * pisarse entre sí, y el nombre lleva el del socio justamente para eso.
   */
  private async etiquetar(
    tx: TenantTx,
    contactIds: string[],
    etiqueta: string,
  ): Promise<void> {
    const existente = (
      await tx
        .select({ id: crmTags.id })
        .from(crmTags)
        .where(eq(crmTags.label, etiqueta))
        .limit(1)
    )[0];

    const tagId =
      existente?.id ??
      (
        await tx
          .insert(crmTags)
          .values({ label: etiqueta, color: COLOR_DE_LA_ETIQUETA })
          .returning({ id: crmTags.id })
      )[0]!.id;

    // `ON CONFLICT DO NOTHING`: un contacto que ya tuviera la etiqueta no puede
    // hacer fallar el cierre entero.
    await tx
      .insert(crmContactTags)
      .values(contactIds.map((contactId) => ({ contactId, tagId })))
      .onConflictDoNothing();
  }

  /**
   * ¿La red de este socio está cerrada?
   *
   * Existe para que el resto del CRM pueda preguntarlo sin aprenderse la tabla,
   * y para que el día que alguien quiera relajar D6 tenga que pasar por acá.
   */
  async estaCerrada(db: TenantDb, socioId: string): Promise<boolean> {
    const fila = (
      await db
        .select({ id: crmNetworkClosures.id })
        .from(crmNetworkClosures)
        .where(eq(crmNetworkClosures.socioUserId, socioId))
        .limit(1)
    )[0];
    return fila !== undefined;
  }

  /** Las redes cerradas, para poder auditarlas desde afuera. */
  async listar(db: TenantDb) {
    return db
      .select({
        id: crmNetworkClosures.id,
        socioUserId: crmNetworkClosures.socioUserId,
        socio: users.username,
        closedBy: crmNetworkClosures.closedBy,
        reason: crmNetworkClosures.reason,
        contactsMoved: crmNetworkClosures.contactsMoved,
        closedAt: crmNetworkClosures.closedAt,
      })
      .from(crmNetworkClosures)
      .innerJoin(users, eq(users.id, crmNetworkClosures.socioUserId))
      .orderBy(sql`${crmNetworkClosures.closedAt} desc`);
  }
}
