/**
 * BranchesService — Sprint 51.
 *
 * Gestiona el flag `is_independent_branch` sobre socios + la operación
 * de "venta de fichas" del tenant al socio independent.
 *
 * Modelo (decidido por dueño 2026-05-20):
 *   - Default: socios son DEPENDENT. Operan contra el banco del tenant
 *     y reciben commissions vía el flujo accrued/settle del Sprint 50.
 *   - Toggle a INDEPENDENT: el socio pasa a operar con su propio banco.
 *     El admin le configura `branchBankAccount` + `branchChipsPricePerUnit`.
 *     Las commissions upstream NO se acumulan (modelo "pago por adelantado":
 *     el socio ya pagó al comprar las fichas al precio mayorista).
 *   - Sell-chips: el admin mintea fichas DIRECTO al wallet del socio
 *     independent con source='branch_chip_sale' y reason que registra
 *     `amountFiat = amountChips * branchChipsPricePerUnit`. El intercambio
 *     real de plata es offline (el socio le transfiere al admin por fuera).
 *
 * Sensibilidad: ambas operaciones (toggle + sell) son admin-only,
 * audit severity:high. NO delegables vía override (gate de permisos).
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import {
  bankTransactions,
  bonusDefinitions,
  deposits,
  fraudAccountLinks,
  roles,
  userPermissionOverrides,
  userRoles,
  users,
  wallets,
  walletTransactions,
  withdrawals,
  type User,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import { WalletService } from '../wallet/wallet.service';
import { HouseNotProvisionedError, HouseService } from '../house/house.service';
import {
  BranchDegradeBlockedError,
  BranchFlipHasPendingRequestsError,
  BranchFlipSamePeriodError,
  BranchInvalidPriceError,
  BranchNotASocioError,
  BranchNotIndependentError,
  BranchPriceNotConfiguredError,
  BranchSocioNotFoundError,
} from './branches.errors';

export interface ToggleIndependenceParams {
  socioId: string;
  /** Quién ejecuta el flip (admin) — actor de los movimientos de fichas. */
  actorUserId: string;
  isIndependent: boolean;
  branchBankAccount?: string | null;
  branchChipsPricePerUnit?: string | null;
  /** Si true, permite degradar aunque haya estado operativo pendiente. */
  force?: boolean;
}

export interface SellChipsParams {
  socioId: string;
  actorUserId: string;
  amountChips: string;
  idempotencyKey: string;
  notes?: string | null;
}

export interface SellChipsResult {
  socioId: string;
  amountChips: string;
  pricePerUnit: string;
  amountFiat: string;
  walletTxId: string;
  newBalance: string;
}

/** Row del listado de sucursales independientes. */
export interface BranchListRow {
  socioId: string;
  username: string;
  displayName: string;
  status: string;
  branchBankAccount: string;
  branchChipsPricePerUnit: string;
  /** Balance actual del wallet del socio (chips). */
  walletBalance: string;
  /** Total de chips vendidas en las últimas 30 días (rolling). */
  chipsSold30d: string;
  /** Equivalente fiat acumulado en las últimas 30 días. */
  fiatSold30d: string;
  /** Última venta (o null si nunca le vendieron). */
  lastSaleAt: Date | null;
}

/** Row del summary de ventas agregado por socio en un rango. */
export interface BranchSalesSummaryRow {
  socioId: string;
  username: string;
  displayName: string;
  branchChipsPricePerUnit: string | null;
  salesCount: number;
  totalChipsSold: string;
  totalFiatSold: string;
  lastSaleAt: Date | null;
}

/** Detalle de una venta puntual en el history. */
export interface BranchSaleEntry {
  walletTxId: string;
  amountChips: string;
  /** Calculado: amountChips * pricePerUnit congelado en la reason. */
  amountFiat: string;
  pricePerUnit: string;
  reason: string | null;
  createdAt: Date;
  createdByUserId: string | null;
  createdByUsername: string | null;
}

/** Info del socio para el endpoint /mine (self-view). */
export interface MyBranchInfo {
  isIndependent: boolean;
  underIndependentBranch: boolean;
  independentBranchOwnerId: string | null;
  bankAccount: string | null;
  pricePerUnit: string | null;
  walletBalance: string;
  totals: {
    chipsSoldAllTime: string;
    fiatSoldAllTime: string;
    salesCount: number;
  };
  recentSales: BranchSaleEntry[];
}

/**
 * Sprint 51.2 + amp. 2026-07: permisos que el socio independiente recibe
 * automáticamente al activar el flag. Le permiten armar su equipo (usuarios +
 * empleados), operar la ficha de sus clientes, aprobar/rechazar sus depósitos
 * y retiros, y gestionar bonos de su red. NO incluye `users.view_all` (que
 * expondría el tenant entero) ni `force_clear` de bonos (destructivo).
 *
 * El socio no queda con `users.view_all` ni con permisos del núcleo del
 * tenant — sigue aislado a su sub-red por el ScopeGuard y por la poda
 * automática de sub-red independiente en el listado del admin.
 */
const INDEPENDENT_BRANCH_AUTO_PERMISSIONS = [
  // Usuarios (armar su red)
  'users.view_any',
  'users.create',
  'users.edit',
  'users.ban',
  'users.export',
  // Wallet / depósitos / retiros: solo lectura acá. Los 7 permisos de MOVER
  // plata (wallet.load/unload, deposits/withdrawals approve/reject/process) NO
  // se otorgan como override — los agrega dinámicamente EffectivePermissions-
  // Service a toda la sub-red independiente (LEYES R3/R4). Ver
  // `INDEPENDENT_OPERATOR_MONEY_PERMISSIONS`.
  'wallet.view_any',
  'deposits.view',
  'withdrawals.view',
  // Capa 3 · Fase 2: el indep maneja su propio extracto bancario.
  // Los endpoints tienen scope check por branchBankAccount, así que estos
  // perms solo le habilitan operar sobre SU cuenta.
  'bank_tx.upload',
  'bank_tx.view',
  'bank_tx.match',
  'bank_tx.edit',
  // Capa 3 · Fase 3: el indep ve/revisa señales antifraude de SU sub-red.
  // El scan (`fraud.run_scan`) queda tenant-global exclusivo del admin.
  // El scope check en el controller garantiza que solo ve links donde
  // ambos users caen dentro de su sub-red.
  'fraud.view',
  'fraud.review',
  // Bonos (ya estaban)
  'bonuses.view',
  'bonuses.view_any',
  'bonuses.create_definition',
  'bonuses.edit_definition',
  'bonuses.grant_manual',
  'bonuses.cancel',
  'bonuses.export',
  'bonuses.export_definitions',
] as const;

@Injectable()
export class BranchesService {
  private readonly logger = new Logger(BranchesService.name);

  constructor(
    private readonly walletService: WalletService,
    private readonly hierarchy: UserHierarchyService,
    private readonly houseService: HouseService,
  ) {}

  /**
   * D3 (docs/17 §14.1): cuenta depósitos/retiros IN-FLIGHT (sin resolver) en la
   * sub-red del socio. Un flip a mitad de camino cambiaría quién banca y dejaría
   * esas solicitudes apuntando a un issuer contradictorio (los depósitos
   * resuelven el issuer al aprobar; los retiros lo congelan al crear). Por eso
   * un flip se BLOQUEA (duro) mientras haya alguna. Aplica a AMBAS direcciones.
   *
   * In-flight = deposits en 'pending'/'under_review' + withdrawals en
   * 'pending'/'approved'/'processing'. La sub-red incluye al socio + descendants.
   */
  private async countInFlightRequests(
    db: TenantDb,
    socioId: string,
  ): Promise<{ depositsPending: number; withdrawalsPending: number }> {
    const subnet = await this.hierarchy.getUserIdsInSubnetwork(db, socioId);
    const ids = Array.from(subnet);
    if (ids.length === 0) {
      return { depositsPending: 0, withdrawalsPending: 0 };
    }

    const depRows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(deposits)
      .where(
        and(
          inArray(deposits.userId, ids),
          inArray(deposits.status, ['pending', 'under_review']),
        ),
      );
    const wRows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(withdrawals)
      .where(
        and(
          inArray(withdrawals.userId, ids),
          inArray(withdrawals.status, ['pending', 'approved', 'processing']),
        ),
      );

    return {
      depositsPending: depRows[0]?.n ?? 0,
      withdrawalsPending: wRows[0]?.n ?? 0,
    };
  }

  /**
   * D3 (docs/17 §14.2): `base` del buy-back dep→indep = Σ saldos en circulación
   * de la sub-red del socio (sus descendientes), EXCLUYENDO cualquier sub-red
   * independiente anidada (la banca su propio socio, no éste — mismo criterio
   * que el engine de comisiones). NO incluye el wallet del propio socio (un
   * dependiente no tiene stock). Devuelve la cantidad de fichas (string).
   */
  private async computeSubnetCirculatingBase(
    db: TenantDb,
    socioId: string,
  ): Promise<string> {
    const descendants = await this.hierarchy.getActiveDescendants(db, socioId);
    if (descendants.length === 0) return '0';
    const nestedIndep = await this.hierarchy.getIndependentSubtreeIds(db);
    const ids = descendants.filter((id) => !nestedIndep.has(id));
    if (ids.length === 0) return '0';
    const rows = await db
      .select({
        total: sql<string>`COALESCE(SUM(${wallets.balance}), 0)::text`,
      })
      .from(wallets)
      .where(inArray(wallets.userId, ids));
    return rows[0]?.total ?? '0';
  }

  /**
   * Cuenta los items operativos activos que quedarían visibles para el
   * admin si se degrada el socio indep a dependent. Usado por
   * toggleIndependence en modo safe-by-default.
   *
   * Categorías (deben coincidir con los filtros de aislamiento de
   * Capa 3):
   *  - bank_txs unmatched en la cuenta del socio
   *  - bonus_definitions con status='active' creadas por el socio
   *  - fraud_links con status suspected/confirmed donde ambos users
   *    caen en la sub-red del socio (owner + descendants recursivos)
   */
  private async countPendingForDegradation(
    db: TenantDb,
    user: User,
  ): Promise<{
    bankTxsUnmatched: number;
    bonusDefsActive: number;
    fraudLinksUnresolved: number;
  }> {
    // 1) Bank txs unmatched en su cuenta bancaria.
    let bankTxsUnmatched = 0;
    if (user.branchBankAccount && user.branchBankAccount.trim() !== '') {
      const rows = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(bankTransactions)
        .where(
          and(
            eq(bankTransactions.bankAccount, user.branchBankAccount),
            eq(bankTransactions.status, 'unmatched'),
          ),
        );
      bankTxsUnmatched = rows[0]?.n ?? 0;
    }

    // 2) Bonus definitions activas creadas por él.
    const defRows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(bonusDefinitions)
      .where(
        and(
          eq(bonusDefinitions.createdByUserId, user.id),
          eq(bonusDefinitions.status, 'active'),
        ),
      );
    const bonusDefsActive = defRows[0]?.n ?? 0;

    // 3) Fraud links sin resolver dentro de su sub-red (ambos users).
    const subnet = await this.hierarchy.getUserIdsInSubnetwork(db, user.id);
    let fraudLinksUnresolved = 0;
    if (subnet.size > 0) {
      const ids = Array.from(subnet);
      const linkRows = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(fraudAccountLinks)
        .where(
          and(
            or(
              eq(fraudAccountLinks.status, 'suspected'),
              eq(fraudAccountLinks.status, 'confirmed'),
            ),
            inArray(fraudAccountLinks.userAId, ids),
            inArray(fraudAccountLinks.userBId, ids),
          ),
        );
      fraudLinksUnresolved = linkRows[0]?.n ?? 0;
    }

    return { bankTxsUnmatched, bonusDefsActive, fraudLinksUnresolved };
  }

  /**
   * Activa/desactiva el modo sucursal independiente para un socio.
   *
   * - Valida que el user existe y tiene rol 'socio'.
   * - Si isIndependent=true: branchBankAccount y branchChipsPricePerUnit
   *   son obligatorios y se persisten.
   * - Si isIndependent=false: limpia los dos campos.
   */
  async toggleIndependence(
    db: TenantDb,
    params: ToggleIndependenceParams,
  ): Promise<User> {
    const user = await this.assertSocio(db, params.socioId);

    if (params.isIndependent) {
      if (!params.branchBankAccount) {
        throw new BranchInvalidPriceError('branchBankAccount es obligatorio');
      }
      if (!params.branchChipsPricePerUnit) {
        throw new BranchInvalidPriceError('branchChipsPricePerUnit es obligatorio');
      }
      this.assertPriceValid(params.branchChipsPricePerUnit);
    }

    // D3 (docs/17 §14.1): bloqueo DURO de flip con solicitudes IN-FLIGHT en la
    // sub-red (ambas direcciones, NO bypasseable con force). Solo cuando el modo
    // REALMENTE cambia. Evita que un depósito/retiro pendiente quede apuntando a
    // un issuer contradictorio tras cambiar quién banca.
    if (params.isIndependent !== user.isIndependentBranch) {
      const inflight = await this.countInFlightRequests(db, user.id);
      if (inflight.depositsPending + inflight.withdrawalsPending > 0) {
        throw new BranchFlipHasPendingRequestsError(user.id, inflight);
      }
    }

    // Safe-by-default: al degradar (indep → dep), chequear que no queden
    // items operativos activos que quedarían visibles para el admin.
    // Si hay, tirar 409 BRANCH_DEGRADE_BLOCKED (a menos que force=true).
    if (!params.isIndependent && user.isIndependentBranch && !params.force) {
      const pending = await this.countPendingForDegradation(db, user);
      const total =
        pending.bankTxsUnmatched +
        pending.bonusDefsActive +
        pending.fraudLinksUnresolved;
      if (total > 0) {
        throw new BranchDegradeBlockedError(user.id, pending);
      }
    }

    // §14.4 guard (bloqueo DURO): un doble flip dep→indep→dep en el MISMO
    // período perdería la comisión del primer tramo dependiente (el ventaneo de
    // dos timestamps no representa dos tramos). Si el socio ya se independizó
    // este mes (commissionEligibleUntil dentro del período en curso), rechazamos
    // el indep→dep: el admin espera al cierre, donde el compute mensual liquida
    // bien ese tramo. Ver docs/17 §14.4.
    if (
      !params.isIndependent &&
      user.isIndependentBranch &&
      user.commissionEligibleUntil !== null
    ) {
      const nowGuard = new Date();
      const monthStart = new Date(
        Date.UTC(nowGuard.getUTCFullYear(), nowGuard.getUTCMonth(), 1),
      );
      if (user.commissionEligibleUntil >= monthStart) {
        throw new BranchFlipSamePeriodError(
          user.id,
          user.commissionEligibleUntil,
        );
      }
    }

    const isChanging = params.isIndependent !== user.isIndependentBranch;

    // Todo el flip corre en UNA transacción: reconciliación de fichas + flip del
    // flag + perms. Si algo falla, no queda a medias (docs/17 §14).
    const updated = await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as TenantDb;

      // Lock + re-check del flag DENTRO de la tx: cierra la carrera de dos flips
      // concurrentes (el segundo ve el modo ya cambiado y NO re-ejecuta la
      // reconciliación de fichas).
      const lockedRows = await txRaw
        .select({ isIndependentBranch: users.isIndependentBranch })
        .from(users)
        .where(eq(users.id, user.id))
        .for('update')
        .limit(1);
      const currentlyIndep =
        lockedRows[0]?.isIndependentBranch ?? user.isIndependentBranch;
      const reallyChanging =
        isChanging && params.isIndependent !== currentlyIndep;

      // ── Reconciliación de fichas (D3, docs/17 §14.2/§14.3) ────────────────
      if (reallyChanging) {
        const casa = await this.houseService.getHouseUser(tx);
        if (!casa) throw new HouseNotProvisionedError();
        const stamp = Date.now();

        if (params.isIndependent) {
          // dep→indep: el socio COMPRA el saldo en circulación de su sub-red.
          // Transfer Casa→socio de `base` fichas (consume stock de la Casa; si
          // no alcanza → InsufficientBalanceError → 409 HOUSE_INSUFFICIENT_STOCK).
          // El fiat del cobro es off-platform. Es transfer → no infla el supply.
          const base = await this.computeSubnetCirculatingBase(tx, user.id);
          if (Number(base) > 0) {
            await this.walletService.executeTransferPair(tx, {
              actorUserId: params.actorUserId,
              sourceUserId: casa.id,
              targetUserId: user.id,
              amount: base,
              sourceType: 'transfer_out',
              targetType: 'load',
              source: 'branch_flip_buyback',
              referenceId: user.id,
              idempotencyKey: `flip_buyback:${user.id}:${stamp}`,
              reason: `Flip dep→indep: compra del saldo en circulación (${base} fichas) al precio ${params.branchChipsPricePerUnit}/ficha. La Casa deja de bancar la sub-red.`,
            });
          }
        } else {
          // indep→dep: el stock propio SIN VENDER del socio se QUEMA sin
          // reintegro (supply baja). La Casa reabsorbe el respaldo de la sub-red
          // sola (nearest-ancestor vuelve a resolver a la Casa al bajar el flag).
          const balRows = await txRaw
            .select({ balance: wallets.balance })
            .from(wallets)
            .where(eq(wallets.userId, user.id))
            .limit(1);
          const stock = balRows[0]?.balance ?? '0';
          if (Number(stock) > 0) {
            await this.walletService.burnFromWallet(tx, {
              userId: user.id,
              amount: stock,
              source: 'branch_flip_burn',
              referenceId: user.id,
              idempotencyKey: `flip_burn:${user.id}:${stamp}`,
              actorUserId: params.actorUserId,
              reason: `Flip indep→dep: quema del stock propio sin vender del socio ${user.username} (${stock} fichas, sin reintegro).`,
            });
          }
        }
      }

      // §14.4 corte de comisión: marcar el boundary del tramo DEPENDIENTE. Solo
      // en un cambio real de modo. dep→indep cierra la era dependiente en el
      // flip (until=now); indep→dep arranca una nueva (from=now, until=null). El
      // engine de comisiones ventanea los game_rounds por estos límites.
      const flipNow = new Date();
      const commissionWindow: {
        commissionEligibleFrom?: Date | null;
        commissionEligibleUntil?: Date | null;
      } = reallyChanging
        ? params.isIndependent
          ? { commissionEligibleUntil: flipNow }
          : { commissionEligibleFrom: flipNow, commissionEligibleUntil: null }
        : {};

      const rows = await txRaw
        .update(users)
        .set({
          isIndependentBranch: params.isIndependent,
          branchBankAccount: params.isIndependent
            ? params.branchBankAccount!
            : null,
          branchChipsPricePerUnit: params.isIndependent
            ? params.branchChipsPricePerUnit!
            : null,
          ...commissionWindow,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id))
        .returning();

      // El socio independiente recibe el set de permisos no-dinámicos; al
      // degradar se revocan. Los perms de MOVER plata se dan/quitan solos por el
      // cálculo dinámico según el flag (ver perms-plata-dinamicos).
      if (params.isIndependent) {
        await this.grantIndependentPermissions(tx, user.id);
      } else {
        await this.revokeIndependentPermissions(tx, user.id);
      }

      return rows[0]!;
    });

    return updated;
  }

  /**
   * Inserta los overrides 'grant' para el set completo de permisos que un
   * socio independiente necesita para armar su equipo y operar su sub-red
   * (users + wallet + deposits + withdrawals + bonuses). Definidos en
   * INDEPENDENT_BRANCH_AUTO_PERMISSIONS. Idempotente vía ON CONFLICT DO NOTHING
   * (PK = userId + permissionCode).
   */
  private async grantIndependentPermissions(db: TenantDb, socioId: string): Promise<void> {
    // El socio recibe el set NO-dinámico (users + views + bank_tx + fraud +
    // bonos). Los 7 perms de MOVER plata NO se otorgan acá: los agrega
    // EffectivePermissionsService a TODA la sub-red independiente — socio y
    // descendientes — en runtime (LEYES R3/R4). Upsert a `grant`: gana sobre
    // cualquier `revoke` previo.
    const values = INDEPENDENT_BRANCH_AUTO_PERMISSIONS.map((code) => ({
      userId: socioId,
      permissionCode: code,
      effect: 'grant' as const,
      grantedBy: null,
      reason: 'Auto-grant sucursal independiente (socio: set no-dinámico).',
    }));
    await db
      .insert(userPermissionOverrides)
      .values(values)
      .onConflictDoUpdate({
        target: [
          userPermissionOverrides.userId,
          userPermissionOverrides.permissionCode,
        ],
        set: { effect: 'grant' },
      });
    this.logger.log(
      `Socio ${socioId} independiente → ${values.length} grants (set no-dinámico).`,
    );
  }

  /**
   * Revoca los overrides que se otorgaron al activar. Hard delete del row (no
   * inserta un 'revoke') — preserva el set original (rol base) para el socio
   * cuando deja de ser independiente.
   */
  private async revokeIndependentPermissions(db: TenantDb, socioId: string): Promise<void> {
    // Quita el set no-dinámico del socio. Los perms de plata se cortan solos:
    // al dejar de ser independiente, EffectivePermissionsService deja de
    // aplicarlos a toda la sub-red (no hay overrides que borrar).
    await db.delete(userPermissionOverrides).where(
      and(
        eq(userPermissionOverrides.userId, socioId),
        inArray(userPermissionOverrides.permissionCode, [
          ...INDEPENDENT_BRANCH_AUTO_PERMISSIONS,
        ]),
        eq(userPermissionOverrides.effect, 'grant'),
      ),
    );
    this.logger.log(
      `Socio ${socioId} desactivado → grants de independiente revocados.`,
    );
  }

  /**
   * Vende fichas al socio independent: TRANSFIERE desde la Casa al socio.
   *
   * Cambio 2026-07 (modelo "tope mensual"): la venta ya NO mintea. Ahora es
   * una transferencia Casa → socio, de modo que consume el stock de la Casa
   * (que está capado por el presupuesto mensual `injectBudget`). Así se
   * elimina un método de creación de fichas: la única emisión es el fondeo de
   * presupuesto a la Casa, y la venta al indep solo mueve fichas ya emitidas.
   *
   * - Valida que el socio existe, es socio, está marcado independent
   *   y tiene precio configurado.
   * - Calcula amountFiat = amountChips * pricePerUnit (con 2 decimales).
   * - Resuelve la Casa (source del transfer). Si no está provisionada → error.
   * - Transfiere via WalletService.executeTransferPair con idempotency
   *   garantizada por `branch_chip_sale:<idempotencyKey>`. Si la Casa no tiene
   *   stock suficiente, executeTransferPair tira InsufficientBalanceError
   *   (fondeá el presupuesto de la Casa antes de vender).
   */
  async sellChips(db: TenantDb, params: SellChipsParams): Promise<SellChipsResult> {
    const socio = await this.assertSocio(db, params.socioId);
    if (!socio.isIndependentBranch) {
      throw new BranchNotIndependentError(socio.id);
    }
    if (!socio.branchChipsPricePerUnit) {
      throw new BranchPriceNotConfiguredError(socio.id);
    }

    const amountChipsNum = Number(params.amountChips);
    const priceNum = Number(socio.branchChipsPricePerUnit);
    if (!isFinite(amountChipsNum) || amountChipsNum <= 0) {
      throw new BranchInvalidPriceError(`amountChips inválido: ${params.amountChips}`);
    }
    if (!isFinite(priceNum) || priceNum <= 0) {
      throw new BranchInvalidPriceError(socio.branchChipsPricePerUnit);
    }
    const amountFiat = (amountChipsNum * priceNum).toFixed(2);

    // La Casa es la fuente del transfer: consume su stock (capado por el
    // presupuesto mensual). Si el tenant no la tiene provisionada, abortamos.
    const casa = await this.houseService.getHouseUser(db);
    if (!casa) {
      throw new HouseNotProvisionedError();
    }

    const idempotencyKey = `branch_chip_sale:${params.idempotencyKey}`;
    const reason = `Venta de fichas a sucursal ${socio.username} — ${amountFiat} fiat al precio ${socio.branchChipsPricePerUnit}/ficha${params.notes ? ` — ${params.notes}` : ''}`;
    const { targetTx } = await this.walletService.executeTransferPair(db, {
      actorUserId: params.actorUserId,
      sourceUserId: casa.id,
      targetUserId: socio.id,
      amount: params.amountChips,
      sourceType: 'transfer_out',
      targetType: 'load',
      source: 'branch_chip_sale',
      referenceId: socio.id,
      idempotencyKey,
      reason,
    });

    return {
      socioId: socio.id,
      amountChips: params.amountChips,
      pricePerUnit: socio.branchChipsPricePerUnit,
      amountFiat,
      walletTxId: targetTx.id,
      newBalance: targetTx.balanceAfter,
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Listados + reporting (Sprint 51.1)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Lista todas las sucursales independientes del tenant. Para cada socio:
   *   - su config (bankAccount, price).
   *   - balance actual del wallet.
   *   - chips + fiat vendidos en los últimos 30 días.
   *   - timestamp de la última venta.
   *
   * Sin paginación por ahora (los socios independent son pocos).
   */
  async listIndependent(db: TenantDb): Promise<BranchListRow[]> {
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Subquery 1: agregado de ventas 30d por wallet.
    // Hacemos un LEFT JOIN entre users (independent) → wallets → ventas 30d.
    // El "fiat" lo extraemos parseando el reason — para evitar eso, hacemos
    // la mate en JS leyendo amount + price del row.
    const independentSocios = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        status: users.status,
        branchBankAccount: users.branchBankAccount,
        branchChipsPricePerUnit: users.branchChipsPricePerUnit,
        walletId: wallets.id,
        walletBalance: wallets.balance,
      })
      .from(users)
      .leftJoin(wallets, eq(wallets.userId, users.id))
      .where(eq(users.isIndependentBranch, true))
      .orderBy(asc(users.username));

    if (independentSocios.length === 0) return [];

    // Agregado por wallet de ventas 30d.
    const walletIds = independentSocios
      .map((s) => s.walletId)
      .filter((id): id is string => id !== null);
    if (walletIds.length === 0) {
      return independentSocios.map((s) => ({
        socioId: s.id,
        username: s.username,
        displayName: s.displayName,
        status: s.status,
        branchBankAccount: s.branchBankAccount ?? '',
        branchChipsPricePerUnit: s.branchChipsPricePerUnit ?? '0',
        walletBalance: s.walletBalance ?? '0',
        chipsSold30d: '0',
        fiatSold30d: '0.00',
        lastSaleAt: null,
      }));
    }

    const salesAgg = await db
      .select({
        walletId: walletTransactions.walletId,
        totalChips: sql<string>`COALESCE(SUM(${walletTransactions.amount}), 0)::text`,
        lastSaleAt: sql<Date | null>`MAX(${walletTransactions.createdAt})`,
      })
      .from(walletTransactions)
      .where(
        and(
          eq(walletTransactions.source, 'branch_chip_sale'),
          gte(walletTransactions.createdAt, since30d),
          inArray(walletTransactions.walletId, walletIds),
        ),
      )
      .groupBy(walletTransactions.walletId);

    const aggByWallet = new Map(salesAgg.map((r) => [r.walletId, r]));

    return independentSocios.map((s) => {
      const agg = s.walletId ? aggByWallet.get(s.walletId) : undefined;
      const chips30d = agg?.totalChips ?? '0';
      const price = s.branchChipsPricePerUnit ?? '0';
      const fiat30d = (Number(chips30d) * Number(price)).toFixed(2);
      return {
        socioId: s.id,
        username: s.username,
        displayName: s.displayName,
        status: s.status,
        branchBankAccount: s.branchBankAccount ?? '',
        branchChipsPricePerUnit: price,
        walletBalance: s.walletBalance ?? '0',
        chipsSold30d: chips30d,
        fiatSold30d: fiat30d,
        lastSaleAt: agg?.lastSaleAt ?? null,
      };
    });
  }

  /**
   * Sales summary: agrega ventas de fichas por socio en un rango opcional.
   * Devuelve socios que tienen al menos 1 venta en el rango.
   *
   * El cálculo de `totalFiatSold` usa el `branchChipsPricePerUnit` ACTUAL
   * del socio (no el congelado en cada venta). Si el admin cambió el
   * precio mid-rango, el agregado será aproximado. Para una versión exacta
   * habría que extraer el precio del reason de cada tx — costoso y rara
   * vez útil. Si emerge necesidad, agregar `wallet_transactions.metadata
   * jsonb` con `{ pricePerUnit }` snap-shotted al insertar.
   */
  async salesSummary(
    db: TenantDb,
    filters: { from?: Date; to?: Date },
  ): Promise<{
    data: BranchSalesSummaryRow[];
    totals: {
      salesCount: number;
      totalChipsSold: string;
      totalFiatSold: string;
    };
  }> {
    const conds = [eq(walletTransactions.source, 'branch_chip_sale')];
    if (filters.from) conds.push(gte(walletTransactions.createdAt, filters.from));
    if (filters.to) conds.push(lte(walletTransactions.createdAt, filters.to));

    const rows = await db
      .select({
        userId: wallets.userId,
        username: users.username,
        displayName: users.displayName,
        branchChipsPricePerUnit: users.branchChipsPricePerUnit,
        salesCount: sql<number>`COUNT(*)::int`,
        totalChips: sql<string>`COALESCE(SUM(${walletTransactions.amount}), 0)::text`,
        lastSaleAt: sql<Date | null>`MAX(${walletTransactions.createdAt})`,
      })
      .from(walletTransactions)
      .innerJoin(wallets, eq(wallets.id, walletTransactions.walletId))
      .innerJoin(users, eq(users.id, wallets.userId))
      .where(and(...conds))
      .groupBy(
        wallets.userId,
        users.username,
        users.displayName,
        users.branchChipsPricePerUnit,
      )
      .orderBy(desc(sql`SUM(${walletTransactions.amount})`));

    const data: BranchSalesSummaryRow[] = rows.map((r) => {
      const price = r.branchChipsPricePerUnit ?? '0';
      const totalFiat = (Number(r.totalChips) * Number(price)).toFixed(2);
      return {
        socioId: r.userId,
        username: r.username,
        displayName: r.displayName,
        branchChipsPricePerUnit: r.branchChipsPricePerUnit,
        salesCount: r.salesCount,
        totalChipsSold: r.totalChips,
        totalFiatSold: totalFiat,
        lastSaleAt: r.lastSaleAt,
      };
    });

    const totalChips = data.reduce((acc, r) => acc + Number(r.totalChipsSold), 0);
    const totalFiat = data.reduce((acc, r) => acc + Number(r.totalFiatSold), 0);
    const totalCount = data.reduce((acc, r) => acc + r.salesCount, 0);

    return {
      data,
      totals: {
        salesCount: totalCount,
        totalChipsSold: totalChips.toFixed(0),
        totalFiatSold: totalFiat.toFixed(2),
      },
    };
  }

  /**
   * Self-view para el socio: su config + history de chip sales + totales
   * all-time. Si el user no es socio, devuelve `isIndependent: false`
   * con totales 0 (no es error — el endpoint es seguro de llamar para
   * cualquier user).
   */
  async myBranchInfo(
    db: TenantDb,
    userId: string,
    recentLimit = 20,
  ): Promise<MyBranchInfo> {
    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const user = userRows[0];
    if (!user) {
      throw new BranchSocioNotFoundError(userId);
    }

    const wallet = await this.walletService.getOrCreateWalletForUser(db, userId);

    // Totals all-time (sin rango).
    const totalsRows = await db
      .select({
        count: sql<number>`COUNT(*)::int`,
        totalChips: sql<string>`COALESCE(SUM(${walletTransactions.amount}), 0)::text`,
      })
      .from(walletTransactions)
      .where(
        and(
          eq(walletTransactions.walletId, wallet.id),
          eq(walletTransactions.source, 'branch_chip_sale'),
        ),
      );
    const totals = totalsRows[0]!;

    // Recent sales (últimas N).
    const recentRows = await db
      .select({
        id: walletTransactions.id,
        amount: walletTransactions.amount,
        reason: walletTransactions.reason,
        createdAt: walletTransactions.createdAt,
        createdBy: walletTransactions.createdBy,
        createdByUsername: users.username,
      })
      .from(walletTransactions)
      .leftJoin(users, eq(users.id, walletTransactions.createdBy))
      .where(
        and(
          eq(walletTransactions.walletId, wallet.id),
          eq(walletTransactions.source, 'branch_chip_sale'),
        ),
      )
      .orderBy(desc(walletTransactions.createdAt))
      .limit(Math.min(Math.max(recentLimit, 1), 100));

    const price = user.branchChipsPricePerUnit ?? '0';
    const recentSales: BranchSaleEntry[] = recentRows.map((r) => {
      const fiat = (Number(r.amount) * Number(price)).toFixed(2);
      return {
        walletTxId: r.id,
        amountChips: r.amount,
        amountFiat: fiat,
        pricePerUnit: price,
        reason: r.reason,
        createdAt: r.createdAt,
        createdByUserId: r.createdBy,
        createdByUsername: r.createdByUsername ?? null,
      };
    });

    const fiatAllTime = (Number(totals.totalChips) * Number(price)).toFixed(2);

    let nearestOwnerId = await this.hierarchy.getNearestIndependentBranchAncestor(db, userId);

    // Fallback heurístico: si el usuario no tiene entrada en user_hierarchy
    // (root) y hay EXACTAMENTE una sucursal independiente, asumimos que
    // pertenece a ella. Esto cubre cajeros/distribuidores creados por el
    // admin en tenants con una sola sucursal independiente.
    if (!nearestOwnerId) {
      const hasHierarchyEntry = await this.hierarchy.hasAnyEntry(db, userId);
      if (!hasHierarchyEntry) {
        const singleBranch = await this.hierarchy.findSingleIndependentBranch(db);
        if (singleBranch) {
          nearestOwnerId = singleBranch;
        }
      }
    }

    return {
      isIndependent: !!user.isIndependentBranch,
      underIndependentBranch: !!nearestOwnerId,
      independentBranchOwnerId: nearestOwnerId,
      bankAccount: user.branchBankAccount ?? null,
      pricePerUnit: user.branchChipsPricePerUnit ?? null,
      walletBalance: wallet.balance,
      totals: {
        chipsSoldAllTime: totals.totalChips,
        fiatSoldAllTime: fiatAllTime,
        salesCount: totals.count,
      },
      recentSales,
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // helpers
  // ──────────────────────────────────────────────────────────────────────

  private async assertSocio(db: TenantDb, userId: string): Promise<User> {
    const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const user = userRows[0];
    if (!user) throw new BranchSocioNotFoundError(userId);

    const roleRows = await db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, userId), eq(roles.code, 'socio')))
      .limit(1);
    if (!roleRows[0]) throw new BranchNotASocioError(userId);
    return user;
  }

  private assertPriceValid(price: string): void {
    const n = Number(price);
    if (!isFinite(n) || n <= 0) {
      throw new BranchInvalidPriceError(price);
    }
  }
}
