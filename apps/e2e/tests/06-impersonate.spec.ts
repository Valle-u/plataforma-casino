/**
 * Spec 6 — impersonate UI end-to-end (Sprint 37).
 *
 * Flujo:
 *   1. Admin logueado va a /users.
 *   2. Click en un player → drawer abre.
 *   3. Click "Impersonate" → ConfirmModal.
 *   4. Click confirm → redirect a /play.
 *   5. Banner sticky "Estás impersonando a @<player>" visible.
 *   6. Click "Volver" → vuelve al admin dashboard.
 *
 * Asume credentials del admin demo del seed (configurables via env).
 */

import { expect, test } from '@playwright/test';
import {
  ApiClient,
  createTestPlayer,
  loginAsAdmin,
  type TestPlayer,
} from './helpers/api';

const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'demo_admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'demo-pwd-2026';

let api: ApiClient;
let target: TestPlayer;

test.beforeAll(async () => {
  api = await ApiClient.create();
  await loginAsAdmin(api);
  target = await createTestPlayer(api, 'imp');
});

test.afterAll(async () => {
  await api.dispose();
});

test('admin impersona desde el drawer, ve banner, vuelve', async ({ page }) => {
  // Login del admin via UI (página /login, no /play/login).
  await page.goto('/login');
  await page.locator('input[id="username"], input[name="username"]').first().fill(ADMIN_USERNAME);
  await page.locator('input[type="password"]').first().fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /ingresar|entrar|iniciar/i }).first().click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });

  // Ir a /users, buscar al player target.
  await page.goto('/users');
  // Buscar la row con el username (puede estar paginada — usar search si existe).
  const searchInput = page
    .locator('input[type="search"], input[placeholder*="uscar"]')
    .first();
  if (await searchInput.count() > 0) {
    await searchInput.fill(target.username);
    await page.waitForTimeout(500); // debounce
  }
  // Click en la row.
  await page.getByText(target.username).first().click();

  // Drawer abre. Click "Impersonate".
  await page.getByRole('button', { name: /impersonate/i }).first().click();

  // ConfirmModal aparece. Click "Impersonate" (botón de confirm).
  await page.getByRole('button', { name: /^impersonate$/i }).last().click();

  // Redirect a /play. El banner sticky aparece arriba.
  await expect(page).toHaveURL(/\/play(?:\/.*)?$/, { timeout: 15_000 });
  await expect(
    page.getByText(/estás impersonando a/i).first(),
  ).toBeVisible({ timeout: 10_000 });

  // Click "Volver" → vuelve a /dashboard.
  await page.getByRole('button', { name: /^volver$/i }).first().click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
});
