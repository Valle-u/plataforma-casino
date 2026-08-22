/**
 * ChatController — endpoints HTTP del CRM/livechat.
 *
 * Por ahora solo emite el TOKEN EFÍMERO para el handshake del WebSocket: el WS
 * es cross-origin (front en Vercel, WS en la API), así que la cookie de sesión
 * no viaja. El cliente pide este token corto por HTTP (con su cookie, protegido
 * por TenantJwtGuard) y lo pasa en el `connect` del socket; el gateway lo valida.
 *
 * Todo el módulo vive detrás del flag CRM_ENABLED (default OFF) → con el flag
 * apagado esta ruta ni existe (404). Ver docs/22-crm-livechat.md.
 */

import {
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import {
  TenantJwtGuard,
  type RequestWithTenantUser,
} from '../tenant-auth/guards/tenant-jwt.guard';

/** Segundos de validez del token de WS. Corto: solo se usa para el connect. */
const WS_TOKEN_TTL_SEC = 60;

@Controller('tenant/chat')
@UseGuards(TenantJwtGuard)
export class ChatController {
  constructor(private readonly jwt: JwtService) {}

  /**
   * POST /tenant/chat/ws-token → { token, expiresIn }.
   *
   * Firma un JWT corto con `purpose: 'chat-ws'` (NO lleva `type: 'tenant'`, así
   * que no sirve como token de sesión: el TenantJwtGuard lo rechazaría). El
   * gateway del WS lo verifica y usa `tenantId` + `sub` para armar las rooms.
   */
  @Post('ws-token')
  @HttpCode(HttpStatus.OK)
  async wsToken(
    @Req() req: RequestWithTenantUser,
    @CurrentTenantUser() user: { id: string; username: string },
  ): Promise<{ token: string; expiresIn: number }> {
    const tenantId = req.tenantContext?.tenant.id;
    if (!tenantId) {
      throw new NotFoundException('Tenant no resuelto.');
    }
    const token = await this.jwt.signAsync(
      {
        sub: user.id,
        tenantId,
        username: user.username,
        purpose: 'chat-ws',
      },
      { expiresIn: WS_TOKEN_TTL_SEC },
    );
    return { token, expiresIn: WS_TOKEN_TTL_SEC };
  }
}
