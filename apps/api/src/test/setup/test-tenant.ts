/**
 * Constantes del tenant de test.
 *
 * Toda la suite Jest apunta a este tenant. Se recrea limpio antes de la
 * suite (globalSetup) y se borra al final (globalTeardown).
 *
 * El host `jest.localhost` se le pasa a supertest en cada request
 * (`Host: jest.localhost`) para que el TenantResolverMiddleware lo
 * identifique.
 *
 * ## Correr dos suites a la vez: `TEST_TENANT_SUFFIX`
 *
 * Sin sufijo, **todo esto es global**: la base `tenant_jest_test`, el slug
 * `jest` en `platform_control` y el dominio `jest.localhost`. Dos corridas
 * simultáneas —dos agentes, dos worktrees, dos terminales— comparten las tres
 * cosas, y `globalTeardown` **dropea la base**. La que quede corriendo empieza
 * a fallar con "no existe la base de datos «tenant_jest_test»" o con 500 en
 * cualquier login.
 *
 * Y el modo de falla es traicionero: no dice "otra corrida te pisó", dice que
 * tu código está roto. El 2026-09-10 costó tres corridas y una comparación
 * contra la base entender que las fallas no eran del cambio que se estaba
 * probando.
 *
 * Con `TEST_TENANT_SUFFIX=loquesea` las tres quedan separadas:
 *
 *     TEST_TENANT_SUFFIX=ruleta npx jest --runInBand <patrón>
 *     → base `tenant_jest_test_ruleta`, slug `jest-ruleta`,
 *       host `jest-ruleta.localhost`
 *
 * **Sin la variable, nada cambia**: los valores son exactamente los de antes,
 * así que CI y el uso de siempre no se enteran.
 *
 * Conviene acompañarlo de `REDIS_KEY_PREFIX` propio, porque el Redis de
 * desarrollo también es compartido (ver `AGENTS.md` §2.10).
 */

const SUFIJO = (process.env.TEST_TENANT_SUFFIX ?? '').trim();

// Se valida en vez de confiar: este valor se interpola en DDL
// (`CREATE DATABASE`, `DROP DATABASE`) y en un hostname. Un sufijo con
// espacios, comillas o un punto y coma no falla "raro" — falla ejecutando
// algo. Minúsculas, dígitos y guion bajo, hasta 20 caracteres.
if (SUFIJO && !/^[a-z0-9_]{1,20}$/.test(SUFIJO)) {
  throw new Error(
    `TEST_TENANT_SUFFIX inválido: '${SUFIJO}'. ` +
      `Sólo minúsculas, dígitos y guion bajo, hasta 20 caracteres.`,
  );
}

/** Para identificadores SQL: `tenant_jest_test_ruleta`. */
const SUF_SQL = SUFIJO ? `_${SUFIJO}` : '';
/** Para el slug y el host, donde el guion bajo no es válido en un dominio. */
const SUF_HOST = SUFIJO ? `-${SUFIJO.replace(/_/g, '-')}` : '';

export const TEST_TENANT = {
  slug: `jest${SUF_HOST}`,
  dbName: `tenant_jest_test${SUF_SQL}`,
  host: `jest${SUF_HOST}.localhost`,
  name: `Jest Test Tenant${SUFIJO ? ` (${SUFIJO})` : ''}`,
  contactEmail: `jest${SUF_HOST}@test.local`,

  // Plan: usa el plan 'basic' que ya viene en el seed de control.
  planCode: 'basic',

  // Los usuarios viven en la base del tenant, que ya queda aislada por
  // `dbName`. No hace falta sufijarlos, y sin sufijo los logs se leen igual
  // en las dos corridas.
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
