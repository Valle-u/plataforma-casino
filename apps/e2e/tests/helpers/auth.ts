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
