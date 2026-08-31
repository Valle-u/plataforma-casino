/**
 * BankAccountsController — CRUD de las cuentas bancarias PROPIAS del tenant.
 *
 *   GET    /tenant/bank-accounts              → lista (activas por default)
 *   POST   /tenant/bank-accounts              → alta
 *   PATCH  /tenant/bank-accounts/:id          → edición
 *   POST   /tenant/bank-accounts/:id/active   → baja / alta lógica
 *
 * PERMISOS — se reusan los de transferencias a propósito, en vez de crear unos
 * nuevos: agregar permisos toca el modelo de roles, que el CLAUDE.md marca como
 * área sensible (una escalada de privilegios ahí es seria). Quien puede editar
 * transferencias puede administrar con qué cuentas propias se operan.
 *
 *   leer     → `bank_tx.view`   (lo necesita el selector del formulario)
 *   escribir → `bank_tx.edit`
 *
 * Si más adelante conviene separarlo, es un permiso nuevo + su seed.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { PanelOnly } from '../tenant-auth/panel-only.decorator';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { BankAccountsService } from './bank-accounts.service';

export class CreateBankAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  accountHolder!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  bankName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  accountIdentifier?: string;
}

export class UpdateBankAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  accountHolder?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  accountIdentifier?: string;
}

export class SetActiveDto {
  @IsBoolean()
  isActive!: boolean;
}

@Controller('tenant/bank-accounts')
@UseGuards(TenantJwtGuard, PermissionsGuard)
@PanelOnly()
export class BankAccountsController {
  constructor(private readonly service: BankAccountsService) {}

  @Get()
  @RequirePermissions('bank_tx.view')
  async list(
    @Req() req: RequestWithTenantContext,
    @Query('includeInactive') includeInactive?: string,
  ) {
    const db = req.tenantContext!.db;
    const data = await this.service.list(db, {
      includeInactive: includeInactive === 'true',
    });
    return { data };
  }

  @Post()
  @RequirePermissions('bank_tx.edit')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateBankAccountDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ) {
    const db = req.tenantContext!.db;
    return this.service.create(db, actor.id, dto);
  }

  @Patch(':id')
  @RequirePermissions('bank_tx.edit')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBankAccountDto,
    @Req() req: RequestWithTenantContext,
  ) {
    const db = req.tenantContext!.db;
    return this.service.update(db, id, dto);
  }

  /**
   * Baja / alta lógica. No hay DELETE a propósito: las transferencias viejas se
   * cargaron con esta cuenta.
   */
  @Post(':id/active')
  @RequirePermissions('bank_tx.edit')
  @HttpCode(HttpStatus.OK)
  async setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetActiveDto,
    @Req() req: RequestWithTenantContext,
  ) {
    const db = req.tenantContext!.db;
    return this.service.setActive(db, id, dto.isActive);
  }
}
