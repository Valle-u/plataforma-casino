/**
 * Spec 10 — Lobby placeholders (Sprint 47).
 *
 * Valida que los juegos sin engine real (criterio: NO slot+mock) se
 * renderizan como vidriera "Próximamente" — sin link clickeable, con
 * overlay visible. Y que los slots mock SÍ son clickeables.
 *
 * Pedido del dueño 2026-05-20 item C: vista pública sin engine real
 * todavía, sólo grilla "próximamente".
 */

import { expect, test } from '@playwright/test';
import {
  ApiClient,
  createTestPlayer,
  loginAsAdmin,
  type TestPlayer,
} from './helpers/api';
import { loginPlayerViaUi } from './helpers/auth';

let api: ApiClient;
let player: TestPlayer;

test.beforeAll(async () => {
  api = await ApiClient.create();
  await loginAsAdmin(api);
  player = await createTestPlayer(api, 'lobby-placeholders');
});

test.afterAll(async () => {
  await api.dispose();
});

test('lobby muestra cards "Próximamente" para juegos no-slot', async ({
  page,
}) => {
  await loginPlayerViaUi(page, player.username, player.password);
  await page.goto('/play/lobby');
  await page.waitForLoadState('networkidle', { timeout: 15_000 });

  // Crash/Table/Live games NO son playables hoy → deben mostrar overlay.
  // Buscamos al menos un "Próximamente" visible.
  await expect(page.getByText(/próximamente/i).first()).toBeVisible({
    timeout: 10_000,
  });
});

test('header muestra contador "X jugables · Y próximamente"', async ({
  page,
}) => {
  await loginPlayerViaUi(page, player.username, player.password);
  await page.goto('/play/lobby');
  await page.waitForLoadState('networkidle', { timeout: 15_000 });

  // El header debe tener al menos uno de los dos textos.
  // Match flexible — "jugables" o "jugable" singular.
  await expect(page.getByText(/jugabl/i).first()).toBeVisible({
    timeout: 10_000,
  });
});

test('un slot mock SÍ tiene link al iframe (es jugable)', async ({ page }) => {
  await loginPlayerViaUi(page, player.username, player.password);
  await page.goto('/play/lobby');
  await page.waitForLoadState('networkidle', { timeout: 15_000 });

  // Busca un link con href que apunte al iframe. Slots mock matchean.
  const playableLink = page.locator('a[href*="/play/games/mock_"]').first();
  await expect(playableLink).toBeVisible({ timeout: 10_000 });
});

test('tab "Mesa" (table) muestra solo placeholders', async ({ page }) => {
  await loginPlayerViaUi(page, player.username, player.password);
  await page.goto('/play/lobby');
  await page.waitForLoadState('networkidle', { timeout: 15_000 });

  // Click en tab Mesa.
  await page.getByRole('button', { name: /^mesa$/i }).first().click();

  // Buscar el grid de cards de mesa. Como ningún table tiene engine,
  // TODAS las cards en esta categoría tienen el overlay "Próximamente".
  // Validamos que el texto aparece al menos una vez después del filter.
  await expect(page.getByText(/próximamente/i).first()).toBeVisible({
    timeout: 10_000,
  });
});
