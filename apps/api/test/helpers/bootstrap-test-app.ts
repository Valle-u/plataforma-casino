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

export interface TestApp {
  app: INestApplication;
  request: supertest.Agent;
  close: () => Promise<void>;
}

export async function bootstrapTestApp(): Promise<TestApp> {
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
