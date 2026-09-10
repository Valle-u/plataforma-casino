/**
 * La firma de Meta (**3.2**). Sin red y sin base.
 *
 * **Estos tests son la razón por la que el 3.2 se puede construir con la cuenta
 * de Meta todavía en trámite**: las firmas se fabrican con la misma función que
 * usaría Meta, y el verificador no sabe la diferencia.
 */

import { firmaDeMetaValida, firmarComoMeta } from './firma-de-meta';

const SECRETO = 'app-secret-de-prueba';
const CUERPO = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });

describe('una firma legítima', () => {
  it('valida', () => {
    expect(
      firmaDeMetaValida({
        crudo: CUERPO,
        firmaRecibida: firmarComoMeta(CUERPO, SECRETO),
        appSecret: SECRETO,
      }),
    ).toBe(true);
  });

  it('los bytes crudos y su texto utf-8 dan la misma firma', () => {
    expect(firmarComoMeta(Buffer.from(CUERPO, 'utf8'), SECRETO)).toBe(
      firmarComoMeta(CUERPO, SECRETO),
    );
  });

  it('Meta manda el prefijo sha256=, y se acepta con mayúsculas', () => {
    const firma = firmarComoMeta(CUERPO, SECRETO);
    expect(firma.startsWith('sha256=')).toBe(true);
    expect(
      firmaDeMetaValida({
        crudo: CUERPO,
        firmaRecibida: firma.toUpperCase(),
        appSecret: SECRETO,
      }),
    ).toBe(true);
  });
});

describe('lo que NO tiene que validar', () => {
  it('otra clave', () => {
    expect(
      firmaDeMetaValida({
        crudo: CUERPO,
        firmaRecibida: firmarComoMeta(CUERPO, 'otra-clave'),
        appSecret: SECRETO,
      }),
    ).toBe(false);
  });

  it('el cuerpo cambiado después de firmar', () => {
    const firma = firmarComoMeta(CUERPO, SECRETO);
    expect(
      firmaDeMetaValida({
        crudo: CUERPO.replace('entry', 'ENTRY'),
        firmaRecibida: firma,
        appSecret: SECRETO,
      }),
    ).toBe(false);
  });

  it('sin header de firma', () => {
    expect(
      firmaDeMetaValida({ crudo: CUERPO, firmaRecibida: undefined, appSecret: SECRETO }),
    ).toBe(false);
  });

  it('sin el prefijo del algoritmo', () => {
    const soloHex = firmarComoMeta(CUERPO, SECRETO).replace('sha256=', '');
    expect(
      firmaDeMetaValida({ crudo: CUERPO, firmaRecibida: soloHex, appSecret: SECRETO }),
    ).toBe(false);
  });

  /**
   * ⚠️ **Sin secreto configurado NO se acepta.** No verificar no es lo mismo que
   * aceptar: si esto devolviera `true`, un entorno al que le falta la variable
   * —staging recién levantado, un contenedor mal configurado— se tragaría
   * cualquier cosa que le peguen al webhook. Mismo criterio que D20 con
   * `cifrar()`: antes que un fallback silencioso, que no funcione.
   */
  it('sin App Secret configurado, aunque la firma "coincida"', () => {
    expect(
      firmaDeMetaValida({
        crudo: CUERPO,
        firmaRecibida: firmarComoMeta(CUERPO, ''),
        appSecret: undefined,
      }),
    ).toBe(false);
  });

  it('sin cuerpo crudo', () => {
    expect(
      firmaDeMetaValida({
        crudo: undefined,
        firmaRecibida: firmarComoMeta(CUERPO, SECRETO),
        appSecret: SECRETO,
      }),
    ).toBe(false);
  });

  it('una firma de otro largo no rompe la comparación', () => {
    expect(
      firmaDeMetaValida({ crudo: CUERPO, firmaRecibida: 'sha256=abc', appSecret: SECRETO }),
    ).toBe(false);
  });
});

/**
 * ⚠️ **La trampa que arruina esta clase de integración.**
 *
 * `JSON.stringify` de lo que parseó Nest no devuelve los mismos bytes que mandó
 * Meta. Y el modo de falla es el peor: **no falla siempre**. Falla cuando el
 * mensaje trae un acento, un emoji o un número en notación distinta — o sea,
 * cuando escribe una persona real.
 */
describe('por qué hay que firmar los bytes crudos', () => {
  it('re-serializar un cuerpo con acentos cambia la firma', () => {
    // Lo que mandaría Meta: el acento escapado.
    const deMeta = '{"nombre":"Mart\\u00edn"}';
    const firma = firmarComoMeta(deMeta, SECRETO);

    // Lo que devuelve JSON.stringify(JSON.parse(...)): el acento literal.
    const reSerializado = JSON.stringify(JSON.parse(deMeta) as unknown);

    expect(reSerializado).not.toBe(deMeta);
    expect(
      firmaDeMetaValida({ crudo: reSerializado, firmaRecibida: firma, appSecret: SECRETO }),
    ).toBe(false);
    // Y con los bytes crudos, valida.
    expect(
      firmaDeMetaValida({ crudo: deMeta, firmaRecibida: firma, appSecret: SECRETO }),
    ).toBe(true);
  });

  it('un espacio de más también', () => {
    const conEspacios = '{ "a": 1 }';
    const firma = firmarComoMeta(conEspacios, SECRETO);
    expect(
      firmaDeMetaValida({
        crudo: JSON.stringify(JSON.parse(conEspacios) as unknown),
        firmaRecibida: firma,
        appSecret: SECRETO,
      }),
    ).toBe(false);
  });
});
