/**
 * Acceso directo a la DB del tenant demo — SOLO para SETUP de tests e2e
 * (fondeo de wallets). NO es parte del producto.
 *
 * El mint directo del admin (`POST /tenant/wallet/mint`) se eliminó: las
 * fichas solo se crean por aporte de capital a la Casa. Los specs que
 * necesitaban fondear wallets antes lo hacían vía ese endpoint; ahora
 * insertan directo por DB (wallet + tx `'mint'` source `'test_funding'`),
 * el equivalente black-box del helper jest `fundWalletForTests`.
 *
 * Apunta a `tenant_demo_casino` (override con E2E_TENANT_DB) construyendo la
 * URL con `DATABASE_URL_TENANT_TEMPLATE` de `apps/api/.env.local` — mismo
 * mecanismo que `reset-demo-tenant`.
 */

import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import postgres from 'postgres';

// Cargar el env de la API (donde vive el template de conexión a tenants).
// __dirname = apps/e2e/tests/helpers → ../../../api = apps/api.
loadEnv({ path: path.resolve(__dirname, '../../../api/.env.local') });

const DEMO_DB = process.env.E2E_TENANT_DB ?? 'tenant_demo_casino';

function tenantUrl(): string {
  const template = process.env.DATABASE_URL_TENANT_TEMPLATE;
  if (!template) {
    throw new Error(
      'DATABASE_URL_TENANT_TEMPLATE falta (se lee de apps/api/.env.local). ' +
        'Necesario para fondear wallets en los specs e2e.',
    );
  }
  return template.replace('<tenant_db>', DEMO_DB);
}

/**
 * Fondea la wallet de `userId` con `amount` fichas (string numeric) directo
 * por DB. Crea la wallet si no existe; si existe, suma. Inserta la
 * wallet_transaction `'mint'` correspondiente (balance_after consistente),
 * preservando el invariante `balance == Σtx`.
 */
export async function fundWalletByUserId(
  userId: string,
  amount: string,
): Promise<void> {
  const sql = postgres(tenantUrl(), { max: 1 });
  try {
    const w = await sql<{ id: string; balance: string }[]>`
      INSERT INTO wallets (id, user_id, balance)
      VALUES (gen_random_uuid(), ${userId}, ${amount})
      ON CONFLICT (user_id) DO UPDATE SET balance = wallets.balance + ${amount}::numeric
      RETURNING id, balance`;
    await sql`
      INSERT INTO wallet_transactions
        (id, wallet_id, type, amount, balance_after, source, reason, idempotency_key)
      VALUES
        (gen_random_uuid(), ${w[0]!.id}, 'mint', ${amount}, ${w[0]!.balance},
         'test_funding', 'fondeo de test e2e (Casa)',
         ${`e2e-fund-${Date.now()}-${Math.random().toString(36).slice(2)}`})`;
  } finally {
    await sql.end();
  }
}
