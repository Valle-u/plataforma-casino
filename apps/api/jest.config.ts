/**
 * Configuración de Jest para apps/api.
 *
 * Usamos `ts-jest` directo (no `@nestjs/testing` bundled config) porque
 * queremos control fino sobre cómo se compilan los tests y para que
 * funcione bien con el workspace package `@casino/db` (resuelto vía
 * `moduleNameMapper`).
 *
 * Cada test E2E levanta una NestJS application en memoria (sin escuchar
 * puerto), apunta al tenant `tenant_jest_test`, y testea via supertest.
 *
 * Antes de la suite, `globalSetup.ts` drop/create/migrate/seed la DB de
 * test. `globalTeardown.ts` la limpia al final.
 */

import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: '\\.(spec|e2e)\\.ts$',
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],

  // Resolvemos `@casino/db` al source TS del workspace.
  moduleNameMapper: {
    '^@casino/db$': '<rootDir>/../../packages/db/src/index.ts',
    '^@casino/db/(.*)$': '<rootDir>/../../packages/db/src/$1',
  },

  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.test.json',
        // Decoradores de NestJS exigen `experimentalDecorators` y
        // `emitDecoratorMetadata` — ya están en el tsconfig.
        isolatedModules: false,
      },
    ],
  },

  // Setup global: bootstrap de la DB de test antes de toda la suite.
  globalSetup: '<rootDir>/test/setup/global-setup.ts',
  globalTeardown: '<rootDir>/test/setup/global-teardown.ts',

  // Orden determinista de archivos (alfabético por path). Sin esto, jest
  // elige heurísticamente y la contaminación cross-suite es no determinística.
  testSequencer: '<rootDir>/test/setup/sequencer.ts',

  // No queremos que un test colgado deje el proceso vivo eternamente.
  testTimeout: 30000,

  // forceExit: postgres-js mantiene `idle_timeout` de varios segundos sobre
  // sus conexiones, lo que aplaza el cierre real del socket. Ya validamos
  // con `--detectOpenHandles` que no hay leaks reales (todos cerramos via
  // `OnApplicationShutdown`). forceExit corta los timers idle al terminar.
  forceExit: true,

  // Reportes claros en CI.
  verbose: true,

  // Para que console.log se muestre durante el test (útil para debug).
  silent: false,
};

export default config;
