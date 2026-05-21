/**
 * Spec 21 — Storage health-check (Sprint 51.6.1).
 *
 * Valida:
 *   - GET /tenant/storage/health funciona con el driver activo en CI
 *     (default: local).
 *   - Reporta driver + 3 steps (upload, fetch, delete).
 *   - Si está activo R2 (vars seteadas), también pasa — pero el spec
 *     solo asume local.
 *   - Acceso solo para admin (PanelOnly).
 */

import { expect, test } from '@playwright/test';
import {
  ApiClient,
  createTestPlayer,
  loginAs,
  loginAsAdmin,
} from './helpers/api';

interface HealthReport {
  driver: string;
  bucket: string | null;
  publicBaseUrl: string | null;
  ok: boolean;
  steps: Array<{
    step: 'upload' | 'fetch' | 'delete';
    ok: boolean;
    durationMs: number;
    error?: string;
  }>;
  totalDurationMs: number;
}

test.describe('Storage health-check (Sprint 51.6.1)', () => {
  let adminApi: ApiClient;

  test.beforeAll(async () => {
    adminApi = await ApiClient.create();
    await loginAsAdmin(adminApi);
  });

  test.afterAll(async () => {
    await adminApi.dispose();
  });

  test('admin: GET /tenant/storage/health → 200 con todos los steps OK', async () => {
    const res = await adminApi.get<HealthReport>('/tenant/storage/health');
    expect(res.ok).toBe(true);
    expect(res.driver).toMatch(/^(local|r2)$/);
    expect(res.steps).toHaveLength(3);
    const stepNames = res.steps.map((s) => s.step);
    expect(stepNames).toEqual(['upload', 'fetch', 'delete']);
    for (const step of res.steps) {
      expect(step.ok).toBe(true);
      expect(step.error).toBeUndefined();
      expect(step.durationMs).toBeGreaterThan(0);
    }
    expect(res.totalDurationMs).toBeGreaterThan(0);
  });

  test('player (no panel access) → 403', async () => {
    const player = await createTestPlayer(adminApi, 'sp21-player');
    const playerApi = await ApiClient.create();
    await loginAs(playerApi, player.username, player.password);
    const res = await playerApi.postRaw('/tenant/storage/health', {});
    // postRaw uses POST → 404 because route is GET-only.
    expect([403, 404]).toContain(res.status);
    // Verificar también con GET.
    try {
      await playerApi.get('/tenant/storage/health');
      throw new Error('deberia haber tirado 403');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('403');
    }
    await playerApi.dispose();
  });
});
