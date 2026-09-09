# 13 · Roadmap — en qué orden se construye

> El orden lo fija **D18**: primero la base, después Telegram, después WhatsApp.
> Este documento lo baja a tareas.

---

## Por qué este orden

**D6** (dueño del contacto) y **D12** (adjuntos privados) tocan tablas y código
que **el livechat ya usa en producción**. Migrar eso con **un** canal andando es
mucho más barato que con tres.

Y va Telegram antes que WhatsApp porque **no depende de nadie**: un bot se crea en
cinco minutos, gratis y sin papeles. WhatsApp depende de que Meta verifique a cada
socio (**D13**), o sea que el arranque no estaría en nuestras manos.

```
Etapa 0 · Cerrar lo que ya está abierto  ← se puede hacer YA
Etapa 1 · La base
Etapa 2 · Telegram
Etapa 3 · WhatsApp
Etapa 4 · Lo que quedó afuera
```

---

## Etapa 0 — Cerrar lo que ya está abierto

**No es CRM futuro: corre en producción hoy.** Y no depende de ninguna decisión
pendiente.

| | Qué | Estado |
|---|---|---|
| 0.1 | ~~Adjuntos del chat privados y firmados (D12)~~ | ✅ **desplegado el 2026-09-09**, verificado en producción |
| 0.2 | ~~Chats sin responder en el parte diario~~ | ✅ **en producción** desde el 2026-09-08 |

### 0.1 — El despliegue, en orden

Está en [`../runbooks/firmar-comprobantes.md`](../runbooks/firmar-comprobantes.md),
ya ampliado para cubrir las dos carpetas. **El orden no es negociable:**

1. Desplegar el **Worker** (`cd worker; npx wrangler deploy`)
2. Verificar que un adjunto diga `private, max-age=300`
3. Mergear a `main` — recién ahí la API firma
4. Purgar el caché de Cloudflare
5. *(aparte, cuando se quiera)* `REQUIRE_SIGNED_PROOFS = "1"`

> Al revés, cada URL firmada crea una entrada de caché pública **de un año**.

### 0.2 — Por qué acá y no en la etapa 4

Porque **tapa el único hueco real** del diseño: con **D16** (aviso sólo en el
panel) y **D17** (sin respuestas automáticas), alguien puede escribir y quedar
horas —o días— sin que nadie lo sepa.

El parte diario ya llega todas las mañanas y ya tiene un bloque *ESPERANDO
RESPUESTA*. Es una consulta más. **No hace falta esperar a ninguna etapa.**

---

## Etapa 1 — La base

Sobre el livechat que ya funciona, sin canales nuevos.

| | Qué | Doc |
|---|---|---|
| 1.1 | ~~`owner_user_id` en `crm_contacts` + migrar los que hay~~ | ✅ **hecho** (migración `0112`) |
| 1.2 | ~~`owner_user_id` en `crm_channels`~~ | ✅ **hecho** (migración `0112`) |
| 1.3 | ~~🔴 `getContext` filtrado por red~~ | ✅ **hecho el 2026-09-08** |
| 1.4 | ~~Cerrar / marcar pendiente / reabrir~~ | ✅ **hecho** |
| 1.5 | ~~El aviso de derivación (D8)~~ | ✅ **hecho** |
| 1.6 | ~~Alta de jugador desde el chat (D9)~~ | ✅ **hecho** |
| 1.7 | ~~El cartel de red **en la ficha**~~ | ✅ **hecho** · en la lista, diferido (ver abajo) |
| 1.8 | ~~Los seis tests de aislamiento~~ | ✅ **hecho** |

**El 1.3 ya está hecho** (2026-09-08). `getContext` compara la rama
independiente del jugador contra la de quien pregunta y, si no coinciden, **las
consultas de plata ni se corren**: devuelve identidad y el cartel de red, nada
más.

Cubre los tres cruces —staff central → red independiente, independiente → otra
independiente, e independiente → red central— con seis tests, verificados
rompiendo el filtro a propósito para confirmar que fallan.

**Decisiones que hay que tomar en esta etapa** (ninguna está tomada):

- ~~Dónde viven los secretos de canal.~~ ✅ **D20** (2026-09-09): cifrados en la
  base con AES-256-GCM, clave en el entorno. Construido y probado; falta la
  pantalla que lo use (2.1).
  - ✅ **La clave ya está cargada en staging** (2026-09-09), verificada por largo
    sin exponerla.
  - ⚠️ **Producción todavía no tiene la suya, y tiene que ser DISTINTA** — mismo
    criterio que los `JWT_ACCESS_SECRET`, que ya están separados a propósito: si
    los dos entornos comparten la clave, una filtración de staging abre los
    secretos reales. Se genera con `openssl rand -hex 32` y va al entorno de la
    app `api` en Dokploy. Sin ella no se puede vincular ningún canal, que es el
    comportamiento buscado.
- ~~Cómo se le da la contraseña a un jugador creado desde el chat.~~ ✅
  Resuelto: se genera y se muestra una vez en el panel. Queda pendiente que la
  plataforma sepa **forzar el cambio al primer ingreso**, que hoy no existe.
- ~~El alta cuelga del dueño del canal, no del actor.~~ ✅ El alta del CRM pasa
  el padre explícito. ✅ Y el bug del endpoint del panel —un empleado de un socio
  independiente colgaba al jugador del admin principal— **se arregló el
  2026-09-09** en `main`, verificado en producción: no llegó a costar plata
  porque no existe ningún empleado (ver [`07`](07-crear-usuarios.md)).

---

## Etapa 2 — Telegram

| | Qué | |
|---|---|---|
| 2.0 | ~~La base: índice único, eventos crudos, secreto de webhook~~ | ✅ migración `0113` |
| 2.1 | ~~Vincular un bot a un panel~~ | ✅ |
| 2.2 | ~~Webhook: firma verificada, 200 rápido, crudo primero~~ | ✅ |
| 2.3 | ~~Ruteo por dueño de canal~~ | ✅ |
| 2.4 | ~~Medios: bajarlos antes de que venza el id~~ | ✅ |
| 2.5 | ~~La pantalla explica que el jugador tiene que escribirle al bot primero~~ | ✅ |
| 2.6 | ~~La clave de idempotencia tiene que incluir el chat~~ | ✅ 🔴 era un bug |
| 2.7 | ~~Responder desde el panel por Telegram~~ | ✅ migración `0114` |
| 2.8 | Mandar **archivos** por Telegram | ⬜ pendiente |

**Etapa 2 terminada el 2026-09-09.** Un operador vincula su bot desde
`/support/canales`, reparte el link, los mensajes —con fotos— le entran a su
bandeja, **y puede contestar**.

### 2.6 — El bug que la suite no veía

`channelMessageId` era `tg:<canal>:<message_id>`, y el `message_id` de Telegram
es *"unique message identifier inside this chat"*: un contador **por chat**. O
sea que el primer mensaje de cada persona nueva es `1`.

Sin el chat en la clave, **la segunda persona que le escribía al bot chocaba
contra el índice único de `0113` y su mensaje se descartaba** — quedaba en
`crm_raw_events` con el error y no aparecía en ninguna bandeja. En silencio,
porque el fallo de procesamiento no se propaga a propósito.

No lo agarró la suite porque su helper de updates usa un `message_id` al azar.
Con ids al azar no hay colisión; con Telegram de verdad la hay el segundo día.
Hay un test que fija esto, verificado rompiendo el arreglo para confirmar que
falla.

### 2.7 — Responder

Hasta acá el operador **recibía y no podía contestar**: su respuesta se guardaba
y se emitía por socket.io, que es donde escucha el widget web — y el jugador de
Telegram no está ahí.

**El orden es: persistir, después mandar, después anotar el resultado.** Al
revés, el operador perdería lo que escribió cada vez que Telegram falle. El
precio es que hay un instante en que el mensaje está guardado y todavía no
salió, y por eso existe `delivery_error` (migración `0114`): sin esa anotación,
una respuesta que nunca llegó se vería igual que una entregada y **el operador
le estaría escribiendo a nadie sin saberlo**.

Dos decisiones tomadas acá:

- **Sólo texto.** Si el operador adjunta un archivo, el panel se lo rechaza
  explicando por qué. Peor que no poder mandarlo sería que se vea enviado y no
  llegue nunca — y son comprobantes.
- **Un rechazo no borra el mensaje.** Queda en el hilo con la marca de "no
  llegó" y el motivo que dio Telegram, que es lo accionable: *bot was blocked by
  the user* se resuelve pidiéndole a la persona que lo desbloquee,
  *Unauthorized* revinculando el bot.

De paso se tapó un agujero viejo de la bandeja: **el error de un envío se
descartaba en silencio**. El spinner paraba y no pasaba nada; el operador volvía
a apretar sin entender.

> ⚠️ **Falta probarlo con un bot real.** Todo está verificado con tests, pero
> Telegram va simulado en la suite: pegarle de verdad ataría los tests a una red
> externa. La primera prueba con un bot vivo es la que confirma que el webhook
> queda bien registrado desde `crm-staging.miamihub.vip`.

**Lo que Telegram enseña y hay que reflejar:** casi nunca da el teléfono, así que
**D4 no funciona ahí**. Un contacto de Telegram nace como **lead**, y eso va a ser
lo normal, no la excepción. La pantalla tiene que estar diseñada para eso.

---

## Etapa 3 — WhatsApp

| | Qué |
|---|---|
| 3.1 | Acompañar al socio en el alta ante Meta: explicar el trámite y mostrar en qué paso está |
| 3.2 | Webhook (igual que 2.2, con la firma de Meta) |
| 3.3 | Vínculo automático por teléfono, con las **tres defensas** de D4 |
| 3.4 | **El aviso de la ventana de 24 h, antes de escribir** |
| 3.5 | Decidir qué se hace con audios y videos |

**El 3.1 es la mitad del trabajo y no es código.** Por **D13** el socio hace su
propia verificación, y un socio trabado en el trámite es un socio sin canal.

**El 3.4 es chico y fácil de olvidar.** Sin eso, el operador escribe tres
párrafos y recibe un error.

---

## Etapa 4 — Lo que quedó afuera

Nada de esto está aprobado. Está acá para que se decida con el peso a la vista.

| | Qué | Estado |
|---|---|---|
| 4.1 | Retención de adjuntos a 6 meses (**D15**) | Decidido, sin fecha. Verificar que R2 borra de verdad. |
| 4.2 | Cierre de red auditado (**D14**) | 🔴 **Delicado**: habilita una excepción a R6. Sólo el admin, auditado. |
| 4.3 | Llenar `crm_timeline_events` | La tabla está lista y vacía |
| 4.4 | Métricas por tramos | Necesita 1.4 primero ([`10`](10-metricas.md)) |
| 4.5 | Aviso al operador por Telegram | La mejora descartada en **D16**, si el hueco molesta |
| 4.6 | Varios agentes en la misma bandeja | Se ofreció excluirlo y no se marcó |
| 4.7 | Búsqueda global de mensajes | Ídem. Por **D6** hay que acotarla por bandeja. |
| 4.8 | ~~Campañas y mensajes masivos~~ | ❌ **Fuera por D19** |

> **Sobre 4.6 y 4.7:** se ofrecieron como exclusiones de la v1 y no se marcaron,
> así que formalmente siguen adentro. Con las dos, la v1 crece bastante. **Éste
> es el lugar para recortarlas** — la recomendación es dejarlas en la etapa 4 y
> ver si alguien las pide.

---

## Lo mínimo para poder decir que anda

Si hubiera que cortar por algún lado, esto es lo que no se puede sacar:

1. **Etapa 0 completa.** Cierra algo abierto en producción y destapa el punto
   ciego. Barato.
2. **1.1, 1.2, 1.3, 1.8.** Sin dueño del contacto y sin `getContext` filtrado, el
   primer canal externo **filtra datos entre redes**.
3. **Etapa 2.** Un canal externo funcionando, con operadores reales, sin depender
   de Meta.

Con eso hay un CRM que se puede usar. Todo lo demás mejora algo que ya anda.
