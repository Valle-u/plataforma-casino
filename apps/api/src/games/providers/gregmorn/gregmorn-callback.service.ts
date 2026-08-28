/**
 * GregmornCallbackService — procesa los callbacks seamless de Gregmorn Hub.
 *
 * Tres comandos (`cmd`):
 *   - getBalance → devuelve el saldo jugable. Solo lectura.
 *   - writeBet   → aplica bet (burn) y/o win (mint, con tope E7). Puede traer
 *                  las dos cosas en el MISMO callback.
 *   - rollback   → devuelve la apuesta de una ronda anulada. Una sola vez.
 *
 * Economía (LEYES E1/E6): el monto del callback = 1 ficha, sin conversión. Bet
 * = burn puro, win = mint puro con techo de sanidad, rollback = mint (reversa).
 * El `locked` (retiros en hold) NO es jugable y no se reporta.
 *
 * ─── Las tres trampas de este proveedor ────────────────────────────────────
 *
 * 1. **El rollback repite el `transactionId` del bet.** Por eso la idempotencia
 *    va por `<cmd>:<transactionId>`, nunca por el id crudo. Con el id crudo, un
 *    rollback se ve como duplicado del bet y se descarta en silencio: el
 *    jugador no recupera la apuesta. Confirmado con ellos el 2026-08-28.
 * 2. **`bet` y `win` pueden venir número O string** (avisan que los vendors
 *    SL-Games y X-Games mandan string). Un valor no parseable se RECHAZA; no se
 *    asume 0, porque un 0 silencioso es plata perdida o regalada.
 * 3. **HTTP 400 no es saldo 0.** Ante cualquier duda se responde `fail` y ellos
 *    no arrancan el spin. Está prohibido devolver un saldo cacheado o inventado.
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  gameRounds,
  gameSessions,
  games,
  gregmornTransactions,
  users,
  wallets,
  generateUuidV7,
  type Wallet,
} from '@casino/db';
import type { TenantDb } from '../../../tenant-resolver/tenant-context';
import { WalletService } from '../../../wallet/wallet.service';
import { NotificationsService } from '../../../notifications/notifications.service';
import { GameProviderLogsService } from '../../game-provider-logs.service';
import { TenantSettingsService } from '../../../tenant-settings/tenant-settings.service';
import { InsufficientBalanceError } from '../../../wallet/wallet.errors';
import { isUniqueViolation } from '../../../common/pg-error';
import {
  GREGMORN_CMD,
  GREGMORN_CODE,
  GREGMORN_DEFAULT_CURRENCY,
  type GregmornCallbackBody,
  type GregmornCallbackResponse,
} from './gregmorn.types';

/** Respuesta + el HTTP status con el que tiene que salir. */
export interface GregmornCallbackResult {
  httpStatus: number;
  body: GregmornCallbackResponse;
}

interface ResolvedContext {
  userId: string;
  userStatus: string;
  wallet: Wallet;
}

@Injectable()
export class GregmornCallbackService {
  private readonly logger = new Logger(GregmornCallbackService.name);

  /** Tope de sanidad del premio (mint). 0 = sin tope. Espeja Palace y Forever. */
  private static readonly DEFAULT_WIN_MAX = 50_000_000;

  constructor(
    private readonly walletService: WalletService,
    private readonly providerLogs: GameProviderLogsService,
    private readonly notifications: NotificationsService,
    private readonly settings: TenantSettingsService,
  ) {}

  async handle(
    db: TenantDb,
    body: GregmornCallbackBody,
  ): Promise<GregmornCallbackResult> {
    const currency = await this.currency(db);
    const login = body.login ?? '';

    try {
      switch (body.cmd) {
        case GREGMORN_CMD.GET_BALANCE:
          return await this.handleGetBalance(db, body, currency);
        case GREGMORN_CMD.WRITE_BET:
          return await this.handleWriteBet(db, body, currency);
        case GREGMORN_CMD.ROLLBACK:
          return await this.handleRollback(db, body, currency);
        default:
          return fail(login, currency, `INVALID_CMD: ${body.cmd ?? '(vacío)'}`);
      }
    } catch (err) {
      // Fondos insuficientes: ellos NO reservan ni calculan con getBalance, así
      // que el rechazo es esperable y no es un error del sistema.
      if (err instanceof InsufficientBalanceError) {
        return fail(login, currency, 'INSUFFICIENT_FUNDS', Number(err.available));
      }
      const errMsg = (err as Error).message;
      this.logger.error(`Error procesando callback '${body.cmd}': ${errMsg}`);
      await this.providerLogs.write(db, {
        providerCode: GREGMORN_CODE,
        eventType: 'callback_error',
        severity: 'error',
        message: `Error inesperado procesando callback '${body.cmd}'.`,
        detail: {
          cmd: body.cmd,
          login: body.login,
          transactionId: body.transactionId,
          error: errMsg,
        },
      });
      return fail(login, currency, 'INTERNAL_ERROR');
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // getBalance
  // ──────────────────────────────────────────────────────────────────

  private async handleGetBalance(
    db: TenantDb,
    body: GregmornCallbackBody,
    currency: string,
  ): Promise<GregmornCallbackResult> {
    const login = body.login ?? '';
    const ctx = await this.resolveContext(db, login);
    // Sin jugador NO se devuelve 0: eso sería inventar un saldo. Fail → ellos
    // no arrancan el spin.
    if (!ctx) return fail(login, currency, 'UNKNOWN_PLAYER');
    return ok(login, currency, Number(this.jugable(ctx.wallet)));
  }

  // ──────────────────────────────────────────────────────────────────
  // writeBet — bet y/o win en el mismo callback
  // ──────────────────────────────────────────────────────────────────

  private async handleWriteBet(
    db: TenantDb,
    body: GregmornCallbackBody,
    currency: string,
  ): Promise<GregmornCallbackResult> {
    const login = body.login ?? '';
    const transactionId = (body.transactionId ?? '').trim();
    if (!transactionId) return fail(login, currency, 'MISSING_TRANSACTION_ID');

    // Trampa #2: número o string. No parseable → rechazar, nunca asumir 0.
    const bet = parseAmount(body.bet);
    const win = parseAmount(body.win);
    if (bet === null) return fail(login, currency, 'INVALID_BET_AMOUNT');
    if (win === null) return fail(login, currency, 'INVALID_WIN_AMOUNT');
    if (bet < 0 || win < 0) return fail(login, currency, 'NEGATIVE_AMOUNT');

    const ctx = await this.resolveContext(db, login);
    if (!ctx) return fail(login, currency, 'UNKNOWN_PLAYER');
    if (ctx.userStatus !== 'active') {
      return fail(login, currency, 'PLAYER_BLOCKED', Number(this.jugable(ctx.wallet)));
    }

    // Trampa #1: la clave lleva el cmd. Un rollback con el mismo transactionId
    // NO colisiona con este bet.
    const idempotencyKey = `${GREGMORN_CMD.WRITE_BET}:${transactionId}`;
    const already = await this.findTransaction(db, idempotencyKey);
    if (already) {
      // Duplicado: devolver el saldo ACTUAL sin re-aplicar (lo pide su spec).
      const fresh = await this.walletService.getOrCreateWalletForUser(db, ctx.userId);
      return ok(login, currency, Number(this.jugable(fresh)));
    }

    // Techo de sanidad del premio (E7) ANTES de mover nada.
    if (win > 0) {
      const cap = await this.settings.getNumeric(
        db,
        'game_provider.gregmorn.win_max_amount',
        GregmornCallbackService.DEFAULT_WIN_MAX,
      );
      if (cap > 0 && win > cap) {
        this.logger.error(
          `Gregmorn WIN RECHAZADO por tope: win=${win} > cap=${cap} login=${login} txn=${transactionId}`,
        );
        await this.alertWinOverCap(db, win, cap, login);
        return fail(login, currency, 'WIN_OVER_CAP');
      }
    }

    let betWalletTxId: string | null = null;

    // 1. Apuesta → burn (bonus-first). Si no alcanza, InsufficientBalanceError
    //    sube a handle() y se responde fail: ellos no reservan fondos.
    if (bet > 0) {
      const tx = await this.walletService.placeBetWithBonusExternal(db, {
        walletId: ctx.wallet.id,
        amount: bet.toFixed(2),
        idempotencyKey: `gregmorn:writeBet:bet:${transactionId}`,
        source: 'gregmorn_callback',
        reason: `Gregmorn bet ${login} ${transactionId}`,
      });
      betWalletTxId = tx.id;
    }

    // 2. Premio → mint. Clave DISTINTA de la del bet: un mismo callback puede
    //    traer las dos patas y cada una necesita su propia idempotencia.
    if (win > 0) {
      await this.walletService.mintExternal(db, {
        walletId: ctx.wallet.id,
        amount: win.toFixed(2),
        idempotencyKey: `gregmorn:writeBet:win:${transactionId}`,
        source: 'gregmorn_callback',
        reason: `Gregmorn win ${login} ${transactionId}`,
      });
    }

    await this.recordTransaction(db, {
      idempotencyKey,
      cmd: GREGMORN_CMD.WRITE_BET,
      transactionId,
      ctx,
      login,
      body,
      bet,
      win,
    });

    // Reporting (netwin / GGR / RTP / comisiones). No crítico: si falla, la
    // plata ya se movió y quedó registrada en gregmorn_transactions.
    try {
      await this.syncGameRound(db, body, ctx, { bet, win, betWalletTxId });
    } catch (err) {
      this.logger.warn(
        `No se pudo sincronizar game_round de Gregmorn (${transactionId}): ${(err as Error).message}`,
      );
    }

    const updated = await this.walletService.getOrCreateWalletForUser(db, ctx.userId);
    return ok(login, currency, Number(this.jugable(updated)));
  }

  // ──────────────────────────────────────────────────────────────────
  // rollback — devolver la apuesta de una ronda anulada, UNA sola vez
  // ──────────────────────────────────────────────────────────────────

  private async handleRollback(
    db: TenantDb,
    body: GregmornCallbackBody,
    currency: string,
  ): Promise<GregmornCallbackResult> {
    const login = body.login ?? '';
    const transactionId = (body.transactionId ?? '').trim();
    if (!transactionId) return fail(login, currency, 'MISSING_TRANSACTION_ID');

    const amount = parseAmount(body.bet);
    if (amount === null) return fail(login, currency, 'INVALID_BET_AMOUNT');
    if (amount < 0) return fail(login, currency, 'NEGATIVE_AMOUNT');

    const ctx = await this.resolveContext(db, login);
    if (!ctx) return fail(login, currency, 'UNKNOWN_PLAYER');

    const idempotencyKey = `${GREGMORN_CMD.ROLLBACK}:${transactionId}`;
    const already = await this.findTransaction(db, idempotencyKey);
    if (already) {
      const fresh = await this.walletService.getOrCreateWalletForUser(db, ctx.userId);
      return ok(login, currency, Number(this.jugable(fresh)));
    }

    // El bet original tiene que existir. Si no, acreditar sería mintear plata de
    // la nada. Se responde fail para que reintenten: si el writeBet venía
    // demorado, el reintento del rollback lo encuentra.
    const originalKey = `${GREGMORN_CMD.WRITE_BET}:${transactionId}`;
    const original = await this.findTransaction(db, originalKey);
    if (!original) {
      this.logger.warn(
        `Gregmorn rollback sin bet previo: login=${login} txn=${transactionId}. Se rechaza para que reintenten.`,
      );
      await this.providerLogs.write(db, {
        providerCode: GREGMORN_CODE,
        eventType: 'callback_error',
        severity: 'warning',
        message: 'Rollback de una transacción que no tenemos registrada.',
        detail: { login, transactionId, amount },
      });
      return fail(login, currency, 'UNKNOWN_TRANSACTION');
    }

    // Se devuelve lo que REALMENTE se cobró, no lo que dice el rollback: si los
    // montos difieren, el nuestro es el que movió el ledger.
    const refund = Number(original.bet);
    if (refund > 0) {
      await this.walletService.mintExternal(db, {
        walletId: ctx.wallet.id,
        amount: refund.toFixed(2),
        idempotencyKey: `gregmorn:rollback:${transactionId}`,
        source: 'gregmorn_rollback',
        reason: `Gregmorn rollback ${login} ${transactionId}`,
      });
      if (Math.abs(refund - amount) > 0.001) {
        this.logger.warn(
          `Gregmorn rollback con monto distinto al cobrado: ellos=${amount} nosotros=${refund} txn=${transactionId}. Se devolvió el nuestro.`,
        );
      }
    }

    await this.recordTransaction(db, {
      idempotencyKey,
      cmd: GREGMORN_CMD.ROLLBACK,
      transactionId,
      ctx,
      login,
      body,
      bet: refund,
      win: 0,
    });

    const updated = await this.walletService.getOrCreateWalletForUser(db, ctx.userId);
    return ok(login, currency, Number(this.jugable(updated)));
  }

  // ──────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────

  private async findTransaction(db: TenantDb, idempotencyKey: string) {
    const rows = await db
      .select({ id: gregmornTransactions.id, bet: gregmornTransactions.bet })
      .from(gregmornTransactions)
      .where(eq(gregmornTransactions.idempotencyKey, idempotencyKey))
      .limit(1);
    return rows[0] ?? null;
  }

  private async recordTransaction(
    db: TenantDb,
    p: {
      idempotencyKey: string;
      cmd: 'writeBet' | 'rollback';
      transactionId: string;
      ctx: ResolvedContext;
      login: string;
      body: GregmornCallbackBody;
      bet: number;
      win: number;
    },
  ): Promise<void> {
    try {
      await db.insert(gregmornTransactions).values({
        idempotencyKey: p.idempotencyKey,
        cmd: p.cmd,
        transactionId: p.transactionId,
        userId: p.ctx.userId,
        login: p.login,
        sessionId: p.body.sessionid ?? null,
        bet: p.bet.toFixed(2),
        win: p.win.toFixed(2),
        gameId: p.body.gameId ?? null,
        roundId: p.body.roundId ?? null,
        roundFinished: p.body.round_finished === true,
        info: p.body.info ?? null,
      });
    } catch (err) {
      // Carrera con un callback idéntico: la key única lo bloquea. El wallet ya
      // es idempotente por su propia key, así que no hay doble aplicación.
      if (!isUniqueViolation(err)) throw err;
    }
  }

  /**
   * Puentea el callback a `game_rounds` para que el reporting (netwin, GGR, RTP
   * y comisiones) cuente las jugadas de Gregmorn igual que las de Palace y
   * Forever.
   *
   * ⚠️ **Un spin puede llegar en DOS callbacks.** Se descubrió probando en
   * producción (2026-08-28): el proveedor manda `roundId` sufijado —
   * `1349484390_0` para la apuesta y `1349484390_1` para el cierre— y la
   * versión original los trataba como rondas distintas. Resultado: el conteo de
   * rondas salía al doble, las filas `_0` quedaban en `placed` para siempre, y
   * aparecían rondas absurdas con apuesta 0 y premio 100.
   *
   * Los TOTALES de plata daban bien igual (la apuesta en una fila, el premio en
   * la otra), así que NGR y comisiones nunca estuvieron mal — lo que no servía
   * era la granularidad por ronda ni el RTP.
   *
   * Por eso el id se normaliza y el segundo callback **actualiza** la ronda en
   * vez de crear otra, acumulando montos. Es seguro acumular: el caller ya
   * descartó los duplicados por `idempotency_key` antes de llegar acá, así que
   * cada callback pasa por esta función a lo sumo una vez.
   */
  private async syncGameRound(
    db: TenantDb,
    body: GregmornCallbackBody,
    ctx: ResolvedContext,
    p: { bet: number; win: number; betWalletTxId: string | null },
  ): Promise<void> {
    const providerGameId = body.gameId;
    if (!providerGameId) return; // sin gameId no se puede mapear el juego

    const roundExternalId = normalizeRoundId(
      (body.roundId ?? body.transactionId ?? '').trim(),
    );
    if (!roundExternalId) return;

    // El sync guarda el gameId crudo en games.config.gregmorn.gameId.
    const [game] = await db
      .select({ id: games.id })
      .from(games)
      .where(sql`${games.config} -> 'gregmorn' ->> 'gameId' = ${providerGameId}`)
      .limit(1);
    if (!game) return;

    // Sesión virtual por user+game (mismo patrón que Palace y Forever).
    const sessionKey = `gregmorn:${body.login ?? ''}:${providerGameId}`;
    let [session] = await db
      .select({ id: gameSessions.id })
      .from(gameSessions)
      .where(
        and(
          eq(gameSessions.userId, ctx.userId),
          eq(gameSessions.gameId, game.id),
          eq(gameSessions.providerSessionId, sessionKey),
        ),
      )
      .limit(1);
    if (!session) {
      const id = generateUuidV7();
      await db.insert(gameSessions).values({
        id,
        userId: ctx.userId,
        gameId: game.id,
        providerSessionId: sessionKey,
        status: 'active',
      });
      session = { id };
    }

    const [existing] = await db
      .select({
        id: gameRounds.id,
        betAmount: gameRounds.betAmount,
        winAmount: gameRounds.winAmount,
      })
      .from(gameRounds)
      .where(
        and(
          eq(gameRounds.sessionId, session.id),
          eq(gameRounds.roundExternalId, roundExternalId),
        ),
      )
      .limit(1);

    const finished = body.round_finished === true;

    // Segundo callback del mismo spin: se acumula sobre la ronda que ya existe.
    if (existing) {
      const bet = Number(existing.betAmount) + p.bet;
      const win = Number(existing.winAmount) + p.win;
      await db
        .update(gameRounds)
        .set({
          betAmount: bet.toFixed(2),
          winAmount: win.toFixed(2),
          netAmount: (win - bet).toFixed(2),
          status: finished ? 'settled' : 'placed',
          // El wallet tx del bet suele venir en el primer callback; no pisarlo
          // con null si el segundo no trae ninguno.
          ...(p.betWalletTxId ? { betWalletTxId: p.betWalletTxId } : {}),
          ...(finished ? { settledAt: new Date() } : {}),
        })
        .where(eq(gameRounds.id, existing.id));
      return;
    }

    await db.insert(gameRounds).values({
      sessionId: session.id,
      userId: ctx.userId,
      gameId: game.id,
      roundExternalId,
      betAmount: p.bet.toFixed(2),
      winAmount: p.win.toFixed(2),
      netAmount: (p.win - p.bet).toFixed(2),
      status: finished ? 'settled' : 'placed',
      betWalletTxId: p.betWalletTxId,
      payload: body,
      placedAt: new Date(),
      ...(finished ? { settledAt: new Date() } : {}),
    });
  }

  /** Jugador + wallet a partir del `login` del callback (= `users.username`). */
  private async resolveContext(
    db: TenantDb,
    login: string,
  ): Promise<ResolvedContext | null> {
    if (!login.trim()) return null;
    const rows = await db
      .select({
        id: users.id,
        status: users.status,
        walletId: wallets.id,
        balance: wallets.balance,
        bonusBalance: wallets.bonusBalance,
        lockedBalance: wallets.lockedBalance,
        currency: wallets.currency,
      })
      .from(users)
      .leftJoin(wallets, eq(users.id, wallets.userId))
      .where(eq(users.username, login))
      .limit(1);
    const row = rows[0];
    if (!row) return null;

    const wallet: Wallet = row.walletId
      ? {
          id: row.walletId,
          userId: row.id,
          balance: row.balance ?? '0.00',
          bonusBalance: row.bonusBalance ?? '0.00',
          lockedBalance: row.lockedBalance ?? '0.00',
          currency: row.currency ?? 'CHIPS',
          version: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      : await this.walletService.getOrCreateWalletForUser(db, row.id);

    return { userId: row.id, userStatus: row.status, wallet };
  }

  private async currency(db: TenantDb): Promise<string> {
    const c = await this.settings.get<string>(db, 'game_provider.gregmorn.currency');
    return c?.trim() ? c.trim() : GREGMORN_DEFAULT_CURRENCY;
  }

  private async alertWinOverCap(
    db: TenantDb,
    win: number,
    cap: number,
    login: string,
  ): Promise<void> {
    try {
      await this.notifications.enqueueForRole(db, {
        roleCode: 'admin_tenant',
        kind: 'game_provider_alert',
        channel: 'in_app',
        payload: {
          title: 'Win rechazado por tope de sanidad (Gregmorn)',
          message: `Se rechazó un premio de ${win} (tope ${cap}) para ${login}. Revisá si es legítimo o un callback comprometido.`,
          providerCode: GREGMORN_CODE,
        },
      });
    } catch (err) {
      this.logger.error(`No se pudo notificar win-over-cap: ${(err as Error).message}`);
    }
  }

  /** Saldo jugable = (balance − locked) + bonus, floor 0. */
  private jugable(
    wallet: Pick<Wallet, 'balance' | 'bonusBalance' | 'lockedBalance'>,
  ): string {
    const cents = Math.max(
      0,
      toCents(wallet.balance) +
        toCents(String(wallet.bonusBalance ?? '0')) -
        toCents(String(wallet.lockedBalance ?? '0')),
    );
    return (cents / 100).toFixed(2);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Puros — testeables sin DB
// ──────────────────────────────────────────────────────────────────────

/**
 * Parsea un monto que puede venir **número o string** (trampa #2).
 *
 * Devuelve `null` si no se puede interpretar. El caller RECHAZA el callback
 * ante un `null`: asumir 0 sería mover mal la plata en silencio.
 *
 * Ausente (`undefined`/`null`) también es `null`: `bet` y `win` son
 * obligatorios en su spec, así que su ausencia es una violación del protocolo,
 * no un cero implícito.
 */
/**
 * Saca el sufijo `_N` del `roundId` del proveedor.
 *
 * Ellos parten un spin en dos callbacks: `1349484390_0` (apuesta) y
 * `1349484390_1` (cierre). El id real de la ronda es la parte de la izquierda.
 *
 * ⚠️ Si algún estudio usara un `roundId` que legítimamente termina en `_<n>`,
 * esto colapsaría rondas distintas en una. No se vio en ningún estudio de los
 * probados (EGT, ELK, Pragmatic), pero es el supuesto sobre el que se apoya.
 */
export function normalizeRoundId(raw: string): string {
  return raw.replace(/_\d+$/, '');
}

export function parseAmount(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function toCents(value: string | number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function ok(login: string, currency: string, balance: number): GregmornCallbackResult {
  return {
    httpStatus: 200,
    body: { balance, currency, error: '', login, status: 'success' },
  };
}

/**
 * Rechazo: HTTP 400 + `status: 'fail'`.
 *
 * El `balance` va en 0 solo porque el contrato de ellos exige el campo — con
 * `status: 'fail'` no lo leen como saldo, y su propia doc les prohíbe usar un
 * saldo por defecto. Nunca mandar un 400 esperando que interpreten un saldo.
 */
function fail(
  login: string,
  currency: string,
  error: string,
  balance = 0,
): GregmornCallbackResult {
  return {
    httpStatus: 400,
    body: { balance, currency, error, login, status: 'fail' },
  };
}
