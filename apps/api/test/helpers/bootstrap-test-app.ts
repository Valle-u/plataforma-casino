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
import type { Server } from 'http';
import supertest from 'supertest';
import { AppModule } from '../../src/app.module';
import { resetMutableState } from '../setup/db-helpers';

export interface TestApp {
  app: INestApplication;
  request: supertest.Agent;
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
}

export async function bootstrapTestApp(opts: BootstrapOptions = {}): Promise<TestApp> {
  if (opts.resetDb !== false) {
    // Reset rápido: TRUNCATE de tablas mutables + wallets. Mantiene
    // users/roles/permissions/role_permissions intactos.
    // No es 100% garantizado contra contaminación si un test asume
    // estado específico del seed (admin balance, etc.) — esos tests
    // deben crear sus propios users frescos (helper test-users.ts).
    await resetMutableState();
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

  const server = app.getHttpServer() as Server;
  const request = supertest(server);

  return {
    app,
    request,
    close: async () => {
      await app.close();
    },
  };
}
