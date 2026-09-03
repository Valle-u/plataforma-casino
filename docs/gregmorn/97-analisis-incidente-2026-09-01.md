# Análisis del incidente del 2026-09-01 (usuario `yesicaprueba`)

Reconstrucción con datos de producción de la sesión de pruebas que generó las
capturas de error que se le mandaron al proveedor. Todas las horas son **UTC**
(AR = UTC−3).

> **Cómo se sacó**: consultas de sólo lectura contra `tenant_miamihub`. Los logs
> del contenedor de esa ventana ya no existían — Swarm poda los contenedores
> viejos y ese día la API se redeployó varias veces. **El rastro durable es la
> base**, y alcanzó para atribuir la falla.

---

> # ⚠️ CORRECCIÓN (2026-09-02) — LEER ANTES QUE NADA
>
> **La causa era nuestra: se había agotado el saldo de nuestra cuenta en el
> panel de Gregmorn.** Lo confirmó el propio proveedor por Telegram, a las 11:40
> (hora AR) del 2026-09-02, respondiendo al mensaje con las mediciones:
>
> > *"Hello, the balance on your account in our admin panel has run out. Please
> > try again now."*
>
> Y efectivamente, al recargar volvió a funcionar todo.
>
> **Las mediciones de este documento siguen siendo válidas. Lo que estaba mal es
> la inferencia.** Cada observación se hizo sobre el saldo del **jugador** —que
> estaba bien, y eso quedó probado— pero existe un segundo saldo que desde
> nuestra base **es invisible**:
>
> | | Dónde vive | ¿Lo vemos? |
> |---|---|---|
> | Saldo del **jugador** | nuestra base (`wallet_transactions`) | ✅ sí |
> | Saldo de **nuestro hall** con Gregmorn | el panel de ellos | ❌ no, ni por API |
>
> Al descartar el único saldo que se podía ver, el análisis dedujo que no quedaba
> otra explicación que la de ellos. Era la explicación que faltaba mirar.
>
> **Con un hall sin fondos, el síntoma es exactamente el que se documentó acá**:
> el juego abre, muestra `CRÉDITO 0,00` y no manda un solo callback, aunque
> nosotros contestemos el `getBalance` perfecto — porque el juego nunca llega a
> quedar fondeado. Una sola causa explica los tres incidentes de la noche.
>
> **Qué se hizo con esto** (ver `apps/api/src/games/games-health.cron.ts`):
> se construyó el detector que faltaba, porque esta falla **no genera ningún
> error** — la API contestó 93 callbacks con HTTP 200 y ni un 4xx en todo el día.
> Busca la firma "hubo aperturas de juego y ninguna apuesta" y habría avisado a
> los ~40 minutos, en vez de las 18 horas que tardó un jugador en quejarse.
>
> ⚠️ **El saldo del hall no se puede consultar por API** — el OpenAPI de Gregmorn
> tiene sólo `login`, `openGame`, `getUserGames` y el `apiIndividualWallet` que
> no usamos. **Sí se ve en su panel de stage**
> (`https://office-dev.gamble-hub.net/login`, con las credenciales de
> integración). Ese panel y la alerta son las dos únicas formas de enterarse.
>
> **Nada de esto quedó mal con el proveedor**: ellos mismos identificaron la
> causa al recibir las mediciones, y se les respondió reconociéndolo.

---

## 1. La conclusión

> ⚠️ **Esta sección quedó desmentida.** Ver la corrección de arriba: la causa era
> el saldo agotado de nuestro hall. Se preserva el texto original porque los
> datos que cita son correctos y siguen sirviendo.

**~~La falla no es nuestra.~~** De 05:44 en adelante hubo **10 aperturas de
juego**; nuestra API devolvió la URL en todas. Gregmorn mandó **un solo callback
en dos de ellas y cero en las otras ocho**. El último callback de toda la sesión
fue a las **05:49:26**: después hubo siete aperturas más sin una sola señal de su
lado.

Un juego que no manda ni una apuesta es un juego que nunca llegó a jugarse.
~~La falla está entre su cliente y sus servidores, después de que soltamos la
URL.~~ **Nunca llegó a jugarse porque nuestro hall estaba sin fondos.**

## 2. La línea de tiempo

| Hora (UTC) | Qué pasó |
|---|---|
| 05:26:55 | primera apertura |
| 05:28 – 05:42 | **juego normal**: 7 juegos, 116 rondas, 4–16 rondas por minuto |
| **05:42:13** | **última ronda normal**. Saldo 12.195 — no se quedó sin plata |
| 05:44:16 | carga de 50.000 fichas → saldo 62.195 |
| 05:47:29 | una apuesta suelta (100) |
| 05:49:26 | una apuesta suelta (100). **Último callback de Gregmorn** |
| 05:50 – 06:09 | 7 aperturas más. Nada |

Los reintentos se ven en los datos: **tres juegos distintos abiertos en 14
segundos** (05:51:28, :34, :42). Volvió a intentar 13 minutos después y seguía
roto.

### El detalle que corrige una hipótesis

La primera lectura fue que la carga de fichas había causado el problema. **Es al
revés.** El juego cortó a las 05:42:13 **con 12.195 de saldo** y la carga vino
recién a las 05:44:16. O sea que la carga fue la *reacción* al cartel de
`CRÉDITO 0,00`: creyeron que faltaba saldo. No faltaba, y cargar no lo arregló —
después de la carga entraron dos apuestas de 100 y nada más.

## 3. Números

| | |
|---|---|
| Sesiones abiertas | 25 |
| Rondas | 117, **todas `settled`** |
| Callbacks recibidos | 140 (`writeBet`), ninguno después de 05:49:26 |
| Apostado / ganado | 65.410 / 27.455 |
| Aperturas que no generaron ninguna apuesta | 10 (todas después de 05:44) |

**Cero rondas trabadas y cero rollbacks.** Este incidente no dejó plata colgada:
el problema de las rondas abiertas es otro asunto.

## 4. Lo que NO se puede probar

**Si nuestro `getBalance` estaba fallando.** No lo registramos en ningún lado:
`gregmorn_transactions` sólo guarda los callbacks que mueven plata. De esa
ventana no quedan ni logs ni eventos — Sentry se prendió 14 horas después.

- **A favor de que estábamos bien**: los `writeBet` de 05:47 y 05:49 se
  procesaron perfecto, así que la API estaba viva y respondiendo.
- **En contra**: `getBalance` es otro camino de código y podría fallar solo.

✅ **TAPADO** (2026-09-01, después del tercer reporte). Cada `getBalance` deja
una fila en `gregmorn_balance_checks` con el saldo que contestamos. De ahora en
más el `CRÉDITO 0,00` es una pregunta con respuesta: o consta que devolvimos el
saldo correcto, o consta que fallamos.

⚠️ Y había una hipótesis concreta de bug propio que ahora se puede verificar:
`handleGetBalance` devuelve `UNKNOWN_PLAYER` si no resuelve al jugador por su
`login`, y en ese caso el juego se queda sin saldo — **exactamente el síntoma**
**reportado**. Ese caso ahora además se loguea como WARNING.

## 5. Hallazgos nuestros que salieron de paso

### 5.1 Las IPs que guardábamos eran de Cloudflare — ARREGLADO

La prueba es de los datos, no de una teoría: **la misma IP aparecía asociada a 5
a 8 usuarios distintos**, y todos los rangos (172.68/69/71, 104.22/23) son de
Cloudflare. `api.miamihub.vip` está detrás de CF (`Server: cloudflare`,
`CF-RAY`), así que el primer valor de `X-Forwarded-For` no es el cliente.

Esto cierra el pendiente del addendum 8, **con respuesta negativa**: el arreglo
que se había deployado le mandaba al proveedor IPs de Cloudflare. Mejor que una
IP fija de datacenter, pero seguía sin ser la del jugador.

Ahora se usa `CF-Connecting-IP`, que Cloudflare siempre escribe con la IP real y
pisa lo que mande el cliente.

⚠️ **Supone que todo el tráfico entra por Cloudflare.** El origen todavía acepta
conexiones directas — blindar el firewall del VPS a los rangos de CF es la fase 2
de `docs/25-seguridad-cloudflare.md`.

### 5.2 Cada apertura dejaba una sesión muerta — ARREGLADO

El callback armaba una clave sintética `gregmorn:<login>:<gameId>` y buscaba la
sesión por ahí. El launch, en cambio, guarda el `sessionId` que devuelve el
proveedor. **Las dos claves nunca coincidían**, así que:

- la sesión del launch —con la IP, el user-agent y el saldo real— quedaba **sin
  una sola ronda**;
- las rondas se colgaban de una segunda sesión **sin IP y con `opened_balance`
  en 0**.

En producción eran **296 de 383 sesiones (77%) vacías**. Nunca se podía atar una
ronda a una IP.

No hacía falta inventar nada: **los callbacks traen el mismo `sessionid` que
guardamos al abrir**. Verificado — los 2124 callbacks de la tabla matchean una
sesión de launch. Ahora se busca por ahí, y la clave sintética queda sólo como
red de contención por si algún callback llega sin `sessionid` (en el camino de la
plata, no encontrar la sesión no puede significar perder la apuesta).

### 5.3 El `provider_session_id` correlaciona con los dos namespaces

Los `black:pragmatic:*` devuelven un id numérico (`70091553`); los `greece:*`
devuelven el **JWT entero**. Es evidencia concreta para la pregunta #3 del
mensaje al proveedor: las dos líneas del catálogo no son sólo ids duplicados,
**devuelven respuestas con forma distinta**.

## 6. Lo que queda pendiente

- ✅ ~~Registrar el `getBalance`~~ — hecho, ver §4.
- ⚠️ **Palace tiene el mismo problema de sesiones** que se arregló en Gregmorn
  (§5.2): su callback también arma `palace:<account>:<game_code>` y el launch
  guarda `account`. Tiene 727 callbacks, así que no es teórico. No se tocó acá
  porque hay que verificar primero si su protocolo trae un id de sesión propio,
  como resultó tenerlo Gregmorn. Forever tiene el mismo patrón pero **0
  tráfico**.
- ⚠️ **5 tests e2e de `gregmorn-callback` están en rojo** desde el cambio al
  modelo de acumulación del 2026-09-01. Buscan la ronda por el `roundId` cuando
  ahora se identifica por el `transactionId`: **están viejos, el código está
  bien** — verificado corriéndolos contra el código sin los cambios de este
  análisis, fallan igual. Igual hay que arreglarlos: un suite rojo en el camino
  de la plata deja de avisar.

---

## 7. Segundo incidente, misma noche (21:41–21:54 UTC)

Uriel mandó la consola y una captura de **Sweet Bonanza 1000** con el cartel
*"¡Acceda a su cuenta!"* al apostar. Datos frescos que refinan todo lo anterior.

### 7.1 Nuestro lado está limpio, y ahora con prueba

La captura muestra **`CRÉDITO 2.066,01 ARS`**. El wallet del usuario decía
exactamente `2066.01`, y la sesión guardó `opened_balance = 2066.01`.

**O sea que el `getBalance` funciona perfecto** — el juego cargó y mostró el
saldo correcto. Eso descarta la duda que quedaba abierta en §4 sobre el
`CRÉDITO 0,00`: cuando el saldo se muestra mal, no es que no sepamos
contestarlo.

Además: Sentry en **cero errores de API y de web en 24h**, ninguna ronda
trabada, y otros juegos apostando bien en la misma ventana (Bee Keeper 4
rondas 21:52, Olympus Glory 2 rondas 21:51, Gates of Olympus 1000 21:51).

La falla es **sólo al apostar**, y de las seis aperturas fallidas **no llegó ni
un callback**.

### 7.2 El mgckey de 100 segundos, reconfirmado

Tres aperturas de `greece:700:30010` a las 21:45:00, 21:45:56 y 21:46:35. Los
tres JWT traen `exp - iat = 100` exacto. Confirma el hallazgo del addendum 8 con
muestras nuevas.

⚠️ **Pero no explica todo**: la captura que falló es
`black:pragmatic:1011`, cuyo `mgckey` **no es un JWT** sino
`70120106_<hash>`. Ahí no hay expiración visible. Son dos formatos distintos
según el namespace, y los dos fallan.

### 7.3 Ignoran la `ip` que les mandamos

**Esto cierra el pendiente del addendum 8, y la respuesta es peor de lo que
parecía.** El JWT de las 21:45 —posterior al deploy del arreglo— sigue trayendo:

```
"UserIp":"157.180.34.113"
```

La misma IP fija de datacenter de antes. Y sí la estamos mandando: el payload de
`openGame` incluye `ip` cuando viene, y `opened_from_ip` de esas sesiones tiene
un valor real. **Mandamos el campo y ellos no lo usan.**

O sea que el arreglo de la IP no falló por Cloudflare (ver §5.1, que igual era un
bug real y está arreglado): falló porque **del otro lado ese campo no se aplica**.
Es pregunta directa para ellos.

### 7.4 Sweet Bonanza no está muerto: es intermitente

| Entrada | game_id | Callbacks históricos | Anoche |
|---|---|---|---|
| Sweet Bonanza™ | `black:pragmatic:658` | 467 | ✅ 21 callbacks a las 21:41 |
| Sweet Bonanza 1000 | `black:pragmatic:1011` | 131 | ❌ 0 en 3 aperturas |
| Sweet Bonanza | `greece:700:30010` | 82 | ❌ 0 en 3 aperturas |

Las tres funcionaron mucho antes. Falla y vuelve.

### 7.5 Juegos que NUNCA generaron una apuesta

Barriendo el catálogo entero, 26 juegos tienen cero callbacks. Los abiertos una
sola vez no prueban nada (el jugador pudo mirar y cerrar), pero estos sí:

| Juego | game_id | Aperturas | Callbacks |
|---|---|---|---|
| Cleopatra MegaJackpots | `black:igt:275` | 7 | **0** |
| Shining Hot 100 | `greece:700:30022` | 5 | **0** |
| Jokers Jewels Cash | `greece:700:30250` | 3 | **0** |
| Sweet Harvest | `black:microgaming:327` | 3 | **0** |
| Señor Muerto | `greece:210:40012` | 3 | **0** |
| Masques Of San Marco | `black:igt:273` | 3 | **0** |

⚠️ **Patrón por estudio**: las tres entradas de IGT (`black:igt:271/273/275`)
suman **12 aperturas y cero apuestas**. Ninguna funcionó nunca. Eso ya no parece
intermitencia sino un estudio que no está habilitado para nosotros.

### 7.6 Un bug nuestro que salió en la consola

La consola del navegador mostró **~30 respuestas 401 seguidas** en `me`,
`notifications/me/unread-count` y `wallet/me/transactions`: la sesión de esa
pestaña estaba muerta y **el front seguía polleando igual, para siempre**, en vez
de mandar al login. No causa el freeze del juego (los callbacks son
server-to-server) pero es carga inútil y una pantalla que miente.

También hubo `ERR_BLOCKED_BY_CLIENT` y dos fallos de `postMessage` contra
`challenges.cloudflare.com`: **un bloqueador de anuncios rompiendo el Turnstile**,
que es el captcha del login. Probablemente por eso la sesión no se renovó.

### 7.7 Qué preguntarles ahora

1. ¿Por qué un juego que anduvo 467 veces deja de aceptar apuestas y vuelve?
   Nuestro `openGame` devuelve 200 y no llega ningún callback.
2. El `mgckey` dura 100s en los juegos `greece:` y tiene otro formato en los
   `black:`. ¿Cuál es la vida útil real de cada uno?
3. Mandamos `ip` en `openGame` y su token sigue diciendo
   `UserIp: 157.180.34.113` para todos los jugadores. ¿El campo se aplica?
4. Los tres juegos de IGT nunca aceptaron una apuesta en 12 aperturas.
   ¿Están habilitados para nuestro hall?

---

## 8. El `CRÉDITO 0,00` medido (23:09 UTC)

> ⚠️ **El título decía "la prueba definitiva" y no lo era.** Los datos de acá son
> correctos y valiosos —son los que hicieron que el proveedor encontrara la
> causa— pero la conclusión que se sacaba de ellos estaba mal. Ver la corrección
> del encabezado.

Media hora después de empezar a registrar los `getBalance`, el jugador volvió a
abrir **6 Jokers** (`greece:700:30163`) y el juego mostró otra vez
`CRÉDITO 0,00 ARS`. Esta vez sí quedó registrado qué contestamos:

| Hora (UTC) | Login | Saldo que devolvimos | Resultado |
|---|---|---|---|
| 23:09:16 | `usertest_1` | **2066.01** | `ok` |
| 23:09:36 | `usertest_1` | **2066.01** | `ok` |

El wallet real decía `2066.01`. La sesión guardó `opened_balance = 2066.01`. La
IP registrada fue la real del jugador.

**Nos preguntaron dos veces, contestamos bien las dos veces, y el juego mostró
cero.** Eso sigue siendo cierto y sigue siendo la medición más útil del
documento.

~~No hay margen de interpretación: el saldo se pierde del lado de ellos, entre
nuestra respuesta y lo que dibuja el juego.~~

**Sí había margen, y era éste**: el juego no mostraba cero porque perdiera
nuestra respuesta, sino porque **nuestro hall estaba sin fondos** y el juego
nunca llegó a quedar fondeado. Nuestro `getBalance` era correcto e irrelevante
al mismo tiempo — se contestaba bien una pregunta que ya no cambiaba nada.

💡 **La lección, que es lo que vale guardar**: contestar bien una pregunta no
prueba que el problema sea del que la hizo. Faltaba una variable que ni siquiera
se podía mirar desde nuestra base, y el análisis trató "descarté todo lo que veo"
como si fuera "descarté todo". Antes de atribuirle una falla a un tercero,
conviene preguntarse qué parte del sistema no se está pudiendo observar.

### Queda descartada la hipótesis de bug propio

§4 dejaba abierta la posibilidad de que `handleGetBalance` estuviera devolviendo
`UNKNOWN_PLAYER` — el caso en que el juego se queda legítimamente sin saldo. **No
es eso**: el resultado registrado es `ok` en las dos llamadas. El jugador se
resolvió perfecto.

### El error que tira su motor

Con los rodillos vacíos, su engine crashea solo:

```
Uncaught TypeError: Cannot read properties of undefined (reading 'length')
    at VS_Reel.GetReelScreenSymbols
    at VS_Reel.GetNextSymbol
    at VS_Reel.SymbolLeftTheReel
    at VS_ReelSymbolHolder.UpdateVisual
```

Es código de ellos (`build.1757704797000.js`) intentando leer los símbolos de los
rodillos. El juego arranca sin recibir su configuración y explota al dibujar.

### Dato menor

En el callback de `getBalance` **no mandan `gameId`** (queda `null`). Sin el
`sessionid` no se podría saber a qué juego corresponde cada consulta.
