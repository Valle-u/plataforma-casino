/**
 * Constantes del tenant de test.
 *
 * Toda la suite Jest apunta a este tenant. Se recrea limpio antes de la
 * suite (globalSetup) y se borra al final (globalTeardown).
 *
 * El host `jest.localhost` está hardcodeado en los tests; cuando el
 * supertest hace request al app, le pasamos `Host: jest.localhost` para
 * que el TenantResolverMiddleware lo identifique.
 */

export const TEST_TENANT = {
  slug: 'jest',
  dbName: 'tenant_jest_test',
  host: 'jest.localhost',
  name: 'Jest Test Tenant',
  contactEmail: 'jest@test.local',

  // Plan: usa el plan 'basic' que ya viene en el seed de control.
  planCode: 'basic',

  admin: {
    username: 'jest_admin',
    password: 'jest-admin-pwd-2026',
    email: 'admin@jest.test',
    displayName: 'Jest Admin',
  },

  // Cajeros de test pre-creados por el seed. Sus passwords son fijos.
  cajero1: {
    username: 'jest_cajero1',
    password: 'jest-cajero1-pwd',
    displayName: 'Jest Cajero 1',
    roleCode: 'cajero',
  },
  cajero2: {
    username: 'jest_cajero2',
    password: 'jest-cajero2-pwd',
    displayName: 'Jest Cajero 2',
    roleCode: 'cajero',
  },
} as const;
