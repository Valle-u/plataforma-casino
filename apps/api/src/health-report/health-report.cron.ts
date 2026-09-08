/**
 * HealthReportCron — el parte diario del casino, por Telegram.
 *
 * ## Por qué existe
 *
 * Las alertas avisan cuando algo se rompe. Eso deja dos huecos:
 *
 * 1. **El silencio es ambiguo.** Un grupo sin mensajes puede significar "todo
 *    bien" o "el bot dejó de funcionar y nadie se enteró". El propio
 *    `AlertsService` lo advierte: *un canal de avisos falla en silencio*. Un
 *    parte que llega todos los días convierte el silencio en señal: si un día no
 *    llega, algo pasa.
 *
 * 2. **Nadie mira lo que no alerta.** Fichas en circulación, cuántos jugaron,
 *    cuántos pedidos quedaron pendientes: números que no justifican despertar a
 *    nadie pero que, mirados a diario, muestran una tendencia. Un retiro
 *    pendiente hace tres días no dispara ninguna alarma y sin embargo es un
 *    jugador esperando su plata.
 *
 * ## Qué NO es
 *
 * No es una alerta. Va con nivel `info` y sin silencio: es un informe agendado,
 * no un aviso de que algo anda mal. Si algo está mal, la alerta correspondiente
 * ya salió por su cuenta.
 *
 * ## Degrada solo
 *
 * Cada bloque va en su propio `try`. Si una consulta falla, ese renglón dice que
 * no se pudo leer y el resto del parte igual sale. Un informe incompleto sirve;
 * que no llegue ninguno, no.
 *
 * Env:
 *   HEALTH_REPORT_ENABLED  'false' lo apaga. Default: prendido.
 *   HEALTH_REPORT_CRON     default `0 12 * * *` — 12:00 UTC, las 9 de la mañana
 *                          en Argentina. Para leerlo con el café, no a las 3 de
 *                          la madrugada.
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
import type { TenantDb } from '../tenant-resolver/tenant-context';

/** 12:00 UTC = 9:00 en Argentina. */
const DEFAULT_CRON = '0 12 * * *';

/** Rondas mínimas para que la devolución del período signifique algo. */
const RONDAS_MINIMAS = 100;

@Injectable()
export class HealthReportCron {
  private readonly logger = new Logger(HealthReportCron.name);

  constructor(
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
    private readonly cronLock: CronLockService,
    private readonly alertas: AlertsService,
    private readonly connectionCache: TenantConnectionCache,
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
  ) {
    if (this.config.get<string>('HEALTH_REPORT_ENABLED') === 'false') {
      this.logger.warn(
        'HealthReportCron DESHABILITADO via HEALTH_REPORT_ENABLED=false.',
      );
      return;
    }
    this.registrar();
  }

  private registrar(): void {
    const expr = this.config.get<string>('HEALTH_REPORT_CRON') ?? DEFAULT_CRON;
    const job = new CronJob(expr, () => {
      void this.cronLock
        .runExclusive('health-report', async () => {
          await this.correr();
        })
        .catch((err) => {
          this.logger.error(
            `Cron health-report tiró: ${(err as Error).message}`,
          );
        });
    });
    this.scheduler.addCronJob('health-report', job);
    job.start();
    this.logger.log(`HealthReportCron registrado schedule="${expr}"`);
  }

  /** Arma y manda el parte. Público para dispararlo a mano desde un script. */
  async correr(): Promise<void> {
    const activos: Tenant[] = await this.controlDb
      .select()
      .from(tenants)
      .where(eq(tenants.status, 'active'));

    for (const tenant of activos) {
      try {
        const db = this.connectionCache.get(tenant);
        await this.alertas.enviar({
          clave: `parte-diario:${tenant.slug}`,
          nivel: 'info',
          titulo: `Parte diario · ${tenant.name}`,
          detalle: await this.parteDe(db, tenant.slug),
          // Sin silencio: es un informe agendado, no una alerta que se repite.
          silencioMin: 0,
        });
      } catch (err) {
        // Que un casino falle no puede dejar sin parte a los demás. Y el fallo
        // se avisa: un informe que deja de llegar en silencio es exactamente lo
        // que este cron vino a evitar.
        this.logger.error(
          `No se pudo armar el parte de ${tenant.slug}: ${(err as Error).message}`,
        );
        await this.alertas.enviar({
          clave: `parte-diario-fallo:${tenant.slug}`,
          nivel: 'aviso',
          titulo: 'No se pudo armar el parte diario',
          detalle: [
            `Casino: ${tenant.slug}`,
            '',
            'El informe de hoy no salió. No quiere decir que el casino esté mal:',
            'quiere decir que no se pudo leer para contarlo.',
            '',
            `Motivo: ${(err as Error).message}`,
          ].join('\n'),
          silencioMin: 60 * 6,
        });
      }
    }
  }

  /** El cuerpo del mensaje para un casino. */
  private async parteDe(db: TenantDb, slug: string): Promise<string> {
    const [juego, plata, colas, catalogo] = await Promise.all([
      this.bloque(() => this.actividadDeJuego(db)),
      this.bloque(() => this.fichas(db)),
      this.bloque(() => this.colas(db)),
      this.bloque(() => this.catalogo(db)),
    ]);

    return [
      `Casino: ${slug}`,
      '',
      'ÚLTIMAS 24 HORAS',
      juego,
      '',
      'PLATA',
      plata,
      '',
      'ESPERANDO RESPUESTA',
      colas,
      '',
      'CATÁLOGO',
      catalogo,
    ].join('\n');
  }

  /** Corre un bloque y, si falla, lo dice en vez de tumbar el parte entero. */
  private async bloque(fn: () => Promise<string>): Promise<string> {
    try {
      return await fn();
    } catch (err) {
      this.logger.warn(`Bloque del parte falló: ${(err as Error).message}`);
      return '  (no se pudo leer)';
    }
  }

  private async actividadDeJuego(db: TenantDb): Promise<string> {
    const res = await db.execute(sql`
      SELECT count(*)::text AS rondas,
             count(DISTINCT user_id)::text AS jugadores,
             COALESCE(sum(bet_amount), 0)::text AS apostado,
             COALESCE(sum(win_amount), 0)::text AS pagado
      FROM game_rounds
      WHERE placed_at > now() - interval '24 hours'
        AND status <> 'rolled_back'
    `);
    const f = primeraFila<{
      rondas: string;
      jugadores: string;
      apostado: string;
      pagado: string;
    }>(res);
    if (!f) return '  sin datos';

    const apostado = Number(f.apostado);
    const pagado = Number(f.pagado);
    const rondas = Number(f.rondas);

    if (rondas === 0) return '  nadie jugó';

    // La devolución del período sólo se muestra con muestra suficiente: con
    // pocas rondas un 300% es un premio grande, no una señal. Mismo criterio
    // que el flag de RTP del panel.
    const devolucion =
      rondas >= RONDAS_MINIMAS && apostado > 0
        ? ` · devolvió ${((pagado / apostado) * 100).toFixed(1)}%`
        : '';

    return [
      `  ${num(rondas)} rondas · ${num(f.jugadores)} jugadores`,
      `  apostado ${num(apostado)} · pagado ${num(pagado)}${devolucion}`,
      `  a favor del casino: ${num(apostado - pagado)}`,
    ].join('\n');
  }

  private async fichas(db: TenantDb): Promise<string> {
    const res = await db.execute(sql`
      SELECT
        COALESCE(sum(w.balance) FILTER (WHERE u.is_system = false), 0)::text AS circulacion,
        count(*) FILTER (WHERE u.is_system = false AND w.balance > 0)::text AS con_saldo,
        COALESCE(sum(w.balance) FILTER (WHERE u.is_system = true), 0)::text AS casa
      FROM wallets w
      JOIN users u ON u.id = w.user_id
    `);
    const f = primeraFila<{
      circulacion: string;
      con_saldo: string;
      casa: string;
    }>(res);
    if (!f) return '  sin datos';

    return [
      `  en circulación: ${num(f.circulacion)} (${num(f.con_saldo)} cuentas con saldo)`,
      `  tesorería: ${num(f.casa)}`,
    ].join('\n');
  }

  /**
   * Lo que está esperando a una persona.
   *
   * Es el bloque que más justifica el parte: un retiro pendiente no dispara
   * ninguna alerta y sin embargo es un jugador esperando su plata.
   */
  private async colas(db: TenantDb): Promise<string> {
    const res = await db.execute(sql`
      SELECT
        (SELECT count(*) FROM deposits WHERE status = 'pending')::text AS dep,
        (SELECT count(*) FROM deposits
          WHERE status = 'pending' AND created_at < now() - interval '24 hours')::text AS dep_viejo,
        (SELECT count(*) FROM withdrawals WHERE status = 'pending')::text AS ret,
        (SELECT count(*) FROM withdrawals
          WHERE status = 'pending' AND created_at < now() - interval '24 hours')::text AS ret_viejo
    `);
    const f = primeraFila<{
      dep: string;
      dep_viejo: string;
      ret: string;
      ret_viejo: string;
    }>(res);
    if (!f) return '  sin datos';

    return [
      linaDeCola('depósitos', f.dep, f.dep_viejo),
      linaDeCola('retiros', f.ret, f.ret_viejo),
    ].join('\n');
  }

  private async catalogo(db: TenantDb): Promise<string> {
    const res = await db.execute(sql`
      SELECT
        (SELECT count(*) FROM games
          WHERE is_active AND NOT is_hidden AND NOT is_disabled)::text AS activos,
        (SELECT count(*) FROM game_providers
          WHERE is_enabled = false OR maintenance_mode = true)::text AS apagados
    `);
    const f = primeraFila<{ activos: string; apagados: string }>(res);
    if (!f) return '  sin datos';

    const apagados = Number(f.apagados);
    return [
      `  ${num(f.activos)} juegos disponibles`,
      apagados > 0
        ? `  ${apagados} proveedor${apagados === 1 ? '' : 'es'} apagado${apagados === 1 ? '' : 's'} o en mantenimiento`
        : '  todos los proveedores operativos',
    ].join('\n');
  }
}

/** Un renglón de la cola, marcando lo que lleva más de un día esperando. */
function linaDeCola(etiqueta: string, total: string, viejos: string): string {
  const n = Number(total);
  if (!n) return `  ${etiqueta}: ninguno`;
  const v = Number(viejos);
  return `  ${etiqueta}: ${n}${v > 0 ? ` (${v} con más de 24 h ⚠️)` : ''}`;
}

/**
 * La primera fila de un `db.execute`, venga como venga.
 *
 * ⚠️ **El driver devuelve dos formas distintas** según el caso: a veces un array
 * de filas, a veces `{ rows: [...] }`. El resto del repo ya lo maneja así
 * (`bank-transactions.service.ts`, `games-health.cron.ts`), y acá importa
 * especialmente porque este código corre **una vez por día**: asumir la forma
 * equivocada haría que el parte saliera vacío todas las mañanas —cada bloque
 * diciendo "sin datos"— y eso se lee igual que un casino sin actividad.
 */
function primeraFila<T>(res: unknown): T | undefined {
  const conRows = (res as { rows?: T[] }).rows;
  if (Array.isArray(conRows)) return conRows[0];
  return Array.isArray(res) ? (res as T[])[0] : undefined;
}

/** Números legibles para alguien que no programa: 1.234.567,89 */
function num(v: string | number): string {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('es-AR', { maximumFractionDigits: 2 });
}
