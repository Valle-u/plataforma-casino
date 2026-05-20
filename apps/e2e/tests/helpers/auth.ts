/**
 * Helper para logearse al player via UI.
 *
 * Asunción del DOM: la página `/play/login` tiene inputs con
 * `name="username"` y `name="password"` (o `id` equivalente) + un botón
 * submit. Si emerge "no encuentra el input", chequear el componente
 * `app/play/login/page.tsx` y ajustar los selectors acá.
 */

import { expect, type Page } from '@playwright/test';

export async function loginPlayerViaUi(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await page.goto('/play/login');
  // Selectores flexibles: aceptan placeholder o name.
  const usernameInput = page
    .locator('input[name="username"], input[id="username"], input[type="text"]')
    .first();
  const passwordInput = page.locator('input[type="password"]').first();
  await usernameInput.fill(username);
  await passwordInput.fill(password);
  await page
    .getByRole('button', { name: /entrar|login|iniciar/i })
    .first()
    .click();
  // Esperar redirect post-login. El layout protege /play/* y redirige
  // si no hay user — al loguearse, el `useEffect` no redirige y queda en
  // /play (home).
  await expect(page).toHaveURL(/\/play(?:\/.*)?$/, { timeout: 10_000 });
}

/**
 * Login al admin via UI (Sprint 45). Pega a `/login` con audience='panel'
 * implícito (el form admin lo pasa). Redirect a /dashboard.
 *
 * Default creds: demo_admin / demo-pwd-2026. Override via env si hace falta.
 */
export async function loginAdminViaUi(
  page: Page,
  username = process.env.E2E_ADMIN_USERNAME ?? 'demo_admin',
  password = process.env.E2E_ADMIN_PASSWORD ?? 'demo-pwd-2026',
): Promise<void> {
  await page.goto('/login');
  await page.locator('input[id="username"]').fill(username);
  await page.locator('input[id="password"]').fill(password);
  await page.getByRole('button', { name: /ingresar/i }).first().click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
}
