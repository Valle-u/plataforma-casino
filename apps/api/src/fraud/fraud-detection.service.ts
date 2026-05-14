/**
 * FraudDetectionService — detección de cuentas múltiples (doc 15 §D).
 *
 * MVP scope:
 *   - Scanner `shared_ip`: pares de users que comparten IP en
 *     `user_sessions` recientes.
 *   - Scanner `similar_email`: pares con Levenshtein <= N en local part
 *     del email + mismo dominio.
 *
 * Pipeline `runScan`:
 *   1. Corre scanners → lista de "raw signals" (user, signal_type,
 *      payload, weight) + lista de "raw pairs" (userA, userB, signal).
 *   2. DELETE all `fraud_signals` + INSERT batch fresh.
 *   3. UPSERT `fraud_account_links`: agrega signals al par, recalcula
 *      score (cap 100), mantiene `status='dismissed'` si existía
 *      (no re-flagear lo que admin descartó).
 *
 * Clusters: NO tabla — se computan on-demand vía union-find sobre links
 * con `status IN ('suspected','confirmed')`. `getClusters()` retorna
 * componentes conexas.
 *
 * Helper `isUserFlagged(userId)`: true si user pertenece a un link
 * `confirmed` o `suspected` con score >= 70. Útil para que liga/sorteos
 * lo excluyan (sprint próximo wirea).
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNotNull, or, sql } from 'drizzle-orm';
import {
  fraudAccountLinks,
  fraudSignals,
  userSessions,
  users,
  type FraudAccountLink,
  type NewFraudAccountLink,
  type NewFraudSignal,
} from '@casino/db';
import { NotificationsService } from '../notifications/notifications.service';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';
import { levenshtein } from './levenshtein';
import {
  FraudLinkAlreadyResolvedError,
  FraudLinkNotFoundError,
} from './fraud.errors';

/** Pesos de cada tipo de signal en el score per par (0-100). */
const SIGNAL_WEIGHTS: Record<string, number> = {
  shared_ip: 30,
  similar_email: 40,
};

/**
 * Threshold default para considerar un link "suspected". Configurable
 * por tenant via setting `fraud.suspected_threshold`.
 */
const DEFAULT_SUSPECTED_THRESHOLD = 70;

/**
 * Threshold default para bloqueo automático de welcome bonus (doc §D3).
 * Configurable por tenant via setting `fraud.welcome_block_threshold`.
 */
const DEFAULT_WELCOME_BLOCK_THRESHOLD = 90;

/** Keys de settings (constantes documentadas). */
export const FRAUD_SETTINGS_KEYS = {
  SUSPECTED_THRESHOLD: 'fraud.suspected_threshold',
  WELCOME_BLOCK_THRESHOLD: 'fraud.welcome_block_threshold',
} as const;

/** Ventana en días para considerar IPs compartidas en sesiones. */
const SHARED_IP_WINDOW_DAYS = 30;

/** Distancia máxima Levenshtein en local part del email para flagear. */
const EMAIL_LEVENSHTEIN_THRESHOLD = 2;

interface RawSignal {
  userId: string;
  signalType: string;
  payload: Record<string, unknown>;
  weight: number;
}

interface RawPair {
  userA: string;
  userB: string;
  signalType: string;
  weight: number;
  payload: Record<string, unknown>;
}

export interface ScanResult {
  signalsCreated: number;
  pairsProcessed: number;
  newSuspectedLinks: number;
  preservedDismissedLinks: number;
}

export interface ClusterView {
  userIds: string[];
  size: number;
  maxScore: number;
  status: 'suspected' | 'confirmed' | 'mixed';
}

@Injectable()
export class FraudDetectionService {
  private readonly logger = new Logger(FraudDetectionService.name);

  constructor(
    private readonly settings: TenantSettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Lee el threshold "suspected" del tenant. Si no está configurado,
   * usa el default 70.
   */
  private async getSuspectedThreshold(db: TenantDb): Promise<number> {
    return this.settings.getNumeric(
      db,
      FRAUD_SETTINGS_KEYS.SUSPECTED_THRESHOLD,
      DEFAULT_SUSPECTED_THRESHOLD,
    );
  }

  /**
   * Lee el threshold "welcome_block" del tenant. Default 90.
   */
  private async getWelcomeBlockThreshold(db: TenantDb): Promise<number> {
    return this.settings.getNumeric(
      db,
      FRAUD_SETTINGS_KEYS.WELCOME_BLOCK_THRESHOLD,
      DEFAULT_WELCOME_BLOCK_THRESHOLD,
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // Scan pipeline
  // ──────────────────────────────────────────────────────────────────────

  async runScan(db: TenantDb): Promise<ScanResult> {
    const signals: RawSignal[] = [];
    const pairs: RawPair[] = [];

    // 1. Scanner: shared IPs.
    const ipResult = await this.scanSharedIPs(db);
    signals.push(...ipResult.signals);
    pairs.push(...ipResult.pairs);

    // 2. Scanner: similar emails.
    const emailResult = await this.scanSimilarEmails(db);
    signals.push(...emailResult.signals);
    pairs.push(...emailResult.pairs);

    // 3. Replace signals (snapshot per scan).
    await db.delete(fraudSignals);
    if (signals.length > 0) {
      const rows: NewFraudSignal[] = signals.map((s) => ({
        userId: s.userId,
        signalType: s.signalType,
        payload: s.payload,
        weight: String(s.weight),
      }));
      // INSERT batch en chunks de 500 para evitar query excesivamente
      // grande con muchos placeholders.
      for (let i = 0; i < rows.length; i += 500) {
        await db.insert(fraudSignals).values(rows.slice(i, i + 500));
      }
    }

    // 4. UPSERT links — agregamos por par, sumamos weights.
    const aggregated = this.aggregatePairs(pairs);
    let newSuspected = 0;
    let preservedDismissed = 0;
    // Acumulamos los IDs de links nuevos para notificar a admins después
    // del loop (1 notif por link nuevo). Evita query de usernames N veces
    // dentro del loop.
    const newLinkIds: string[] = [];
    // Threshold del tenant (con default). Fetch UNA vez antes del loop.
    const suspectedThreshold = await this.getSuspectedThreshold(db);
    for (const [pairKey, info] of aggregated) {
      const [userA, userB] = pairKey.split('|') as [string, string];
      const score = Math.min(100, info.totalWeight);

      // Upsert preservando dismissed.
      const existing = await db
        .select()
        .from(fraudAccountLinks)
        .where(
          and(
            eq(fraudAccountLinks.userAId, userA),
            eq(fraudAccountLinks.userBId, userB),
          ),
        )
        .limit(1);

      if (existing[0]) {
        const newStatus =
          existing[0].status === 'dismissed' || existing[0].status === 'confirmed'
            ? existing[0].status
            : score >= suspectedThreshold
            ? 'suspected'
            : 'suspected'; // siempre suspected si pasa el threshold
        if (existing[0].status === 'dismissed') preservedDismissed += 1;
        await db
          .update(fraudAccountLinks)
          .set({
            score: String(score),
            signals: info.signals,
            status: newStatus,
            lastUpdatedAt: new Date(),
          })
          .where(eq(fraudAccountLinks.id, existing[0].id))
          .returning({ id: fraudAccountLinks.id });
      } else {
        // Solo insertamos si supera threshold — no llenamos la tabla
        // con pares de bajo score que no aportan a la decisión.
        if (score < suspectedThreshold) continue;
        const row: NewFraudAccountLink = {
          userAId: userA,
          userBId: userB,
          score: String(score),
          signals: info.signals,
          status: 'suspected',
          lastUpdatedAt: new Date(),
        };
        const inserted = await db
          .insert(fraudAccountLinks)
          .values(row)
          .returning({ id: fraudAccountLinks.id });
        if (inserted[0]) newLinkIds.push(inserted[0].id);
        newSuspected += 1;
      }
    }

    // 5. Notif a admins por cada link nuevo. Fail-soft global —
    // si la lookup o el enqueue tiran, NO abortamos el scan
    // (que ya terminó OK). Patrón: log + continuar.
    if (newLinkIds.length > 0) {
      try {
        await this.notifyAdminsNewSuspectedLinks(db, newLinkIds);
      } catch (err) {
        this.logger.error(
          `Notif fraud_link_suspected batch falló: ${(err as Error).message}`,
        );
      }
    }

    return {
      signalsCreated: signals.length,
      pairsProcessed: aggregated.size,
      newSuspectedLinks: newSuspected,
      preservedDismissedLinks: preservedDismissed,
    };
  }

  /**
   * Para cada link nuevo (status='suspected'), notifica a todos los
   * `admin_tenant` (in_app + email). Hace 1 query batch para los
   * usernames de todos los users involucrados.
   */
  private async notifyAdminsNewSuspectedLinks(
    db: TenantDb,
    linkIds: string[],
  ): Promise<void> {
    // Cargar links + signals + scores.
    const links = await db
      .select({
        id: fraudAccountLinks.id,
        userAId: fraudAccountLinks.userAId,
        userBId: fraudAccountLinks.userBId,
        score: fraudAccountLinks.score,
        signals: fraudAccountLinks.signals,
      })
      .from(fraudAccountLinks)
      .where(inArray(fraudAccountLinks.id, linkIds));

    // Batch lookup de usernames — recolectamos todos los user_ids
    // distintos primero.
    const userIds = new Set<string>();
    for (const l of links) {
      userIds.add(l.userAId);
      userIds.add(l.userBId);
    }
    const usernameRows = await db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(inArray(users.id, Array.from(userIds)));
    const usernameMap = new Map<string, string>(
      usernameRows.map((r) => [r.id, r.username]),
    );

    for (const link of links) {
      // Extraer tipos de signals (e.g. ["shared_ip", "similar_email"])
      // del jsonb. Defensivo si la estructura es inesperada.
      const sigArr = Array.isArray(link.signals)
        ? (link.signals as Array<{ signalType?: string }>)
            .map((s) => s.signalType)
            .filter((s): s is string => typeof s === 'string')
        : [];

      for (const channel of ['in_app', 'email'] as const) {
        try {
          await this.notifications.enqueueForRole(db, {
            roleCode: 'admin_tenant',
            kind: 'fraud_link_suspected',
            channel,
            payload: {
              linkId: link.id,
              score: Number(link.score),
              userAUsername: usernameMap.get(link.userAId) ?? '?',
              userBUsername: usernameMap.get(link.userBId) ?? '?',
              signals: sigArr,
            },
          });
        } catch (err) {
          this.logger.error(
            `Notif fraud_link_suspected (${channel}) link=${link.id} falló: ${(err as Error).message}`,
          );
        }
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Scanners individuales
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Lista usuarios que comparten IP en los últimos N días. Para cada IP
   * con >1 user, genera signal por user y un pair por cada combinación
   * de pares dentro del grupo.
   */
  async scanSharedIPs(
    db: TenantDb,
  ): Promise<{ signals: RawSignal[]; pairs: RawPair[] }> {
    const cutoff = new Date(Date.now() - SHARED_IP_WINDOW_DAYS * 24 * 3600 * 1000);

    // Agrupar por IP, traer array de user_ids distintos.
    const rows = await db
      .select({
        ip: userSessions.ip,
        userIds: sql<string[]>`array_agg(DISTINCT ${userSessions.userId})`,
        n: sql<number>`count(DISTINCT ${userSessions.userId})::int`,
      })
      .from(userSessions)
      .where(
        and(
          isNotNull(userSessions.ip),
          gte(userSessions.createdAt, cutoff),
        ),
      )
      .groupBy(userSessions.ip)
      .having(sql`count(DISTINCT ${userSessions.userId}) > 1`);

    const signals: RawSignal[] = [];
    const pairs: RawPair[] = [];
    const weight = SIGNAL_WEIGHTS.shared_ip!;

    for (const row of rows) {
      const userIds = row.userIds;
      const ip = row.ip!;

      // Signal per user — payload incluye los otros users del grupo.
      for (const uid of userIds) {
        const others = userIds.filter((x) => x !== uid);
        signals.push({
          userId: uid,
          signalType: 'shared_ip',
          payload: { ip, otherUserIds: others },
          weight,
        });
      }

      // Pares: combinaciones C(n,2) dentro del grupo.
      for (let i = 0; i < userIds.length; i += 1) {
        for (let j = i + 1; j < userIds.length; j += 1) {
          const [a, b] = this.canonicalPair(userIds[i]!, userIds[j]!);
          pairs.push({
            userA: a,
            userB: b,
            signalType: 'shared_ip',
            weight,
            payload: { ip },
          });
        }
      }
    }

    return { signals, pairs };
  }

  /**
   * Encuentra pares de users con email similar (Levenshtein <= N en la
   * local part) Y mismo dominio. O(N²) sobre lista de emails — para MVP
   * es OK con <10k users. Para más: bucketing por primera letra o
   * Postgres fuzzystrmatch.
   */
  async scanSimilarEmails(
    db: TenantDb,
  ): Promise<{ signals: RawSignal[]; pairs: RawPair[] }> {
    const userRows = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(isNotNull(users.email));

    const signals: RawSignal[] = [];
    const pairs: RawPair[] = [];
    const weight = SIGNAL_WEIGHTS.similar_email!;

    // Pre-parse emails por dominio para acotar comparaciones.
    const byDomain = new Map<string, Array<{ id: string; local: string; full: string }>>();
    for (const u of userRows) {
      if (!u.email) continue;
      const at = u.email.lastIndexOf('@');
      if (at < 0) continue;
      const local = u.email.slice(0, at).toLowerCase();
      const domain = u.email.slice(at + 1).toLowerCase();
      if (!byDomain.has(domain)) byDomain.set(domain, []);
      byDomain.get(domain)!.push({ id: u.id, local, full: u.email });
    }

    for (const [, group] of byDomain) {
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          const a = group[i]!;
          const b = group[j]!;
          const dist = levenshtein(a.local, b.local);
          if (dist > EMAIL_LEVENSHTEIN_THRESHOLD) continue;
          if (dist === 0) continue; // igual exacto — no es "similar", es duplicado
          // (en MVP no chequeamos email UNIQUE — el schema tampoco lo
          // exige a nivel db por user.email NULLABLE, pero usually UNIQUE
          // por tenant. Si distance=0 es porque hay un bug; lo ignoramos
          // por simplicidad).

          signals.push({
            userId: a.id,
            signalType: 'similar_email',
            payload: { otherUserId: b.id, distance: dist, otherEmail: b.full },
            weight,
          });
          signals.push({
            userId: b.id,
            signalType: 'similar_email',
            payload: { otherUserId: a.id, distance: dist, otherEmail: a.full },
            weight,
          });

          const [pa, pb] = this.canonicalPair(a.id, b.id);
          pairs.push({
            userA: pa,
            userB: pb,
            signalType: 'similar_email',
            weight,
            payload: { distance: dist, emails: [a.full, b.full] },
          });
        }
      }
    }

    return { signals, pairs };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Queries
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Lista todos los links activos (suspected o confirmed) ordenados por
   * score DESC. Para el panel "Antifraude".
   */
  async listActiveLinks(
    db: TenantDb,
    minScore?: number,
  ): Promise<FraudAccountLink[]> {
    const threshold = minScore ?? (await this.getSuspectedThreshold(db));
    return db
      .select()
      .from(fraudAccountLinks)
      .where(
        and(
          or(
            eq(fraudAccountLinks.status, 'suspected'),
            eq(fraudAccountLinks.status, 'confirmed'),
          )!,
          gte(fraudAccountLinks.score, String(threshold)),
        ),
      )
      .orderBy(desc(fraudAccountLinks.score));
  }

  /**
   * Computa clusters via union-find sobre links activos. Devuelve
   * grupos de user_ids conectados.
   */
  async getClusters(db: TenantDb): Promise<ClusterView[]> {
    const links = await this.listActiveLinks(db);
    if (links.length === 0) return [];

    // Union-find.
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      let p = parent.get(x) ?? x;
      while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p;
      parent.set(x, p);
      return p;
    };
    const union = (a: string, b: string): void => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };

    for (const l of links) {
      union(l.userAId, l.userBId);
    }

    // Agrupar por root.
    const groups = new Map<string, FraudAccountLink[]>();
    for (const l of links) {
      const root = find(l.userAId);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(l);
    }

    const clusters: ClusterView[] = [];
    for (const [, groupLinks] of groups) {
      const userSet = new Set<string>();
      let maxScore = 0;
      let allConfirmed = true;
      let allSuspected = true;
      for (const l of groupLinks) {
        userSet.add(l.userAId);
        userSet.add(l.userBId);
        if (Number(l.score) > maxScore) maxScore = Number(l.score);
        if (l.status !== 'confirmed') allConfirmed = false;
        if (l.status !== 'suspected') allSuspected = false;
      }
      const status: ClusterView['status'] = allConfirmed
        ? 'confirmed'
        : allSuspected
        ? 'suspected'
        : 'mixed';
      clusters.push({
        userIds: Array.from(userSet).sort(),
        size: userSet.size,
        maxScore,
        status,
      });
    }

    // Orden: por maxScore DESC.
    return clusters.sort((a, b) => b.maxScore - a.maxScore);
  }

  async findLinkById(db: TenantDb, id: string): Promise<FraudAccountLink> {
    const rows = await db
      .select()
      .from(fraudAccountLinks)
      .where(eq(fraudAccountLinks.id, id))
      .limit(1);
    if (!rows[0]) throw new FraudLinkNotFoundError(id);
    return rows[0];
  }

  async confirmLink(
    db: TenantDb,
    id: string,
    actorUserId: string,
  ): Promise<FraudAccountLink> {
    const link = await this.findLinkById(db, id);
    if (link.status !== 'suspected') {
      throw new FraudLinkAlreadyResolvedError(id, link.status);
    }
    const updated = await db
      .update(fraudAccountLinks)
      .set({
        status: 'confirmed',
        reviewedByUserId: actorUserId,
        reviewedAt: new Date(),
        lastUpdatedAt: new Date(),
      })
      .where(eq(fraudAccountLinks.id, id))
      .returning();
    return updated[0]!;
  }

  async dismissLink(
    db: TenantDb,
    id: string,
    actorUserId: string,
  ): Promise<FraudAccountLink> {
    const link = await this.findLinkById(db, id);
    if (link.status !== 'suspected') {
      throw new FraudLinkAlreadyResolvedError(id, link.status);
    }
    const updated = await db
      .update(fraudAccountLinks)
      .set({
        status: 'dismissed',
        reviewedByUserId: actorUserId,
        reviewedAt: new Date(),
        lastUpdatedAt: new Date(),
      })
      .where(eq(fraudAccountLinks.id, id))
      .returning();
    return updated[0]!;
  }

  /**
   * Criterio MÁS ESTRICTO que `isUserFlagged`: true SOLO si el user
   * pertenece a un link `confirmed` con score >= minScore (default 90).
   *
   * Usado por bonos auto-grant para bloquear welcome/reload a cuentas
   * en clusters de duplicado CONFIRMADOS por admin (doc 15 §D3:
   * "> 90 → bloqueo opcional automático de bono welcome").
   *
   * Diferencia con `isUserFlagged`:
   *   - status: SOLO confirmed (no suspected — admin debe haberlo
   *     revisado para evitar bloqueos por false positives).
   *   - minScore: 90 default (vs 70 — más estricto).
   */
  async isUserInConfirmedHighRiskCluster(
    db: TenantDb,
    userId: string,
    minScore?: number,
  ): Promise<boolean> {
    const threshold = minScore ?? (await this.getWelcomeBlockThreshold(db));
    const rows = await db
      .select({ id: fraudAccountLinks.id })
      .from(fraudAccountLinks)
      .where(
        and(
          or(
            eq(fraudAccountLinks.userAId, userId),
            eq(fraudAccountLinks.userBId, userId),
          )!,
          eq(fraudAccountLinks.status, 'confirmed'),
          gte(fraudAccountLinks.score, String(threshold)),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Batch version de `isUserFlagged`: devuelve el Set de user_ids
   * flageados (en algún link suspected/confirmed con score >=
   * threshold). Una sola query, ideal para filter masivos
   * (e.g. LeaguesService.recompute filtra standings).
   */
  async getFlaggedUserIds(
    db: TenantDb,
    minScore?: number,
  ): Promise<Set<string>> {
    const threshold = minScore ?? (await this.getSuspectedThreshold(db));
    const rows = await db
      .select({
        userAId: fraudAccountLinks.userAId,
        userBId: fraudAccountLinks.userBId,
      })
      .from(fraudAccountLinks)
      .where(
        and(
          or(
            eq(fraudAccountLinks.status, 'suspected'),
            eq(fraudAccountLinks.status, 'confirmed'),
          )!,
          gte(fraudAccountLinks.score, String(threshold)),
        ),
      );
    const set = new Set<string>();
    for (const r of rows) {
      set.add(r.userAId);
      set.add(r.userBId);
    }
    return set;
  }

  /**
   * `true` si el user pertenece a un link `suspected` o `confirmed` con
   * score >= threshold. Usado por liga/sorteos para excluir cuentas
   * marcadas (sprint próximo wirea esto).
   */
  async isUserFlagged(
    db: TenantDb,
    userId: string,
    minScore?: number,
  ): Promise<boolean> {
    const threshold = minScore ?? (await this.getSuspectedThreshold(db));
    const rows = await db
      .select({ id: fraudAccountLinks.id })
      .from(fraudAccountLinks)
      .where(
        and(
          or(
            eq(fraudAccountLinks.userAId, userId),
            eq(fraudAccountLinks.userBId, userId),
          )!,
          or(
            eq(fraudAccountLinks.status, 'suspected'),
            eq(fraudAccountLinks.status, 'confirmed'),
          )!,
          gte(fraudAccountLinks.score, String(threshold)),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Cuenta total de signals + links por status (para KPIs admin).
   */
  async stats(db: TenantDb): Promise<{
    totalSignals: number;
    suspectedLinks: number;
    confirmedLinks: number;
    dismissedLinks: number;
  }> {
    const [signalsRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(fraudSignals);

    const [suspectedRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(fraudAccountLinks)
      .where(eq(fraudAccountLinks.status, 'suspected'));

    const [confirmedRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(fraudAccountLinks)
      .where(eq(fraudAccountLinks.status, 'confirmed'));

    const [dismissedRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(fraudAccountLinks)
      .where(eq(fraudAccountLinks.status, 'dismissed'));

    return {
      totalSignals: signalsRow?.count ?? 0,
      suspectedLinks: suspectedRow?.count ?? 0,
      confirmedLinks: confirmedRow?.count ?? 0,
      dismissedLinks: dismissedRow?.count ?? 0,
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────

  /** Devuelve el par ordenado lexicográficamente (UUID string). */
  private canonicalPair(a: string, b: string): [string, string] {
    return a < b ? [a, b] : [b, a];
  }

  /**
   * Agrupa raw pairs por (userA, userB). Para cada par único, suma
   * weights de signal types DISTINTOS — una IP compartida solo aporta
   * 30 una vez al par, aunque haya 5 sesiones distintas con esa IP.
   */
  private aggregatePairs(
    rawPairs: RawPair[],
  ): Map<string, { totalWeight: number; signals: Array<{ type: string; weight: number; payload?: Record<string, unknown> }> }> {
    const aggregated = new Map<
      string,
      {
        totalWeight: number;
        seenTypes: Set<string>;
        signals: Array<{ type: string; weight: number; payload?: Record<string, unknown> }>;
      }
    >();

    for (const p of rawPairs) {
      const key = `${p.userA}|${p.userB}`;
      if (!aggregated.has(key)) {
        aggregated.set(key, {
          totalWeight: 0,
          seenTypes: new Set(),
          signals: [],
        });
      }
      const entry = aggregated.get(key)!;
      if (entry.seenTypes.has(p.signalType)) continue; // dedupe by type
      entry.seenTypes.add(p.signalType);
      entry.totalWeight += p.weight;
      entry.signals.push({ type: p.signalType, weight: p.weight, payload: p.payload });
    }

    return new Map(
      Array.from(aggregated.entries()).map(([k, v]) => [
        k,
        { totalWeight: v.totalWeight, signals: v.signals },
      ]),
    );
  }

}
