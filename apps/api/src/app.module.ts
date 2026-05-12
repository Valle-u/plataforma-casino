import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuditModule } from './audit/audit.module';
import { DatabaseModule } from './database/database.module';
import { PermissionsModule } from './permissions/permissions.module';
import { PlatformAuthModule } from './platform-auth/platform-auth.module';
import { PlatformUsersModule } from './platform-users/platform-users.module';
import { RequestContextMiddleware } from './request-context/request-context.middleware';
import { RequestContextModule } from './request-context/request-context.module';
import { TenantAuthModule } from './tenant-auth/tenant-auth.module';
import { TenantInfoModule } from './tenant-info/tenant-info.module';
import { TenantResolverModule } from './tenant-resolver/tenant-resolver.module';
import { TenantResolverMiddleware } from './tenant-resolver/tenant-resolver.middleware';
import { TenantUsersModule } from './tenant-users/tenant-users.module';
import { TenantsModule } from './tenants/tenants.module';
import { DepositsModule } from './deposits/deposits.module';
import { WalletModule } from './wallet/wallet.module';

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

    // RequestContextModule: middleware que asigna requestId + ip + userAgent.
    // Se registra primero abajo en configure().
    RequestContextModule,

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

    // Audit log inmutable por tenant. @Global → AuditLogService inyectable
    // desde cualquier handler.
    AuditModule,

    // Auth y users a nivel tenant (admin del tenant, socios, cajeros, jugadores).
    TenantAuthModule,
    TenantUsersModule,

    // Wallet: área crítica. Mint/burn restringido por permission + check
    // explícito de rol en el service.
    WalletModule,

    // Deposits: flujo autoservicio de carga del jugador.
    DepositsModule,

    // Endpoint demo del TenantContext (público, lee req.tenantContext).
    TenantInfoModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  /**
   * Registra los middlewares en orden:
   *   1. RequestContextMiddleware → asigna requestId + ip + userAgent.
   *   2. TenantResolverMiddleware  → resuelve tenant por host.
   *
   * El orden importa: el resolver y los handlers downstream pueden querer
   * leer `req.requestContext.requestId` para correlacionar logs/audit.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware, TenantResolverMiddleware).forRoutes('*');
  }
}
