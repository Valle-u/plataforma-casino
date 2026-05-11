/**
 * Jest globalSetup — corre UNA vez antes de toda la suite.
 *
 * Pasos:
 *   1. Carga env de `apps/api/.env.local` (mismo path que produce/dev).
 *   2. Reset completo del tenant de test (drop + create + migrate + seed).
 *
 * Si esto falla, ningún test corre — preferimos romper temprano que tener
 * tests verdes contra una DB inconsistente.
 */

import { config as loadEnv } from 'dotenv';
import path from 'node:path';

export default async function globalSetup(): Promise<void> {
  // Cargar .env.local antes de cualquier import que use envs.
  loadEnv({ path: path.resolve(__dirname, '../../.env.local') });

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resetTestTenantDatabase } = require('./db-helpers');
  await resetTestTenantDatabase();

  // eslint-disable-next-line no-console
  console.log('[jest] Test tenant DB lista.');
}
