/**
 * AlertsService — avisos operativos por Telegram.
 *
 * ## Para qué
 *
 * Sentry es para errores de código: sirve para el que va a leer un stack trace.
 * Esto es otra cosa: avisar **que algo le está pasando al casino**, en castellano,
 * a un grupo donde puede haber gente que no programa.
 *
 * Los tres casos que se decidieron alertar (2026-09-02):
 *
 *   1. Los jugadores no pueden jugar.
 *   2. La plataforma está caída — **esta NO sale de acá**: si la API está muerta
 *      no puede avisar que está muerta. La manda un servicio afuera del VPS.
 *   3. Plata en riesgo: rondas trabadas, el cron cerrando en masa, o fallando.
 *
 * ## Reglas que se respetan sí o sí
 *
 * - **Nunca tira una excepción.** Un aviso que no se pudo mandar no puede tumbar
 *   una apuesta. Si Telegram no contesta, se loguea y se sigue.
 * - **No spamea.** Una alerta repetida cada 30 segundos se ignora sola a los dos
 *   días. Hay una ventana de silencio por clave.
 * - **Sin token queda apagado** y no molesta en desarrollo.
 *
 * ⚠️ La memoria de deduplicación es del proceso. Con una sola réplica de la API
 * alcanza; el día que haya más de una, cada réplica va a poder mandar su copia y
 * hay que mover esto a Redis.
 */

import { Injectable, Logger } from '@nestjs/common';

/** Cuánto se calla una alerta ya mandada, por clave. */
const SILENCIO_POR_DEFECTO_MIN = 30;

/** Marca visual del nivel. Se lee de un vistazo en el celular. */
const ICONO = {
  critico: '🔴',
  aviso: '🟠',
  info: '🔵',
} as const;

export type NivelAlerta = keyof typeof ICONO;

export interface Alerta {
  /**
   * Identifica el TIPO de alerta, no el evento puntual. Es lo que se usa para
   * no repetir: `rondas-trabadas`, `jugadores-no-pueden-jugar`. No meterle
   * números adentro o cada aviso sería uno nuevo y no se silenciaría nunca.
   */
  clave: string;
  nivel: NivelAlerta;
  titulo: string;
  /** Qué pasó y qué mirar, en castellano. Lo puede leer alguien no técnico. */
  detalle: string;
  /** Minutos de silencio para esta clave. Default 30. */
  silencioMin?: number;
}

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  private readonly ultimoEnvio = new Map<string, number>();

  private get token(): string | undefined {
    return process.env.TELEGRAM_BOT_TOKEN?.trim() || undefined;
  }

  private get chatId(): string | undefined {
    return process.env.TELEGRAM_ALERT_CHAT_ID?.trim() || undefined;
  }

  /** ¿Está configurado? Sirve para no armar el mensaje al pedo. */
  get habilitado(): boolean {
    return Boolean(this.token && this.chatId);
  }

  /**
   * Manda la alerta. No espera a que llegue para devolver: el llamador nunca
   * debería quedar bloqueado por un aviso.
   */
  async enviar(a: Alerta): Promise<void> {
    const ahora = Date.now();
    const silencio = (a.silencioMin ?? SILENCIO_POR_DEFECTO_MIN) * 60_000;
    const previo = this.ultimoEnvio.get(a.clave);
    if (previo && ahora - previo < silencio) return;

    if (!this.habilitado) {
      this.logger.warn(
        `[alerta ${a.nivel}] ${a.titulo} — ${a.detalle} ` +
          '(Telegram no configurado: falta TELEGRAM_BOT_TOKEN o TELEGRAM_ALERT_CHAT_ID)',
      );
      return;
    }

    // Se marca ANTES de mandar: si Telegram está caído no queremos reintentar
    // en loop contra un servicio que no responde.
    this.ultimoEnvio.set(a.clave, ahora);

    const texto = [
      `${ICONO[a.nivel]} <b>${escapar(a.titulo)}</b>`,
      '',
      escapar(a.detalle),
    ].join('\n');

    try {
      const r = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: texto,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) {
        const cuerpo = await r.text().catch(() => '');
        this.logger.warn(
          `Telegram rechazó la alerta \`${a.clave}\`: HTTP ${r.status} ${cuerpo.slice(0, 200)}`,
        );
      }
    } catch (err) {
      // Sin re-lanzar: ver la cabecera del archivo.
      this.logger.warn(
        `No se pudo mandar la alerta \`${a.clave}\`: ${(err as Error).message}`,
      );
    }
  }
}

/** Telegram interpreta HTML, así que estos tres caracteres hay que escaparlos. */
function escapar(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
