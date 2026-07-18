import postgres from 'postgres';

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const game = await sql`SELECT code, palace_provider_id, palace_game_symbol, is_active FROM games WHERE code = 'vswaysdogs'`;
    console.log('Game:', JSON.stringify(game[0], null, 2));
  } finally {
    await sql.end();
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
