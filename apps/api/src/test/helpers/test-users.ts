/**
 * Helper para crear users de test on-demand dentro de una suite.
 *
 * Cada suite que necesita users dedicados (admin/cajero/jugador) llama a
 * `createTestUser()` en su `beforeAll` con un sufijo único de la suite.
 * Eso garantiza que las suites NO compartan estado de users entre ellas,
 * eliminando cualquier contaminación cross-suite por permisos/wallets
 * residuales.
 *
 * Ejemplo de uso:
 *
 *   const adminA = await createTestUser(ctx, adminToken, {
 *     suite: 'wallet-transfer',
 *     role: 'admin_tenant',
 *     label: 'admin',
 *   });
 *   const adminAToken = await loginAs(ctx.request, adminA.username, adminA.password);
 */

import supertest from 'supertest';
import { TEST_TENANT } from '../setup/test-tenant';

export interface TestUserSpec {
  /** Nombre de la suite, ej. 'wallet-transfer'. Va al username. */
  suite: string;
  /** Etiqueta del user dentro de la suite, ej. 'admin', 'cashier1'. */
  label: string;
  /** Code del rol a asignar. */
  role: string;
}

export interface TestUser {
  id: string;
  username: string;
  password: string;
}

/**
 * Crea un user nuevo en el tenant test bajo un username único.
 * Password generado: `pwd-${suite}-${label}`.
 */
export async function createTestUser(
  request: supertest.Agent,
  adminBearer: string,
  spec: TestUserSpec,
): Promise<TestUser> {
  // Sufijo time-based para evitar colisión incluso si la misma suite se
  // corre 2 veces en el mismo proceso. Truncamos a ~6 chars random.
  const suffix = Math.random().toString(36).slice(2, 8);
  // El total no puede pasar 30 chars (validación del DTO).
  const username = `t${spec.label}${suffix}`.toLowerCase().slice(0, 30);
  const password = `pwd-${spec.suite}-${spec.label}-2026`;

  const res = await request
    .post('/tenant/users')
    .set('Host', TEST_TENANT.host)
    .set('Authorization', adminBearer)
    .send({
      username,
      password,
      displayName: `Test ${spec.label}`,
      roleCode: spec.role,
    });

  if (res.status !== 201) {
    throw new Error(
      `createTestUser falló: ${res.status} ${JSON.stringify(res.body)} (username=${username})`,
    );
  }

  const id = (res.body as { user: { id: string } }).user.id;
  return { id, username, password };
}
