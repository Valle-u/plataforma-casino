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

  /** Contexto del jugador: identidad + saldo + upline + últimos movimientos. */
  async getContext(
    db: TenantDb,
    contact: CrmContact,
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
    };
    if (!contact.userId) return base; // lead anónimo: solo lo del contacto

    const userId = contact.userId;
    const [identity, wallet, dep, wd, parent] = await Promise.all([
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
      this.hierarchy.getActiveParent(db, userId),
    ]);

    base.identity = identity[0] ?? null;
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
