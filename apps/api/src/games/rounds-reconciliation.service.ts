/**
 * RoundsReconciliationService — cierra las rondas que el proveedor dejó
 * abiertas para siempre.
 *
 * ## El problema
 *
 * Gregmorn manda `round_finished: false` en cada callback de una ronda y, en
 * algunas, el `true` nunca llega: la ronda queda abierta indefinidamente. Caso
 * documentado (jugadora `maggie`, 2026-08-29): una compra de tiradas gratis con
 * 30 callbacks, ninguno final, seguía abierta 12 horas después.
 *
 * Duele en la contabilidad, no en el jugador: la apuesta se cobró y el premio
 * se pagó, todo eso ya vive en `wallet_transactions`. Pero la base de comisión
 * sólo cuenta rondas cerradas (LEYES C1/C4b), así que esa NetWin no se le paga
 * al operador — 4.172,05 ARS en el limbo al 2026-08-31, y por eso no se puede
 * liquidar agosto.
 *
 * **No se puede resolver preguntándoles**: su API no tiene ningún endpoint para
 * consultar el estado de una ronda (ver `docs/gregmorn/01-api-spec.md`).
 *
 * ## Por qué esto es menos riesgoso de lo que parece
 *
 * Cerrar una ronda **no mueve un peso**: sólo cambia `status` a `settled` y
 * pone `settled_at`, que es lo que la hace entrar en la base de comisión. Un
 * cierre equivocado se revierte cambiando el estado de vuelta, siempre que el
 * período no se haya liquidado todavía.
 *
 * Y si un callback llega tarde, el código de Gregmorn lo **acumula sobre la
 * ronda existente** y la vuelve a abrir. O sea: el sistema se autocorrige. Lo
 * único que hay que vigilar es liquidar un período que después cambie, y para
 * eso está `auto_settled_reason`: permite listar exactamente qué cerramos
 * nosotros antes de liquidar.
 *
 * ## Las reglas, de más a menos confianza
 *
 * 1. **`session_closed`** — la sesión se cerró bien (el jugador salió del juego
 *    y el front llamó al endpoint de cierre). Si la sesión terminó, sus rondas
 *    terminaron. **Cero suposiciones.**
 *
 * 2. **`later_settled_round`** — hay una ronda POSTERIOR en la misma sesión que
 *    el proveedor ya confirmó cerrada. Una sesión de slot juega una ronda por
 *    vez: si una posterior ya cerró, la anterior terminó seguro y simplemente
 *    no nos avisaron. **Cero suposiciones sobre tiempos** — es ordenamiento.
 *
 * 3. **`session_expired`** — la sesión no tiene actividad hace más de N. Cubre
 *    el caso real: el jugador abandonó y no volvió. Acá sí hay un parámetro,
 *    pero es "cuánta inactividad para dar una sesión por muerta", que es mucho
 *    más natural que adivinar cuánto tarda el proveedor en avisar.
 *
 * 4. **`stale_timeout`** — puro paso del tiempo, sin ninguna otra evidencia.
 *    **Apagada por defecto** (`ROUNDS_RECON_STALE_HOURS`). Es el último recurso
 *    que pidió el dueño: sirve para vaciar el limbo si las otras tres no
 *    alcanzan, pero es la única que puede cerrar una ronda que de verdad seguía
 *    viva.
 *
 * Todas son idempotentes: sólo tocan `status = 'placed'`, así que correr el job
 * dos veces no hace nada la segunda.
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
  byStaleTimeout: number;
  total: number;
  /**
   * NetWin que ENTRA a la base de comisión por este cierre, por regla y en
   * total. Es el dato que de verdad importa: la cantidad de rondas no dice
   * nada sobre cuánto se le va a pagar al operador.
   *
   * Positivo = ganó el jugador; negativo = ganó la Casa. Es `net_amount`
   * (win − bet), el mismo campo que usa el motor de comisiones.
   */
  net: {
    bySessionClosed: number;
    byLaterSettledRound: number;
    bySessionExpired: number;
    byStaleTimeout: number;
    total: number;
  };
}

export interface ReconciliationOptions {
  /** Inactividad para dar una sesión por muerta. Default 2h. */
  sessionIdleHours: number;
  /**
   * Horas para la regla de último recurso. `null` = apagada (el default).
   * Sólo se cierra por puro paso del tiempo si el dueño lo pide explícitamente.
   */
  staleHours: number | null;
}

export const DEFAULT_SESSION_IDLE_HOURS = 2;

@Injectable()
export class RoundsReconciliationService {
  private readonly logger = new Logger(RoundsReconciliationService.name);

  async runForTenant(
    db: TenantDb,
    opts: ReconciliationOptions,
  ): Promise<ReconciliationSummary> {
    const idle = `${horasValidas(opts.sessionIdleHours, DEFAULT_SESSION_IDLE_HOURS)} hours`;

    // ── Paso 1: expirar sesiones muertas ────────────────────────────────
    //
    // Hoy NADIE las expira: el estado `expired` existe en el modelo y no lo usa
    // nadie, así que una sesión que el jugador abandonó cerrando la pestaña
    // queda `active` para siempre. La actividad es el último `placed_at` de sus
    // rondas, o el `started_at` si nunca jugó.
    const expiradas = await db.execute(sql`
      UPDATE game_sessions s
         SET status = 'expired',
             ended_at = now()
       WHERE s.status = 'active'
         AND GREATEST(
               s.started_at,
               COALESCE((SELECT max(r.placed_at) FROM game_rounds r
                          WHERE r.session_id = s.id), s.started_at)
             ) < now() - ${sql.raw(`interval '${idle}'`)}
      RETURNING s.id
    `);

    // ── Paso 2: la sesión terminó (cerrada o expirada) ──────────────────
    const porSesion = await db.execute(sql`
      UPDATE game_rounds r
         SET status = 'settled',
             settled_at = now(),
             auto_settled_reason = CASE s.status
               WHEN 'closed' THEN 'session_closed'
               ELSE 'session_expired'
             END
        FROM game_sessions s
       WHERE s.id = r.session_id
         AND r.status = 'placed'
         AND s.status IN ('closed', 'expired')
      RETURNING r.id, r.auto_settled_reason AS motivo, r.net_amount AS neto
    `);

    // ── Paso 3: hay una ronda posterior YA CERRADA en la misma sesión ───
    //
    // Una sesión de slot juega una ronda por vez. Si una posterior ya cerró,
    // ésta terminó seguro. No se compara contra rondas abiertas a propósito:
    // dos abiertas no prueban nada sobre cuál terminó.
    const porPosterior = await db.execute(sql`
      UPDATE game_rounds r
         SET status = 'settled',
             settled_at = now(),
             auto_settled_reason = 'later_settled_round'
       WHERE r.status = 'placed'
         AND EXISTS (
               SELECT 1 FROM game_rounds p
                WHERE p.session_id = r.session_id
                  AND p.status = 'settled'
                  AND p.placed_at > r.placed_at
             )
      RETURNING r.id, r.net_amount AS neto
    `);

    // ── Paso 4: último recurso, sólo si el dueño lo prendió ─────────────
    let porTimeout: Fila[] = [];
    if (opts.staleHours !== null) {
      const horas = `${horasValidas(opts.staleHours, 48)} hours`;
      const r = await db.execute(sql`
        UPDATE game_rounds
           SET status = 'settled',
               settled_at = now(),
               auto_settled_reason = 'stale_timeout'
         WHERE status = 'placed'
           AND placed_at < now() - ${sql.raw(`interval '${horas}'`)}
        RETURNING id, net_amount AS neto
      `);
      porTimeout = filasDe(r);
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
      byStaleTimeout: porTimeout.length,
      total: 0,
      net: {
        bySessionClosed: sumaNeto(cerradas),
        bySessionExpired: sumaNeto(expiradasR),
        byLaterSettledRound: sumaNeto(posteriores),
        byStaleTimeout: sumaNeto(porTimeout),
        total: 0,
      },
    };
    resumen.total =
      resumen.bySessionClosed +
      resumen.bySessionExpired +
      resumen.byLaterSettledRound +
      resumen.byStaleTimeout;
    resumen.net.total = redondear(
      resumen.net.bySessionClosed +
        resumen.net.bySessionExpired +
        resumen.net.byLaterSettledRound +
        resumen.net.byStaleTimeout,
    );

    if (resumen.total > 0) {
      this.logger.log(
        `Rondas cerradas por reconciliación: ${resumen.total} ` +
          `(sesión cerrada ${resumen.bySessionClosed}, sesión expirada ` +
          `${resumen.bySessionExpired}, ronda posterior ` +
          `${resumen.byLaterSettledRound}, timeout ${resumen.byStaleTimeout}). ` +
          `Sesiones expiradas: ${resumen.sessionsExpired}. ` +
          `NetWin que entra a la base de comisión: ${resumen.net.total} ` +
          `(sesión cerrada ${resumen.net.bySessionClosed}, sesión expirada ` +
          `${resumen.net.bySessionExpired}, ronda posterior ` +
          `${resumen.net.byLaterSettledRound}, timeout ` +
          `${resumen.net.byStaleTimeout}).`,
      );
    }
    return resumen;
  }
}

/**
 * Las horas se interpolan crudas en el SQL (un `interval` no se puede
 * parametrizar), así que tienen que ser un entero sí o sí. Un `NaN` colado
 * generaría `interval 'NaN hours'` y reventaría la query.
 */
function horasValidas(valor: number, porDefecto: number): number {
  if (!Number.isFinite(valor)) return porDefecto;
  return Math.max(1, Math.floor(valor));
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
 * Suma los netos en CENTAVOS enteros y recién al final divide.
 *
 * Sumar los pesos como float acumula error: con 41 rondas ya se pueden ir
 * unos centavos, y este número se lee para decidir una liquidación.
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
