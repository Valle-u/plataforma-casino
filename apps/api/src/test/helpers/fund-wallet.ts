/**
 * Helper de fondeo de wallets para tests E2E.
 *
 * El mint DIRECTO del admin (`POST /tenant/wallet/mint`) se eliminó del
 * producto — las fichas solo se crean vía aporte de capital a la Casa. Los
 * tests que necesitaban fondear wallets usaban ese endpoint; ahora usan este
 * helper, que fondea DIRECTO por DB (ensure wallet + tx 'mint' del lado de la
 * Casa) preservando el invariante `balance == Σtx`.
 */

import postgres from 'postgres';
import { getTestTenantUrl } from '../setup/db-helpers';

/**
 * Fondea la wallet de `userId` con `amount` fichas (string numeric). Crea la
 * wallet si no existe; si existe, suma. Inserta la wallet_transaction 'mint'
 * correspondiente (balance_after consistente). Idempotency key única por llamada.
 */
export async function fundWalletForTests(
  userId: string,
  amount: string,
): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
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
         'test_funding', 'fondeo de test (Casa)',
         ${`fund-${Date.now()}-${Math.random().toString(36).slice(2)}`})`;
  } finally {
    await sql.end();
  }
}
