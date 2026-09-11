/**
 * Webhook del bot de alertas — por acá el operador vincula su Telegram (**4.5**).
 *
 * ```
 * POST /api/v1/crm/avisos/webhook
 * ```
 *
 * ## Qué recibe, y por qué tan poco
 *
 * **Sólo `/start <código>`.** Cualquier otra cosa se contesta 200 y se ignora.
 * Este bot no atiende gente: manda alertas y recibe un único comando. Todo lo
 * que no sea ese comando es alguien equivocado, o ruido.
 *
 * ## De qué casino es un `/start`
 *
 * El bot de alertas es **uno solo para toda la plataforma**, así que al llegar
 * un `/start` hay que saber a qué casino pertenece **antes de poder abrir su
 * base**. Es el mismo problema que **D23** con WhatsApp, y acá se resuelve más
 * barato: el slug va **adentro del código** (`demo-A3F9K2`).
 *
 * No hace falta una tabla en la DB de control porque el código es **efímero y lo
 * tipea una persona** — vive quince minutos y se quema al usarlo.
 *
 * ## La autenticidad
 *
 * El header `X-Telegram-Bot-Api-Secret-Token`, igual que el webhook de los
 * canales, comparado **en tiempo constante**. Sin el secreto configurado no se
 * procesa nada: no verificar no es lo mismo que aceptar.
 *
 * ⚠️ **Y el secreto no es lo único que protege.** Un código válido es lo que
 * vincula, así que aunque alguien mande un `/start` falso sin saber un código,
 * no consigue nada.
 */

import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { tenants, type ControlDb } from '@casino/db';
import { igualEnTiempoConstante } from '../common/secreto-cifrado';
import { CONTROL_DB } from '../database/database.module';
import { TenantConnectionCache } from '../tenant-resolver/tenant-connection-cache';
import { AvisosAlOperadorService } from './avisos-al-operador.service';

const HEADER_SECRETO = 'x-telegram-bot-api-secret-token';

/** Lo que se mira de un update. El bot de alertas no necesita más. */
interface UpdateDeTelegram {
  message?: {
    text?: string;
    chat?: { id?: number };
  };
}

@Controller('api/v1/crm/avisos')
export class AvisosWebhookController {
  private readonly logger = new Logger(AvisosWebhookController.name);

  constructor(
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly tenantCache: TenantConnectionCache,
    private readonly avisos: AvisosAlOperadorService,
  ) {}

  /**
   * Siempre 200. Telegram reintenta lo que no lo sea, y reintentar un `/start`
   * con un código que no sirve no lo va a hacer servir.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async recibir(
    @Headers() headers: Record<string, string | undefined>,
    @Body() body: UpdateDeTelegram,
  ): Promise<{ ok: boolean }> {
    const esperado = process.env.TELEGRAM_ALERT_WEBHOOK_SECRET?.trim();
    if (!esperado) return { ok: true };
    if (!igualEnTiempoConstante(headers[HEADER_SECRETO] ?? '', esperado)) {
      this.logger.warn('Webhook de avisos con secreto que no matchea.');
      return { ok: true };
    }

    const texto = body?.message?.text?.trim() ?? '';
    const chatId = body?.message?.chat?.id;
    if (typeof chatId !== 'number') return { ok: true };

    const codigo = /^\/start\s+(\S+)$/i.exec(texto)?.[1];
    if (!codigo) {
      // Un `/start` pelado —el que manda Telegram al abrir el bot— o cualquier
      // otro mensaje. Se explica qué es esto en vez de dejarlo mudo: quien
      // llegó acá sin código probablemente sea un operador que se perdió.
      await this.avisos.postear(
        String(chatId),
        'Este bot avisa cuando te entra un mensaje al panel.\n\n' +
          'Para vincularlo, sacá el código desde el panel y mandámelo así:\n' +
          '<code>/start TU-CODIGO</code>',
      );
      return { ok: true };
    }

    const tenant = await this.tenantDelCodigo(codigo);
    if (!tenant) {
      await this.avisos.postear(String(chatId), 'Ese código no sirve.');
      return { ok: true };
    }

    const vinculado = await this.avisos.vincular(this.tenantCache.get(tenant), {
      codigo,
      chatId: String(chatId),
    });

    await this.avisos.postear(
      String(chatId),
      vinculado
        ? `✅ Listo, <b>${vinculado.username}</b>. Te voy a avisar acá cuando ` +
            'te entre un mensaje.\n\nTe digo <b>quién</b> escribió, no lo que ' +
            'dijo: para leerlo entrá al panel.'
        : // Mismo texto que el tenant inexistente: distinguir "venció" de "no
          // existe" le confirmaría a un desconocido que ese código existió.
          'Ese código no sirve. Puede haber vencido — sacá uno nuevo del panel.',
    );

    return { ok: true };
  }

  /**
   * El casino dueño del código, sacado de su prefijo.
   *
   * El slug puede tener guiones (`demo-casino`), así que el **último** segmento
   * es la parte al azar y todo lo de antes es el slug.
   */
  private async tenantDelCodigo(codigo: string) {
    const corte = codigo.lastIndexOf('-');
    if (corte <= 0) return null;
    const slug = codigo.slice(0, corte);

    const filas = await this.controlDb
      .select()
      .from(tenants)
      .where(and(eq(tenants.slug, slug), eq(tenants.status, 'active')))
      .limit(1);
    return filas[0] ?? null;
  }
}
