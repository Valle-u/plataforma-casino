/**
 * baseline.js — k6 baseline load test.
 *
 * 50 VUs sostenidos por 5 minutos. Cada VU hace el "user journey típico"
 * (login → ver wallet → ver lobby → ver bonuses → /me) en loop.
 *
 * Thresholds (alineados con doc 14 §15):
 *   - http_req_failed: <0.5%
 *   - login p95 <300ms
 *   - reads p95 <200ms
 *
 * Si los thresholds fallan, identificar el endpoint culpable con el
 * tagging por nombre (http_req_duration{name:"..."}).
 *
 * Ejecutar:
 *   k6 run perf/baseline.js
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
  scenarios: {
    constant_50: {
      executor: 'constant-vus',
      vus: 50,
      duration: '5m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.005'],
    'http_req_duration{name:login}': ['p(95)<300'],
    'http_req_duration{name:me}': ['p(95)<200'],
    'http_req_duration{name:wallet}': ['p(95)<200'],
    'http_req_duration{name:games}': ['p(95)<200'],
    'http_req_duration{name:bonuses}': ['p(95)<200'],
  },
};

/**
 * Setup: crea N players (N = vus) y devuelve sus credenciales. Cada VU
 * agarra su propio player en `default` (por __VU index). Esto evita que
 * todos los VUs spammeen al mismo user.
 */
export function setup() {
  const adminToken = loginAdmin();
  const players = [];
  for (let i = 0; i < 50; i++) {
    players.push(createTestPlayer(adminToken, `baseline_${i}`));
  }
  return { players };
}

export default function (data) {
  const player = data.players[(__VU - 1) % data.players.length];

  // 1. Login.
  const loginRes = http.post(
    `${API_BASE}/tenant/auth/login`,
    JSON.stringify({ username: player.username, password: player.password }),
    { headers: baseHeaders(), tags: { name: 'login' } },
  );
  check(loginRes, { 'login OK': (r) => r.status === 200 || r.status === 201 });
  if (loginRes.status !== 200 && loginRes.status !== 201) {
    sleep(2);
    return;
  }
  const token = JSON.parse(loginRes.body).accessToken;

  // 2. /me.
  http.get(`${API_BASE}/tenant/auth/me`, {
    headers: baseHeaders(token),
    tags: { name: 'me' },
  });

  // 3. /wallet/me.
  http.get(`${API_BASE}/tenant/wallet/me`, {
    headers: baseHeaders(token),
    tags: { name: 'wallet' },
  });

  // 4. /games/active.
  http.get(`${API_BASE}/tenant/games/active`, {
    headers: baseHeaders(token),
    tags: { name: 'games' },
  });

  // 5. /bonuses/me.
  http.get(`${API_BASE}/tenant/bonuses/me`, {
    headers: baseHeaders(token),
    tags: { name: 'bonuses' },
  });

  // 6. /notifications/me/unread-count (el badge poll del frontend).
  http.get(`${API_BASE}/tenant/notifications/me/unread-count`, {
    headers: baseHeaders(token),
    tags: { name: 'notif-count' },
  });

  // Think time: 2-5s entre iteraciones (jugador real no spammea).
  sleep(2 + Math.random() * 3);
}
