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
| 2026-08-28 | Se les re-preguntan las 3 abiertas. **Contestan las 3**: el `user_id` sale del `/auth/login`; `3.78.156.229` es su única IP y avisarán antes de sumar otras; y para el `rollback` **aprueban `cmd + transactionId`** ("Yes, you can do it this way") después de consultarlo con su equipo de desarrollo. |
| 2026-08-28 | Se les avisa que el problema era **nuestro**: Cloudflare Bot Fight Mode desafiaba sus callbacks en el borde. Se les corrige además que el `callbackUrl` **sí** se lee (sacarlo devolvía HTTP 500). Se les pide la lista completa de IPs de egreso y se reportan los 40 juegos en vivo con `url: ""`. |
| 2026-08-29 | **Responden 2 de 2**: `3.78.156.229` es la IP de **Prod** y `18.184.217.6` la de **Stage** (hay que sumar la de Prod al migrar); y los juegos en vivo **no soportan ARS**, así que los **quitaron de la cuenta** — piden re-sincronizar. Quedan abiertas las de rondas sin cerrar, semántica del `roundId` y rollback (ver `98-pendientes-proveedor.md`). |

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
- **Sus IPs de callbacks:** `18.184.217.6` (**Stage**) y `3.78.156.229`
  (**Prod**). ⚠️ Durante días dieron sólo la de Prod diciendo que era "la
  única", mientras estábamos en Stage — de ahí que los callbacks llegaran
  desde una IP que no coincidía con la declarada. Lo aclararon el 2026-08-29.
  ✅ **Verificado el 2026-08-31 contra la API de Cloudflare: no hay nada
  pendiente.** La regla `Gregmorn callbacks` exceptúa la RUTA del callback
  desde cualquier IP, así que las dos funcionan sin listarlas; y además
  `3.78.156.229` ya tiene su propia regla. Ver `99-integration-plan.md`.
- **`callbackUrl` por request** en `openGame`: confirmado. Nos evita depender de la
  configuración por moneda de su panel.
- **Credenciales de Stage:** login, password y secret API key.

## Lo que falta

**Nada del lado de ellos.** Las tres preguntas abiertas se cerraron el 2026-08-28:

1. **`user_id`** → es el `user.id` que devuelve `/auth/login`. **No se carga a
   mano**: `GregmornClient.resolveUserId()` lo deriva del login y lo cachea junto
   al `accessToken`. El setting quedó como override por si algún día cambia.
2. **Idempotencia del `rollback`** → **`cmd + transactionId` aprobado**. Es lo que
   ya asumía la implementación, así que no hubo que rehacer nada.
3. **IP única** → resultó que no: `3.78.156.229` es la de Prod y
   `18.184.217.6` la de Stage. Se comprometieron a avisar antes de sumar
   servidores. Igual conviene tratar un callback desde una IP desconocida como
   incidente, no como caso normal.

Del lado nuestro **tampoco queda nada de Cloudflare** (verificado 2026-08-31).
Lo único es pegar las credenciales de Stage en el panel.

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
| `game_provider.gregmorn.user_id` | **Override opcional — normalmente vacío.** Sale solo del `/auth/login`. |
| `game_provider.gregmorn.currency` | Moneda de las sesiones. `ARS`. |
| `game_provider.gregmorn.win_max_amount` | Techo de sanidad del `win` (E7). Espeja el de Palace y Forever. |
| `game_provider.gregmorn.callback_url` | La que se manda en cada `openGame`. Sin esto el juego real no mueve saldo. |
| `game_provider.gregmorn.exit_url` | A dónde vuelve el jugador al cerrar el juego. Obligatorio en su API. |
| `game_provider.gregmorn.language` | Idioma del launch (ISO corto). Default `es`. |

**Flujo correcto de carga:** el dueño las pega en Panel → Ajustes → Proveedores de
juego, una vez que el conector exista y registre esas claves. Nunca por chat, nunca
en el código.

## Nota de seguridad

Las credenciales de Stage se compartieron por un canal no seguro durante el
traspaso interno. Son de Stage y el dueño decidió no pedir reemisión. **Las de Prod
deben cargarse directo en el panel**, sin pasar por ningún canal intermedio.
