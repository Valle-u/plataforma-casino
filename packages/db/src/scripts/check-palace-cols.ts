import postgres from 'postgres';

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const r = await sql.unsafe(`SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'users' AND column_name LIKE 'palace%'`);
    console.log(JSON.stringify(r, null, 2));
  } finally {
    await sql.end();
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
