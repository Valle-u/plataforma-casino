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
 * El paso 5 lo hace `WhatsappInboundService`, y **su fallo no se propaga**: el
 * crudo queda con `processed_at` en `NULL` y el motivo en `error`, que es como
 * se detecta después que algo se está trabando. Hacer que Meta reintente no
 * arregla un payload que no sabemos leer — sólo lo repite.
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
  crmChannels,
  crmRawEvents,
  tenants,
  whatsappNumbers,
  type ControlDb,
  type CrmChannel,
  type Tenant,
} from '@casino/db';
import { CONTROL_DB } from '../../database/database.module';
import { TenantConnectionCache } from '../../tenant-resolver/tenant-connection-cache';
import { firmaDeMetaValida, HEADER_FIRMA } from './firma-de-meta';
import { trozosPorNumero } from './payload-de-meta';
import { WhatsappInboundService } from './whatsapp-inbound.service';

/**
 * El `change` que hay adentro de un trozo ya recortado.
 *
 * `trozosPorNumero` deja un sobre con **una** `entry` y **un** `change`, así que
 * esto sólo lo desenvuelve. Se hace acá y no adentro del inbound para que el
 * inbound reciba lo mismo que reciben sus tests: un `change` y nada más.
 */
function unicoCambio(payload: unknown): unknown {
  const sobre = payload as { entry?: Array<{ changes?: unknown[] }> };
  return sobre?.entry?.[0]?.changes?.[0] ?? null;
}

/** ¿El error es un choque con un índice único? */
function esDuplicado(err: unknown): boolean {
  const code =
    (err as { code?: string })?.code ??
    (err as { cause?: { code?: string } })?.cause?.code;
  // 23505 = unique_violation en Postgres.
  return code === '23505' || /duplicate key|unique/i.test(String(err));
}

@Controller('api/v1/crm/whatsapp')
export class WhatsappWebhookController {
  private readonly logger = new Logger(WhatsappWebhookController.name);

  constructor(
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly tenantCache: TenantConnectionCache,
    private readonly inbound: WhatsappInboundService,
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

      const db = this.tenantCache.get(tenant);

      let rawId: string;
      try {
        rawId = (
          await db
            .insert(crmRawEvents)
            .values({
              channelId: numero.channelId,
              externalId: trozo.primerMensajeId,
              // El sobre ya viene recortado a este número. Guardar el entero
              // metería datos de otro casino en esta base.
              payload: trozo.payload,
            })
            .returning({ id: crmRawEvents.id })
        )[0]!.id;
      } catch (err) {
        // Choque con el índice único = ya lo recibimos. Meta reintenta la
        // entrega entera cuando no responde 200 a tiempo, así que esto es
        // esperable y no hay nada que hacer: el mensaje ya está.
        if (esDuplicado(err)) return;
        throw err;
      }

      // ── Recién ahora se procesa ─────────────────────────────────────────
      //
      // El crudo ya está guardado, así que si esto falla —o el contenedor se
      // reinicia en el medio— el mensaje no se perdió: queda con
      // `processed_at` en NULL, que es como se detecta que algo se traba.
      //
      // El fallo **no se propaga**: el que llama ya decidió responder 200, y
      // hacer que Meta reintente no arregla un payload que no sabemos leer.
      const canal = await this.canalDelNumero(db, numero.channelId);
      if (!canal) {
        await this.anotarError(db, rawId, 'El canal no existe o no está activo.');
        return;
      }

      try {
        await this.inbound.procesar(db, canal, unicoCambio(trozo.payload));
        await db
          .update(crmRawEvents)
          .set({ processedAt: new Date() })
          .where(eq(crmRawEvents.id, rawId));
      } catch (err) {
        await this.anotarError(db, rawId, (err as Error).message);
      }
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

  /** El canal en la base del tenant. `null` si no existe o está desactivado. */
  private async canalDelNumero(
    db: ReturnType<TenantConnectionCache['get']>,
    channelId: string,
  ): Promise<CrmChannel | null> {
    const filas = await db
      .select()
      .from(crmChannels)
      .where(
        and(
          eq(crmChannels.id, channelId),
          eq(crmChannels.type, 'whatsapp'),
          eq(crmChannels.isActive, true),
        ),
      )
      .limit(1);
    return filas[0] ?? null;
  }

  /**
   * Deja el motivo en el crudo.
   *
   * Es lo único que queda para entender después por qué un mensaje no llegó a
   * ninguna bandeja, así que no puede fallar en cascada: si ni esto se puede
   * escribir, va al log y se sigue.
   */
  private async anotarError(
    db: ReturnType<TenantConnectionCache['get']>,
    rawId: string,
    motivo: string,
  ): Promise<void> {
    this.logger.error(`Cambio de WhatsApp sin procesar (${rawId}): ${motivo}`);
    try {
      await db
        .update(crmRawEvents)
        .set({ error: motivo.slice(0, 500) })
        .where(eq(crmRawEvents.id, rawId));
    } catch {
      // Ya está en el log, que es lo que queda cuando la base no responde.
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
