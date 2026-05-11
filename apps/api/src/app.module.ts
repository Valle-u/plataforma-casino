import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { PermissionsModule } from './permissions/permissions.module';
import { PlatformAuthModule } from './platform-auth/platform-auth.module';
import { PlatformUsersModule } from './platform-users/platform-users.module';
import { TenantAuthModule } from './tenant-auth/tenant-auth.module';
import { TenantInfoModule } from './tenant-info/tenant-info.module';
import { TenantResolverModule } from './tenant-resolver/tenant-resolver.module';
import { TenantResolverMiddleware } from './tenant-resolver/tenant-resolver.middleware';
import { TenantUsersModule } from './tenant-users/tenant-users.module';
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

    // TenantResolverModule provee cache de conexiones a tenant DBs.
    // El middleware se registra abajo en configure().
    TenantResolverModule,

    // Auth y users a nivel plataforma (super-admins).
    PlatformUsersModule,
    PlatformAuthModule,

    // Endpoints de tenants (super-admin gestiona los tenants del sistema).
    TenantsModule,

    // Sistema de permisos atómicos (compartido por toda auth a nivel tenant).
    PermissionsModule,

    // Auth y users a nivel tenant (admin del tenant, socios, cajeros, jugadores).
    TenantAuthModule,
    TenantUsersModule,

    // Endpoint demo del TenantContext (público, lee req.tenantContext).
    TenantInfoModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  /**
   * Registra el TenantResolverMiddleware.
   * Aplica a todas las rutas: si el host no matchea ningún tenant, el middleware
   * deja seguir sin context. Endpoints que requieran tenant rechazan después.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantResolverMiddleware).forRoutes('*');
  }
}
