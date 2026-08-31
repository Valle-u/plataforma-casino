# Gregmorn — pendientes con el proveedor

> Cosas que necesitan respuesta de ellos (`GH_Support_Dave`). Se escribe en
> **inglés**, sin saludo: la conversación ya está abierta.
>
> Última actualización: 2026-08-31 (respondieron 2 y 3; la 1 sigue abierta).

---

## 1. Rondas que nunca se cierran (ABIERTO — el más importante)

> **2026-08-31:** pidieron más tiempo para investigarlo bien. Es la respuesta
> que destraba el punto 2: sin saber cómo cierran una ronda abandonada, no se
> puede pasar al modelo de acumulación.

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

## 2. Semántica del `roundId` (RESPONDIDO — y nos deja mal parados)

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

**Por qué NO se cambió todavía**: con ese modelo, una ronda que nunca cierra se
traga todo lo que el jugador juegue después. Sin la respuesta al punto 1, el
cambio sería peor que lo actual — que al menos degrada solo (si `info` cambia,
`resolveRoundExternalId` cae al campo documentado).

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
