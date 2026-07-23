/**
 * Entry point del backend.
 *
 * Este archivo es el primero que se ejecuta cuando levantamos el server.
 * Se encarga de "arrancar" la aplicación NestJS:
 *  1. Crea la instancia de la app a partir del módulo raíz.
 *  2. Configura cosas globales (CORS, validation pipes, etc. — los iremos sumando).
 *  3. La pone a escuchar HTTP en un puerto.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/global-exception.filter';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  // Compresión gzip para respuestas JSON
  app.use(compression());

  // CORS explícito para permitir requests desde Vercel
  app.enableCors({
    origin: [
      'https://plataforma-casino-web.vercel.app',
      'https://plataforma-casino-web-ur4.vercel.app',
      process.env.NODE_ENV === 'development' ? 'http://localhost:3001' : '',
    ].filter(Boolean),
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
