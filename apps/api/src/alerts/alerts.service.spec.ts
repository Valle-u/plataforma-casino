/**
 * AlertsService — el canal de avisos operativos.
 *
 * **Por qué este archivo.** Es el componente que avisa cuando algo le pasa al
 * casino, y no tenía una sola prueba. Su propio comentario dice la razón por la
 * que eso es peligroso: *un canal de avisos falla en silencio*. Si se rompe, no
 * hay síntoma — simplemente dejan de llegar mensajes, y eso se ve igual que "no
 * pasó nada".
 *
 * Lo que se fija acá son las tres reglas que el servicio promete y de las que
 * dependen los demás crons:
 *
 *   1. **Nunca tira.** Un aviso que no se pudo mandar no puede tumbar una
 *      apuesta.
 *   2. **No spamea**, pero tampoco se traga un aviso perdido: si el envío
 *      falla, la alerta se puede reintentar pronto.
 *   3. **Escapa el HTML.** Los detalles llevan nombres de juego y de usuario;
 *      un `<` sin escapar rompe el mensaje entero en Telegram.
 */

import { AlertsService, type Alerta } from './alerts.service';

const TOKEN = '123456:fake-token';
const CHAT = '-1001234567890';

/** Una alerta cualquiera, para no repetir el objeto en cada test. */
function alerta(over: Partial<Alerta> = {}): Alerta {
  return {
    clave: 'prueba',
    nivel: 'critico',
    titulo: 'Algo pasó',
    detalle: 'Detalle del problema.',
    ...over,
  };
}

/** Lo que Telegram contestaría. */
function respuesta(ok: boolean, cuerpo = '{}', status = ok ? 200 : 400) {
  return {
    ok,
    status,
    text: async () => cuerpo,
  } as unknown as Response;
}

describe('AlertsService', () => {
  const envOriginal = { ...process.env };
  let fetchMock: jest.Mock;
  let servicio: AlertsService;

  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    process.env.TELEGRAM_ALERT_CHAT_ID = CHAT;
    fetchMock = jest.fn().mockResolvedValue(respuesta(true));
    global.fetch = fetchMock as unknown as typeof fetch;
    servicio = new AlertsService();
    // El servicio loguea los fallos; no queremos el ruido en la salida.
    jest.spyOn(servicio['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(servicio['logger'], 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = { ...envOriginal };
    jest.restoreAllMocks();
  });

  describe('sin configurar', () => {
    it('no llama a Telegram y no rompe', async () => {
      delete process.env.TELEGRAM_BOT_TOKEN;
      const s = new AlertsService();
      jest.spyOn(s['logger'], 'warn').mockImplementation(() => undefined);

      await expect(s.enviar(alerta())).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(s.habilitado).toBe(false);
    });
  });

  describe('el envío', () => {
    it('manda al chat configurado', async () => {
      await servicio.enviar(alerta());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain(`/bot${TOKEN}/sendMessage`);
      const body = JSON.parse(String(init.body)) as { chat_id: string; text: string };
      expect(body.chat_id).toBe(CHAT);
      expect(body.text).toContain('Algo pasó');
    });

    it('el ícono del nivel va adelante, para leerlo de un vistazo', async () => {
      await servicio.enviar(alerta({ nivel: 'critico' }));
      const body = JSON.parse(
        String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body),
      ) as { text: string };
      expect(body.text.startsWith('🔴')).toBe(true);
    });

    it('escapa el HTML del título y del detalle', async () => {
      // Los detalles llevan nombres de juego y de usuario. Con `parse_mode:
      // HTML`, un `<` sin escapar hace que Telegram rechace el mensaje entero
      // --- se pierde el aviso por culpa del nombre de un juego.
      await servicio.enviar(
        alerta({ titulo: 'Juego <b>raro</b>', detalle: 'user <script> & cía' }),
      );
      const body = JSON.parse(
        String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body),
      ) as { text: string };

      expect(body.text).toContain('&lt;b&gt;raro&lt;/b&gt;');
      expect(body.text).toContain('&lt;script&gt;');
      expect(body.text).toContain('&amp;');
      // El <b> del título lo pone el servicio, no el contenido.
      expect(body.text).toContain('<b>');
    });
  });

  describe('no spamea', () => {
    it('la misma clave no se manda dos veces seguidas', async () => {
      await servicio.enviar(alerta());
      await servicio.enviar(alerta());
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('claves distintas no se pisan', async () => {
      await servicio.enviar(alerta({ clave: 'una' }));
      await servicio.enviar(alerta({ clave: 'otra' }));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('con silencioMin 0 se manda siempre', async () => {
      // Es lo que usa el parte diario: es un informe agendado, no una alerta.
      await servicio.enviar(alerta({ silencioMin: 0 }));
      await servicio.enviar(alerta({ silencioMin: 0 }));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('vuelve a mandar cuando pasó la ventana', async () => {
      jest.useFakeTimers();
      try {
        await servicio.enviar(alerta({ silencioMin: 30 }));
        jest.advanceTimersByTime(31 * 60_000);
        await servicio.enviar(alerta({ silencioMin: 30 }));
        expect(fetchMock).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('cuando Telegram falla', () => {
    it('no tira: un aviso perdido no puede tumbar una apuesta', async () => {
      fetchMock.mockRejectedValue(new Error('sin red'));
      await expect(servicio.enviar(alerta())).resolves.toBeUndefined();
    });

    it('tampoco tira si contesta con error HTTP', async () => {
      fetchMock.mockResolvedValue(respuesta(false, 'Bad Request', 400));
      await expect(servicio.enviar(alerta())).resolves.toBeUndefined();
    });

    it('se puede reintentar pronto en vez de callarse la ventana entera', async () => {
      // El caso que esto arregla: una alerta crítica que se pierde por un error
      // de red Y ADEMÁS queda silenciada 30 minutos. Perder el aviso es malo;
      // perderlo y silenciarlo es el peor de los dos mundos.
      jest.useFakeTimers();
      try {
        fetchMock.mockRejectedValue(new Error('sin red'));
        await servicio.enviar(alerta({ silencioMin: 30 }));
        expect(fetchMock).toHaveBeenCalledTimes(1);

        // A los 3 minutos ya se puede reintentar (la ventana de reintento es 2).
        jest.advanceTimersByTime(3 * 60_000);
        fetchMock.mockResolvedValue(respuesta(true));
        await servicio.enviar(alerta({ silencioMin: 30 }));
        expect(fetchMock).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it('pero no machaca: al minuto todavía no reintenta', async () => {
      jest.useFakeTimers();
      try {
        fetchMock.mockRejectedValue(new Error('sin red'));
        await servicio.enviar(alerta({ silencioMin: 30 }));
        jest.advanceTimersByTime(60_000);
        await servicio.enviar(alerta({ silencioMin: 30 }));
        expect(fetchMock).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('el grupo convertido en supergrupo', () => {
    // Telegram cambia el chat_id cuando un grupo se convierte, y el viejo deja
    // de existir. Es la peor forma de romperse: las alertas dejan de llegar y
    // nada avisa.
    const migracion = JSON.stringify({
      ok: false,
      parameters: { migrate_to_chat_id: -1009999999999 },
    });

    it('reintenta en el id nuevo para no perder ESTE aviso', async () => {
      fetchMock
        .mockResolvedValueOnce(respuesta(false, migracion, 400))
        .mockResolvedValueOnce(respuesta(true));

      await servicio.enviar(alerta());

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const segundo = JSON.parse(
        String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body),
      ) as { chat_id: string };
      expect(segundo.chat_id).toBe('-1009999999999');
    });

    it('avisa fuerte en el log cuál es el id nuevo', async () => {
      const error = jest.spyOn(servicio['logger'], 'error');
      fetchMock
        .mockResolvedValueOnce(respuesta(false, migracion, 400))
        .mockResolvedValueOnce(respuesta(true));

      await servicio.enviar(alerta());

      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('-1009999999999'),
      );
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('TELEGRAM_ALERT_CHAT_ID'),
      );
    });

    it('una respuesta de error que no es JSON no rompe', async () => {
      fetchMock.mockResolvedValue(respuesta(false, '<html>502</html>', 502));
      await expect(servicio.enviar(alerta())).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
