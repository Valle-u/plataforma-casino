/**
 * TenantAuthController — endpoints de auth para usuarios DENTRO de un tenant.
 *
 * Todos requieren TenantContext (resuelto por TenantResolverMiddleware del Host).
 *
 * Endpoints:
 *   POST /tenant/auth/login    — username + password → access + refresh
 *   POST /tenant/auth/refresh  — rota refresh
 *   POST /tenant/auth/logout   — revoca sesión
 *   GET  /tenant/auth/me       — info del user actual (requiere JWT)
 */

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { EffectivePermissionsService } from '../permissions/effective-permissions.service';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import type { Request } from 'express';
import {
  extractRequestContext,
  type RequestWithContext,
} from '../request-context/request-context';
import { AuditLogService } from '../audit/audit-log.service';
import { LoginStreakService } from '../promotions/login-streak.service';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { RateLimiterService } from '../rate-limit/rate-limiter.service';
import { TurnstileService } from '../security/turnstile.service';
import { AllowWithoutTwoFa } from './allow-without-two-fa.decorator';
import { ChangeMyPasswordDto } from './dto/change-password.dto';
import { TenantLoginDto } from './dto/tenant-login.dto';
import { TenantRefreshDto } from './dto/tenant-refresh.dto';
import { TenantLogoutDto } from './dto/tenant-logout.dto';
import { TenantRegisterDto } from './dto/tenant-register.dto';
import { TwoFaCodeDto } from './dto/two-fa.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import {
  TenantAuthService,
  type SessionContext,
  type TenantAuthResult,
} from './tenant-auth.service';
import { TenantJwtGuard } from './guards/tenant-jwt.guard';
import { CurrentTenantUser } from './decorators/current-tenant-user.decorator';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { TenantUsersService } from '../tenant-users/tenant-users.service';
import { userHasPanelAccess } from './panel-access';
import {
  TwoFaAlreadyEnabledError,
  TwoFaCodeInvalidError,
  TwoFaNotInitializedError,
} from './two-fa.errors';
import { TwoFaService } from './two-fa.service';
import { ReferralsService } from '../referrals/referrals.service';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';
import { users, userSessions, type User } from '@casino/db';
import { and, desc, eq, isNull } from 'drizzle-orm';

@Controller('tenant/auth')
export class TenantAuthController {
  constructor(
    private readonly authService: TenantAuthService,
    private readonly twoFa: TwoFaService,
    private readonly audit: AuditLogService,
    private readonly limiter: RateLimiterService,
    private readonly loginStreak: LoginStreakService,
    private readonly tenantUsers: TenantUsersService,
    private readonly effectivePermissions: EffectivePermissionsService,
    private readonly hierarchy: UserHierarchyService,
    private readonly referrals: ReferralsService,
    private readonly tenantSettings: TenantSettingsService,
    private readonly turnstile: TurnstileService,
  ) {}

  /**
   * Login con rate-limit en dos buckets (Sprint 54 — cierre OWASP M-001):
   *
   *   1. (ip+username) 10 intentos / 15 min: frena brute-force de password
   *      contra UN usuario desde UNA IP. El usuario legítimo se libera
   *      al login exitoso vía `limiter.reset(req.rateLimitKey)` abajo.
   *
   *   2. (ip) 100 intentos / 15 min: frena credential stuffing — un
   *      atacante que rota miles de usernames distintos desde la misma
   *      IP (1 intento por user). Sin este bucket, el (ip+username) lo
   *      deja pasar porque cada combinación tiene contador propio.
   *      NO se resetea en login exitoso: un atacante que logra entrar
   *      a UN user no debe limpiar su contador global.
   *
   *   Normalización: el campo username se baja a lowercase+trim para que
   *   `Foo ` y `foo` colisionen en el mismo bucket.
   */
  @Post('login')
  @UseGuards(RateLimitGuard)
  @RateLimit([
    {
      rule: 'auth.login',
      limit: 10,
      windowSec: 15 * 60,
      scope: 'ip+body.username',
    },
    {
      rule: 'auth.login.ip',
      limit: 100,
      windowSec: 15 * 60,
      scope: 'ip',
    },
  ])
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: TenantLoginDto,
    @Req() req: RequestWithTenantContext & { rateLimitKey?: string },
  ): Promise<TenantAuthResult> {
    const ctx = this.requireTenantContext(req);
    // Anti-bot: solo en login de JUGADOR (audience 'player'). El login del
    // panel/staff es acceso interno y no lleva CAPTCHA. No-op si Turnstile
    // está desactivado (TURNSTILE_ENABLED != true).
    if (dto.audience === 'player') {
      await this.turnstile.verify(dto.turnstileToken, 'login');
    }
    const result = await this.authService.login(
      ctx.db,
      ctx.tenant.id,
      dto.username,
      dto.password,
      this.extractContext(req),
      dto.twoFaCode,
      dto.recoveryCode,
      // Sprint 43: audience-based login. Backward-compat: si el cliente
      // no lo manda, asumimos 'panel' (rechaza players). Frontend admin
      // pasa 'panel' explícito; frontend player pasa 'player'.
      dto.audience,
    );
    // Reset-on-success: si el usuario logró autenticarse (incluyendo 2FA),
    // borramos el contador de intentos. Un legítimo que tipeó mal 3 veces
    // y entró en la 4ta NO queda bloqueado por las próximas N. El attacker
    // por definición no llega acá (no completa el flow).
    if (req.rateLimitKey) {
      await this.limiter.reset(req.rateLimitKey);
    }

    // Hook fail-soft: dispara claim de cualquier login_streak activa
    // con `config.autoClaimOnLogin = true`. No esperamos el resultado
    // — el login retorna inmediatamente; el streak se procesa en
    // background.  Si falla, log warning, login sigue OK.
    void this.loginStreak
      .autoClaimOnLogin(ctx.db, result.user.id)
      .catch((err: unknown) => {
        // Best-effort. No tiramos.
         
        console.warn(
          `[autoClaimOnLogin] tenant=${ctx.tenant.slug} user=${result.user.id} error=${(err as Error).message}`,
        );
      });

    return result;
  }

  /**
   * POST /tenant/auth/register — registro público de jugadores vía referral link.
   *
   * Endpoint SIN auth. Rate limit: 5 intentos / 15 min por IP.
   *
   * Flujo:
   *   0. Valida que el tenant tenga registros abiertos (site.registration_enabled).
   *   1. Valida edad + consentimiento (docs/12 §6.1, §16.1).
   *   2. Crea usuario con rol `usuario_final`.
   *   3. Si viene `ref`: resuelve código → crea referral_attribution →
   *      auto-parent en user_hierarchy (respeta R5, jerarquía).
   *   4. Emite JWT → el jugador queda logueado inmediatamente.
   *
   * Leyes: R5 (solo usuario_final), P4 (multi-tenant).
   */
  @Post('register')
  @UseGuards(RateLimitGuard)
  @RateLimit({
    rule: 'auth.register',
    limit: 5,
    windowSec: 15 * 60,
    scope: 'ip',
  })
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() dto: TenantRegisterDto,
    @Req() req: RequestWithTenantContext,
  ): Promise<TenantAuthResult> {
    const ctx = this.requireTenantContext(req);
    const db = ctx.db;

    // Anti-bot: registro público es un blanco típico de cuentas falsas / abuso
    // de bonos. No-op si Turnstile está desactivado.
    await this.turnstile.verify(dto.turnstileToken, 'register');

    // 0. Registros abiertos/cerrados (site.registration_enabled, default abierto).
    //    Si el tenant cerró los registros, rechazamos con 403 claro. Leyes:
    //    P4 (multi-tenant), R5 (solo usuario_final por este canal).
    const registrationEnabled =
      (await this.tenantSettings.get<boolean>(
        db,
        'site.registration_enabled',
      )) !== false;
    if (!registrationEnabled) {
      throw new ForbiddenException({
        message: 'Los registros están cerrados en este casino.',
        error: 'REGISTRATION_CLOSED',
      });
    }

    // 1. Validar edad (docs/12 §6.1).
    if (!dto.ageConfirmation) {
      throw new BadRequestException({
        message: 'Debés confirmar que sos mayor de 18 años.',
        error: 'AGE_CONFIRMATION_REQUIRED',
      });
    }

    // 2. Validar consentimiento (docs/12 §16.1 — Ley 25.326).
    if (!dto.consentDataProcessing) {
      throw new BadRequestException({
        message: 'Debés aceptar el tratamiento de datos personales.',
        error: 'CONSENT_REQUIRED',
      });
    }

    // 2.5 Teléfono obligatorio (registration.phone_required, default true).
    //     Toggle desde Configuración → Sistema. Enforcement server-side: el
    //     DTO lo valida como string opcional, la obligatoriedad la decide el
    //     tenant en runtime.
    const phoneRequired =
      (await this.tenantSettings.get<boolean>(
        db,
        'registration.phone_required',
      )) !== false;
    if (phoneRequired && !dto.phone?.trim()) {
      throw new BadRequestException({
        message: 'El teléfono es obligatorio.',
        error: 'PHONE_REQUIRED',
      });
    }

    // 3. Normalizar username: lowercase + trim.
    const normalizedUsername = dto.username.toLowerCase().trim();

    // 4. Verificar que username no esté en uso.
    const existingUser = await this.tenantUsers.findByUsername(
      db,
      normalizedUsername,
    );
    if (existingUser) {
      throw new ConflictException({
        message: 'Este nombre de usuario ya está en uso.',
        error: 'USERNAME_TAKEN',
      });
    }

    // 5. Verificar email único (si se provee).
    if (dto.email) {
      const existingEmail = await this.tenantUsers.findByEmail(
        db,
        dto.email,
      );
      if (existingEmail) {
        throw new ConflictException({
          message: 'Este email ya está registrado.',
          error: 'EMAIL_TAKEN',
        });
      }
    }

    // 6. Resolver referrer si viene código (Fase 2).
    let referrerInfo: {
      id: string;
      roleCodes: string[];
      isHouse: boolean;
    } | null = null;
    if (dto.ref && dto.ref.trim().length > 0) {
      referrerInfo = await this.referrals.resolveReferrerId(
        db,
        dto.ref.trim(),
      );
      // Si el código es inválido, simplemente no atribuimos — no revelamos
      // si el código existe o no (seguridad).
    }

    // 7. Crear usuario con rol usuario_final.
    const ctx2 = extractRequestContext(req);
    const newUser = await this.tenantUsers.create(db, {
      username: normalizedUsername,
      password: dto.password,
      displayName: dto.displayName,
      email: dto.email ?? undefined,
      phone: dto.phone ?? undefined,
      roleCode: 'usuario_final',
      createdBy: referrerInfo?.id ?? null,
    });

    // 8. Registrar consentimiento + edad en el usuario (docs/12 §6.1, §16.1).
    //    Nota: create() no soporta estos campos aún, así que los updateamos.
    await db
      .update(users)
      .set({
        ageConfirmedAt: new Date(),
        consentDataProcessing: true,
        updatedAt: new Date(),
      })
      .where(eq(users.id, newUser.id));

    // 9. Si hay referrer, crear atribución (tracking del código usado).
    if (referrerInfo) {
      await this.referrals.createAttribution(db, {
        userId: newUser.id,
        referralCode: dto.ref!.trim(),
        referrerUserId: referrerInfo.id,
        ip: ctx2.ip ?? null,
        userAgent: ctx2.userAgent ?? null,
        referer: req.headers['referer'] ?? null,
      });
    }

    // 10. Auto-parent. Modelo "la casa = el admin":
    //   - referrer OPERADOR (socio/distri/cajero) → jugador_de_<rol> bajo él.
    //   - referrer = campaña del admin (isHouse) → jugador_de_admin bajo el
    //     admin dueño de la campaña.
    //   - sin referrer (orgánico) → jugador_de_admin bajo el admin PRIMARIO
    //     del tenant. Los jugadores de la casa cuelgan del admin (antes
    //     quedaban root; el admin los ve igual por view_any, pero colgarlos
    //     los ancla a la red de la casa). El motor de comisiones excluye
    //     siempre al admin_tenant, así que esto NO genera comisiones.
    let parentUserId: string | null = null;
    let relationType: string | null = null;
    if (referrerInfo && !referrerInfo.isHouse) {
      if (referrerInfo.roleCodes.includes('socio')) {
        relationType = 'jugador_de_socio';
      } else if (referrerInfo.roleCodes.includes('distribuidor')) {
        relationType = 'jugador_de_distribuidor';
      } else if (referrerInfo.roleCodes.includes('cajero')) {
        relationType = 'jugador_de_cajero';
      }
      if (relationType) parentUserId = referrerInfo.id;
    } else if (referrerInfo && referrerInfo.isHouse) {
      // Campaña del admin: cuelga del admin dueño de la campaña.
      parentUserId = referrerInfo.id;
      relationType = 'jugador_de_admin';
    }
    if (!parentUserId) {
      // Orgánico (o referrer que no produjo parent operador): cuelga del admin.
      const adminId = await this.hierarchy.getPrimaryAdminUserId(db);
      if (adminId) {
        parentUserId = adminId;
        relationType = 'jugador_de_admin';
      }
    }
    if (parentUserId && relationType && parentUserId !== newUser.id) {
      await this.hierarchy.setParent(db, {
        userId: newUser.id,
        parentUserId,
        relationType,
        actorUserId: parentUserId,
      });
    }

    // 10. Audit log (severity: low — es un registro normal, no privilegiado).
    await this.audit.record(db, {
      actorUserId: newUser.id,
      actorUsername: normalizedUsername,
      actionCode: 'auth.register',
      targetType: 'user',
      targetId: newUser.id,
      metadata: {
        severity: 'low',
        method: 'self_register',
        referralCode: dto.ref ?? null,
        referrerUserId: referrerInfo?.id ?? null,
        hasAgeConfirmation: true,
        hasConsent: true,
      },
      ...ctx2,
    });

    // 11. Emitir JWT (login automático post-registro).
    const result = await this.authService.login(
      db,
      ctx.tenant.id,
      normalizedUsername,
      dto.password,
      this.extractContext(req),
      undefined, // no 2FA en registro
      undefined, // no recovery code
      'player',  // audience player (es un jugador)
    );

    return result;
  }

  @Post('refresh')
  // Sin JWT (valida el refresh token del body), y lo dispara el middleware en
  // cada navegación con token vencido → rate-limit por IP para que no lo
  // martilleen contra la DB. Límite alto para no romper NAT (muchos users por IP).
  @UseGuards(RateLimitGuard)
  @RateLimit({
    rule: 'auth.refresh',
    limit: 120,
    windowSec: 60,
    scope: 'ip',
  })
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() dto: TenantRefreshDto,
    @Req() req: RequestWithTenantContext,
  ): Promise<TenantAuthResult> {
    const ctx = this.requireTenantContext(req);
    return this.authService.refresh(
      ctx.db,
      ctx.tenant.id,
      dto.refreshToken,
      this.extractContext(req),
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Body() dto: TenantLogoutDto,
    @Req() req: RequestWithTenantContext,
  ): Promise<void> {
    const ctx = this.requireTenantContext(req);
    await this.authService.logout(ctx.db, dto.refreshToken);
  }

  /**
   * GET /tenant/auth/sessions
   *
   * Lista las sesiones ACTIVAS del user actual (revokedAt IS NULL), de más
   * nueva a más vieja. El `user_sessions.user_agent` crudo se convierte a
   * una etiqueta de dispositivo legible para la UI "Mis dispositivos".
   *
   * `isCurrent` marca la sesión del JWT que hizo el request (comparando
   * contra el `sid` propagado al requestContext por el guard). El frontend
   * la muestra como "este dispositivo" y deshabilita su revocación.
   */
  @Get('sessions')
  @UseGuards(TenantJwtGuard)
  @AllowWithoutTwoFa()
  async listMySessions(
    @CurrentTenantUser() actor: { id: string; username: string },
    @Req() req: RequestWithTenantContext,
  ): Promise<{ sessions: MySessionView[] }> {
    const db = this.requireTenantContext(req).db;
    const currentSessionId =
      (req as RequestWithContext).requestContext?.sessionId ?? null;

    const rows = await db
      .select({
        id: userSessions.id,
        userAgent: userSessions.userAgent,
        ip: userSessions.ip,
        createdAt: userSessions.createdAt,
        expiresAt: userSessions.expiresAt,
        impersonatedByUserId: userSessions.impersonatedByUserId,
      })
      .from(userSessions)
      .where(
        and(
          eq(userSessions.userId, actor.id),
          isNull(userSessions.revokedAt),
        ),
      )
      .orderBy(desc(userSessions.createdAt));

    return {
      sessions: rows.map((row) => ({
        id: row.id,
        deviceLabel: deviceLabelFromUserAgent(row.userAgent),
        ip: row.ip,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        isCurrent: row.id === currentSessionId,
        impersonatedBy: row.impersonatedByUserId,
      })),
    };
  }

  /**
   * DELETE /tenant/auth/sessions/:id
   *
   * El user revoca UNA de sus sesiones activas (cierre de sesión remoto).
   * Solo puede revocar sesiones propias; no puede revocar la sesión actual
   * (para eso existe `logout`). Idempotente: revocar una sesión ya revocada
   * devuelve 404.
   *
   * Audit `auth.session.revoke` severity:medium — quién mató qué sesión
   * queda trazado para forensics.
   */
  @Delete('sessions/:id')
  @UseGuards(TenantJwtGuard)
  @AllowWithoutTwoFa()
  @HttpCode(HttpStatus.OK)
  async revokeMySession(
    @Param('id', ParseUUIDPipe) sessionId: string,
    @CurrentTenantUser() actor: { id: string; username: string },
    @Req() req: RequestWithTenantContext,
  ): Promise<{ ok: true }> {
    const db = this.requireTenantContext(req).db;
    const currentSessionId =
      (req as RequestWithContext).requestContext?.sessionId ?? null;

    if (sessionId === currentSessionId) {
      throw new ConflictException({
        message:
          'No podés cerrar la sesión actual desde acá — usá "Cerrar sesión".',
        error: 'CANNOT_REVOKE_CURRENT_SESSION',
      });
    }

    const rows = await db
      .update(userSessions)
      .set({ revokedAt: new Date(), revokedReason: 'user' })
      .where(
        and(
          eq(userSessions.id, sessionId),
          eq(userSessions.userId, actor.id),
          isNull(userSessions.revokedAt),
        ),
      )
      .returning({ id: userSessions.id });

    if (rows.length === 0) {
      throw new NotFoundException('Sesión no encontrada.');
    }

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'auth.session.revoke',
      targetType: 'user_session',
      targetId: sessionId,
      metadata: { severity: 'medium' },
      ...extractRequestContext(req),
    });

    return { ok: true };
  }

  /**
   * GET /tenant/auth/me
   * Devuelve datos del user autenticado.
   * Requiere TenantJwtGuard (que a su vez requiere TenantContext).
   */
  @Get('me')
  @UseGuards(TenantJwtGuard)
  @AllowWithoutTwoFa()
  async me(
    @CurrentTenantUser()
    user: {
      id: string;
      username: string;
      email: string | null;
      displayName: string;
      impersonatedBy?: string | null;
    },
    @Req() req: RequestWithTenantContext,
  ): Promise<Record<string, unknown>> {
    // Sprint 43: enriquecemos /me con roles + flag de panel access para
    // que el frontend decida si renderizar /dashboard o redirigir a /play.
    // Default deny: si por alguna razón fallara la query (DB lenta, etc.),
    // mejor reportar canAccessPanel=false que dejar pasar por error.
    let roleCodes: string[] = [];
    // Sprint 51.3: agregamos isIndependentBranch para que la UI pueda
    // hacer gating fino — tabs "mis plantillas / del tenant" en bonuses,
    // banners read-only en promotions/leagues para socios independent.
    let isIndependentBranch = false;
    // Sprint 51.4: agregamos twoFaEnabled para que la UI sepa si tiene
    // que pedir código 2FA en operaciones sensibles (reset-password,
    // force-clear, etc.).
    let twoFaEnabled = false;
    // Permisos EFECTIVOS del actor (roles + overrides). La UI los usa para
    // gatear botones por permiso (ej. mostrar "Destruir fichas" solo a
    // quien tenga wallet.burn). Es solo UX — el backend revalida
    // en cada endpoint vía PermissionsGuard. Default `[]` = default-deny.
    let effectivePermissions: string[] = [];
    // underIndependentBranch: true si el user NO es el socio titular pero
    // está bajo una sucursal independiente (ej. cajero/dealer de un socio
    // independiente). Sirve para gating de UI (sidebar, botones).
    let underIndependentBranch = false;
    // Parte A perfil/wallet (docs/21): datos de perfil para que la UI los
    // muestre y edite vía PATCH /tenant/auth/me. Defaults seguros si la
    // query fallara (default-deny como el resto de este endpoint).
    let profilePhone: string | null = null;
    let profileFirstName: string | null = null;
    let profileLastName: string | null = null;
    let profileLanguage = 'es';
    if (req.tenantContext) {
      try {
        const [rows, fullUser, permsSet, ancestorId] = await Promise.all([
          this.tenantUsers.getRoles(req.tenantContext.db, user.id),
          this.tenantUsers.findById(req.tenantContext.db, user.id),
          this.effectivePermissions.calculateForUser(
            req.tenantContext.db,
            user.id,
          ),
          this.hierarchy.getIndependentBranchAncestor(
            req.tenantContext.db,
            user.id,
          ),
        ]);
        roleCodes = rows.map((r) => r.code);
        isIndependentBranch = !!fullUser?.isIndependentBranch;
        underIndependentBranch = !!ancestorId && !isIndependentBranch;
        twoFaEnabled = !!fullUser?.twoFaEnabled;
        effectivePermissions = Array.from(permsSet);
        profilePhone = fullUser?.phone ?? null;
        profileFirstName = fullUser?.firstName ?? null;
        profileLastName = fullUser?.lastName ?? null;
        profileLanguage = fullUser?.language ?? 'es';
      } catch {
        roleCodes = [];
        isIndependentBranch = false;
        underIndependentBranch = false;
        twoFaEnabled = false;
        effectivePermissions = [];
        profilePhone = null;
        profileFirstName = null;
        profileLastName = null;
        profileLanguage = 'es';
      }
    }
    return {
      user: {
        ...user,
        roles: roleCodes,
        canAccessPanel: userHasPanelAccess(roleCodes),
        isIndependentBranch,
        underIndependentBranch,
        twoFaEnabled,
        effectivePermissions,
        phone: profilePhone,
        firstName: profileFirstName,
        lastName: profileLastName,
        language: profileLanguage,
      },
      tenant: req.tenantContext
        ? {
            id: req.tenantContext.tenant.id,
            slug: req.tenantContext.tenant.slug,
            name: req.tenantContext.tenant.name,
          }
        : null,
    };
  }

  /**
   * POST /tenant/auth/me/password (Sprint 51.5)
   *
   * El user autenticado cambia su propia password. Verifica la actual
   * antes de updatear (defensa contra robo de sesión / browser
   * unattended). Si tiene 2FA habilitada, exige también `twoFaCode`.
   *
   * Audit `auth.self_password_change` severity:high. No notif al user
   * (la acción es del propio user).
   *
   * NO invalida sesiones activas (mismo criterio que reset-password
   * Sprint 51.4).
   */
  @Post('me/password')
  @UseGuards(TenantJwtGuard)
  @AllowWithoutTwoFa()
  @HttpCode(HttpStatus.OK)
  async changeMyPassword(
    @Body() dto: ChangeMyPasswordDto,
    @CurrentTenantUser() actor: { id: string; username: string },
    @Req() req: RequestWithTenantContext,
  ): Promise<{ ok: true; sessionsInvalidated: false }> {
    if (!req.tenantContext) throw new Error('TenantContext faltante.');
    const db = req.tenantContext.db;

    const user = await this.tenantUsers.findById(db, actor.id);
    if (!user) {
      throw new NotFoundException(`User ${actor.id} no existe.`);
    }

    // Verificar la password actual contra el hash.
    const verify = await this.authService.verifyUserPassword(
      user.passwordHash,
      dto.currentPassword,
    );
    if (!verify) {
      throw new UnauthorizedException({
        message: 'Password actual incorrecta.',
        error: 'INVALID_CURRENT_PASSWORD',
      });
    }

    // 2FA condicional: si el user lo tiene habilitado, exige código.
    const twoFaEnabled = await this.twoFa.isEnabled(db, actor.id);
    if (twoFaEnabled) {
      if (!dto.twoFaCode) {
        throw new BadRequestException({
          message: 'Esta operación requiere código 2FA.',
          error: 'TWO_FA_REQUIRED',
        });
      }
      try {
        await this.twoFa.verify(db, actor.id, dto.twoFaCode);
      } catch (err) {
        throw new BadRequestException({
          message: (err as Error).message,
          error: 'TWO_FA_CODE_INVALID',
        });
      }
    }

    // Persistir nueva password.
    await this.tenantUsers.resetPassword(db, actor.id, dto.newPassword);

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'auth.self_password_change',
      targetType: 'user',
      targetId: actor.id,
      metadata: { severity: 'high' },
      ...extractRequestContext(req),
    });

    return { ok: true, sessionsInvalidated: false };
  }

  /**
   * PATCH /tenant/auth/me (Parte A del plan perfil/wallet — docs/21).
   *
   * El user autenticado edita SU propio perfil: firstName, lastName, phone,
   * email, language. `displayName` se deriva de nombre+apellido en el
   * service (`tenantUsers.update`). Idempotente: body vacío = sin cambios.
   * 409 si el email ya está en uso por otro user.
   *
   * Sin 2FA: es edición de perfil propio, no operación sensible.
   * Audit `auth.self_profile_update` severity:low.
   */
  @Patch('me')
  @UseGuards(TenantJwtGuard)
  @AllowWithoutTwoFa()
  async updateMyProfile(
    @Body() dto: UpdateMyProfileDto,
    @CurrentTenantUser() actor: { id: string; username: string },
    @Req() req: RequestWithTenantContext,
  ): Promise<{ ok: true; user: Omit<User, 'passwordHash' | 'twoFaSecret'> }> {
    if (!req.tenantContext) throw new Error('TenantContext faltante.');
    const db = req.tenantContext.db;

    const updated = await this.tenantUsers.update(db, actor.id, {
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone,
      email: dto.email,
      language: dto.language,
    });

    const { passwordHash: _ph, twoFaSecret: _secret, ...publicUser } = updated;

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'auth.self_profile_update',
      targetType: 'user',
      targetId: actor.id,
      metadata: {
        severity: 'low',
        changed: {
          firstName: dto.firstName ?? null,
          lastName: dto.lastName ?? null,
          phone: dto.phone ?? null,
          email: dto.email ?? null,
          language: dto.language ?? null,
        },
      },
      ...extractRequestContext(req),
    });

    return { ok: true, user: publicUser };
  }

  /**
   * POST /tenant/auth/impersonate/:userId
   *
   * Sprint 37: admin emite un par de tokens "como" otro user. Validaciones
   * en el service (target existe + active, actor != target). Permission
   * `users.impersonate` chequeado via guard. Audit severity:high.
   *
   * El frontend debe guardar el token original en sessionStorage ANTES de
   * llamar este endpoint, para poder restaurarlo con "Volver a mi cuenta".
   * Si el frontend olvida guardar, el admin tiene que re-loguearse.
   */
  @Post('impersonate/:userId')
  @UseGuards(TenantJwtGuard, PermissionsGuard)
  @RequirePermissions('users.impersonate')
  @HttpCode(HttpStatus.OK)
  async impersonate(
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @CurrentTenantUser() actor: { id: string; username: string },
    @Req() req: RequestWithTenantContext,
    @Body() body?: { reason?: string },
  ): Promise<TenantAuthResult> {
    if (!req.tenantContext) {
      throw new NotFoundException('Tenant no resuelto.');
    }
    const db = req.tenantContext.db;
    const ctx = extractRequestContext(req);

    // R6/E8 — intervención super-admin: si el target cae en una sub-red
    // INDEPENDIENTE, el impersonate es el ÚNICO cruce permitido al aislamiento,
    // y es más estricto que un impersonate normal — exige el permiso DEDICADO
    // `users.intervene_independent` + un motivo, y audita con severity critical.
    // Impersonar dentro de la red central sigue como estaba (severity high).
    const indepSocioId = await this.hierarchy.getIndependentBranchAncestor(
      db,
      targetUserId,
    );
    const isIntervention = indepSocioId !== null;
    if (isIntervention) {
      const canIntervene = await this.effectivePermissions.hasAllPermissions(
        db,
        actor.id,
        ['users.intervene_independent'],
      );
      if (!canIntervene) {
        throw new ForbiddenException({
          message:
            'Impersonar dentro de una sub-red independiente requiere el permiso dedicado `users.intervene_independent` (intervención super-admin). El impersonate normal no cruza el aislamiento (E8/P3).',
          error: 'INTERVENE_INDEPENDENT_REQUIRED',
        });
      }
      if (!body?.reason || body.reason.trim().length === 0) {
        throw new BadRequestException({
          message:
            'Intervenir en una sub-red independiente exige un motivo (queda auditado con severity critical).',
          error: 'INTERVENE_REASON_REQUIRED',
        });
      }
    }

    const result = await this.authService.impersonate(
      db,
      req.tenantContext.tenant.id,
      actor.id,
      targetUserId,
      { userAgent: ctx.userAgent ?? undefined, ip: ctx.ip ?? undefined },
    );

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: isIntervention
        ? 'users.intervene_independent'
        : 'users.impersonate.start',
      targetType: 'user',
      targetId: targetUserId,
      metadata: isIntervention
        ? {
            severity: 'critical',
            targetUsername: result.user.username,
            independentSocioId: indepSocioId,
            reason: body!.reason!.trim(),
            crossedIndependentBranch: true,
          }
        : { severity: 'high', targetUsername: result.user.username },
      ...ctx,
    });
    return result;
  }

  /**
   * POST /tenant/auth/2fa/init
   * Inicia setup de 2FA TOTP para el user logueado. Genera un secret
   * nuevo y devuelve el otpauth:// URL para que el frontend genere QR.
   * Tras escanear, el user debe llamar /2fa/confirm con un código.
   *
   * 409 si el user ya tiene 2FA activo (debe disable primero).
   */
  @Post('2fa/init')
  @UseGuards(TenantJwtGuard)
  @AllowWithoutTwoFa()
  @HttpCode(HttpStatus.OK)
  async initTwoFa(
    @CurrentTenantUser() actor: { id: string; username: string },
    @Req() req: RequestWithTenantContext,
  ): Promise<{ secret: string; otpauthUrl: string }> {
    const ctx = this.requireTenantContext(req);
    try {
      const result = await this.twoFa.initSetup(ctx.db, actor.id, ctx.tenant.slug);
      await this.audit.record(ctx.db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'auth.2fa.init',
        targetType: 'user',
        targetId: actor.id,
        metadata: { severity: 'high' },
        ...extractRequestContext(req),
      });
      return result;
    } catch (err) {
      if (err instanceof TwoFaAlreadyEnabledError) {
        throw new ConflictException({ message: err.message, error: 'TWO_FA_ALREADY_ENABLED' });
      }
      throw err;
    }
  }

  /**
   * POST /tenant/auth/2fa/confirm
   * Confirma el setup con un código de 6 dígitos. Solo después de esto
   * el sistema EXIGE 2FA al user.
   *
   * Devuelve 10 recovery codes — el frontend DEBE mostrarlos al user en
   * este punto (UNA sola vez). Si el user los pierde y pierde su app TOTP,
   * solo soporte puede recuperarlo.
   */
  @Post('2fa/confirm')
  // Orden importa: TenantJwtGuard primero para que `req.tenantUser` esté
  // populado cuando RateLimitGuard arma la clave con scope 'user'.
  @UseGuards(TenantJwtGuard, RateLimitGuard)
  @AllowWithoutTwoFa()
  @RateLimit({
    rule: 'auth.2fa.confirm',
    limit: 10,
    windowSec: 15 * 60,
    scope: 'user',
  })
  @HttpCode(HttpStatus.OK)
  async confirmTwoFa(
    @Body() dto: TwoFaCodeDto,
    @CurrentTenantUser() actor: { id: string; username: string },
    @Req() req: RequestWithTenantContext & { rateLimitKey?: string },
  ): Promise<{ ok: true; recoveryCodes: string[] }> {
    const ctx = this.requireTenantContext(req);
    let result: { recoveryCodes: string[] };
    try {
      result = await this.twoFa.confirmSetup(ctx.db, actor.id, dto.code);
    } catch (err) {
      if (err instanceof TwoFaCodeInvalidError) {
        throw new BadRequestException({ message: err.message, error: 'TWO_FA_CODE_INVALID' });
      }
      if (err instanceof TwoFaNotInitializedError) {
        throw new BadRequestException({ message: err.message, error: 'TWO_FA_NOT_INITIALIZED' });
      }
      if (err instanceof TwoFaAlreadyEnabledError) {
        throw new ConflictException({ message: err.message, error: 'TWO_FA_ALREADY_ENABLED' });
      }
      throw err;
    }
    // Reset-on-success: el user legítimo no debe quedar bloqueado por
    // intentos de typo previos.
    if (req.rateLimitKey) await this.limiter.reset(req.rateLimitKey);
    await this.audit.record(ctx.db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'auth.2fa.enabled',
      targetType: 'user',
      targetId: actor.id,
      metadata: { severity: 'high', recoveryCodesIssued: result.recoveryCodes.length },
      ...extractRequestContext(req),
    });
    return { ok: true, recoveryCodes: result.recoveryCodes };
  }

  /**
   * POST /tenant/auth/2fa/recovery-codes/regenerate
   * Genera un batch nuevo de recovery codes, invalidando los anteriores.
   * Requiere TOTP fresco (defensa anti-sesión robada).
   */
  @Post('2fa/recovery-codes/regenerate')
  @UseGuards(TenantJwtGuard, RateLimitGuard)
  @RateLimit({
    rule: 'auth.2fa.recovery_regen',
    limit: 5,
    windowSec: 60 * 60,
    scope: 'user',
  })
  @HttpCode(HttpStatus.OK)
  async regenerateRecoveryCodes(
    @Body() dto: TwoFaCodeDto,
    @CurrentTenantUser() actor: { id: string; username: string },
    @Req() req: RequestWithTenantContext & { rateLimitKey?: string },
  ): Promise<{ ok: true; recoveryCodes: string[] }> {
    const ctx = this.requireTenantContext(req);
    let result: { recoveryCodes: string[] };
    try {
      result = await this.twoFa.regenerateRecoveryCodes(ctx.db, actor.id, dto.code);
    } catch (err) {
      if (err instanceof TwoFaCodeInvalidError) {
        throw new BadRequestException({ message: err.message, error: 'TWO_FA_CODE_INVALID' });
      }
      if (err instanceof TwoFaNotInitializedError) {
        throw new BadRequestException({ message: err.message, error: 'TWO_FA_NOT_INITIALIZED' });
      }
      throw err;
    }
    if (req.rateLimitKey) await this.limiter.reset(req.rateLimitKey);
    await this.audit.record(ctx.db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'auth.2fa.recovery_codes.regenerated',
      targetType: 'user',
      targetId: actor.id,
      metadata: { severity: 'high', count: result.recoveryCodes.length },
      ...extractRequestContext(req),
    });
    return { ok: true, recoveryCodes: result.recoveryCodes };
  }

  /**
   * GET /tenant/auth/2fa/recovery-codes/count
   * Cantidad de recovery codes vigentes (no usados). El frontend lo
   * muestra para que el user sepa cuántos backups le quedan.
   */
  @Get('2fa/recovery-codes/count')
  @UseGuards(TenantJwtGuard)
  @AllowWithoutTwoFa()
  @HttpCode(HttpStatus.OK)
  async countRecoveryCodes(
    @CurrentTenantUser() actor: { id: string },
    @Req() req: RequestWithTenantContext,
  ): Promise<{ active: number }> {
    const ctx = this.requireTenantContext(req);
    const active = await this.twoFa.countActiveRecoveryCodes(ctx.db, actor.id);
    return { active };
  }

  /**
   * DELETE /tenant/auth/2fa
   * Desactiva 2FA. Body con código actual para evitar que un atacante
   * con sesión robada lo apague.
   */
  @Delete('2fa')
  @UseGuards(TenantJwtGuard)
  @HttpCode(HttpStatus.OK)
  async disableTwoFa(
    @Body() dto: TwoFaCodeDto,
    @CurrentTenantUser() actor: { id: string; username: string },
    @Req() req: RequestWithTenantContext,
  ): Promise<{ ok: true }> {
    const ctx = this.requireTenantContext(req);
    try {
      await this.twoFa.disable(ctx.db, actor.id, dto.code);
    } catch (err) {
      if (err instanceof TwoFaCodeInvalidError) {
        throw new UnauthorizedException({ message: err.message, error: 'TWO_FA_CODE_INVALID' });
      }
      if (err instanceof TwoFaNotInitializedError) {
        throw new BadRequestException({ message: err.message, error: 'TWO_FA_NOT_INITIALIZED' });
      }
      throw err;
    }
    await this.audit.record(ctx.db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'auth.2fa.disabled',
      targetType: 'user',
      targetId: actor.id,
      metadata: { severity: 'high' },
      ...extractRequestContext(req),
    });
    return { ok: true };
  }

  private requireTenantContext(
    req: RequestWithTenantContext,
  ): NonNullable<RequestWithTenantContext['tenantContext']> {
    if (!req.tenantContext) {
      throw new NotFoundException(
        'No se encontró tenant para este Host. Verificá tenant_domains.',
      );
    }
    return req.tenantContext;
  }

  private extractContext(req: Request): SessionContext {
    return {
      userAgent: req.header('user-agent') ?? undefined,
      ip: req.ip ?? undefined,
    };
  }
}

/** Vista de una sesión activa para el player (sin token_hash). */
interface MySessionView {
  id: string;
  deviceLabel: string;
  ip: string | null;
  createdAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
  impersonatedBy: string | null;
}

/** Convierte un User-Agent crudo a una etiqueta de dispositivo legible. */
function deviceLabelFromUserAgent(ua: string | null): string {
  if (!ua) return 'Dispositivo desconocido';
  const uaLower = ua.toLowerCase();
  const os = /android/i.test(uaLower)
    ? 'Android'
    : /iphone|ipad|ipod/i.test(uaLower)
      ? 'iOS'
      : /windows/i.test(uaLower)
        ? 'Windows'
        : /mac os x|macintosh/i.test(uaLower)
          ? 'macOS'
          : /linux/i.test(uaLower)
            ? 'Linux'
            : null;
  const browser = /edg\//i.test(uaLower)
    ? 'Edge'
    : /firefox\//i.test(uaLower)
      ? 'Firefox'
      : /opr\//i.test(uaLower)
        ? 'Opera'
        : /chrome\//i.test(uaLower)
          ? 'Chrome'
          : /safari\//i.test(uaLower)
            ? 'Safari'
            : null;
  if (os && browser) return `${os} · ${browser}`;
  if (os) return os;
  if (browser) return browser;
  return ua.slice(0, 60);
}
