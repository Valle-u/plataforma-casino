/**
 * GameSessionsService — orquesta el lifecycle de una `game_session`.
 *
 * Operaciones:
 *   - `createSession(...)`: chequea exclusion (responsible gaming),
 *     valida game activo, snapshot del wallet balance, llama
 *     provider.launchGame, inserta game_session.
 *   - `closeSession(id, actorId)`: validación de ownership, snapshot
 *     closing_balance, marca status='closed'.
 *   - `findById/findByIdForActor`: queries.
 *   - `listActiveForUser`: para "tus partidas en curso" UI.
 *
 * Reglas:
 *   - Un user puede tener múltiples sessions activas simultáneas (un
 *     juego por session). Re-launch del mismo game: crea NUEVA session
 *     (más simple que merger, evita race en closing_balance).
 *   - `assertCanLogin` (vía responsibleGaming) bloquea launch si user
 *     tiene exclusion activa.
 *   - `game.isActive` validado: no se puede launch un game archivado.
 */

import { Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import {
  gameSessions,
  type Game,
  type GameSession,
  type NewGameSession,
} from '@casino/db';
import { ResponsibleGamingService } from '../responsible-gaming/responsible-gaming.service';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { WalletService } from '../wallet/wallet.service';
import {
  GameSessionNotFoundError,
  GameSessionUserMismatchError,
} from './game-sessions.errors';
import { GameNotActiveError } from './games.errors';
import { GameProviderRegistry } from './providers/game-provider.registry';

export interface CreateSessionParams {
  game: Game;
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class GameSessionsService {
  constructor(
    private readonly providers: GameProviderRegistry,
    private readonly walletService: WalletService,
    private readonly responsibleGaming: ResponsibleGamingService,
  ) {}

  async createSession(
    db: TenantDb,
    params: CreateSessionParams,
  ): Promise<{ session: GameSession; launchUrl: string }> {
    if (!params.game.isActive) {
      throw new GameNotActiveError(params.game.code);
    }

    // Responsible gaming: bloquea si user excluido. NO chequea bet/loss
    // caps acá — eso se evalúa por bet individual en GameRoundsService.
    await this.responsibleGaming.assertCanLogin(db, params.userId);

    // Snapshot del balance del wallet al abrir. Si no existe wallet, lo
    // crea con 0. NO bloqueamos por saldo cero — el user puede abrir el
    // juego sin chips (verá un mensaje "depositá para jugar").
    const wallet = await this.walletService.getOrCreateWalletForUser(
      db,
      params.userId,
    );

    // Llamamos al provider. Mock devuelve URL local + UUID interno.
    const provider = this.providers.get(params.game.providerCode);
    const { providerSessionId, launchUrl } = await provider.launchGame(
      {
        game: params.game,
        userId: params.userId,
        currency: 'CHIPS',
        // Ya la teníamos (se guarda en `opened_from_ip`) pero no llegaba al
        // proveedor. Ver `LaunchParams.playerIp`.
        playerIp: params.ip ?? null,
      },
      db,
    );

    const values: NewGameSession = {
      userId: params.userId,
      gameId: params.game.id,
      providerSessionId,
      currency: 'CHIPS',
      openedBalance: wallet.balance,
      status: 'active',
      openedFromIp: params.ip ?? null,
      openedFromUserAgent: params.userAgent ?? null,
    };
    const inserted = await db
      .insert(gameSessions)
      .values(values)
      .returning();
    return { session: inserted[0]!, launchUrl };
  }

  async findByIdForActor(
    db: TenantDb,
    id: string,
    actorId: string,
  ): Promise<GameSession> {
    const rows = await db
      .select()
      .from(gameSessions)
      .where(eq(gameSessions.id, id))
      .limit(1);
    const s = rows[0];
    if (!s) throw new GameSessionNotFoundError(id);
    if (s.userId !== actorId) {
      throw new GameSessionUserMismatchError(id, actorId);
    }
    return s;
  }

  async closeSession(
    db: TenantDb,
    id: string,
    actorId: string,
  ): Promise<GameSession> {
    const session = await this.findByIdForActor(db, id, actorId);
    if (session.status !== 'active') {
      // Idempotente: si ya está closed, devolver tal cual.
      return session;
    }
    const wallet = await this.walletService.getOrCreateWalletForUser(
      db,
      actorId,
    );
    const updated = await db
      .update(gameSessions)
      .set({
        status: 'closed',
        closingBalance: wallet.balance,
        endedAt: new Date(),
      })
      .where(eq(gameSessions.id, id))
      .returning();
    return updated[0]!;
  }

  async listActiveForUser(
    db: TenantDb,
    userId: string,
  ): Promise<GameSession[]> {
    return db
      .select()
      .from(gameSessions)
      .where(
        and(
          eq(gameSessions.userId, userId),
          eq(gameSessions.status, 'active'),
        ),
      )
      .orderBy(desc(gameSessions.startedAt))
      .limit(20);
  }
}
