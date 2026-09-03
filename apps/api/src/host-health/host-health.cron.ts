/**
 * HostHealthCron — vigila el disco, la memoria y la carga del servidor.
 *
 * ## Por qué existe
 *
 * Es la falla más tonta y más letal de todas: **si el disco se llena, Postgres
 * deja de escribir y el casino se cae.** Y hasta hoy nada lo miraba —
 * `application.readAppMonitoring` de Dokploy devuelve vacío, así que del host no
 * teníamos ni un número. Ver `docs/26-monitoreo-diagnostico.md` §4.2.
 *
 * En el VPS conviven la base, las imágenes de Docker, los backups y los logs:
 * cuatro cosas que crecen solas, ninguna que avise.
 *
 * ## Qué mira
 *
 * Disco, memoria y carga. **El disco es el único que alerta**; los otros dos van
 * al log para tener histórico y poder mirar hacia atrás cuando algo estuvo
 * lento. Alertar por memoria alta daría ruido: Postgres y el sistema usan de
 * caché toda la RAM libre, y eso es sano, no un problema.
 *
 * ## Lo que NO garantiza
 *
 * ⚠️ Mide el filesystem del **contenedor de la API**, no el de Postgres — son
 * contenedores distintos. En un VPS único los dos escriben sobre el mismo disco
 * físico, así que el número es representativo. El día que la base se mueva a
 * otro host, este cron deja de decir nada útil sobre ella y hay que revisarlo.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { statfs } from 'node:fs/promises';
import { freemem, loadavg, totalmem } from 'node:os';
import { AlertsService } from '../alerts/alerts.service';
import { CronLockService } from '../cron-lock/cron-lock.service';

/** Cada 15 minutos. El disco no se llena de un segundo al otro. */
const DEFAULT_CRON = '*/15 * * * *';

/** Umbrales de uso de disco, en porcentaje. */
const DEFAULT_AVISO = 80;
const DEFAULT_CRITICO = 90;

/** Qué filesystem se mide. En el contenedor, la raíz. */
const RUTA = '/';

@Injectable()
export class HostHealthCron {
  private readonly logger = new Logger(HostHealthCron.name);
  private readonly enabled: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
    private readonly cronLock: CronLockService,
    private readonly alertas: AlertsService,
  ) {
    this.enabled = config.get<string>('HOST_HEALTH_ENABLED') !== 'false';
    if (!this.enabled) {
      this.logger.warn('HostHealthCron DESHABILITADO via HOST_HEALTH_ENABLED=false.');
      return;
    }
    this.registerCron();
  }

  private registerCron(): void {
    const cronExpr = this.config.get<string>('HOST_HEALTH_CRON') ?? DEFAULT_CRON;
    const job = new CronJob(cronExpr, () => {
      void this.cronLock
        .runExclusive('host-health', () => this.revisar())
        .catch((err) => {
          this.logger.error(`Cron host-health tiró: ${(err as Error).message}`);
        });
    });
    this.scheduler.addCronJob('host-health', job);
    job.start();
    this.logger.log(
      `HostHealthCron registrado schedule="${cronExpr}" ` +
        `aviso=${this.umbral('HOST_HEALTH_DISK_WARN', DEFAULT_AVISO)}% ` +
        `critico=${this.umbral('HOST_HEALTH_DISK_CRIT', DEFAULT_CRITICO)}%.`,
    );
  }

  private umbral(clave: string, porDefecto: number): number {
    const n = Number(this.config.get<string>(clave));
    return Number.isFinite(n) && n > 0 && n <= 100 ? n : porDefecto;
  }

  async revisar(): Promise<void> {
    const disco = await this.medirDisco();
    const memoria = this.medirMemoria();
    const carga = loadavg()[0] ?? 0;

    // Siempre al log: es el histórico que hoy no existe. Cuando algo estuvo
    // lento a las 3 AM, esto es lo único que va a poder mirarse hacia atrás.
    this.logger.log(
      `host: disco ${disco ? `${disco.usadoPct}% (${gb(disco.libre)} GB libres)` : 'n/d'} · ` +
        `memoria ${memoria.usadoPct}% · carga 1m ${carga.toFixed(2)}`,
    );

    if (!disco) return;

    const critico = this.umbral('HOST_HEALTH_DISK_CRIT', DEFAULT_CRITICO);
    const aviso = this.umbral('HOST_HEALTH_DISK_WARN', DEFAULT_AVISO);
    if (disco.usadoPct < aviso) return;

    const esCritico = disco.usadoPct >= critico;
    await this.alertas.enviar({
      // La clave no lleva el porcentaje: si lo llevara, cada punto que sube
      // sería una alerta nueva y no se silenciaría nunca.
      clave: 'disco-lleno',
      nivel: esCritico ? 'critico' : 'aviso',
      titulo: esCritico ? 'El disco del servidor se está llenando' : 'Disco del servidor alto',
      detalle: [
        `Uso: ${disco.usadoPct}% — quedan ${gb(disco.libre)} GB libres.`,
        '',
        esCritico
          ? 'Si se llena, la base de datos deja de escribir y el casino se cae.'
          : 'Todavía hay margen, pero conviene mirarlo.',
        '',
        'Lo que más ocupa suele ser: imágenes viejas de Docker (`docker system prune`),',
        'backups acumulados y logs de contenedores.',
      ].join('\n'),
      // Cuatro horas: si sigue subiendo conviene que vuelva a sonar, pero el
      // disco no se arregla solo en quince minutos.
      silencioMin: 240,
    });
  }

  /** Uso del filesystem. `null` si el sistema no lo reporta. */
  private async medirDisco(): Promise<{ usadoPct: number; libre: number } | null> {
    try {
      const s = await statfs(RUTA);
      const total = Number(s.blocks) * Number(s.bsize);
      // `bavail` es lo disponible para procesos sin privilegios — es el número
      // que importa. `bfree` incluye lo reservado para root y da un margen
      // optimista que no vamos a poder usar.
      const libre = Number(s.bavail) * Number(s.bsize);
      if (!Number.isFinite(total) || total <= 0) return null;
      return { usadoPct: Math.round(((total - libre) / total) * 100), libre };
    } catch (err) {
      this.logger.warn(`No se pudo medir el disco: ${(err as Error).message}`);
      return null;
    }
  }

  private medirMemoria(): { usadoPct: number } {
    const total = totalmem();
    const libre = freemem();
    if (total <= 0) return { usadoPct: 0 };
    return { usadoPct: Math.round(((total - libre) / total) * 100) };
  }
}

function gb(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}
