/**
 * El teléfono como identidad (**D4**, primera y segunda defensa).
 *
 * ## Por qué estos tests son de los que más importan
 *
 * De acá sale **de quién es una conversación**. Si la normalización falla de
 * menos, el vínculo automático no encuentra a un jugador que sí está y el
 * operador atiende a ciegas — molesto, visible, se arregla. Si falla de más,
 * **el operador ve el nombre de otra persona** sin ninguna señal de que algo
 * pasó, y le habla de la plata de un tercero.
 *
 * Los dos errores no cuestan lo mismo, así que los casos están escritos con esa
 * asimetría: ante la duda, `null`.
 */

import {
  claveDeTelefono,
  mismoTelefono,
  telefonoE164,
  variantesDeTelefono,
} from './telefono';

describe('claveDeTelefono', () => {
  /**
   * El caso que motiva todo el módulo. Las cinco escrituras son la misma
   * persona: la que manda WhatsApp, la que dicta por teléfono, la que está
   * copiada de una agenda vieja.
   */
  it('las escrituras de un mismo móvil dan la misma clave', () => {
    const esperada = '543415551234';
    for (const escritura of [
      '+54 9 341 555-1234',
      '+5493415551234',
      '5493415551234',
      '0341 15 555-1234',
      '0341155551234',
      '341 555-1234',
      '3415551234',
      '+54 341 555 1234',
    ]) {
      expect(claveDeTelefono(escritura)).toBe(esperada);
    }
  });

  it('el 9 de móvil no cambia la clave: es la misma persona', () => {
    // Es la trampa entera del módulo. En E.164 estricto son dos números
    // distintos (+5493415551234 y +543415551234) y en la realidad no.
    expect(claveDeTelefono('+5493415551234')).toBe(
      claveDeTelefono('+543415551234'),
    );
  });

  it('funciona igual con un área de dos dígitos (AMBA)', () => {
    const esperada = '541144445555';
    for (const escritura of [
      '+54 9 11 4444-5555',
      '011 15-4444-5555',
      '11 4444-5555',
      '1144445555',
    ]) {
      expect(claveDeTelefono(escritura)).toBe(esperada);
    }
  });

  it('un número de otro país conserva su código', () => {
    expect(claveDeTelefono('+1 415 555 2671')).toBe('14155552671');
  });

  describe('lo que devuelve null — ante la duda, nadie', () => {
    it.each([
      ['vacío', ''],
      ['sólo espacios', '   '],
      ['texto', 'no es un teléfono'],
      ['demasiado corto', '1234'],
      ['sin área', '15-4444-5555'],
      ['null', null],
      ['undefined', undefined],
    ])('%s', (_caso, entrada) => {
      expect(claveDeTelefono(entrada)).toBeNull();
    });
  });

  it('un número sin área NO se completa con el país por defecto', () => {
    // `15-4444-5555` es un móvil de algún lado, y no se sabe de dónde.
    // Adivinarle un área sería vincular a alguien por medio número.
    expect(claveDeTelefono('15-4444-5555')).toBeNull();
    expect(claveDeTelefono('4444-5555')).toBeNull();
  });

  it('dos personas distintas no comparten clave', () => {
    expect(claveDeTelefono('341 555-1234')).not.toBe(
      claveDeTelefono('341 555-1235'),
    );
    // Mismo abonado, distinta área: son dos personas.
    expect(claveDeTelefono('341 555-1234')).not.toBe(
      claveDeTelefono('351 555-1234'),
    );
  });
});

describe('telefonoE164', () => {
  it('devuelve la forma para mostrar, con el 9 del móvil', () => {
    expect(telefonoE164('0341 15 555-1234')).toBe('+5493415551234');
  });

  it('no es lo mismo que la clave, y por eso son dos funciones', () => {
    // Si alguien usa `telefonoE164` para comparar, esto es lo que le pasa.
    expect(telefonoE164('0341 15 555-1234')).not.toBe(
      telefonoE164('341 555-1234'),
    );
    expect(claveDeTelefono('0341 15 555-1234')).toBe(
      claveDeTelefono('341 555-1234'),
    );
  });

  it('null si no es un número', () => {
    expect(telefonoE164('cualquier cosa')).toBeNull();
  });
});

describe('variantesDeTelefono', () => {
  it('cubre las cinco escrituras de un móvil del interior', () => {
    const v = variantesDeTelefono('+54 9 341 555-1234');

    expect(v).toEqual(
      expect.arrayContaining([
        '3415551234', // nacional
        '03415551234', // con el 0
        '0341155551234', // con el 0 y el 15
        '5493415551234', // internacional móvil (lo que manda WhatsApp)
        '543415551234', // internacional sin el 9
      ]),
    );
  });

  it('cubre las de AMBA, donde el área son dos dígitos', () => {
    const v = variantesDeTelefono('+54 9 11 4444-5555');

    expect(v).toEqual(
      expect.arrayContaining([
        '1144445555',
        '01144445555',
        '0111544445555',
        '5491144445555',
        '541144445555',
      ]),
    );
  });

  it('todas las escrituras del mismo número dan el mismo conjunto', () => {
    // Es lo que hace que la consulta encuentre al jugador sin importar cómo
    // llegó el número.
    const desdeWhatsapp = variantesDeTelefono('5493415551234').sort();
    const comoLoEscribioElCajero = variantesDeTelefono('0341 15 555-1234').sort();
    const comoLoDictoElJugador = variantesDeTelefono('341 555 1234').sort();

    expect(comoLoEscribioElCajero).toEqual(desdeWhatsapp);
    expect(comoLoDictoElJugador).toEqual(desdeWhatsapp);
  });

  it('son sólo dígitos: la consulta compara contra la columna ya limpia', () => {
    for (const v of variantesDeTelefono('+54 9 341 555-1234')) {
      expect(v).toMatch(/^\d+$/);
    }
  });

  it('sin repetidos', () => {
    const v = variantesDeTelefono('+54 9 341 555-1234');
    expect(new Set(v).size).toBe(v.length);
  });

  it('un número que no se puede interpretar no genera ninguna', () => {
    // `[]` hace que la consulta no matchee nada. Devolver algo genérico haría
    // que matchee cualquiera.
    expect(variantesDeTelefono('cualquier cosa')).toEqual([]);
    expect(variantesDeTelefono(null)).toEqual([]);
  });

  it('un número de otro país no recibe las variantes argentinas', () => {
    const v = variantesDeTelefono('+1 415 555 2671');
    expect(v).toEqual(expect.arrayContaining(['4155552671', '14155552671']));
    expect(v.some((x) => x.startsWith('0'))).toBe(false);
  });
});

describe('mismoTelefono', () => {
  it('reconoce al mismo escrito distinto', () => {
    expect(mismoTelefono('0341 15 555-1234', '+5493415551234')).toBe(true);
    expect(mismoTelefono('341 555-1234', '+5493415551234')).toBe(true);
  });

  it('distingue a dos personas', () => {
    expect(mismoTelefono('341 555-1234', '341 555-1235')).toBe(false);
  });

  it('dos números ilegibles NO son el mismo', () => {
    // Con `null === null` serían iguales, y dos contactos sin teléfono
    // quedarían fusionados en uno.
    expect(mismoTelefono(null, null)).toBe(false);
    expect(mismoTelefono('', '')).toBe(false);
    expect(mismoTelefono('cualquiera', 'otra cosa')).toBe(false);
  });
});
