/**
 * DepositsController — endpoints del flujo de carga autoservicio.
 *
 * Usuarios (jugadores y cualquier user logueado) pueden:
 *   - POST /tenant/deposits → solicitar depósito (status pending).
 *   - GET  /tenant/deposits/mine → listar SUS propios depósitos.
 *
 * Operadores con permisos (cajero, distribuidor, admin) pueden:
 *   - GET   /tenant/deposits → listar para review (con filtros).
 *   - GET   /tenant/deposits/:id → ver detalle.
 *   - POST  /tenant/deposits/:id/approve → aprueba + acredita wallet.
 *   - POST  /tenant/deposits/:id/reject → rechaza con motivo.
 *
 * Auditoría: cada acción (create/approve/reject) deja entry en audit_log.
 */

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { StorageService } from '../storage/storage.service';
import {
  buildCsv,
  buildCsvFilename,
  CSV_EXPORT_MAX_ROWS,
  type CsvColumn,
} from '../common/csv';
import type { DepositWithRelations } from './deposits.service';
import { AuditLogService } from '../audit/audit-log.service';
import { InsufficientFunderBalanceError } from '../commissions/commissions.errors';
import {
  DepositLimitExceededError,
  UserExcludedError,
} from '../responsible-gaming/responsible-gaming.errors';
import { BonusesAutoGrantService } from '../bonuses/bonuses-auto-grant.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EffectivePermissionsService } from '../permissions/effective-permissions.service';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import { extractRequestContext } from '../request-context/request-context';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import type {
  RequestWithTenantContext,
  TenantDb,
} from '../tenant-resolver/tenant-context';
import { OutOfScopeError } from '../user-hierarchy/user-hierarchy.errors';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import {
  DepositAlreadyResolvedError,
  DepositNotFoundError,
  DepositRequiresBankTxError,
  InvalidPaymentMethodError,
  TooManyPendingDepositsError,
} from './deposits.errors';
import { DepositsService } from './deposits.service';
import { CreateDepositDto } from './dto/create-deposit.dto';
import { RejectDepositDto } from './dto/reject-deposit.dto';

@Controller('tenant/deposits')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class DepositsController {
  private readonly logger = new Logger(DepositsController.name);

  constructor(
    private readonly depositsService: DepositsService,
    private readonly audit: AuditLogService,
    private readonly hierarchy: UserHierarchyService,
    private readonly bonusesAutoGrant: BonusesAutoGrantService,
    private readonly notifications: NotificationsService,
    private readonly effectivePermissions: EffectivePermissionsService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Resuelve el scope del actor para el listing:
   *   - Si tiene `deposits.view_all` → `undefined` (sin filter, ve todo).
   *   - Sino → `[actor.id, ...getActiveDescendants(actor.id)]`. Si vacío,
   *     devuelve `[]` (el service short-circuit a 0 rows).
   *
   * El `@RequirePermissions('deposits.view')` ya garantizó que el actor
   * tiene al menos `view` — sino el guard responde 403 antes de llegar acá.
   */
  private async resolveScope(
    db: TenantDb,
    actorId: string,
  ): Promise<string[] | undefined> {
    const hasViewAll = await this.effectivePermissions.hasAllPermissions(
      db,
      actorId,
      ['deposits.view_all'],
    );
    if (hasViewAll) return undefined;
    const downstream = await this.hierarchy.getActiveDescendants(db, actorId);
    return [actorId, ...downstream];
  }

  /**
   * POST /tenant/deposits/upload-proof — Sprint 51.6.
   *
   * Sube el comprobante de pago via multipart/form-data (campo 'file').
   * Devuelve `{ receiptUrl, receiptStorageKey }` que el cliente envía
   * después en `POST /tenant/deposits` (flujo two-step).
   *
   * Validaciones:
   *   - MIME: image/jpeg, image/png, image/webp, application/pdf.
   *   - Tamaño máx: 5 MB.
   *
   * Cualquier user logueado puede subir (es proof de su propio deposit).
   * Rate-limit: el cliente típico sube 1-2 archivos por deposit; sin
   * rate-limit dedicado por ahora (el create-deposit ya tiene su límite
   * por max-pending).
   */
  @Post('upload-proof')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    }),
  )
  @HttpCode(HttpStatus.CREATED)
  async uploadProof(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{ receiptUrl: string; receiptStorageKey: string; sizeBytes: number }> {
    if (!file) {
      throw new BadRequestException({
        message: 'No se recibió ningún archivo (campo "file").',
        error: 'FILE_MISSING',
      });
    }
    const allowedMimes = new Set([
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
    ]);
    if (!allowedMimes.has(file.mimetype)) {
      throw new BadRequestException({
        message: `Tipo de archivo no permitido (${file.mimetype}). Permitidos: jpg, png, webp, pdf.`,
        error: 'FILE_TYPE_NOT_ALLOWED',
      });
    }
    // Multer ya enforce el size limit con `limits.fileSize` — esto es
    // defensa en profundidad si el cliente burla el header.
    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException({
        message: 'El archivo excede el límite de 5 MB.',
        error: 'FILE_TOO_LARGE',
      });
    }

    const tenantSlug = req.tenantContext?.tenant.slug ?? 'unknown';
    const uploaded = await this.storage.upload({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      keyPrefix: 'deposits/proofs',
      tenantSlug,
    });

    this.logger.log(
      `Upload proof OK: tenant=${tenantSlug} user=${actor.id} size=${uploaded.sizeBytes}B key=${uploaded.storageKey}`,
    );

    return {
      receiptUrl: uploaded.url,
      receiptStorageKey: uploaded.storageKey,
      sizeBytes: uploaded.sizeBytes,
    };
  }

  /** POST /tenant/deposits — el actor (cualquier user logueado) solicita depósito. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateDepositDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{
    deposit: {
      id: string;
      status: string;
      amountChips: string;
      amountFiat: string;
      currencyFiat: string;
      createdAt: Date;
    };
  }> {
    const db = req.tenantContext!.db;
    let deposit;
    try {
      deposit = await this.depositsService.create(db, {
        actorUserId: actor.id,
        methodId: dto.methodId,
        amountFiat: dto.amountFiat,
        currencyFiat: dto.currencyFiat,
        amountChips: dto.amountChips,
        receiptUrl: dto.receiptUrl,
        receiptStorageKey: dto.receiptStorageKey,
        externalRef: dto.externalRef,
      });
    } catch (err) {
      throw this.mapError(err);
    }

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'deposits.create',
      targetType: 'deposit',
      targetId: deposit.id,
      after: {
        status: deposit.status,
        amountChips: deposit.amountChips,
        amountFiat: deposit.amountFiat,
        currencyFiat: deposit.currencyFiat,
      },
      metadata: { methodId: dto.methodId },
      ...extractRequestContext(req),
    });

    return {
      deposit: {
        id: deposit.id,
        status: deposit.status,
        amountChips: deposit.amountChips,
        amountFiat: deposit.amountFiat,
        currencyFiat: deposit.currencyFiat,
        createdAt: deposit.createdAt,
      },
    };
  }

  /** GET /tenant/deposits/mine — depósitos del actor. */
  @Get('mine')
  async listMine(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<{ data: unknown[] }> {
    const db = req.tenantContext!.db;
    const data = await this.depositsService.listForUser(
      db,
      actor.id,
      limit ? Number(limit) : undefined,
      offset ? Number(offset) : undefined,
    );
    return { data };
  }

  /**
   * GET /tenant/deposits — listado para review.
   *
   * Requiere `deposits.view` (mínimo). Scope:
   *   - Actor con `deposits.view_all` → ve TODO el tenant.
   *   - Actor solo con `deposits.view` → ve solo deposits de su downstream
   *     (yo + descendants directos/indirectos en `user_hierarchy`).
   *
   * El admin_tenant tiene ambos perms (asignados por el seed).
   */
  @Get()
  @RequirePermissions('deposits.view')
  async listForReview(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<{ data: unknown[]; total: number }> {
    const db = req.tenantContext!.db;
    const statuses = status?.split(',') as Array<
      'pending' | 'under_review' | 'approved' | 'rejected' | 'expired' | 'cancelled'
    >;
    const userIds = await this.resolveScope(db, actor.id);
    return this.depositsService.listForReview(db, {
      status: statuses,
      userId,
      userIds,
      assignedTo,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  /**
   * GET /tenant/deposits/export
   * Export CSV de depósitos con los mismos filtros que `listForReview`.
   * Requiere `deposits.export`. Cap en `CSV_EXPORT_MAX_ROWS`.
   */
  @Get('export')
  @RequirePermissions('deposits.export')
  async exportCsv(
    @Req() req: RequestWithTenantContext,
    @Res() res: Response,
    @CurrentTenantUser() actor: { id: string; username: string },
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('assignedTo') assignedTo?: string,
  ): Promise<void> {
    const db = req.tenantContext!.db;
    const statuses = status?.split(',') as Array<
      'pending' | 'under_review' | 'approved' | 'rejected' | 'expired' | 'cancelled'
    >;
    // Scope: el export NUNCA debe revelar más que el listing. Misma regla.
    const userIds = await this.resolveScope(db, actor.id);
    const { data, total } = await this.depositsService.listForExport(
      db,
      { status: statuses, userId, userIds, assignedTo },
      CSV_EXPORT_MAX_ROWS,
    );

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'deposits.export',
      targetType: 'deposit',
      targetId: null,
      metadata: {
        rowCount: data.length,
        totalMatched: total,
        truncated: total > data.length,
        scoped: userIds !== undefined,
        filters: {
          status: status ?? null,
          userId: userId ?? null,
          assignedTo: assignedTo ?? null,
        },
        severity: 'medium',
      },
      ...extractRequestContext(req),
    });

    const csv = buildCsv<DepositWithRelations>(DEPOSIT_CSV_COLUMNS, data);
    const filename = buildCsvFilename('deposits');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Total-Rows', String(data.length));
    if (total > data.length) res.setHeader('X-Truncated', 'true');
    res.send(csv);
  }

  /** GET /tenant/deposits/:id — detalle. Requiere `deposits.view`. */
  @Get(':id')
  @RequirePermissions('deposits.view')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
  ): Promise<{ deposit: unknown; walletTx: unknown | null }> {
    const db = req.tenantContext!.db;
    let deposit;
    try {
      deposit = await this.depositsService.findById(db, id);
    } catch (err) {
      throw this.mapError(err);
    }
    // Sprint 51.6: si tenemos storage key, regeneramos la URL — para
    // drivers con signed URLs (R2 bucket privado), la URL persistida en
    // DB puede haber expirado. Para LocalDiskDriver es no-op (URL estable).
    let depositOut: typeof deposit = deposit;
    if (deposit.receiptStorageKey) {
      try {
        const freshUrl = await this.storage.getUrl(deposit.receiptStorageKey);
        depositOut = { ...deposit, receiptUrl: freshUrl };
      } catch (err) {
        this.logger.warn(
          `No se pudo regenerar URL para storage key ${deposit.receiptStorageKey}: ${(err as Error).message}`,
        );
      }
    }
    const walletTx = deposit.walletTxId
      ? await this.depositsService.getLinkedWalletTx(db, deposit.walletTxId)
      : null;
    return { deposit: depositOut, walletTx };
  }

  /** POST /tenant/deposits/:id/approve — aprueba + acredita wallet. */
  @Post(':id/approve')
  @RequirePermissions('deposits.approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{ deposit: unknown; walletTxId: string | null }> {
    const db = req.tenantContext!.db;
    let before;
    try {
      before = await this.depositsService.findById(db, id);
    } catch (err) {
      throw this.mapError(err);
    }

    // Scope: el actor debe poder operar sobre el user dueño del depósito.
    // El @ScopeTarget declarativo no aplica acá porque el targetUserId
    // está en el entity, no en el body/param del request.
    try {
      await this.hierarchy.assertScope(db, actor.id, before.userId);
    } catch (err) {
      throw this.mapError(err);
    }

    let after;
    try {
      after = await this.depositsService.approve(db, id, actor.id);
    } catch (err) {
      throw this.mapError(err);
    }

    // Auditamos solo si el status realmente cambió (idempotencia silenciosa).
    if (before.status !== after.status) {
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'deposits.approve',
        targetType: 'deposit',
        targetId: id,
        before: { status: before.status },
        after: { status: after.status, walletTxId: after.walletTxId },
        metadata: { amountChips: after.amountChips, userId: after.userId },
        ...extractRequestContext(req),
      });

      // Notif al user: "tu depósito fue aprobado". Fail-soft: si la
      // notif falla, el deposit ya está aprobado y la wallet acreditada;
      // no rollback. in_app + email para que el user lo vea en panel
      // y en su mail.
      for (const channel of ['in_app', 'email'] as const) {
        try {
          await this.notifications.enqueue(db, {
            userId: after.userId,
            kind: 'deposit_approved',
            channel,
            payload: {
              depositId: id,
              amountChips: after.amountChips,
            },
          });
        } catch (err) {
          this.logger.error(
            `Notif deposit_approved (${channel}) falló para user=${after.userId} deposit=${id}: ${(err as Error).message}`,
          );
        }
      }

      // Auto-grant de bono (welcome / reload) tras el approve.
      // Fail-soft: si falla, log warning + audit "auto_grant_failed" pero
      // NO revertimos el depósito. El cajero puede otorgar el bono manual
      // después si fuera necesario (operación ya está aprobada).
      try {
        const result = await this.bonusesAutoGrant.autoGrantForApprovedDeposit(db, {
          depositId: id,
          userId: after.userId,
          depositAmount: after.amountChips,
          actorUserId: actor.id,
        });
        if (result.bonus) {
          await this.audit.record(db, {
            actorUserId: actor.id,
            actorUsername: actor.username,
            actionCode: 'bonus.auto_grant',
            targetType: 'user_bonus',
            targetId: result.bonus.id,
            after: {
              userId: result.bonus.userId,
              definitionId: result.bonus.definitionId,
              amount: result.bonus.grantedAmount,
              kind: result.kind,
            },
            metadata: {
              severity: 'medium',
              triggeredBy: 'deposits.approve',
              depositId: id,
            },
            ...extractRequestContext(req),
          });
        } else if (result.skipReason === 'fraud_blocked') {
          // Bloqueo por antifraude (cluster confirmed score >= 90).
          // Severity:high — el admin DEBE ver esto. Si el bloqueo fue
          // un false positive el user reporta y se revisa el link.
          await this.audit.record(db, {
            actorUserId: actor.id,
            actorUsername: actor.username,
            actionCode: 'bonus.auto_grant.fraud_blocked',
            targetType: 'deposit',
            targetId: id,
            metadata: {
              severity: 'high',
              userId: after.userId,
              depositAmount: after.amountChips,
              reason: 'cluster_confirmed_score_gte_90',
            },
            ...extractRequestContext(req),
          });
        } else if (result.skipReason) {
          // Skip "benigno" — sin definition configurada, deposit
          // bajo el mínimo, etc. Solo debug log.
          this.logger.debug(
            `Auto-grant skip on deposit ${id}: reason=${result.skipReason} kind=${result.kind ?? 'n/a'}`,
          );
        }
      } catch (err) {
        // Error real (funder sin saldo, definition rota, etc.). NO
        // revertir el deposit. Audit + log.
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Auto-grant FALLÓ sobre deposit ${id}: ${msg}. El depósito sigue aprobado.`,
        );
        await this.audit.record(db, {
          actorUserId: actor.id,
          actorUsername: actor.username,
          actionCode: 'bonus.auto_grant_failed',
          targetType: 'deposit',
          targetId: id,
          metadata: {
            severity: 'high',
            error: msg,
            userId: after.userId,
            depositAmount: after.amountChips,
          },
          ...extractRequestContext(req),
        });
      }
    }

    return { deposit: after, walletTxId: after.walletTxId };
  }

  /** POST /tenant/deposits/:id/reject — rechaza con motivo. */
  @Post(':id/reject')
  @RequirePermissions('deposits.reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDepositDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{ deposit: unknown }> {
    const db = req.tenantContext!.db;
    let before;
    try {
      before = await this.depositsService.findById(db, id);
    } catch (err) {
      throw this.mapError(err);
    }
    try {
      await this.hierarchy.assertScope(db, actor.id, before.userId);
    } catch (err) {
      throw this.mapError(err);
    }
    let after;
    try {
      after = await this.depositsService.reject(db, id, actor.id, dto.reason);
    } catch (err) {
      throw this.mapError(err);
    }

    if (before.status !== after.status) {
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'deposits.reject',
        targetType: 'deposit',
        targetId: id,
        before: { status: before.status },
        after: { status: after.status },
        reason: dto.reason,
        metadata: { userId: after.userId },
        ...extractRequestContext(req),
      });

      // Notif al user: "tu depósito fue rechazado". Fail-soft.
      for (const channel of ['in_app', 'email'] as const) {
        try {
          await this.notifications.enqueue(db, {
            userId: after.userId,
            kind: 'deposit_rejected',
            channel,
            payload: {
              depositId: id,
              amountChips: after.amountChips,
              reason: dto.reason,
            },
          });
        } catch (err) {
          this.logger.error(
            `Notif deposit_rejected (${channel}) falló user=${after.userId} deposit=${id}: ${(err as Error).message}`,
          );
        }
      }

      // Sprint 51.6.1: cleanup del comprobante del storage. Fail-soft —
      // si falla, el deposit ya está rechazado y la audit refleja eso;
      // el archivo huérfano lo limpia un cron futuro si emerge problema.
      // Solo borramos en reject (no en approve — ahí queremos conservar
      // el comprobante por compliance / referencia).
      if (before.receiptStorageKey) {
        try {
          await this.storage.delete(before.receiptStorageKey);
          this.logger.log(
            `Storage cleanup OK al rechazar deposit=${id} key=${before.receiptStorageKey}`,
          );
        } catch (err) {
          this.logger.error(
            `Storage cleanup falló al rechazar deposit=${id} key=${before.receiptStorageKey}: ${(err as Error).message}`,
          );
        }
      }
    }

    return { deposit: after };
  }

  private mapError(err: unknown): Error {
    if (err instanceof DepositNotFoundError) {
      return new NotFoundException({
        statusCode: 404,
        message: err.message,
        error: 'DEPOSIT_NOT_FOUND',
      });
    }
    if (err instanceof InvalidPaymentMethodError) {
      return new BadRequestException({
        statusCode: 400,
        message: err.message,
        error: 'INVALID_PAYMENT_METHOD',
      });
    }
    if (err instanceof TooManyPendingDepositsError) {
      return new ConflictException({
        statusCode: 409,
        message: err.message,
        error: 'TOO_MANY_PENDING_DEPOSITS',
        current: err.current,
      });
    }
    if (err instanceof DepositAlreadyResolvedError) {
      return new ConflictException({
        statusCode: 409,
        message: err.message,
        error: 'DEPOSIT_ALREADY_RESOLVED',
        status: err.status,
      });
    }
    if (err instanceof DepositRequiresBankTxError) {
      return new BadRequestException({
        statusCode: 400,
        message: err.message,
        error: 'DEPOSIT_REQUIRES_BANK_TX',
      });
    }
    if (err instanceof OutOfScopeError) {
      return new ForbiddenException({
        statusCode: 403,
        message: err.message,
        error: 'OUT_OF_SCOPE',
      });
    }
    if (err instanceof DepositLimitExceededError) {
      // Sprint 33: el player setteó un cap y este depósito lo excedería.
      // 409 con info estructurada para que el frontend pueda mostrar
      // "te quedan X chips de tu límite diario".
      return new ConflictException({
        statusCode: 409,
        message: err.message,
        error: 'DEPOSIT_LIMIT_EXCEEDED',
        window: err.window,
        cap: err.cap,
        used: err.used,
        attempted: err.attempted,
      });
    }
    if (err instanceof UserExcludedError) {
      // Sprint 33: user tiene exclusion activa. 403 + endsAt para que
      // el frontend muestre "tu cuenta está bloqueada hasta X".
      return new ForbiddenException({
        statusCode: 403,
        message: err.message,
        error: 'USER_EXCLUDED',
        exclusionType: err.type,
        endsAt: err.endsAt,
      });
    }
    if (err instanceof InsufficientFunderBalanceError) {
      // Sprint 25: el operador que aprobó no tiene saldo para pagar las
      // commissions de la jerarquía upstream. Bloquea el approve completo
      // (Opción 3a). Mensaje específico para que no confunda con un error
      // del propio deposit.
      return new ConflictException({
        statusCode: 409,
        message: err.message,
        error: 'INSUFFICIENT_FUNDER_BALANCE',
        available: err.available,
        required: err.required,
      });
    }
    if (err instanceof ForbiddenException || err instanceof BadRequestException) {
      return err;
    }
    return err as Error;
  }
}

// ──────────────────────────────────────────────────────────────────────
// CSV column definitions
// ──────────────────────────────────────────────────────────────────────

const DEPOSIT_CSV_COLUMNS: CsvColumn<DepositWithRelations>[] = [
  { header: 'created_at', value: (r) => r.createdAt },
  { header: 'id', value: (r) => r.id },
  { header: 'status', value: (r) => r.status },
  { header: 'user_id', value: (r) => r.userId },
  { header: 'username', value: (r) => r.userUsername },
  { header: 'display_name', value: (r) => r.userDisplayName },
  { header: 'method_id', value: (r) => r.methodId },
  { header: 'method_code', value: (r) => r.methodCode },
  { header: 'method_name', value: (r) => r.methodName },
  { header: 'amount_fiat', value: (r) => r.amountFiat },
  { header: 'currency_fiat', value: (r) => r.currencyFiat },
  { header: 'amount_chips', value: (r) => r.amountChips },
  { header: 'external_ref', value: (r) => r.externalRef },
  { header: 'receipt_url', value: (r) => r.receiptUrl },
  { header: 'assigned_to', value: (r) => r.assignedTo },
  { header: 'reviewed_by', value: (r) => r.reviewedBy },
  { header: 'reviewed_at', value: (r) => r.reviewedAt },
  { header: 'rejection_reason', value: (r) => r.rejectionReason },
  { header: 'wallet_tx_id', value: (r) => r.walletTxId },
  { header: 'updated_at', value: (r) => r.updatedAt },
];
