/**
 * La ventana de 24 horas de WhatsApp (**3.4**).
 *
 * Sin red y sin base. Lo que se fija acá es **cuándo hay que avisar**, que es
 * donde está el riesgo: el modo de falla de esta regla no es un error en
 * pantalla, es un mensaje que el operador da por enviado y nunca llega.
 */

import { HORAS_DE_LA_VENTANA, ventanaDe } from './ventana-24h';

const HORA = 60 * 60 * 1000;
const AHORA = new Date('2026-09-10T18:00:00.000Z');

describe('a qué canales les aplica', () => {
  /**
   * ⚠️ **Telegram no tiene ventana.** Si la persona le escribió al bot alguna
   * vez, el bot le contesta cuando quiera.
   *
   * Un aviso de más acá no sería inofensivo: un cartel que aparece donde no
   * corresponde enseña a ignorarlo, y entonces tampoco se lee en WhatsApp, que
   * es el único lugar donde importa.
   */
  it('en Telegram no hay ventana', () => {
    expect(
      ventanaDe({ channelType: 'telegram', ultimoInbound: AHORA }),
    ).toBeNull();
  });

  it('en el livechat web tampoco', () => {
    expect(
      ventanaDe({ channelType: 'web-livechat', ultimoInbound: AHORA }),
    ).toBeNull();
  });

  it('en WhatsApp sí', () => {
    expect(
      ventanaDe({ channelType: 'whatsapp', ultimoInbound: AHORA }),
    ).not.toBeNull();
  });
});

describe('cuándo vence', () => {
  it('24 horas después del último mensaje del cliente', () => {
    const v = ventanaDe({ channelType: 'whatsapp', ultimoInbound: AHORA });

    expect(v?.vence).toBe(
      new Date(AHORA.getTime() + HORAS_DE_LA_VENTANA * HORA).toISOString(),
    );
  });

  /**
   * ⚠️ **La trampa de D11.** El hilo es eterno: una conversación cerrada se
   * reabre cuando la persona vuelve a escribir. Pero reabrir el hilo **no
   * reabre la ventana** — si el último mensaje del cliente fue hace meses, ya
   * venció, y la conversación se ve igual de normal que cualquier otra.
   */
  it('un inbound de hace meses da un vencimiento en el pasado', () => {
    const enMarzo = new Date('2026-03-12T10:00:00.000Z');

    const v = ventanaDe({ channelType: 'whatsapp', ultimoInbound: enMarzo });

    expect(new Date(v!.vence!).getTime()).toBeLessThan(AHORA.getTime());
  });

  /**
   * La cuenta va sobre el último **inbound**, no sobre el último mensaje: que el
   * operador escriba no le da 24 horas más. Acá se fija pasándole el inbound
   * viejo aunque después hubiera habido respuestas.
   */
  it('no se mueve porque el operador haya respondido después', () => {
    const inbound = new Date(AHORA.getTime() - 20 * HORA);

    const v = ventanaDe({ channelType: 'whatsapp', ultimoInbound: inbound });

    expect(v?.vence).toBe(
      new Date(inbound.getTime() + HORAS_DE_LA_VENTANA * HORA).toISOString(),
    );
  });
});

describe('los dos "no hay fecha", que no son lo mismo', () => {
  /**
   * ⚠️ **El caso más peligroso, y el más fácil de colapsar con el otro.**
   *
   * Es WhatsApp y el cliente nunca escribió: la ventana **no se abrió nunca**,
   * así que no sale texto libre. Si esto devolviera `null` —como un canal sin
   * ventana— la pantalla no mostraría ningún aviso y el operador escribiría
   * creyendo que llega.
   */
  it('WhatsApp sin ningún inbound: aplica, pero no hay vencimiento', () => {
    expect(ventanaDe({ channelType: 'whatsapp', ultimoInbound: null })).toEqual({
      vence: null,
    });
  });

  it('un canal sin ventana devuelve null, no un objeto', () => {
    expect(ventanaDe({ channelType: 'telegram', ultimoInbound: null })).toBeNull();
  });
});

describe('cómo llega la fecha desde la base', () => {
  /**
   * La subconsulta del último inbound es SQL crudo, así que **no pasa por el
   * mapeo de tipos de Drizzle**: el `timestamptz` puede llegar como `Date` o
   * como string. Aceptar sólo uno dejaría la ventana en `null` —sin aviso—
   * justo cuando había que avisar.
   */
  it('un string ISO se lee igual que un Date', () => {
    const comoTexto = ventanaDe({
      channelType: 'whatsapp',
      ultimoInbound: AHORA.toISOString(),
    });
    const comoFecha = ventanaDe({
      channelType: 'whatsapp',
      ultimoInbound: AHORA,
    });

    expect(comoTexto).toEqual(comoFecha);
  });

  it('una fecha ilegible no inventa un vencimiento', () => {
    expect(
      ventanaDe({ channelType: 'whatsapp', ultimoInbound: 'cualquier cosa' }),
    ).toEqual({ vence: null });
  });
});
