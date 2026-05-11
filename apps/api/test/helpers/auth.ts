/**
 * Helpers de auth para tests.
 *
 * Centraliza la lógica de "loguearse como X, devolver token Bearer listo
 * para usar en `request.get(...).set('Authorization', token)`".
 */

import supertest from 'supertest';
import { TEST_TENANT } from '../setup/test-tenant';

export type Bearer = string;

/**
 * Login contra el tenant de test. Devuelve el header Authorization listo.
 * Tira si las creds fallan (cualquier 4xx hace fail explícito al test).
 */
export async function loginAs(
  request: supertest.Agent,
  username: string,
  password: string,
): Promise<Bearer> {
  const res = await request
    .post('/tenant/auth/login')
    .set('Host', TEST_TENANT.host)
    .send({ username, password });

  if (res.status !== 200 && res.status !== 201) {
    throw new Error(
      `Login fallido para ${username}: HTTP ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
  const token = (res.body as { accessToken?: string }).accessToken;
  if (!token) {
    throw new Error(`Login OK pero sin accessToken en response: ${JSON.stringify(res.body)}`);
  }
  return `Bearer ${token}`;
}

/** Conveniencia: login con las creds del admin del tenant test. */
export function loginAsAdmin(request: supertest.Agent): Promise<Bearer> {
  return loginAs(request, TEST_TENANT.admin.username, TEST_TENANT.admin.password);
}

/** Conveniencia: cajero1. */
export function loginAsCajero1(request: supertest.Agent): Promise<Bearer> {
  return loginAs(request, TEST_TENANT.cajero1.username, TEST_TENANT.cajero1.password);
}

/** Conveniencia: cajero2. */
export function loginAsCajero2(request: supertest.Agent): Promise<Bearer> {
  return loginAs(request, TEST_TENANT.cajero2.username, TEST_TENANT.cajero2.password);
}
