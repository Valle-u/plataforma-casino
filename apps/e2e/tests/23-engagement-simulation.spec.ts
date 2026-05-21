/**
 * Spec 23 — Simulación de engagement (ligas + misiones/promos + bonos).
 *
 * Objetivo: ver el sistema funcionando con muchos users. NO es un test
 * de pass/fail estricto; es un "stress + visibilidad" — corre el flow
 * completo y reporta agregados.
 *
 * Tunables via env:
 *   - SIM_PLAYERS (default 30): cuántos players crear.
 *   - SIM_CONCURRENCY (default 5): cuántos correr en paralelo por batch.
 *   - SIM_BETS_MIN/MAX (default 5/15): rango de bets por player.
 *   - SIM_DEPOSITS_PER_PLAYER (default 2): cuántos deposits por player
 *     (1 trigger welcome, 2do reload).
 *
 * Flujo:
 *   1. Admin setea engagement:
 *      - 1 league (custom 24h, métrica=bet_volume, premios top 3).
 *      - 1 daily_wheel promo (5 segmentos, 24h).
 *      - 1 login_streak promo (7 días).
 *      - 1 bonus def welcome (matchPct 100%, max 5000, min 100).
 *      - 1 bonus def reload (matchPct 50%, max 2000, min 100).
 *   2. Por player (en batches paralelos):
 *      - crear + fondear con chips base
 *      - spin del daily_wheel
 *      - claim login streak
 *      - launch game session + N bets random
 *      - crear K deposits + bank_tx match + admin approve
 *        (cada approve triggerea auto-grant welcome|reload)
 *   3. Admin recompute + close league.
 *   4. Reporte agregado:
 *      - top 10 standings (user + score)
 *      - bonuses granted (count by type + sum amount)
 *      - wheel spins + sum prizes
 *      - streak claims
 *      - league results (final positions + prizes)
 */

import { expect, test } from '@playwright/test';
import {
  ApiClient,
  createTestPlayer,
  ensurePaymentMethod,
  loginAs,
  loginAsAdmin,
  uploadDepositProof,
  type TestPlayer,
} from './helpers/api';

// ─────────────────────────────────────────────────────────────────────
// Tunables
// ─────────────────────────────────────────────────────────────────────

const N_PLAYERS = Number(process.env.SIM_PLAYERS ?? 30);
const CONCURRENCY = Number(process.env.SIM_CONCURRENCY ?? 5);
const BETS_MIN = Number(process.env.SIM_BETS_MIN ?? 5);
const BETS_MAX = Number(process.env.SIM_BETS_MAX ?? 15);
const DEPOSITS_PER_PLAYER = Number(process.env.SIM_DEPOSITS_PER_PLAYER ?? 2);

const BASE_FUND_CHIPS = '20000'; // fichas iniciales por player (para bets).

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

interface MeResponse {
  user: { id: string; username: string };
}
interface CreatedEntity {
  id: string;
  code?: string;
}
interface ActiveGame {
  id: string;
  code: string;
  name: string;
  status: string;
}
interface PlayerStats {
  player: TestPlayer;
  betsPlaced: number;
  totalWagered: number;
  wheelPrizeChips: number;
  streakPrizeChips: number;
  depositsApproved: number;
  welcomeBonus: number;
  reloadBonus: number;
  errors: string[];
}

// ─────────────────────────────────────────────────────────────────────
// Spec
// ─────────────────────────────────────────────────────────────────────

test.describe.configure({ mode: 'serial' });

test.describe('Engagement simulation (Sprint 51.8 sim)', () => {
  test.setTimeout(15 * 60 * 1000); // 15 min cap.

  let adminApi: ApiClient;
  let methodId: string;
  let game: ActiveGame;
  let leagueId: string;
  let wheelId: string;
  let streakId: string;
  let welcomeDefId: string;
  let reloadDefId: string;

  test.beforeAll(async () => {
    adminApi = await ApiClient.create();
    await loginAsAdmin(adminApi);
    const m = await ensurePaymentMethod(adminApi);
    methodId = m.id;

    // Mint generoso al admin (necesario para fondear bonuses + chips a players).
    await adminApi.post(
      '/tenant/wallet/mint',
      {
        amount: String(BigInt(BASE_FUND_CHIPS) * BigInt(N_PLAYERS * 3)),
        reason: 'sim engagement mint',
      },
      { headers: { 'Idempotency-Key': `sim-mint-${Date.now()}` } },
    );

    // Buscar un game activo para los bets.
    const games = await adminApi.get<{ data: ActiveGame[] }>(
      '/tenant/games/active',
    );
    expect(games.data.length).toBeGreaterThan(0);
    game = games.data[0]!;
    console.log(`[sim] game seleccionado: ${game.code} (${game.name})`);
  });

  test.afterAll(async () => {
    await adminApi.dispose();
  });

  test('setup: crea league + wheel + streak + bonuses definitions', async () => {
    // startsAt = NOW (no -60s) → excluye bets de runs anteriores.
    // El sim crea bets DESPUÉS de este create → todos caen dentro.
    const now = new Date();
    const startsAt = now.toISOString();
    const endsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

    // League: 24h custom, métrica bet_volume, premios top 3.
    const league = await adminApi.post<CreatedEntity>('/tenant/leagues', {
      code: `sim-league-${Date.now()}`,
      name: 'Liga Simulación',
      period: 'custom',
      metric: 'bet_volume',
      startsAt,
      endsAt,
      prizes: {
        positions: [
          { position: 1, prize: { kind: 'chips', amount: 50000 } },
          { position: 2, prize: { kind: 'chips', amount: 30000 } },
          { position: 3, prize: { kind: 'chips', amount: 15000 } },
        ],
      },
    });
    leagueId = league.id;
    console.log(`[sim] league creada: ${leagueId}`);

    // Wheel: 5 segmentos.
    const wheel = await adminApi.post<CreatedEntity>('/tenant/promotions', {
      code: `sim-wheel-${Date.now()}`,
      name: 'Ruleta Simulación',
      type: 'daily_wheel',
      status: 'active',
      startsAt,
      endsAt,
      config: {
        segments: [
          { id: 's1', label: '50 chips', probability: 0.4, prize: { kind: 'chips', amount: 50 } },
          { id: 's2', label: '200 chips', probability: 0.25, prize: { kind: 'chips', amount: 200 } },
          { id: 's3', label: '500 chips', probability: 0.15, prize: { kind: 'chips', amount: 500 } },
          { id: 's4', label: '1000 chips', probability: 0.05, prize: { kind: 'chips', amount: 1000 } },
          { id: 's5', label: 'Try again', probability: 0.15, prize: { kind: 'try_again' } },
        ],
      },
    });
    wheelId = wheel.id;
    console.log(`[sim] wheel creada: ${wheelId}`);

    // Login streak: 7 días de premios escalonados.
    const streak = await adminApi.post<CreatedEntity>('/tenant/promotions', {
      code: `sim-streak-${Date.now()}`,
      name: 'Streak Simulación',
      type: 'login_streak',
      status: 'active',
      startsAt,
      endsAt,
      config: {
        prizes: [
          { kind: 'chips', amount: 100 },
          { kind: 'chips', amount: 200 },
          { kind: 'chips', amount: 300 },
          { kind: 'chips', amount: 500 },
          { kind: 'chips', amount: 750 },
          { kind: 'chips', amount: 1000 },
          { kind: 'chips', amount: 2000 },
        ],
        forgivenessDays: 0,
        onMax: 'hold',
      },
    });
    streakId = streak.id;
    console.log(`[sim] streak creada: ${streakId}`);

    // Archivar definitions viejas de welcome/reload (de runs anteriores
    // o de spec 17). El auto-grant hace `ORDER BY code ASC LIMIT 1` y si
    // hay defs viejas con matchPct=0 o configs distintas, ganarían sobre
    // las nuestras y el reporte muestra 0 bonuses.
    const existingDefs = await adminApi.get<{
      data: Array<{ id: string; type: string; status: string }>;
    }>('/tenant/bonus-definitions?ownerScope=tenant');
    let archived = 0;
    for (const d of existingDefs.data) {
      if ((d.type === 'welcome' || d.type === 'reload') && d.status === 'active') {
        try {
          await adminApi.patch(`/tenant/bonus-definitions/${d.id}`, {
            status: 'archived',
          });
          archived++;
        } catch {
          /* ignore */
        }
      }
    }
    if (archived > 0) {
      console.log(`[sim] ${archived} definitions viejas de welcome/reload archivadas`);
    }

    // Welcome bonus definition (auto-grant en 1er deposit).
    // Prefix `0-` para ganar el ORDER BY code ASC del auto-grant (si hay
    // definitions viejas de otros specs con códigos `sp17-...`, `tenant-...`
    // les ganamos alfabéticamente).
    const welcome = await adminApi.post<CreatedEntity>(
      '/tenant/bonus-definitions',
      {
        code: `0-sim-welcome-${Date.now()}`,
        name: 'Welcome Simulación',
        type: 'welcome',
        status: 'active',
        config: { matchPct: 100, maxAmount: 5000, minDeposit: 100 },
        wagering: { multiplier: 10, scope: 'bonus_only' },
        expirationDays: 30,
      },
    );
    welcomeDefId = welcome.id;
    console.log(`[sim] welcome bonus def: ${welcomeDefId}`);

    // Reload bonus definition (auto-grant en 2do+ deposit).
    const reload = await adminApi.post<CreatedEntity>(
      '/tenant/bonus-definitions',
      {
        code: `0-sim-reload-${Date.now()}`,
        name: 'Reload Simulación',
        type: 'reload',
        status: 'active',
        config: { matchPct: 50, maxAmount: 2000, minDeposit: 100 },
        wagering: { multiplier: 5, scope: 'bonus_only' },
        expirationDays: 15,
      },
    );
    reloadDefId = reload.id;
    console.log(`[sim] reload bonus def: ${reloadDefId}`);
  });

  // ───────────────────────────────────────────────────────────────────
  // Simulación principal
  // ───────────────────────────────────────────────────────────────────

  const allStats: PlayerStats[] = [];

  test('run: N players con flow completo (deposit/wheel/streak/bets)', async () => {
    console.log(
      `\n[sim] Arrancando con N=${N_PLAYERS} players, concurrency=${CONCURRENCY}`,
    );
    const t0 = Date.now();

    // Crear players (serial — el endpoint puede tener rate-limit).
    const players: TestPlayer[] = [];
    for (let i = 0; i < N_PLAYERS; i++) {
      const p = await createTestPlayer(adminApi, `sim-p${String(i).padStart(2, '0')}`);
      players.push(p);
    }
    console.log(`[sim] ${players.length} players creados en ${Date.now() - t0}ms`);

    // Fondear cada player con chips base (load — mint ya hicimos en beforeAll).
    for (const p of players) {
      await adminApi.post(
        '/tenant/wallet/load',
        { targetUserId: p.id, amount: BASE_FUND_CHIPS, notes: 'sim base fund' },
        {
          headers: {
            'Idempotency-Key': `sim-load-${p.id}-${Date.now()}`,
          },
        },
      );
    }
    console.log(`[sim] players fondeados con ${BASE_FUND_CHIPS} chips c/u`);

    // Procesar en batches paralelos.
    for (let i = 0; i < players.length; i += CONCURRENCY) {
      const batch = players.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map((p) => runPlayerFlow(p)));
      allStats.push(...results);
      console.log(
        `[sim] batch ${Math.floor(i / CONCURRENCY) + 1}/${Math.ceil(players.length / CONCURRENCY)} OK (${batch.length} players)`,
      );
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[sim] Flow completo en ${elapsed}s`);

    expect(allStats.length).toBe(N_PLAYERS);
    // Sanity: al menos algunos placed bets (sino la liga queda vacía).
    const playersWithBets = allStats.filter((s) => s.betsPlaced > 0).length;
    expect(playersWithBets).toBeGreaterThan(0);
  });

  // ───────────────────────────────────────────────────────────────────
  // Recompute league + reporte
  // ───────────────────────────────────────────────────────────────────

  test('league: recompute + close + reporte agregado', async () => {
    // Recompute para que las wallet_transactions con type=bet se
    // materialicen en standings.
    const recompute = await adminApi.post<{ participants: number }>(
      `/tenant/leagues/${leagueId}/recompute`,
      {},
    );
    console.log(
      `\n[sim] league recompute → ${recompute.participants} participantes`,
    );

    // Standings top 15 antes de cerrar.
    const standings = await adminApi.get<{
      top: Array<{ position: number; userId: string; score: string }>;
      around?: Array<{ position: number; userId: string; score: string }>;
      total: number;
    }>(`/tenant/leagues/${leagueId}/standings?topN=15`);
    console.log(`[sim] standings total=${standings.total}`);

    // Cerrar la liga para settled prizes.
    // NOTA: close exige que `endsAt` haya pasado. Para sim, hackeamos:
    // updateamos endsAt a NOW + 1s y esperamos.
    await adminApi.patch(`/tenant/leagues/${leagueId}`, {
      endsAt: new Date(Date.now() + 1000).toISOString(),
    });
    await new Promise((r) => setTimeout(r, 1500));

    let closeOk = false;
    try {
      await adminApi.post(`/tenant/leagues/${leagueId}/close`, {});
      closeOk = true;
      console.log(`[sim] league cerrada OK — premios settleados`);
    } catch (err) {
      console.warn(
        `[sim] no se pudo cerrar la liga: ${(err as Error).message.slice(0, 200)}`,
      );
    }

    // Final results (si se cerró).
    let results: Array<{
      userId: string;
      finalPosition: number;
      finalScore: string;
      prize?: unknown;
    }> = [];
    if (closeOk) {
      try {
        const r = await adminApi.get<{ data: typeof results }>(
          `/tenant/leagues/${leagueId}/results`,
        );
        results = r.data;
      } catch (err) {
        console.warn(`[sim] results fallo: ${(err as Error).message.slice(0, 120)}`);
      }
    }

    // ───────────────────────────────────────────────────────────────
    // REPORTE
    // ───────────────────────────────────────────────────────────────
    const usernameById = new Map<string, string>();
    for (const s of allStats) usernameById.set(s.player.id, s.player.username);

    console.log('\n');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('              REPORTE DE SIMULACIÓN DE ENGAGEMENT          ');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Players totales:     ${allStats.length}`);
    console.log(`Game usado:          ${game.code} (${game.name})`);

    // Aggregates.
    const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
    const totalBets = sum(allStats.map((s) => s.betsPlaced));
    const totalWagered = sum(allStats.map((s) => s.totalWagered));
    const totalWheelChips = sum(allStats.map((s) => s.wheelPrizeChips));
    const totalStreakChips = sum(allStats.map((s) => s.streakPrizeChips));
    const totalDepositsApproved = sum(allStats.map((s) => s.depositsApproved));
    const totalWelcome = sum(allStats.map((s) => s.welcomeBonus));
    const totalReload = sum(allStats.map((s) => s.reloadBonus));
    const playersWithWelcome = allStats.filter((s) => s.welcomeBonus > 0).length;
    const playersWithReload = allStats.filter((s) => s.reloadBonus > 0).length;
    const playersWithWheel = allStats.filter((s) => s.wheelPrizeChips > 0).length;
    const playersWithStreak = allStats.filter((s) => s.streakPrizeChips > 0).length;
    const playersWithErrors = allStats.filter((s) => s.errors.length > 0).length;

    console.log('\n── Bets / wagering ─────────────────────────────────────');
    console.log(`  Bets totales:       ${totalBets}`);
    console.log(`  Wagered total:      ${totalWagered.toLocaleString()} chips`);
    console.log(
      `  Promedio/player:    ${(totalBets / Math.max(1, allStats.length)).toFixed(1)} bets`,
    );

    console.log('\n── Deposits ────────────────────────────────────────────');
    console.log(`  Deposits aprobados: ${totalDepositsApproved}`);

    console.log('\n── Bonuses (auto-grant tras approve) ───────────────────');
    console.log(
      `  Welcome:  ${playersWithWelcome}/${allStats.length} players · ${totalWelcome.toLocaleString()} chips totales`,
    );
    console.log(
      `  Reload:   ${playersWithReload}/${allStats.length} players · ${totalReload.toLocaleString()} chips totales`,
    );

    console.log('\n── Promotions ──────────────────────────────────────────');
    console.log(
      `  Wheel:    ${playersWithWheel}/${allStats.length} ganaron · ${totalWheelChips.toLocaleString()} chips totales`,
    );
    console.log(
      `  Streak:   ${playersWithStreak}/${allStats.length} claims · ${totalStreakChips.toLocaleString()} chips totales`,
    );

    console.log('\n── League standings (top 10 antes del close) ──────────');
    const top = standings.top.slice(0, 10);
    for (const row of top) {
      const u = usernameById.get(row.userId) ?? row.userId.slice(0, 13);
      console.log(
        `  #${String(row.position).padStart(2)}  ${u.padEnd(28)} score=${row.score}`,
      );
    }
    if (top.length === 0) {
      console.log(
        '  (vacío — ningún bet quedó dentro de la ventana de la liga)',
      );
    }

    if (closeOk && results.length > 0) {
      console.log('\n── League FINAL results (post-close + premios) ────────');
      for (const r of results.slice(0, 10)) {
        const u = usernameById.get(r.userId) ?? r.userId.slice(0, 13);
        const prize = r.prize
          ? `prize=${JSON.stringify(r.prize)}`
          : 'sin premio';
        console.log(
          `  #${String(r.finalPosition).padStart(2)}  ${u.padEnd(28)} score=${r.finalScore}  ${prize}`,
        );
      }
    }

    if (playersWithErrors > 0) {
      console.log(`\n── Errores parciales (${playersWithErrors} players) ──`);
      // Frecuencia de cada tipo de error (prefijo antes de ':').
      const errCounts = new Map<string, number>();
      for (const s of allStats) {
        for (const e of s.errors) {
          const key = e.split(':').slice(0, 1)[0]!;
          errCounts.set(key, (errCounts.get(key) ?? 0) + 1);
        }
      }
      for (const [k, v] of [...errCounts.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${k.padEnd(20)} × ${v}`);
      }
      console.log('  ── samples ──');
      let printed = 0;
      for (const s of allStats) {
        if (printed >= 3) break;
        if (s.errors.length === 0) continue;
        console.log(`  ${s.player.username}: ${s.errors.slice(0, 2).join(' | ')}`);
        printed++;
      }
    }

    console.log('═══════════════════════════════════════════════════════════\n');

    // Asserts mínimos — la sim es "ver cómo funciona", no test de regresión.
    expect(recompute.participants).toBeGreaterThan(0);
  });

  // ─────────────────────────────────────────────────────────────────
  // Per-player flow
  // ─────────────────────────────────────────────────────────────────

  async function runPlayerFlow(player: TestPlayer): Promise<PlayerStats> {
    const stats: PlayerStats = {
      player,
      betsPlaced: 0,
      totalWagered: 0,
      wheelPrizeChips: 0,
      streakPrizeChips: 0,
      depositsApproved: 0,
      welcomeBonus: 0,
      reloadBonus: 0,
      errors: [],
    };

    const playerApi = await ApiClient.create();
    try {
      await loginAs(playerApi, player.username, player.password);

      // 1. Spin del wheel.
      try {
        const spin = await playerApi.post<{
          prize: { kind: string; amount?: number };
          segmentLabel?: string;
        }>(`/tenant/promotions/${wheelId}/spin`, {});
        if (spin.prize.kind === 'chips') {
          stats.wheelPrizeChips = Number(spin.prize.amount ?? 0);
        }
      } catch (err) {
        stats.errors.push(`wheel: ${shortErr(err)}`);
      }

      // 2. Claim login streak.
      try {
        const streak = await playerApi.post<{
          prize: { kind: string; amount?: number };
        }>(`/tenant/promotions/${streakId}/claim-streak`, {});
        if (streak.prize.kind === 'chips') {
          stats.streakPrizeChips = Number(streak.prize.amount ?? 0);
        }
      } catch (err) {
        stats.errors.push(`streak: ${shortErr(err)}`);
      }

      // 3. Launch game session.
      let sessionId: string | null = null;
      try {
        const launch = await playerApi.post<{ sessionId: string }>(
          `/tenant/games/code/${game.code}/launch`,
          {},
        );
        sessionId = launch.sessionId;
      } catch (err) {
        stats.errors.push(`launch: ${shortErr(err)}`);
      }

      // 4. N bets random.
      if (sessionId) {
        const nBets = randInt(BETS_MIN, BETS_MAX);
        for (let i = 0; i < nBets; i++) {
          const amount = randInt(10, 200); // 10–200 chips por bet.
          try {
            await playerApi.post(`/tenant/games/sessions/${sessionId}/bet`, {
              amount: String(amount),
            });
            stats.betsPlaced++;
            stats.totalWagered += amount;
          } catch (err) {
            stats.errors.push(`bet${i}: ${shortErr(err)}`);
            break; // bet falló (insuf balance probable) — paramos los bets.
          }
        }
        // Cerrar la session (idempotente).
        try {
          await playerApi.post(`/tenant/games/sessions/${sessionId}/close`, {});
        } catch {
          /* ignore */
        }
      }

      // 5. K deposits + approve (auto-grant bonus).
      for (let k = 0; k < DEPOSITS_PER_PLAYER; k++) {
        try {
          const proof = await uploadDepositProof(playerApi);
          const depAmount = String(randInt(500, 3000));
          const dep = await playerApi.post<{ deposit: { id: string } }>(
            '/tenant/deposits',
            {
              methodId,
              amountChips: depAmount,
              amountFiat: depAmount,
              currencyFiat: 'ARS',
              receiptUrl: proof.receiptUrl,
              receiptStorageKey: proof.receiptStorageKey,
            },
          );

          // Match bank_tx + approve.
          const bt = await adminApi.post<{ id: string }>(
            '/tenant/bank-transactions',
            {
              bankAccount: 'CBU-SIM',
              amount: depAmount,
              direction: 'incoming',
              receivedAt: new Date().toISOString(),
            },
          );
          await adminApi.post(
            `/tenant/bank-transactions/${bt.id}/match/${dep.deposit.id}`,
            {},
          );
          await adminApi.post(`/tenant/deposits/${dep.deposit.id}/approve`, {});
          stats.depositsApproved++;
        } catch (err) {
          stats.errors.push(`deposit${k}: ${shortErr(err)}`);
          break; // si falla uno, paramos (probable too_many_pending o similar).
        }
      }

      // 6. Leer bonos otorgados al player para reportar.
      try {
        const myBonuses = await playerApi.get<{
          data: Array<{
            definitionId: string;
            grantedAmount: string;
          }>;
        }>(`/tenant/bonuses/me`);
        for (const b of myBonuses.data) {
          const amt = Number(b.grantedAmount);
          if (b.definitionId === welcomeDefId) stats.welcomeBonus += amt;
          else if (b.definitionId === reloadDefId) stats.reloadBonus += amt;
        }
      } catch (err) {
        stats.errors.push(`bonuses-read: ${shortErr(err)}`);
      }
    } finally {
      await playerApi.dispose();
    }
    return stats;
  }
});

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shortErr(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > 100 ? msg.slice(0, 100) + '…' : msg;
}
