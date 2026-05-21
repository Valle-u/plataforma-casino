/**
 * Spec 18 — Reset password de inferiores en la jerarquía (Sprint 51.4).
 *
 * Regla del dueño: rangos mayores pueden resetear la password de sus
 * downstream. Socio1 puede sobre cajero1/distrib1/usuario1 (sus hijos),
 * pero NO sobre socio2 ni su red. Admin puede sobre todos.
 *
 * Validaciones:
 *   - Admin resetea a cualquiera → 200 OK.
 *   - Socio1 resetea a downstream → 200 OK + el target puede loguearse
 *     con la nueva password.
 *   - Socio1 intenta resetear a socio2 (out of scope) → 403 OUT_OF_SCOPE.
 *   - Socio1 intenta resetear a un user de la red de socio2 → 403.
 *   - Cajero1 resetea a usuario1 (su hijo directo) → 200 OK.
 *   - Self-reset → 400 CANNOT_RESET_OWN_PASSWORD.
 *   - Password muy corta → 400.
 *   - Sin permiso `users.reset_password` → 403 (no aplica a roles del seed
 *     por default — socio/distrib/cajero la tienen).
 *   - Notificación al target enqueueada (in_app + email).
 */

import { expect, test } from '@playwright/test';
import {
  ApiClient,
  createTestPlayer,
  createTestUserWithRole,
  loginAs,
  loginAsAdmin,
  setUserParent,
  type TestPlayer,
} from './helpers/api';

interface ResetResponse {
  user: { id: string; username: string };
  by: string;
  sessionsInvalidated: false;
}

interface NotificationRow {
  id: string;
  userId: string;
  kind: string;
  channel: string;
  status: string;
}

test.describe('Reset password downstream (Sprint 51.4)', () => {
  let adminApi: ApiClient;

  // Red 1: socio1 → distrib1 → cajero1 → usuario1.
  let socio1: TestPlayer;
  let socio1Api: ApiClient;
  let distrib1: TestPlayer;
  let cajero1: TestPlayer;
  let cajero1Api: ApiClient;
  let usuario1: TestPlayer;

  // Red 2: socio2 → cajero2 → usuario2.
  let socio2: TestPlayer;
  let cajero2: TestPlayer;
  let usuario2: TestPlayer;

  test.beforeAll(async () => {
    adminApi = await ApiClient.create();
    await loginAsAdmin(adminApi);

    // Red 1.
    socio1 = await createTestUserWithRole(adminApi, 'sp18-socio1', 'socio');
    distrib1 = await createTestUserWithRole(adminApi, 'sp18-distrib1', 'distribuidor');
    cajero1 = await createTestUserWithRole(adminApi, 'sp18-cajero1', 'cajero');
    usuario1 = await createTestPlayer(adminApi, 'sp18-usuario1');
    await setUserParent(adminApi, distrib1.id, socio1.id);
    await setUserParent(adminApi, cajero1.id, distrib1.id);
    await setUserParent(adminApi, usuario1.id, cajero1.id);

    // Red 2.
    socio2 = await createTestUserWithRole(adminApi, 'sp18-socio2', 'socio');
    cajero2 = await createTestUserWithRole(adminApi, 'sp18-cajero2', 'cajero');
    usuario2 = await createTestPlayer(adminApi, 'sp18-usuario2');
    await setUserParent(adminApi, cajero2.id, socio2.id);
    await setUserParent(adminApi, usuario2.id, cajero2.id);

    socio1Api = await ApiClient.create();
    await loginAs(socio1Api, socio1.username, socio1.password);

    cajero1Api = await ApiClient.create();
    await loginAs(cajero1Api, cajero1.username, cajero1.password);
  });

  test.afterAll(async () => {
    await adminApi.dispose();
    if (socio1Api) await socio1Api.dispose();
    if (cajero1Api) await cajero1Api.dispose();
  });

  // ──────────────────────────────────────────────────────────────────

  test('admin resetea password de cualquier user → 200 + login con nueva pass', async () => {
    const newPwd = 'admin-new-pwd-2026';
    const res = await adminApi.post<ResetResponse>(
      `/tenant/users/${usuario2.id}/reset-password`,
      { newPassword: newPwd, reason: 'spec 18 admin reset' },
    );
    expect(res.user.id).toBe(usuario2.id);
    expect(res.sessionsInvalidated).toBe(false);

    // Login con la nueva.
    const checkApi = await ApiClient.create();
    const login = await checkApi.post<{ accessToken: string }>(
      '/tenant/auth/login',
      { username: usuario2.username, password: newPwd },
    );
    expect(login.accessToken).toBeDefined();
    await checkApi.dispose();

    // Restaurar para no romper otros tests potencialmente paralelos.
    await adminApi.post(`/tenant/users/${usuario2.id}/reset-password`, {
      newPassword: usuario2.password,
    });
  });

  test('socio1 resetea password de cajero1 (downstream) → 200 + login OK', async () => {
    const newPwd = 'socio-new-pwd-2026';
    const res = await socio1Api.post<ResetResponse>(
      `/tenant/users/${cajero1.id}/reset-password`,
      { newPassword: newPwd, reason: 'spec 18 socio reset cajero' },
    );
    expect(res.user.id).toBe(cajero1.id);

    const checkApi = await ApiClient.create();
    const login = await checkApi.post<{ accessToken: string }>(
      '/tenant/auth/login',
      { username: cajero1.username, password: newPwd },
    );
    expect(login.accessToken).toBeDefined();
    await checkApi.dispose();

    // Restaurar.
    await socio1Api.post(`/tenant/users/${cajero1.id}/reset-password`, {
      newPassword: cajero1.password,
    });
  });

  test('socio1 resetea password de usuario1 (3 niveles abajo) → 200', async () => {
    const newPwd = 'socio-resets-player-2026';
    const res = await socio1Api.post<ResetResponse>(
      `/tenant/users/${usuario1.id}/reset-password`,
      { newPassword: newPwd },
    );
    expect(res.user.id).toBe(usuario1.id);
    // Restaurar.
    await socio1Api.post(`/tenant/users/${usuario1.id}/reset-password`, {
      newPassword: usuario1.password,
    });
  });

  test('cajero1 resetea password de usuario1 (su hijo directo) → 200', async () => {
    const newPwd = 'cajero-resets-player-2026';
    const res = await cajero1Api.post<ResetResponse>(
      `/tenant/users/${usuario1.id}/reset-password`,
      { newPassword: newPwd },
    );
    expect(res.user.id).toBe(usuario1.id);
    await cajero1Api.post(`/tenant/users/${usuario1.id}/reset-password`, {
      newPassword: usuario1.password,
    });
  });

  test('socio1 intenta resetear a socio2 (otra red) → 403 OUT_OF_SCOPE', async () => {
    const res = await socio1Api.postRaw(
      `/tenant/users/${socio2.id}/reset-password`,
      { newPassword: 'shouldnt-work-2026' },
    );
    expect(res.status).toBe(403);
    const body = res.body as { error?: string };
    expect(body.error).toBe('OUT_OF_SCOPE');
  });

  test('socio1 intenta resetear a usuario2 (red de socio2) → 403', async () => {
    const res = await socio1Api.postRaw(
      `/tenant/users/${usuario2.id}/reset-password`,
      { newPassword: 'shouldnt-work-2026' },
    );
    expect(res.status).toBe(403);
    const body = res.body as { error?: string };
    expect(body.error).toBe('OUT_OF_SCOPE');
  });

  test('cajero1 intenta resetear a distrib1 (su padre, upstream) → 403', async () => {
    const res = await cajero1Api.postRaw(
      `/tenant/users/${distrib1.id}/reset-password`,
      { newPassword: 'cant-touch-upstream-2026' },
    );
    expect(res.status).toBe(403);
    const body = res.body as { error?: string };
    expect(body.error).toBe('OUT_OF_SCOPE');
  });

  test('reset password de uno mismo → 400 CANNOT_RESET_OWN_PASSWORD', async () => {
    const res = await socio1Api.postRaw(
      `/tenant/users/${socio1.id}/reset-password`,
      { newPassword: 'changing-my-own-2026' },
    );
    expect(res.status).toBe(400);
    const body = res.body as { error?: string };
    expect(body.error).toBe('CANNOT_RESET_OWN_PASSWORD');
  });

  test('password muy corta → 400', async () => {
    const res = await socio1Api.postRaw(
      `/tenant/users/${cajero1.id}/reset-password`,
      { newPassword: 'short' },
    );
    expect(res.status).toBe(400);
  });

  test('player (sin acceso al panel) → 403 NOT_PANEL_USER', async () => {
    // Player no entra al controller — el @PanelOnly() lo bloquea.
    const playerApi = await ApiClient.create();
    await loginAs(playerApi, usuario1.username, usuario1.password);
    const res = await playerApi.postRaw(
      `/tenant/users/${usuario1.id}/reset-password`,
      { newPassword: 'whatever-pwd-2026' },
    );
    expect(res.status).toBe(403);
    await playerApi.dispose();
  });

  test('notificación password_reset_by_admin se enqueuea al target', async () => {
    const newPwd = 'notif-check-2026';
    await socio1Api.post(`/tenant/users/${cajero1.id}/reset-password`, {
      newPassword: newPwd,
      reason: 'spec 18 notif test',
    });

    // Polling corto del listado de notifications del target (admin endpoint).
    let found = false;
    for (let i = 0; i < 10 && !found; i++) {
      const list = await adminApi.get<{ data: NotificationRow[] }>(
        `/tenant/notifications?userId=${cajero1.id}&limit=20`,
      );
      found = list.data.some(
        (n) => n.kind === 'password_reset_by_admin' && n.userId === cajero1.id,
      );
      if (!found) await new Promise((r) => setTimeout(r, 100));
    }
    expect(found).toBe(true);

    // Restaurar password.
    await socio1Api.post(`/tenant/users/${cajero1.id}/reset-password`, {
      newPassword: cajero1.password,
    });
  });
});
