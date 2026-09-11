/**
 * Avisarle al operador por Telegram que le entró un mensaje (**4.5**, **D25**).
 *
 * ## Esto reabre D16, y por un motivo que cambió
 *
 * **D16** decidió que el aviso vive en el panel y no sale de ahí. Y **ofreció
 * esto mismo como la primera mejora**: *"avisar por Telegram con el bot que ya
 * anda — gratis, sin límite de volumen, llega al celular"*. Lo dejó afuera
 * porque la infraestructura no estaba probada con un bot real.
 *
 * **El 2026-09-10 se probó**: vincular, recibir, responder, adjuntos, y con dos
 * personas distintas. El motivo por el que D16 lo postergó dejó de existir.
 *
 * ## ⚠️ Lo que el aviso NO dice: el contenido
 *
 * Llega **quién escribió y a qué bandeja**. Nunca lo que dijo.
 *
 * No es por **D8** —ahí el destinatario es *otra* bandeja y acá es el dueño, que
 * puede leer lo suyo— sino por dónde termina el texto: el Telegram personal del
 * operador es **un dispositivo que no controlamos**, y lo que llega ahí queda
 * para siempre. Es el mismo criterio por el que el alta no manda la contraseña
 * por el chat.
 *
 * Y tiene una consecuencia buena: el operador **tiene que abrir el panel**, que
 * es donde la conversación se puede atender de verdad.
 *
 * ## Esto no contradice D17
 *
 * **D17** dice que el sistema no le escribe solo **al jugador**. Acá el
 * destinatario es el **operador**, sobre su propia bandeja. El jugador sigue sin
 * recibir nada automático: contesta un humano o nadie.
 *
 * ## El silencio, que es lo que hace que sirva
 *
 * Un aviso por mensaje convierte el Telegram del operador en ruido, y un canal
 * que molesta se silencia — y ahí el aviso deja de existir. Así que **una
 * conversación avisa una vez cada `SILENCIO_MIN` minutos**, sin importar cuántos
 * mensajes lleguen.
 *
 * Se guarda en memoria, igual que `AlertsService`: un reinicio manda un aviso de
 * más, que es el lado barato de equivocarse.
 */

import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { and, eq, gt, isNotNull } from 'drizzle-orm';
import { crmOperatorAlerts, users } from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';

/** Cuánto vive un código sin usar. */
const CODIGO_VIVE_MIN = 15;

/** Una conversación no vuelve a avisar antes de esto. */
const SILENCIO_MIN = 15;

/** Lo que Telegram tarda en contestar cuando anda. */
const TIMEOUT_MS = 10_000;

@Injectable()
export class AvisosAlOperadorService {
  private readonly logger = new Logger(AvisosAlOperadorService.name);

  /** `conversationId` → cuándo se avisó por última vez. Ver el docblock. */
  private readonly ultimoAviso = new Map<string, number>();

  private get token(): string | undefined {
    return process.env.TELEGRAM_BOT_TOKEN?.trim() || undefined;
  }

  /**
   * Genera —o renueva— el código que el operador le manda al bot.
   *
   * Renovar en vez de fallar si ya hay uno: el caso común es que lo perdió o se
   * le venció, y hacerlo pelear con un código viejo no protege de nada.
   *
   * El slug va **adentro** del código porque el bot de alertas es uno solo para
   * toda la plataforma: al llegar el `/start` hay que saber de qué casino es
   * antes de poder abrir su base.
   */
  async generarCodigo(
    db: TenantDb,
    params: { userId: string; tenantSlug: string },
  ): Promise<{ codigo: string; venceEn: string }> {
    const codigo = `${params.tenantSlug}-${randomBytes(4).toString('hex').toUpperCase()}`;
    const vence = new Date(Date.now() + CODIGO_VIVE_MIN * 60_000);

    await db
      .insert(crmOperatorAlerts)
      .values({
        userId: params.userId,
        linkCode: codigo,
        linkCodeExpiresAt: vence,
      })
      .onConflictDoUpdate({
        target: crmOperatorAlerts.userId,
        set: { linkCode: codigo, linkCodeExpiresAt: vence },
      });

    return { codigo, venceEn: vence.toISOString() };
  }

  /**
   * Vincula el chat de Telegram al operador dueño del código.
   *
   * Devuelve el nombre del operador para poder saludarlo, o `null` si el código
   * no sirve. **No dice por qué** no sirve: el que manda un código al bot puede
   * ser cualquiera, y distinguir "no existe" de "venció" le confirmaría que
   * existió.
   */
  async vincular(
    db: TenantDb,
    params: { codigo: string; chatId: string },
  ): Promise<{ username: string } | null> {
    const fila = (
      await db
        .select({ userId: crmOperatorAlerts.userId })
        .from(crmOperatorAlerts)
        .where(
          and(
            eq(crmOperatorAlerts.linkCode, params.codigo),
            isNotNull(crmOperatorAlerts.linkCodeExpiresAt),
            gt(crmOperatorAlerts.linkCodeExpiresAt, new Date()),
          ),
        )
        .limit(1)
    )[0];
    if (!fila) return null;

    await db
      .update(crmOperatorAlerts)
      .set({
        chatId: params.chatId,
        // El código se quema: uno que sigue vivo después de vincular es una
        // segunda llave a la misma puerta.
        linkCode: null,
        linkCodeExpiresAt: null,
        enabled: true,
        linkedAt: new Date(),
      })
      .where(eq(crmOperatorAlerts.userId, fila.userId));

    const u = (
      await db
        .select({ username: users.username })
        .from(users)
        .where(eq(users.id, fila.userId))
        .limit(1)
    )[0];

    this.logger.log(`Avisos de Telegram vinculados al operador ${fila.userId}.`);
    return { username: u?.username ?? 'operador' };
  }

  /** Corta los avisos sin borrar el vínculo. */
  async apagar(db: TenantDb, userId: string): Promise<void> {
    await db
      .update(crmOperatorAlerts)
      .set({ enabled: false })
      .where(eq(crmOperatorAlerts.userId, userId));
  }

  /** Cómo está el vínculo, para mostrarlo en el panel. */
  async estado(
    db: TenantDb,
    userId: string,
  ): Promise<{ vinculado: boolean; activo: boolean }> {
    const fila = (
      await db
        .select({
          chatId: crmOperatorAlerts.chatId,
          enabled: crmOperatorAlerts.enabled,
        })
        .from(crmOperatorAlerts)
        .where(eq(crmOperatorAlerts.userId, userId))
        .limit(1)
    )[0];
    return {
      vinculado: Boolean(fila?.chatId),
      activo: Boolean(fila?.chatId && fila.enabled),
    };
  }

  /**
   * Avisa que entró un mensaje, si corresponde.
   *
   * **No tira nunca y no espera a Telegram para nada importante**: esto corre
   * detrás de guardar un mensaje entrante, y un aviso que falla no puede hacer
   * que el mensaje se pierda. Ese es el orden que 2.7 dejó fijado.
   */
  async avisar(
    db: TenantDb,
    params: {
      /** La bandeja dueña de la conversación. */
      operadorId: string;
      conversationId: string;
      /** Cómo se llama quien escribió. **Nunca lo que dijo.** */
      deQuien: string;
      canal: string;
    },
  ): Promise<void> {
    try {
      const ahora = Date.now();
      const previo = this.ultimoAviso.get(params.conversationId);
      if (previo && ahora - previo < SILENCIO_MIN * 60_000) return;

      if (!this.token) return;

      const fila = (
        await db
          .select({ chatId: crmOperatorAlerts.chatId })
          .from(crmOperatorAlerts)
          .where(
            and(
              eq(crmOperatorAlerts.userId, params.operadorId),
              eq(crmOperatorAlerts.enabled, true),
              isNotNull(crmOperatorAlerts.chatId),
            ),
          )
          .limit(1)
      )[0];
      if (!fila?.chatId) return;

      // Se marca ANTES de mandar: si Telegram está caído, reintentar en cada
      // mensaje sería peor que perder el aviso.
      this.ultimoAviso.set(params.conversationId, ahora);

      await this.postear(
        fila.chatId,
        `💬 <b>${escapar(params.deQuien)}</b> te escribió por ${escapar(params.canal)}.\n\n` +
          'Abrí el panel para leerlo y responder.',
      );
    } catch (err) {
      this.logger.warn(
        `No se pudo avisar al operador ${params.operadorId}: ${(err as Error).message}`,
      );
    }
  }

  /** Un mensaje al chat, por el bot de alertas. */
  async postear(chatId: string, texto: string): Promise<boolean> {
    if (!this.token) return false;
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${this.token}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: texto,
            parse_mode: 'HTML',
            // El aviso no lleva nada que valga la pena previsualizar, y una
            // preview haría más ruido del necesario.
            disable_web_page_preview: true,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Para los tests: vacía el silencio en memoria. */
  olvidarSilencio(): void {
    this.ultimoAviso.clear();
  }
}

/** Lo mínimo para que el HTML de Telegram no se rompa con un nombre raro. */
function escapar(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
