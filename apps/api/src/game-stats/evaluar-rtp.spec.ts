/**
 * `evaluarRtp` — cuándo se marca un juego por su devolución.
 *
 * Por qué existe este archivo: esta regla decide cuándo avisarle al operador
 * que un juego está pagando distinto de lo que debería, y **cambió de
 * significado dos veces el 2026-09-07** sin ningún test que la cubriera:
 *
 *   1. Primero comparaba contra un `config.rtp` que Palace tenía inventado
 *      (0,95 fijo en todo el catálogo) y que Gregmorn directamente no manda.
 *   2. Después contra el rango declarado por el proveedor (75-96%).
 *   3. Y finalmente contra el 82% que se le pidió configurar.
 *
 * Cada cambio movía qué juegos se marcan y cuáles no. Sin tests, la única
 * forma de saber si la alerta sigue sirviendo era mirar el panel y confiar.
 *
 * Los dos modos de falla que se cuidan acá son opuestos y los dos son caros:
 * que NO marque un juego que devuelve de más (el casino pierde en cada ronda),
 * y que marque de más (una alerta ruidosa se vuelve una alerta ignorada, que es
 * lo mismo que no tenerla).
 */

import { evaluarRtp } from './game-stats.service';

/** Muestra suficiente, para que el piso de rondas no sea lo que decide. */
const RONDAS_OK = 500;

describe('evaluarRtp', () => {
  describe('objetivo de la cuenta (82%), que es el caso de casi todo el catálogo', () => {
    it('no marca un juego pagando cerca del objetivo', () => {
      const r = evaluarRtp({
        rtpRealPct: 83.4,
        totalBet: 10_000,
        rondas: RONDAS_OK,
        config: null,
      });
      expect(r.objetivoPct).toBe(82);
      expect(r.flagReason).toBeNull();
    });

    it('marca un juego que devuelve MUCHO de más', () => {
      // 94% con objetivo 82 son 12 puntos: el casino pierde en cada ronda.
      // Con el rango viejo (75-96%) esto NO se marcaba, y es la razón de ser
      // de este cambio.
      const r = evaluarRtp({
        rtpRealPct: 94,
        totalBet: 10_000,
        rondas: RONDAS_OK,
        config: null,
      });
      expect(r.flagReason).toBe('fuera_de_rango');
      expect(r.divergence).toBeCloseTo(12, 5);
    });

    it('marca un juego que devuelve mucho de menos', () => {
      const r = evaluarRtp({
        rtpRealPct: 60,
        totalBet: 10_000,
        rondas: RONDAS_OK,
        config: null,
      });
      expect(r.flagReason).toBe('fuera_de_rango');
    });

    it('no marca en el borde exacto de la tolerancia', () => {
      // 5 puntos justos NO alcanzan: el umbral es "más de 5".
      const r = evaluarRtp({
        rtpRealPct: 87,
        totalBet: 10_000,
        rondas: RONDAS_OK,
        config: null,
      });
      expect(r.divergence).toBeCloseTo(5, 5);
      expect(r.flagReason).toBeNull();
    });

    it('marca apenas se pasa del borde', () => {
      const r = evaluarRtp({
        rtpRealPct: 87.1,
        totalBet: 10_000,
        rondas: RONDAS_OK,
        config: null,
      });
      expect(r.flagReason).toBe('fuera_de_rango');
    });
  });

  describe('el piso de rondas', () => {
    it('NO marca un juego recién estrenado, por absurdo que parezca su RTP', () => {
      // 3 rondas y un premio grande dan un 300% que no significa nada. Sin
      // este piso el panel marcaría cada juego nuevo y el aviso se volvería
      // ignorable.
      const r = evaluarRtp({
        rtpRealPct: 300,
        totalBet: 30,
        rondas: 3,
        config: null,
      });
      expect(r.flagReason).toBeNull();
    });

    it('tampoco a las 99 rondas, y sí a las 100', () => {
      const base = { rtpRealPct: 300, totalBet: 5_000, config: null };
      expect(evaluarRtp({ ...base, rondas: 99 }).flagReason).toBeNull();
      expect(evaluarRtp({ ...base, rondas: 100 }).flagReason).toBe('fuera_de_rango');
    });

    it('el piso aplica también al objetivo propio del juego', () => {
      // Antes de este cambio la divergencia no pedía muestra: un juego con 3
      // rondas y objetivo configurado se marcaba igual.
      const r = evaluarRtp({
        rtpRealPct: 300,
        totalBet: 30,
        rondas: 3,
        config: { rtp: 0.9 },
      });
      expect(r.flagReason).toBeNull();
    });
  });

  describe('objetivo propio del juego', () => {
    it('le gana al de la cuenta: es más específico', () => {
      // 90% real contra un objetivo propio de 90 no se marca, aunque esté a 8
      // puntos del 82% de la cuenta.
      const r = evaluarRtp({
        rtpRealPct: 90,
        totalBet: 10_000,
        rondas: RONDAS_OK,
        config: { rtp: 0.9 },
      });
      expect(r.objetivoPct).toBe(90);
      expect(r.flagReason).toBeNull();
    });

    it('cuando se aleja, el motivo es `divergencia` y no `fuera_de_rango`', () => {
      // La distinción no es cosmética: `divergencia` se corrige acá, porque el
      // objetivo lo cargó alguien de este lado. `fuera_de_rango` se le reclama
      // al proveedor.
      const r = evaluarRtp({
        rtpRealPct: 70,
        totalBet: 10_000,
        rondas: RONDAS_OK,
        config: { rtp: 0.9 },
      });
      expect(r.flagReason).toBe('divergencia');
    });

    it('acepta el objetivo en las dos escalas: 0,9 y 90', () => {
      // Se guardó históricamente como fracción, pero a mano es fácil cargar 90.
      const comun = { rtpRealPct: 90, totalBet: 10_000, rondas: RONDAS_OK };
      expect(evaluarRtp({ ...comun, config: { rtp: 0.9 } }).objetivoPct).toBe(90);
      expect(evaluarRtp({ ...comun, config: { rtp: 90 } }).objetivoPct).toBe(90);
    });

    it('ignora un `rtp` que no sea un número usable y cae al de la cuenta', () => {
      // `config` es jsonb libre: puede traer cualquier cosa. Si se colara un
      // 0 o un string, el objetivo sería 0 y se marcaría TODO el catálogo.
      for (const rtp of [0, -1, NaN, 'alto', null, undefined]) {
        const r = evaluarRtp({
          rtpRealPct: 82,
          totalBet: 10_000,
          rondas: RONDAS_OK,
          config: { rtp },
        });
        expect(r.objetivoPct).toBe(82);
        expect(r.flagReason).toBeNull();
      }
    });
  });

  describe('sin apuestas', () => {
    it('no marca ni calcula divergencia', () => {
      const r = evaluarRtp({
        rtpRealPct: 0,
        totalBet: 0,
        rondas: RONDAS_OK,
        config: null,
      });
      expect(r.divergence).toBeNull();
      expect(r.flagReason).toBeNull();
    });
  });
});
