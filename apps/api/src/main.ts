/**
 * Entry point del backend.
 *
 * Este archivo es el primero que se ejecuta cuando levantamos el server.
 * Se encarga de "arrancar" la aplicación NestJS:
 *  1. Inicializa Sentry (en `./instrument`, que se importa primero de todo).
 *  2. Crea la instancia de la app a partir del módulo raíz.
 *  3. Configura cosas globales (CORS, validation pipes, etc. — los iremos sumando).
 *  4. La pone a escuchar HTTP en un puerto.
 */

// PRIMERO de todo: `Sentry.init()` tiene que correr antes de que se carguen
// los módulos que instrumenta (Express, pg, ioredis). Ver instrument.ts.
import './instrument';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import compression from 'compression';
import { migrateAllDatabases } from '@casino/db';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/global-exception.filter';

/** ¿El env está en "on" (1/true/yes)? Para flags de boot. */
function isTruthy(v: string | undefined): boolean {
  return ['1', 'true', 'yes'].includes((v ?? '').trim().toLowerCase());
}

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  // Migración automática al arrancar (gateada por MIGRATE_ON_BOOT, default OFF).
  // Corre las migraciones pendientes de control + todos los tenants ANTES de
  // servir tráfico, reusando el runner de @casino/db (idempotente: saltea las
  // ya aplicadas). En el VPS (Dokploy) reemplaza el paso manual de
  // db:migrate:tenants — el autoDeploy no corre migraciones. Ver docs/24.
  // Fail-fast: si una migración falla, el proceso sale con código 1 y el api
  // NO arranca (mejor caerse que servir sobre un schema a medias). Pensado para
  // 1 réplica del api; con >1 habría que agregar un lock.
  if (isTruthy(process.env.MIGRATE_ON_BOOT)) {
    const url = process.env.DATABASE_URL_CONTROL;
    if (!url) {
      logger.error(
        'MIGRATE_ON_BOOT activo pero falta DATABASE_URL_CONTROL — abortando.',
      );
      process.exit(1);
    }
    logger.log('MIGRATE_ON_BOOT activo: aplicando migraciones pendientes…');
    await migrateAllDatabases(url, (msg) => logger.log(`[migrate] ${msg}`));
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // En prod solo error/warn/log — `debug`/`verbose` generan ruido y costo de
    // logs innecesario. En dev queda todo para depurar.
    logger:
      process.env.NODE_ENV === 'production'
        ? ['error', 'warn', 'log']
        : ['error', 'warn', 'log', 'debug', 'verbose'],
    // rawBody: expone req.rawBody (Buffer) para verificar la firma Ed25519 del
    // callback de Forever sobre los bytes exactos recibidos (el hash no cierra
    // si re-serializamos el body parseado). Aditivo: no cambia el parsing.
    rawBody: true,
  });

  // Compresión gzip para respuestas JSON
  app.use(compression());

  // CORS: orígenes permitidos del panel/web. En prod (VPS) se setea
  // CORS_ORIGINS = lista separada por comas con los dominios reales. Si no
  // está seteada, cae a los dominios actuales de Vercel para no romper el
  // deploy vigente. En dev se agrega localhost:3001 automáticamente.
  const corsFromEnv = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const corsOrigins =
    corsFromEnv.length > 0
      ? corsFromEnv
      : [
          'https://plataforma-casino-web.vercel.app',
          'https://plataforma-casino-web-ur4.vercel.app',
          'https://admin.plataforma-casino-web-ur4.vercel.app',
        ];
  if (process.env.NODE_ENV === 'development') {
    corsOrigins.push('http://localhost:3001');
  }
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  app.use(helmet({ contentSecurityPolicy: false }));
  app.disable('x-powered-by');

  // ValidationPipe global: valida y transforma todos los DTOs decorados con
  // class-validator. Sin esto, los @IsEmail, @MinLength, etc. son ignorados.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // descarta props que no estén en el DTO
      forbidNonWhitelisted: true, // 400 si el body trae props extra
      transform: true, // convierte tipos automáticamente (string → number, etc.)
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Sprint 51.10: GlobalExceptionFilter — captura toda exception 5xx (y
  // no-HttpException) y loguea con stack + request context redactado
  // (sin passwords, tokens, cookies). Sin esto, NestJS por default
  // imprime body crudo en errores → PII en logs.
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Habilita shutdown hooks: NestJS llama `onApplicationShutdown` de los
  // providers al recibir SIGTERM/SIGINT. Esencial para cerrar pools de
  // Postgres limpiamente.
  app.enableShutdownHooks();

  // El puerto sale de variables de entorno; default 3000 si no está seteado.
  const port = Number(process.env.PORT) || 3000;
  // Sprint 44: listen explícito en `0.0.0.0` para aceptar IPv4 e IPv6
  // (Node 20+ resuelve `localhost` a `::1` por default; sin host explícito
  // NestJS solía bindear solo IPv6 en algunos hosts → ECONNREFUSED de
  // clientes IPv4 que conectaban por `127.0.0.1`).
  await app.listen(port, '0.0.0.0');

  logger.log(`🚀 API corriendo en http://localhost:${port}`);
  logger.log(`📚 Health check: http://localhost:${port}/health`);
  logger.log(`🔐 Auth: POST http://localhost:${port}/platform/auth/login`);
}

// Llamamos a bootstrap y manejamos cualquier error fatal al arrancar.
bootstrap().catch((error: unknown) => {
   
  console.error('❌ Error al iniciar la API:', error);
  process.exit(1);
});
