/**
 * E2E: HouseController — monitoring endpoints (Fase 5.b docs/16).
 *
 *   - GET /tenant/house/stock-alert-status
 *   - GET /tenant/house/capital-needed?days=30
 *
 * Ambos aceptan `operatorUserId` opcional para consultar la salud de un
 * socio indep en vez de la Casa. Los umbrales viven en `tenant_settings`
 * bajo las keys `house.stock_threshold_low` / `_critical`. Fallbacks:
 * 50.000 / 10.000.
 *
 * Cobertura:
 *   T-S1: Casa con balance ALTO (default seed 100M) → level='ok'.
 *   T-S2: Casa con balance entre critical y low → level='low'.
 *   T-S3: Casa con balance <= critical → level='critical'.
 *   T-S4: umbrales custom en tenant_settings sobreescriben los defaults.
 *   T-S5: 400 si operatorUserId no existe o no es indep.
 *
 *   T-C1: capital-needed cálculo correcto — sub-red con withdrawals y
 *         deposits en la ventana → netOutflow y suggestedInject exactos.
 *   T-C2: capital-needed con days=1 excluye tx viejas.
 *   T-C3: capital-needed sin actividad → netOutflow=0 y suggested=0 si
 *         current > threshold.
 *   T-C4: capital-needed con operatorUserId=indep filtra tx solo de la
 *         sub-red del indep.
 *   T-C5: 400 si days > 365 o < 1.
 */

import { sql } from 'drizzle-orm';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser, type TestUser } from '../helpers/test-users';
import { TenantSettingsService } from '../../tenant-settings/tenant-settings.service';

interface StockAlertBody {
  level: 'ok' | 'low' | 'critical';
  balance: string;
  thresholdLow: string;
  thresholdCritical: string;
  operatorUserId: string | null;
}

interface CapitalNeededBody {
  periodDays: number;
  totalWithdrawals: string;
  totalDeposits: string;
  netOutflow: string;
  currentBalance: string;
  suggestedInject: string;
  operatorUserId: string | null;
}

async function setHouseBalance(ctx: TestApp, balance: string): Promise<void> {
  await ctx.tenantDb.execute(sql`
    UPDATE wallets SET balance = ${balance}::numeric
    WHERE user_id = (SELECT id FROM users WHERE username = '__casa__')
  `);
}

async function setUserBalance(
  ctx: TestApp,
  userId: string,
  balance: string,
): Promise<void> {
  // Provisionar wallet si no existe + setear balance.
  await ctx.tenantDb.execute(sql`
    INSERT INTO wallets (id, user_id, balance, locked_balance)
    VALUES (gen_random_uuid(), ${userId}, ${balance}::numeric, '0')
    ON CONFLICT (user_id) DO UPDATE SET balance = ${balance}::numeric
  `);
}

async function clearMonitoringSettings(ctx: TestApp): Promise<void> {
  await ctx.tenantDb.execute(sql`
    DELETE FROM tenant_settings
    WHERE key IN ('house.stock_threshold_low', 'house.stock_threshold_critical')
  `);
}

/**
 * Escribe un setting **por el servicio**, no por SQL directo.
 *
 * ⚠️ Antes esto hacía un INSERT ... ON CONFLICT contra `tenant_settings`, y por
 * eso T-S4 fallaba: `TenantSettingsService` tiene un **caché in-memory con TTL
 * de 5 minutos que sólo se invalida desde `set()`/`unset()`**. Un test anterior
 * del archivo ya había leído esas claves y dejó cacheado "no existe", así que
 * el servicio devolvía los defaults y el umbral custom no se aplicaba nunca.
 *
 * El síntoma engañaba: parecía que el override de umbrales estaba roto en
 * producción. No lo está — era el test escribiendo por debajo del caché.
 */
async function setSetting(
  ctx: TestApp,
  key: string,
  value: number,
): Promise<void> {
  await ctx.app
    .get(TenantSettingsService)
    .set(ctx.tenantDb, key, value, null);
}

/** Borra un setting para que vuelva a regir el default. También invalida caché. */
async function unsetSetting(ctx: TestApp, key: string): Promise<void> {
  await ctx.app.get(TenantSettingsService).unset(ctx.tenantDb, key);
}

/** Inserta una wallet_transaction sintética en el wallet del user. */
async function insertWalletTx(
  ctx: TestApp,
  params: {
    userId: string;
    type: 'withdrawal' | 'deposit';
    amount: string;
    createdAt?: Date;
  },
): Promise<void> {
  // La wallet ya debe existir (crearla si no).
  await ctx.tenantDb.execute(sql`
    INSERT INTO wallets (id, user_id, balance, locked_balance)
    VALUES (gen_random_uuid(), ${params.userId}, '0', '0')
    ON CONFLICT (user_id) DO NOTHING
  `);
  const key = `monitor-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  const createdAt = params.createdAt ?? new Date();
  await ctx.tenantDb.execute(sql`
    INSERT INTO wallet_transactions
      (id, wallet_id, type, amount, balance_after, source, idempotency_key, created_at)
    SELECT gen_random_uuid(), w.id, ${params.type}, ${params.amount}::numeric,
           '0', 'monitor_test', ${key}, ${createdAt.toISOString()}::timestamptz
    FROM wallets w WHERE w.user_id = ${params.userId}
  `);
}

async function makeIndependent(
  ctx: TestApp,
  userId: string,
  cbu: string,
): Promise<void> {
  await ctx.tenantDb.execute(sql`
    UPDATE users
       SET is_independent_branch = true,
           branch_bank_account = ${cbu}
     WHERE id = ${userId}
  `);
}

describe('HouseController monitoring endpoints (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    // Limpiamos settings y balance de la Casa a un valor "alto" default para
    // aislar cada test. Cada test setea lo que necesita.
    await clearMonitoringSettings(ctx);
    await setHouseBalance(ctx, '100000000');
    // Aislamos capital-needed: eliminamos todas las withdrawals/deposits
    // sintéticas previas (de esta suite o del seed) para que los deltas de
    // agregación sean determinísticos.
    await ctx.tenantDb.execute(sql`
      DELETE FROM wallet_transactions
      WHERE type IN ('withdrawal', 'deposit')
    `);
  });

  // ────────────────────────────────────────────────────────────────────────
  // GET /tenant/house/stock-alert-status
  // ────────────────────────────────────────────────────────────────────────

  describe('GET /stock-alert-status', () => {
    it('T-S1: Casa con balance alto → level="ok"', async () => {
      const r = await ctx.request
        .get('/tenant/house/stock-alert-status')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r.status).toBe(200);
      const body = r.body as StockAlertBody;
      expect(body.level).toBe('ok');
      expect(Number(body.balance)).toBe(100_000_000);
      expect(body.thresholdLow).toBe('50000.00');
      expect(body.thresholdCritical).toBe('10000.00');
      expect(body.operatorUserId).toBeNull();
    });

    it('T-S2: Casa con balance entre critical y low → level="low"', async () => {
      await setHouseBalance(ctx, '25000'); // > 10k, <= 50k
      const r = await ctx.request
        .get('/tenant/house/stock-alert-status')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r.status).toBe(200);
      expect((r.body as StockAlertBody).level).toBe('low');
    });

    it('T-S3: Casa con balance <= critical → level="critical"', async () => {
      await setHouseBalance(ctx, '5000');
      const r = await ctx.request
        .get('/tenant/house/stock-alert-status')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r.status).toBe(200);
      expect((r.body as StockAlertBody).level).toBe('critical');
    });

    it('T-S4: umbrales custom en tenant_settings sobreescriben defaults', async () => {
      await setSetting(ctx, 'house.stock_threshold_low', 200_000);
      await setSetting(ctx, 'house.stock_threshold_critical', 50_000);
      // Balance de la Casa = 100k → con custom low=200k debería marcar "low".
      await setHouseBalance(ctx, '100000');
      const r = await ctx.request
        .get('/tenant/house/stock-alert-status')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r.status).toBe(200);
      const body = r.body as StockAlertBody;
      expect(body.level).toBe('low');
      expect(body.thresholdLow).toBe('200000.00');
      expect(body.thresholdCritical).toBe('50000.00');

      // ⚠️ Devolver los umbrales a los defaults. Este test es el ÚNICO que los
      // toca, y mientras el `setSetting` de arriba escribía por SQL directo el
      // caché los ignoraba, así que ensuciar no tenía consecuencias. Ahora que
      // funciona, dejarlos seteados le rompe a `/capital-needed`: con un umbral
      // de 200k y balance de 100k, `suggestedInject` deja de ser 0.
      await unsetSetting(ctx, 'house.stock_threshold_low');
      await unsetSetting(ctx, 'house.stock_threshold_critical');
    });

    it('T-S5: 400 si operatorUserId no es indep', async () => {
      // El admin_tenant existe pero no es socio indep → INJECT_OPERATOR_INVALID.
      const adminRow = (await ctx.tenantDb.execute(
        sql`SELECT id FROM users WHERE username = ${TEST_TENANT.admin.username} LIMIT 1`,
      )) as unknown as Array<{ id: string }>;
      const adminId = adminRow[0]!.id;

      const r = await ctx.request
        .get(`/tenant/house/stock-alert-status?operatorUserId=${adminId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r.status).toBe(400);
      expect((r.body as { error: string }).error).toBe('INJECT_OPERATOR_INVALID');
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // GET /tenant/house/capital-needed
  // ────────────────────────────────────────────────────────────────────────

  describe('GET /capital-needed', () => {
    let player: TestUser;

    beforeEach(async () => {
      // Player en la red admin (para que sus tx cuenten para la Casa).
      // Usa random suffix distinto en cada test para evitar colisiones dentro
      // de la misma corrida.
      player = await createTestUser(ctx.request, adminToken, {
        suite: 'monitoring',
        label: `pl${Math.random().toString(36).slice(2, 6)}`,
        role: 'usuario_final',
      });
      // Sin balance específico: setea 0 para que la wallet exista.
      await setUserBalance(ctx, player.id, '0');
    });

    it('T-C1: withdrawals y deposits agregan correctamente + netOutflow', async () => {
      await setHouseBalance(ctx, '100000');
      await insertWalletTx(ctx, {
        userId: player.id,
        type: 'withdrawal',
        amount: '30000',
      });
      await insertWalletTx(ctx, {
        userId: player.id,
        type: 'withdrawal',
        amount: '10000',
      });
      await insertWalletTx(ctx, {
        userId: player.id,
        type: 'deposit',
        amount: '5000',
      });

      const r = await ctx.request
        .get('/tenant/house/capital-needed?days=30')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r.status).toBe(200);
      const body = r.body as CapitalNeededBody;
      expect(body.periodDays).toBe(30);
      expect(Number(body.totalWithdrawals)).toBe(40000);
      expect(Number(body.totalDeposits)).toBe(5000);
      expect(Number(body.netOutflow)).toBe(35000);
      expect(Number(body.currentBalance)).toBe(100000);
      // suggested = max(0, netOutflow - balance + thresholdLow)
      //           = max(0, 35000 - 100000 + 50000) = 0
      expect(Number(body.suggestedInject)).toBe(0);
      expect(body.operatorUserId).toBeNull();
    });

    it('T-C2: days=1 excluye tx viejas (fuera de la ventana)', async () => {
      const old = new Date(Date.now() - 5 * 24 * 3600 * 1000); // hace 5 días
      await insertWalletTx(ctx, {
        userId: player.id,
        type: 'withdrawal',
        amount: '999999',
        createdAt: old,
      });
      await insertWalletTx(ctx, {
        userId: player.id,
        type: 'withdrawal',
        amount: '1000',
      });
      const r = await ctx.request
        .get('/tenant/house/capital-needed?days=1')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r.status).toBe(200);
      const body = r.body as CapitalNeededBody;
      expect(Number(body.totalWithdrawals)).toBe(1000);
    });

    it('T-C3: sin actividad → netOutflow=0 y suggested=0 (balance > threshold)', async () => {
      await setHouseBalance(ctx, '100000');
      const r = await ctx.request
        .get('/tenant/house/capital-needed?days=30')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r.status).toBe(200);
      const body = r.body as CapitalNeededBody;
      expect(Number(body.totalWithdrawals)).toBe(0);
      expect(Number(body.totalDeposits)).toBe(0);
      expect(Number(body.netOutflow)).toBe(0);
      expect(Number(body.suggestedInject)).toBe(0);
    });

    it('T-C4: sub-red del indep aísla el cálculo', async () => {
      // Crear socio indep + su player descendente. El player de la Casa
      // (el `player` del beforeEach) NO debe contar cuando consultamos
      // por operatorUserId=indep.
      const socio = await createTestUser(ctx.request, adminToken, {
        suite: 'monitoring',
        label: `so${Math.random().toString(36).slice(2, 6)}`,
        role: 'socio',
      });
      await makeIndependent(ctx, socio.id, 'CBU-MONITORING');
      await setUserBalance(ctx, socio.id, '20000');

      // Player que cuelga del indep: en el MVP la jerarquía se resuelve via
      // manager_user_id. Creamos el player como usuario_final asignado al indep.
      // Para simular la relación, seteamos manager_user_id vía SQL directo.
      const indepPlayer = await createTestUser(ctx.request, adminToken, {
        suite: 'monitoring',
        label: `ip${Math.random().toString(36).slice(2, 6)}`,
        role: 'usuario_final',
      });
      // Cerrar cualquier relación activa previa del player (por si el seed
      // lo colgó del admin), después insertar la nueva → indep.
      await ctx.tenantDb.execute(sql`
        UPDATE user_hierarchy SET until = now()
        WHERE user_id = ${indepPlayer.id} AND until IS NULL
      `);
      await ctx.tenantDb.execute(sql`
        INSERT INTO user_hierarchy (id, user_id, parent_user_id, relation_type, since, created_at)
        VALUES (gen_random_uuid(), ${indepPlayer.id}, ${socio.id},
                'jugador_de_socio', now(), now())
      `);
      await setUserBalance(ctx, indepPlayer.id, '0');

      // Withdrawals en las dos sub-redes.
      await insertWalletTx(ctx, {
        userId: player.id, // red admin (Casa)
        type: 'withdrawal',
        amount: '7777',
      });
      await insertWalletTx(ctx, {
        userId: indepPlayer.id, // sub-red del indep
        type: 'withdrawal',
        amount: '3333',
      });

      // Consulta por la Casa → sólo la 7777, NUNCA la 3333.
      const rCasa = await ctx.request
        .get('/tenant/house/capital-needed?days=30')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(rCasa.status).toBe(200);
      expect(Number((rCasa.body as CapitalNeededBody).totalWithdrawals)).toBe(
        7777,
      );

      // Consulta por el indep → sólo la 3333 (la del propio player del indep).
      // Nota: la sub-red del indep incluye al PROPIO indep + descendants, así
      // que también sumaría withdrawals del socio directamente si los hubiera.
      const rIndep = await ctx.request
        .get(`/tenant/house/capital-needed?days=30&operatorUserId=${socio.id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(rIndep.status).toBe(200);
      const bodyIndep = rIndep.body as CapitalNeededBody;
      expect(Number(bodyIndep.totalWithdrawals)).toBe(3333);
      expect(Number(bodyIndep.currentBalance)).toBe(20000);
      expect(bodyIndep.operatorUserId).toBe(socio.id);
    });

    it('T-C5: 400 si days > 365 o < 1', async () => {
      const r1 = await ctx.request
        .get('/tenant/house/capital-needed?days=400')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r1.status).toBe(400);

      const r2 = await ctx.request
        .get('/tenant/house/capital-needed?days=0')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r2.status).toBe(400);
    });
  });
});
