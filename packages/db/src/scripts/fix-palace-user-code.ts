import postgres from 'postgres';

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql.unsafe(`ALTER TABLE users ALTER COLUMN palace_user_code DROP DEFAULT`);
    console.log('Dropped sequence default');
    await sql.unsafe(`ALTER TABLE users ALTER COLUMN palace_user_code DROP NOT NULL`);
    console.log('Set palace_user_code nullable');
    await sql.unsafe(`UPDATE users SET palace_user_code = NULL WHERE palace_user_code = 1`);
    console.log('Reset palace_user_code to NULL');

    const r = await sql`SELECT username, palace_account, palace_user_code FROM users WHERE username = 'admin'`;
    console.log('Admin:', JSON.stringify(r[0], null, 2));
  } finally {
    await sql.end();
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
