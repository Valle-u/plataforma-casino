/**
 * BankTransactionsController — Sprint 50.
 *
 * Endpoints:
 *   - POST   /tenant/bank-transactions                          (bank_tx.upload)
 *   - POST   /tenant/bank-transactions/upload-proof             (bank_tx.upload)
 *   - GET    /tenant/bank-transactions                          (bank_tx.view)
 *   - GET    /tenant/bank-transactions/:id                      (bank_tx.view)
 *   - GET    /tenant/bank-transactions/unmatched-for-amount/:amount   (bank_tx.match)
 *   - POST   /tenant/bank-transactions/:id/match/:depositId     (bank_tx.match)
 *   - POST   /tenant/bank-transactions/:id/unmatch              (bank_tx.match)
 *   - DELETE /tenant/bank-transactions/:id                      (bank_tx.delete)
 */

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import { bankTransactions } from '@casino/db';
import { memoryStorage } from 'multer';
import { AuditLogService } from '../audit/audit-log.service';
import { sha256Hex } from '../common/hash-file';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import { extractRequestContext } from '../request-context/request-context';
import { StorageService } from '../storage/storage.service';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { PanelOnly } from '../tenant-auth/panel-only.decorator';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import type {
  RequestWithTenantContext,
  TenantDb,
} from '../tenant-resolver/tenant-context';
import { BankTransactionsService } from './bank-transactions.service';
import { BANK_TX_INDEP_HIGH_SEVERITY_AMOUNT } from './bank-transactions.constants';
import {
  BankTransactionAlreadyMatchedError,
  BankTransactionAmountMismatchError,
  BankTransactionDuplicateReceiptError,
  BankTransactionDuplicateRefError,
  BankTransactionIncomingBankDataRequiredError,
  BankTransactionMatchedImmutableError,
  BankTransactionNotFoundError,
  BankTransactionOutgoingReceiptRequiredError,
  BankTransactionUploadRateLimitedError,
  DepositAlreadyHasBankTxError,
} from './bank-transactions.errors';
import {
  MatchBankTransactionDto,
  UpdateBankTransactionDto,
  UploadBankTransactionDto,
} from './dto/upload-bank-tx.dto';

@Controller('tenant/bank-transactions')
@UseGuards(TenantJwtGuard, PermissionsGuard)
@PanelOnly()
export class BankTransactionsController {
  private readonly logger = new Logger(BankTransactionsController.name);

  constructor(
    private readonly service: BankTransactionsService,
    private readonly audit: AuditLogService,
    private readonly hierarchy: UserHierarchyService,
    private readonly storage: StorageService,
  ) {}

  private requireDb(req: RequestWithTenantContext): TenantDb {
    if (!req.tenantContext) throw new Error('TenantContext no resuelto.');
    return req.tenantContext.db;
  }

  /**
   * Capa 3 · Fase 2: si el actor es socio independiente, devuelve su
   * `branchBankAccount` — ese es el único bankAccount que puede ver/tocar.
   * Sino devuelve null (admin/otros roles ven todo el extracto del tenant).
   */
  private async resolveIndepBankAccount(
    db: TenantDb,
    actorId: string,
  ): Promise<string | null> {
    return this.hierarchy.getBankAccountOfIndependent(db, actorId);
  }

  /**
   * Capa 3 · Fase 2: para endpoints por ID (findOne, match, unmatch,
   * update, delete). Si el actor es indep, valida que la bank_tx caiga
   * en su cuenta; sino tira NOT_FOUND (mismo trato que Fase 1).
   */
  private async assertActorCanTouch(
    db: TenantDb,
    actorId: string,
    bankTxId: string,
  ): Promise<void> {
    const indepAcct = await this.resolveIndepBankAccount(db, actorId);
    if (indepAcct === null) return; // admin / no-indep: sin restricción de cuenta.
    await this.service.assertBankTxOwnedByAccount(db, bankTxId, [indepAcct]);
  }

  /** POST /tenant/bank-transactions — empleado sube transferencia. */
  @Post()
  @RequirePermissions('bank_tx.upload')
  @HttpCode(HttpStatus.CREATED)
  async upload(
    @Body() dto: UploadBankTransactionDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = this.requireDb(req);
    // Capa 3 · Fase 2: un socio indep solo puede subir a SU propia cuenta.
    // Sin este check, con bank_tx.upload otorgado, podría contaminar la
    // cola del banco del admin. Sprint 53: bankAccount es opcional — el
    // check solo aplica si el socio lo declara.
    const indepAcct = await this.resolveIndepBankAccount(db, actor.id);
    if (indepAcct !== null && dto.bankAccount !== undefined && dto.bankAccount !== indepAcct) {
      throw new BadRequestException({
        message: `Los socios independientes solo pueden subir transferencias a su propia cuenta (${indepAcct}).`,
        error: 'BANK_TX_WRONG_ACCOUNT',
      });
    }
    try {
      const row = await this.service.upload(db, actor.id, dto);
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'bank_tx.upload',
        targetType: 'bank_transaction',
        targetId: row.id,
        metadata: {
          amount: row.amount,
          bankAccount: row.bankAccount,
          senderName: row.senderName,
        },
        ...extractRequestContext(req),
      });

      // D2-light: si el actor cuelga de una sub-red independiente (self o
      // ancestor con is_independent_branch=true), el upload equivale a una
      // auto-declaración de plata a su propio banco. No lo bloqueamos —
      // el modelo lo permite — pero dejamos un audit específico para que
      // el owner pueda vigilar. Best-effort: nunca tira, y no impacta el
      // response del upload.
      try {
        const indepAncestor = await this.hierarchy.getIndependentBranchAncestor(
          db,
          actor.id,
        );
        if (indepAncestor !== null) {
          const amountNum = Number(row.amount);
          const severity =
            amountNum >= BANK_TX_INDEP_HIGH_SEVERITY_AMOUNT ? 'high' : 'medium';
          await this.audit.record(db, {
            actorUserId: actor.id,
            actorUsername: actor.username,
            actionCode: 'bank_tx.upload_indep_self_declared',
            targetType: 'bank_transaction',
            targetId: row.id,
            metadata: {
              actorInIndepBranch: true,
              indepBranchAncestorId: indepAncestor,
              amount: row.amount,
              bankAccount: row.bankAccount,
              direction: row.direction,
              senderName: row.senderName,
              severity,
            },
            ...extractRequestContext(req),
          });
        }
      } catch {
        /* audit best-effort — nunca romper el flow del upload */
      }

      return row;
    } catch (err) {
      if (err instanceof BankTransactionDuplicateRefError) {
        throw new ConflictException({
          message: err.message,
          error: 'BANK_TX_DUPLICATE_REF',
        });
      }
      if (err instanceof BankTransactionDuplicateReceiptError) {
        throw new ConflictException({
          message: err.message,
          error: 'RECEIPT_DUPLICATE',
        });
      }
      if (err instanceof BankTransactionOutgoingReceiptRequiredError) {
        throw new BadRequestException({
          message: err.message,
          error: 'BANK_TX_OUTGOING_RECEIPT_REQUIRED',
        });
      }
      if (err instanceof BankTransactionIncomingBankDataRequiredError) {
        throw new BadRequestException({
          message: err.message,
          error: 'BANK_TX_INCOMING_BANK_DATA_REQUIRED',
        });
      }
      if (err instanceof BankTransactionUploadRateLimitedError) {
        // 429 con Retry-After — el throttle se libera cuando expira la
        // ventana (1h desde la primera upload en el hit vigente). No
        // sabemos el reset exacto acá; el header es informativo.
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: err.message,
            error: 'BANK_TX_UPLOAD_RATE_LIMITED',
            reason: err.reason,
            current: err.current,
            limit: err.limit,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw err;
    }
  }

  /**
   * POST /tenant/bank-transactions/upload-proof — Sprint 52.
   *
   * Sube el comprobante de pago de una transferencia bancaria via
   * multipart/form-data (campo 'file'). Devuelve `{ receiptUrl,
   * receiptStorageKey }` que el cliente envía después en el create (o en
   * el mark-paid / pay-in-full del withdrawal). Flujo two-step, igual que
   * deposits.
   *
   * Para `direction='outgoing'` el comprobante es OBLIGATORIO a nivel app
   * (el create lo valida): es la prueba de que la transferencia saliente
   * se ejecutó. El mismo `receiptStorageKey` no puede subirse dos veces
   * (dedupe por comprobante, ver service.upload).
   *
   * Validaciones:
   *   - MIME: image/jpeg, image/png, image/webp, application/pdf.
   *   - Tamaño máx: 5 MB.
   */
  @Post('upload-proof')
  @RequirePermissions('bank_tx.upload')
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
    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException({
        message: 'El archivo excede el límite de 5 MB.',
        error: 'FILE_TOO_LARGE',
      });
    }

    // Sprint 55: dedupe por CONTENIDO del archivo (SHA-256). El storage key
    // es un UUID random por upload — el mismo archivo subido dos veces tenía
    // dos keys distintos y pasaba el dedupe viejo. Rechazamos ANTES de
    // guardar (sin archivos huérfanos) y devolvemos el hash para que el
    // create/pay-in-full lo persista (índice único como backstop).
    const receiptHash = sha256Hex(file.buffer);
    const db = this.requireDb(req);
    const existing = await db
      .select({ id: bankTransactions.id })
      .from(bankTransactions)
      .where(eq(bankTransactions.receiptHash, receiptHash))
      .limit(1);
    if (existing.length > 0) {
      throw new ConflictException({
        statusCode: 409,
        message: 'Ese archivo ya se usó como comprobante de otra transferencia. Subí un comprobante distinto.',
        error: 'RECEIPT_DUPLICATE',
      });
    }

    const tenantSlug = req.tenantContext?.tenant.slug ?? 'unknown';
    const uploaded = await this.storage.upload({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      keyPrefix: 'bank-transactions/proofs',
      tenantSlug,
    });

    this.logger.log(
      `Upload bank-tx proof OK: tenant=${tenantSlug} user=${actor.id} size=${uploaded.sizeBytes}B key=${uploaded.storageKey}`,
    );

    return {
      receiptUrl: uploaded.url,
      receiptStorageKey: uploaded.storageKey,
      receiptHash,
      sizeBytes: uploaded.sizeBytes,
    };
  }

  /** GET /tenant/bank-transactions?status=&direction=&amount=&... */
  @Get()
  @RequirePermissions('bank_tx.view')
  async list(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
    @Query('status') status?: string,
    @Query('direction') direction?: string,
    @Query('bankAccount') bankAccount?: string,
    @Query('amount') amount?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('uploadedBy') uploadedBy?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const db = this.requireDb(req);
    // Aislamiento: excluir del listado las transferencias que caen en los
    // bancos propios de socios independientes (users.branchBankAccount).
    // Modelo económico: el independiente tiene su propio banco, ese extracto
    // no le corresponde al admin del tenant.
    const excludeBankAccounts = await this.hierarchy.getIndependentBankAccounts(db);
    // Capa 3 · Fase 2: si el actor es indep, restringimos su cola a su
    // propia cuenta (el excludeBankAccounts es para el admin — al indep
    // no le aplica porque solo ve la suya).
    const indepAcct = await this.resolveIndepBankAccount(db, actor.id);
    const onlyBankAccounts = indepAcct ? [indepAcct] : undefined;
    return this.service.list(db, {
      status: status as 'unmatched' | 'matched' | 'disputed' | undefined,
      direction: direction as 'incoming' | 'outgoing' | undefined,
      bankAccount,
      amount,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      uploadedBy,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      excludeBankAccounts: indepAcct ? undefined : excludeBankAccounts,
      onlyBankAccounts,
    });
  }

  /**
   * GET /tenant/bank-transactions/unmatched-for-amount/:amount
   * Lista bank_txs sin matchear con monto exacto. Default: solo las del
   * monto pedido. Si pasa `?includeAll=true`, devuelve TODAS las
   * unmatched (para override).
   */
  @Get('unmatched-for-amount/:amount')
  @RequirePermissions('bank_tx.match')
  async unmatchedForAmount(
    @Param('amount') amount: string,
    @Query('includeAll') includeAll: string | undefined,
    @Query('direction') direction: string | undefined,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ) {
    const db = this.requireDb(req);
    const dir = (direction === 'outgoing' ? 'outgoing' : 'incoming');
    // Capa 3 · Fase 2: si el actor es indep, el selector de matching solo
    // muestra bank_txs de su propia cuenta.
    const indepAcct = await this.resolveIndepBankAccount(db, actor.id);
    const onlyBankAccounts = indepAcct ? [indepAcct] : undefined;
    if (includeAll === 'true') {
      return { data: await this.service.findAllUnmatched(db, dir, onlyBankAccounts) };
    }
    return {
      data: await this.service.findUnmatchedByAmountAndDirection(
        db,
        amount,
        dir,
        onlyBankAccounts,
      ),
    };
  }

  /**
   * Lista cargas ('incoming'→load) o retiros ('outgoing'→unload) MANUALES sin
   * conciliar — candidatos para `match-manual`.
   * GET /tenant/bank-transactions/unmatched-manual?direction=&amount=&search=
   */
  @Get('unmatched-manual')
  @RequirePermissions('bank_tx.match')
  async listUnmatchedManual(
    @Req() req: RequestWithTenantContext,
    @Query('direction') direction?: string,
    @Query('amount') amount?: string,
    @Query('search') search?: string,
  ) {
    const db = this.requireDb(req);
    const dir = direction === 'outgoing' ? 'outgoing' : 'incoming';
    return {
      data: await this.service.listUnmatchedManual(db, dir, { amount, search }),
    };
  }

  @Get(':id')
  @RequirePermissions('bank_tx.view')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ) {
    const db = this.requireDb(req);
    try {
      // Capa 3 · Fase 2: indep solo ve las bank_tx de su cuenta.
      await this.assertActorCanTouch(db, actor.id, id);
    } catch (err) {
      if (err instanceof BankTransactionNotFoundError) {
        throw new NotFoundException(`Bank tx ${id} no existe.`);
      }
      throw err;
    }
    const row = await this.service.findById(db, id);
    if (!row) throw new NotFoundException(`Bank tx ${id} no existe.`);
    return row;
  }

  /**
   * GET /tenant/bank-transactions/:id/detail
   * Detalle enriquecido: la transferencia + con QUÉ está conciliada
   * (carga/retiro manual, depósito o retiro) resuelto a datos legibles.
   */
  @Get(':id/detail')
  @RequirePermissions('bank_tx.view')
  async detail(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ) {
    const db = this.requireDb(req);
    try {
      // Capa 3 · Fase 2: indep solo ve las bank_tx de su cuenta.
      await this.assertActorCanTouch(db, actor.id, id);
    } catch (err) {
      if (err instanceof BankTransactionNotFoundError) {
        throw new NotFoundException(`Bank tx ${id} no existe.`);
      }
      throw err;
    }
    const row = await this.service.getDetail(db, id);
    if (!row) throw new NotFoundException(`Bank tx ${id} no existe.`);
    return row;
  }

  /** POST /tenant/bank-transactions/:id/match/:depositId */
  @Post(':id/match/:depositId')
  @RequirePermissions('bank_tx.match')
  @HttpCode(HttpStatus.OK)
  async match(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('depositId', ParseUUIDPipe) depositId: string,
    @Body() dto: MatchBankTransactionDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = this.requireDb(req);
    try {
      // Capa 3 · Fase 2: indep solo puede matchear bank_tx de su cuenta.
      await this.assertActorCanTouch(db, actor.id, id);
      const row = await this.service.match(db, id, depositId, actor.id, dto);
      const isOverride = dto.override === true;
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'bank_tx.match',
        targetType: 'bank_transaction',
        targetId: id,
        metadata: {
          depositId,
          override: isOverride,
          overrideReason: dto.overrideReason ?? null,
          severity: isOverride ? 'high' : 'normal',
        },
        ...extractRequestContext(req),
      });
      return row;
    } catch (err) {
      if (err instanceof BankTransactionNotFoundError) {
        throw new NotFoundException({ message: err.message });
      }
      if (err instanceof BankTransactionAlreadyMatchedError) {
        throw new ConflictException({
          message: err.message,
          error: 'BANK_TX_ALREADY_MATCHED',
        });
      }
      if (err instanceof DepositAlreadyHasBankTxError) {
        throw new ConflictException({
          message: err.message,
          error: 'DEPOSIT_ALREADY_HAS_BANK_TX',
        });
      }
      if (err instanceof BankTransactionAmountMismatchError) {
        throw new BadRequestException({
          message: err.message,
          error: 'BANK_TX_AMOUNT_MISMATCH',
        });
      }
      throw err;
    }
  }

  /**
   * Sprint 51: matchea bank_tx OUTGOING con withdrawal.
   * POST /tenant/bank-transactions/:id/match-withdrawal/:withdrawalId
   */
  @Post(':id/match-withdrawal/:withdrawalId')
  @RequirePermissions('bank_tx.match')
  @HttpCode(HttpStatus.OK)
  async matchWithdrawalEndpoint(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('withdrawalId', ParseUUIDPipe) withdrawalId: string,
    @Body() dto: MatchBankTransactionDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = this.requireDb(req);
    try {
      // Capa 3 · Fase 2: indep solo puede matchear bank_tx de su cuenta.
      await this.assertActorCanTouch(db, actor.id, id);
      const row = await this.service.matchWithdrawal(
        db,
        id,
        withdrawalId,
        actor.id,
        dto,
      );
      const isOverride = dto.override === true;
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'bank_tx.match_withdrawal',
        targetType: 'bank_transaction',
        targetId: id,
        metadata: {
          withdrawalId,
          override: isOverride,
          overrideReason: dto.overrideReason ?? null,
          severity: isOverride ? 'high' : 'normal',
        },
        ...extractRequestContext(req),
      });
      return row;
    } catch (err) {
      if (err instanceof BankTransactionNotFoundError) {
        throw new NotFoundException({ message: err.message });
      }
      if (err instanceof BankTransactionAlreadyMatchedError) {
        throw new ConflictException({
          message: err.message,
          error: 'BANK_TX_ALREADY_MATCHED',
        });
      }
      if (err instanceof BankTransactionAmountMismatchError) {
        throw new BadRequestException({
          message: err.message,
          error: 'BANK_TX_AMOUNT_MISMATCH',
        });
      }
      throw err;
    }
  }

  /**
   * Concilia bank_tx con una carga (incoming) o retiro (outgoing) MANUAL.
   * POST /tenant/bank-transactions/:id/match-manual/:walletTxId
   */
  @Post(':id/match-manual/:walletTxId')
  @RequirePermissions('bank_tx.match')
  @HttpCode(HttpStatus.OK)
  async matchManualEndpoint(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('walletTxId', ParseUUIDPipe) walletTxId: string,
    @Body() dto: MatchBankTransactionDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = this.requireDb(req);
    try {
      await this.assertActorCanTouch(db, actor.id, id);
      const row = await this.service.matchManual(db, id, walletTxId, actor.id, dto);
      const isOverride = dto.override === true;
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'bank_tx.match_manual',
        targetType: 'bank_transaction',
        targetId: id,
        metadata: {
          walletTxId,
          override: isOverride,
          overrideReason: dto.overrideReason ?? null,
          severity: isOverride ? 'high' : 'normal',
        },
        ...extractRequestContext(req),
      });
      return row;
    } catch (err) {
      if (err instanceof BankTransactionNotFoundError) {
        throw new NotFoundException({ message: err.message });
      }
      if (err instanceof BankTransactionAlreadyMatchedError) {
        throw new ConflictException({
          message: err.message,
          error: 'BANK_TX_ALREADY_MATCHED',
        });
      }
      if (err instanceof BankTransactionAmountMismatchError) {
        throw new BadRequestException({
          message: err.message,
          error: 'BANK_TX_AMOUNT_MISMATCH',
        });
      }
      throw err;
    }
  }

  /** POST /tenant/bank-transactions/:id/unmatch */
  @Post(':id/unmatch')
  @RequirePermissions('bank_tx.match')
  @HttpCode(HttpStatus.OK)
  async unmatch(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = this.requireDb(req);
    try {
      // Capa 3 · Fase 2: indep solo puede unmatch bank_tx de su cuenta.
      await this.assertActorCanTouch(db, actor.id, id);
      const row = await this.service.unmatch(db, id, actor.id);
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'bank_tx.unmatch',
        targetType: 'bank_transaction',
        targetId: id,
        metadata: { severity: 'high' },
        ...extractRequestContext(req),
      });
      return row;
    } catch (err) {
      if (err instanceof BankTransactionNotFoundError) {
        throw new NotFoundException({ message: err.message });
      }
      throw err;
    }
  }

  /**
   * PATCH /tenant/bank-transactions/:id — editar una transferencia aún sin
   * matchear. Solo campos del DTO (patch parcial). 409 si ya está matcheada.
   */
  @Patch(':id')
  @RequirePermissions('bank_tx.edit')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBankTransactionDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = this.requireDb(req);
    try {
      // Capa 3 · Fase 2: indep solo puede editar bank_tx de su cuenta.
      await this.assertActorCanTouch(db, actor.id, id);
      const before = await this.service.findById(db, id);
      const row = await this.service.update(db, id, actor.id, dto);
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'bank_tx.edit',
        targetType: 'bank_transaction',
        targetId: id,
        before: before ?? undefined,
        after: row,
        metadata: { changedFields: Object.keys(dto), severity: 'medium' },
        ...extractRequestContext(req),
      });
      return row;
    } catch (err) {
      if (err instanceof BankTransactionNotFoundError) {
        throw new NotFoundException({ message: err.message });
      }
      if (err instanceof BankTransactionMatchedImmutableError) {
        throw new ConflictException({
          message: err.message,
          error: 'BANK_TX_ALREADY_MATCHED',
        });
      }
      if (err instanceof BankTransactionDuplicateRefError) {
        throw new ConflictException({
          message: err.message,
          error: 'BANK_TX_DUPLICATE_REF',
        });
      }
      if (err instanceof BankTransactionDuplicateReceiptError) {
        throw new ConflictException({
          message: err.message,
          error: 'RECEIPT_DUPLICATE',
        });
      }
      throw err;
    }
  }

  /** DELETE /tenant/bank-transactions/:id — admin only. Solo sin matchear. */
  @Delete(':id')
  @RequirePermissions('bank_tx.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = this.requireDb(req);
    try {
      // Capa 3 · Fase 2: indep solo puede borrar bank_tx de su cuenta.
      await this.assertActorCanTouch(db, actor.id, id);
      await this.service.deleteBankTx(db, id, actor.id);
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'bank_tx.delete',
        targetType: 'bank_transaction',
        targetId: id,
        metadata: { severity: 'high' },
        ...extractRequestContext(req),
      });
    } catch (err) {
      if (err instanceof BankTransactionNotFoundError) {
        throw new NotFoundException({ message: err.message });
      }
      if (err instanceof BankTransactionMatchedImmutableError) {
        throw new ConflictException({
          message: err.message,
          error: 'BANK_TX_ALREADY_MATCHED',
        });
      }
      throw err;
    }
  }
}
