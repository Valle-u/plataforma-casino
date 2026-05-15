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
import { eq } from 'drizzle-orm';
import { tenants, type ControlDb } from '@casino/db';
import type { Server } from 'http';
import supertest from 'supertest';
import { AppModule } from '../../src/app.module';
import { CONTROL_DB } from '../../src/database/database.module';
import { TenantConnectionCache } from '../../src/tenant-resolver/tenant-connection-cache';
import type { TenantDb } from '../../src/tenant-resolver/tenant-context';
import { TwoFaPolicyService } from '../../src/tenant-auth/two-fa-policy.service';
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
