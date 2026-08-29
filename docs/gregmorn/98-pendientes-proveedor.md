# Gregmorn — pendientes con el proveedor

> Cosas que necesitan respuesta de ellos (`GH_Support_Dave`). Se escribe en
> **inglés**, sin saludo: la conversación ya está abierta.
>
> Última actualización: 2026-08-29.

---

## 1. Rondas que nunca se cierran (ABIERTO — el más importante)

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

## 2. Semántica del `roundId` (ABIERTO — confirmar contrato)

Mandan **dos** identificadores distintos y el de arriba no sirve para agrupar:

| Campo | Ejemplo | Comportamiento observado |
|---|---|---|
| `roundId` (nivel superior) | `c271dc8d-ed2e-…` | **UUID distinto en CADA callback** |
| `roundId` (dentro de `info`) | `1787962756` | **estable** en toda la ronda lógica |

Nuestro código ahora agrupa por el de `info` (ver `resolveRoundExternalId`).
**Preguntar si ese es el contrato previsto**, porque hoy nos apoyamos en un campo
que su spec no documenta como identificador de ronda. Si mañana cambian el
formato de `info`, se nos parte el agrupamiento en silencio.

También conviene confirmar la lista de valores de `action`: hasta ahora vimos
`spin`, `reSpin`, `pick`, `freeSpin`, `freeReSpin`.

---

## 3. Rollback en Stage (ABIERTO — desde 2026-08-28)

Es **la única parte del camino de la plata nunca ejercitada** contra su sistema
real. Está implementado y testeado de nuestro lado, pero nunca lo vimos llegar.
Pedirles que fuercen uno en Stage.

---

## 4. Los 40 juegos de casino en vivo (ABIERTO — desde 2026-08-28)

Devuelven `url: ""` con `StateId: "0"` al abrirlos. Reportado, sin respuesta.

---

## Borrador del mensaje

> Three things on the Stage integration.
>
> **1. Rounds that never close.** We have 3 logical rounds still open ~12h after
> the last callback. Player `MiamiHub` / `maggie`, 2026-08-29 00:18–00:23 UTC.
> The largest one is a bonus buy, `roundId=1787962756`: a `spin` with bet 5000 /
> win 250, then a `pick`, then 28 `freeSpin`/`freeReSpin` actions with bet 0.
> Every callback carries `round_finished: false`, including the last one. We
> never received `round_finished: true`.
>
> Is that round still open on your side? If a player leaves while free spins are
> pending, how does it get closed — is there a timeout, and do you still send the
> closing callback afterwards? Is there an endpoint we can poll to reconcile
> round state?
>
> This matters because our commission base only counts closed rounds, so an
> open round is revenue we cannot attribute.
>
> **2. `roundId` semantics.** You send two different identifiers: the top-level
> `roundId` is a different UUID on every callback, while `info` carries
> `roundId=<number>` which stays stable across the whole round. We are now
> grouping by the one inside `info`. Can you confirm that is the intended
> contract, and that the `info` format is stable? Also, can you share the full
> list of `action` values? So far we have seen `spin`, `reSpin`, `pick`,
> `freeSpin`, `freeReSpin`.
>
> **3. Rollback.** Still never exercised on Stage. Could you force one so we can
> verify our handler against your real payload?
>
> Also still pending from before: the ~40 live casino games returning `url: ""`
> with `StateId: "0"`.
