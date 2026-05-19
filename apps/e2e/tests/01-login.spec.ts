/**
 * Spec 1 — login del jugador.
 *
 * Flujo:
 *   1. Admin crea un player via API.
 *   2. Player navega a /play/login, ingresa credentials, hace click Entrar.
 *   3. Verifica redirect a /play (home del jugador).
 *   4. Verifica que el header muestra el username (o nombre).
 *   5. Logout y verifica que vuelve a login.
 *
 * Disclaimer: selectores basados en el DOM actual del componente. Si el
 * design cambia (e.g. nuevo placeholder, texto de botón), ajustar acá.
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
  player = await createTestPlayer(api, 'login');
});

test.afterAll(async () => {
  await api.dispose();
});

test('player puede loguearse y ver el home', async ({ page }) => {
  await loginPlayerViaUi(page, player.username, player.password);
  // En /play debería aparecer el PlayerHeader con el nombre del user.
  // El componente muestra `user.displayName ?? user.username`.
  await expect(
    page.getByText(`E2E login`, { exact: false }).first(),
  ).toBeVisible({ timeout: 10_000 });
});

test('credentials inválidas muestran error', async ({ page }) => {
  await page.goto('/play/login');
  await page.locator('input[id="username"]').fill(player.username);
  await page.locator('input[id="password"]').fill('password-incorrecta');
  await page.getByRole('button', { name: /entrar/i }).first().click();
  // El form muestra serverError en un alert.
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(/\/play\/login/);
});

test('logout vuelve a login', async ({ page }) => {
  await loginPlayerViaUi(page, player.username, player.password);
  // Botón logout: aria-label "Cerrar sesión" en PlayerHeader.
  await page
    .getByRole('button', { name: /cerrar sesi/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/play\/login/, { timeout: 10_000 });
});
