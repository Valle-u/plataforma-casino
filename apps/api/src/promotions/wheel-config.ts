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
  /**
   * Zona horaria que define dónde corta el día. Default:
   * `America/Argentina/Buenos_Aires`.
   *
   * **No es un detalle cosmético.** Con el default viejo —medianoche UTC— el
   * día cortaba a las 21:00 en Argentina: el jugador perdía su giro a las
   * nueve de la noche y a las 21:01 ya podía girar de nuevo. Dos giros en la
   * misma noche, todas las noches.
   *
   * Vive en la config de la promo y no en los settings del casino porque es,
   * hoy, lo único que necesita saber dónde empieza el día. Si mañana otra cosa
   * lo necesita, conviene subirlo a un setting del tenant y que la ruleta lo
   * lea de ahí — no duplicarlo.
   */
  timezone?: string;
  /**
   * Techo de fichas que la ruleta puede repartir **por día**, en toda la
   * promoción (no por jugador). Ausente o `null` = sin tope.
   *
   * Es la contención principal contra las cuentas múltiples mientras el
   * antifraude siga desenganchado (`docs/27-ruleta-diaria.md` §11): sin
   * importar cuántas cuentas se abran, el gasto de un día no pasa de acá.
   */
  dailyCapChips?: number | null;
}

export const ZONA_POR_DEFECTO = 'America/Argentina/Buenos_Aires';

/** La zona de la config, validada. Cae al default si no está. */
export function zonaDeLaRueda(raw: unknown): string {
  const zona = (raw as Partial<WheelConfig> | null)?.timezone;
  if (zona === undefined || zona === null || zona === '') return ZONA_POR_DEFECTO;
  if (typeof zona !== 'string' || !esZonaValida(zona)) {
    throw new WheelConfigInvalidError(`timezone inválida: '${String(zona)}'`);
  }
  return zona;
}

/** El tope diario de la config, validado. `null` = sin tope. */
export function topeDiarioDeLaRueda(raw: unknown): number | null {
  const tope = (raw as Partial<WheelConfig> | null)?.dailyCapChips;
  if (tope === undefined || tope === null) return null;
  if (typeof tope !== 'number' || !Number.isFinite(tope) || tope <= 0) {
    throw new WheelConfigInvalidError(
      `dailyCapChips tiene que ser un número > 0 (o ausente para no topear); vino '${String(tope)}'`,
    );
  }
  return tope;
}

function esZonaValida(zona: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zona });
    return true;
  } catch {
    return false;
  }
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

    // La ruleta no reparte fichas retirables (docs/27 §5.1, decisión del
    // dueño). El premio va como BONO: el jugador tiene que jugarlo —las
    // apuestas consumen primero el saldo real y después el bono— y sólo lo que
    // gane pasa a ser retirable. Con `chips` giraba, ganaba 200 y retiraba 200
    // sin haber jugado nada.
    //
    // Se prohíbe acá, al guardar, y no se deja "recomendado": una decisión que
    // no se hace cumplir dura hasta el primer descuido.
    if (s.prize?.kind === 'chips') {
      throw new WheelConfigInvalidError(
        `segment '${s.id}': la ruleta no entrega fichas retirables. ` +
          `El premio va como bono (prize.kind='bonus' con su planilla). ` +
          `Ver docs/27-ruleta-diaria.md §5.1`,
      );
    }

    // El monto tiene que ser un número. No es cosmético: el tope diario suma
    // `(prize->>'amount')::numeric` en SQL, y un monto que no castea no falla
    // en ese segmento — hace fallar la suma entera, o sea el giro de todos.
    if (s.prize?.kind === 'bonus') {
      const monto = Number(s.prize.amount);
      if (!Number.isFinite(monto) || monto <= 0) {
        throw new WheelConfigInvalidError(
          `segment '${s.id}': el monto tiene que ser un número > 0, vino '${String(s.prize.amount)}'`,
        );
      }
    }

    total += s.probability;
  }

  // Suma ~1 o ~100. Tolerancia del 1% para permitir los redondeos del admin.
  if (Math.abs(total - 1) > 0.01 && Math.abs(total - 100) > 1) {
    throw new WheelConfigInvalidError(
      `sum(probability)=${total} (esperado ~1.0 o ~100)`,
    );
  }

  // Zona y tope se validan acá aunque no se usen para sortear: si no, una zona
  // mal escrita se guarda sin chistar y recién se descubre al primer giro.
  zonaDeLaRueda(config);
  const tope = topeDiarioDeLaRueda(config);

  // Con tope, al agotarse el día la rueda tiene que caer en un gajo sin premio
  // (docs/27 §6.3). Si no hay ninguno, no hay forma de degradar: el giro
  // fallaría o —peor— repartiría por encima del tope. Se avisa al guardar, que
  // es cuando se puede arreglar.
  if (tope !== null && !segments.some((s) => s.prize?.kind === 'try_again')) {
    throw new WheelConfigInvalidError(
      'con dailyCapChips hace falta al menos un segmento sin premio ' +
        "(prize.kind='try_again'): es donde cae la rueda cuando se agota el día",
    );
  }

  const scale = total > 5 ? 100 : 1;
  return segments.map((s) => ({ ...s, probability: s.probability / scale }));
}
