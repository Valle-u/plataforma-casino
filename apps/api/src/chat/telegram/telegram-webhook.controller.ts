/**
 * Webhook de Telegram — por acá entran los mensajes de afuera (**2.2**).
 *
 * Ruta: `POST /api/v1/crm/telegram/webhook/:tenantSlug/:channelId`
 *
 * ## Está FUERA del resolver de tenant, y por qué
 *
 * Telegram no manda `Host`: le pega a la URL que registramos y nada más. Es el
 * mismo problema que los callbacks de los proveedores de juego, y se resuelve
 * igual — **el discriminador viaja en la URL**.
 *
 * Dos segmentos, porque hacen falta dos cosas: el **slug** dice de qué casino
 * es, y el **id del canal** de quién es la bandeja (**D1**, **D2**).
 *
 * ⚠️ **La URL NO autentica.** Es pública y adivinable en su forma. Lo que
 * autentica es el header `X-Telegram-Bot-Api-Secret-Token`, que Telegram
 * devuelve en cada update porque se lo registramos en `setWebhook`, comparado
 * **en tiempo constante** contra el secreto del canal.
 *
 * ## El orden, que es lo que hace que no se pierda un mensaje
 *
 * 1. Verificar que es Telegram.
 * 2. **Guardar el crudo.**
 * 3. **Responder 200.**
 * 4. Recién ahí, procesar.
 *
 * Los pasos 2 y 3 van antes que el 4 a propósito. Telegram **reintenta** si
 * tardamos o si respondemos algo que no sea 200: procesar primero convierte un
 * pico de mensajes en una avalancha de reintentos. Y si el procesamiento falla
 * —o el contenedor se reinicia en el medio— el crudo ya está guardado y el
 * mensaje se puede recuperar. Sin eso, desaparece sin dejar rastro.
 */

import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { crmChannels, tenants, type ControlDb, type Tenant } from '@casino/db';
import { igualEnTiempoConstante } from '../../common/secreto-cifrado';
import { CONTROL_DB } from '../../database/database.module';
import { TenantConnectionCache } from '../../tenant-resolver/tenant-connection-cache';
import { TelegramInboundService } from './telegram-inbound.service';

/** Header con el que Telegram prueba que el update es suyo. */
const HEADER_SECRETO = 'x-telegram-bot-api-secret-token';

@Controller('api/v1/crm/telegram')
export class TelegramWebhookController {
  private readonly logger = new Logger(TelegramWebhookController.name);

  constructor(
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly tenantCache: TenantConnectionCache,
    private readonly inbound: TelegramInboundService,
  ) {}

  /**
   * Siempre 200, salvo que no podamos decir de quién es.
   *
   * ⚠️ **Responder un error le dice a Telegram que reintente.** Para un update
   * que no sabemos procesar —un tipo de mensaje nuevo, un payload raro— el
   * reintento no arregla nada y sólo multiplica el problema. Así que se
   * responde 200 y el motivo queda en el crudo, que es donde se puede mirar
   * después.
   */
  @Post('webhook/:tenantSlug/:channelId')
  @HttpCode(HttpStatus.OK)
  async recibir(
    @Param('tenantSlug') tenantSlug: string,
    @Param('channelId') channelId: string,
    @Headers() headers: Record<string, string | undefined>,
    @Body() body: unknown,
  ): Promise<{ ok: boolean }> {
    const tenant = await this.resolverTenant(tenantSlug);
    if (!tenant) {
      // Un slug que no existe: no hay a quién avisarle ni qué guardar.
      this.logger.warn(`Webhook de Telegram con slug desconocido: ${tenantSlug}`);
      return { ok: true };
    }

    const db = this.tenantCache.get(tenant);
    const canal = (
      await db
        .select()
        .from(crmChannels)
        .where(
          and(
            eq(crmChannels.id, channelId),
            eq(crmChannels.type, 'telegram'),
            eq(crmChannels.isActive, true),
          ),
        )
        .limit(1)
    )[0];

    if (!canal?.webhookSecret) {
      // Canal inexistente, de otro tipo, o desvinculado. Puede pasar sin que
      // nadie haga nada raro: al desvincular queda el webhook viejo apuntando
      // acá hasta que Telegram se entere.
      this.logger.warn(`Webhook de Telegram a un canal no activo: ${channelId}`);
      return { ok: true };
    }

    const recibido = headers[HEADER_SECRETO] ?? '';
    if (!igualEnTiempoConstante(recibido, canal.webhookSecret)) {
      // Alguien que no es Telegram. No se guarda el crudo: seria dejar que
      // cualquiera llene la tabla. Y se responde 200 igual, para no confirmarle
      // que la URL existe.
      this.logger.warn(
        `Webhook de Telegram con secreto que no matchea (canal ${channelId}).`,
      );
      return { ok: true };
    }

    await this.inbound.recibir(db, canal, body);
    return { ok: true };
  }

  /** El tenant activo con ese slug, o `null`. */
  private async resolverTenant(slug: string): Promise<Tenant | null> {
    const filas = await this.controlDb
      .select()
      .from(tenants)
      .where(and(eq(tenants.slug, slug), eq(tenants.status, 'active')))
      .limit(1);
    return filas[0] ?? null;
  }
}
