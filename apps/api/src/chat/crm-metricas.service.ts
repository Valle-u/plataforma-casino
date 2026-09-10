/**
 * CrmMetricasService — cómo se está atendiendo, medido sobre **tramos**.
 *
 * ## Por qué no se mide sobre la conversación
 *
 * Por **D11** el hilo es eterno: el que escribió en marzo y vuelve en
 * septiembre es la misma conversación. Sobre esa unidad, las métricas obvias no
 * significan nada — "340 conversaciones abiertas" son todos los que alguna vez
 * escribieron, y un "tiempo de respuesta promedio" se calcula sobre hilos que
 * duran años. **Medir la conversación es medir la antigüedad del cliente.**
 *
 * El tramo (migración `0115`) va desde que alguien escribe estando la
 * conversación resuelta hasta que se vuelve a marcar resuelta. Un hilo eterno
 * son muchos tramos cortos, y cada uno se mide solo.
 *
 * ## Mediana, no promedio
 *
 * Un solo caso de tres días arrastra el promedio y esconde que el resto anduvo
 * bien. La mediana dice cómo se atendió a la mitad de la gente, que es la
 * pregunta que importa.
 *
 * ## Lo que este servicio NO hace, a propósito
 *
 * - **Ranking de operadores.** Convierte la atención en una carrera, y el que
 *   cierra rápido no es el que atiende mejor.
 * - **Cualquier cosa que cruce redes** (**R6**). Todo lo de acá está acotado a
 *   la bandeja de quien pregunta; un tablero "todos los operadores" es
 *   exactamente lo que la ley prohíbe.
 * - **Nada sobre el contenido** de los mensajes. Palabras más usadas o análisis
 *   de sentimiento es leer conversaciones con otro nombre.
 *
 * Está todo escrito en `docs/crm/10-metricas.md`.
 */

import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { TenantDb } from '../tenant-resolver/tenant-context';

/** Las ventanas que la pantalla ofrece. Cerrada: entra en un `interval`. */
export const VENTANAS = [7, 30] as const;
export type Ventana = (typeof VENTANAS)[number];

export interface SinResponder {
  /** Tramos abiertos en los que **nadie contestó todavía**. */
  total: number;
  /** De ésos, los que llevan más de 24 horas esperando. */
  viejos: number;
  /** Cuándo empezó el que más espera. `null` si no hay ninguno. */
  masViejo: string | null;
}

export interface MetricasDeAtencion {
  /**
   * La única imprescindible: quién está esperando **ahora**. No depende de la
   * ventana — es el estado del momento, no un histórico.
   */
  sinResponder: SinResponder;
  ventana: Ventana;
  /** Tramos que **empezaron** dentro de la ventana. */
  tramos: number;
  /** De ésos, cuántos ya tuvieron una respuesta. */
  respondidos: number;
  /** De ésos, cuántos ya se marcaron resueltos. */
  resueltos: number;
  /** Mediana de la espera hasta la primera respuesta, en segundos. */
  medianaRespuesta: number | null;
  /** Mediana de lo que tardó en resolverse, en segundos. */
  medianaResolucion: number | null;
  /** Mensajes que entraron por cada canal en la ventana. */
  porCanal: Array<{ canal: string; total: number }>;
  /**
   * El tramo más viejo de esta bandeja: **desde cuándo hay algo medido**.
   *
   * ⚠️ La medición arrancó con la migración `0115` y **no hay backfill**: lo
   * anterior no existe y no se puede inventar. Sin este dato a la vista, una
   * ventana de 30 días recién instalada parecería un mes flojo en vez de un mes
   * que no se midió.
   */
  midiendoDesde: string | null;
}

@Injectable()
export class CrmMetricasService {
  /**
   * Todo lo de la sección, para una bandeja y una ventana.
   *
   * Son cuatro consultas y van en paralelo: ninguna depende de la otra y la
   * pantalla las muestra juntas.
   */
  async deLaBandeja(
    db: TenantDb,
    operatorId: string,
    ventana: Ventana,
  ): Promise<MetricasDeAtencion> {
    const [espera, resumen, canales, desde] = await Promise.all([
      this.sinResponder(db, operatorId),
      this.resumenDeLaVentana(db, operatorId, ventana),
      this.volumenPorCanal(db, operatorId, ventana),
      this.midiendoDesde(db, operatorId),
    ]);

    return {
      sinResponder: espera,
      ventana,
      ...resumen,
      porCanal: canales,
      midiendoDesde: desde,
    };
  }

  /**
   * Tramos abiertos sin una sola respuesta, y desde cuándo.
   *
   * Es **la que destapa el hueco de D16 + D17**: sin esto, alguien puede
   * escribir y quedar dos días sin que nadie en el sistema lo sepa.
   *
   * ⚠️ **No se usa `unread_for_operator`.** Ese contador se limpia cuando el
   * operador **abre** la conversación, no cuando contesta: el que abre, lee y
   * no responde quedaría contado como atendido — que es justo el caso que esto
   * viene a mostrar. Es la misma decisión que tomó el parte diario.
   */
  private async sinResponder(
    db: TenantDb,
    operatorId: string,
  ): Promise<SinResponder> {
    const filas = (await db.execute(sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (
               WHERE s.started_at < now() - interval '24 hours'
             )::int AS viejos,
             min(s.started_at) AS "masViejo"
        FROM crm_conversation_segments s
        JOIN crm_conversations c ON c.id = s.conversation_id
       WHERE c.assigned_operator_id = ${operatorId}
         AND s.resolved_at IS NULL
         AND s.first_response_at IS NULL
    `)) as unknown as SinResponder[];

    return filas[0] ?? { total: 0, viejos: 0, masViejo: null };
  }

  /**
   * Las medianas y los conteos de la ventana.
   *
   * Se filtra por `started_at`, no por `resolved_at`: la pregunta es "de lo que
   * entró este mes, cómo se atendió". Filtrando por resolución, un tramo que
   * empezó hace dos meses y se cerró ayer entraría a la mediana de este mes con
   * una espera de dos meses, y hundiría un número que no le corresponde.
   *
   * El `FILTER` de cada percentil deja afuera los que todavía no tienen ese
   * hecho: un tramo sin responder no es "una espera de cero", es una espera que
   * todavía no terminó. Contarlo bajaría la mediana justo cuando la atención
   * está peor.
   */
  private async resumenDeLaVentana(
    db: TenantDb,
    operatorId: string,
    ventana: Ventana,
  ): Promise<{
    tramos: number;
    respondidos: number;
    resueltos: number;
    medianaRespuesta: number | null;
    medianaResolucion: number | null;
  }> {
    const filas = (await db.execute(sql`
      SELECT count(*)::int AS tramos,
             count(*) FILTER (WHERE s.first_response_at IS NOT NULL)::int
               AS respondidos,
             count(*) FILTER (WHERE s.resolved_at IS NOT NULL)::int
               AS resueltos,
             percentile_cont(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (s.first_response_at - s.started_at))
             ) FILTER (WHERE s.first_response_at IS NOT NULL)
               AS "medianaRespuesta",
             percentile_cont(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (s.resolved_at - s.started_at))
             ) FILTER (WHERE s.resolved_at IS NOT NULL)
               AS "medianaResolucion"
        FROM crm_conversation_segments s
        JOIN crm_conversations c ON c.id = s.conversation_id
       WHERE c.assigned_operator_id = ${operatorId}
         AND s.started_at > now() - make_interval(days => ${ventana})
    `)) as unknown as Array<{
      tramos: number;
      respondidos: number;
      resueltos: number;
      medianaRespuesta: string | number | null;
      medianaResolucion: string | number | null;
    }>;

    const f = filas[0];
    return {
      tramos: f?.tramos ?? 0,
      respondidos: f?.respondidos ?? 0,
      resueltos: f?.resueltos ?? 0,
      // `percentile_cont` vuelve como `double precision`, que el driver puede
      // entregar como string. Se normaliza acá para que la pantalla reciba
      // siempre un número o `null`, y no tenga que adivinar.
      medianaRespuesta: aNumero(f?.medianaRespuesta),
      medianaResolucion: aNumero(f?.medianaResolucion),
    };
  }

  /**
   * Cuántos mensajes **entraron** por cada canal.
   *
   * Sólo `inbound`: la pregunta es por dónde llega la gente, no cuánto escribe
   * el operador. Sirve para decidir dónde invertir — y para ver si Telegram
   * terminó siendo el canal real de los operadores chicos.
   */
  private async volumenPorCanal(
    db: TenantDb,
    operatorId: string,
    ventana: Ventana,
  ): Promise<Array<{ canal: string; total: number }>> {
    const filas = (await db.execute(sql`
      SELECT ch.type AS canal, count(*)::int AS total
        FROM crm_messages m
        JOIN crm_conversations c ON c.id = m.conversation_id
        JOIN crm_channels ch ON ch.id = c.channel_id
       WHERE c.assigned_operator_id = ${operatorId}
         AND m.direction = 'inbound'
         AND m.created_at > now() - make_interval(days => ${ventana})
       GROUP BY ch.type
       ORDER BY count(*) DESC
    `)) as unknown as Array<{ canal: string; total: number }>;

    return filas;
  }

  /** El tramo más viejo de esta bandeja: desde cuándo hay algo medido. */
  private async midiendoDesde(
    db: TenantDb,
    operatorId: string,
  ): Promise<string | null> {
    const filas = (await db.execute(sql`
      SELECT min(s.started_at) AS desde
        FROM crm_conversation_segments s
        JOIN crm_conversations c ON c.id = s.conversation_id
       WHERE c.assigned_operator_id = ${operatorId}
    `)) as unknown as Array<{ desde: string | Date | null }>;

    const d = filas[0]?.desde;
    if (!d) return null;
    return d instanceof Date ? d.toISOString() : d;
  }
}

/** Un `double precision` de Postgres, como número o `null`. Nunca `NaN`. */
function aNumero(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
