/**
 * smoke.js — k6 smoke test.
 *
 * 1 VU, 1 minuto. Verifica que los endpoints críticos NO devuelvan 5xx
 * y respondan dentro de un timeout generoso (1s). Es el "ping de salud
 * comprehensivo" — si esto falla, no tiene sentido correr baseline o spike.
 *
 * Ejecutar:
 *   k6 run perf/smoke.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import {
  API_BASE,
  baseHeaders,
  loginAdmin,
  createTestPlayer,
  loginUser,
} from './helpers/index.js';

export const options = {
  vus: 1,
  duration: '1m',
  thresholds: {
    http_req_failed: ['rate<0.01'], // <1% errors
    http_req_duration: ['p(95)<1000'], // p95 < 1s (generoso para smoke)
  },
};

export function setup() {
  const adminToken = loginAdmin();
  const player = createTestPlayer(adminToken, 'smoke');
  const playerToken = loginUser(player.username, player.password);
  return { adminToken, playerToken };
}

export default function (data) {
  // 1. /tenant/info público.
  const info = http.get(`${API_BASE}/tenant/info`, {
    headers: baseHeaders(),
  });
  check(info, { 'info status 200': (r) => r.status === 200 });

  sleep(0.5);

  // 2. /auth/me con token de player.
  const me = http.get(`${API_BASE}/tenant/auth/me`, {
    headers: baseHeaders(data.playerToken),
  });
  check(me, { 'me status 200': (r) => r.status === 200 });

  sleep(0.5);

  // 3. /wallet/me — balance del player.
  const wallet = http.get(`${API_BASE}/tenant/wallet/me`, {
    headers: baseHeaders(data.playerToken),
  });
  check(wallet, { 'wallet/me status 200': (r) => r.status === 200 });

  sleep(0.5);

  // 4. /games/active — catálogo lobby.
  const games = http.get(`${API_BASE}/tenant/games/active`, {
    headers: baseHeaders(data.playerToken),
  });
  check(games, { 'games/active status 200': (r) => r.status === 200 });

  sleep(0.5);

  // 5. /notifications/me — inbox.
  const notifs = http.get(`${API_BASE}/tenant/notifications/me`, {
    headers: baseHeaders(data.playerToken),
  });
  check(notifs, { 'notifications/me status 200': (r) => r.status === 200 });

  sleep(0.5);

  // 6. /admin endpoint: users list (con admin token).
  const users = http.get(`${API_BASE}/tenant/users?limit=10`, {
    headers: baseHeaders(data.adminToken),
  });
  check(users, { 'users list status 200': (r) => r.status === 200 });

  sleep(1);
}
