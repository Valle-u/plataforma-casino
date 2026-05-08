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
import { DatabaseModule } from './database/database.module';
import { TenantsModule } from './tenants/tenants.module';

@Module({
  imports: [
    // ConfigModule lee variables de entorno desde .env.local y .env.
    // 'isGlobal: true' = está disponible en cualquier módulo sin reimportar.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    // DatabaseModule provee el cliente Drizzle de la DB de control.
    // Es @Global, cualquier módulo puede inyectar CONTROL_DB.
    DatabaseModule,

    // Endpoints de tenants (CRUD del super-admin).
    TenantsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
