/**
 * seed-plans — inserta SÓLO los planes (`tenant_plans`) en la DB de control.
 *
 * Existe porque `seed-control` **no se puede correr en staging ni en
 * producción**: además de los planes crea un super-admin de plataforma con
 * credenciales hardcodeadas en el repo y un tenant `demo-casino` de ejemplo.
 * Eso es aceptable en una máquina local; en un servidor expuesto a internet es
 * un agujero.
 *
 * Los planes, en cambio, son datos de catálogo que **todo entorno necesita** —
 * sin ellos `seed-pilot-tenant` no puede provisionar nada.
 *
 * Uso:
 *   pnpm --filter @casino/db db:seed:plans
 *
 * En un entorno ya desplegado (Dokploy), desde el contenedor de la API:
 *   docker exec -it $(docker ps -q -f name=casino-api-staging) \
 *     sh -c 'cd /app && pnpm --filter @casino/db db:seed:plans'
 *
 * Idempotente: `ON CONFLICT (code) DO NOTHING`. Correrlo dos veces no cambia
 * nada y **nunca pisa un plan existente** — si el dueño editó la comisión de
 * `basic` desde el panel, este script la respeta.
 *
 * Requiere `DATABASE_URL_CONTROL`.
 */

import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { createControlDb } from '../client';
import { tenantPlans } from '../control';

loadEnv({ path: path.resolve(process.cwd(), '../../apps/api/.env.local') });

/**
 * Catálogo de planes. Mismos valores que `seed-control`, a propósito: si acá
 * dijeran otra cosa, un entorno sembrado con este script y otro sembrado con
 * aquél tendrían comisiones distintas — y la comisión es plata (ver LEYES C1).
 */
const PLANES = [
  {
    code: 'basic',
    name: 'Plan Básico',
    commissionPct: '0.1500',
    monthlyFee: '0',
    features: { kyc_provider: false, salesbot: false, max_socios: 10 },
  },
  {
    code: 'pro',
    name: 'Plan Pro',
    commissionPct: '0.1000',
    monthlyFee: '500',
    features: { kyc_provider: true, salesbot: true, max_socios: 100 },
  },
];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_CONTROL;
  if (!url) {
    throw new Error('DATABASE_URL_CONTROL no está definido.');
  }

  const db = createControlDb(url);

  const insertados = await db
    .insert(tenantPlans)
    .values(PLANES)
    .onConflictDoNothing({ target: tenantPlans.code })
    .returning();

  const existentes = await db.select().from(tenantPlans);

  console.log(`[seed-plans] insertados: ${insertados.length} de ${PLANES.length}.`);
  if (insertados.length === 0) {
    console.log('[seed-plans] (ya existían todos — no se tocó nada)');
  }
  console.log('[seed-plans] planes en la DB de control:');
  for (const p of existentes) {
    const pct = (Number(p.commissionPct) * 100).toFixed(2);
    console.log(`  - ${p.code.padEnd(10)} ${p.name.padEnd(14)} comisión ${pct}%  fee ${p.monthlyFee}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed-plans] FALLÓ:', err);
    process.exit(1);
  });
