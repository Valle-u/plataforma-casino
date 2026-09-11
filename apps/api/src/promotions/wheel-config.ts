/**
 * Validación de la config de una ruleta diaria.
 *
 * Vivía adentro de `DailyWheelService` como método privado y sólo corría **al
 * girar**. O sea que una config rota se guardaba sin chistar y explotaba
 * después, en la cara del primer jugador que giraba.
 *
 * Ahora es una función suelta y la llaman los dos lados: el guardado (crear y
 * editar la promo) y el giro. Es la misma validación en los dos, a propósito —
 * si fueran dos, la del guardado sería la que se queda vieja.
 */

import type { PromotionPrize } from './prize-awarder.service';
import {
  WheelConfigInvalidError,
  WheelFreeSpinsNotSupportedError,
} from './promotions.errors';

export interface WheelSegment {
  id: string;
  label?: string;
  probability: number;
  prize: PromotionPrize;
}

export interface WheelConfig {
  segments: WheelSegment[];
}

/**
 * Valida y **normaliza** los segmentos a escala 1.0.
 *
 * Acepta que el admin cargue las probabilidades en porcentaje (suman ~100) o en
 * fracción (suman ~1) y detecta cuál es por la escala. La tolerancia existe
 * porque nadie escribe a mano doce números que sumen exacto.
 *
 * @throws WheelConfigInvalidError si falta algo o las probabilidades no cierran.
 * @throws WheelFreeSpinsNotSupportedError si algún segmento da tiradas gratis.
 */
export function parseWheelConfig(raw: unknown): WheelSegment[] {
  const config = (raw ?? {}) as Partial<WheelConfig>;
  if (!Array.isArray(config.segments) || config.segments.length === 0) {
    throw new WheelConfigInvalidError('config.segments vacío o ausente');
  }

  const segments = config.segments;
  const vistos = new Set<string>();
  let total = 0;

  for (const s of segments) {
    if (typeof s.id !== 'string' || s.id.length === 0) {
      throw new WheelConfigInvalidError('hay un segmento sin id');
    }
    // Sin esto, dos segmentos con el mismo id rompen el historial: el reward
    // guarda `segmentId` y al releerlo no se sabe cuál de los dos salió.
    if (vistos.has(s.id)) {
      throw new WheelConfigInvalidError(`segmento '${s.id}' repetido`);
    }
    vistos.add(s.id);

    if (typeof s.probability !== 'number' || s.probability <= 0) {
      throw new WheelConfigInvalidError(`segment '${s.id}' probability inválida`);
    }

    // El premio tiene que poder pagarse. `free_spins` no puede: no está
    // implementado (docs/27 §15) y el awarder devolvía `null` en silencio.
    if (s.prize?.kind === 'free_spins') {
      throw new WheelFreeSpinsNotSupportedError(s.id);
    }

    total += s.probability;
  }

  // Suma ~1 o ~100. Tolerancia del 1% para permitir los redondeos del admin.
  if (Math.abs(total - 1) > 0.01 && Math.abs(total - 100) > 1) {
    throw new WheelConfigInvalidError(
      `sum(probability)=${total} (esperado ~1.0 o ~100)`,
    );
  }

  const scale = total > 5 ? 100 : 1;
  return segments.map((s) => ({ ...s, probability: s.probability / scale }));
}
