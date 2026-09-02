/**
 * GamesHealthCron — detecta que los jugadores no pueden jugar.
 *
 * ## Por qué existe
 *
 * El 2026-09-01 los juegos dejaron de aceptar apuestas durante horas. La causa
 * resultó ser que se había agotado el saldo de nuestra cuenta en el panel del
 * proveedor: los juegos abrían, nos pedían el saldo, se lo dábamos bien, y
 * nunca mandaban la apuesta.
 *
 * Nada de eso genera un error. Nuestra API contestó **93 callbacks con HTTP
 * 200 y ni un 4xx en todo el día**, así que Sentry no tenía nada que reportar y
 * el monitor de uptime veía la plataforma perfecta. **Se descubrió porque un
 * jugador se quejó, 18 horas después.**
 *
 * ## Qué mira
 *
 * La firma del problema es simple y no depende de la causa: **hubo aperturas de
 * juego y ninguna apuesta**. Sirve igual si se agotó el saldo, si el proveedor
 * se cayó, o si rompimos el launch nosotros.
 *
 * Se evalúa por proveedor: si Gregmorn está muerto pero Palace anda, el total
 * de apuestas no da cero y el problema pasaría desapercibido.
 *
 * ## Por qué el umbral
 *
 * Una apertura sin apuesta es normal — el jugador mira el juego y lo cierra.
 * Varias seguidas, ninguna con apuesta, ya no.
 *
 * El umbral no se eligió a ojo: se replicó el detector sobre todo el 01/09 en
 * ventanas de 30 minutos. Con 5 aperturas habría avisado a las 17:30 y a las
 * 18:30 UTC —o sea, unos 40 minutos después de empezar el problema en vez de
 * las 18 horas que tardó— y **no habría disparado ni una vez de más** en las
 * ventanas sanas del mismo día.
 *
 * ⚠️ Lo que NO agarra: un apagón parcial. El incidente de la mañana del 01/09
 * tuvo 6 aperturas y 1 apuesta en media hora, y como se exige CERO apuestas, no
 * habría sonado. Cambiarlo por un ratio (por ejemplo, menos del 20% de las
 * aperturas con apuesta) lo cubriría, pero con pocos jugadores un ratio hace
 * ruido. Vale recalibrarlo cuando haya tráfico real que mirar.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { eq, sql } from 'drizzle-orm';
import { tenants, type ControlDb, type Tenant } from '@casino/db';
import { AlertsService } from '../alerts/alerts.service';
import { CONTROL_DB } from '../database/database.module';
import { CronLockService } from '../cron-lock/cron-lock.service';
import { TenantConnectionCache } from '../tenant-resolver/tenant-connection-cache';

/** Cada 10 minutos. */
const DEFAULT_CRON = '*/10 * * * *';
const DEFAULT_VENTANA_MIN = 30;
const DEFAULT_MIN_APERTURAS = 5;

interface FilaProveedor {
  provider_code: string;
  aperturas: number;
  apuestas: number;
}

@Injectable()
export class GamesHealthCron {
  private readonly logger = new Logger(GamesHealthCron.name);
  private running = false;
  private readonly enabled: boolean;

  constructor(
    private readonly config: ConfigService,
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly connectionCache: TenantConnectionCache,
    private readonly scheduler: SchedulerRegistry,
    private readonly cronLock: CronLockService,
    private readonly alertas: AlertsService,
  ) {
    this.enabled = config.get<string>('GAMES_HEALTH_ENABLED') !== 'false';
    if (!this.enabled) {
      this.logger.warn(
        'GamesHealthCron DESHABILITADO via GAMES_HEALTH_ENABLED=false.',
      );
      return;
    }
    this.registerCron();
  }

  private registerCron(): void {
    const cronExpr = this.config.get<string>('GAMES_HEALTH_CRON') ?? DEFAULT_CRON;
    const job = new CronJob(cronExpr, () => {
      void this.cronLock
        .runExclusive('games-health', () =>
          this.runForAllTenants().then(() => undefined),
        )
        .catch((err) => {
          this.logger.error(`Cron games-health tiró: ${(err as Error).message}`);
        });
    });
    this.scheduler.addCronJob('games-health', job);
    job.start();

    this.logger.log(
      `GamesHealthCron registrado schedule="${cronExpr}" ` +
        `ventana=${this.ventanaMin()}min minAperturas=${this.minAperturas()}.`,
    );
  }

  private ventanaMin(): number {
    return this.numero('GAMES_HEALTH_WINDOW_MIN', DEFAULT_VENTANA_MIN);
  }

  private minAperturas(): number {
    return this.numero('GAMES_HEALTH_MIN_LAUNCHES', DEFAULT_MIN_APERTURAS);
  }

  private numero(clave: string, porDefecto: number): number {
    const n = Number(this.config.get<string>(clave));
    return Number.isFinite(n) && n > 0 ? n : porDefecto;
  }

  async runForAllTenants(): Promise<void> {
    if (this.running) {
      this.logger.warn('games-health saltado: run previo todavía activo.');
      return;
    }
    this.running = true;
    try {
      const activos: Tenant[] = await this.controlDb
        .select()
        .from(tenants)
        .where(eq(tenants.status, 'active'));

      for (const tenant of activos) {
        try {
          await this.revisarTenant(tenant);
        } catch (err) {
          // Un tenant roto no frena a los demás, pero tampoco se traga el error:
          // este cron ES el que avisa, así que si falla en silencio volvemos al
          // punto de partida.
          this.logger.error(
            `games-health falló para ${tenant.slug}: ${(err as Error).message}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async revisarTenant(tenant: Tenant): Promise<void> {
    const db = this.connectionCache.get(tenant);
    const ventana = this.ventanaMin();
    const minimo = this.minAperturas();

    // Aperturas y apuestas de la misma ventana, agrupadas por proveedor.
    //
    // Los dos conteos van por separado a propósito. Con un LEFT JOIN de
    // sesiones a rondas sólo se contarían las apuestas de los juegos ABIERTOS
    // en la ventana, y bastaría con que alguien siguiera jugando en un juego
    // que abrió antes para que el detector dijera "nadie puede jugar" mientras
    // se está jugando. Una alerta que miente una vez ya no se lee más.
    //
    // Las apuestas se cuentan por la ronda y no por la sesión: una sesión con
    // rondas viejas no dice nada sobre si AHORA se puede jugar.
    const res = await db.execute(sql`
      WITH aperturas AS (
        SELECT g.provider_code, count(*) AS n
          FROM game_sessions s
          JOIN games g ON g.id = s.game_id
         WHERE s.started_at > now() - (${ventana} || ' minutes')::interval
         GROUP BY g.provider_code
      ), apuestas AS (
        SELECT g.provider_code, count(*) AS n
          FROM game_rounds r
          JOIN games g ON g.id = r.game_id
         WHERE r.placed_at > now() - (${ventana} || ' minutes')::interval
         GROUP BY g.provider_code
      )
      SELECT ap.provider_code,
             ap.n AS aperturas,
             COALESCE(bt.n, 0) AS apuestas
        FROM aperturas ap
        LEFT JOIN apuestas bt ON bt.provider_code = ap.provider_code
    `);

    const filas = (Array.isArray(res) ? res : ((res as { rows?: unknown }).rows ?? [])) as FilaProveedor[];

    for (const f of filas) {
      const aperturas = Number(f.aperturas);
      const apuestas = Number(f.apuestas);
      if (aperturas < minimo || apuestas > 0) continue;

      this.logger.warn(
        `Los jugadores no pueden jugar: tenant=${tenant.slug} ` +
          `proveedor=${f.provider_code} aperturas=${aperturas} apuestas=0 ` +
          `en los últimos ${ventana} minutos.`,
      );

      await this.alertas.enviar({
        clave: `sin-apuestas:${tenant.slug}:${f.provider_code}`,
        nivel: 'critico',
        // Sin jerga: lo primero que se lee tiene que ser el impacto, no la métrica.
        titulo: 'Los jugadores no pueden jugar',
        detalle: [
          `Casino: ${tenant.slug}`,
          `Proveedor: ${f.provider_code}`,
          `En los últimos ${ventana} minutos: ${aperturas} aperturas de juego y NINGUNA apuesta.`,
          '',
          'Los juegos abren pero no aceptan jugadas.',
          '',
          'Lo primero a revisar es el saldo de nuestra cuenta en el panel del',
          'proveedor: cuando se agota, pasa exactamente esto y del lado nuestro',
          'no aparece ningún error.',
        ].join('\n'),
        // Una hora: si el problema sigue, conviene que vuelva a sonar, pero no
        // cada diez minutos.
        silencioMin: 60,
      });
    }
  }
}
