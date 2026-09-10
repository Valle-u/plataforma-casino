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
| 2.8 | ~~Mandar **archivos** por Telegram~~ | ✅ |

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

**Un rechazo no borra el mensaje.** Queda en el hilo con la marca de "no llegó"
y el motivo que dio Telegram, que es lo accionable: *bot was blocked by the
user* se resuelve pidiéndole a la persona que lo desbloquee, *Unauthorized*
revinculando el bot.

De paso se tapó un agujero viejo de la bandeja: **el error de un envío se
descartaba en silencio**. El spinner paraba y no pasaba nada; el operador volvía
a apretar sin entender.

### 2.8 — Los archivos

**Siempre `sendDocument`, nunca `sendPhoto`.** `sendPhoto` recomprime del lado
de Telegram: para una foto cualquiera da igual, para un **comprobante** puede
dejar ilegible un CBU o un monto. El jugador lo ve como adjunto con miniatura
en vez de foto inline — se pierde estética y se gana que el número se lea. Es el
mismo criterio que ya regía del lado que recibe, donde se elige la foto más
grande que entre.

**Se suben los bytes, no se le pasa una URL.** Telegram acepta una URL y la baja
él, que sería menos código — pero los adjuntos son privados y firmados (**D12**),
o sea que la URL vence, y si Telegram la baja tarde ya no resuelve. Además,
cuando falla contesta *"wrong file identifier/HTTP URL specified"*, que no le
dice nada a nadie.

**El texto va en su propio mensaje, no como `caption`.** El caption se corta en
1024 caracteres, y una respuesta cortada por la mitad es peor que dos globos.

**Y un envío puede fallar por la mitad**, porque una fila del CRM son varias
llamadas a Telegram. Si el motivo no dijera qué alcanzó a salir, el operador lo
mandaría de nuevo entero y el jugador recibiría el texto dos veces.

### ✅ Probado con un bot real el 2026-09-10

**Hasta acá la etapa 2 entera estaba verificada sólo contra la base.** Telegram
va simulado en la suite —pegarle de verdad ataría los tests a una red externa—
así que diez tandas se habían apilado sobre un camino que nadie había ejecutado
en vivo. Era el riesgo abierto más grande del proyecto y no lo podía cerrar un
agente: había que crear un bot y escribirle.

El dueño lo hizo en staging, con el bot **@MIAMI HUB Soporte**. Anduvo **en las
dos direcciones a la primera**:

- `/start` y `hola` entraron a la bandeja por el canal Telegram → el webhook
  recibe, el `secret_token` se verifica y el ruteo lleva a la bandeja del dueño.
- La respuesta del operador salió y llegó al cliente de Telegram (**2.7**).
- El contacto nació **como lead**, que es lo correcto: Telegram no da el
  teléfono y **D4 no puede identificar a nadie ahí**. La pantalla lo dice en vez
  de mostrar una ficha vacía.

**La preocupación que resultó infundada, y por qué valía tenerla.** La URL del
webhook la arma `baseApiPublica()` con `x-forwarded-host`, y **Next pisa ese
header** en el rewrite (commit `9d87c69`). Traefik lo vuelve a escribir delante
de la API, así que la URL salió bien — pero eso depende del proxy, no de nuestro
código. De ahí salió el diagnóstico de la pantalla de Canales, que sigue siendo
útil: cuando algo falle, dice **qué** falla en vez de dejar una bandeja vacía
idéntica a "todavía no escribió nadie".

**Lo que esta prueba NO cubrió**, y sigue sin correr con un bot real:

| | Qué falta probar | Cómo |
|---|---|---|
| **2.4** | Recibir una foto o un PDF | Mandarle un archivo al bot |
| **2.8** | Mandar un archivo desde el panel | Responder con un adjunto |
| **2.6** | 🔴 **La idempotencia por chat** | Que le escriba una **segunda persona distinta** |

**El 2.6 es el que más vale de los tres.** Era *"el bug que la suite no veía"*:
sin el chat en la clave de idempotencia, **la segunda persona nueva que le
escribe al bot choca contra el índice único de `0113` y su mensaje se descarta en
silencio**. Con una sola persona escribiendo no se ve nunca — el `message_id` de
Telegram es un contador *por chat*, así que el primer mensaje de cada persona es
`1`. Está arreglado y tiene su test, pero la prueba en vivo pide **dos remitentes
distintos**, no dos mensajes.

**Lo que Telegram enseña y hay que reflejar:** casi nunca da el teléfono, así que
**D4 no funciona ahí**. Un contacto de Telegram nace como **lead**, y eso va a ser
lo normal, no la excepción. La pantalla tiene que estar diseñada para eso.

---

## Etapa 3 — WhatsApp

| | Qué | |
|---|---|---|
| 3.1 | Acompañar al socio en el alta ante Meta: explicar el trámite y mostrar en qué paso está | ⬜ **Diferido a propósito** |
| 3.2 | Webhook (igual que 2.2, con la firma de Meta) | 🟡 Arquitectura decidida (**D23**), sin escribir |
| 3.3 | Vínculo por teléfono, con las **tres defensas** de D4 | ✅ **Hecho** (`a8256a3` + la UI) |
| 3.4 | **El aviso de la ventana de 24 h, antes de escribir** | ✅ **Hecho** |
| 3.5 | Qué se hace con audios y videos | ✅ Decidido, sin implementar |

**El 3.1 es la mitad del trabajo y no es código.** Por **D13** el socio hace su
propia verificación, y un socio trabado en el trámite es un socio sin canal. Se
difiere hasta tener un socio real haciéndolo: el trámite de Meta cambia seguido
y escribirlo de memoria produce una guía que no coincide con lo que el socio ve
en pantalla.

**El 3.4 era chico y fácil de olvidar.** Sin eso, el operador escribe tres
párrafos y recibe un error.

### 3.4 — La ventana, y lo que no se podía separar de ella

La regla vive en el backend (`ventana-24h.ts`, 10 tests) y lo que viaja a la
pantalla es **cuándo vence**, no si venció: si el backend mandara "vencida", un
panel abierto toda la tarde seguiría diciendo que quedan horas. El contador
tickea del lado del cliente sin que las 24 horas estén escritas en dos lados.

**Sólo en WhatsApp.** Telegram no tiene ventana. Un cartel que aparece donde no
corresponde enseña a ignorarlo, y entonces tampoco se lee donde sí importa — así
que el backend manda `null` para todo canal que no la tenga, y la pantalla no
vuelve a preguntarse por el tipo de canal.

**Tres estados, con distinta prominencia:** vencida → cartel rojo; faltan menos
de 4 h → contador; más de 4 h → nada, porque un reloj corriendo al lado del
teclado no es información. Y un cuarto que es fácil colapsar con "no aplica" y
**no es lo mismo**: WhatsApp donde el cliente nunca escribió. Ahí la ventana no
se abrió nunca y tampoco sale texto libre.

**Lo que no se podía separar del aviso.** Al leer el envío apareció que
`canalExterno()` sólo reconoce Telegram: un mensaje escrito en un hilo de
WhatsApp **se guardaría, se vería como enviado y no llegaría a nadie** — el mismo
agujero que 2.7 tapó para Telegram. Con eso a la vista, mandar sólo el contador
habría sido **peor que no hacer nada**: un cartel diciendo *"te quedan 20 horas
para responder libremente"* sobre un canal que no entrega nada es una mentira
tranquilizadora, y le da confianza al operador justo donde el mensaje se pierde.

Por eso el compositor queda bloqueado —textarea, clip, rayo y Enviar— con el
motivo escrito. **Cuando exista el envío por WhatsApp se saca ese bloqueo; la
ventana se queda**, y ahí recién pasa a ser la restricción que manda.

**Verificado en el navegador** con un canal `whatsapp` fabricado en la base y los
cuatro estados: sin banda con 23 h por delante, *"Quedan 44 min"* a las 23.2 h,
*"venció hace 82 días"* con un inbound viejo, y *"Nunca escribió por acá"* sin
ningún inbound. Con la prueba negativa que importa: en un hilo de livechat no
aparece nada de esto y el compositor sigue habilitado.

### 3.3 — El backend estaba y no lo llamaba nadie

El vínculo por teléfono se cerró en dos tandas. La primera (`a8256a3`) dejó las
tres defensas de D4 del lado del servidor: `telefono.ts` con las dos formas
canónicas —una para mostrar, otra para comparar—, la migración `0116`, el freno
del alta arreglado (comparaba el string crudo, así que **no frenaba nada**), y
`vincular`/`desvincular` con constancia en `crm_timeline_events`.

**Y no lo llamaba nadie.** Es el mismo patrón que ya había pasado con cerrar,
avisar y dar de alta: el roadmap los daba por hechos porque la API estaba. La
segunda tanda son los botones en la ficha (`vincular-jugador.tsx` + la sección
*Vínculo*), verificados contra la API de verdad — vincular, ver aparecer el
saldo, deshacer, y los dos eventos en la línea de tiempo con su actor.

**Vincular a mano no es un accesorio del automático: en Telegram es el único
camino.** Ahí el teléfono no llega nunca, así que **todo contacto nace como
lead** y D4 no se ejecuta. En WhatsApp la segunda defensa —si matchea con más de
uno, no vincular ninguno— produce exactamente el caso en que alguien tiene que
mirar y elegir; por eso el buscador arranca cargado con el teléfono del contacto.

**3.5 (audio) sigue pendiente**: hay que sumar el MIME a
`CHAT_ATTACHMENT_MIMES` en `chat.types.ts`, que hoy sólo acepta imágenes y PDF.
No alcanza con agregar el string: el validador de adjuntos **redibuja** las
imágenes y revisa los PDF, y el audio necesita que se defina por dónde pasa.

---

## Etapa 4 — Lo que quedó afuera

Nada de esto está aprobado. Está acá para que se decida con el peso a la vista.

| | Qué | Estado |
|---|---|---|
| 4.1 | Retención de adjuntos a 6 meses (**D15**) | Decidido, sin fecha. Verificar que R2 borra de verdad. |
| 4.2 | Cierre de red auditado (**D14**) | 🔴 **Delicado**: habilita una excepción a R6. Sólo el admin, auditado. |
| 4.3 | Llenar `crm_timeline_events` | La tabla está lista y vacía |
| 4.4 | Métricas por tramos | ✅ **Hecho** (migración `0115`). Sin backfill: mide desde que se instaló |
| 4.5 | Aviso al operador por Telegram | La mejora descartada en **D16**, si el hueco molesta |
| 4.6 | Varios agentes en la misma bandeja | Se ofreció excluirlo y no se marcó |
| 4.7 | Búsqueda global de mensajes | Ídem. Por **D6** hay que acotarla por bandeja. |
| 4.8 | Campañas y mensajes masivos | ✅ **Adentro por D21** (D19 revertida) |

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
