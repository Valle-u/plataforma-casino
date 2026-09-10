# 10 · Métricas

> Cómo se mide la atención cuando el hilo es eterno.
>
> ✅ **Construido el 2026-09-10** (migración `0115`, sección *Métricas de
> atención*). Este documento describía el diseño antes de existir; abajo queda
> marcado qué se hizo, qué se agregó y qué sigue sin hacerse.
>
> ⚠️ **No hay backfill, y no puede haberlo.** Los tramos se anotan cuando pasan.
> Las conversaciones anteriores a la migración no tienen ninguno y no se les
> puede inventar: **la medición arranca el día que se instaló**, y la pantalla
> dice desde cuándo mide.

---

## El problema que crea D11

Un hilo por contacto y canal, **para siempre**. Si Juan escribió en marzo y vuelve
en septiembre, es la misma conversación.

**Por eso las métricas obvias no significan nada:**

| Métrica ingenua | Por qué miente |
|---|---|
| "Conversaciones abiertas: 340" | Son todas las personas que alguna vez escribieron |
| "La conversación de Juan lleva 6 meses abierta" | Se resolvió en marzo; volvió ayer |
| "Tiempo de respuesta promedio" | Se calcula sobre hilos que duran años |

**Medir sobre la conversación es medir la antigüedad del cliente, no la calidad
de la atención.**

---

## La unidad correcta: el tramo

**Un tramo va desde que alguien escribe estando la conversación resuelta, hasta
que se vuelve a marcar resuelta.**

```
── Hilo de Juan ────────────────────────────────────────
  12-mar  Juan: "me cargás?"          ┐
  12-mar  Pérez: "ya está"            ├─ TRAMO 1 · 4 min · resuelto
  12-mar  [resuelto]                  ┘

  03-ago  Juan: "no me abre el juego" ┐
  04-ago  Pérez: "probá de nuevo"     ├─ TRAMO 2 · 19 h ⚠️ · resuelto
  04-ago  [resuelto]                  ┘

  08-sep  Juan: "hola"                ┐
          (sin responder)             ├─ TRAMO 3 · abierto hace 2 días ⚠️
                                      ┘
```

Tres tramos, un hilo. **Las métricas se calculan sobre los tramos.**

### Lo que hace falta para poder medirlos

El tramo **no existe en el modelo de datos**. Dos formas de obtenerlo:

| | Cómo | Costo |
|---|---|---|
| **A** | Derivarlo al consultar, mirando la secuencia de mensajes y los cambios de estado | Cero tablas nuevas; consulta pesada y difícil de leer |
| **B** | Una tabla `crm_conversation_segments` que se escribe al abrir y al resolver | Una tabla más; consultas triviales y baratas |

**Se hizo B**, y al construirlo apareció que **A ni siquiera era posible**. Un
tramo empieza cuando la conversación estaba resuelta, y `crm_conversations
.status` es una sola columna mutable: **no hay historia de cuándo se marcó
resuelta**. Mirando sólo los mensajes no se puede saber dónde terminaba un tramo
y empezaba el siguiente — se podría adivinar por huecos de tiempo, que es
inventar un dato y presentarlo como medido.

Vale la pena decirlo junto a **D22**, que decidió lo contrario para Circuitos:
la etapa de un contacto es un **estado actual** y siempre se puede recalcular;
un tramo es **historia**, pasa una vez y hay que anotarlo cuando pasa. No es una
contradicción, es la misma pregunta con dos respuestas correctas.

> El requisito previo —**cerrar y reabrir**— se construyó en la etapa 1.4 y
> tiene botones desde la ficha del CRM. Ver
> [`06-operacion-diaria.md`](06-operacion-diaria.md).

### Lo que quedó fijado al construirlo

- **Abre tramo** un mensaje `inbound` o `system`. Los avisos de **D8** cuentan a
  propósito, igual que en el parte diario: un aviso ignorado es el agujero que
  dejan D8 y D10 juntos.
- **No abre tramo un `outbound`.** Si el operador escribe primero no hay espera
  que medir, y ese tramo entraría con primera respuesta instantánea bajando la
  mediana de todos los demás sin que nadie haya atendido mejor.
- **Sólo un `outbound` marca la primera respuesta.** Un aviso del sistema no es
  una respuesta al jugador.
- **Sólo `resolved` cierra.** `pending` es "se respondió y se espera algo de
  afuera": la atención sigue abierta.
- **Un tramo abierto por conversación**, garantizado por un índice único parcial
  en la base. Chequearlo desde el código no alcanza: dos mensajes simultáneos
  pasan los dos el `SELECT` antes de que cualquiera inserte, y a partir de ahí
  todas las medianas mienten sin que nadie lo note.
- **Anotar un tramo nunca rompe un mensaje.** Si la escritura falla se registra
  y se sigue: perder una métrica es infinitamente más barato que perder la
  respuesta a un jugador.

---

## Las métricas que valen la pena

### 1. Sin responder — la única imprescindible

**Cuántos tramos están abiertos sin una sola respuesta, y desde cuándo.**

Es la que **destapa el hueco de D16 + D17**: hoy alguien puede escribir y quedar
seis horas —o dos días— sin que nadie en el sistema lo sepa.

**Se puede tener antes que todo lo demás**, y casi gratis: `HealthReportCron` ya
manda todas las mañanas el bloque *ESPERANDO RESPUESTA* con depósitos y retiros
pendientes, y ya marca lo que lleva más de 24 h. **Es una consulta más en un cron
que ya corre y ya llega.**

```
ESPERANDO RESPUESTA
  depósitos: 3 (1 con más de 24 h ⚠️)
  retiros: ninguno
  chats: 7 (2 con más de 24 h ⚠️)      ← esto
```

**Hacerlo primero.** No necesita tramos, ni tabla nueva, ni pantalla.

### 2. Tiempo hasta la primera respuesta

De todas las de calidad de atención, la que más se siente del lado del jugador.
Se mide por tramo. La **mediana**, no el promedio: un solo caso de tres días
arrastra el promedio y esconde que el resto anduvo bien.

### 3. Volumen por canal

Cuántos mensajes entran por web, WhatsApp y Telegram. Sirve para decidir dónde
invertir — y para ver si Telegram terminó siendo, como se sospecha en
[`03-canales.md`](03-canales.md), el canal real de los operadores chicos.

### 4. Supervisión para el socio — sin contenido

Fue la **opción intermedia descartada en D10**. Queda anotada acá porque es la
salida si el agujero de D8 + D10 aparece en la práctica:

```
BANDEJA DE LITORAL (socio) › Supervisión
Pérez  · 12 chats · 2 sin responder · tarda 4 h ⚠️
Gómez  ·  8 chats · 0 sin responder · tarda 6 min

[ los mensajes no se abren ]
```

El socio ve **cómo se atiende**, no **qué se dice**. Es lo que permite detectar a
un cajero que abandona a sus jugadores sin leer conversaciones privadas.

> **No está aprobado.** D10 decidió que un socio no ve nada de sus cajeros. Esto
> sería una decisión nueva, y hay que tomarla explícitamente si se implementa.

---

## Las que NO hay que hacer

| | Por qué |
|---|---|
| **Ranking de agentes** | Convierte la atención en una carrera. El que cierra rápido gana, y cerrar rápido no es atender bien. |
| **Cualquier cosa que cruce redes** | **R6**. El casino ve de una red independiente agregados, no detalle. Un dashboard "todos los operadores" es exactamente lo que la ley prohíbe. |
| **Contenido de los mensajes** | Palabras más usadas, análisis de sentimiento. Es leer conversaciones con otro nombre. |

---

## Quién ve qué

| | Su propia bandeja | Su bajada | Otras redes |
|---|---|---|---|
| Admin | ✅ | ✅ la red central y la dependiente | ❌ sólo agregados (**R6**) |
| Socio independiente | ✅ | ⚠️ sólo si se aprueba la #4 | ❌ |
| Cajero | ✅ | — | ❌ |

---

## Por dónde empezar — y en qué quedó

1. ✅ **Chats sin responder en el parte diario.** Se hizo primero, como estaba
   previsto: `CONSULTA_CHATS_SIN_RESPONDER` en `health-report.cron.ts`.
2. ✅ **Cerrar / reabrir** (etapa 1.4, con botones en la ficha).
3. ✅ **La tabla de tramos** (migración `0115`).
4. ✅ **Las métricas 2 y 3** (primera respuesta y volumen por canal), más una
   quinta que no estaba en esta lista y sale gratis de la misma tabla:
   **tiempo hasta resolver**. Es la compañera natural de la primera respuesta —
   una dice cuánto tardás en aparecer, la otra cuánto en terminar.
5. ⬜ **La 4 (supervisión para el socio)**: sigue sin hacerse, y sigue
   necesitando una decisión que cambie **D10**. No se construyó nada de eso.

### Lo que la sección todavía no puede contestar

**Nada que necesite historia de transiciones.** Se sabe cuánto tardó cada tramo,
no por qué etapas pasó ni cuánto estuvo en cada una. Preguntas como "¿cuánto
tarda alguien desde que escribe hasta que hace su primer depósito?" cruzan esto
con los circuitos (**D22**), que se derivan y no guardan historia.

El día que haga falta, la respuesta **no** es agregarle una columna `etapa` a
`crm_contacts`: es registrar las transiciones en `crm_timeline_events` —que ya
existe para eso— sin dejar de derivar la etapa actual.
