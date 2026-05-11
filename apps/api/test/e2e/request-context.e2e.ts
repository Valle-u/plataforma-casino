/**
 * E2E: RequestContextMiddleware.
 *
 * Valida que:
 *   - Toda response trae header `X-Request-Id`.
 *   - Dos requests distintos reciben request_ids distintos.
 *   - El audit log captura `requestId`, `ip` y `userAgent` del request.
 *
 * Es la suite "smoke" del proyecto: si pasa, toda la pipeline
 * (middleware → guard → handler → audit → query) está OK.
 */

import { TEST_TENANT } from '../setup/test-tenant';
import { loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';

describe('RequestContextMiddleware (E2E)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('expone X-Request-Id en cada response', async () => {
    const res = await ctx.request
      .post('/tenant/auth/login')
      .set('Host', TEST_TENANT.host)
      .send({
        username: TEST_TENANT.admin.username,
        password: TEST_TENANT.admin.password,
      });

    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('da request_ids distintos en dos requests consecutivos', async () => {
    const r1 = await ctx.request.get('/health').set('Host', TEST_TENANT.host);
    const r2 = await ctx.request.get('/health').set('Host', TEST_TENANT.host);

    // /health no existe todavía (404) pero el middleware corre igual antes.
    expect(r1.headers['x-request-id']).toBeDefined();
    expect(r2.headers['x-request-id']).toBeDefined();
    expect(r1.headers['x-request-id']).not.toBe(r2.headers['x-request-id']);
  });

  it('captura request_id, ip y user_agent en la fila de audit_log', async () => {
    const adminToken = await loginAsAdmin(ctx.request);

    // Acción que sabemos que produce audit: create user.
    const username = `audit_target_${Date.now()}`;
    const createRes = await ctx.request
      .post('/tenant/users')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .set('User-Agent', 'JestTest/1.0')
      .send({
        username,
        password: 'jest-test-123',
        displayName: 'Audit Target',
        roleCode: 'cajero',
      });

    expect(createRes.status).toBe(201);
    const requestId = createRes.headers['x-request-id'] as string;
    const targetId = (createRes.body as { user: { id: string } }).user.id;

    // Query audit-log filtrando por target.
    const auditRes = await ctx.request
      .get(`/tenant/audit-log?targetId=${targetId}`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);

    expect(auditRes.status).toBe(200);
    const entries = (auditRes.body as { entries: Array<Record<string, unknown>> }).entries;
    expect(entries.length).toBeGreaterThan(0);

    const createEntry = entries.find((e) => e.actionCode === 'users.create');
    expect(createEntry).toBeDefined();
    expect(createEntry!.requestId).toBe(requestId);
    expect(createEntry!.userAgent).toBe('JestTest/1.0');
    // IP puede ser ::1, ::ffff:127.0.0.1, o 127.0.0.1 según OS/network stack.
    expect(typeof createEntry!.ip).toBe('string');
    expect((createEntry!.ip as string).length).toBeGreaterThan(0);
  });
});
