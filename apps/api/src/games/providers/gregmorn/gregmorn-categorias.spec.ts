/**
 * `mapCategory` — de qué categoría es cada juego, según el estudio.
 *
 * **Por qué existe este archivo.** Esta función no tenía tests y falló en
 * silencio durante meses: la lista decía `'pragmatic play live'` y Gregmorn
 * manda `Pragmatic Live`. Un `includes` que no matchea, y 84 juegos de casino
 * en vivo archivados como tragamonedas. En producción **los 9.449 juegos
 * quedaron en `slots`**, el filtro del lobby mostraba "Todos 9449" y "Slots
 * 9449" —lo mismo dos veces— y quien quería ruleta en vivo no tenía cómo
 * llegar.
 *
 * Nada de eso rompía nada visible: por eso duró tanto.
 *
 * Los nombres de estudio de acá **son los reales de producción**, tomados de
 * `/tenant/games/facets` el 2026-09-08. No son inventados: si el proveedor
 * cambia cómo los escribe, este test es el que se entera.
 */

import { mapCategory } from './gregmorn-sync.service';

describe('mapCategory — categoría por estudio', () => {
  describe('casino en vivo', () => {
    // `Pragmatic Live` es EL caso que estaba roto. Va primero.
    it.each([
      ['Pragmatic Live', 'el que estaba mal escrito en la lista'],
      ['Live Dealers', ''],
      ['Evolution', ''],
      ['Ezugi', ''],
      ['TVBet', ''],
    ])('%s → live %s', (estudio) => {
      expect(mapCategory(estudio)).toBe('live');
    });
  });

  it('Spribe → crash (es Aviator y compañía)', () => {
    expect(mapCategory('Spribe')).toBe('crash');
  });

  describe('mini', () => {
    it.each(['Bingo', 'Keno', 'Mini-Duel', 'Mini-Inout', 'Fishing', 'Fish', 'Firekirin', 'Fa Chai'])(
      '%s → mini',
      (estudio) => {
        expect(mapCategory(estudio)).toBe('mini');
      },
    );
  });

  describe('el resto es slots', () => {
    it.each([
      'Pragmatic',
      'KAGaming',
      'Amatic',
      'Amusnet',
      "Play'nGO",
      'Playngo',
      'Hacksaw',
      'EGT',
      'NetEnt',
      'Playtech',
    ])('%s → slots', (estudio) => {
      expect(mapCategory(estudio)).toBe('slots');
    });
  });

  describe('la comparación no depende de cómo lo escriban', () => {
    // Es lo que hace que el bug original no pueda repetirse: espacios, guiones,
    // apóstrofos y mayúsculas dejan de importar.
    it.each([
      ['pragmatic live', 'live'],
      ['PRAGMATIC LIVE', 'live'],
      ['Pragmatic-Live', 'live'],
      ['pragmaticlive', 'live'],
      ['Pragmatic Play Live', 'live'],
    ] as const)('%s → %s', (estudio, esperado) => {
      expect(mapCategory(estudio)).toBe(esperado);
    });
  });

  describe('entradas vacías o raras no rompen', () => {
    it.each([null, undefined, '', '   '])('%p → slots', (v) => {
      expect(mapCategory(v)).toBe('slots');
    });
  });

  it('`Pragmatic` a secas NO cae en vivo', () => {
    // El riesgo del emparejamiento por inclusión es pasarse de largo: `Pragmatic`
    // tiene 1.699 juegos y mandarlos todos a "En Vivo" sería mucho peor que el
    // bug que se está arreglando.
    expect(mapCategory('Pragmatic')).toBe('slots');
  });

  it('los juegos de mesa NO se marcan por estudio, a propósito', () => {
    // Vienen de estudios mixtos que también hacen slots. Marcarlos por nombre de
    // estudio metería tragamonedas en "Mesa".
    expect(mapCategory('Playtech')).toBe('slots');
    expect(mapCategory('Microgaming')).toBe('slots');
  });
});
