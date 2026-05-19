/**
 * Helpers compartidos por los scripts k6 del casino.
 *
 * NO usar TypeScript — k6 corre JS puro (esbuild bundler integrado).
 */

import http from 'k6/http';
import { check } from 'k6';

export const API_BASE = __ENV.API_BASE || 'http://localhost:3000';
export const TENANT_HOST = __ENV.TENANT_HOST || 'demo.localhost';
export const ADMIN_USERNAME = __ENV.ADMIN_USERNAME || 'demo_admin';
export const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD || 'demo-pwd-2026';

/** Headers comunes para todo request al backend. */
export function baseHeaders(token = null) {
  const h = {
    'X-Tenant-Host': TENANT_HOST,
    'Content-Type': 'application/json',
  };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

/**
 * Login del admin demo. Devuelve token Bearer.
 * Para tests parametrizados con VUs distintos, llamar UNA vez en
 * `setup()` y compartir el token via `data` que recibe `default()`.
 */
export function loginAdmin() {
  const res = http.post(
    `${API_BASE}/tenant/auth/login`,
    JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
    { headers: baseHeaders() },
  );
  check(res, {
    'admin login status 200': (r) => r.status === 200 || r.status === 201,
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`admin login failed: ${res.status} ${res.body}`);
  }
  const body = JSON.parse(res.body);
  return body.accessToken;
}

/** Crea un test player via API admin. Devuelve {id, username, password}. */
export function createTestPlayer(adminToken, label) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const username = `k6_${label}_${suffix}`.toLowerCase().slice(0, 30);
  const password = `k6-pwd-${label}-2026`;
  const res = http.post(
    `${API_BASE}/tenant/users`,
    JSON.stringify({
      username,
      password,
      displayName: `k6 ${label}`,
      roleCode: 'usuario_final',
    }),
    { headers: baseHeaders(adminToken) },
  );
  check(res, { 'create player status 201': (r) => r.status === 201 });
  if (res.status !== 201) {
    throw new Error(`create player failed: ${res.status} ${res.body}`);
  }
  const body = JSON.parse(res.body);
  return { id: body.user.id, username, password };
}

/** Login arbitrario. Devuelve token o lanza. */
export function loginUser(username, password) {
  const res = http.post(
    `${API_BASE}/tenant/auth/login`,
    JSON.stringify({ username, password }),
    { headers: baseHeaders() },
  );
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`login ${username} failed: ${res.status} ${res.body}`);
  }
  return JSON.parse(res.body).accessToken;
}
