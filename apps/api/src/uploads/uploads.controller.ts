/**
 * UploadsController — Sprint 55.X.
 *
 * Endpoints genéricos de upload para assets del diseño (hero banners, logos, etc).
 * Usa el mismo StorageService que deposit-proofs.
 *
 * POST /tenant/uploads/hero
 *   - Multipart form-data, campo 'file'
 *   - Guarda en /hero/ del storage (R2 en prod, local disk en dev)
 *   - Devuelve { url, storageKey, sizeBytes }
 */

import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { PermissionsGuard } from '../permissions/permissions.guard';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { PanelOnly } from '../tenant-auth/panel-only.decorator';
import { StorageService } from '../storage/storage.service';

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

@Controller('tenant/uploads')
@UseGuards(TenantJwtGuard, PermissionsGuard)
@PanelOnly()
export class UploadsController {
  constructor(private readonly storage: StorageService) {}

  @Post('hero')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_SIZE },
    }),
  )
  @HttpCode(HttpStatus.CREATED)
  async uploadHero(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: RequestWithTenantContext,
  ): Promise<{ url: string; storageKey: string; sizeBytes: number }> {
    if (!file) {
      throw new BadRequestException({
        message: 'No se recibió ningún archivo (campo "file").',
        error: 'FILE_MISSING',
      });
    }
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      throw new BadRequestException({
        message: `Tipo no permitido (${file.mimetype}). Permitidos: jpg, png, webp, avif.`,
        error: 'FILE_TYPE_NOT_ALLOWED',
      });
    }
    const tenant = req.tenantContext!.tenant;
    const uploaded = await this.storage.upload({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      tenantSlug: tenant.slug,
      keyPrefix: 'hero',
    });
    return {
      url: uploaded.url,
      storageKey: uploaded.storageKey,
      sizeBytes: uploaded.sizeBytes,
    };
  }
}
