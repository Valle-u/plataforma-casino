/**
 * Spec 5 — responsible gaming self-exclusion.
 *
 * Flujo:
 *   1. Player logueado va a /play/settings.
 *   2. Setea cap diario de depósito = 100 vía UI.
 *   3. Verifica que el cap quedó persistido (refresh + ver el input).
 *   4. Se auto-excluye (cool_off + 1 día) vía UI.
 *   5. Logout.
 *   6. Intenta loguearse → recibe error de bloqueo.
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
  player = await createTestPlayer(api, 'rg');
});

test.afterAll(async () => {
  await api.dispose();
});

test('player setea cap diario via UI', async ({ page }) => {
  await loginPlayerViaUi(page, player.username, player.password);
  await page.goto('/play/settings');

  // Llenar el input "Diario".
  const dailyInput = page.locator('input[id="rg-daily"]');
  await dailyInput.fill('100');

  // Click Guardar.
  await page.getByRole('button', { name: /guardar l/i }).click();

  // Esperar toast de success.
  await expect(page.getByText(/actualizad/i).first()).toBeVisible({
    timeout: 10_000,
  });

  // Refresh para verificar persistencia.
  await page.reload();
  await expect(dailyInput).toHaveValue(/100/);
});

test('player se auto-excluye y queda bloqueado al re-loguear', async ({
  page,
}) => {
  // Crear un player FRESCO para este test (el anterior ya tiene cap pero
  // no exclusión).
  const fresh = await createTestPlayer(api, 'rg-excl');
  await loginPlayerViaUi(page, fresh.username, fresh.password);
  await page.goto('/play/settings');

  // Click en "Bloquear mi cuenta" (variant outline-accent).
  await page.getByRole('button', { name: /bloquear mi cuenta/i }).click();

  // ConfirmModal aparece. Click confirm.
  await page.getByRole('button', { name: /^bloquear cuenta$/i }).click();

  // Banner de exclusión visible.
  await expect(page.getByText(/tu cuenta está bloqueada/i).first()).toBeVisible({
    timeout: 10_000,
  });

  // Logout + intento re-login.
  await page
    .getByRole('button', { name: /cerrar sesi/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/play\/login/, { timeout: 10_000 });

  // Re-login: debe fallar con mensaje de exclusión.
  await page.locator('input[id="username"]').fill(fresh.username);
  await page.locator('input[id="password"]').fill(fresh.password);
  await page.getByRole('button', { name: /entrar/i }).first().click();

  // `.first()` evita strict-mode violation con __next-route-announcer__ (role=alert también).
  await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/auto-exclusi/i).first()).toBeVisible();
});
