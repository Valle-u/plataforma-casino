/**
 * Bootstrap de la NestJS app para tests E2E.
 *
 * Diferencias con `main.ts`:
 *   - No escucha puerto (supertest se conecta directo al http server).
 *   - Logger silenciado (solo errores) para no ensuciar la salida de Jest.
 *   - Mantiene `ValidationPipe` global idéntico a producción.
 *
 * Devuelve la app y el cliente supertest listo para usar.
 */

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { tenants, type ControlDb } from '@casino/db';
import type { Server } from 'http';
import supertest from 'supertest';
import { AppModule } from '../../app.module';
import { CONTROL_DB } from '../../database/database.module';
import { TenantConnectionCache } from '../../tenant-resolver/tenant-connection-cache';
import type { TenantDb } from '../../tenant-resolver/tenant-context';
import { RateLimiterService } from '../../rate-limit/rate-limiter.service';
import { TwoFaPolicyService } from '../../tenant-auth/two-fa-policy.service';
import { resetMutableState } from '../setup/db-helpers';
import { TEST_TENANT } from '../setup/test-tenant';

export interface TestApp {
  app: INestApplication;
  request: supertest.Agent;
  /**
   * Cliente Drizzle apuntando a la DB del tenant de test. Útil para tests
   * que invocan services directamente (e.g. NotificationsService.enqueue)
   * sin pasar por HTTP. Se resuelve via TenantConnectionCache → reusa el
   * mismo pool que el resto de la app.
   */
  tenantDb: TenantDb;
  close: () => Promise<void>;
}

export interface BootstrapOptions {
  /**
   * Si true (default), reset completo de la DB de tenant test antes de
   * crear la app: drop + create + migrate + seed (admin + cajero1 + cajero2).
   *
   * Es la única manera GARANTIZADA de evitar contaminación cross-suite
   * con un test runner como Jest que comparte la DB entre archivos.
   * Cuesta ~1-2s por suite pero el ahorro en bugs sutiles vale la pena.
   *
   * Setear false sólo si la suite quiere correr contra el estado de la
   * suite anterior (raro y desaconsejado).
   */
  resetDb?: boolean;

  /**
   * Si true (default false), DEJA habilitada la 2FA policy. Por default
   * la deshabilitamos al inicializar la app porque el seed crea admin y
   * cajeros con roles operativos (que en producción requieren 2FA), pero
   * los tests asumen que el admin puede hacer todo sin 2FA. Solo el
   * suite dedicado de la policy debe pasar `enableTwoFaPolicy: true`.
   */
  enableTwoFaPolicy?: boolean;
}

/**
 * Provisiona + fondea la Casa para que pueda pagar wins en los tests de juego
 * (B-build-4a). `resetMutableState()` trunca `wallets` (no `users`), así que
 * recreamos la wallet de la Casa (y el user, defensivo) y la fondeamos con un
 * bankroll, con un mint tx que lo respalda (balance == Σtx). En producción el
 * dueño aporta capital (B-build-3).
 */
async function fundHouseForTests(db: TenantDb): Promise<void> {
  const HOUSE_BANKROLL = '100000000.00';
  // Casa user (defensivo — users no se trunca, pero por si el seed es viejo).
  await db.execute(sql`
    INSERT INTO users (id, username, display_name, password_hash, status, is_system)
    VALUES (gen_random_uuid(), '__casa__', 'Casa / Tesorería', 'test-no-login', 'active', true)
    ON CONFLICT (username) DO NOTHING
  `);
  // Wallet de la Casa (truncada por resetMutableState) + bankroll.
  await db.execute(sql`
    INSERT INTO wallets (id, user_id, balance, locked_balance)
    SELECT gen_random_uuid(), id, ${HOUSE_BANKROLL}::numeric, '0'
    FROM users WHERE username = '__casa__'
    ON CONFLICT (user_id) DO UPDATE SET balance = ${HOUSE_BANKROLL}::numeric
  `);
  await db.execute(sql`
    INSERT INTO wallet_transactions
      (id, wallet_id, type, amount, balance_after, source, created_at)
    SELECT gen_random_uuid(), w.id, 'mint', ${HOUSE_BANKROLL}::numeric,
           ${HOUSE_BANKROLL}::numeric, 'test_house_bankroll', now()
    FROM wallets w JOIN users u ON u.id = w.user_id
    WHERE u.username = '__casa__'
  `);
}

export async function bootstrapTestApp(opts: BootstrapOptions = {}): Promise<TestApp> {
  if (opts.resetDb !== false) {
    await resetMutableState();
    // Pequeña pausa para que cualquier conexión zombi de suites previas
    // termine de cerrarse antes de que la nueva app abra su pool.
    // Sin esto vemos race intermitente cross-suite con postgres-js.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const app = await NestFactory.create(AppModule, {
    logger: ['error'],
    // Igual que producción: req.rawBody para verificar la firma del callback de Forever.
    rawBody: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Necesario para que `OnApplicationShutdown` de los providers (cache de
  // conexiones, DatabaseModule) corra al hacer `app.close()`. Sin esto,
  // Jest se queda colgado por handles de postgres-js abiertos.
  app.enableShutdownHooks();

  await app.init();

  // Rate limiter: estado limpio por suite.
  //
  // El limiter guarda sus contadores en Redis, asi que sobreviven tanto
  // entre suites como entre corridas enteras de jest. La regla
  // `auth.login.ip` (100 req / 15 min por IP) NO se limpia en login
  // exitoso, y es a proposito: un atacante no debe poder borrar su
  // contador global logueandose bien una sola vez.
  //
  // En produccion eso es lo correcto; en tests significa que las ~76
  // suites, todas saliendo de la misma IP, agotan el presupuesto y de ahi
  // en adelante TODO lo que necesita auth cae con 429 — cientos de tests
  // en rojo por un motivo que no tiene nada que ver con lo que prueban.
  //
  // Limpiar aca le da a cada suite su presupuesto entero SIN apagar el
  // limiter: `rate-limit.e2e.ts` lo necesita activo para poder probarlo,
  // y ya se limpia a si mismo en sus propios hooks.
  await app.get(RateLimiterService).clear();

  // 2FA policy: deshabilitada por default en tests (la mayoría asume
  // admin sin 2FA). El test del policy la habilita explícitamente.
  // IMPORTANTE: forzamos `enable()` o `disable()` explícito en cada
  // bootstrap, sin importar lo que diga el env var. Esto evita que el
  // suite dependa de `TWO_FA_POLICY_ENABLED` del .env.local de dev
  // (que en local puede estar `false` para que el frontend funcione).
  const policy = app.get(TwoFaPolicyService);
  if (opts.enableTwoFaPolicy) {
    policy.enable();
  } else {
    policy.disable();
  }

  const server = app.getHttpServer() as Server;
  const request = supertest(server);

  // Resolver el TenantDb del test tenant via cache (mismo pool que el
  // resto de la app — sin pools paralelos).
  const controlDb = app.get<ControlDb>(CONTROL_DB);
  const cache = app.get(TenantConnectionCache);
  const tenantRows = await controlDb
    .select()
    .from(tenants)
    .where(eq(tenants.slug, TEST_TENANT.slug))
    .limit(1);
  const tenantRow = tenantRows[0];
  if (!tenantRow) {
    throw new Error(`Tenant '${TEST_TENANT.slug}' no encontrado en control DB.`);
  }
  const tenantDb = cache.get(tenantRow);

  // B-build-4a: la Casa es la contraparte del juego (bet→Casa, win←Casa). En
  // tests la fondeamos con un bankroll para que pueda pagar wins; en producción
  // el dueño aporta capital (B-build-3). Mint consistente (balance == Σtx).
  await fundHouseForTests(tenantDb);

  return {
    app,
    request,
    tenantDb,
    close: async () => {
      await app.close();
      // Pausa post-close para asegurar que el pool postgres-js termine de
      // cerrar sus sockets antes de que otra suite empiece a crearlos.
      await new Promise((resolve) => setTimeout(resolve, 100));
    },
  };
}
