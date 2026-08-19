/**
 * ForeverCallbackController — endpoint del callback seamless de Forever.
 *
 * Ruta: POST /api/v1/game-provider/forever/callback  (la "Site endpoint" del panel).
 *
 * Fuera del TenantResolver (Forever no manda Host). Resolvemos el tenant por el
 * `agentCode` (header X-Forever-Sig-Agent) contra la DB de control
 * (tenants.forever_agent_code) y VERIFICAMOS la firma Ed25519 con la
 * `callback_verify_public_key` de ese tenant antes de tocar plata.
 */

import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  OnModuleInit,
  Post,
  Req,
  Inject,
  type RawBodyRequest,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { tenants } from '@casino/db';
import type { ControlDb, Tenant } from '@casino/db';
import { CONTROL_DB } from '../../../common/symbols';
import { TenantConnectionCache } from '../../../tenant-resolver/tenant-connection-cache';
import { TenantSettingsService } from '../../../tenant-settings/tenant-settings.service';
import { ForeverCallbackService } from './forever-callback.service';
import { verifyForeverCallback, FOREVER_SIG_HEADERS } from './forever-signer';
import { FOREVER_STATUS, type ForeverCallbackBody } from './forever.types';

/** Cache agentCode → tenant. TTL largo — se invalida al reiniciar. */
const agentCache = new Map<string, Tenant>();

@Controller('api/v1/game-provider/forever')
export class ForeverCallbackController implements OnModuleInit {
  private readonly logger = new Logger(ForeverCallbackController.name);

  constructor(
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly tenantCache: TenantConnectionCache,
    private readonly callbackService: ForeverCallbackService,
    private readonly settings: TenantSettingsService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const rows = await this.controlDb
        .select()
        .from(tenants)
        .where(and(eq(tenants.status, 'active'), isNotNull(tenants.foreverAgentCode)));
      for (const row of rows) {
        if (row.foreverAgentCode) agentCache.set(row.foreverAgentCode, row);
      }
      this.logger.log(`Pre-cargados ${rows.length} agentCode(s) de Forever.`);
      for (const row of rows) {
        try {
          const db = this.tenantCache.get(row);
          await db.execute(sql`SELECT 1`);
        } catch (err) {
          this.logger.warn(`No se pudo calentar DB ${row.dbName}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      this.logger.warn(`No se pudieron pre-cargar agentCodes de Forever: ${(err as Error).message}`);
    }
  }

  @Cron('0 */3 * * *')
  async keepAliveTenantDbs(): Promise<void> {
    for (const [, tenant] of agentCache) {
      try {
        const db = this.tenantCache.get(tenant);
        await db.execute(sql`SELECT 1`);
      } catch {
        // keep-warm best-effort.
      }
    }
  }

  @Post('callback')
  @HttpCode(200)
  async handleCallback(
    @Headers() headers: Record<string, string>,
    @Body() body: ForeverCallbackBody,
    @Req() req: RawBodyRequest<{ rawBody?: Buffer }>,
  ) {
    // 1. Agent code (viene en el header de firma).
    const agentCode = (headers[FOREVER_SIG_HEADERS.AGENT.toLowerCase()] ?? '').trim();
    this.logger.log(`Forever callback: method=${body?.method} agent=${agentCode}`);
    if (!agentCode) {
      return { status: FOREVER_STATUS.INVALID_AGENT, msg: 'MISSING_AGENT' };
    }

    // 2. Resolver el tenant por agentCode.
    let tenant = agentCache.get(agentCode);
    if (!tenant) {
      const rows = await this.controlDb
        .select()
        .from(tenants)
        .where(eq(tenants.foreverAgentCode, agentCode))
        .limit(1);
      tenant = rows[0];
      if (tenant && tenant.status === 'active') agentCache.set(agentCode, tenant);
    }
    if (!tenant || tenant.status !== 'active') {
      this.logger.warn(`Forever agentCode no matchea ningún tenant activo: ${agentCode}`);
      return { status: FOREVER_STATUS.INVALID_AGENT, msg: 'INVALID_AGENT' };
    }

    const tenantDb = this.tenantCache.get(tenant);

    // 3. Verificar la firma Ed25519 con la public key del tenant + body CRUDO.
    const publicKey = await this.settings.get<string>(
      tenantDb,
      'game_provider.forever.callback_verify_public_key',
    );
    if (!publicKey) {
      this.logger.error(`Falta callback_verify_public_key para tenant ${tenant.slug}`);
      return { status: FOREVER_STATUS.INTERNAL_ERROR, msg: 'NO_VERIFY_KEY' };
    }
    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : '';
    const verify = verifyForeverCallback({
      publicKeyBase64: publicKey,
      agentCode,
      body: rawBody,
      headers,
    });
    if (!verify.verified) {
      this.logger.warn(`Firma inválida en callback de Forever (${tenant.slug}): ${verify.error}`);
      return { status: FOREVER_STATUS.INVALID_AGENT, msg: `INVALID_SIGNATURE: ${verify.error}` };
    }

    // 4. Procesar.
    return this.callbackService.handle(tenantDb, body);
  }
}
