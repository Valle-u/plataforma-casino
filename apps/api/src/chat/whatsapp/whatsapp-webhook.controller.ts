/**
 * Webhook de WhatsApp — la puerta por la que entra Meta (**3.2**).
 *
 * ```
 * GET  /api/v1/crm/whatsapp/webhook   ← el apretón de manos, una sola vez
 * POST /api/v1/crm/whatsapp/webhook   ← los mensajes, siempre
 * ```
 *
 * ## Una sola URL para todos los casinos (D23)
 *
 * **Meta configura UNA URL de callback por App**, y por D23 la App es nuestra
 * con un WABA por socio. O sea que acá cae todo, de todos, y el discriminador
 * **no viaja en la URL** como en Telegram: viaja adentro del payload, en el
 * `phone_number_id`, y se resuelve contra `whatsapp_numbers` en la DB de control.
 *
 * ## El orden, que es lo que hace que no se pierda un mensaje
 *
 * 1. **Verificar la firma** — contra los bytes crudos, con el App Secret.
 * 2. Partir la entrega por número y resolver de quién es cada trozo.
 * 3. **Guardar el crudo.**
 * 4. **Responder 200.**
 * 5. Recién ahí, procesar.
 *
 * Es el mismo orden que Telegram (**2.2**) con **una mejora**: allá el secreto
 * es por canal, así que hay que resolver el canal antes de poder verificar, y un
 * request falso ya costó dos consultas. Acá el App Secret es uno solo, así que
 * **la firma se verifica antes de tocar la base**.
 *
 * El paso 5 todavía no existe: convertir un `change` en contacto + conversación
 * + mensaje es la tanda que sigue, igual que en Telegram el webhook vino antes
 * que el ruteo. Los crudos quedan con `processed_at` en `NULL`, que es el estado
 * que el diseño ya define como "todavía no se procesó".
 *
 * ## Siempre 200
 *
 * Meta **reintenta** lo que no responda 200, y escala el reintento. Para un
 * payload que no sabemos leer, reintentar no arregla nada: multiplica. Así que
 * se responde 200 y el motivo queda en el log o en el crudo, que es donde se
 * puede mirar después.
 *
 * La única excepción es el `GET` de verificación, que **tiene** que fallar si el
 * token no coincide: ahí un 403 es la respuesta correcta y no hay reintento que
 * empeore nada.
 */

import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Query,
  Post,
  Req,
  ForbiddenException,
  type RawBodyRequest,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  crmRawEvents,
  tenants,
  whatsappNumbers,
  type ControlDb,
  type Tenant,
} from '@casino/db';
import { CONTROL_DB } from '../../database/database.module';
import { TenantConnectionCache } from '../../tenant-resolver/tenant-connection-cache';
import { firmaDeMetaValida, HEADER_FIRMA } from './firma-de-meta';
import { trozosPorNumero } from './payload-de-meta';

@Controller('api/v1/crm/whatsapp')
export class WhatsappWebhookController {
  private readonly logger = new Logger(WhatsappWebhookController.name);

  constructor(
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly tenantCache: TenantConnectionCache,
  ) {}

  /**
   * El apretón de manos de Meta, que ocurre **una sola vez** al configurar el
   * webhook en la App.
   *
   * Meta pega un `GET` con `hub.mode=subscribe`, un `hub.verify_token` que
   * elegimos nosotros y un `hub.challenge` al azar. Hay que devolver el
   * challenge **tal cual y en texto plano**: si se devuelve JSON, o con comillas,
   * Meta no acepta la URL — y el mensaje que da no explica por qué.
   *
   * ⚠️ **El verify token no es una credencial de seguridad.** Sólo prueba que
   * quien configura la App es quien tiene la variable de entorno. Lo que
   * autentica cada mensaje es la **firma** del `POST`.
   */
  @Get('webhook')
  verificar(
    @Query('hub.mode') modo: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
  ): string {
    const esperado = process.env.WHATSAPP_VERIFY_TOKEN;

    // Sin token configurado no se verifica nada. No verificar **no es lo mismo
    // que aceptar**: dejaría que cualquiera registre nuestro webhook en su App.
    if (!esperado || modo !== 'subscribe' || token !== esperado) {
      this.logger.warn('Verificación de webhook de WhatsApp rechazada.');
      throw new ForbiddenException();
    }
    return challenge ?? '';
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async recibir(
    @Req() req: RawBodyRequest<{ rawBody?: Buffer; body?: unknown }>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<{ ok: boolean }> {
    // 1. La firma, contra los BYTES CRUDOS. Antes de tocar la base: lo que no
    //    está firmado no llega a consultar nada.
    const firma = headers[HEADER_FIRMA];
    const ok = firmaDeMetaValida({
      crudo: req.rawBody,
      firmaRecibida: Array.isArray(firma) ? firma[0] : firma,
      appSecret: process.env.WHATSAPP_APP_SECRET,
    });
    if (!ok) {
      // 200 igual, y sin guardar nada: un error le diría a Meta que reintente, y
      // guardar el crudo dejaría que cualquiera que sepa la URL llene la tabla.
      // Tampoco se confirma que la URL existe.
      this.logger.warn('Webhook de WhatsApp con firma inválida.');
      return { ok: true };
    }

    // 2. De quién es cada pedazo. Una entrega puede traer números de **casinos
    //    distintos**: ver `payload-de-meta.ts` para por qué eso es P4 y no un
    //    detalle de ruteo.
    for (const trozo of trozosPorNumero(req.body)) {
      await this.guardarCrudo(trozo);
    }

    return { ok: true };
  }

  /**
   * Guarda un trozo en la base del casino dueño del número.
   *
   * Cada trozo se resuelve por separado a propósito: si uno falla, los otros de
   * la misma entrega igual se guardan. Meta no reintenta por trozo —reintenta la
   * entrega entera— así que perder uno por culpa de otro sería perderlo del todo.
   */
  private async guardarCrudo(trozo: {
    phoneNumberId: string;
    payload: unknown;
    primerMensajeId: string | null;
  }): Promise<void> {
    try {
      const numero = (
        await this.controlDb
          .select()
          .from(whatsappNumbers)
          .where(
            and(
              eq(whatsappNumbers.phoneNumberId, trozo.phoneNumberId),
              eq(whatsappNumbers.isActive, true),
            ),
          )
          .limit(1)
      )[0];

      if (!numero) {
        // Un número que no reclamó nadie, o uno desvinculado cuyo webhook Meta
        // todavía no borró. No es necesariamente un ataque: la firma ya dijo que
        // es Meta de verdad.
        this.logger.warn(
          `Webhook de WhatsApp de un número no vinculado: ${trozo.phoneNumberId}`,
        );
        return;
      }

      const tenant = await this.tenantActivo(numero.tenantId);
      if (!tenant) {
        this.logger.warn(
          `El número ${trozo.phoneNumberId} apunta a un casino que no está activo.`,
        );
        return;
      }

      await this.tenantCache
        .get(tenant)
        .insert(crmRawEvents)
        .values({
          channelId: numero.channelId,
          externalId: trozo.primerMensajeId,
          // El sobre ya viene recortado a este número. Guardar el entero metería
          // datos de otro casino en esta base.
          payload: trozo.payload,
        });
    } catch (err) {
      // Un fallo guardando no puede tirar el request: Meta reintentaría la
      // entrega entera. Queda en el log, que es lo único que se puede mirar
      // cuando el crudo justamente no se pudo escribir.
      this.logger.error(
        `No se pudo guardar el crudo de ${trozo.phoneNumberId}: ` +
          `${(err as Error).message}`,
      );
    }
  }

  private async tenantActivo(id: string): Promise<Tenant | null> {
    const filas = await this.controlDb
      .select()
      .from(tenants)
      .where(and(eq(tenants.id, id), eq(tenants.status, 'active')))
      .limit(1);
    return filas[0] ?? null;
  }
}
