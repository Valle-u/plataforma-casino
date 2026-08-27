/**
 * Helper para logearse al player via UI.
 *
 * El auth del jugador pasó a MODALES: `app/play/login/page.tsx` quedó como
 * stub de compatibilidad que hace `router.replace('/play?auth=login')` y no
 * renderiza formulario. La versión anterior de este helper iba a
 * `/play/login` y esperaba inputs que ahí no existen — colgaba hasta el
 * timeout. Ahora se entra directo por el query param que abre el modal.
 */

import { expect, type Page } from '@playwright/test';

export async function loginPlayerViaUi(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await page.goto('/play?auth=login');
  const usernameInput = page.locator('input[name="username"]').first();
  await usernameInput.waitFor({ state: 'visible', timeout: 20_000 });
  await usernameInput.fill(username);
  await page.locator('input[name="password"]').first().fill(password);
  await page
    .getByRole('button', { name: /^(entrar|ingresar)$/i })
    .first()
    .click();
  // El modal se desmonta al loguear: es la señal fiable de éxito (la URL
  // ya era /play antes de entrar, así que no distingue).
  await expect(page.locator('input[name="password"]')).toHaveCount(0, {
    timeout: 20_000,
  });
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
