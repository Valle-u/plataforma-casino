/**
 * De un `change` de Meta a una conversación en una bandeja (**3.2**).
 *
 * Es el equivalente de `telegram-inbound.service.ts`, y el orden es el mismo —
 * el crudo ya lo guardó el webhook; acá se procesa y se marca.
 *
 * ## Lo que cambia respecto de Telegram, y no es poco
 *
 * **Acá sí llega el teléfono**, así que **D4 corre de lleno**: el sistema busca
 * ese número entre los jugadores y lo vincula **solo, sin preguntar**. En
 * Telegram eso no pasa nunca y todo contacto nace como lead.
 *
 * Las tres defensas que D4 exige están las tres acá:
 *
 * 1. **Normalizar antes de comparar.** `3415551234`, `+543415551234` y
 *    `0341 15 555-1234` son el mismo número. Lo resuelve `telefono.ts`, que
 *    compara contra las escrituras canónicas de `users.phone` en vez de
 *    normalizar una columna de texto libre cargada a mano durante años.
 * 2. **Si matchea con más de uno, no se vincula ninguno.** `users.phone` **no
 *    es único**: un teléfono compartido —una pareja, un locutorio— o uno mal
 *    cargado uniría a dos personas en una sola ficha, y el operador vería el
 *    nombre equivocado **sin ninguna señal de que algo pasó**. Ante la duda,
 *    lead.
 * 3. **Se puede deshacer**, desde la ficha, y queda registrado quién lo hizo.
 *    Eso ya existe (3.3) y por eso acá no hay nada que hacer.
 *
 * ## El alcance del vínculo automático
 *
 * Se busca **en la red del dueño del canal**, no en el padrón entero. Un número
 * de WhatsApp del cajero Pérez no puede vincular a un jugador de otra red: sería
 * abrirle la billetera de alguien que no es suyo. Lo acota `jugadoresConEseTelefono`.
 *
 * ## La idempotencia es más simple que en Telegram
 *
 * El `wamid` es **único global**, no un contador por chat como el `message_id`
 * de Telegram. O sea que alcanza solo, sin agregarle el chat — que fue el bug
 * 2.6. Igual se le pone el prefijo del canal, por si dos canales del mismo
 * casino llegaran a recibir el mismo id (no debería pasar, y el índice único es
 * lo que lo impide de verdad).
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { crmContacts, type CrmChannel } from '@casino/db';
import type { TenantDb } from '../../tenant-resolver/tenant-context';
import { ChatService } from '../chat.service';
import { ChatCrmService } from '../chat-crm.service';
import { UserHierarchyService } from '../../user-hierarchy/user-hierarchy.service';
import { telefonoE164 } from '../telefono';
import { mensajesDelCambio, textoConAdjunto } from './mensajes-de-meta';

/** Lo que se guarda de WhatsApp en `crm_contacts.attributes`. */
interface AtributosDeContacto {
  whatsapp?: { waId: string };
}

@Injectable()
export class WhatsappInboundService {
  private readonly logger = new Logger(WhatsappInboundService.name);

  constructor(
    private readonly chat: ChatService,
    private readonly crm: ChatCrmService,
    private readonly hierarchy: UserHierarchyService,
  ) {}

  /**
   * Procesa un `change` ya guardado como crudo.
   *
   * Tira si algo sale mal: el que llama lo anota en el crudo y sigue. Es al
   * revés que el webhook, que nunca tira — acá el error **sí** tiene dónde
   * quedar registrado, y perderlo sería perder la única pista.
   */
  async procesar(
    db: TenantDb,
    canal: CrmChannel,
    cambio: unknown,
  ): Promise<void> {
    const mensajes = mensajesDelCambio(cambio);
    if (mensajes.length === 0) return;

    // La bandeja del dueño del canal (**D2**). `null` = central, y ahí la
    // conversación se asigna al admin principal — es la traducción inversa de
    // `resolveContactOwner`, y tiene que coincidir con lo que `resolveInboxOwner`
    // le devuelve al staff o la conversación no le aparecería a nadie.
    const owner = canal.ownerUserId;
    const bandeja = owner ?? (await this.hierarchy.getPrimaryAdminUserId(db));
    if (!bandeja) {
      throw new Error('No se pudo resolver la bandeja del canal.');
    }

    for (const msg of mensajes) {
      const contactId = await this.contactoDelNumero(db, {
        telefono: msg.telefono,
        nombre: msg.nombre,
        owner,
        bandeja,
      });

      const conv = await this.chat.getOrCreateOpenConversation(db, {
        contactId,
        channelId: canal.id,
        operatorId: bandeja,
      });

      await this.chat.postMessage(db, {
        conversationId: conv.id,
        direction: 'inbound',
        senderUserId: null,
        // Un mensaje sin texto y sin adjunto no debería existir, pero si llega
        // se guarda igual: perderlo sería peor que mostrar un renglón raro.
        body: textoConAdjunto(msg) || '(mensaje sin texto)',
        attachments: [],
        channelMessageId: `wa:${canal.id}:${msg.id}`,
      });
    }
  }

  /**
   * El contacto de ese número **en esta bandeja** (**D6**), creándolo si hace
   * falta y vinculándolo por **D4** si corresponde.
   *
   * El contacto es por bandeja, no por casino: el mismo humano escribiéndole al
   * WhatsApp del cajero y al del casino son **dos fichas**, que pueden apuntar
   * al mismo jugador. Lo que se comparte es el jugador, no la conversación.
   */
  private async contactoDelNumero(
    db: TenantDb,
    params: {
      telefono: string;
      nombre: string | null;
      owner: string | null;
      bandeja: string;
    },
  ): Promise<string> {
    const existente = (
      await db
        .select({ id: crmContacts.id })
        .from(crmContacts)
        .where(
          and(
            sql`${crmContacts.attributes} -> 'whatsapp' ->> 'waId' = ${params.telefono}`,
            params.owner === null
              ? sql`${crmContacts.ownerUserId} IS NULL`
              : eq(crmContacts.ownerUserId, params.owner),
          ),
        )
        .limit(1)
    )[0];
    if (existente) return existente.id;

    // ── D4, al crear ────────────────────────────────────────────────────────
    //
    // Se intenta **una sola vez**, cuando el contacto nace. Reintentarlo en cada
    // mensaje pisaría un desvínculo hecho a mano: el operador que apretó "no es
    // esta persona" lo vería volver solo en el mensaje siguiente, que es
    // exactamente lo que la tercera defensa viene a permitir.
    const jugadorId = await this.aQuienVincular(db, params);

    const creado = (
      await db
        .insert(crmContacts)
        .values({
          ownerUserId: params.owner,
          displayName: params.nombre,
          // En E.164 para mostrar y guardar. El número crudo de Meta queda en
          // `attributes.whatsapp.waId`, que es con lo que se lo vuelve a
          // encontrar — ése no se normaliza porque es la llave de Meta, no un
          // teléfono para comparar.
          phone: telefonoE164(params.telefono) ?? params.telefono,
          userId: jugadorId,
          isLead: jugadorId === null,
          attributes: {
            whatsapp: { waId: params.telefono },
          } satisfies AtributosDeContacto,
        })
        .returning({ id: crmContacts.id })
    )[0]!;

    if (jugadorId) {
      this.logger.log(
        `WhatsApp: contacto ${creado.id} vinculado solo al jugador ${jugadorId} (D4).`,
      );
    }
    return creado.id;
  }

  /**
   * A qué jugador vincular este número, o `null`.
   *
   * **La segunda defensa de D4 vive en el `length !== 1`** y no es un detalle de
   * implementación: es la diferencia entre mostrar el nombre equivocado y no
   * mostrar ninguno. `users.phone` no tiene índice único, así que dos jugadores
   * pueden compartir número de verdad.
   *
   * Un fallo de la búsqueda tampoco vincula: ante cualquier duda, lead. Y no
   * puede voltear el mensaje — perder lo que alguien escribió porque no se pudo
   * resolver a quién pertenece sería cambiar un dato de más por un dato de
   * menos.
   */
  private async aQuienVincular(
    db: TenantDb,
    params: { telefono: string; bandeja: string },
  ): Promise<string | null> {
    try {
      const candidatos = await this.crm.jugadoresConEseTelefono(db, {
        telefono: params.telefono,
        // El alcance: la red del dueño del canal. Un número del cajero Pérez no
        // puede vincular a un jugador de otra red.
        solicitanteId: params.bandeja,
      });
      if (candidatos.length !== 1) {
        if (candidatos.length > 1) {
          this.logger.warn(
            `WhatsApp: ${candidatos.length} jugadores con el teléfono que ` +
              'escribió. No se vincula ninguno (D4, segunda defensa).',
          );
        }
        return null;
      }
      return candidatos[0]!.id;
    } catch (err) {
      this.logger.warn(
        `WhatsApp: no se pudo buscar el jugador del teléfono: ${(err as Error).message}`,
      );
      return null;
    }
  }
}
