/**
 * ChatService — lógica de dominio del CRM/livechat (Etapa 1).
 *
 * Vive detrás del flag CRM_ENABLED (solo se instancia si el ChatModule se
 * importa). Resuelve la DB del tenant DESDE el socket (el WS corre fuera del
 * middleware HTTP de tenant, así que resolvemos por `tenantId` del token),
 * el operador directo del jugador (por user_hierarchy) y el CRUD de
 * contacts/conversations/messages. Ver docs/22-crm-livechat.md.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import {
  crmChannels,
  crmContacts,
  crmConversations,
  crmMessages,
  tenants,
  type ControlDb,
  type CrmConversation,
  type CrmMessage,
} from '@casino/db';

/** Fila de la bandeja del operador: conversación + datos mínimos del contacto. */
export interface OperatorInboxItem {
  conversation: CrmConversation;
  contact: {
    id: string;
    displayName: string | null;
    userId: string | null;
    isLead: boolean;
    phone: string | null;
  };
}
import { CONTROL_DB } from '../database/database.module';
import { TenantConnectionCache } from '../tenant-resolver/tenant-connection-cache';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';

const WEB_CHANNEL = 'web-livechat';

@Injectable()
export class ChatService {
  constructor(
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly tenantCache: TenantConnectionCache,
    private readonly hierarchy: UserHierarchyService,
  ) {}

  /** DB del tenant a partir del `tenantId` del token del socket (o null). */
  async getTenantDb(tenantId: string): Promise<TenantDb | null> {
    const rows = await this.controlDb
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const tenant = rows[0];
    return tenant ? this.tenantCache.get(tenant) : null;
  }

  /** Operador directo del jugador = su parent inmediato en la jerarquía. */
  async resolveDirectOperator(
    db: TenantDb,
    playerUserId: string,
  ): Promise<string | null> {
    const parent = await this.hierarchy.getActiveParent(db, playerUserId);
    return parent?.parentUserId ?? null;
  }

  /** Canal web del tenant (uno solo). Lo crea si no existe. */
  async getOrCreateWebChannel(db: TenantDb): Promise<string> {
    const existing = await db
      .select({ id: crmChannels.id })
      .from(crmChannels)
      .where(eq(crmChannels.type, WEB_CHANNEL))
      .limit(1);
    if (existing[0]) return existing[0].id;
    const inserted = await db
      .insert(crmChannels)
      .values({ type: WEB_CHANNEL })
      .returning({ id: crmChannels.id });
    return inserted[0]!.id;
  }

  /** Contacto del jugador logueado (crm_contact con user_id). Lo crea si no. */
  async getOrCreateContactForUser(
    db: TenantDb,
    userId: string,
  ): Promise<string> {
    const existing = await db
      .select({ id: crmContacts.id })
      .from(crmContacts)
      .where(eq(crmContacts.userId, userId))
      .limit(1);
    if (existing[0]) return existing[0].id;
    const inserted = await db
      .insert(crmContacts)
      .values({ userId, isLead: false })
      .returning({ id: crmContacts.id });
    return inserted[0]!.id;
  }

  /**
   * Conversación ABIERTA (hilo continuo) del contacto en el canal web. Si no
   * hay una sin resolver, crea una nueva asignada al operador directo.
   */
  async getOrCreateOpenConversation(
    db: TenantDb,
    params: { contactId: string; channelId: string; operatorId: string | null },
  ): Promise<CrmConversation> {
    const open = await db
      .select()
      .from(crmConversations)
      .where(
        and(
          eq(crmConversations.contactId, params.contactId),
          eq(crmConversations.channelId, params.channelId),
          ne(crmConversations.status, 'resolved'),
        ),
      )
      .limit(1);
    if (open[0]) return open[0];
    const inserted = await db
      .insert(crmConversations)
      .values({
        contactId: params.contactId,
        channelId: params.channelId,
        assignedOperatorId: params.operatorId,
        status: 'open',
      })
      .returning();
    return inserted[0]!;
  }

  /**
   * Persiste un mensaje + actualiza la conversación (lastMessageAt + no leídos
   * del receptor). `direction` inbound = del contacto (jugador), outbound = del
   * operador. Devuelve el mensaje insertado.
   */
  async postMessage(
    db: TenantDb,
    params: {
      conversationId: string;
      direction: 'inbound' | 'outbound' | 'system';
      senderUserId: string | null;
      body: string;
      attachments?: unknown[];
    },
  ): Promise<CrmMessage> {
    const inserted = await db
      .insert(crmMessages)
      .values({
        conversationId: params.conversationId,
        direction: params.direction,
        senderUserId: params.senderUserId,
        body: params.body,
        attachments: params.attachments ?? [],
      })
      .returning();
    const msg = inserted[0]!;

    // No leídos del RECEPTOR: si el mensaje es del jugador (inbound) sube el
    // contador del operador; si es del operador (outbound) el del contacto.
    const bump =
      params.direction === 'inbound'
        ? { unreadForOperator: sql`${crmConversations.unreadForOperator} + 1` }
        : params.direction === 'outbound'
          ? { unreadForContact: sql`${crmConversations.unreadForContact} + 1` }
          : {};
    await db
      .update(crmConversations)
      .set({ lastMessageAt: msg.createdAt, updatedAt: new Date(), ...bump })
      .where(eq(crmConversations.id, params.conversationId));

    return msg;
  }

  /** Historial de mensajes de una conversación (más nuevos primero). */
  async listMessages(
    db: TenantDb,
    conversationId: string,
    limit = 50,
  ): Promise<CrmMessage[]> {
    return db
      .select()
      .from(crmMessages)
      .where(eq(crmMessages.conversationId, conversationId))
      .orderBy(desc(crmMessages.createdAt))
      .limit(limit);
  }

  // ── Lado operador ────────────────────────────────────────────────────────

  /**
   * Bandeja del operador: sus conversaciones NO resueltas (open|pending), con
   * los datos mínimos del contacto, ordenadas por actividad reciente. El ruteo
   * "solo el operador directo" ya se aplicó al asignar `assignedOperatorId`; acá
   * solo listamos lo suyo (nunca ve conversaciones de otro operador).
   */
  async listOperatorInbox(
    db: TenantDb,
    operatorId: string,
    limit = 100,
  ): Promise<OperatorInboxItem[]> {
    return db
      .select({
        conversation: crmConversations,
        contact: {
          id: crmContacts.id,
          displayName: crmContacts.displayName,
          userId: crmContacts.userId,
          isLead: crmContacts.isLead,
          phone: crmContacts.phone,
        },
      })
      .from(crmConversations)
      .innerJoin(crmContacts, eq(crmContacts.id, crmConversations.contactId))
      .where(
        and(
          eq(crmConversations.assignedOperatorId, operatorId),
          ne(crmConversations.status, 'resolved'),
        ),
      )
      .orderBy(sql`${crmConversations.lastMessageAt} desc nulls last`)
      .limit(limit);
  }

  /**
   * Conversación SOLO si está asignada a este operador (barrera de autorización
   * para responder/abrir/marcar leído). Devuelve null si no es suya.
   */
  async getConversationForOperator(
    db: TenantDb,
    conversationId: string,
    operatorId: string,
  ): Promise<CrmConversation | null> {
    const rows = await db
      .select()
      .from(crmConversations)
      .where(
        and(
          eq(crmConversations.id, conversationId),
          eq(crmConversations.assignedOperatorId, operatorId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Resetea el contador de no-leídos del operador (cuando abre la conversación). */
  async markReadForOperator(
    db: TenantDb,
    conversationId: string,
  ): Promise<void> {
    await db
      .update(crmConversations)
      .set({ unreadForOperator: 0 })
      .where(eq(crmConversations.id, conversationId));
  }

  // ── Lado jugador (widget) ─────────────────────────────────────────────────

  /**
   * Conversación abierta del jugador (para el widget). FIND-ONLY: no crea nada
   * (así abrir el widget no genera conversaciones vacías; solo `message:send`
   * crea). Devuelve null si el jugador todavía no escribió nunca.
   */
  async findOpenConversationForUser(
    db: TenantDb,
    userId: string,
  ): Promise<CrmConversation | null> {
    const contact = (
      await db
        .select({ id: crmContacts.id })
        .from(crmContacts)
        .where(eq(crmContacts.userId, userId))
        .limit(1)
    )[0];
    if (!contact) return null;
    const open = (
      await db
        .select()
        .from(crmConversations)
        .where(
          and(
            eq(crmConversations.contactId, contact.id),
            ne(crmConversations.status, 'resolved'),
          ),
        )
        .orderBy(sql`${crmConversations.lastMessageAt} desc nulls last`)
        .limit(1)
    )[0];
    return open ?? null;
  }

  /** Resetea el no-leído del jugador (cuando abre/lee el widget). */
  async markReadForContact(
    db: TenantDb,
    conversationId: string,
  ): Promise<void> {
    await db
      .update(crmConversations)
      .set({ unreadForContact: 0 })
      .where(eq(crmConversations.id, conversationId));
  }
}
