# 03 · Los canales, uno por uno

> Qué es cada canal, qué hace falta para prenderlo, y qué **no** se puede hacer
> con él aunque el cliente lo pida.
>
> La regla que los gobierna a todos es **D1**: un canal pertenece a un panel, no
> al casino.

---

## Los tres

| | `web-livechat` | `telegram` | `whatsapp` |
|---|---|---|---|
| **Estado** | ✅ en producción | ⬜ por construir | ⬜ por construir |
| **Cuesta plata** | no | no | sí |
| **Necesita trámite** | no | no | **sí, con Meta** |
| **Se puede iniciar la charla** | sí (widget) | **no** | sólo con plantilla |
| **Quién lo puede tener** | el casino | cualquier panel | sólo quien tenga empresa |
| **Orden de construcción (D18)** | ya está | **segundo** | tercero |

---

## Web (`web-livechat`)

El widget dentro de la plataforma. **Es el único que funciona hoy** y es la
referencia de cómo tienen que comportarse los demás.

**Cómo entra un mensaje:** por WebSocket (`chat.gateway.ts`). El jugador está
autenticado, así que **se sabe exactamente quién es** — no hay que adivinar nada
por teléfono.

**Ruteo:** `resolveAssignedOperator` — si el jugador es de una red independiente
va a su operador directo; si no, a la bandeja central. Ya implementado.

**Adjuntos:** `POST /tenant/chat/upload`, con validación real del contenido
(redibuja imágenes, rechaza PDF con contenido activo). Máximo 5 MB y 5 archivos
por mensaje.

> 🔴 Hasta el 2026-09-08 estos adjuntos se servían con **URL pública y caché de
> un año**. Corregido (D12), pero **falta desplegarlo**: ver
> `../runbooks/firmar-comprobantes.md`.

**Lo que le falta:** nada estructural. Es el canal que ya anda.

---

## Telegram

### Por qué va segundo y no tercero

Porque **no depende de nadie**: un bot se crea en cinco minutos hablando con
[@BotFather](https://t.me/BotFather), es gratis y no pide papeles. Sirve para
probar todo el mecanismo de canales externos —dueño, ruteo, avisos, adjuntos— sin
esperar la verificación de nadie.

Y por **D13** hay una razón más fuerte: un socio sin empresa a su nombre **no va
a poder tener WhatsApp nunca**. Para esos operadores, Telegram no es el hermano
menor: es el único canal posible. Conviene construirlo con ese peso.

### Lo que hay que saber antes de prometerlo

**Sólo bots.** No se puede automatizar una cuenta personal: eso es un *userbot*,
viola los términos de Telegram y termina en la cuenta cerrada. Si un operador
pregunta "¿puedo usar mi Telegram de siempre?", la respuesta es **no**.

**Un bot sólo le habla a quien le habló primero.** No hay forma de que el bot
inicie una conversación con alguien que nunca lo contactó.

> **Traducción:** Telegram sirve para **atender**, no para **buscar clientes**.
> Y el jugador tiene que llegar al bot por un link (`t.me/elbot`) que el operador
> le pase.

### Qué hace falta para prenderlo

1. El operador crea el bot con BotFather y obtiene un **token**.
2. Lo carga en el CRM → se guarda en `crm_channels.config` con
   `owner_user_id` = ese operador.
3. La plataforma registra un **webhook** contra Telegram para recibir los
   mensajes.

> ⚠️ El token del bot es la llave del bot entero. Ver el punto 2 de
> [`02-modelo-de-datos.md`](02-modelo-de-datos.md): **cómo se guardan los
> secretos de canal es una decisión abierta**, y con D13 esos secretos son de los
> socios, no nuestros.

### Identificación

Telegram **no da el teléfono** de quien escribe, salvo que la persona lo comparta
a propósito. Da un `chat_id` y, a veces, un `@usuario`.

**Consecuencia sobre D4:** el vínculo automático por teléfono —que es lo que hace
que el operador vea quién es— **no funciona en Telegram**. Un contacto de
Telegram nace casi siempre como **lead**, y sólo se vincula si la persona
comparte su número o si el operador lo hace a mano.

Es una diferencia real entre los dos canales y hay que reflejarla en la pantalla:
en Telegram, "no sabemos quién es" va a ser lo normal, no la excepción.

---

## WhatsApp

### Lo que cuesta de verdad

Cada número necesita una **cuenta de WhatsApp Business verificada por Meta**, con
documentación de una empresa. Por **D13**, esa cuenta **es del socio**, no
nuestra.

Lo que eso implica, dicho claro:

- El socio **no tiene canal hasta que Meta lo verifique**. Es un trámite con
  tiempos que no controlamos.
- Un socio con ocho cajeros son **ocho altas, ocho verificaciones y ocho costos**.
- El casino **no puede resolverlo por él**. Sólo puede explicarle el trámite y
  mostrarle en qué paso está.

**La razón de haberlo decidido así** no fue el costo: con todos los números bajo
una sola cuenta de Meta —la del casino—, **una denuncia contra el número de un
socio cae sobre la cuenta de todos**, incluido el número central. El peor
operador definiría el destino del canal de todos.

### La ventana de 24 horas

Desde el último mensaje **del cliente**, hay 24 horas para responder libremente.
Después, sólo salen **plantillas aprobadas por Meta**.

Esto choca con **D11** (el hilo es eterno) de una forma concreta:

```
12-mar  Juan escribe · Pérez responde · conversación resuelta
08-sep  Pérez quiere escribirle a Juan por ese mismo hilo
        → la ventana venció hace meses
        → sólo sale una plantilla aprobada
```

**La pantalla tiene que decirlo ANTES de que el operador escriba**, no después de
que el mensaje falle. Un operador que escribe tres párrafos y recibe un error es
un operador que deja de usar la herramienta.

### Identificación

Acá **sí** llega el teléfono, así que **D4 funciona de lleno**: el sistema busca
ese número entre los jugadores y lo vincula solo.

Con las tres defensas que D4 exige:

1. **Normalizar a E.164 antes de comparar** — `3415551234`, `+543415551234` y
   `0341 15 555-1234` son el mismo número.
2. **Si matchea con más de un jugador, no vincular ninguno** (`users.phone` no
   tiene índice único: dos jugadores pueden compartirlo).
3. **El vínculo se tiene que poder deshacer**, y quedar registrado quién lo
   deshizo.

### Qué NO va en la v1

**Campañas y mensajes masivos** (**D19**). Es lo que más rápido gana una
denuncia — y por D13, la denuncia cae sobre el número del socio.

---

## Lo que comparten los tres

Todo canal externo, sea cual sea, tiene que resolver lo mismo:

| | Cómo se resuelve |
|---|---|
| **De quién es** | `crm_channels.owner_user_id`; `NULL` = central (**D1**) |
| **A qué bandeja va un mensaje** | A la del dueño del canal, siempre (**D2**) |
| **Quién es el que escribe** | Automático por teléfono si el canal lo da (**D4**) |
| **De quién es un desconocido** | Del dueño del canal (**D5**) |
| **Un contacto por bandeja** | Nunca uno compartido (**D6**) |
| **Un hilo, para siempre** | Se reabre, no se duplica (**D11**) |
| **Adjuntos** | Privados y firmados (**D12**); se borran a los 6 meses (**D15**) |
| **Sin respuestas automáticas** | Ninguna, en ningún canal (**D17**) |

Vale la pena construirlo como **un adaptador por canal** contra una interfaz
común, para que agregar el tercero no sea rehacer el segundo. Los detalles de
webhooks, reintentos y orden de mensajes van en
[`12-infraestructura.md`](12-infraestructura.md).
