/**
 * El texto del aviso de derivación (D8).
 *
 * Chico y sin base de datos, a propósito: es el único punto del sistema donde
 * un dato cruza de una bandeja a otra, así que conviene que sea una función
 * pura y que su comportamiento esté clavado.
 */

import { textoDelAviso } from './aviso-derivacion';

/** 8 de septiembre de 2026, 14:32 hora de Argentina (17:32 UTC). */
const CUANDO = new Date('2026-09-08T17:32:00.000Z');

describe('textoDelAviso', () => {
  it('dice quién, cuándo y a dónde — y nada más', () => {
    expect(
      textoDelAviso({ nombre: 'Juan Pérez', cuando: CUANDO, origen: 'el casino' }),
    ).toBe(
      'Juan Pérez escribió al casino el 08/09 a las 14:32.\n' +
        'Se le pidió que te contacte.',
    );
  });

  it('usa la hora de Argentina, no UTC', () => {
    // 17:32 UTC son las 14:32 acá. Si el aviso dijera 17:32, el operador
    // buscaría un mensaje que "todavía no llegó".
    const texto = textoDelAviso({
      nombre: 'Ana',
      cuando: CUANDO,
      origen: 'el casino',
    });
    expect(texto).toContain('14:32');
    expect(texto).not.toContain('17:32');
  });

  it('nombra la bandeja de origen cuando no es la central', () => {
    expect(
      textoDelAviso({ nombre: 'Ana', cuando: CUANDO, origen: 'Litoral' }),
    ).toContain('escribió a Litoral');
  });

  /** En castellano `a` + `el` es `al`. Lo lee un operador todos los días. */
  it('contrae "a el" en "al"', () => {
    const texto = textoDelAviso({
      nombre: 'Ana',
      cuando: CUANDO,
      origen: 'el casino',
    });
    expect(texto).toContain('escribió al casino');
    expect(texto).not.toContain('a el casino');
  });

  /**
   * El aviso son dos renglones. Un `display_name` sale de un formulario y puede
   * traer saltos de línea: sin limpiarlos, el mensaje se desarma.
   */
  it('aplasta los saltos de línea del nombre', () => {
    const texto = textoDelAviso({
      nombre: 'Juan\n\nPérez',
      cuando: CUANDO,
      origen: 'el casino',
    });
    expect(texto.split('\n')).toHaveLength(2);
    expect(texto).toContain('Juan Pérez');
  });

  it('acorta un nombre largísimo en vez de romper el mensaje', () => {
    const texto = textoDelAviso({
      nombre: 'A'.repeat(200),
      cuando: CUANDO,
      origen: 'el casino',
    });
    expect(texto).toContain('…');
    expect(texto.split('\n')[0]!.length).toBeLessThan(120);
  });

  it('con el nombre vacío no deja el mensaje colgado', () => {
    expect(
      textoDelAviso({ nombre: '   ', cuando: CUANDO, origen: 'el casino' }),
    ).toContain('Un contacto escribió');
  });

  /**
   * ⚠️ **El test que importa.**
   *
   * `textoDelAviso` no recibe el mensaje: su firma es lo que hace imposible
   * filtrarlo. Este caso deja escrito por qué, para que nadie agregue un
   * parámetro "para dar más contexto" sin ver que rompe D8.
   */
  it('no hay forma de meterle el contenido de la conversación', () => {
    const texto = textoDelAviso({
      nombre: 'Juan Pérez',
      cuando: CUANDO,
      origen: 'el casino',
    });

    // Todo lo que sale son las tres cosas que entraron. Si alguien agrega un
    // cuarto dato al aviso, este test no lo detecta solo — pero la firma de la
    // función lo obliga a pasar por acá.
    expect(texto).toBe(
      'Juan Pérez escribió al casino el 08/09 a las 14:32.\n' +
        'Se le pidió que te contacte.',
    );
  });
});
