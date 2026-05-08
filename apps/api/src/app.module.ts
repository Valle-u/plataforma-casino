/**
 * Módulo raíz de la aplicación.
 *
 * En NestJS, todo se organiza en "módulos". Un módulo es como un departamento
 * de la empresa: agrupa controllers + services + cosas que pertenecen a un dominio.
 *
 * AppModule es el módulo "raíz", el primero que NestJS carga.
 * Acá vamos a registrar otros módulos a medida que los creemos:
 *   - AuthModule
 *   - WalletModule
 *   - UsersModule
 *   - etc.
 *
 * Por ahora solo tenemos el AppController de ejemplo (Hello World).
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    // ConfigModule lee variables de entorno desde .env y las hace disponibles
    // en toda la app vía inyección de dependencias.
    // 'isGlobal: true' = no hay que importarlo en cada módulo, está disponible siempre.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
