/**
 * RoundsReconciliationService — red de seguridad para rondas que el proveedor
 * nunca resolvió.
 *
 * ## Lo que el proveedor confirmó (2026-08-31)
 *
 * Una ronda abierta **no está rota**: está esperando. Si el jugador abandona a
 * mitad de un bonus, Gregmorn **retiene la sesión de su lado hasta que vuelva**.
 * Cuánto la retienen depende del proveedor del juego: **de un día a una semana**,
 * sin un timeout único. Si se vence la retención sin que el jugador vuelva, la
 * ronda **se cancela y se emite un reembolso**.
 *
 * O sea que toda ronda termina resolviéndose sola, por una de dos vías:
 *
 *   1. El jugador vuelve → llega el `round_finished: true` y se cierra normal.
 *   2. No vuelve → llega un `rollback` y `GregmornCallbackService` la marca
 *      `rolled_back`, que el motor de comisiones EXCLUYE. Correcto sin que
 *      hagamos nada.
 *
 * También confirmaron que **no existe endpoint para consultar el estado de una
 * ronda**: `round_finished` es el único marcador. No es un hueco nuestro.
 *
 * ## Por qué este job casi no tiene que hacer nada
 *
 * La primera versión cerraba las rondas a las **2 horas** de inactividad, y eso
 * estaba mal: cerraba rondas que todavía podían resolverse, y una ronda cerrada
 * entra a la base de comisión. Si esa ronda terminaba REEMBOLSADA, se le pagaba
 * comisión al operador sobre plata que se le devolvió al jugador.
 *
 * Peor: dejaba inútil el freno de `settlePeriods` (que aborta si el período
 * tiene rondas abiertas). El freno nunca se disparaba porque este job ya las
 * había cerrado — justo las que todavía podían revertirse.
 *
 * Ahora **nada se cierra antes de `MIN_AGE_DAYS`** (10 días por defecto, por
 * encima del máximo de una semana que declararon). Por debajo de eso el sistema
 * espera, que es lo correcto, y el freno de liquidación hace su trabajo.
 *
 * Cerrar una ronda pasa a ser **la excepción**: significa que el proveedor no la
 * resolvió ni por la vía 1 ni por la vía 2 en diez días. Por eso cada cierre se
 * loguea como WARNING, no como info.
 *
 * ## Las reglas
 *
 * Todas exigen primero que la ronda supere `MIN_AGE_DAYS`. La regla sólo define
 * QUÉ evidencia adicional hay y queda registrada en `auto_settled_reason`.
 *
 * **Corren en este orden, de evidencia más fuerte a más débil**, para que una
 * ronda quede marcada con la mejor razón que la explica:
 *
 * 1. **`later_settled_round`** — hay una ronda POSTERIOR en la misma sesión que
 *    EL PROVEEDOR ya confirmó cerrada. Una sesión juega una ronda por vez, así
 *    que ésta terminó seguro. Es la más fuerte porque se apoya en un dato de
 *    ellos, no nuestro.
 * 2. **`session_closed`** — nuestra sesión se cerró bien desde el front.
 * 3. **`session_expired`** — nuestra sesión quedó sin actividad.
 * 4. **`no_evidence`** — sólo la antigüedad. **Apagada por defecto**
 *    (`ROUNDS_RECON_CLOSE_WITHOUT_EVIDENCE=true` para prenderla).
 *
 * Ojo con 2 y 3: que NUESTRA sesión termine no cancela el bonus que ELLOS
 * retienen. Por eso ninguna de las dos alcanza sola — el que manda es el umbral
 * de antigüedad.
 *
 * Todas son idempotentes: sólo tocan `status = 'placed'`.
 *
 * ## En qué período cae la ronda
 *
 * `settled_at` se pone en el **`placed_at` de la ronda**, no en `now()`, porque
 * el NetWin y la comisión atribuyen por `settled_at`. Con `now()`, una ronda
 * jugada en agosto y cerrada en septiembre contaba para septiembre: agosto
 * quedaba corto para siempre. Además `settled_at` ordena el ticker de
 * ganadores, así que con `now()` un premio viejo saltaba al tope como recién
 * ganado.
 */

import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { TenantDb } from '../tenant-resolver/tenant-context';

/** Cuántas rondas cerró cada regla en una corrida, y por cuánta plata. */
export interface ReconciliationSummary {
  sessionsExpired: number;
  bySessionClosed: number;
  byLaterSettledRound: number;
  bySessionExpired: number;
  byNoEvidence: number;
  total: number;
  /**
   * NetWin que ENTRA a la base de comisión por este cierre. Es el dato que
   * importa: la cantidad de rondas no dice nada sobre cuánto se le va a pagar
   * al operador. Es `net_amount` (win − bet), el mismo campo que usa el motor.
   */
  net: {
    bySessionClosed: number;
    byLaterSettledRound: number;
    bySessionExpired: number;
    byNoEvidence: number;
    total: number;
  };
}

export interface ReconciliationOptions {
  /**
   * Antigüedad mínima para que una ronda sea candidata. **Es la protección
   * principal**: por debajo de esto el proveedor todavía puede resolverla.
   */
  minAgeDays: number;
  /** Inactividad para dar por muerta NUESTRA sesión. Sólo higiene de datos. */
  sessionIdleHours: number;
  /** Cerrar por sola antigüedad, sin ninguna otra evidencia. Default: no. */
  closeWithoutEvidence: boolean;
}

/**
 * 10 días: por encima del máximo de UNA SEMANA que declaró el proveedor para la
 * retención de una sesión abandonada. El margen es a propósito — dijeron que
 * depende del proveedor del juego y que no hay un timeout único, así que el
 * número no es exacto y conviene errar por esperar de más.
 */
export const DEFAULT_MIN_AGE_DAYS = 10;

/** Sólo higiene: marcar `expired` nuestras sesiones abandonadas. */
export const DEFAULT_SESSION_IDLE_HOURS = 2;

@Injectable()
export class RoundsReconciliationService {
  private readonly logger = new Logger(RoundsReconciliationService.name);

  async runForTenant(
    db: TenantDb,
    opts: ReconciliationOptions,
  ): Promise<ReconciliationSummary> {
    const idle = intervalo(opts.sessionIdleHours, DEFAULT_SESSION_IDLE_HOURS, 'hours');
    const minAge = intervalo(opts.minAgeDays, DEFAULT_MIN_AGE_DAYS, 'days');

    // ── Higiene: expirar NUESTRAS sesiones abandonadas ──────────────────
    //
    // Independiente del cierre de rondas: esto sólo ordena nuestros datos
    // (nadie las expiraba, el estado `expired` existía sin usarse). NO implica
    // que la ronda del proveedor haya terminado — ellos retienen la suya aparte.
    //
    // Seguro de hacer: el callback busca la sesión por (user, game, key) SIN
    // filtrar por estado, así que si el jugador vuelve se reutiliza la misma.
    const expiradas = await db.execute(sql`
      UPDATE game_sessions s
         SET status = 'expired', ended_at = now()
       WHERE s.status = 'active'
         AND GREATEST(
               s.started_at,
               COALESCE((SELECT max(r.placed_at) FROM game_rounds r
                          WHERE r.session_id = s.id), s.started_at)
             ) < now() - ${sql.raw(idle)}
      RETURNING s.id
    `);

    // ── Cierre: SIEMPRE con el filtro de antigüedad ─────────────────────
    const viejaYAbierta = sql.raw(
      `r.status = 'placed' AND r.placed_at < now() - ${minAge}`,
    );

    // Evidencia 2: hay una ronda posterior que el proveedor ya cerró.
    const porPosterior = await db.execute(sql`
      UPDATE game_rounds r
         SET status = 'settled',
             settled_at = r.placed_at,
             auto_settled_reason = 'later_settled_round'
       WHERE ${viejaYAbierta}
         AND EXISTS (
               SELECT 1 FROM game_rounds p
                WHERE p.session_id = r.session_id
                  AND p.status = 'settled'
                  AND p.placed_at > r.placed_at
             )
      RETURNING r.id, r.net_amount AS neto
    `);

    // Evidencia 1 y 3: nuestra sesión terminó.
    const porSesion = await db.execute(sql`
      UPDATE game_rounds r
         SET status = 'settled',
             settled_at = r.placed_at,
             auto_settled_reason = CASE s.status
               WHEN 'closed' THEN 'session_closed'
               ELSE 'session_expired'
             END
        FROM game_sessions s
       WHERE s.id = r.session_id
         AND ${viejaYAbierta}
         AND s.status IN ('closed', 'expired')
      RETURNING r.id, r.auto_settled_reason AS motivo, r.net_amount AS neto
    `);

    // Sin ninguna evidencia más que el tiempo. Apagado por defecto.
    let sinEvidencia: Fila[] = [];
    if (opts.closeWithoutEvidence) {
      const res = await db.execute(sql`
        UPDATE game_rounds r
           SET status = 'settled',
               settled_at = r.placed_at,
               auto_settled_reason = 'no_evidence'
         WHERE ${viejaYAbierta}
        RETURNING r.id, r.net_amount AS neto
      `);
      sinEvidencia = filasDe(res);
    }

    const motivos = filasDe(porSesion);
    const cerradas = motivos.filter((m) => m.motivo === 'session_closed');
    const expiradasR = motivos.filter((m) => m.motivo === 'session_expired');
    const posteriores = filasDe(porPosterior);

    const resumen: ReconciliationSummary = {
      sessionsExpired: filasDe(expiradas).length,
      bySessionClosed: cerradas.length,
      bySessionExpired: expiradasR.length,
      byLaterSettledRound: posteriores.length,
      byNoEvidence: sinEvidencia.length,
      total: 0,
      net: {
        bySessionClosed: sumaNeto(cerradas),
        bySessionExpired: sumaNeto(expiradasR),
        byLaterSettledRound: sumaNeto(posteriores),
        byNoEvidence: sumaNeto(sinEvidencia),
        total: 0,
      },
    };
    resumen.total =
      resumen.bySessionClosed +
      resumen.bySessionExpired +
      resumen.byLaterSettledRound +
      resumen.byNoEvidence;
    resumen.net.total = redondear(
      resumen.net.bySessionClosed +
        resumen.net.bySessionExpired +
        resumen.net.byLaterSettledRound +
        resumen.net.byNoEvidence,
    );

    // WARNING y no LOG: con el umbral de antigüedad, cerrar una ronda significa
    // que el proveedor no la resolvió NI cerrándola NI reembolsándola en
    // `minAgeDays`. Eso es una anomalía de su lado, no rutina.
    if (resumen.total > 0) {
      this.logger.warn(
        `Se cerraron ${resumen.total} ronda(s) que el proveedor no resolvió en ` +
          `${opts.minAgeDays} días (sesión cerrada ${resumen.bySessionClosed}, ` +
          `sesión expirada ${resumen.bySessionExpired}, ronda posterior ` +
          `${resumen.byLaterSettledRound}, sin evidencia ${resumen.byNoEvidence}). ` +
          `NetWin que entra a la base de comisión: ${resumen.net.total}. ` +
          `Revisar con el proveedor: deberían haberse cerrado o reembolsado solas.`,
      );
    }
    if (resumen.sessionsExpired > 0) {
      this.logger.log(
        `Sesiones propias marcadas como expiradas: ${resumen.sessionsExpired}.`,
      );
    }
    return resumen;
  }
}

/** Fila del RETURNING: el motivo (si la query lo trae) y el neto. */
interface Fila {
  motivo?: string;
  neto?: string | number | null;
}

/** postgres-js devuelve las filas del RETURNING como array. */
function filasDe(res: unknown): Fila[] {
  if (Array.isArray(res)) return res as Fila[];
  const rows = (res as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as Fila[]) : [];
}

/**
 * Los intervalos no se pueden parametrizar, así que se interpolan crudos: el
 * valor tiene que ser un entero sí o sí. Un `NaN` colado generaría
 * `interval 'NaN days'` y reventaría la query.
 */
function intervalo(valor: number, porDefecto: number, unidad: string): string {
  const n = Number.isFinite(valor) && valor > 0 ? Math.floor(valor) : porDefecto;
  return `interval '${n} ${unidad}'`;
}

/**
 * Suma los netos en CENTAVOS enteros y recién al final divide. Sumar los pesos
 * como float acumula error, y este número se lee para decidir una liquidación.
 * Postgres devuelve `numeric` como string, así que además hay que convertir.
 */
function sumaNeto(filas: Fila[]): number {
  const centavos = filas.reduce((acc, f) => {
    const n = Number(f.neto ?? 0);
    return acc + (Number.isFinite(n) ? Math.round(n * 100) : 0);
  }, 0);
  return centavos / 100;
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}
