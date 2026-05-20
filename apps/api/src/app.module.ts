import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuditModule } from './audit/audit.module';
import { DatabaseModule } from './database/database.module';
import { PermissionsModule } from './permissions/permissions.module';
import { PlatformAuthModule } from './platform-auth/platform-auth.module';
import { PlatformUsersModule } from './platform-users/platform-users.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { RequestContextMiddleware } from './request-context/request-context.middleware';
import { RequestContextModule } from './request-context/request-context.module';
import { TenantAuthModule } from './tenant-auth/tenant-auth.module';
import { TenantInfoModule } from './tenant-info/tenant-info.module';
import { TenantResolverModule } from './tenant-resolver/tenant-resolver.module';
import { TenantResolverMiddleware } from './tenant-resolver/tenant-resolver.middleware';
import { TenantSettingsModule } from './tenant-settings/tenant-settings.module';
import { TenantUsersModule } from './tenant-users/tenant-users.module';
import { TenantsModule } from './tenants/tenants.module';
import { BonusesModule } from './bonuses/bonuses.module';
import { CommissionsModule } from './commissions/commissions.module';
import { DepositsModule } from './deposits/deposits.module';
import { FraudModule } from './fraud/fraud.module';
import { GamesModule } from './games/games.module';
import { LeaguesModule } from './leagues/leagues.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PaymentMethodsModule } from './payment-methods/payment-methods.module';
import { PromotionsModule } from './promotions/promotions.module';
import { ResponsibleGamingModule } from './responsible-gaming/responsible-gaming.module';
import { UserHierarchyModule } from './user-hierarchy/user-hierarchy.module';
import { WalletModule } from './wallet/wallet.module';
import { WalletStatsModule } from './wallet-stats/wallet-stats.module';
import { WithdrawalsModule } from './withdrawals/withdrawals.module';

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

    // ScheduleModule habilita @Cron / @Interval para jobs internos.
    // Hoy: cron de expiración de bonos (BonusesModule).
    ScheduleModule.forRoot(),

    // RequestContextModule: middleware que asigna requestId + ip + userAgent.
    // Se registra primero abajo en configure().
    RequestContextModule,

    // RateLimitModule: limiter in-memory + decorator + guard. @Global.
    // Anti-brute-force para endpoints sensibles (login, 2fa, etc.).
    RateLimitModule,

    // TenantSettingsModule: key-value config bag per tenant. @Global.
    // Usado por fraud (thresholds), futuro: branding, limits, etc.
    TenantSettingsModule,

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

    // Jerarquía operativa + ScopeGuard. @Global porque casi todos los
    // módulos de mutación lo necesitan.
    UserHierarchyModule,

    // Auth y users a nivel tenant (admin del tenant, socios, cajeros, jugadores).
    TenantAuthModule,
    TenantUsersModule,

    // Wallet: área crítica. Mint/burn restringido por permission + check
    // explícito de rol en el service.
    WalletModule,

    // Wallet stats (Sprint 45): reporting read-only sobre wallet_transactions.
    // Endpoints filtrables + agregados para "Estadísticas de pago" del admin.
    WalletStatsModule,

    // Deposits: flujo autoservicio de carga del jugador.
    DepositsModule,

    // Withdrawals: flujo de retiro del jugador con holds sobre wallet.
    WithdrawalsModule,

    // PaymentMethods: catálogo del tenant (CBU, USDT, etc.). Lectura
    // pública para forms de depósito/retiro del jugador.
    PaymentMethodsModule,

    // Commissions: revenue share a la jerarquía upstream cuando se
    // aprueban deposits/withdrawals. Sprint 24: rules CRUD + compute
    // preview. Sprint 25: apply automático via hooks en deposits/wd.
    CommissionsModule,

    // Bonos: definitions + user_bonuses (grant manual / cancel / force-clear).
    BonusesModule,

    // Promotions / Sorteos (doc 15 §B). Hoy: daily_wheel + login_streak.
    // Pendiente: lottery_tickets, lottery_ranking, missions, level_chests.
    PromotionsModule,

    // Games catálogo (doc 14 fase 5). Sprint 34: CRUD + lobby player.
    // Sprint 35: GameSessionsService + IGameProvider + bet/win loop.
    GamesModule,

    // Leagues / Rankings (doc 15 §C). Métricas MVP: bet_volume, rounds_count.
    LeaguesModule,

    // Antifraude transversal (doc 15 §D). MVP: shared IP + similar email.
    FraudModule,

    // Notificaciones (in_app/email/sms). @Global. Provider de email
    // default = ConsoleEmailProvider (loguea). El dispatcher cron
    // procesa pendings c/5min y purga viejas.
    NotificationsModule,

    // Responsible gaming (doc 12 §6). @Global — hooks de enforcement
    // en deposits.create + login. Límites self-service del player +
    // auto-exclusión + admin force.
    ResponsibleGamingModule,

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
