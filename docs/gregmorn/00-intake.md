# Gregmorn — 00 · Intake

Qué recibimos, qué falta y dónde va cada cosa. Se actualiza a medida que responden.

## Línea de tiempo

| Fecha | Qué pasó |
|---|---|
| 2026-08-28 | Piden nuestra IP y callback URL. Se las mandamos. |
| 2026-08-28 | Mandan su documentación (`docs.gregmorn.org` + OpenAPI). Se revisa entera. |
| 2026-08-28 | Se les mandan 4 preguntas (ARS, credenciales, idempotencia del rollback, override del callbackUrl). |
| 2026-08-28 | Responden: **ARS sí**, su IP es `3.78.156.229`, el `callbackUrl` se puede pasar por request. **No contestan la del rollback.** |
| 2026-08-28 | Mandan login, password y secret key de Stage. Falta el `user_id`. |

## Lo que les dimos

- **IP saliente nuestra** (para su allowlist): `147.93.32.111`. Es una sola IP
  estática; sirve para Stage y Prod.
- **Callback URL**:
  `https://api.miamihub.vip/api/v1/game-provider/gregmorn/callback` — POST,
  `application/json`.
- **Aviso de Cloudflare**: el dominio está proxeado, tienen que pegarle al hostname
  y no a la IP (el origen está bloqueado en el firewall).

## Lo que nos dieron

- **ARS soportado.** Era el bloqueante.
- **Su IP de callbacks:** `3.78.156.229`.
- **`callbackUrl` por request** en `openGame`: confirmado. Nos evita depender de la
  configuración por moneda de su panel.
- **Credenciales de Stage:** login, password y secret API key.

## Lo que falta

1. **`user_id`.** Es obligatorio en `openGame` y en
   `GET /users/{user_id}/getUserGames/{currencyISO}`, y ellos lo usan para resolver
   qué `secret_api_key` valida la firma. Puede que sea el `user.id` que devuelve
   `/auth/login` — hay que confirmarlo, no asumirlo.
2. **Cómo identificar un `rollback`** frente al bet que revierte. Ver la trampa #1
   del README.
3. **Si `3.78.156.229` es su única IP de salida.** Si mañana suman servidores, los
   callbacks empiezan a fallar sin aviso.

## Dónde van las credenciales

**No van en variables de entorno ni en ningún archivo del repo.** Van a
`tenant_settings`, con claves `game_provider.gregmorn.*`, validadas por el registry
(`apps/api/src/tenant-settings/tenant-settings.registry.ts`). Es el mismo criterio
que Forever: las credenciales son **por tenant**, cada operador tiene las suyas.

La tabla `game_providers` guarda solo el estado operativo (habilitado, mantenimiento,
último sync/ping) — no credenciales. Está documentado en el docblock de
`packages/db/src/tenant/game-providers.ts`.

Claves previstas:

| Clave | Para qué |
|---|---|
| `game_provider.gregmorn.api_url_office` | Host de auth y catálogo. Stage: `https://office-api-dev.gregmorn.org` |
| `game_provider.gregmorn.api_url_client` | Host de `openGame`. Stage: `https://client-api-dev.gregmorn.org` |
| `game_provider.gregmorn.login` | Usuario de la API. |
| `game_provider.gregmorn.password` | Password de la API. |
| `game_provider.gregmorn.secret_api_key` | Clave del HMAC de `X-Signature`. |
| `game_provider.gregmorn.user_id` | Identificador que ellos usan para resolver la secret key. |
| `game_provider.gregmorn.currency` | Moneda de las sesiones. `ARS`. |
| `game_provider.gregmorn.win_max_amount` | Techo de sanidad del `win` (E7). Espeja el de Palace y Forever. |

**Flujo correcto de carga:** el dueño las pega en Panel → Ajustes → Proveedores de
juego, una vez que el conector exista y registre esas claves. Nunca por chat, nunca
en el código.

## Nota de seguridad

Las credenciales de Stage se compartieron por un canal no seguro durante el
traspaso interno. Son de Stage y el dueño decidió no pedir reemisión. **Las de Prod
deben cargarse directo en el panel**, sin pasar por ningún canal intermedio.
