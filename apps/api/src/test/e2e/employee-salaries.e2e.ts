/**
 * E2E: employee_salaries — F1 sueldos por empleado en socios dep.
 *
 * Cubre:
 *   - PUT /tenant/employees/:userId/salary   (upsert)
 *   - GET /tenant/employees/:userId/salary   (consulta)
 *   - GET /tenant/employees/salaries         (listado)
 *
 * Y las validaciones:
 *   - admin_tenant only (403 para socio y otros roles).
 *   - Monto negativo → 400.
 *   - Monto > tope → 400.
 *   - Currency inválida → 400.
 *   - User inexistente → 404.
 *   - Consulta sobre user sin sueldo → 404.
 *   - Idempotencia: upsert con los mismos valores no cambia `updated_at`
 *     lógico (changed=false).
 *   - Historial en audit_log al modificar (severity=medium).
 */

import { sql } from 'drizzle-orm';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { createTestUser } from '../helpers/test-users';
import {
  bootstrapTestApp,
  type TestApp,
} from '../helpers/bootstrap-test-app';
import { TEST_TENANT } from '../setup/test-tenant';

describe('EmployeeSalaries (F1, E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
  });

  afterAll(async () => {
    await ctx.close();
  });

  function putSalary(
    token: string,
    userId: string,
    body: Record<string, unknown>,
  ) {
    return ctx.request
      .put(`/tenant/employees/${userId}/salary`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', token)
      .send(body);
  }

  function getSalary(token: string, userId: string) {
    return ctx.request
      .get(`/tenant/employees/${userId}/salary`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', token);
  }

  function listSalaries(token: string, query = '') {
    return ctx.request
      .get(`/tenant/employees/salaries${query}`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', token);
  }

  it('admin fija sueldo → GET lo devuelve → aparece en la lista', async () => {
    const emp = await createTestUser(ctx.request, adminToken, {
      suite: 'emp-sal-happy',
      label: 'emp',
      role: 'empleado',
    });

    // 1. PUT crea la fila.
    const r1 = await putSalary(adminToken, emp.id, {
      monthlyAmount: 350000,
      currency: 'ARS',
      notes: 'sueldo inicial',
    });
    expect(r1.status).toBe(200);
    expect(r1.body.changed).toBe(true);
    expect(r1.body.salary.userId).toBe(emp.id);
    expect(Number(r1.body.salary.monthlyAmount)).toBe(350000);
    expect(r1.body.salary.currency).toBe('ARS');
    expect(r1.body.salary.notes).toBe('sueldo inicial');

    // 2. GET devuelve la fila.
    const r2 = await getSalary(adminToken, emp.id);
    expect(r2.status).toBe(200);
    expect(Number(r2.body.salary.monthlyAmount)).toBe(350000);

    // 3. Aparece en el listado.
    const r3 = await listSalaries(adminToken);
    expect(r3.status).toBe(200);
    const found = (r3.body.data as Array<{ userId: string }>).find(
      (row) => row.userId === emp.id,
    );
    expect(found).toBeDefined();
  });

  it('upsert idempotente: mismo monto/currency/notes → changed=false, sin nuevo audit entry', async () => {
    const emp = await createTestUser(ctx.request, adminToken, {
      suite: 'emp-sal-idem',
      label: 'emp',
      role: 'empleado',
    });

    const r1 = await putSalary(adminToken, emp.id, {
      monthlyAmount: 200000,
      notes: 'igualito',
    });
    expect(r1.status).toBe(200);
    expect(r1.body.changed).toBe(true);

    // Contar audits antes del segundo PUT.
    const auditsAfterFirst = await ctx.tenantDb.execute(sql`
      SELECT count(*)::int as n FROM audit_log
      WHERE action_code = 'employee_salaries.update' AND target_id = ${emp.id}
    `);
    const nAfterFirst = (auditsAfterFirst as unknown as Array<{ n: number }>)[0]!
      .n;

    const r2 = await putSalary(adminToken, emp.id, {
      monthlyAmount: 200000,
      notes: 'igualito',
    });
    expect(r2.status).toBe(200);
    expect(r2.body.changed).toBe(false);

    const auditsAfterSecond = await ctx.tenantDb.execute(sql`
      SELECT count(*)::int as n FROM audit_log
      WHERE action_code = 'employee_salaries.update' AND target_id = ${emp.id}
    `);
    const nAfterSecond = (auditsAfterSecond as unknown as Array<{ n: number }>)[0]!
      .n;
    expect(nAfterSecond).toBe(nAfterFirst);
  });

  it('registra audit_log con severity=medium al cambiar el sueldo', async () => {
    const emp = await createTestUser(ctx.request, adminToken, {
      suite: 'emp-sal-audit',
      label: 'emp',
      role: 'empleado',
    });

    await putSalary(adminToken, emp.id, { monthlyAmount: 100000 });
    await putSalary(adminToken, emp.id, { monthlyAmount: 150000, notes: 'ajuste' });

    const rows = (await ctx.tenantDb.execute(sql`
      SELECT metadata FROM audit_log
      WHERE action_code = 'employee_salaries.update' AND target_id = ${emp.id}
      ORDER BY created_at ASC
    `)) as unknown as Array<{ metadata: Record<string, unknown> }>;
    expect(rows.length).toBe(2);
    expect(rows[0]!.metadata.severity).toBe('medium');
    expect(rows[0]!.metadata.isFirstSet).toBe(true);
    expect(rows[1]!.metadata.isFirstSet).toBe(false);
    expect(rows[1]!.metadata.monthlyAmount).toBe('150000.00');
  });

  it('validaciones: monto negativo → 400, monto excesivo → 400, currency inválida → 400', async () => {
    const emp = await createTestUser(ctx.request, adminToken, {
      suite: 'emp-sal-valid',
      label: 'emp',
      role: 'empleado',
    });

    const rNeg = await putSalary(adminToken, emp.id, { monthlyAmount: -1 });
    expect(rNeg.status).toBe(400);

    const rHuge = await putSalary(adminToken, emp.id, {
      monthlyAmount: 1e15,
    });
    expect(rHuge.status).toBe(400);

    const rCur = await putSalary(adminToken, emp.id, {
      monthlyAmount: 100000,
      currency: 'arg',
    });
    expect(rCur.status).toBe(400);

    const rCurBad = await putSalary(adminToken, emp.id, {
      monthlyAmount: 100000,
      currency: 'AR',
    });
    expect(rCurBad.status).toBe(400);
  });

  it('404 si el target no existe (upsert)', async () => {
    const fakeId = '00000000-0000-4000-8000-000000000000';
    const r = await putSalary(adminToken, fakeId, { monthlyAmount: 100 });
    expect(r.status).toBe(404);
  });

  it('404 en GET si el user no tiene sueldo configurado', async () => {
    const emp = await createTestUser(ctx.request, adminToken, {
      suite: 'emp-sal-404',
      label: 'emp',
      role: 'empleado',
    });
    const r = await getSalary(adminToken, emp.id);
    expect(r.status).toBe(404);
  });

  it('admin-only: un socio no puede setear ni consultar sueldos → 403', async () => {
    const socio = await createTestUser(ctx.request, adminToken, {
      suite: 'emp-sal-403',
      label: 'socio',
      role: 'socio',
    });
    const emp = await createTestUser(ctx.request, adminToken, {
      suite: 'emp-sal-403',
      label: 'emp',
      role: 'empleado',
    });
    const socioToken = await loginAs(
      ctx.request,
      socio.username,
      socio.password,
    );

    const rSet = await putSalary(socioToken, emp.id, { monthlyAmount: 100000 });
    expect(rSet.status).toBe(403);
    expect(rSet.body.error).toBe('ADMIN_TENANT_ONLY');

    // Primero el admin sí lo setea, para probar el GET del socio.
    await putSalary(adminToken, emp.id, { monthlyAmount: 100000 });

    const rGet = await getSalary(socioToken, emp.id);
    expect(rGet.status).toBe(403);

    const rList = await listSalaries(socioToken);
    expect(rList.status).toBe(403);
  });

  it('lista con hasSalary=false incluye los que están en 0', async () => {
    const empZero = await createTestUser(ctx.request, adminToken, {
      suite: 'emp-sal-zero',
      label: 'zero',
      role: 'empleado',
    });
    await putSalary(adminToken, empZero.id, { monthlyAmount: 0 });

    // Default hasSalary=true → NO aparece.
    const rDefault = await listSalaries(adminToken);
    const foundDefault = (rDefault.body.data as Array<{ userId: string }>).find(
      (r) => r.userId === empZero.id,
    );
    expect(foundDefault).toBeUndefined();

    // hasSalary=false → SÍ aparece.
    const rAll = await listSalaries(adminToken, '?hasSalary=false');
    const foundAll = (rAll.body.data as Array<{ userId: string }>).find(
      (r) => r.userId === empZero.id,
    );
    expect(foundAll).toBeDefined();
    expect(Number(foundAll!['monthlyAmount' as keyof typeof foundAll])).toBe(0);
  });
});
