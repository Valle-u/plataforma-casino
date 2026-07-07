/**
 * verify-money-clean — snapshot read-only del estado de dinero del tenant demo.
 *
 * Imprime: usuarios, wallets, supply (Σ por tipo de tx), fichas en circulación,
 * y el invariante por-wallet `balance == Σ(créditos) − Σ(débitos)`. Para
 * comprobar que el tenant está limpio (en un arranque de cero: todo 0).
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
loadEnv({ path: path.resolve(process.cwd(), '../../apps/api/.env.local') });
import postgres from 'postgres';

const CREDIT = [
  'mint', 'load', 'transfer_in', 'win', 'deposit', 'bonus_grant', 'bonus_clear',
  'bonus_funding_revert', 'jackpot_win', 'promo_reward', 'league_reward',
  'commission_payout', 'fund_release',
  // `adjustment`: lado target (crédito) de las cargas por corrección de empleado
  // — executeTransferPair lo acredita. Sin esto el chequeo da descuadre falso.
  'adjustment',
];
const DEBIT = [
  'burn', 'unload', 'transfer_out', 'bet', 'withdrawal', 'bonus_forfeit',
  'bonus_funding', 'fund_reserve',
];

async function main(): Promise<void> {
  const template = process.env.DATABASE_URL_TENANT_TEMPLATE!;
  const url = template.replace('<tenant_db>', 'tenant_demo_casino');
  const sql = postgres(url, { max: 1 });
  try {
    const users = await sql<{ username: string; is_system: boolean }[]>`
      SELECT username, is_system FROM users ORDER BY is_system DESC, username`;
    const wallets = await sql<{ username: string; balance: string; locked: string }[]>`
      SELECT u.username, w.balance, w.locked_balance AS locked
      FROM wallets w JOIN users u ON u.id = w.user_id ORDER BY u.username`;
    const tx = await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM wallet_transactions`;
    const roles = await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM roles`;
    const perms = await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM permissions`;
    const circ = await sql<{ total: string }[]>`
      SELECT COALESCE(SUM(w.balance), 0)::text AS total
      FROM wallets w JOIN users u ON u.id = w.user_id WHERE u.is_system = false`;
    const inv = await sql<{ username: string; balance: string; ledger: string }[]>`
      SELECT u.username, w.balance,
        COALESCE((
          SELECT SUM(CASE WHEN t.type = ANY(${CREDIT}) THEN t.amount
                          WHEN t.type = ANY(${DEBIT}) THEN -t.amount ELSE 0 END)
          FROM wallet_transactions t WHERE t.wallet_id = w.id
        ), 0)::text AS ledger
      FROM wallets w JOIN users u ON u.id = w.user_id`;

    console.log('=== USERS ===');
    for (const u of users) console.log(`  ${u.is_system ? '[sys] ' : '      '}${u.username}`);
    console.log(`=== ROLES/PERMS === roles=${roles[0]!.n} permisos=${perms[0]!.n}`);
    console.log('=== WALLETS ===');
    if (wallets.length === 0) console.log('  (ninguna — se crean lazy)');
    for (const w of wallets) console.log(`  ${w.username}: balance=${w.balance} locked=${w.locked}`);
    console.log(`=== wallet_transactions: ${tx[0]!.n} ===`);
    console.log(`=== Fichas en circulación (excl. Casa): ${circ[0]!.total} ===`);

    const broken = inv.filter((r) => Number(r.balance) !== Number(r.ledger));
    console.log(
      `=== INVARIANTE balance == Σtx: ${broken.length === 0 ? 'OK ✓' : `DESCUADRE en ${broken.length}`}`,
    );
    for (const b of broken) console.log(`  ✗ ${b.username}: balance=${b.balance} ledger=${b.ledger}`);
  } finally {
    await sql.end();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('FALLÓ:', err);
  process.exit(1);
});
