/**
 * Spec 11 — Bonus wizard (Sprint 48).
 *
 * Valida que el admin puede crear una plantilla de bono via el wizard
 * step-by-step sin tocar JSON crudo. Pedido del dueño item D.
 *
 * Flow:
 *   1. Abre el wizard via botón "Nueva plantilla".
 *   2. Elige el tipo "Bienvenida" en step 1.
 *   3. Llena nombre y código en step 2.
 *   4. Ajusta config (slider matchPct + max) en step 3.
 *   5. Confirma expiration en step 4.
 *   6. Verifica preview + crea.
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

test('admin abre el wizard y ve step 1 con tipos visuales', async ({ page }) => {
  await loginAdminViaUi(page);
  await page.goto('/bonus-definitions');

  // Click "Nueva plantilla" (botón con sparkles).
  await page.getByRole('button', { name: /nueva plantilla/i }).first().click();

  // Step 1: ve el título + las cards de tipo.
  await expect(page.getByText(/¿qué tipo de bono querés crear?/i)).toBeVisible({
    timeout: 10_000,
  });

  // Las cards de tipo deben estar visibles.
  await expect(page.getByText('Bienvenida').first()).toBeVisible();
  await expect(page.getByText('Recarga').first()).toBeVisible();
  await expect(page.getByText('Sin depósito').first()).toBeVisible();
});

test('presets pre-cargan el wizard y avanzan al step 2', async ({ page }) => {
  await loginAdminViaUi(page);
  await page.goto('/bonus-definitions');

  await page.getByRole('button', { name: /nueva plantilla/i }).first().click();

  // Click preset "Bienvenida 100%".
  await page.getByText(/bienvenida 100%/i).first().click();

  // El preset debe avanzar al step 2 + pre-cargar el nombre.
  await expect(page.getByText(/identificá la plantilla/i)).toBeVisible({
    timeout: 5_000,
  });

  // El input del nombre debe tener el valor del preset.
  const nameInput = page.locator('input#bw-name');
  await expect(nameInput).toHaveValue(/bono de bienvenida/i);
});

test('wizard crea una plantilla end-to-end desde un preset', async ({
  page,
}) => {
  await loginAdminViaUi(page);
  await page.goto('/bonus-definitions');

  await page.getByRole('button', { name: /nueva plantilla/i }).first().click();

  // Step 1 → click preset "Sin depósito $500".
  await page.getByText(/sin depósito \$500/i).first().click();

  // El preset salta a step 2 — esperar el input.
  const nameInput = page.locator('input#bw-name');
  await expect(nameInput).toBeVisible({ timeout: 5_000 });

  // Hacer único el código para no colisionar con corridas previas.
  const code = `wz_nodep_${Date.now()}`;
  await page.locator('input#bw-code').fill(code);

  // Siguiente: step 2 → 3
  await page.getByRole('button', { name: /siguiente/i }).first().click();

  // Step 3: defaults del preset ya están OK. Siguiente.
  await page.getByRole('button', { name: /siguiente/i }).first().click();

  // Step 4: defaults OK. Siguiente.
  await page.getByRole('button', { name: /siguiente/i }).first().click();

  // Step 5: preview + crear.
  await expect(page.getByText(/revisión final/i)).toBeVisible({ timeout: 5_000 });
  await page.getByRole('button', { name: /crear plantilla/i }).first().click();

  // Toast + cierre.
  await expect(page.getByText(/plantilla creada/i).first()).toBeVisible({
    timeout: 10_000,
  });
});

test('botón "Avanzado" sigue funcionando para usuarios power', async ({
  page,
}) => {
  await loginAdminViaUi(page);
  await page.goto('/bonus-definitions');

  // El botón "Avanzado" abre el modal viejo con JSON crudo.
  await page.getByRole('button', { name: /^avanzado$/i }).first().click();

  // El modal viejo tiene el title "Crear definition de bono".
  await expect(
    page.getByText(/crear definition de bono/i).first(),
  ).toBeVisible({ timeout: 5_000 });
});
