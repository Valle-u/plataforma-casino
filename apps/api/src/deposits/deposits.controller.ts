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
import { eq } from 'drizzle-orm';
import { deposits, users } from '@casino/db';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { sha256Hex } from '../common/hash-file';
import { StorageService } from '../storage/storage.service';
import { FileValidationService } from '../storage/file-validation.service';
import {
  buildCsv,
  buildCsvFilename,
  CSV_EXPORT_MAX_ROWS,
  type CsvColumn,
} from '../common/csv';
import { matchedBankTxCsvColumns } from '../common/matched-bank-tx';
import {
  parseDateParam,
  parseMatchedParam,
} from '../common/list-filter-query';
import type { DepositWithRelations } from './deposits.service';
import { AuditLogService } from '../audit/audit-log.service';
import {
  DepositLimitExceededError,
  UserExcludedError,
} from '../responsible-gaming/responsible-gaming.errors';
import { NotificationsService } from '../notifications/notifications.service';
import { EffectivePermissionsService } from '../permissions/effective-permissions.service';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { extractRequestContext } from '../request-context/request-context';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import type {
  RequestWithTenantContext,
  TenantDb,
} from '../tenant-resolver/tenant-context';
import { OutOfScopeError } from '../user-hierarchy/user-hierarchy.errors';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import { IssuerInsufficientBalanceError } from '../wallet/wallet.errors';
import {
  DepositAlreadyResolvedError,
  DepositBelowMinimumError,
  DepositDuplicateReceiptError,
  DepositNotFoundError,
  DepositRequiresBankTxError,
  InvalidPaymentMethodError,
  TooManyPendingDepositsError,
} from './deposits.errors';
import { DepositsService } from './deposits.service';
import { ApproveDepositDto, CreateDepositDto } from './dto/create-deposit.dto';
import { RejectDepositDto } from './dto/reject-deposit.dto';

@Controller('tenant/deposits')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class DepositsController {
  private readonly logger = new Logger(DepositsController.name);

  constructor(
    private readonly depositsService: DepositsService,
    private readonly audit: AuditLogService,
    private readonly hierarchy: UserHierarchyService,
    private readonly notifications: NotificationsService,
    private readonly effectivePermissions: EffectivePermissionsService,
    private readonly storage: StorageService,
    private readonly fileValidation: FileValidationService,
  ) {}

  /**
   * Resuelve el scope del actor para el listing:
   *   - Si tiene `deposits.view_all` → ve TODO el tenant PERO se poda el
   *     subárbol de socios independientes (aislamiento del modelo económico:
   *     la sub-red del independiente es un "casino separado", no aparece en
   *     las colas de solicitudes del admin).
   *   - Sino → `[actor.id, ...getActiveDescendants(actor.id)]` filtrado por
   *     independientes también. Si vacío, devuelve `[]` (el service short-circuit
   *     a 0 rows).
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
    const excluded = await this.hierarchy.getIndependentSubtreeIds(db);

    if (hasViewAll) {
      if (excluded.size === 0) return undefined; // fast path: sin independientes
      const all = await db.select({ id: users.id }).from(users);
      const allowed = all.map((u) => u.id).filter((id) => !excluded.has(id));
      if (!allowed.includes(actorId)) allowed.push(actorId);
      return allowed;
    }
    const downstream = await this.hierarchy.getActiveDescendants(db, actorId);
    const base = [actorId, ...downstream].filter(
      (id) => id === actorId || !excluded.has(id),
    );
    // Ruteo descentralizado: el actor también ve las solicitudes de sus HIJOS
    // DIRECTOS que estén en una sub-red independiente (él es su padre directo).
    // No ve nietos independientes ni otras sub-redes — solo su nivel inmediato.
    const directChildren = await this.hierarchy.getDirectChildrenIds(db, actorId);
    const indepDirectChildren = directChildren.filter((id) => excluded.has(id));
    return Array.from(new Set([...base, ...indepDirectChildren]));
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
  @UseGuards(RateLimitGuard)
  @RateLimit({
    rule: 'deposits.upload',
    limit: 30,
    windowSec: 60,
    scope: 'user',
  })
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
  ): Promise<{
    receiptUrl: string;
    receiptStorageKey: string;
    /** Sprint 55: SHA-256 del contenido — token de dedupe real por archivo. */
    receiptHash: string;
    sizeBytes: number;
  }> {
    if (!file) {
      throw new BadRequestException({
        message: 'No se recibió ningún archivo (campo "file").',
        error: 'FILE_MISSING',
      });
    }
    // Super filtro (FileValidationService): valida el CONTENIDO real (no la
    // etiqueta `file.mimetype` que manda el cliente, que es falsificable),
    // REDIBUJA las imágenes desde los píxeles con sharp (descarta metadata y
    // cualquier payload embebido) y rechaza PDF con contenido activo. Devuelve
    // el buffer LIMPIO a guardar. Tira BadRequest con mensaje claro si algo no
    // pasa. El límite de 5 MB también lo enforce multer arriba.
    const clean = await this.fileValidation.validate(file.buffer, {
      allow: ['image', 'pdf'],
      maxBytes: 5 * 1024 * 1024,
    });

    // Sprint 55: dedupe por CONTENIDO del archivo (SHA-256 del original). El
    // storage key es un UUID random por upload, así que no sirve como token de
    // dedupe. Rechazamos ANTES de guardar (sin archivos huérfanos) y devolvemos
    // el hash para que el create lo persista (índice único como backstop).
    const receiptHash = sha256Hex(file.buffer);
    const db = req.tenantContext!.db;
    const existing = await db
      .select({ id: deposits.id })
      .from(deposits)
      .where(eq(deposits.receiptHash, receiptHash))
      .limit(1);
    if (existing.length > 0) {
      throw new ConflictException({
        statusCode: 409,
        message: 'Ese archivo ya se usó como comprobante de otro depósito. Subí un comprobante distinto.',
        error: 'RECEIPT_DUPLICATE',
      });
    }

    const tenantSlug = req.tenantContext?.tenant.slug ?? 'unknown';
    const uploaded = await this.storage.upload({
      buffer: clean.buffer,
      originalName: `comprobante${clean.extension}`,
      mimeType: clean.mimeType,
      keyPrefix: 'deposits/proofs',
      tenantSlug,
    });

    this.logger.log(
      `Upload proof OK: tenant=${tenantSlug} user=${actor.id} size=${uploaded.sizeBytes}B key=${uploaded.storageKey}`,
    );

    return {
      receiptUrl: uploaded.url,
      receiptStorageKey: uploaded.storageKey,
      receiptHash,
      sizeBytes: uploaded.sizeBytes,
    };
  }

  /** POST /tenant/deposits — el actor (cualquier user logueado) solicita depósito. */
  @Post()
  @UseGuards(RateLimitGuard)
  @RateLimit({
    rule: 'deposits.create',
    limit: 15,
    windowSec: 60,
    scope: 'user',
  })
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
        receiptUrl: dto.receiptUrl,
        receiptStorageKey: dto.receiptStorageKey,
        receiptHash: dto.receiptHash ?? null,
        externalRef: dto.externalRef,
        bonusDefinitionId: dto.bonusDefinitionId,
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

    // Fase 3 (push): avisar a los operadores (admin_tenant) que hay un
    // depósito nuevo para revisar. in_app para el panel + web_push para
    // el celular. Fail-soft: la notif no bloquea la creación.
    for (const channel of ['in_app', 'web_push'] as const) {
      try {
        await this.notifications.enqueueForRole(db, {
          roleCode: 'admin_tenant',
          kind: 'new_deposit_for_review',
          channel,
          payload: {
            depositId: deposit.id,
            amountChips: deposit.amountChips,
            userUsername: actor.username,
          },
          excludeUserId: actor.id,
        });
      } catch (err) {
        this.logger.error(
          `Notif new_deposit_for_review (${channel}) falló deposit=${deposit.id}: ${(err as Error).message}`,
        );
      }
    }

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
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('methodId') methodId?: string,
    @Query('matched') matched?: string,
    @Query('userSearch') userSearch?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<{ data: unknown[]; total: number }> {
    const db = req.tenantContext!.db;
    const statuses = status?.split(',') as Array<
      'pending' | 'under_review' | 'approved' | 'rejected' | 'expired' | 'cancelled'
    >;
    const userIds = await this.resolveScope(db, actor.id);
    const result = await this.depositsService.listForReview(db, {
      status: statuses,
      userId,
      userIds,
      assignedTo,
      fromDate: parseDateParam(fromDate),
      toDate: parseDateParam(toDate),
      methodId: methodId || undefined,
      matched: parseMatchedParam(matched),
      userSearch: userSearch || undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    // Sprint 51.7.1: regenerar receiptUrl para cada row con storage key.
    // Necesario para que el operador pueda abrir el comprobante directo
    // desde la tabla (signed URLs de R2 expiran con TTL — la URL en DB
    // puede estar vencida). Para LocalDiskDriver es no-op (URL estable).
    const refreshed = await Promise.all(
      result.data.map(async (d) => {
        if (!d.receiptStorageKey) return d;
        try {
          const freshUrl = await this.storage.getUrl(d.receiptStorageKey);
          return { ...d, receiptUrl: freshUrl };
        } catch (err) {
          this.logger.warn(
            `No se pudo regenerar URL para storage key ${d.receiptStorageKey}: ${(err as Error).message}`,
          );
          return d;
        }
      }),
    );
    return { data: refreshed, total: result.total };
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
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('methodId') methodId?: string,
    @Query('matched') matched?: string,
    @Query('userSearch') userSearch?: string,
  ): Promise<void> {
    const db = req.tenantContext!.db;
    const statuses = status?.split(',') as Array<
      'pending' | 'under_review' | 'approved' | 'rejected' | 'expired' | 'cancelled'
    >;
    // Scope: el export NUNCA debe revelar más que el listing. Misma regla.
    const userIds = await this.resolveScope(db, actor.id);
    const { data, total } = await this.depositsService.listForExport(
      db,
      {
        status: statuses,
        userId,
        userIds,
        assignedTo,
        fromDate: parseDateParam(fromDate),
        toDate: parseDateParam(toDate),
        methodId: methodId || undefined,
        matched: parseMatchedParam(matched),
        userSearch: userSearch || undefined,
      },
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
          fromDate: fromDate ?? null,
          toDate: toDate ?? null,
          methodId: methodId ?? null,
          matched: matched ?? null,
          userSearch: userSearch ?? null,
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
    @CurrentTenantUser() actor: { id: string },
  ): Promise<{ deposit: unknown; walletTx: unknown }> {
    const db = req.tenantContext!.db;
    let deposit;
    try {
      deposit = await this.depositsService.findById(db, id);
    } catch (err) {
      throw this.mapError(err);
    }

    // Scope: el actor solo ve el detalle si el dueño está en su alcance (mismo
    // criterio que el listado, incluido el ruteo al padre directo en la red
    // descentralizada). Tapa el hueco de leer PII/monto de una solicitud fuera
    // de scope conociendo el id. 404 no revela existencia.
    const scopeUserIds = await this.resolveScope(db, actor.id);
    if (
      scopeUserIds &&
      actor.id !== deposit.userId &&
      !scopeUserIds.includes(deposit.userId)
    ) {
      throw new NotFoundException({
        statusCode: 404,
        message: 'Depósito no encontrado.',
        error: 'DEPOSIT_NOT_FOUND',
      });
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
    @Body() body?: ApproveDepositDto,
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
    let scopeBypass;
    try {
      scopeBypass = await this.hierarchy.assertCanReviewRequest(
        db,
        actor.id,
        before.userId,
        'deposits.approve_admin_network',
      );
    } catch (err) {
      throw this.mapError(err);
    }

    let after;
    try {
      after = await this.depositsService.approve(
        db,
        id,
        actor.id,
        body?.bonusDefinitionId,
      );
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
        metadata: {
          amountChips: after.amountChips,
          userId: after.userId,
          ...(scopeBypass ? { scopeBypass } : {}),
        },
        ...extractRequestContext(req),
      });

      // Notif al user: "tu depósito fue aprobado". Fail-soft: si la
      // notif falla, el deposit ya está aprobado y la wallet acreditada;
      // no rollback. in_app + email + web_push (Fase 3).
      for (const channel of ['in_app', 'email', 'web_push'] as const) {
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
    let scopeBypass;
    try {
      scopeBypass = await this.hierarchy.assertCanReviewRequest(
        db,
        actor.id,
        before.userId,
        'deposits.reject_admin_network',
      );
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
        metadata: {
          userId: after.userId,
          ...(scopeBypass ? { scopeBypass } : {}),
        },
        ...extractRequestContext(req),
      });

      // Notif al user: "tu depósito fue rechazado". Fail-soft.
      for (const channel of ['in_app', 'email', 'web_push'] as const) {
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

  /** POST /tenant/deposits/:id/review — marca como under_review. */
  @Post(':id/review')
  @RequirePermissions('deposits.approve')
  @HttpCode(HttpStatus.OK)
  async review(
    @Param('id', ParseUUIDPipe) id: string,
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

    let scopeBypass;
    try {
      scopeBypass = await this.hierarchy.assertCanReviewRequest(
        db,
        actor.id,
        before.userId,
        'deposits.approve_admin_network',
      );
    } catch (err) {
      throw this.mapError(err);
    }

    let after;
    try {
      after = await this.depositsService.review(db, id, actor.id);
    } catch (err) {
      throw this.mapError(err);
    }

    if (before.status !== after.status) {
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'deposits.review',
        targetType: 'deposit',
        targetId: id,
        before: { status: before.status },
        after: { status: after.status },
        ...(scopeBypass ? { scopeBypass } : {}),
        ...extractRequestContext(req),
      });
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
    if (err instanceof DepositDuplicateReceiptError) {
      return new ConflictException({
        statusCode: 409,
        message: err.message,
        error: 'RECEIPT_DUPLICATE',
      });
    }
    if (err instanceof DepositBelowMinimumError) {
      return new BadRequestException({
        statusCode: 400,
        message: err.message,
        error: 'DEPOSIT_BELOW_MINIMUM',
        minimum: err.minFiat,
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
    if (err instanceof IssuerInsufficientBalanceError) {
      // F2: el issuer (Casa o socio indep) no tiene saldo para fondear el
      // credit del deposit. 409 con payload accionable — el frontend puede
      // mostrar "no hay fichas en la Casa, esperá al aporte" o "el socio
      // <X> se quedó sin fichas, cargale antes de aprobar".
      return new ConflictException({
        statusCode: 409,
        message: err.message,
        error: 'ISSUER_INSUFFICIENT_BALANCE',
        issuerUserId: err.issuerUserId,
        available: err.available,
        required: err.required,
        isCasa: err.isCasa,
        hint: err.isCasa
          ? 'La Casa no tiene fichas suficientes. Se necesita un aporte de capital antes de aprobar este depósito.'
          : 'El socio independiente dueño de la rama no tiene fichas suficientes. Debe comprar fichas a la Casa antes de aprobar este depósito.',
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
  { header: 'bank_transaction_id', value: (r) => r.bankTransactionId },
  { header: 'updated_at', value: (r) => r.updatedAt },
  // Datos de la transferencia bancaria matcheada (todo en la misma fila).
  ...matchedBankTxCsvColumns<DepositWithRelations>(),
];
