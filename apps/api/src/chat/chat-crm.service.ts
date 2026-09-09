/**
 * ChatCrmService — datos "CRM" del contacto para la bandeja del operador:
 * contexto del jugador (identidad + saldo + upline + últimos depósitos/retiros),
 * notas internas y tags. Todo READ-ONLY sobre los flujos existentes (solo lee
 * wallet/deposits/withdrawals) + CRUD sobre las tablas `crm_*`. Ver docs/22 §4.2.
 *
 * Autorización: el operador solo accede a un contacto si es su operador directo
 * (jerarquía) o si tiene una conversación asignada con ese contacto.
 */

import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import {
  crmContactTags,
  crmContacts,
  crmConversations,
  crmNotes,
  crmTags,
  crmTemplates,
  deposits,
  users,
  wallets,
  withdrawals,
  type CrmContact,
  type CrmNote,
  type CrmTag,
  type CrmTemplate,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';

export interface ContactContext {
  contact: {
    id: string;
    userId: string | null;
    displayName: string | null;
    phone: string | null;
    email: string | null;
    isLead: boolean;
  };
  identity: {
    username: string;
    displayName: string | null;
    email: string | null;
    phone: string | null;
    status: string;
    createdAt: Date | null;
  } | null;
  wallet: {
    balance: string;
    bonusBalance: string;
    lockedBalance: string;
    currency: string;
  } | null;
  upline: { operatorId: string; username: string } | null;
  /**
   * De qué red es el jugador, respecto de quien pregunta.
   *
   * `same: false` significa que **no se devolvió la plata**: ni `wallet`, ni
   * los movimientos, ni el `upline`. La pantalla usa `label` para el cartel
   * que pide `D3` ("este jugador es de la red de Litoral").
   *
   * `null` en un lead que todavía no está vinculado a ningún jugador.
   */
  network: { same: boolean; label: string | null } | null;
  recentDeposits: MovementRow[];
  recentWithdrawals: MovementRow[];
}

interface MovementRow {
  id: string;
  amountChips: string;
  amountFiat: string;
  status: string;
  createdAt: Date | null;
}

@Injectable()
export class ChatCrmService {
  constructor(private readonly hierarchy: UserHierarchyService) {}

  /**
   * Verifica que el operador pueda ver el contacto (operador directo del jugador
   * o dueño de una conversación asignada). Devuelve el contacto o tira 403/404.
   */
  async assertAccess(
    db: TenantDb,
    contactId: string,
    operatorId: string,
  ): Promise<CrmContact> {
    const contact = (
      await db
        .select()
        .from(crmContacts)
        .where(eq(crmContacts.id, contactId))
        .limit(1)
    )[0];
    if (!contact) throw new NotFoundException('Contacto no encontrado.');

    if (contact.userId) {
      const parent = await this.hierarchy.getActiveParent(db, contact.userId);
      if (parent?.parentUserId === operatorId) return contact;
    }
    const conv = (
      await db
        .select({ id: crmConversations.id })
        .from(crmConversations)
        .where(
          and(
            eq(crmConversations.contactId, contactId),
            eq(crmConversations.assignedOperatorId, operatorId),
          ),
        )
        .limit(1)
    )[0];
    if (conv) return contact;
    throw new ForbiddenException('No tenés acceso a este contacto.');
  }

  /**
   * Contexto del jugador para la ficha del contacto.
   *
   * ## ⚠️ Lo que este método NO puede devolver
   *
   * **La plata de un jugador de otra red.** La **LEY R6** dice que de una red
   * independiente se ven agregados, no el detalle interno — y el saldo, los
   * depósitos y los retiros de una persona son el detalle más interno que hay.
   * **P1** lo completa: permiso *y* scope, nunca cruzando redes.
   *
   * Hasta el 2026-09-08 esto devolvía todo eso **sin mirar de qué red era el
   * jugador**. En la práctica no filtraba nada porque el ruteo lo hacía
   * inalcanzable: el único canal era el widget web y las conversaciones de un
   * jugador independiente van siempre a su operador directo, nunca a la bandeja
   * central.
   *
   * **Pero `D3` abre esa puerta a propósito** — el staff central atiende a
   * quien le escriba al número del casino, sea de la red que sea. Por eso esto
   * es **requisito del primer canal externo**, no una mejora para después.
   *
   * ## Lo que SÍ se devuelve de otra red
   *
   * Quién es y de qué red viene (`D3`), para poder responderle y avisarle a su
   * operador (`D8`). El `upline` tampoco viaja: el cartel ya dice la red, y
   * *qué operador concreto* lo tiene es detalle interno.
   */
  async getContext(
    db: TenantDb,
    contact: CrmContact,
    solicitanteId: string,
  ): Promise<ContactContext> {
    const base: ContactContext = {
      contact: {
        id: contact.id,
        userId: contact.userId,
        displayName: contact.displayName,
        phone: contact.phone,
        email: contact.email,
        isLead: contact.isLead,
      },
      identity: null,
      wallet: null,
      upline: null,
      recentDeposits: [],
      recentWithdrawals: [],
      network: null,
    };
    if (!contact.userId) return base; // lead anónimo: solo lo del contacto

    const userId = contact.userId;
    const [identity, parent, red] = await Promise.all([
      db
        .select({
          username: users.username,
          displayName: users.displayName,
          email: users.email,
          phone: users.phone,
          status: users.status,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),
      this.hierarchy.getActiveParent(db, userId),
      this.redDelJugador(db, userId, solicitanteId),
    ]);

    base.identity = identity[0] ?? null;
    base.network = red;

    // Otra red: hasta acá llega. Las consultas de plata NI SE CORREN — no
    // alcanza con no devolver el dato si igual se trajo: lo que no se lee no se
    // puede filtrar por descuido en un log o en un campo nuevo.
    if (!red.same) return base;

    const [wallet, dep, wd] = await Promise.all([
      db
        .select({
          balance: wallets.balance,
          bonusBalance: wallets.bonusBalance,
          lockedBalance: wallets.lockedBalance,
          currency: wallets.currency,
        })
        .from(wallets)
        .where(eq(wallets.userId, userId))
        .limit(1),
      db
        .select({
          id: deposits.id,
          amountChips: deposits.amountChips,
          amountFiat: deposits.amountFiat,
          status: deposits.status,
          createdAt: deposits.createdAt,
        })
        .from(deposits)
        .where(eq(deposits.userId, userId))
        .orderBy(desc(deposits.createdAt))
        .limit(5),
      db
        .select({
          id: withdrawals.id,
          amountChips: withdrawals.amountChips,
          amountFiat: withdrawals.amountFiat,
          status: withdrawals.status,
          createdAt: withdrawals.createdAt,
        })
        .from(withdrawals)
        .where(eq(withdrawals.userId, userId))
        .orderBy(desc(withdrawals.createdAt))
        .limit(5),
    ]);

    base.wallet = wallet[0] ?? null;
    base.recentDeposits = dep;
    base.recentWithdrawals = wd;

    if (parent?.parentUserId) {
      const op = (
        await db
          .select({ username: users.username })
          .from(users)
          .where(eq(users.id, parent.parentUserId))
          .limit(1)
      )[0];
      base.upline = op
        ? { operatorId: parent.parentUserId, username: op.username }
        : null;
    }
    return base;
  }

  /**
   * ¿Están el jugador y quien pregunta en la misma red?
   *
   * Se compara la **rama independiente** de cada uno —`null` para la red
   * central y la dependiente— con la misma función que usa el ruteo
   * (`CrmNetworkService.classify`), para que visibilidad y ruteo no puedan
   * discrepar.
   *
   * Los tres casos:
   *
   * | jugador | quien pregunta | ¿ve la plata? |
   * |---|---|---|
   * | misma rama (o los dos centrales) | — | sí |
   * | rama independiente A | rama B, o staff central | **no** — R6 |
   * | red central | rama independiente | **no** — P1, cruza igual |
   *
   * El tercero no está en `D3` pero se protege igual: si un jugador de la red
   * central le escribe al WhatsApp de un socio independiente, ese socio lo va a
   * atender (`D2`) y **no tiene por qué ver su saldo**.
   *
   * ⚠️ Con redes independientes **anidadas**, esta función hereda el criterio de
   * `getIndependentBranchAncestor`, que no ordena por cercanía. Es a propósito:
   * el mismo criterio que ya usa el ruteo. Si algún día se cambia uno, cambiar
   * los dos.
   */
  private async redDelJugador(
    db: TenantDb,
    jugadorId: string,
    solicitanteId: string,
  ): Promise<{ same: boolean; label: string | null }> {
    const [ramaJugador, ramaSolicitante] = await Promise.all([
      this.hierarchy.getIndependentBranchAncestor(db, jugadorId),
      this.hierarchy.getIndependentBranchAncestor(db, solicitanteId),
    ]);

    // Cubre los dos casos de "misma red": la misma rama independiente, o los
    // dos sin rama (central/dependiente, que para la plata es una sola).
    if (ramaJugador === ramaSolicitante) return { same: true, label: null };

    // El jugador es de la red central y pregunta alguien de una independiente.
    // No se nombra la red del casino: no hay nada que aclararle.
    if (!ramaJugador) return { same: false, label: null };

    const socio = (
      await db
        .select({ username: users.username, displayName: users.displayName })
        .from(users)
        .where(eq(users.id, ramaJugador))
        .limit(1)
    )[0];
    return {
      same: false,
      label: socio?.displayName ?? socio?.username ?? null,
    };
  }

  // ── Notas ───────────────────────────────────────────────────────────────
  async listNotes(db: TenantDb, contactId: string): Promise<CrmNote[]> {
    return db
      .select()
      .from(crmNotes)
      .where(eq(crmNotes.contactId, contactId))
      .orderBy(desc(crmNotes.createdAt))
      .limit(100);
  }

  async addNote(
    db: TenantDb,
    contactId: string,
    authorUserId: string,
    body: string,
  ): Promise<CrmNote> {
    const inserted = await db
      .insert(crmNotes)
      .values({ contactId, authorUserId, body })
      .returning();
    return inserted[0]!;
  }

  // ── Tags ────────────────────────────────────────────────────────────────
  /** Catálogo de tags del tenant (predefinidos). */
  async listTagCatalog(db: TenantDb): Promise<CrmTag[]> {
    return db.select().from(crmTags).orderBy(crmTags.label).limit(200);
  }

  async createTag(
    db: TenantDb,
    label: string,
    color: string | null,
  ): Promise<CrmTag> {
    const inserted = await db
      .insert(crmTags)
      .values({ label, color })
      .returning();
    return inserted[0]!;
  }

  /** Tags asignados a un contacto. */
  async listContactTags(db: TenantDb, contactId: string): Promise<CrmTag[]> {
    return db
      .select({
        id: crmTags.id,
        label: crmTags.label,
        color: crmTags.color,
        createdAt: crmTags.createdAt,
      })
      .from(crmContactTags)
      .innerJoin(crmTags, eq(crmTags.id, crmContactTags.tagId))
      .where(eq(crmContactTags.contactId, contactId))
      .orderBy(crmTags.label);
  }

  /** Asigna un tag al contacto (idempotente por el unique contact+tag). */
  async assignTag(
    db: TenantDb,
    contactId: string,
    tagId: string,
    assignedBy: string,
  ): Promise<void> {
    await db
      .insert(crmContactTags)
      .values({ contactId, tagId, assignedBy })
      .onConflictDoNothing();
  }

  async unassignTag(
    db: TenantDb,
    contactId: string,
    tagId: string,
  ): Promise<void> {
    await db
      .delete(crmContactTags)
      .where(
        and(
          eq(crmContactTags.contactId, contactId),
          eq(crmContactTags.tagId, tagId),
        ),
      );
  }

  // ── Plantillas (respuestas rápidas por tenant) ────────────────────────────
  /** Catálogo de plantillas del tenant (predefinidas por el operador/admin). */
  async listTemplates(db: TenantDb): Promise<CrmTemplate[]> {
    return db
      .select()
      .from(crmTemplates)
      .orderBy(crmTemplates.title)
      .limit(200);
  }

  async createTemplate(
    db: TenantDb,
    title: string,
    body: string,
    shortcut: string | null,
  ): Promise<CrmTemplate> {
    const inserted = await db
      .insert(crmTemplates)
      .values({ title, body, shortcut })
      .returning();
    return inserted[0]!;
  }

  async deleteTemplate(db: TenantDb, templateId: string): Promise<void> {
    await db.delete(crmTemplates).where(eq(crmTemplates.id, templateId));
  }
}
