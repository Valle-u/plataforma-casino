/**
 * Paths absolutos a las carpetas de migraciones del package.
 *
 * Las migraciones (.sql + meta/) se shippean junto con el package
 * (`"files": ["dist", "migrations"]` en package.json).
 *
 * En runtime, este archivo compilado vive en `<package>/dist/migrations-paths.js`.
 * Subimos un nivel para llegar a la raíz del package, después a `migrations/`.
 *
 * Esto funciona tanto en pnpm workspace (paths reales) como cuando se publica
 * como npm package (node_modules/@casino/db/...).
 */

import path from 'node:path';

const PACKAGE_ROOT = path.resolve(__dirname, '..');

export const TENANT_MIGRATIONS_PATH = path.join(PACKAGE_ROOT, 'migrations', 'tenant');
export const CONTROL_MIGRATIONS_PATH = path.join(PACKAGE_ROOT, 'migrations', 'control');
