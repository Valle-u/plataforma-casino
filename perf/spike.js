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
    /**
     * p95 < 2s es aspiracional para spike. Validado real (Sprint 39):
     * en dev local (Postgres mismo host) p95 cae ~2.3-2.7s con 200 VUs.
     * Si emerge feedback de UX bajo carga real, optimizaciones probadas
     * que ayudan: cache /tenant/info (lo polea el branding hook),
     * pool de conexiones DB más grande, Redis para session lookup.
     */
    http_req_duration: ['p(95)<2000'],
  },
  // Forzar p50 + p99 en el summary (defaults k6 no los incluyen).
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(95)', 'p(99)'],
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
  // Custom summary defensivo — algunas métricas pueden faltar si el
  // test corre por <1s o si todos los iters fallaron en setup. La
  // versión anterior crasheaba con "Cannot read property 'toFixed' of null".
  const safeNum = (v) => (typeof v === 'number' ? v.toFixed(0) : 'n/a');
  const safePct = (v) =>
    typeof v === 'number' ? (v * 100).toFixed(2) + '%' : 'n/a';
  const m = data.metrics;
  return {
    stdout: `
═══════════════════════════════════════════════════════════════
  SPIKE TEST RESULTS
═══════════════════════════════════════════════════════════════
  Total requests:      ${m.http_reqs?.values?.count ?? 'n/a'}
  Throughput avg:      ${safeNum(m.http_reqs?.values?.rate)} req/s
  Failed requests:     ${safePct(m.http_req_failed?.values?.rate)}
  p50 latency:         ${safeNum(m.http_req_duration?.values?.med)} ms
  p95 latency:         ${safeNum(m.http_req_duration?.values?.['p(95)'])} ms
  p99 latency:         ${safeNum(m.http_req_duration?.values?.['p(99)'])} ms
═══════════════════════════════════════════════════════════════
`,
  };
}
