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
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  // Creamos la app a partir del módulo raíz (AppModule).
  const app = await NestFactory.create(AppModule, {
    // Por ahora dejamos el logger default. Lo reemplazaremos por Pino en una fase posterior.
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

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

  // El puerto sale de variables de entorno; default 3000 si no está seteado.
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);

  logger.log(`🚀 API corriendo en http://localhost:${port}`);
  logger.log(`📚 Health check: http://localhost:${port}/health`);
  logger.log(`🔐 Auth: POST http://localhost:${port}/platform/auth/login`);
}

// Llamamos a bootstrap y manejamos cualquier error fatal al arrancar.
bootstrap().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('❌ Error al iniciar la API:', error);
  process.exit(1);
});
