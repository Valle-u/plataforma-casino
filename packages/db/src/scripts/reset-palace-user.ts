import postgres from 'postgres';

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql`UPDATE users SET palace_user_code = NULL WHERE username = 'admin'`;
    console.log('Reset palace_user_code to NULL for admin user');
    const user = await sql`SELECT username, palace_account, palace_user_code FROM users WHERE username = 'admin'`;
    console.log('Admin user:', JSON.stringify(user[0], null, 2));
  } finally {
    await sql.end();
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
