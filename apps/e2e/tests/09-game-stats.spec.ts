/**
 * Spec 9 — Game Stats (Sprint 46).
 *
 * Valida que admin accede a /game-stats con las 4 tabs, los endpoints
 * de reporting devuelven shape esperado, y la flag de RTP divergencia
 * se calcula correctamente.
 */

import { expect, test } from '@playwright/test';
import { ApiClient, loginAsAdmin } from './helpers/api';
import { loginAdminViaUi } from './helpers/auth';

let api: ApiClient;

test.beforeAll(async () => {
  api = await ApiClient.create();
  await loginAsAdmin(api);
});

test.afterAll(async () => {
  await api.dispose();
});

test('admin ve la página game-stats con las 4 tabs', async ({ page }) => {
  await loginAdminViaUi(page);
  await page.goto('/game-stats');

  await expect(
    page.getByRole('heading', { name: /estad[ií]sticas de juego/i }),
  ).toBeVisible({ timeout: 10_000 });

  await expect(page.getByRole('button', { name: /^resumen$/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^por juego$/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^por jugador$/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^rondas$/i })).toBeVisible();
});

test('/summary devuelve estructura GGR + RTP', async () => {
  const res = await api.get<{
    bucket: string;
    totalBet: string;
    totalWin: string;
    ggr: string;
    rtpRealPct: string;
    roundsCount: number;
    uniquePlayers: number;
    rolledBackCount: number;
  }>('/tenant/game-stats/summary');

  expect(res.bucket).toMatch(/today|7d|30d|custom/);
  expect(typeof res.totalBet).toBe('string');
  expect(typeof res.totalWin).toBe('string');
  expect(typeof res.ggr).toBe('string');
  expect(typeof res.rtpRealPct).toBe('string');
  expect(typeof res.roundsCount).toBe('number');
  expect(typeof res.uniquePlayers).toBe('number');
  expect(typeof res.rolledBackCount).toBe('number');
});

test('/by-game incluye RTP target y flag de divergencia', async () => {
  const rows = await api.get<
    Array<{
      gameCode: string;
      rtpTargetPct: number | null;
      rtpRealPct: string;
      rtpDivergencePts: string | null;
      flagged: boolean;
    }>
  >('/tenant/game-stats/by-game');

  if (rows.length > 0) {
    const r = rows[0]!;
    expect(typeof r.gameCode).toBe('string');
    expect(typeof r.rtpRealPct).toBe('string');
    expect(typeof r.flagged).toBe('boolean');
    // Si rtpTargetPct existe, divergence debe estar definida también.
    if (r.rtpTargetPct !== null) {
      expect(r.rtpDivergencePts).not.toBeNull();
    }
  }
});

test('/by-player respeta limit y ordena por volumen', async () => {
  const rows = await api.get<
    Array<{
      userId: string;
      totalBet: string;
      netAmount: string;
      roundsCount: number;
    }>
  >('/tenant/game-stats/by-player?limit=10');

  expect(rows.length).toBeLessThanOrEqual(10);
  // Si hay >=2 rows, verificar orden descendente por totalBet.
  if (rows.length >= 2) {
    expect(Number(rows[0]!.totalBet)).toBeGreaterThanOrEqual(Number(rows[1]!.totalBet));
  }
});

test('/rounds paginated con outcome filter', async () => {
  const res = await api.get<{
    data: Array<{ outcome: 'win' | 'loss' | 'zero' }>;
    total: number;
    limit: number;
    hasMore: boolean;
  }>('/tenant/game-stats/rounds?outcome=win&limit=10');

  expect(res.limit).toBe(10);
  expect(typeof res.total).toBe('number');
  // Si hay rounds, todos deben ser win.
  for (const r of res.data) {
    expect(r.outcome).toBe('win');
  }
});
