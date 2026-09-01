# Gregmorn — pendientes con el proveedor

> Cosas que necesitan respuesta de ellos (`GH_Support_Dave`). Se escribe en
> **inglés**, sin saludo: la conversación ya está abierta.
>
> Última actualización: 2026-09-01. **Las tres respondidas.** Queda como
> registro de lo que contestaron y de qué se hizo con cada respuesta.

---

## 1. Rondas que nunca se cierran (RESPONDIDO — 2026-09-01)

> ## La respuesta, y por qué cambió el diseño
>
> **Una ronda abierta no está rota: está esperando.** Si el jugador abandona a
> mitad de un bonus, **retienen la sesión de su lado hasta que vuelva**. Cuánto
> la retienen depende del proveedor del juego: **de un día a una semana**, sin
> un timeout único. Si se vence la retención sin que el jugador vuelva, **la
> ronda se cancela y se emite un reembolso**.
>
> O sea que toda ronda se resuelve sola, por una de dos vías:
>
> 1. El jugador vuelve → llega el `round_finished: true`.
> 2. No vuelve → llega un `rollback`, que `GregmornCallbackService` marca como
>    `rolled_back` y el motor de comisiones EXCLUYE. Correcto sin hacer nada.
>
> Confirmaron además que **no existe endpoint para consultar el estado de una
> ronda**: `round_finished` es el único marcador. No es un hueco nuestro.
>
> ⚠️ **Esto invalidó la primera versión de nuestra reconciliación**, que cerraba
> las rondas a las 2 HORAS de inactividad. Cerrar una ronda la mete en la base
> de comisión; si esa ronda terminaba reembolsada, se le pagaba comisión al
> operador sobre plata devuelta al jugador. Y dejaba inútil el freno de
> `settlePeriods`, que nunca se disparaba porque el job ya había cerrado justo
> las rondas que todavía podían revertirse.
>
> **Qué se hizo** (`RoundsReconciliationService`, commit `cc0dd58`): nada se
> cierra antes de **10 días** (por encima de su máximo de una semana). Por
> debajo el sistema espera, que es lo correcto. Cerrar una ronda pasó a ser la
> excepción y se loguea como WARNING: significa que no la resolvieron ni
> cerrándola ni reembolsándola en diez días.

### Lo que se les había reportado

**Qué pasa.** Mandan `round_finished: false` en todos los callbacks de una ronda
y, en algunas, **nunca llega el `true`**. La ronda queda abierta para siempre.

**Evidencia (Stage, jugador `maggie`, 2026-08-29 00:18–00:23 UTC):** 3 rondas
lógicas quedaron abiertas, 12+ horas después sin cerrar. La más grande es una
compra de tiradas gratis:

```
00:19:16  spin        bet 5000.00  win 250.00   round_finished: false
00:19:40  pick        bet    0.00  win   0.00   round_finished: false
00:19:48  freeSpin    bet    0.00  win   0.00   round_finished: false
   ...      (28 acciones freeSpin / freeReSpin)
00:23:42  freeReSpin  bet    0.00  win  10.00   round_finished: false   ← la ultima
```

Todas con `roundId=1787962756` (el de adentro de `info`).

**Por qué nos importa.** La base de comisión sólo cuenta rondas cerradas
(`status = 'settled'`, ver LEY C1/C4b). Una ronda que nunca cierra es NetWin que
la Casa ganó y que no se le paga al operador: en este caso **4.172,05 ARS**.

**Qué hay que preguntarles.**
- ¿La ronda sigue abierta de su lado, o se cerró y el callback no llegó?
- Si el jugador abandona con tiradas gratis pendientes, ¿cómo la cierran? ¿Hay
  timeout? ¿Mandan el `round_finished: true` igual, aunque sea tarde?
- ¿Hay algún endpoint para consultar el estado de una ronda y reconciliar?

**Por qué NO lo resolvemos solos.** Se podría cerrar por antigüedad, pero ya
vimos un cierre llegar 13 minutos tarde. Sin saber su ventana máxima, un cierre
automático arriesga contar la ronda dos veces.

---

## 2. Semántica del `roundId` (RESUELTO — 2026-09-01)

Mandan **dos** identificadores distintos y el de arriba no sirve para agrupar:

| Campo | Ejemplo | Comportamiento observado |
|---|---|---|
| `roundId` (nivel superior) | `c271dc8d-ed2e-…` | **UUID distinto en CADA callback** |
| `roundId` (dentro de `info`) | `1787962756` | **estable** en toda la ronda lógica |

Nuestro código agrupa hoy por el de `info` (ver `resolveRoundExternalId`).

**Su respuesta (2026-08-31) desautoriza justamente eso:**

- El `roundId` de nivel superior es **opcional** y depende del proveedor.
- El de adentro de `info` **no es parte de su contrato**: formato y estabilidad
  dependen del proveedor y **pueden cambiar sin aviso**.
- Recomiendan agrupar por `transactionId` + el flag `round_finished`.
- Los valores de `action` son del proveedor: **no garantizan la lista**.

### El problema con su recomendación, y la lectura que sí funciona

Agrupar por `transactionId` **no agrupa una ronda**: cada acción trae el suyo.
En la compra de tiradas gratis que les reportamos:

```
MX1_69929384_14_001916   spin, bet 5000
MX1_69929384_15_001939   pick
MX1_69929384_16_001948   freeSpin      (+28 más)
```

Leído literal, daría una ronda por callback — el bug que veníamos de arreglar.

La lectura que **sí** cierra con todos los datos: *acumular transacciones hasta
recibir `round_finished: true`*, y tratar todo lo que va desde el cierre
anterior como una ronda. Funciona con el formato viejo (`_0` false, `_1` true)
y con la compra (30 callbacks, ninguno true). Se les pidió que lo confirmen.

**Ventaja si confirman**: usa solo campos documentados. Se dejaría de depender
de `info`, tanto para agrupar como para detectar la compra (`byBonus`).

**Estaba frenado** porque con ese modelo una ronda que nunca cierra se traga
todo lo que el jugador juegue después, y sin la respuesta al punto 1 el cambio
era peor que lo actual.

✅ **2026-09-01: destrabado.** Confirmaron que el modelo de acumulación es la
lectura correcta de su recomendación y que sólo usa campos documentados. Y la
respuesta al punto 1 acota el riesgo: una ronda no queda abierta para siempre —
se resuelve sola en una semana como máximo, cerrándose o reembolsándose.

✅ **Hecho el 2026-09-01** (commit `4ba5d0b`). Se busca la ronda abierta de la
sesión y se acumula ahí; si no hay, se abre una nueva con `round_external_id` =
el `transactionId` de ese callback.

Tres cosas que el cambio traía y no estaban previstas acá:

1. **Una ronda cancelada no manda `round_finished: true`, manda un rollback.**
   Sin marcarla quedaría abierta y el próximo callback del jugador se
   acumularía encima. `markRoundRolledBack` ahora busca por `transactionId`,
   que calza solo: el rollback repite el del bet y el bet es el primer callback
   de la ronda.
2. **Se perdió el índice único como protección.** `(session_id,
   round_external_id)` impedía que dos callbacks simultáneos crearan dos
   rondas; con acumulación ya no aplica, y no había ningún lock. Se agregó una
   transacción con la sesión bloqueada.
3. **Corte de 24h.** Si el proveedor deja una ronda abierta sin mandar ni el
   `true` ni el rollback, sin corte se tragaría todo lo que el jugador juegue
   después. Una ronda ACTIVA no dura un día.

⚠️ **`byBonus` sigue saliendo de `info`**: no hay campo documentado que
distinga una compra de tiradas de un giro común. Este cambio nos sacó de `info`
para AGRUPAR, no para clasificar. Degrada solo.

---

## 3. Rollback en Stage (CERRADO — no se puede)

**Su respuesta (2026-08-31):** no pueden iniciar un rollback de su lado. Solo se
puede probar en producción, apostando y después anulando.

Se decidió **no insistir**. Consecuencia a tener presente: ese handler se va a
estrenar con plata real. Cuando llegue el momento, conviene que la primera
anulación en producción sea una hecha a propósito y mirándola, no una que
aparezca sola.

---

## 4. Los 40 juegos de casino en vivo (RESUELTO — 2026-08-29)

Devolvían `url: ""` con `StateId: "0"` al abrirlos. **Respondieron:** esos
juegos **no soportan ARS** y los **quitaron de nuestra cuenta**. Pidieron
re-sincronizar el catálogo.

De nuestro lado no hace falta nada especial: el sync ya da de baja
(`is_active = false`) los juegos que dejan de venir en `getUserGames`. Los 40
ya figuran inactivos, así que no aparecen como jugables. Correr un sync más
para confirmar es inocuo.

---

## 5. IPs de origen (RESUELTO — 2026-08-29)

**Respondieron:** `3.78.156.229` es la IP de **producción**; la de **Stage**
es `18.184.217.6`. Durante días sostuvieron que la primera era "la única",
estando nosotros en Stage — de ahí venía el desfasaje que nos costó el
diagnóstico del Bot Fight Mode.

~~⚠️ Al migrar a su Prod hay que sumar `3.78.156.229` a la allowlist de
Cloudflare. Hoy sólo está la de Stage.~~

✅ **Corregido el 2026-08-31: era falso, no hay nada que hacer.** Se leyó la
config real con la API de Cloudflare. Lo que hay es:

- `Gregmorn callbacks` — exceptúa `api.miamihub.vip` +
  `/api/v1/game-provider/gregmorn/callback*` **desde cualquier IP**. Por eso
  Stage funciona sin que su IP figure en ningún lado.
- `Gregmorn diagnostico (temporal)` — `ip.src eq 3.78.156.229`, o sea la de
  **Prod**, ya cargada y activa.

Así que la migración a su Prod no necesita ningún cambio en Cloudflare.

✅ **La regla temporal se borró el 2026-08-31.** Era un `skip` de WAF y rate
limiting para *cualquier* request de esa IP, a cualquier host y ruta, mucho más
amplio de lo necesario. Queda solo `Gregmorn callbacks`, anclada a la ruta.

---

## Borrador del mensaje (enviado 2026-08-29)

> Thanks — 18.184.217.6 is whitelisted, and we will add 3.78.156.229 when we
> move to production. The live games are out of our catalog after a re-sync.
>
> Three things from our side, all on Stage.
>
> **1. Rounds that never close.** Three rounds are still open more than 12
> hours after their last callback. Player `maggie`, 2026-08-29 00:18–00:23
> UTC. The largest is a bonus buy, internal `roundId=1787962756`:
>
> - `spin` — bet 5000, win 250
> - `pick` — bet 0
> - 28 × `freeSpin` / `freeReSpin` — bet 0
>
> Every one of them carries `round_finished: false`, including the last one.
> We never received `round_finished: true`.
>
> Is that round still open on your side? If a player leaves while free spins
> are pending, how does it get closed — is there a timeout, and do you still
> send the closing callback afterwards? Is there an endpoint we can query to
> reconcile round state?
>
> This matters because our commission base only counts closed rounds, so an
> open round is revenue we cannot attribute to the operator.
>
> **2. `roundId` semantics.** You send two identifiers. The top-level
> `roundId` is a different UUID on every callback, while `info` carries
> `roundId=<number>` that stays stable across the whole round. We now group
> rounds by the one inside `info`.
>
> Can you confirm that is the intended contract, and that the `info` format is
> stable? Your spec documents the top-level field but not this one, so we would
> rather not depend on it silently. Could you also share the full list of
> `action` values? So far we have seen `spin`, `reSpin`, `pick`, `freeSpin`,
> `freeReSpin`.
>
> **3. Rollback.** Still never exercised on Stage — it is the only part of the
> money path we have never seen from your system. Could you force one so we can
> verify our handler against a real payload?

---

## Borrador del mensaje (2026-09-01 — respuesta + 4 preguntas nuevas)

> Va con las capturas adjuntas. Mapa de las imágenes:
>
> | # | Qué muestra |
> |---|---|
> | 1 | Catálogo con `Sweet Bonanza` duplicado (las dos rutas) |
> | 2 | Juego que no abre — frame en blanco |
> | 3 | Juego abierto con `CRÉDITO 0,00` mientras el header marca saldo |
> | 4 | *"Error de comunicación — El juego se reiniciará"* |
> | 5 | *"¡UPS! Ha habido un problema"* (id `1_1788241840_1208`) |
> | 6 | *"¡Acceda a su cuenta!"* — el reinicio con el token vencido |
> | 7 | Catálogo, `Life and Death` y `Lovely Lady Deluxe` (los que fallaron) |

```
Thanks — the detail about session retention is what we were missing, and it
changed our design.

We had built a job that closed abandoned rounds after a couple of hours,
assuming they were stuck. Knowing the round is held on your side for up to a
week and then cancelled with a refund, that was closing rounds that could
still resolve — and a closed round enters our commission base, so we would
have paid our partner on money that later went back to the player. We now wait
well past your retention window and let the refund do its job.

On the roundId — we moved to the accumulation model you confirmed. We group
everything until round_finished: true and use the first transactionId of the
round as its identifier, so we no longer depend on the roundId inside info. We
still read info to tell a bonus buy from a regular spin (byBonus), since there
is no documented field for that; if it ever changes, those rounds are simply
classified as free spins, which is fine for us.

Separately, we are seeing intermittent problems on Stage and would value your
read on four things. Screenshots attached.

1. Launch token lifetime. The mgckey in the launch URL is a JWT with
   exp = iat + 100 — every sample we have is exactly 100 seconds. That seems to
   explain a pattern we keep seeing: a game hits a transient error, shows "the
   game will restart", reloads its own URL, and by then the key has expired, so
   the player gets "please log in to your account". Is 100 seconds expected? Is
   there a documented way to refresh it, or should the client request a new
   launch URL on restart?

2. Player IP. We were not sending ip on openGame. In the token you return,
   UserIp was a datacenter address — the same one across four different player
   sessions. We have started sending the real player IP. Should we be sending
   it, and do any studios restrict or reject based on that field?

3. Duplicate catalog entries. getUserGames returns the same titles under two id
   namespaces — for example Sweet Bonanza as black:pragmatic:658 and as
   greece:700:30010, same studio. Our players see the game twice. Are both
   meant to be enabled for us, and which one should we use?

4. Stage stability. Games sometimes take much longer to open than others, and
   sometimes do not open at all (blank frame). Our openGame calls all return
   200 success, so the failure is after we hand off the URL. Is this expected
   on Stage, and should we expect different behaviour on production?

Nothing pending on your side for the round questions — appreciate you being
straight about the mechanism rather than treating it as a gap.
```

**Por qué así**: las cuatro preguntas son concretas y verificables, cada una
con el dato que la respalda. Se les dice también qué cambiamos de nuestro lado
(el `ip`), para que no parezca una lista de reclamos. Y se les cuenta que su
respuesta anterior nos evitó un error de plata: es útil para ellos y honesto de
nuestra parte.

⚠️ **Lo que NO se les dice**: que la inestabilidad puede ser en parte nuestra.
Un deploy deja la API en 502 unos segundos y no hay monitoreo para descartarlo
en la ventana de esas capturas. Si el problema persiste en su Prod, ese es el
primer lugar donde mirar antes de volver a escribirles.

---

## Borrador del mensaje (2026-09-01, segundo envío — evidencia medida)

> Va como **continuación** del mensaje anterior, no lo reemplaza. La diferencia
> es que ahora todo está medido contra producción: horas, ids y montos. Las
> cuatro preguntas de antes siguen en pie; esto les agrega los datos.
>
> Se pasó a registrar cada `getBalance` (tabla `gregmorn_balance_checks`)
> justamente para poder responder el punto 1. Media hora después ya había prueba.

```
Follow-up to our last message. We instrumented our side and now have measured
data on the four points, so here it is rather than more description.

1. The balance our players see is not the balance we return.

   A player opened 6 Jokers (greece:700:30163) twice tonight. You called
   getBalance both times and we answered 2066.01 ARS with a success result:

     23:09:16 UTC  getBalance  login usertest_1  ->  2066.01  ok
     23:09:36 UTC  getBalance  login usertest_1  ->  2066.01  ok

   The player's real wallet balance was 2066.01. The game displayed
   "CREDITO 0,00 ARS". Screenshot attached.

   So the balance is lost between our response and what the game renders. We
   log every getBalance now, with the session id, so we can give you exact
   timestamps for any case you want to look at.

   Two related notes: your getBalance callback does not include gameId, only
   the session id — is that intended? And with an empty balance the game's own
   engine then throws:

     Uncaught TypeError: Cannot read properties of undefined (reading 'length')
       at VS_Reel.GetReelScreenSymbols
       at VS_Reel.GetNextSymbol
       at VS_Reel.SymbolLeftTheReel
     (build.1757704797000.js)

   The reels render empty before it crashes.

2. The ip we send is not the one in your token.

   You asked us to send the player IP and we do. For that same 23:09 launch we
   sent:

     ip = 2803:9800:9013:4d8a:4857:220b:1d3d:8611   (real player, LACNIC)

   and the mgckey you returned for it contains:

     "UserIp": "157.180.34.113"

   That is the same fixed address we see for every player, on every launch,
   before and after we started sending the field. Is the ip parameter applied
   at all? And if it is: we send IPv6, since that is what our players actually
   have. Does your side accept it?

3. Launch token lifetime — confirmed, and there are two formats.

   Every greece:* launch returns the mgckey as a JWT with exp = iat + 100.
   Fresh samples tonight at 21:45:00, 21:45:56, 21:46:35 and 22:54:02 UTC: all
   exactly 100 seconds.

   But black:* launches return a different shape entirely —
   mgckey=70120106_ff1e9ee6b941cc437e58f5b192520bef — with no visible expiry.
   Both fail for us. What is the actual lifetime of each?

4. The same game accepts bets and then stops, with nothing changing on our side.

   Sweet Bonanza (black:pragmatic:658), same player, same day:

     21:41 UTC   21 callbacks, 11 rounds played, no errors
     22:21 UTC   two launches, zero callbacks

   6 Jokers (greece:700:30163) has 254 callbacks in its history and produced
   zero tonight at 22:54 and 23:09.

   In every failing case our openGame returned 200 with a URL, and we received
   no callback of any kind. Our error tracking recorded nothing on our side in
   the whole window.

5. Three games have never accepted a single bet.

   Across our whole catalog history, these were opened repeatedly and never
   produced one callback:

     black:igt:275   Cleopatra MegaJackpots   7 launches, 0 bets
     black:igt:273   Masques Of San Marco     3 launches, 0 bets
     black:igt:271   LilLady                  2 launches, 0 bets

   That is every IGT title we have: 12 launches, zero bets, ever. Others in the
   same situation are greece:700:30022 (Shining Hot 100, 5 launches),
   greece:700:30250 (Jokers Jewels Cash, 3) and black:microgaming:327
   (Sweet Harvest, 3).

   Is IGT enabled for our hall? Should these titles be in getUserGames at all?

We are not blocked on any of this to keep testing, but we cannot go to
production while a player can open a game and see zero balance. Happy to run
any specific test you want on our side — we can now answer with timestamps
instead of impressions.
```

**Por qué así**: cada punto abre con el dato y después la pregunta, no al revés.
Los puntos 2, 3 y 4 son los mismos que ya se les preguntaron — lo que cambia es
que ahora traen la medición, así que no se puede contestar "no lo vemos". El
punto 1 es nuevo y es el más fuerte: es la única forma de que un jugador vea
saldo cero teniendo plata.

**Lo que NO se les dice**: sigue sin decirse que parte de la inestabilidad podría
ser nuestra. Ahora hay bastante más respaldo para no decirlo —Sentry en cero,
saldo correcto registrado, IP correcta, cero rondas trabadas— pero el argumento
honesto sigue siendo el mismo: nuestro `openGame` devuelve 200 y no llega ningún
callback.

**Si Telegram lo corta**: mandar los puntos 1 y 2 primero (son los decisivos) y
el resto en un segundo mensaje.
