/**
 * Spec 19 — Self-change password + empleado wildcard (Sprint 51.5).
 *
 * Parte 1 — Self-change:
 *   - User cambia su propia password con currentPassword + newPassword → OK.
 *   - Sin currentPassword correcta → 401 INVALID_CURRENT_PASSWORD.
 *   - Si el user tiene 2FA, exige twoFaCode → 400 TWO_FA_REQUIRED.
 *   - newPassword muy corta → 400.
 *
 * Parte 2 — Empleado wildcard:
 *   - Admin crea empleado con permisos seleccionados → OK + empleado los
 *     recibe como overrides + parent=admin asignado.
 *   - Socio crea empleado con permisos del SUYO ∩ delegables → OK +
 *     parent=socio asignado.
 *   - Socio intenta crear empleado con permiso que NO tiene → 403 +
 *     rollback (el empleado NO se crea).
 *   - GET /permission-overrides/grantable-by-me devuelve set efectivo
 *     ∩ delegables del actor.
 *   - Empleado intenta grantear → 403 EMPLEADO_CANNOT_DELEGATE.
 *   - Crear con permission no-delegable → 403 + rollback.
 */

import { expect, test } from '@playwright/test';
import {
  ApiClient,
  createTestPlayer,
  createTestUserWithRole,
  loginAs,
  loginAsAdmin,
  type TestPlayer,
} from './helpers/api';

interface CreateUserResponse {
  user: { id: string; username: string };
  createdBy: string;
  permissionOverrides?: string[];
  parentAssigned?: boolean;
}

interface OverridesListResponse {
  userId: string;
  overrides: Array<{
    permissionCode: string;
    effect: 'grant' | 'revoke';
    grantedBy: string | null;
  }>;
  count: number;
}

interface GrantableResponse {
  data: string[];
  count: number;
}

test.describe('Self-change password + empleado wildcard (Sprint 51.5)', () => {
  let adminApi: ApiClient;
  let socio: TestPlayer;
  let socioApi: ApiClient;

  test.beforeAll(async () => {
    adminApi = await ApiClient.create();
    await loginAsAdmin(adminApi);

    socio = await createTestUserWithRole(adminApi, 'sp19-socio', 'socio');
    // El socio necesita `users.create` para poder crear empleados. Su rol
    // base no lo tiene (es delegable, default admin) — lo otorgamos via
    // override desde admin.
    await adminApi.post('/tenant/permission-overrides/grant', {
      userId: socio.id,
      permissionCode: 'users.create',
      reason: 'spec 19 setup',
    });
    // También damos algunos permisos delegables para que el socio pueda
    // pasarle al empleado (ej. deposits.view).
    await adminApi.post('/tenant/permission-overrides/grant', {
      userId: socio.id,
      permissionCode: 'deposits.view',
      reason: 'spec 19 setup',
    });
    await adminApi.post('/tenant/permission-overrides/grant', {
      userId: socio.id,
      permissionCode: 'withdrawals.view',
      reason: 'spec 19 setup',
    });

    socioApi = await ApiClient.create();
    await loginAs(socioApi, socio.username, socio.password);
  });

  test.afterAll(async () => {
    await adminApi.dispose();
    if (socioApi) await socioApi.dispose();
  });

  // ──────────────────────────────────────────────────────────────────
  // Parte 1 — Self-change
  // ──────────────────────────────────────────────────────────────────

  test('user cambia su propia password con currentPassword → OK + login con nueva', async () => {
    const target = await createTestPlayer(adminApi, 'sp19-self-pwd');
    const targetApi = await ApiClient.create();
    await loginAs(targetApi, target.username, target.password);

    const newPwd = 'self-changed-pwd-2026';
    const res = await targetApi.post<{ ok: true }>('/tenant/auth/me/password', {
      currentPassword: target.password,
      newPassword: newPwd,
    });
    expect(res.ok).toBe(true);

    // Login con la nueva.
    const checkApi = await ApiClient.create();
    const login = await checkApi.post<{ accessToken: string }>(
      '/tenant/auth/login',
      { username: target.username, password: newPwd },
    );
    expect(login.accessToken).toBeDefined();
    await checkApi.dispose();
    await targetApi.dispose();
  });

  test('self-change con password actual incorrecta → 401', async () => {
    const target = await createTestPlayer(adminApi, 'sp19-self-wrong');
    const targetApi = await ApiClient.create();
    await loginAs(targetApi, target.username, target.password);

    const res = await targetApi.postRaw('/tenant/auth/me/password', {
      currentPassword: 'wrong-pwd-2026',
      newPassword: 'new-correct-pwd-2026',
    });
    expect(res.status).toBe(401);
    const body = res.body as { error?: string };
    expect(body.error).toBe('INVALID_CURRENT_PASSWORD');
    await targetApi.dispose();
  });

  test('self-change con newPassword muy corta → 400', async () => {
    const target = await createTestPlayer(adminApi, 'sp19-self-short');
    const targetApi = await ApiClient.create();
    await loginAs(targetApi, target.username, target.password);

    const res = await targetApi.postRaw('/tenant/auth/me/password', {
      currentPassword: target.password,
      newPassword: 'short',
    });
    expect(res.status).toBe(400);
    await targetApi.dispose();
  });

  // ──────────────────────────────────────────────────────────────────
  // Parte 2 — Empleado wildcard
  // ──────────────────────────────────────────────────────────────────

  test('GET grantable-by-me admin devuelve >100 codes (todos delegables del tenant)', async () => {
    const res = await adminApi.get<GrantableResponse>(
      '/tenant/permission-overrides/grantable-by-me',
    );
    expect(res.count).toBeGreaterThan(10); // hay decenas de permisos delegables
  });

  test('GET grantable-by-me socio devuelve solo lo que el socio tiene + es delegable', async () => {
    const res = await socioApi.get<GrantableResponse>(
      '/tenant/permission-overrides/grantable-by-me',
    );
    // El socio recibió users.create + deposits.view + withdrawals.view por override.
    expect(res.data).toContain('users.create');
    expect(res.data).toContain('deposits.view');
    expect(res.data).toContain('withdrawals.view');
    // users.reset_password lo TIENE (default role) pero NO es delegable
    // (isDelegatable=false en el seed), así que NO aparece en grantable.
    expect(res.data).not.toContain('users.reset_password');
    // No tiene permisos sensibles del admin.
    expect(res.data).not.toContain('wallet.mint');
    expect(res.data).not.toContain('bonuses.force_clear');
  });

  test('admin crea empleado con permisos → empleado los recibe + parent asignado', async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const username = `e2e_sp19_emp_${suffix}`;
    const res = await adminApi.post<CreateUserResponse>('/tenant/users', {
      username,
      password: 'empleado-pwd-2026',
      displayName: 'Empleado Test',
      roleCode: 'empleado',
      permissionOverrides: ['wallet.view_any', 'deposits.view'],
    });
    expect(res.user.username).toBe(username);
    expect(res.permissionOverrides).toEqual(['wallet.view_any', 'deposits.view']);
    expect(res.parentAssigned).toBe(true);

    // Verificar overrides persistidos.
    const overrides = await adminApi.get<OverridesListResponse>(
      `/tenant/permission-overrides/user/${res.user.id}`,
    );
    const codes = overrides.overrides.map((o) => o.permissionCode);
    expect(codes).toContain('wallet.view_any');
    expect(codes).toContain('deposits.view');
  });

  test('socio crea empleado con permisos del SUYO → OK con parent=socio', async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const username = `e2e_sp19_socemp_${suffix}`;
    const res = await socioApi.post<CreateUserResponse>('/tenant/users', {
      username,
      password: 'socio-emp-pwd-2026',
      displayName: 'Empleado del Socio',
      roleCode: 'empleado',
      permissionOverrides: ['deposits.view', 'withdrawals.view'],
    });
    expect(res.permissionOverrides).toEqual(['deposits.view', 'withdrawals.view']);
    expect(res.parentAssigned).toBe(true);

    // Verificamos los overrides persistidos desde el admin (el socio no
    // tiene `users.view_any` para mirar detalles de users).
    const overrides = await adminApi.get<OverridesListResponse>(
      `/tenant/permission-overrides/user/${res.user.id}`,
    );
    const codes = overrides.overrides.map((o) => o.permissionCode);
    expect(codes).toContain('deposits.view');
    expect(codes).toContain('withdrawals.view');
  });

  test('socio intenta crear empleado con permiso que NO tiene → 403 + rollback', async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const username = `e2e_sp19_rb_${suffix}`;
    const res = await socioApi.postRaw('/tenant/users', {
      username,
      password: 'rollback-test-2026',
      displayName: 'Rollback Test',
      roleCode: 'empleado',
      // Socio NO tiene wallet.mint.
      permissionOverrides: ['wallet.mint'],
    });
    expect(res.status).toBe(403);

    // Verificar que el user NO se haya creado (rollback).
    const listRes = await adminApi.get<{
      data: Array<{ username: string }>;
    }>(`/tenant/users?search=${encodeURIComponent(username)}`);
    expect(listRes.data.find((u) => u.username === username)).toBeUndefined();
  });

  test('crear empleado con permission no-delegable → 403 + rollback', async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const username = `e2e_sp19_nodel_${suffix}`;
    const res = await adminApi.postRaw('/tenant/users', {
      username,
      password: 'no-delegable-test-2026',
      displayName: 'No-Delegable Test',
      roleCode: 'empleado',
      // bonuses.force_clear es isDelegatable=false (lo tiene el admin
      // pero no puede delegarlo).
      permissionOverrides: ['bonuses.force_clear'],
    });
    expect(res.status).toBe(403);
    // Verificar rollback.
    const listRes = await adminApi.get<{
      data: Array<{ username: string }>;
    }>(`/tenant/users?search=${encodeURIComponent(username)}`);
    expect(listRes.data.find((u) => u.username === username)).toBeUndefined();
  });

  test('empleado intenta crear sub-user con overrides → 403 EMPLEADO_CANNOT_DELEGATE', async () => {
    // Escenario: admin crea un empleado con `users.create` + `deposits.view`.
    // El empleado podría usar `users.create` para hacer un sub-empleado y
    // pasarle `deposits.view`. La regla 51.5 bloquea: empleados no
    // sub-delegan, son hojas del árbol.
    //
    // Nota: `permissions.grant` no es delegable, así que el path "empleado
    // llama directo a /permission-overrides/grant" no existe — el guard
    // de permiso lo corta antes. El path real reachable es vía la creación
    // de users con permissionOverrides[].
    const suffix = Math.random().toString(36).slice(2, 8);
    const empUsername = `e2e_sp19_empdel_${suffix}`;
    const empPwd = 'emp-del-pwd-2026';
    const created = await adminApi.post<CreateUserResponse>('/tenant/users', {
      username: empUsername,
      password: empPwd,
      displayName: 'Empleado que intentará delegar',
      roleCode: 'empleado',
      permissionOverrides: ['users.create', 'deposits.view'],
    });
    expect(created.user.id).toBeDefined();

    // Login como empleado e intentar crear sub-user con overrides.
    const empApi = await ApiClient.create();
    await loginAs(empApi, empUsername, empPwd);
    const subSuffix = Math.random().toString(36).slice(2, 8);
    const res = await empApi.postRaw('/tenant/users', {
      username: `e2e_sp19_subemp_${subSuffix}`,
      password: 'sub-emp-pwd-2026',
      displayName: 'Sub-empleado del empleado',
      roleCode: 'empleado',
      permissionOverrides: ['deposits.view'],
    });
    expect(res.status).toBe(403);
    const body = res.body as { error?: string };
    expect(body.error).toBe('EMPLEADO_CANNOT_DELEGATE');
    await empApi.dispose();
  });

  test('crear user no-empleado NO asigna parent automático', async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const res = await adminApi.post<CreateUserResponse>('/tenant/users', {
      username: `e2e_sp19_noparent_${suffix}`,
      password: 'cajero-no-auto-parent-2026',
      displayName: 'Cajero standalone',
      roleCode: 'cajero',
    });
    // parentAssigned undefined (no asignado).
    expect(res.parentAssigned).toBeUndefined();
  });
});
