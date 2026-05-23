/**
 * stress-measure.mjs — Sprint 51.12
 *
 * Mide response time de endpoints clave del admin con el dataset
 * stresseado. 5 corridas warm por endpoint, reporta p50/p95/avg/min/max.
 *
 * Requiere API arriba en :3000. Si tarda más de 3s, marca el endpoint
 * en rojo.
 *
 * Uso:
 *   node scripts/stress-measure.mjs
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env.local') });

const API = 'http://127.0.0.1:3000';
const TENANT_HOST = 'demo.localhost';
const ADMIN_USER = 'demo_admin';
const ADMIN_PASS = 'demo-pwd-2026';

const RUNS = 5;

// ──────────────────────────────────────────────────────────────────────

async function login() {
  const res = await fetch(`${API}/tenant/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Host': TENANT_HOST },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.accessToken;
}

async function timeRequest(token, path) {
  const t0 = performance.now();
  const res = await fetch(`${API}${path}`, {
    headers: {
      'X-Tenant-Host': TENANT_HOST,
      Authorization: `Bearer ${token}`,
    },
  });
  // Drenar el body para tiempo real (sin esto, fetch puede returnar antes).
  await res.text();
  const ms = performance.now() - t0;
  return { ms, status: res.status };
}

async function bench(token, label, path) {
  const samples = [];
  let lastStatus = 0;
  for (let i = 0; i < RUNS; i++) {
    const { ms, status } = await timeRequest(token, path);
    samples.push(ms);
    lastStatus = status;
  }
  samples.sort((a, b) => a - b);
  const p50 = samples[Math.floor(samples.length / 2)];
  const p95 = samples[Math.floor(samples.length * 0.95)] ?? samples.at(-1);
  const min = samples[0];
  const max = samples.at(-1);
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  return { label, path, status: lastStatus, p50, p95, avg, min, max };
}

function fmt(ms) {
  return ms.toFixed(0).padStart(5) + 'ms';
}

function colorize(ms) {
  if (ms < 200) return '\x1b[32m'; // verde
  if (ms < 500) return '\x1b[33m'; // amarillo
  if (ms < 1500) return '\x1b[35m'; // magenta
  return '\x1b[31m'; // rojo
}

function reset() {
  return '\x1b[0m';
}

async function main() {
  console.log('========================================');
  console.log('  stress-measure — Sprint 51.12');
  console.log('========================================');
  console.log(`API:    ${API}`);
  console.log(`Tenant: ${TENANT_HOST}`);
  console.log(`Runs:   ${RUNS} por endpoint\n`);

  const token = await login();
  console.log(`✓ Login OK\n`);

  const endpoints = [
    // Reads admin pesados
    ['GET /tenant/users (sin filtros)', '/tenant/users?limit=50'],
    ['GET /tenant/users?search=stress', '/tenant/users?search=stress&limit=50'],
    ['GET /tenant/users/stats', '/tenant/users/stats'],
    ['GET /tenant/deposits', '/tenant/deposits?limit=50'],
    ['GET /tenant/withdrawals', '/tenant/withdrawals?limit=50'],
    ['GET /tenant/wallet/me/stats?windowDays=30', '/tenant/wallet/me/stats?windowDays=30'],
    ['GET /tenant/wallet-stats/summary', '/tenant/wallet-stats/summary?windowDays=30'],
    ['GET /tenant/wallet-stats/movements (50 últimas)', '/tenant/wallet-stats/movements?limit=50'],
    ['GET /tenant/audit-log (50 últimas)', '/tenant/audit-log?limit=50'],
    ['GET /tenant/audit-log?actionCodePrefix=deposits.', '/tenant/audit-log?actionCodePrefix=deposits.&limit=50'],
    ['GET /tenant/notifications', '/tenant/notifications?limit=50'],
    ['GET /tenant/notifications/stats', '/tenant/notifications/stats?windowDays=30'],
    ['GET /tenant/leagues (active)', '/tenant/leagues?status=active&limit=50'],
    ['GET /tenant/promotions', '/tenant/promotions?limit=50'],
    ['GET /tenant/info', '/tenant/info'],
    // Light endpoints (control)
    ['GET /tenant/auth/me', '/tenant/auth/me'],
    ['GET /tenant/wallet/me', '/tenant/wallet/me'],
  ];

  const results = [];
  for (const [label, path] of endpoints) {
    process.stdout.write(`  ${label.padEnd(50)} `);
    const r = await bench(token, label, path);
    results.push(r);
    const c = colorize(r.p95);
    const tag = r.status >= 400 ? ` \x1b[31m[HTTP ${r.status}]\x1b[0m` : '';
    console.log(
      `p50 ${c}${fmt(r.p50)}${reset()}  p95 ${c}${fmt(r.p95)}${reset()}  avg ${fmt(r.avg)}${tag}`,
    );
  }

  // Tabla resumen
  console.log('\n========================================');
  console.log('  RESUMEN ordenado por p95 DESC');
  console.log('========================================');
  results.sort((a, b) => b.p95 - a.p95);
  for (const r of results) {
    const c = colorize(r.p95);
    const tag = r.status >= 400 ? ` [HTTP ${r.status}]` : '';
    console.log(
      `  ${c}p95 ${fmt(r.p95)}${reset()}  ${r.label.padEnd(50)}${tag}`,
    );
  }
  const slow = results.filter((r) => r.p95 > 500);
  console.log(
    `\n${slow.length} endpoint(s) con p95 > 500ms${slow.length > 0 ? ' (CANDIDATOS A OPTIMIZAR)' : ' — todos OK'}`,
  );
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
