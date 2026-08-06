/**
 * PushSubscriptionsController — endpoints de suscripción web-push.
 *
 * Endpoints:
 *   POST   /tenant/push-subscriptions          → registrar/actualizar mi dispositivo
 *   GET    /tenant/push-subscriptions/vapid-public-key → clave pública VAPID
 *   DELETE /tenant/push-subscriptions          → dar de baja mi dispositivo (por endpoint)
 *
 * Todos requieren TenantJwtGuard (user logueado). NO requieren permiso
 * adicional — un user gestiona SUS dispositivos, sin role especial.
 * La clave VAPID pública es por diseño pública (el browser la necesita
 * para suscribirse); se expone autenticada para no abrir más superficie
 * de la necesaria.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { CreatePushSubscriptionDto } from './dto/create-push-subscription.dto';
import { DeletePushSubscriptionDto } from './dto/delete-push-subscription.dto';
import { PushSubscriptionsService } from './push-subscriptions.service';

@Controller('tenant/push-subscriptions')
@UseGuards(TenantJwtGuard)
export class PushSubscriptionsController {
  constructor(
    private readonly service: PushSubscriptionsService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreatePushSubscriptionDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ): Promise<{ id: string; endpoint: string }> {
    const db = req.tenantContext!.db;
    const sub = await this.service.upsert(db, actor.id, dto);
    return { id: sub.id, endpoint: sub.endpoint };
  }

  @Get('vapid-public-key')
  vapidPublicKey(): { publicKey: string | null } {
    const key = this.config.get<string>('VAPID_PUBLIC_KEY');
    return { publicKey: key ?? null };
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  async remove(
    @Body() dto: DeletePushSubscriptionDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ): Promise<{ ok: true }> {
    const db = req.tenantContext!.db;
    // Idempotente: si no existe (o el endpoint fue regenerado), igual es
    // éxito — el objetivo "dar de baja este dispositivo" ya está cumplido.
    // Antes tiraba 404 y el toggle OFF lo mostraba en consola como error.
    await this.service.deleteForUserByEndpoint(db, actor.id, dto.endpoint);
    return { ok: true };
  }
}
