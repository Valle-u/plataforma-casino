/**
 * spike.js — k6 spike test.
 *
 * Ramp-up rápido a 200 VUs en 30s, mantiene 30s más, ramp-down a 0.
 * Simula un evento promocional ("anunciamos un torneo en redes →
 * 200 jugadores intentan loguearse simultáneo").
 *
 * Foco en read paths + login — NO hacemos mutations pesadas (mint/
 * deposit) para no contaminar la DB con ruido.
 *
 * Thresholds más laxos que baseline porque el spike es estresar:
 *   - http_req_failed: <5%
 *   - p95 < 2s
 *
 * Si esto pasa OK, el sistema sobrevive a un trafico abrupto.
 *
 * Ejecutar:
 *   k6 run perf/spike.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import {
  API_BASE,
  baseHeaders,
  loginAdmin,
  createTestPlayer,
} from './helpers/index.js';

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 200 }, // ramp-up
        { duration: '30s', target: 200 }, // hold
        { duration: '30s', target: 0 }, // ramp-down
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<2000'],
  },
};

export function setup() {
  // Pool chico de players — los VUs comparten. El spike NO está testeando
  // la creación de 200 users (eso saturaría el DB innecesariamente).
  const adminToken = loginAdmin();
  const players = [];
  for (let i = 0; i < 20; i++) {
    players.push(createTestPlayer(adminToken, `spike_${i}`));
  }
  return { players };
}

export default function (data) {
  const player = data.players[Math.floor(Math.random() * data.players.length)];

  // 1. Login (típico hot path en spike).
  const loginRes = http.post(
    `${API_BASE}/tenant/auth/login`,
    JSON.stringify({ username: player.username, password: player.password }),
    { headers: baseHeaders(), tags: { name: 'spike-login' } },
  );
  if (loginRes.status !== 200 && loginRes.status !== 201) {
    sleep(1);
    return;
  }
  const token = JSON.parse(loginRes.body).accessToken;

  // 2. Read endpoints en paralelo (browser hace esto al cargar /play).
  http.batch([
    {
      method: 'GET',
      url: `${API_BASE}/tenant/auth/me`,
      params: { headers: baseHeaders(token), tags: { name: 'spike-me' } },
    },
    {
      method: 'GET',
      url: `${API_BASE}/tenant/wallet/me`,
      params: { headers: baseHeaders(token), tags: { name: 'spike-wallet' } },
    },
    {
      method: 'GET',
      url: `${API_BASE}/tenant/games/active`,
      params: { headers: baseHeaders(token), tags: { name: 'spike-games' } },
    },
    {
      method: 'GET',
      url: `${API_BASE}/tenant/info`,
      params: { headers: baseHeaders(), tags: { name: 'spike-info' } },
    },
  ]);

  // Think time bajo — spike = users impacientes.
  sleep(0.5 + Math.random());
}

export function handleSummary(data) {
  // Custom summary que destaca el ratio de errores en el peak.
  return {
    stdout: `
═══════════════════════════════════════════════════════════════
  SPIKE TEST RESULTS
═══════════════════════════════════════════════════════════════
  Total requests:      ${data.metrics.http_reqs.values.count}
  Failed requests:     ${(data.metrics.http_req_failed.values.rate * 100).toFixed(2)}%
  p50 latency:         ${data.metrics.http_req_duration.values['p(50)'].toFixed(0)} ms
  p95 latency:         ${data.metrics.http_req_duration.values['p(95)'].toFixed(0)} ms
  p99 latency:         ${data.metrics.http_req_duration.values['p(99)'].toFixed(0)} ms
═══════════════════════════════════════════════════════════════
`,
  };
}
