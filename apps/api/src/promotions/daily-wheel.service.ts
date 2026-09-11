/**
 * DailyWheelService — lógica del giro de ruleta diaria.
 *
 * Config esperada:
 *   {
 *     "segments": [
 *       { "id": "s1", "label": "100 fichas", "probability": 0.4,
 *         "prize": { "kind": "chips", "amount": 100 } },
 *       { "id": "s2", "label": "Try again", "probability": 0.3,
 *         "prize": { "kind": "try_again" } },
 *       ...
 *     ]
 *   }
 *
 * Reglas:
 *   - `probability` numérico > 0. La suma DEBE ser 1.0 ± epsilon (o 100
 *     ± epsilon — auto-detectado por escala).
 *   - 1 spin/día/user enforced via idempotency key
 *     `daily_spin:<userId>:<dayAnchor>`. dayAnchor = UTC date YYYY-MM-DD.
 *   - **Quién puede girar** lo decide `WheelEligibilityService` (rol, estado de
 *     la cuenta, red y autoexclusión). Ver `docs/27-ruleta-diaria.md` §3.
 *   - El service NO valida la elegibilidad del user contra
 *     `targetSegment` por ahora (igual que bonos — sprint futuro).
 *   - Premios soportados:
 *     - `chips`: debit funder + credit user via wallet_tx `promo_reward`.
 *     - `try_again`: no chips, registra el spin igual.
 *     - `bonus`: grant vía UserBonusesService.
 *     - `free_spins`: **no soportado** — no se puede configurar ni entregar.
 *
 * Diseño:
 *   - El sorteo se hace IN-SERVICE (no en DB). RNG seedeable para tests
 *     (`spinAt(rng)`).
 *   - El registro en `promotion_rewards` incluye `metadata.rng` con el
 *     valor random usado (verificable post-hoc por auditoría).
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  promotionConfigSnapshots,
  promotionRewards,
  type NewPromotionReward,
  type Promotion,
  type PromotionReward,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { isUniqueViolation } from '../common/pg-error';
import {
  PromotionPrizeAwarder,
  type PromotionPrize,
} from './prize-awarder.service';
import { PromotionsService } from './promotions.service';
import {
  huellaDeLaConfig,
  parseWheelConfig,
  topeDiarioDeLaRueda,
  zonaDeLaRueda,
  type WheelConfig,
  type WheelSegment,
} from './wheel-config';
import { WheelEligibilityService } from './wheel-eligibility.service';
import {
  PromotionAlreadyClaimedError,
  PromotionNotActiveError,
  PromotionScheduleClosedError,
  PromotionTypeMismatchError,
  WheelConfigInvalidError,
  WheelPrizeNotDeliveredError,
} from './promotions.errors';

export interface SpinResult {
  reward: PromotionReward;
  segment: WheelSegment;
  /** Random value used (0..1). Util para tests y auditoría. */
  rng: number;
  /**
   * `true` si el gajo que salió no fue el del sorteo sino el de "sin premio",
   * porque se había agotado el tope del día.
   *
   * **No se le muestra al jugador** (docs/27 §6.3, decisión del dueño): para
   * él es indistinguible de la mala suerte. Existe para los reportes y para
   * que el admin pueda ver cuándo la ruleta dejó de repartir.
   */
  frenadoPorTope: boolean;
}

/** Inyectable de RNG. Tests pasan uno determinístico. */
export type WheelRng = () => number;

@Injectable()
export class DailyWheelService {
  private readonly logger = new Logger(DailyWheelService.name);

  constructor(
    private readonly promotionsService: PromotionsService,
    private readonly prizeAwarder: PromotionPrizeAwarder,
    private readonly eligibility: WheelEligibilityService,
  ) {}

  /**
   * Procesa un giro de ruleta para `userId` sobre `promotionId`. Si el
   * user ya giró hoy, retorna el reward existente (idempotente).
   *
   * `rng` opcional permite tests determinísticos (defecto: `Math.random`).
   * `nowProvider` opcional para test del día anchor.
   */
  async spin(
    db: TenantDb,
    params: {
      promotionId: string;
      userId: string;
    },
    options: {
      rng?: WheelRng;
      now?: Date;
    } = {},
  ): Promise<SpinResult> {
    const rng = options.rng ?? Math.random;
    const now = options.now ?? new Date();

    // 1. Cargar promotion + validar.
    const promo = await this.promotionsService.findById(db, params.promotionId);
    if (promo.type !== 'daily_wheel') {
      throw new PromotionTypeMismatchError(promo.id, 'daily_wheel', promo.type);
    }
    if (promo.status !== 'active') {
      throw new PromotionNotActiveError(promo.id, promo.status);
    }

    // 1b. ¿Este usuario puede girar? (docs/27 §3)
    //
    // Va ANTES de la idempotencia a propósito. Si fuera después, el que ya giró
    // hoy y desde entonces quedó suspendido —o se autoexcluyó— recibiría su
    // premio replayado como si nada. El chequeo es sobre el estado de AHORA.
    await this.eligibility.assertCanSpin(db, params.userId);
    this.assertWithinSchedule(promo, now);

    const segments = this.parseConfig(promo);

    // 2. Idempotency: 1 spin per (promotion, user, día del casino). Incluimos
    //    `promo.id` en la key para que los wallet_tx derivados sean
    //    únicos globalmente (si un user tiene 2 wheel activos el mismo
    //    día, los wallet keys no colisionan).
    const zona = zonaDeLaRueda(promo.config);
    const topeDiario = topeDiarioDeLaRueda(promo.config);
    const configHash = huellaDeLaConfig(promo.config);
    const dayAnchor = this.dayAnchor(now, zona);
    const idempotencyKey = `daily_spin:${promo.id}:${params.userId}:${dayAnchor}`;

    const existing = await db
      .select()
      .from(promotionRewards)
      .where(
        and(
          eq(promotionRewards.promotionId, promo.id),
          eq(promotionRewards.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (existing[0]) {
      const reward = existing[0];
      const segId = (reward.metadata as { segmentId?: string }).segmentId;
      // Se busca el gajo en la rueda CON LA QUE SE JUGÓ, no en la de ahora.
      // Antes se buscaba en la actual y, si la config había cambiado, se
      // devolvía un segmento sintético — o sea que el historial se degradaba
      // solo cada vez que el admin editaba la rueda.
      const historicos = await this.segmentosDelGiro(db, promo, reward);
      const seg = historicos.find((s) => s.id === segId);
      return {
        reward,
        segment: seg ?? {
          id: segId ?? 'unknown',
          probability: 0,
          prize: reward.prize as PromotionPrize,
        },
        rng: (reward.metadata as { rng?: number }).rng ?? 0,
        frenadoPorTope:
          (reward.metadata as { frenadoPorTope?: boolean }).frenadoPorTope ===
          true,
      };
    }

    // 3. Sorteo + reserva, en UNA transacción.
    //
    // El orden es al revés del original —antes se entregaba y después se
    // escribía la fila— y es lo que hace que el tope sea de verdad. La fila
    // tiene que existir ANTES de entregar: es la reserva. Si no, dos giros
    // simultáneos leen el mismo gasto del día, los dos se creen adentro del
    // tope y los dos entregan.
    //
    // El `FOR UPDATE` sobre la promoción serializa los giros de ESA ruleta. Es
    // un cuello de botella a propósito y acotado: dura lo que tarda una suma
    // indexada y un insert, no incluye ningún movimiento de plata.
    const rngValue = rng();
    let reward: PromotionReward;
    let winningSegment: WheelSegment;
    let frenadoPorTope = false;

    try {
      const reservado = await db.transaction(async (tx) => {
        // Sin este `FOR UPDATE` el tope es decorativo: seis giros simultáneos
        // contra un tope de 250 reparten 500 — medido, sacándolo.
        await tx.execute(
          sql`SELECT 1 FROM promotions WHERE id = ${promo.id} FOR UPDATE`,
        );

        let elegido = this.pickSegment(segments, rngValue);
        let porTope = false;

        if (topeDiario !== null) {
          const gastado = await this.gastoDelDia(tx, promo.id, dayAnchor);
          const costo = this.costoDelPremio(elegido.prize);
          // Se compara contra lo que costaría ESTE premio, no sólo contra el
          // tope alcanzado: así tampoco se lo pasa de largo con un premio
          // grande justo al borde.
          //
          // ⚠️ Efecto que conviene tener presente: un premio más caro que el
          // tope entero nunca puede salir. Con tope 1.000 y jackpot 2.500, el
          // jackpot es inalcanzable y el jugador siempre cae en el gajo sin
          // premio. El tope tiene que ser mayor que el premio mayor.
          if (gastado + costo > topeDiario) {
            elegido = this.segmentoSinPremio(segments);
            porTope = true;
          }
        }

        // Con qué rueda se jugó. Va en la MISMA transacción que el reward:
        // si el snapshot se guardara aparte, un giro podría quedar apuntando a
        // una huella que no existe. `DO NOTHING` porque la misma config se
        // guarda una sola vez — la segunda no es un error, es lo esperado.
        await tx
          .insert(promotionConfigSnapshots)
          .values({
            promotionId: promo.id,
            configHash,
            config: promo.config,
          })
          .onConflictDoNothing();

        // Se inserta SIN entregar: `deliveredAt` y `deliveryError` en NULL
        // quieren decir "pendiente". La entrega se marca abajo.
        const newRow: NewPromotionReward = {
          promotionId: promo.id,
          userId: params.userId,
          prize: elegido.prize,
          idempotencyKey,
          configHash,
          metadata: {
            kind: 'daily_wheel',
            segmentId: elegido.id,
            dayAnchor,
            rng: rngValue,
            ...(porTope ? { frenadoPorTope: true } : {}),
          },
        };
        const inserted = await tx
          .insert(promotionRewards)
          .values(newRow)
          .returning();
        return { fila: inserted[0]!, segmento: elegido, porTope };
      });
      reward = reservado.fila;
      winningSegment = reservado.segmento;
      frenadoPorTope = reservado.porTope;
    } catch (err: unknown) {
      // Race: otro request con la misma key ganó.
      if (isUniqueViolation(err)) {
        throw new PromotionAlreadyClaimedError(idempotencyKey);
      }
      throw err;
    }

    // 4. Entrega, FUERA de la transacción.
    //
    // Fuera a propósito: adentro habría que sostener el lock de la promoción
    // durante los movimientos de plata, y las transacciones del wallet pasarían
    // a ser savepoints anidados — o sea, cambiar cómo fallan las operaciones de
    // fichas para resolver un problema que no es de ellas.
    //
    // Si la entrega falla, la fila queda con `deliveryError` y el jugador se
    // entera. Antes se registraba el premio igual y no se enteraba nadie.
    try {
      const { walletTxId, bonusId, deliveryError } =
        await this.prizeAwarder.award(db, {
          context: {
            id: promo.id,
            code: promo.code,
            fundedByUserId: promo.fundedByUserId,
          },
          userId: params.userId,
          prize: winningSegment.prize,
          idempotencyKeyBase: idempotencyKey,
        });

      // El awarder puede "no romper" y aun así no haber entregado nada: es el
      // fail-soft del grant de bonos. Si lo tratáramos como éxito, marcaríamos
      // entregado un premio que el jugador no tiene — exactamente el bug que
      // el estado de entrega vino a cerrar.
      if (deliveryError) {
        throw new WheelPrizeNotDeliveredError(deliveryError);
      }

      const entregado = await db
        .update(promotionRewards)
        .set({
          walletTxId: walletTxId ?? null,
          bonusId: bonusId ?? null,
          deliveredAt: new Date(),
        })
        .where(eq(promotionRewards.id, reward.id))
        .returning();
      reward = entregado[0] ?? reward;
    } catch (err: unknown) {
      const motivo = err instanceof Error ? err.message : String(err);
      await db
        .update(promotionRewards)
        .set({ deliveryError: motivo.slice(0, 500) })
        .where(eq(promotionRewards.id, reward.id));
      this.logger.error(
        `Premio no entregado — promo=${promo.code} user=${params.userId} ` +
          `reward=${reward.id}: ${motivo}`,
      );
      throw err;
    }

    return { reward, segment: winningSegment, rng: rngValue, frenadoPorTope };
  }

  /**
   * Los gajos de la rueda **tal como estaba cuando se jugó ese giro**.
   *
   * Es lo que permite contestar "¿qué premios había y con qué probabilidad el
   * día que este jugador giró?" aunque la rueda se haya editado diez veces
   * desde entonces.
   *
   * Cae a la config actual en dos casos, y los dos son honestos:
   *   - el giro es anterior a la migración `0120` y no tiene huella;
   *   - la huella está pero el snapshot no aparece (no debería pasar: se
   *     escriben en la misma transacción).
   *
   * En esos casos lo que se devuelve es "la rueda de ahora", que puede no ser
   * la que jugó. Se prefiere eso a fallar: el reward guardado sigue siendo la
   * verdad sobre el premio, y es lo único que el jugador reclama.
   */
  private async segmentosDelGiro(
    db: TenantDb,
    promo: Promotion,
    reward: PromotionReward,
  ): Promise<WheelSegment[]> {
    if (reward.configHash) {
      const filas = await db
        .select({ config: promotionConfigSnapshots.config })
        .from(promotionConfigSnapshots)
        .where(
          and(
            eq(promotionConfigSnapshots.promotionId, promo.id),
            eq(promotionConfigSnapshots.configHash, reward.configHash),
          ),
        )
        .limit(1);
      if (filas[0]) {
        try {
          return parseWheelConfig(filas[0].config);
        } catch {
          // Una config histórica puede no pasar las validaciones de HOY: por
          // ejemplo una con premio en fichas, que se guardó cuando eso estaba
          // permitido. Que ya no se pueda configurar no la hace menos cierta.
          const segs = (filas[0].config as Partial<WheelConfig>).segments;
          if (Array.isArray(segs)) return segs;
        }
      }
    }
    return this.parseConfig(promo);
  }

  /**
   * Fichas ya comprometidas por esta ruleta en el día.
   *
   * Se suma por el **ancla del día**, que es la misma que define la clave de
   * idempotencia: así el tope y la regla de "un giro por día" no pueden
   * discrepar sobre qué día es.
   *
   * Cuentan las entregadas **y las pendientes** —una entrega en curso ya
   * comprometió las fichas— y no cuentan las fallidas, que no movieron nada.
   */
  private async gastoDelDia(
    tx: Pick<TenantDb, 'execute'>,
    promotionId: string,
    dayAnchor: string,
  ): Promise<number> {
    const filas = (await tx.execute(sql`
      SELECT COALESCE(SUM((prize->>'amount')::numeric), 0)::float8 AS gastado
        FROM promotion_rewards
       WHERE promotion_id = ${promotionId}
         AND metadata->>'dayAnchor' = ${dayAnchor}
         AND delivery_error IS NULL
    `)) as unknown as Array<{ gastado: number }>;
    return Number(filas[0]?.gastado ?? 0);
  }

  /** Lo que cuesta un premio en fichas. Los que no dan fichas cuestan 0. */
  private costoDelPremio(prize: PromotionPrize): number {
    if (prize.kind === 'chips' || prize.kind === 'bonus') {
      return Number(prize.amount) || 0;
    }
    return 0;
  }

  /**
   * El gajo al que cae la rueda cuando se agotó el tope del día.
   *
   * `parseWheelConfig` garantiza que existe cuando hay tope configurado, así
   * que esto no debería tirar nunca. Tira igual en vez de inventar un premio:
   * si la garantía se rompiera, la alternativa sería repartir por encima del
   * tope, que es peor que un error.
   */
  private segmentoSinPremio(segments: WheelSegment[]): WheelSegment {
    const sinPremio = segments.find((s) => s.prize?.kind === 'try_again');
    if (!sinPremio) {
      throw new WheelConfigInvalidError(
        'se agotó el tope del día y la rueda no tiene ningún segmento sin premio',
      );
    }
    return sinPremio;
  }

  /** Historial del user en una promotion. */
  async listMyRewards(
    db: TenantDb,
    promotionId: string,
    userId: string,
    limit = 50,
    offset = 0,
  ): Promise<PromotionReward[]> {
    return db
      .select()
      .from(promotionRewards)
      .where(
        and(
          eq(promotionRewards.promotionId, promotionId),
          eq(promotionRewards.userId, userId),
        ),
      )
      .orderBy(desc(promotionRewards.grantedAt))
      .limit(limit)
      .offset(offset);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────────────────

  private parseConfig(promo: Promotion): WheelSegment[] {
    return parseWheelConfig(promo.config);
  }

  /** Weighted random pick. `rngValue` ∈ [0,1). */
  private pickSegment(segments: WheelSegment[], rngValue: number): WheelSegment {
    let cumulative = 0;
    for (const s of segments) {
      cumulative += s.probability;
      if (rngValue < cumulative) return s;
    }
    // Fallback (suma < 1 por redondeo) — devolvemos el último.
    return segments[segments.length - 1]!;
  }

  private assertWithinSchedule(promo: Promotion, now: Date): void {
    if (promo.startsAt && now.getTime() < promo.startsAt.getTime()) {
      throw new PromotionScheduleClosedError(promo.id);
    }
    if (promo.endsAt && now.getTime() >= promo.endsAt.getTime()) {
      throw new PromotionScheduleClosedError(promo.id);
    }
  }

  /**
   * `'YYYY-MM-DD'` **en la zona del casino**. Es el bucket diario: define a la
   * vez la clave de idempotencia del giro y el día que suma el tope.
   *
   * Antes era `now.toISOString().slice(0,10)`, o sea medianoche **UTC** — las
   * 21:00 en Argentina. El jugador perdía el giro a las nueve de la noche y a
   * las 21:01 giraba de nuevo: dos giros en la misma noche, todas las noches.
   *
   * `en-CA` da el formato `YYYY-MM-DD` ya ordenado, que es justo lo que se
   * quiere para una clave. No hace falta ninguna dependencia nueva.
   */
  private dayAnchor(now: Date, timezone: string): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  }

}
