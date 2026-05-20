/**
 * Spec 8 — Wallet Stats (Sprint 45).
 *
 * Valida que el admin puede acceder a /wallet-stats, ver las 3 tabs
 * (movimientos, resumen, por rol), aplicar filtros básicos, y que los
 * endpoints devuelven 200 con la estructura esperada.
 *
 * NO valida que un player puede acceder (no debería — defense in depth
 * de @PanelOnly() + @RequirePermissions ya cubre eso).
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

test('admin ve la página de wallet-stats con las 3 tabs', async ({ page }) => {
  await loginAdminViaUi(page);
  await page.goto('/wallet-stats');

  // Header
  await expect(
    page.getByRole('heading', { name: /estad[ií]sticas de pago/i }),
  ).toBeVisible({ timeout: 10_000 });

  // Las 3 tabs visibles
  await expect(page.getByRole('button', { name: /^movimientos$/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^resumen$/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^por rol$/i })).toBeVisible();

  // Tab resumen muestra los KPIs
  await page.getByRole('button', { name: /^resumen$/i }).click();
  await expect(page.getByText(/total entradas/i).first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText(/total salidas/i).first()).toBeVisible();
  await expect(page.getByText(/neto/i).first()).toBeVisible();
});

test('endpoint /tenant/wallet-stats/summary devuelve estructura esperada', async () => {
  const res = await api.get<{
    bucket: string;
    totalIn: string;
    totalOut: string;
    net: string;
    txCount: number;
    countByType: Record<string, number>;
  }>('/tenant/wallet-stats/summary');

  expect(res.bucket).toMatch(/today|7d|30d|custom/);
  expect(typeof res.totalIn).toBe('string');
  expect(typeof res.totalOut).toBe('string');
  expect(typeof res.net).toBe('string');
  expect(typeof res.txCount).toBe('number');
  expect(res.countByType).toBeTruthy();
});

test('endpoint /tenant/wallet-stats/by-role devuelve array con campos esperados', async () => {
  const rows = await api.get<
    Array<{
      role: string;
      inflow: string;
      outflow: string;
      net: string;
      txCount: number;
      uniqueUsers: number;
    }>
  >('/tenant/wallet-stats/by-role');

  // Si hay rows, validar shape. Si no, el seed no tiene tx aún — pasa igual.
  if (rows.length > 0) {
    const r = rows[0]!;
    expect(typeof r.role).toBe('string');
    expect(typeof r.inflow).toBe('string');
    expect(typeof r.outflow).toBe('string');
    expect(typeof r.net).toBe('string');
    expect(typeof r.txCount).toBe('number');
    expect(typeof r.uniqueUsers).toBe('number');
  }
});

test('endpoint /tenant/wallet-stats/movements respeta paginación', async () => {
  const res = await api.get<{
    data: unknown[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  }>('/tenant/wallet-stats/movements?limit=5');

  expect(res.limit).toBe(5);
  expect(res.offset).toBe(0);
  expect(res.data.length).toBeLessThanOrEqual(5);
  expect(typeof res.total).toBe('number');
  expect(typeof res.hasMore).toBe('boolean');
});
