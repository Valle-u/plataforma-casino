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
    // otplib + @scure/base + @otplib/* publican ESM puro (".js" con
    // `export const ...`). Jest no los transforma por default
    // (todo node_modules está ignorado en transformIgnorePatterns), así
    // que Node los lee crudos y revienta el parse. Aplicar ts-jest a
    // sus .js los baja a CJS al vuelo.
    '^.+\\.js$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.test.json',
        isolatedModules: true,
        useESM: false,
      },
    ],
  },

  // Permitir que ts-jest transforme los packages ESM-only que importa
  // otplib. Por default Jest skipea TODO node_modules; acá excluimos
  // del skip a los que necesitamos transformar.
  transformIgnorePatterns: [
    // Cualquier .js bajo node_modules que NO contenga estos paquetes
    // en el path queda ignorado. pnpm encodea versiones como
    // `@scure+base@2.2.0` con `+`, así que matcheamos por nombre suelto
    // en cualquier parte del path.
    '/node_modules/(?!.*(otplib|@otplib|@scure|@noble))[^\\\\/]+\\.js$',
    '\\.pnp\\.[^\\\\/]+$',
  ],

  // Setup global: bootstrap de la DB de test antes de toda la suite.
  globalSetup: '<rootDir>/src/test/setup/global-setup.ts',
  globalTeardown: '<rootDir>/src/test/setup/global-teardown.ts',

  // Orden determinista de archivos (alfabético por path). Sin esto, jest
  // elige heurísticamente y la contaminación cross-suite es no determinística.
  testSequencer: '<rootDir>/src/test/setup/sequencer.ts',

  // No queremos que un test colgado deje el proceso vivo eternamente.
  testTimeout: 30000,

  // forceExit + maxWorkers=1: las suites comparten DB y los pools de
  // postgres-js mantienen idle conns que pueden ver snapshots viejos.
  // forceExit corta timers idle. maxWorkers=1 es equivalente a runInBand
  // (se mantiene aún cuando alguien corre sin runInBand desde CLI).
  forceExit: true,
  maxWorkers: 1,

  // Cobertura: pasada con `npx jest --coverage`. Útil para ver dónde
  // hay zonas sin tests.
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.dto.ts',
    '!src/main.ts',
    '!src/**/index.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text-summary', 'html'],

  // Reportes claros en CI.
  verbose: true,

  // Para que console.log se muestre durante el test (útil para debug).
  silent: false,
};

export default config;
