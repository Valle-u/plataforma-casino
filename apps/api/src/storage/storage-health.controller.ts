/**
 * StorageHealthController — Sprint 51.6.1.
 *
 * Endpoint admin para validar que el driver de storage activo funciona
 * end-to-end (upload → fetch → delete). Útil para:
 *   - Validar config inicial de R2 (env vars + credenciales + bucket).
 *   - Smoke test post-deploy.
 *   - Debug si los uploads empiezan a fallar.
 *
 * Reporta:
 *   - driver activo (local | r2)
 *   - upload OK + size + key generado
 *   - fetch OK + bytes leídos via HTTP GET de la URL
 *   - delete OK (idempotente)
 *   - duración de cada paso en ms
 *
 * Si alguno falla, devuelve 500 con el step donde falló + mensaje de
 * error. Esto desambiguar entre "credenciales malas" vs "bucket no
 * existe" vs "CORS bloqueado" vs "endpoint mal escrito".
 *
 * Sin permission específica — gateado por @PanelOnly + JWT del admin.
 * Si alguien quiere abrirlo a roles operativos, agregar
 * `@RequirePermissions('tenant.settings.edit')`.
 */

import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Req,
  UseGuards,
} from '@nestjs/common';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { PanelOnly } from '../tenant-auth/panel-only.decorator';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { StorageService } from './storage.service';

interface HealthStep {
  step: 'upload' | 'fetch' | 'delete';
  ok: boolean;
  durationMs: number;
  details?: Record<string, unknown>;
  error?: string;
}

interface HealthReport {
  driver: string;
  bucket: string | null;
  publicBaseUrl: string | null;
  endpoint: string | null;
  ok: boolean;
  steps: HealthStep[];
  totalDurationMs: number;
}

@Controller('tenant/storage')
@UseGuards(TenantJwtGuard)
@PanelOnly()
export class StorageHealthController {
  private readonly logger = new Logger(StorageHealthController.name);

  constructor(private readonly storage: StorageService) {}

  /**
   * GET /tenant/storage/health
   *
   * Sube un PNG de 1x1 al storage activo, fetchea la URL, valida que
   * el contenido coincide, borra el archivo. Reporta el detalle de
   * cada paso. Si todo OK, devuelve 200; si algo falla, 500 con la
   * pista exacta de dónde rompió.
   */
  @Get('health')
  async health(@Req() req: RequestWithTenantContext): Promise<HealthReport> {
    const driver = (process.env.STORAGE_DRIVER ?? 'local').toLowerCase();
    const bucket = process.env.R2_BUCKET ?? null;
    const endpoint = process.env.R2_ENDPOINT ?? null;
    const publicBaseUrl =
      driver === 'r2'
        ? process.env.R2_PUBLIC_BASE_URL ?? null
        : process.env.STORAGE_PUBLIC_BASE_URL ?? null;
    const tenantSlug = req.tenantContext?.tenant.slug ?? 'unknown';

    const t0 = Date.now();
    const steps: HealthStep[] = [];

    // PNG 1x1 transparente (~70 bytes).
    const buffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    );

    let storageKey: string | null = null;
    let url: string | null = null;

    // Step 1: upload.
    const upStart = Date.now();
    try {
      const uploaded = await this.storage.upload({
        buffer,
        originalName: 'healthcheck.png',
        mimeType: 'image/png',
        keyPrefix: 'health/_probe',
        tenantSlug,
      });
      storageKey = uploaded.storageKey;
      url = uploaded.url;
      steps.push({
        step: 'upload',
        ok: true,
        durationMs: Date.now() - upStart,
        details: {
          storageKey: uploaded.storageKey,
          sizeBytes: uploaded.sizeBytes,
          urlLength: uploaded.url.length,
        },
      });
    } catch (err) {
      steps.push({
        step: 'upload',
        ok: false,
        durationMs: Date.now() - upStart,
        error: (err as Error).message,
      });
      return fail(driver, bucket, endpoint, publicBaseUrl, steps, t0);
    }

    // Step 2: fetch (validar que la URL es accesible + content match).
    const fetchStart = Date.now();
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(
          `HTTP ${res.status} ${res.statusText} al fetchear ${url}`,
        );
      }
      const contentType = res.headers.get('content-type') ?? '(missing)';
      const fetchedBuf = Buffer.from(await res.arrayBuffer());
      const bytesMatch = fetchedBuf.length === buffer.length;
      steps.push({
        step: 'fetch',
        ok: bytesMatch,
        durationMs: Date.now() - fetchStart,
        details: {
          httpStatus: res.status,
          contentType,
          expectedBytes: buffer.length,
          receivedBytes: fetchedBuf.length,
        },
        error: bytesMatch
          ? undefined
          : `Mismatch: esperaba ${buffer.length} bytes, recibí ${fetchedBuf.length}.`,
      });
      if (!bytesMatch) {
        return fail(driver, bucket, endpoint, publicBaseUrl, steps, t0);
      }
    } catch (err) {
      steps.push({
        step: 'fetch',
        ok: false,
        durationMs: Date.now() - fetchStart,
        error: (err as Error).message,
        details: { urlAttempted: url ?? null },
      });
      // No abortamos — intentamos delete igual para limpiar.
    }

    // Step 3: delete.
    const delStart = Date.now();
    try {
      await this.storage.delete(storageKey);
      steps.push({
        step: 'delete',
        ok: true,
        durationMs: Date.now() - delStart,
        details: { storageKey },
      });
    } catch (err) {
      steps.push({
        step: 'delete',
        ok: false,
        durationMs: Date.now() - delStart,
        error: (err as Error).message,
      });
    }

    const allOk = steps.every((s) => s.ok);
    const report: HealthReport = {
      driver,
      bucket,
      endpoint,
      publicBaseUrl,
      ok: allOk,
      steps,
      totalDurationMs: Date.now() - t0,
    };

    if (!allOk) {
      this.logger.error(
        `Storage health FAIL: driver=${driver} steps=${JSON.stringify(steps)}`,
      );
      throw new HttpException(report, HttpStatus.INTERNAL_SERVER_ERROR);
    }
    this.logger.log(
      `Storage health OK: driver=${driver} duration=${report.totalDurationMs}ms`,
    );
    return report;
  }
}

function fail(
  driver: string,
  bucket: string | null,
  endpoint: string | null,
  publicBaseUrl: string | null,
  steps: HealthStep[],
  t0: number,
): never {
  const report: HealthReport = {
    driver,
    bucket,
    endpoint,
    publicBaseUrl,
    ok: false,
    steps,
    totalDurationMs: Date.now() - t0,
  };
  throw new HttpException(report, HttpStatus.INTERNAL_SERVER_ERROR);
}
