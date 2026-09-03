/**
 * Monitor de caída, fuera del VPS.
 *
 * ## Por qué existe separado de la API
 *
 * Todas las demás alertas las manda la propia API. Ésta no puede: **si la API
 * está caída, no puede avisar que está caída.** Por eso vive en Cloudflare
 * Workers, que corre en la red de Cloudflare y no tiene nada que ver con
 * nuestro servidor.
 *
 * ## Qué chequea
 *
 * Cada corrida pega a dos lugares y espera HTTP 200:
 *
 *   - `api.miamihub.vip/health` — además de estar viva, la API devuelve 503 si
 *     la base de datos o Redis no responden (ver `app.controller.ts`), así que
 *     este chequeo cubre bastante más que "el proceso está levantado".
 *   - `miamihub.vip/play` — la pantalla que ve el jugador.
 *
 * ## Cómo evita ser molesto
 *
 * - Avisa recién al segundo fallo seguido. Un timeout suelto no despierta a
 *   nadie, y algo que se cae de verdad no se arregla en un minuto.
 * - Avisa **una sola vez** mientras dura la caída, no en cada corrida.
 * - Y avisa cuando vuelve, que es la mitad que casi siempre falta: sin eso no
 *   sabés si sigue roto o ya está.
 *
 * ## Lo que NO cubre
 *
 * Corre en Cloudflare, así que es independiente de nuestro VPS pero **no de
 * Cloudflare**. Si el problema fuera de ellos, este monitor podría no verlo.
 * Para lo que nos importa —que el servidor propio se muera— alcanza.
 */

/** A quién le pegamos. `nombre` es lo que se lee en el aviso. */
const OBJETIVOS = [
  { clave: 'api', nombre: 'La API', url: 'https://api.miamihub.vip/health' },
  { clave: 'web', nombre: 'El casino', url: 'https://miamihub.vip/play' },
];

/** Fallos seguidos antes de avisar. */
const FALLOS_PARA_AVISAR = 2;

/** Cuánto esperamos cada chequeo antes de darlo por caído. */
const TIMEOUT_MS = 10_000;

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(revisarTodo(env));
  },

  /**
   * Además del cron, responde por HTTP para poder probarlo a mano sin esperar
   * al próximo minuto. No expone nada sensible: sólo dice cómo vio cada cosa.
   *
   * Con `?ping=1` manda un aviso de prueba al grupo en vez de chequear.
   */
  async fetch(request, env) {
    // Prueba del canal, a pedido.
    //
    // Mismo criterio que `ALERTS_BOOT_PING` en la API: un canal de avisos falla
    // en silencio. Si el token quedó mal o el grupo es otro, no te enterás hasta
    // el día que pasa algo y no llega nada — y justamente ese día es el peor
    // para descubrirlo.
    //
    // Antes, la única forma de probarlo era apuntar un objetivo a una URL que no
    // existe, desplegar, esperar dos minutos y revertir. Además de incómodo,
    // mandaba al grupo un aviso que decía "los jugadores no pueden entrar",
    // indistinguible de una caída real. Esto manda UN mensaje que se lee como lo
    // que es, y no toca el estado en KV.
    if (new URL(request.url).searchParams.has('ping')) {
      const r = await avisar(env, {
        icono: '🔵',
        titulo: 'Prueba del monitor de caída',
        detalle:
          'Si ves esto, el monitor que corre fuera del VPS puede avisar.\n\n' +
          'Es una prueba, no hay ningún problema.',
      });
      // Se devuelve lo que contestó Telegram, no un "listo" optimista: la
      // pregunta que responde esta ruta es justamente si el aviso llega.
      return new Response(JSON.stringify({ ping: r }, null, 2), {
        status: r.ok ? 200 : 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const estado = await revisarTodo(env);
    return new Response(JSON.stringify(estado, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};

async function revisarTodo(env) {
  const salida = {};
  for (const o of OBJETIVOS) {
    salida[o.clave] = await revisar(o, env);
  }
  return salida;
}

async function revisar(objetivo, env) {
  const { ok, detalle } = await pegar(objetivo.url);

  // El estado vive en KV. Se ESCRIBE sólo cuando algo cambia: el plan gratis
  // permite 1000 escrituras por día, y una por minuto se las comería.
  const clave = `estado:${objetivo.clave}`;
  const previo = (await env.ESTADO.get(clave, 'json')) ?? { fallos: 0, avisado: false };

  if (ok) {
    if (previo.avisado) {
      await avisar(env, {
        icono: '🟢',
        titulo: `${objetivo.nombre} volvió`,
        detalle: `${objetivo.url}\n\nYa responde normalmente.`,
      });
    }
    if (previo.fallos !== 0 || previo.avisado) {
      await env.ESTADO.put(clave, JSON.stringify({ fallos: 0, avisado: false }));
    }
    return { ok: true };
  }

  const fallos = previo.fallos + 1;
  const debeAvisar = fallos >= FALLOS_PARA_AVISAR && !previo.avisado;

  if (debeAvisar) {
    await avisar(env, {
      icono: '🔴',
      titulo: `${objetivo.nombre} no responde`,
      detalle: [
        objetivo.url,
        '',
        detalle,
        '',
        `Falló ${fallos} veces seguidas.`,
        'Los jugadores no pueden entrar.',
      ].join('\n'),
    });
  }

  if (fallos !== previo.fallos || debeAvisar) {
    await env.ESTADO.put(
      clave,
      JSON.stringify({ fallos, avisado: previo.avisado || debeAvisar }),
    );
  }
  return { ok: false, fallos, detalle };
}

/** Un chequeo. Nunca tira: un error de red ES el resultado que buscamos. */
async function pegar(url) {
  try {
    const r = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Sin caché: un 200 guardado no dice nada del estado de ahora.
      cf: { cacheTtl: 0, cacheEverything: false },
      headers: { 'User-Agent': 'miamihub-uptime/1.0' },
    });
    // 3xx cuenta como vivo: `/play` puede redirigir al login según la sesión.
    if (r.status >= 200 && r.status < 400) return { ok: true };
    return { ok: false, detalle: `Respondió HTTP ${r.status}.` };
  } catch (err) {
    return { ok: false, detalle: `No se pudo conectar: ${err.message}` };
  }
}

/**
 * Manda el aviso. **Nunca tira** — quien la llama no puede fallar por esto.
 *
 * Devuelve qué pasó, y eso no es decorativo: sin el resultado, `?ping=1` diría
 * "enviado" aunque Telegram lo hubiera rechazado, que es precisamente el modo
 * de falla que tenemos que poder detectar. Cuando un grupo básico se convierte
 * en supergrupo, Telegram le cambia el `chat_id` y responde 400 al viejo: las
 * alertas dejan de llegar y nada avisa. Una prueba que no mira la respuesta no
 * distingue ese caso de uno sano.
 */
async function avisar(env, { icono, titulo, detalle }) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_ALERT_CHAT_ID) {
    return { ok: false, motivo: 'sin TELEGRAM_BOT_TOKEN o TELEGRAM_ALERT_CHAT_ID' };
  }
  const texto = `${icono} <b>${escapar(titulo)}</b>\n\n${escapar(detalle)}`;
  try {
    const r = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_ALERT_CHAT_ID,
          text: texto,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      },
    );
    if (r.ok) return { ok: true };

    // El cuerpo del error trae el motivo (`description`) y, si el grupo migró,
    // el id nuevo en `parameters.migrate_to_chat_id`. Se devuelve tal cual: acá
    // no hay logs que mirar después.
    const cuerpo = await r.text().catch(() => '');
    return { ok: false, status: r.status, motivo: cuerpo.slice(0, 300) };
  } catch (err) {
    // Si Telegram no contesta no hay mucho más que hacer desde acá.
    return { ok: false, motivo: `no se pudo conectar: ${err.message}` };
  }
}

function escapar(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
