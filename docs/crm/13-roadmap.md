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

#### ✅ El 2.6 también se probó en vivo (2026-09-10, más tarde)

**Le escribió una segunda persona distinta y el mensaje llegó.** Era *"el bug que
la suite no veía"*, y era el último agujero conocido de la etapa 2.

Por qué hacía falta **una segunda persona** y no bastaban dos mensajes: el
`message_id` de Telegram es un contador **por chat**, así que el primer mensaje de
cada persona nueva es `1`. Sin el chat en la clave de idempotencia, la segunda
persona chocaba contra el índice único de `0113` y **su mensaje se descartaba en
silencio** — quedaba en `crm_raw_events` con el error y no aparecía en ninguna
bandeja, porque el fallo de procesamiento no se propaga a propósito.

La suite nunca lo vio porque su helper usa `message_id` al azar: con ids al azar
no hay colisión; con Telegram de verdad la hay el segundo día.

**Lo que sigue sin correr con un bot real:**

| | Qué falta probar | Cómo |
|---|---|---|
| **2.4** | Recibir una foto, un PDF o una **nota de voz** | Mandarle un archivo al bot |
| **2.8** | Mandar un archivo desde el panel | Responder con un adjunto |

Los dos son adjuntos, así que **una sola prueba los cubre casi enteros**: mandarle
una nota de voz al bot ejercita de paso el **3.5** (audio sí, video no), que es lo
único de esa tanda que no se pudo verificar de punta a punta — el entorno local no
tiene credenciales de R2 y sin storage no hay adjunto que guardar ni dibujar.

**Lo que Telegram enseña y hay que reflejar:** casi nunca da el teléfono, así que
**D4 no funciona ahí**. Un contacto de Telegram nace como **lead**, y eso va a ser
lo normal, no la excepción. La pantalla tiene que estar diseñada para eso.

---

## Etapa 3 — WhatsApp

| | Qué | |
|---|---|---|
| 3.1 | Acompañar al socio en el alta ante Meta: explicar el trámite y mostrar en qué paso está | ⬜ **Diferido a propósito** |
| 3.2 | Webhook (igual que 2.2, con la firma de Meta) | 🟡 **La puerta hecha**; falta procesar |
| 3.3 | Vínculo por teléfono, con las **tres defensas** de D4 | ✅ **Hecho** (`a8256a3` + la UI) |
| 3.4 | **El aviso de la ventana de 24 h, antes de escribir** | ✅ **Hecho** |
| 3.5 | Qué se hace con audios y videos | ✅ **Hecho** |

**El 3.1 es la mitad del trabajo y no es código.** Por **D13** el socio hace su
propia verificación, y un socio trabado en el trámite es un socio sin canal. Se
difiere hasta tener un socio real haciéndolo: el trámite de Meta cambia seguido
y escribirlo de memoria produce una guía que no coincide con lo que el socio ve
en pantalla.

**El 3.4 era chico y fácil de olvidar.** Sin eso, el operador escribe tres
párrafos y recibe un error.

### 3.2 — La puerta, no el procesamiento

Igual que en Telegram el webhook (**2.2**) vino antes que el ruteo (**2.3**),
acá se construyó **la puerta**: llega una entrega de Meta, se verifica, se
resuelve de quién es y se guarda el crudo. Convertir un `change` en contacto +
conversación + mensaje es la tanda que sigue. Los crudos quedan con
`processed_at` en `NULL`, que es el estado que el diseño ya define para eso.

**La tabla de D23 existe**: `whatsapp_numbers` en `platform_control`, con
`phone_number_id` **único a nivel global**. Un número apuntado al casino
equivocado manda la conversación de un jugador a la bandeja de otro; con el
unique, eso falla al escribir en vez de fallar al enrutar.

**La firma va contra los bytes crudos, y esa es toda la historia.**
`JSON.stringify` de lo que parseó Nest no devuelve los mismos bytes que mandó
Meta: cambia el escapado de unicode, los espacios, la notación de los números.
El modo de falla es el peor que hay — **no falla siempre**: falla cuando el
mensaje trae un acento o un emoji, o sea cuando escribe una persona real. Hay un
test que manda `Martín` firmado como lo firma Meta, y se verificó
**rompiendo el controlador a propósito** para confirmar que es el único que
falla.

**Una mejora sobre Telegram, que sale gratis del diseño de D23.** Allá el
secreto es por canal, así que hay que resolver tenant y canal **antes** de poder
verificar: un request falso ya costó dos consultas. Acá el App Secret es uno
solo y nuestro, así que **la firma se verifica antes de tocar la base**.

#### ⚠️ Una entrega puede traer mensajes de dos casinos

Es la diferencia de forma más importante con Telegram, y no es cosmética.
Telegram manda **un update por request**; Meta manda un sobre con `entry[]`, y
cada entrada con `changes[]`. Nada impide que en la misma entrega vengan
mensajes de dos números — que por D23 pueden ser de **socios distintos**.

`crm_raw_events` vive en la base **del tenant**. Guardar el sobre entero en una
sola base metería el payload de un casino adentro de la base de otro —nombres,
teléfonos, el texto de lo que escribieron—. Eso es **P4** roto, y no como un
ruteo mal hecho: como una **filtración guardada en reposo** que nadie ve.

Por eso la entrega se parte y cada trozo se guarda **recortado a su número**: una
`entry`, un `change`. Hay un test que manda una entrega con un número nuestro y
uno ajeno y comprueba que lo guardado **no contiene** ni el número ni el texto
del otro.

#### Lo que falta para prenderlo

1. `WHATSAPP_APP_SECRET` y `WHATSAPP_VERIFY_TOKEN` en el entorno (ver
   `apps/api/.env.example`). **Sin el App Secret el webhook rechaza todo**, a
   propósito: no verificar no es lo mismo que aceptar.
2. La pantalla para vincular un número (equivalente de `/support/canales`), que
   es la que escribe en `whatsapp_numbers`. Hoy la fila se carga a mano.
3. El procesamiento del `change`.
4. Y lo que no depende de nosotros: que Meta verifique la cuenta del socio
   (**D13**) y que la App salga del trámite.

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

### 3.5 — Audio sí, video no

**Lo difícil no fue sumar el MIME.** El filtro de archivos apoya casi toda su
seguridad en el **redibujado**: una imagen se re-encodea desde los píxeles y lo
que se guarda es un archivo nuevo, sin metadata ni payload embebido. **Para
audio no hay equivalente** —pediría ffmpeg, y re-encodear una nota de voz además
la degrada—, así que se guarda tal cual vino. Es el mismo trato que ya tiene el
PDF, y está escrito en el código en vez de disimulado.

**La trampa de verdad: "video no" no se sostiene mirando la firma del archivo.**
OGG y MP4 no son formatos, son **contenedores**, y los dos llevan video igual de
bien que audio:

| Lo que parece | Lo que es |
|---|---|
| `OggS…` | una nota de voz **o** un video Theora |
| `…ftyp…` | un AVIF, un audio M4A **o** un MP4 de video |

Aceptar la firma a secas habría dejado entrar **justo lo que se cerró**, por la
puerta que se acababa de abrir, y la decisión habría quedado escrita en los docs
y falsa en el producto. Por eso de los contenedores se mira el **códec de
adentro**: se acepta Opus y Vorbis, se rechaza Theora; y en ISOBMFF sólo la
marca `M4A `, no `isom`/`mp42`/`avc1`.

**Una línea repetida tres veces que con audio estaba mal en las tres.** El tipo
del adjunto se deducía con `mime === 'application/pdf' ? 'pdf' : 'image'` en el
upload, al persistir el mensaje y al bajar de Telegram. Correcta mientras
hubiera dos tipos; con audio, **toda nota de voz habría quedado etiquetada como
imagen** y la burbuja habría intentado dibujarla con un `<img>`. Ahora sale del
validador (que lo detectó por los bytes) o de `kindDelMime()`.

**Telegram deja de rechazar las notas de voz.** Antes se nombraban con un aviso
—el rodeo correcto mientras no se pudieran guardar— y ahora se bajan. Video,
GIFs y figuritas se siguen rechazando con su aviso: es la otra mitad de la misma
decisión, no un pendiente.

**Verificado contra el endpoint real**, con sesión de verdad: Theora, un MP4
`isom` y un ejecutable renombrado `.ogg` se rechazan los tres con `400
FILE_TYPE_UNKNOWN`. Los tests del validador se probaron **rompiendo las dos
comprobaciones de códec a propósito** para confirmar que fallan.

#### ✅ Probado con una nota de voz real (2026-09-10)

El guardado y la burbuja no se podían verificar en local —el entorno no tiene
credenciales de R2, y sin storage no hay adjunto que dibujar— así que se probó
en staging: **el dueño le mandó una nota de voz al bot y suena**. Con eso queda
cerrado el 3.5 **y el 2.4** (recibir adjuntos por Telegram con un bot real).

**Costó tres vueltas, y las tres eran capas distintas del mismo síntoma.** El
reproductor aparecía y no sonaba, sin un error en ningún lado. Vale la pena
dejarlas escritas, porque ninguna era del CRM:

1. **`STORAGE_PUBLIC_BASE_URL` no estaba cargada en staging.** El
   `LocalDiskDriver` cae a `http://localhost:3000`, así que **todos los adjuntos
   apuntan a la máquina de quien mira**. Falla dos veces callado: la URL no
   existe para el cliente, y encima es `http` adentro de una página `https`.
   Afecta a las imágenes igual — nadie lo había visto porque hasta ese día no
   había entrado ningún adjunto por un canal externo.
2. **El `.ogg` se servía sin `Content-Type` y sin `Content-Length`.**
   `guessMime` conocía imágenes y PDF nada más; el audio entró con esta tanda y
   ahí no se sumó. Sin tipo, el navegador no adivina para media. Sin largo ni
   `Range`, el `<audio>` no sabe la duración: queda en `0:00 / 0:00`.
3. **Cada deploy borra el disco de staging**, así que el archivo de una prueba
   no sobrevive a la prueba siguiente.

Lo 1 y lo 2 están arreglados (`storage-servir-archivos.e2e.ts`, 16 tests) y el
driver ahora **avisa al arrancar** si la variable falta. Lo 3 es a propósito y
sigue igual: ver la nota del deploy, abajo.

> **Lo que sigue sin probarse con un bot real:** el **2.8**, mandar un archivo
> *desde* el panel. Es contestar con el clip.

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
| 4.1 | Retención de adjuntos a 6 meses (**D15**) | ✅ **Hecho**, apagado por default (ver abajo) |
| 4.2 | Cierre de red auditado (**D14**) | 🔴 **Delicado**: habilita una excepción a R6. Sólo el admin, auditado. |
| 4.3 | Llenar `crm_timeline_events` **y mostrarla** | ✅ **Hecho** |
| 4.4 | Métricas por tramos | ✅ **Hecho** (migración `0115`). Sin backfill: mide desde que se instaló |
| 4.5 | Aviso al operador por Telegram | La mejora descartada en **D16**, si el hueco molesta |
| 4.6 | Varios agentes en la misma bandeja | Se ofreció excluirlo y no se marcó |
| 4.7 | Búsqueda global de mensajes | Ídem. Por **D6** hay que acotarla por bandeja. |
| 4.8 | Campañas y mensajes masivos | ✅ **Adentro por D21** (D19 revertida) |

### 4.3 — El historial: qué se anota, y qué no

`crm_timeline_events` existía desde que se creó el CRM. Hasta acá **sólo la
escribían el vínculo y el desvínculo**, y **no la leía nadie**: los eventos se
guardaban y se veían consultando la base a mano.

**No es un registro de lo que se habló.** Los mensajes ya están en el hilo, y
duplicarlos no agregaría nada. Lo que se anota es lo que, si no se registra
cuando pasa, **no se puede reconstruir después**:

| Evento | Por qué se pierde si no se anota |
|---|---|
| `link` / `unlink` | El vínculo es una columna que se pisa: después del cambio no queda rastro de que hubo otro antes, ni de quién lo hizo. |
| `alta` | El jugador queda creado, pero **nada dice que salió de esta conversación** — y por **D9** de dónde salió define de quién cuelga, o sea las comisiones. |
| `estado` | `crm_conversations.status` es mutable y sin historial. Mirando los mensajes no hay forma de saber cuándo se resolvió ni quién. |
| `aviso` | El aviso de **D8** sale para **otra** bandeja y no deja nada en ésta. Sin esto, *"¿ya le avisamos al cajero?"* no tiene respuesta — y es la pregunta natural cuando el mismo jugador vuelve a escribir. |

**El aislamiento sale gratis de D6.** Los eventos cuelgan del contacto, y un
contacto es de una bandeja: no existe un contacto compartido del que se pueda
leer la actividad de otra red. Y lo que se anota del aviso es **que se avisó**,
no qué se habló: la línea de tiempo no es una puerta de atrás a D8.

**Escribir no puede voltear la operación.** `anotar()` no tira nunca: dejar de
vincular un contacto porque falló el insert de la auditoría sería cambiar algo
que el operador pidió por un registro que nadie estaba mirando.

**Qué sigue sin estar en la ficha, y se dice ahí:** la etapa del circuito y los
tiempos del tramo. No es que no existan —la etapa se deriva en *Circuitos*
(**D22**) y los tramos se miden desde la `0115`— es que traerlos serían dos
consultas más por contacto abierto, y las dos pantallas donde viven ya los
muestran.

> ### Nota sobre cómo correr los tests — ✅ resuelto el mismo día
>
> Durante esta tanda, **mezclar el patrón `crm-` con el de las suites unitarias
> en un mismo comando hacía fallar cosas al azar**. El síntoma era `no existe la
> base de datos «tenant_jest_test»`: el `globalTeardown` la dropea, y la mezcla
> dejaba suites e2e corriendo contra una base que ya no estaba. Se verificó con
> `git stash` que no venía de estos cambios.
>
> **Lo arregló la sesión de plataforma** con `TEST_TENANT_SUFFIX` (commit
> `3bbb9db`, *"cada sesión con su propio tenant de test"*). Comprobado después de
> rebasar: el comando mezclado pasa **268 en verde, 20 suites**.
>
> Se deja escrito porque el síntoma es confuso y puede volver si dos corridas
> comparten el mismo sufijo.

### 4.1 — Borrar los adjuntos vencidos, y por qué va apagado

**El cron va apagado salvo `CHAT_RETENCION_ENABLED=1`**, al revés que los otros
crons de retención de la plataforma, que se prenden salvo que alguien los apague.
No es simetría rota por descuido: los otros borran **logs**; éste borra **fotos
de DNI y comprobantes que mandó gente real**, sin vuelta atrás. Un proceso así no
se prende porque el contenedor arrancó.

Y tiene **modo simulacro** (`CHAT_RETENCION_SIMULACRO=1`): recorre todo, cuenta
lo que borraría y no toca nada. Es la forma de ver qué haría la primera corrida
sobre un historial real —y cuánto volumen hay acumulado— antes de dejarla borrar.

**El orden es: primero el archivo, después la base.** Al revés dejaría archivos
huérfanos **invisibles**: la base diría que se borró, el archivo seguiría en el
bucket, y nadie lo buscaría nunca porque el registro dice que está todo bien.
Así, un fallo deja un estado que la corrida siguiente arregla.

#### 🔴 Lo que hubo que arreglar antes: `delete()` no informaba nada

El roadmap ya avisaba que el borrado en R2 es nuevo y que **conviene verificarlo,
no darlo por hecho**. Al mirarlo apareció algo peor: **los tres drivers de
storage devolvían `void`**, y el de Cloudflare Worker —el que sirve producción—
**se tragaba el fallo a propósito**, logueando y siguiendo.

Para limpiar el comprobante de un depósito rechazado eso está bien: lo que
importaba ya pasó, y hacer fallar la operación por un archivo sería cambiar un
problema de housekeeping por uno de negocio. **Para retención no alcanza**:
marcaría en la base que una foto de DNI se borró mientras el archivo sigue en el
bucket, y esa mentira no la descubre nadie porque el registro dice que está bien.

`delete()` ahora devuelve **si el archivo ya no está** (`true`) o **si sigue ahí**
(`false`), y sigue sin tirar. Los llamadores viejos no cambian de
comportamiento; el de depósitos ya envolvía la llamada en un `try`.

#### ⚠️ El cinturón: qué claves puede borrar

**Sólo las que están bajo `/chat/attachments/`.** D15 lo dice explícitamente: el
comprobante oficial de un depósito (`deposits/proofs/…`) es **otro archivo, con
su propio ciclo de vida**, y que se borre la foto que el jugador mandó por chat
no toca el comprobante con el que se aprobó el depósito.

Hoy nada mete una clave de comprobante adentro de un mensaje. El chequeo está
igual porque el costo de equivocarse **no es un bug: es un documento financiero
borrado sin vuelta atrás**, y porque esto va a seguir corriendo mucho después de
que nadie recuerde por qué era seguro. Si el contador de omitidos no da cero, el
cron lo grita en el log.

**Verificado contra el storage de verdad**, no contra un mock: la suite sube
archivos con el driver de disco —el mismo que corre en staging—, purga, y
comprueba en el filesystem que **el archivo ya no está**. Un mock que devuelve
`true` probaría justo la parte que no importa. Se probó además **rompiendo a
propósito** el filtro de antigüedad y el cinturón: cada rotura la agarra
exactamente el test que corresponde.

**En pantalla el mensaje queda**, con la marca en vez del adjunto — y sin `url`,
para que no quede un link que devuelve 404 y parezca que algo se rompió.

> **Falta lo único que no se puede probar en local:** que el borrado ande contra
> **R2 de verdad**. En test y en staging el driver es `local`. La primera corrida
> real conviene hacerla **en simulacro**, y después sobre un casino chico.

---

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
