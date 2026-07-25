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
import { extractRequestContext } from '../request-context/request-context';
import { AuditLogService } from '../audit/audit-log.service';
import { LoginStreakService } from '../promotions/login-streak.service';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { RateLimiterService } from '../rate-limit/rate-limiter.service';
import { AllowWithoutTwoFa } from './allow-without-two-fa.decorator';
import { ChangeMyPasswordDto } from './dto/change-password.dto';
import { TenantLoginDto } from './dto/tenant-login.dto';
import { TenantRefreshDto } from './dto/tenant-refresh.dto';
import { TenantLogoutDto } from './dto/tenant-logout.dto';
import { TenantRegisterDto } from './dto/tenant-register.dto';
import { TwoFaCodeDto } from './dto/two-fa.dto';
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
import { users } from '@casino/db';
import { eq } from 'drizzle-orm';

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
      this.limiter.reset(req.rateLimitKey);
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
    let referrerInfo: { id: string; roleCodes: string[] } | null = null;
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

    // 9. Si hay referrer, crear atribución + auto-parent.
    if (referrerInfo) {
      await this.referrals.createAttribution(db, {
        userId: newUser.id,
        referralCode: dto.ref!.trim(),
        referrerUserId: referrerInfo.id,
        ip: ctx2.ip ?? null,
        userAgent: ctx2.userAgent ?? null,
        referer: req.headers['referer'] ?? null,
      });

      // Auto-parent: el jugador cuelga de su referrer.
      // Usamos la misma lógica que playerParentRelation pero con
      // los roles del referrer (no del actor, porque no hay actor).
      let relationType: string | null = null;
      if (referrerInfo.roleCodes.includes('socio')) {
        relationType = 'jugador_de_socio';
      } else if (referrerInfo.roleCodes.includes('distribuidor')) {
        relationType = 'jugador_de_distribuidor';
      } else if (referrerInfo.roleCodes.includes('cajero')) {
        relationType = 'jugador_de_cajero';
      }

      if (relationType) {
        await this.hierarchy.setParent(db, {
          userId: newUser.id,
          parentUserId: referrerInfo.id,
          relationType,
          actorUserId: referrerInfo.id,
        });
      }
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
    if (req.tenantContext) {
      try {
        const [rows, fullUser, permsSet] = await Promise.all([
          this.tenantUsers.getRoles(req.tenantContext.db, user.id),
          this.tenantUsers.findById(req.tenantContext.db, user.id),
          this.effectivePermissions.calculateForUser(
            req.tenantContext.db,
            user.id,
          ),
        ]);
        roleCodes = rows.map((r) => r.code);
        isIndependentBranch = !!fullUser?.isIndependentBranch;
        twoFaEnabled = !!fullUser?.twoFaEnabled;
        effectivePermissions = Array.from(permsSet);
      } catch {
        roleCodes = [];
        isIndependentBranch = false;
        twoFaEnabled = false;
        effectivePermissions = [];
      }
    }
    return {
      user: {
        ...user,
        roles: roleCodes,
        canAccessPanel: userHasPanelAccess(roleCodes),
        isIndependentBranch,
        twoFaEnabled,
        effectivePermissions,
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
    if (req.rateLimitKey) this.limiter.reset(req.rateLimitKey);
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
    if (req.rateLimitKey) this.limiter.reset(req.rateLimitKey);
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
