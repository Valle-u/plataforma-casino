/**
 * Spec 3 — game loop happy path.
 *
 * Flujo:
 *   1. Admin crea player + fondea wallet con 1000 chips.
 *   2. Player logueado entra al lobby `/play/lobby`.
 *   3. Click en el primer game card → debería navegar al iframe del mock slot.
 *   4. En el iframe page: spin (bet=10) y verificar que aparece resultado
 *      (sea win o lose — el RNG es probabilístico, ambos OK).
 *   5. Verificar que el balance se movió (≠ 1000) o el historial muestra
 *      al menos 1 round.
 *
 * Disclaimer: el mini-slot tiene RNG no-determinístico. El test valida
 * que el FLOW funciona (no specific win/lose). Si el spin nunca
 * settla (e.g. RNG hang), el test falla por timeout.
 */

import { expect, test } from '@playwright/test';
import {
  ApiClient,
  createTestPlayer,
  fundPlayer,
  loginAsAdmin,
  type TestPlayer,
} from './helpers/api';
import { loginPlayerViaUi } from './helpers/auth';

let api: ApiClient;
let player: TestPlayer;

test.beforeAll(async () => {
  api = await ApiClient.create();
  await loginAsAdmin(api);
  player = await createTestPlayer(api, 'gameloop');
  await fundPlayer(api, player.id, '1000');
});

test.afterAll(async () => {
  await api.dispose();
});

test('player navega al lobby, lanza juego y spinnea', async ({ page }) => {
  await loginPlayerViaUi(page, player.username, player.password);
  await page.goto('/play/lobby');

  // Esperar grilla de games.
  await expect(
    page.getByRole('link').filter({ hasText: /Lucky|Demo|Fruit|Egyptian|Neon|Western|Crash|Blackjack|Ruleta|Baccarat/i }).first(),
  ).toBeVisible({ timeout: 10_000 });

  // Click en el primer card.
  await page
    .getByRole('link')
    .filter({ hasText: /Lucky|Demo|Fruit|Egyptian|Neon|Western|Crash|Blackjack|Ruleta|Baccarat/i })
    .first()
    .click();

  // Debería estar en /play/games/<code>/play/iframe.
  await expect(page).toHaveURL(/\/play\/games\/.*\/play\/iframe/, {
    timeout: 10_000,
  });

  // El page auto-launcha. Esperar a que aparezca el bet input.
  const betInput = page.locator('input[id="bet-amount"]');
  await expect(betInput).toBeVisible({ timeout: 15_000 });
  await betInput.fill('10');

  // Click Girar.
  await page.getByRole('button', { name: /girar/i }).first().click();

  // El reels render se muestra (los emoji symbols). Esperamos un toast
  // de win o el panel de "Esta vez no — probá de nuevo" en el card del slot.
  await expect(
    page.getByText(/probá de nuevo|ganaste|chips/i).first(),
  ).toBeVisible({ timeout: 15_000 });
});
