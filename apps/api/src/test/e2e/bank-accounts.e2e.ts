/**
 * Cuentas bancarias PROPIAS del tenant (E2E).
 *
 * Por qué existen: al cargar una transferencia, el titular y el banco de
 * nuestra cuenta se escribían a mano. Nada impedía poner un tercero, y es lo
 * que pasó en producción. Acá se definen una vez y el formulario las elige.
 *
 * Lo que se fija:
 *   - alta / edición / listado
 *   - NO se puede repetir una cuenta activa (sería indistinguible al elegirla)
 *   - la baja es LÓGICA: la cuenta sale del selector pero no se borra
 */

import { sql } from 'drizzle-orm';
import { loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { TEST_TENANT } from '../setup/test-tenant';

describe('Cuentas bancarias propias (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
  });

  afterAll(async () => {
    await ctx.close();
  });

  afterEach(async () => {
    await ctx.tenantDb.execute(sql`DELETE FROM bank_accounts`);
  });

  function create(body: Record<string, unknown>) {
    return ctx.request
      .post('/tenant/bank-accounts')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send(body);
  }

  const CUENTA = {
    label: 'Mercado Pago principal',
    accountHolder: 'Julio Voltio',
    bankName: 'Mercado Pago',
    accountIdentifier: '0000003100010000000001',
  };

  it('alta y listado', async () => {
    const res = await create(CUENTA);
    expect(res.status).toBe(201);
    expect(res.body.accountHolder).toBe('Julio Voltio');
    expect(res.body.isActive).toBe(true);

    const list = await ctx.request
      .get('/tenant/bank-accounts')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].label).toBe('Mercado Pago principal');
  });

  it('no deja repetir una cuenta activa (sería indistinguible al elegirla)', async () => {
    expect((await create(CUENTA)).status).toBe(201);
    // Mismo titular + banco + identificador, con otro nombre visible: sigue
    // siendo la misma cuenta.
    const dup = await create({ ...CUENTA, label: 'Otro nombre' });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('BANK_ACCOUNT_DUPLICATE');
  });

  it('la comparación ignora mayúsculas y espacios', async () => {
    expect((await create(CUENTA)).status).toBe(201);
    const dup = await create({
      ...CUENTA,
      label: 'Otro',
      accountHolder: '  JULIO VOLTIO  ',
      bankName: 'mercado pago',
    });
    expect(dup.status).toBe(409);
  });

  it('dos cuentas del mismo banco conviven si el identificador difiere', async () => {
    expect((await create(CUENTA)).status).toBe(201);
    const otra = await create({
      ...CUENTA,
      label: 'Mercado Pago secundaria',
      accountIdentifier: '0000003100010000000002',
    });
    expect(otra.status).toBe(201);
  });

  it('la baja es LÓGICA: sale del selector pero la fila queda', async () => {
    const creada = await create(CUENTA);
    const id = creada.body.id as string;

    const baja = await ctx.request
      .post(`/tenant/bank-accounts/${id}/active`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ isActive: false });
    expect(baja.status).toBe(200);
    expect(baja.body.isActive).toBe(false);

    // El selector no la ofrece…
    const activas = await ctx.request
      .get('/tenant/bank-accounts')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);
    expect(activas.body.data).toHaveLength(0);

    // …pero la fila sigue existiendo. Las transferencias viejas se cargaron con
    // esta cuenta: borrarla dejaría huérfano un dato de auditoría de plata.
    const todas = await ctx.request
      .get('/tenant/bank-accounts?includeInactive=true')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);
    expect(todas.body.data).toHaveLength(1);
  });

  it('dada de baja, se puede volver a crear la misma cuenta', async () => {
    const creada = await create(CUENTA);
    await ctx.request
      .post(`/tenant/bank-accounts/${creada.body.id}/active`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ isActive: false });

    // El índice único es parcial sobre las activas, así que esto entra.
    const nueva = await create(CUENTA);
    expect(nueva.status).toBe(201);
  });

  it('editar el titular actualiza la cuenta', async () => {
    const creada = await create(CUENTA);
    const res = await ctx.request
      .patch(`/tenant/bank-accounts/${creada.body.id}`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ accountHolder: 'Julio Voltio SRL' });
    expect(res.status).toBe(200);
    expect(res.body.accountHolder).toBe('Julio Voltio SRL');
  });

  it('id inexistente → 404', async () => {
    const res = await ctx.request
      .patch('/tenant/bank-accounts/00000000-0000-4000-8000-000000000000')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ label: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('BANK_ACCOUNT_NOT_FOUND');
  });
});
