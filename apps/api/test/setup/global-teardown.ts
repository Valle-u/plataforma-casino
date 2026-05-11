/**
 * Jest globalTeardown — corre UNA vez al final de toda la suite.
 *
 * Dropea el tenant de test para no dejar DBs huérfanas.
 *
 * NOTA: si los tests fallan, mantener la DB sería útil para inspeccionar
 * con `pnpm db:studio:tenant`. Por ahora dropea siempre. Si querés
 * mantenerla, exportá KEEP_TEST_DB=1.
 */

import { config as loadEnv } from 'dotenv';
import path from 'node:path';

export default async function globalTeardown(): Promise<void> {
  if (process.env.KEEP_TEST_DB === '1') {
    // eslint-disable-next-line no-console
    console.log('[jest] KEEP_TEST_DB=1 → no dropeo la DB de test.');
    return;
  }

  loadEnv({ path: path.resolve(__dirname, '../../.env.local') });

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { dropTestTenantDatabase } = require('./db-helpers');
  await dropTestTenantDatabase();
}
