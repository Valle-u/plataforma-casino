/**
 * El cron que borra los adjuntos vencidos del chat (**D15**, roadmap **4.1**).
 *
 * ## Va APAGADO por default, al revés que los otros crons
 *
 * Los demás crons de retención de la plataforma se prenden salvo que alguien
 * los apague (`!== 'false'`). Éste al revés: hace falta poner
 * `CHAT_RETENCION_ENABLED=1` para que corra.
 *
 * No es simetría rota por descuido. Los otros borran **logs y filas de
 * historial**: si se prenden solos en un entorno donde nadie los esperaba, se
 * pierde telemetría. Éste borra **fotos de DNI y comprobantes que mandó gente
 * real**, sin vuelta atrás. Un proceso así no se prende porque el contenedor
 * arrancó: se prende porque alguien lo decidió.
 *
 * ## Y conviene correrlo en simulacro primero
 *
 * Con `CHAT_RETENCION_SIMULACRO=1` recorre todo, cuenta lo que borraría y **no
 * toca nada**. Es la forma de ver qué haría la primera corrida sobre un
 * historial de verdad antes de dejarla borrar.
 *
 * Sirve además para una cosa que el roadmap marca explícitamente: **el borrado
 * en R2 es nuevo** —antes sólo escribía un warning mientras los archivos se
 * acumulaban— así que este proceso se apoya en algo que conviene verificar, no
 * dar por hecho. En simulacro no se verifica el borrado; para eso está la
 * primera corrida real sobre un casino chico.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { eq } from 'drizzle-orm';
import { tenants, type ControlDb, type Tenant } from '@casino/db';
import { CONTROL_DB } from '../database/database.module';
import { TenantConnectionCache } from '../tenant-resolver/tenant-connection-cache';
import { CronLockService } from '../cron-lock/cron-lock.service';
import { RetencionDeAdjuntosService } from './retencion-de-adjuntos.service';

/** 4 AM UTC — después del parte diario, y lejos del pico de juego. */
const CRON_POR_DEFECTO = '0 4 * * *';

@Injectable()
export class RetencionDeAdjuntosCron {
  private readonly logger = new Logger(RetencionDeAdjuntosCron.name);
  private corriendo = false;

  constructor(
    private readonly config: ConfigService,
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly conexiones: TenantConnectionCache,
    private readonly retencion: RetencionDeAdjuntosService,
    private readonly scheduler: SchedulerRegistry,
    private readonly cronLock: CronLockService,
  ) {
    if (this.config.get<string>('CHAT_RETENCION_ENABLED') !== '1') {
      // Sin ruido: apagado es el estado normal hasta que alguien lo decida.
      return;
    }
    this.registrar();
  }

  private get simulacro(): boolean {
    return this.config.get<string>('CHAT_RETENCION_SIMULACRO') === '1';
  }

  private registrar(): void {
    const expr =
      this.config.get<string>('CHAT_RETENCION_CRON') ?? CRON_POR_DEFECTO;
    const job = new CronJob(expr, () => {
      void this.cronLock
        // El lock es por si hay más de una instancia de la API: dos corridas a
        // la vez pelearían por los mismos mensajes y contarían mal.
        .runExclusive('chat-retencion-adjuntos', () =>
          this.correrParaTodos().then(() => undefined),
        )
        .catch((err) => {
          this.logger.error(`La retención tiró: ${(err as Error).message}`);
        });
    });
    this.scheduler.addCronJob('chat-retencion-adjuntos', job);
    job.start();
    this.logger.log(
      `Retención de adjuntos registrada schedule="${expr}"` +
        `${this.simulacro ? ' · MODO SIMULACRO (no borra nada)' : ''}.`,
    );
  }

  async correrParaTodos(): Promise<void> {
    if (this.corriendo) {
      this.logger.warn('Retención saltada: la corrida anterior sigue activa.');
      return;
    }
    this.corriendo = true;
    const simulacro = this.simulacro;
    try {
      const activos: Tenant[] = await this.controlDb
        .select()
        .from(tenants)
        .where(eq(tenants.status, 'active'));

      for (const tenant of activos) {
        try {
          const res = await this.retencion.purgar(
            this.conexiones.get(tenant),
            { simulacro },
          );

          // Se loguea sólo si hubo algo que hacer: un renglón por casino por
          // día sin nada adentro es ruido que tapa el día que sí pasa algo.
          if (res.borrados > 0 || res.fallados > 0 || res.omitidos > 0) {
            this.logger.log(
              `Retención ${tenant.slug}${simulacro ? ' (simulacro)' : ''}: ` +
                `${res.borrados} adjuntos en ${res.mensajes} mensajes` +
                `${res.fallados > 0 ? `, ${res.fallados} fallaron` : ''}` +
                `${res.omitidos > 0 ? `, ${res.omitidos} OMITIDOS` : ''}.`,
            );
          }

          // Un omitido significa que había una clave que no es del chat adentro
          // de un mensaje. No se borró —el cinturón hizo su trabajo— pero es
          // algo que alguien tiene que mirar.
          if (res.omitidos > 0) {
            this.logger.error(
              `⚠️ ${tenant.slug}: ${res.omitidos} adjuntos con claves fuera de ` +
                `/chat/attachments/. No se borraron. Revisar de dónde salieron.`,
            );
          }
        } catch (err) {
          // Un casino que falla no puede dejar sin correr a los demás.
          this.logger.error(
            `Retención ${tenant.slug}: ${(err as Error).message}`,
          );
        }
      }
    } finally {
      this.corriendo = false;
    }
  }
}
