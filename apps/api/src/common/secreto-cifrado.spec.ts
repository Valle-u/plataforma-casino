/**
 * Cifrado de secretos de canal (D20).
 *
 * Sin base de datos: es una función pura. Lo que se fija acá no es el algoritmo
 * —eso lo garantiza Node— sino **las decisiones**: que sin clave no se guarde
 * nada, que un texto manipulado falle en vez de devolver basura, y que rotar la
 * clave sea posible.
 */

import { randomBytes } from 'node:crypto';
import {
  cifrar,
  descifrar,
  estaCifrado,
  hayClaveDeSecretos,
  igualEnTiempoConstante,
  SecretoIlegibleError,
  SecretoSinClaveError,
} from './secreto-cifrado';

const CLAVE_A = randomBytes(32).toString('hex');
const CLAVE_B = randomBytes(32).toString('hex');

/** Un token de bot de Telegram real tiene esta forma. */
const TOKEN = '7891234567:AAF-xYzAbCdEfGhIjKlMnOpQrStUvWxYz12';

const envOriginal = { ...process.env };

function conClave(actual?: string, previa?: string): void {
  delete process.env.CHANNEL_SECRET_KEY;
  delete process.env.CHANNEL_SECRET_KEY_PREVIOUS;
  if (actual) process.env.CHANNEL_SECRET_KEY = actual;
  if (previa) process.env.CHANNEL_SECRET_KEY_PREVIOUS = previa;
}

afterEach(() => {
  process.env = { ...envOriginal };
});

describe('cifrar / descifrar', () => {
  it('ida y vuelta devuelve el mismo secreto', () => {
    conClave(CLAVE_A);
    expect(descifrar(cifrar(TOKEN))).toBe(TOKEN);
  });

  it('acepta acentos y emojis (el nombre de un canal puede traerlos)', () => {
    conClave(CLAVE_A);
    const raro = 'ñandú · señal 🔒 · "comillas"';
    expect(descifrar(cifrar(raro))).toBe(raro);
  });

  /**
   * El IV es aleatorio en cada cifrado. Sin eso, dos canales con la misma
   * credencial se verían iguales en la columna — y eso ya es información.
   */
  it('cifrar dos veces lo mismo da textos distintos', () => {
    conClave(CLAVE_A);
    const uno = cifrar(TOKEN);
    const dos = cifrar(TOKEN);

    expect(uno).not.toBe(dos);
    expect(descifrar(uno)).toBe(TOKEN);
    expect(descifrar(dos)).toBe(TOKEN);
  });

  it('el formato es v1:iv:tag:cifrado', () => {
    conClave(CLAVE_A);
    const guardado = cifrar(TOKEN);

    expect(guardado.split(':')).toHaveLength(4);
    expect(guardado.startsWith('v1:')).toBe(true);
    // Lo obvio, pero es lo que se está comprando: el token no se lee.
    expect(guardado).not.toContain(TOKEN);
    expect(guardado).not.toContain('7891234567');
  });
});

describe('sin clave no se guarda nada', () => {
  /**
   * ⚠️ **La decisión más importante del archivo.** Un fallback silencioso a
   * texto plano es peor que un error: nadie se entera hasta que se filtra la
   * base, y para entonces ya está en un backup.
   */
  it('cifrar TIRA en vez de devolver el texto plano', () => {
    conClave();
    expect(() => cifrar(TOKEN)).toThrow(SecretoSinClaveError);
  });

  it('descifrar también tira', () => {
    conClave(CLAVE_A);
    const guardado = cifrar(TOKEN);
    conClave();

    expect(() => descifrar(guardado)).toThrow(SecretoSinClaveError);
  });

  it('una clave del largo equivocado se rechaza al leerla, no al usarla', () => {
    conClave('abcd1234');
    // El error de `node:crypto` por un largo malo no dice qué está mal; éste sí.
    expect(() => cifrar(TOKEN)).toThrow(/32 bytes en hexadecimal/);
  });

  it('una clave que no es hexadecimal también', () => {
    conClave('z'.repeat(64));
    expect(() => cifrar(TOKEN)).toThrow(/hexadecimal/);
  });
});

describe('el texto manipulado falla, no devuelve basura', () => {
  it('con otra clave no abre', () => {
    conClave(CLAVE_A);
    const guardado = cifrar(TOKEN);
    conClave(CLAVE_B);

    expect(() => descifrar(guardado)).toThrow(SecretoIlegibleError);
  });

  /**
   * Es lo que agrega GCM sobre cifrar a secas: si alguien edita la fila en la
   * base, descifrar falla. Sin autenticación devolvería bytes cualquiera y el
   * sistema intentaría usarlos como token.
   */
  it('si se edita un byte del cifrado, falla', () => {
    conClave(CLAVE_A);
    const [v, iv, tag, texto] = cifrar(TOKEN).split(':') as [
      string, string, string, string,
    ];
    const roto = Buffer.from(texto, 'base64');
    roto[0] = roto[0]! ^ 0xff;

    expect(() =>
      descifrar([v, iv, tag, roto.toString('base64')].join(':')),
    ).toThrow(SecretoIlegibleError);
  });

  it('si se edita el tag, falla', () => {
    conClave(CLAVE_A);
    const [v, iv, , texto] = cifrar(TOKEN).split(':') as [
      string, string, string, string,
    ];
    const otroTag = randomBytes(16).toString('base64');

    expect(() => descifrar([v, iv, otroTag, texto].join(':'))).toThrow(
      SecretoIlegibleError,
    );
  });

  it('un formato que no es el nuestro falla con un mensaje claro', () => {
    conClave(CLAVE_A);
    expect(() => descifrar('7891234567:AAF-xYz')).toThrow(/formato/);
  });

  it('una versión desconocida falla y lo dice', () => {
    conClave(CLAVE_A);
    const [, iv, tag, texto] = cifrar(TOKEN).split(':') as [
      string, string, string, string,
    ];
    expect(() => descifrar(['v9', iv, tag, texto].join(':'))).toThrow(
      /versión desconocida/,
    );
  });
});

describe('rotación de la clave', () => {
  /**
   * Sin este segundo intento, rotar la clave significa dejar ilegible todo lo
   * guardado. Con él, se pone la nueva en `CHANNEL_SECRET_KEY`, la vieja en
   * `_PREVIOUS`, y las filas se re-cifran a medida que se tocan.
   */
  it('lo cifrado con la clave vieja se sigue leyendo', () => {
    conClave(CLAVE_A);
    const guardado = cifrar(TOKEN);

    conClave(CLAVE_B, CLAVE_A); // rotamos: B es la nueva, A la anterior
    expect(descifrar(guardado)).toBe(TOKEN);
  });

  it('y lo nuevo se cifra con la clave nueva', () => {
    conClave(CLAVE_B, CLAVE_A);
    const guardado = cifrar(TOKEN);

    conClave(CLAVE_B); // sacamos la vieja: lo nuevo tiene que seguir abriendo
    expect(descifrar(guardado)).toBe(TOKEN);
  });

  it('sacar la clave vieja deja ilegible lo que no se re-cifró', () => {
    conClave(CLAVE_A);
    const viejo = cifrar(TOKEN);

    conClave(CLAVE_B); // rotación terminada, sin `_PREVIOUS`
    expect(() => descifrar(viejo)).toThrow(SecretoIlegibleError);
  });
});

describe('helpers', () => {
  it('estaCifrado reconoce lo nuestro y descarta el texto plano', () => {
    conClave(CLAVE_A);
    expect(estaCifrado(cifrar(TOKEN))).toBe(true);
    expect(estaCifrado(TOKEN)).toBe(false);
    expect(estaCifrado('')).toBe(false);
  });

  it('hayClaveDeSecretos avisa si falta configurar', () => {
    conClave(CLAVE_A);
    expect(hayClaveDeSecretos()).toBe(true);
    conClave();
    expect(hayClaveDeSecretos()).toBe(false);
  });

  it('igualEnTiempoConstante compara sin cortar en el primer byte', () => {
    expect(igualEnTiempoConstante('abc', 'abc')).toBe(true);
    expect(igualEnTiempoConstante('abc', 'abd')).toBe(false);
    // Largos distintos: `timingSafeEqual` tira, así que se chequea antes.
    expect(igualEnTiempoConstante('abc', 'abcd')).toBe(false);
    expect(igualEnTiempoConstante('', '')).toBe(true);
  });
});
