/**
 * GregmornCallbackController — endpoint de los callbacks seamless de Gregmorn.
 *
 * Ruta: POST /api/v1/game-provider/gregmorn/callback/:token
 *
 * Está FUERA del TenantResolver (Gregmorn no manda Host). A diferencia de Palace
 * (token en el body) y Forever (agent code en un header), el callback de
 * Gregmorn **no trae ningún dato del que se pueda deducir el tenant**. Lo que sí
 * tenemos es que la `callbackUrl` se manda por request en cada `openGame`, así
 * que el discriminador viaja en la URL.
 *
 * Orden, y no se puede alterar:
 *   1. Resolver el tenant por `:token` (control DB). El token NO autentica —
 *      solo elige de quién es la `secret_api_key`.
 *   2. Verificar el HMAC contra el **body CRUDO** (`req.rawBody`). Nunca contra
 *      el body parseado: re-serializar cambia los bytes y la firma no valida.
 *   3. Recién ahí, tocar la wallet.
 *
 * La firma es el control principal. La allowlist de IP en Cloudflare
 * (`3.78.156.229`) es defensa en profundidad, no reemplazo.
 */

import {
  Body,
  Controller,
  Headers,
  Inject,
  Logger,
  OnModuleInit,
  Param,
  Post,
  Req,
  Res,
  type RawBodyRequest,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { tenants } from '@casino/db';
import type { ControlDb, Tenant } from '@casino/db';
import { CONTROL_DB } from '../../../common/symbols';
import { TenantConnectionCache } from '../../../tenant-resolver/tenant-connection-cache';
import { TenantSettingsService } from '../../../tenant-settings/tenant-settings.service';
import { GregmornCallbackService } from './gregmorn-callback.service';
import { verifyGregmornCallback } from './gregmorn-signer';
import {
  GREGMORN_DEFAULT_CURRENCY,
  type GregmornCallbackBody,
  type GregmornCallbackResponse,
} from './gregmorn.types';

/** Interfaz mínima de la respuesta HTTP (evita acoplar a Express en los tests). */
interface ResponseLike {
  status(code: number): unknown;
}

/** Cache token → tenant. TTL largo — se invalida al reiniciar. */
const tokenCache = new Map<string, Tenant>();

@Controller('api/v1/game-provider/gregmorn')
export class GregmornCallbackController implements OnModuleInit {
  private readonly logger = new Logger(GregmornCallbackController.name);

  constructor(
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly tenantCache: TenantConnectionCache,
    private readonly callbackService: GregmornCallbackService,
    private readonly settings: TenantSettingsService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const rows = await this.controlDb
        .select()
        .from(tenants)
        .where(
          and(eq(tenants.status, 'active'), isNotNull(tenants.gregmornCallbackToken)),
        );
      for (const row of rows) {
        if (row.gregmornCallbackToken) tokenCache.set(row.gregmornCallbackToken, row);
      }
      this.logger.log(`Pre-cargados ${rows.length} callback token(s) de Gregmorn.`);
      // Calentar las conexiones: el primer callback no debería pagar el connect.
      for (const row of rows) {
        try {
          const db = this.tenantCache.get(row);
          await db.execute(sql`SELECT 1`);
        } catch (err) {
          this.logger.warn(
            `No se pudo calentar DB ${row.dbName}: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `No se pudieron pre-cargar los tokens de Gregmorn: ${(err as Error).message}`,
      );
    }
  }

  @Cron('0 */3 * * *')
  async keepAliveTenantDbs(): Promise<void> {
    for (const [, tenant] of tokenCache) {
      try {
        const db = this.tenantCache.get(tenant);
        await db.execute(sql`SELECT 1`);
      } catch {
        // keep-warm best-effort.
      }
    }
  }

  @Post('callback/:token')
  async handleCallback(
    @Param('token') token: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: GregmornCallbackBody,
    @Req() req: RawBodyRequest<{ rawBody?: Buffer }>,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<GregmornCallbackResponse> {
    const login = body?.login ?? '';
    this.logger.log(`Gregmorn callback: cmd=${body?.cmd} login=${login}`);

    // 1. Resolver el tenant por el token de la URL.
    const tenant = await this.resolveTenant(token);
    if (!tenant) {
      this.logger.warn('Callback de Gregmorn con token que no matchea tenant activo.');
      return this.reject(res, login, 'INVALID_CALLBACK_TOKEN');
    }

    const tenantDb = this.tenantCache.get(tenant);

    // 2. Verificar la firma HMAC con la secret key de ESE tenant, sobre el body
    //    CRUDO. Antes de tocar la wallet.
    const secretApiKey = await this.settings.get<string>(
      tenantDb,
      'game_provider.gregmorn.secret_api_key',
    );
    if (!secretApiKey) {
      this.logger.error(`Falta secret_api_key de Gregmorn para el tenant ${tenant.slug}`);
      return this.reject(res, login, 'NO_VERIFY_KEY');
    }

    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : '';
    const verify = verifyGregmornCallback({ body: rawBody, secretApiKey, headers });
    if (!verify.verified) {
      this.logger.warn(
        `Firma inválida en callback de Gregmorn (${tenant.slug}): ${verify.error}`,
      );
      return this.reject(res, login, `INVALID_SIGNATURE: ${verify.error}`);
    }

    // 3. Procesar. El service decide el HTTP status (400 = fail/retry para ellos).
    const result = await this.callbackService.handle(tenantDb, body);
    res.status(result.httpStatus);
    return result.body;
  }

  /** Tenant activo dueño del token, con cache en memoria. */
  private async resolveTenant(token: string): Promise<Tenant | null> {
    const clean = (token ?? '').trim();
    if (!clean) return null;

    const cached = tokenCache.get(clean);
    if (cached) return cached;

    const rows = await this.controlDb
      .select()
      .from(tenants)
      .where(eq(tenants.gregmornCallbackToken, clean))
      .limit(1);
    const tenant = rows[0];
    if (!tenant || tenant.status !== 'active') return null;

    tokenCache.set(clean, tenant);
    return tenant;
  }

  /**
   * Rechazo previo a resolver el tenant: HTTP 400 + `status: 'fail'`.
   *
   * La moneda cae al default porque justamente no se pudo llegar a los settings
   * del tenant. Con `status: 'fail'` ellos no leen ni saldo ni moneda.
   */
  private reject(res: ResponseLike, login: string, error: string): GregmornCallbackResponse {
    res.status(400);
    return {
      balance: 0,
      currency: GREGMORN_DEFAULT_CURRENCY,
      error,
      login,
      status: 'fail',
    };
  }
}
