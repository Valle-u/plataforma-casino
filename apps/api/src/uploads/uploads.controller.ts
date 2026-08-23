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
 *
 * POST /tenant/uploads/presign
 *   - Body: { fileName, mimeType }
 *   - Devuelve presigned PUT URL para subir directo al bucket
 *   - Útil cuando el backend no puede conectar a R2 (TLS issues)
 */

import {
  BadRequestException,
  Body,
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
import { IsString, Matches, MaxLength } from 'class-validator';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { PermissionsGuard } from '../permissions/permissions.guard';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { PanelOnly } from '../tenant-auth/panel-only.decorator';
import { StorageService } from '../storage/storage.service';
import { FileValidationService } from '../storage/file-validation.service';

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

class PresignDto {
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsString()
  @MaxLength(50)
  @Matches(/^image\/(jpeg|png|webp|avif)$/, {
    message: 'MIME type no permitido. Permitidos: jpg, png, webp, avif.',
  })
  mimeType!: string;
}

@Controller('tenant/uploads')
@UseGuards(TenantJwtGuard, PermissionsGuard)
@PanelOnly()
export class UploadsController {
  constructor(
    private readonly storage: StorageService,
    private readonly fileValidation: FileValidationService,
  ) {}

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
    // Super filtro: valida el contenido real y redibuja la imagen desde los
    // píxeles (descarta cualquier payload embebido). Solo imágenes acá.
    const clean = await this.fileValidation.validate(file.buffer, {
      allow: ['image'],
      maxBytes: MAX_SIZE,
    });
    const tenant = req.tenantContext!.tenant;
    const uploaded = await this.storage.upload({
      buffer: clean.buffer,
      originalName: `hero${clean.extension}`,
      mimeType: clean.mimeType,
      tenantSlug: tenant.slug,
      keyPrefix: 'hero',
    });
    return {
      url: uploaded.url,
      storageKey: uploaded.storageKey,
      sizeBytes: uploaded.sizeBytes,
    };
  }

  /**
   * Genera una presigned PUT URL para que el browser suba directo al
   * bucket (R2) sin pasar por el backend. Resuelve el problema de
   * TLS handshake failure entre Railway y R2.
   */
  @Post('presign')
  @HttpCode(HttpStatus.OK)
  async presignUpload(
    @Body() dto: PresignDto,
    @Req() req: RequestWithTenantContext,
  ): Promise<{ uploadUrl: string; storageKey: string; publicUrl: string }> {
    const ext = extname(dto.fileName).toLowerCase();
    if (ext.length === 0 || ext.length > 8 || !ALLOWED_EXTENSIONS.has(ext)) {
      throw new BadRequestException({
        message: 'Extensión de archivo no permitida.',
        error: 'INVALID_EXTENSION',
      });
    }

    const tenant = req.tenantContext!.tenant;
    const id = randomUUID();
    const storageKey = `tenants/${tenant.slug}/hero/${id}${ext}`;
    const publicUrl = await this.storage.getUrl(storageKey);
    const uploadUrl = await this.storage.presignPutUrl(storageKey, dto.mimeType);

    return { uploadUrl, storageKey, publicUrl };
  }
}
