# Monitor de caída (Cloudflare Worker)

Avisa por Telegram cuando la plataforma deja de responder.

## Por qué está acá y no en la API

Es la única alerta que **no puede** salir de nuestro servidor: si la API está
caída, no puede avisar que está caída. Por eso corre en la red de Cloudflare,
que no tiene nada que ver con el VPS.

⚠️ Es independiente del VPS, **no de Cloudflare**. Si el problema fuera de ellos,
este monitor podría no verlo. Para lo que nos importa —que el servidor propio se
muera— alcanza.

## Qué hace

Cada minuto le pega a `api.miamihub.vip/health` y a `miamihub.vip/play`.

- Avisa recién al **segundo fallo seguido**, así un timeout suelto no despierta
  a nadie.
- Avisa **una sola vez** por caída, no cada minuto.
- Y **avisa cuando vuelve** — sin eso no sabés si sigue roto o ya se arregló.

El chequeo de la API cubre más de lo que parece: `/health` devuelve 503 si la
base de datos o Redis no responden, no sólo si el proceso está muerto.

## Instalación (una sola vez)

Desde esta carpeta:

```bash
npx wrangler login
```

Crear el almacenamiento donde guarda el estado:

```bash
npx wrangler kv namespace create ESTADO
```

Eso imprime un `id`. Copiarlo en `wrangler.toml`, reemplazando
`PENDIENTE_COMPLETAR`.

Cargar los dos secretos (los pide de forma interactiva, no quedan en el repo ni
en el historial de la terminal):

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_ALERT_CHAT_ID
```

Son los mismos valores que ya están en Dokploy para la API.

Y desplegar:

```bash
npx wrangler deploy
```

## Cómo probar que anda

El Worker también responde por HTTP, así que no hace falta esperar al próximo
minuto ni romper nada:

```bash
curl https://miamihub-uptime.<tu-subdominio>.workers.dev
```

Devuelve cómo vio cada objetivo. Con todo sano:

```json
{ "api": { "ok": true }, "web": { "ok": true } }
```

Para probar el aviso de verdad, cambiar temporalmente una URL de `OBJETIVOS` en
`src/worker.js` por una que no exista, desplegar, esperar dos minutos y ver que
llegue el mensaje al grupo. Después revertir.

## Ajustes

Están arriba de todo en `src/worker.js`:

| | |
|---|---|
| `OBJETIVOS` | qué se chequea |
| `FALLOS_PARA_AVISAR` | fallos seguidos antes de avisar (2) |
| `TIMEOUT_MS` | cuánto se espera cada chequeo (10s) |

La frecuencia está en `wrangler.toml`, en `crons`.

## Costo

Cero. Entra holgado en el plan gratis: 1.440 corridas por día contra un límite
de 100.000, y las escrituras a KV son sólo cuando algo cambia de estado.
