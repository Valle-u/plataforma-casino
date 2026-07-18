import postgres from 'postgres';

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const user = await sql`SELECT id, username, palace_account, palace_user_code, status FROM users WHERE username = 'admin'`;
    console.log('Admin user:', JSON.stringify(user[0], null, 2));

    if (user[0]?.palace_account) {
      const wallet = await sql`SELECT balance, bonus_balance, currency FROM wallets WHERE user_id = ${user[0].id}`;
      console.log('Wallet:', JSON.stringify(wallet[0], null, 2));
    }
  } finally {
    await sql.end();
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
