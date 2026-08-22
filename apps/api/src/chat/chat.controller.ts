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
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { memoryStorage } from 'multer';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import {
  TenantJwtGuard,
  type RequestWithTenantUser,
} from '../tenant-auth/guards/tenant-jwt.guard';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { StorageService } from '../storage/storage.service';
import { FileValidationService } from '../storage/file-validation.service';
import {
  CHAT_ATTACHMENT_MAX_BYTES,
  type ChatAttachment,
} from './chat.types';

/** Segundos de validez del token de WS. Corto: solo se usa para el connect. */
const WS_TOKEN_TTL_SEC = 60;

/** Nombre visible del adjunto: basename saneado, acotado. */
function safeName(original: string | undefined, fallback: string): string {
  if (!original) return fallback;
  const base = original.split(/[\\/]/).pop() ?? original;
  const trimmed = base.trim().slice(0, 120);
  return trimmed.length > 0 ? trimmed : fallback;
}

@Controller('tenant/chat')
@UseGuards(TenantJwtGuard)
export class ChatController {
  constructor(
    private readonly jwt: JwtService,
    private readonly storage: StorageService,
    private readonly fileValidation: FileValidationService,
  ) {}

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

  /**
   * POST /tenant/chat/upload — sube un adjunto (imagen o PDF) del chat via
   * multipart (campo 'file'). Valida el CONTENIDO real con FileValidationService
   * (redibuja imágenes, rechaza PDF con contenido activo) y lo guarda bajo el
   * namespace del tenant. Devuelve el descriptor que el cliente manda después en
   * el mensaje por WS (`attachments: [descriptor]`). Reusa el patrón del
   * comprobante de depósito. Rate-limit por usuario.
   */
  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RateLimitGuard)
  @RateLimit({ rule: 'chat.upload', limit: 30, windowSec: 60, scope: 'user' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: CHAT_ATTACHMENT_MAX_BYTES },
    }),
  )
  async upload(
    @Req() req: RequestWithTenantUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ChatAttachment> {
    const tenantSlug = req.tenantContext?.tenant.slug;
    if (!tenantSlug) throw new NotFoundException('Tenant no resuelto.');
    if (!file) {
      throw new BadRequestException({
        message: 'No se recibió ningún archivo (campo "file").',
        error: 'FILE_MISSING',
      });
    }
    const clean = await this.fileValidation.validate(file.buffer, {
      allow: ['image', 'pdf'],
      maxBytes: CHAT_ATTACHMENT_MAX_BYTES,
    });
    const uploaded = await this.storage.upload({
      buffer: clean.buffer,
      originalName: `adjunto${clean.extension}`,
      mimeType: clean.mimeType,
      keyPrefix: 'chat/attachments',
      tenantSlug,
    });
    return {
      storageKey: uploaded.storageKey,
      url: uploaded.url,
      mime: clean.mimeType,
      sizeBytes: uploaded.sizeBytes,
      name: safeName(file.originalname, `adjunto${clean.extension}`),
      kind: clean.mimeType === 'application/pdf' ? 'pdf' : 'image',
    };
  }
}
