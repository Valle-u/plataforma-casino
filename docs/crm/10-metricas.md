# 10 · Métricas

> Cómo se mide la atención cuando el hilo es eterno.
>
> **No está decidido si va en la v1**: se ofreció como exclusión y no se marcó
> (**D19**), así que sigue como candidata. Este documento sirve para decidirlo con
> el peso a la vista.

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

**Recomendación: B.** Con A, cada consulta tiene que reconstruir la historia
entera de cada hilo — y esto crece para siempre, porque nada se borra (**D15**
sólo borra adjuntos, no mensajes).

> Y hay un requisito previo: **cerrar y reabrir no existen todavía**. Sin esas
> acciones no hay tramos que medir. Ver
> [`06-operacion-diaria.md`](06-operacion-diaria.md).

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

## Por dónde empezar

1. **Chats sin responder en el parte diario.** Barato, ya hay dónde ponerlo, y
   tapa el único hueco real. **Se puede hacer antes que el resto del CRM.**
2. Cerrar / reabrir (hace falta igual, por [`06`](06-operacion-diaria.md)).
3. La tabla de tramos, al implementar el punto 2.
4. Las métricas 2 y 3, cuando haya tramos.
5. La 4, sólo si se decide cambiar D10.
