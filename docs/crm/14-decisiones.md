# 14 · Bitácora de decisiones del CRM

> Cada decisión con su fecha, lo que se descartó y por qué. Una decisión sin su
> alternativa descartada no es una decisión: es una casualidad que nadie puede
> revisar después.
>
> Formato: las decisiones no se editan, se **reemplazan** — si una cambia, se
> agrega una nueva que la anula y se marca la vieja. Así queda el historial.

---

## Bloque 1 — Canales, ruteo y aislamiento

**Decidido el 2026-09-08** con el dueño.

Es el bloque que condiciona todo el resto: de quién son los canales determina el
ruteo, el ruteo determina los permisos, y los permisos determinan qué muestra la
pantalla.

---

### D1 · Los canales pertenecen a un panel, no al tenant

**Un número de WhatsApp o un bot de Telegram se vincula a un panel concreto**, no
al casino en general:

- **Red central** — los canales son del casino. Los atiende el staff central
  (admin + empleados), igual que hoy atiende el livechat de la red dependiente.
- **Red independiente** — **cada panel** puede vincular los suyos: el socio, cada
  distribuidor y cada cajero. Cada uno atiende lo suyo.

**Por qué.** Una red independiente es un negocio aparte —así está modelada toda
la plataforma— y adentro cada operador tiene su propia relación con sus
jugadores. Obligarlos a compartir un número central sería mezclar carteras de
clientes que el modelo mantiene separadas a propósito.

**Se descartó:**

- *Todos los canales del casino.* Más simple de construir, pero deja a los
  socios independientes sin canal propio: sus jugadores tendrían que escribirle
  al casino, y eso contradice que sean un negocio aparte.
- *Un canal por red, sin bajar a operador.* Intermedio, pero dentro de una red
  independiente el cajero es quien tiene el trato diario con el jugador; el
  socio no atiende a todos.

**⚠️ Consecuencia que hay que tener presente al prometerlo.** Cada número de
WhatsApp Business tiene **costo y verificación propios** ante Meta: nombre de
empresa y documentación. No es "agregar un número al sistema", es dar de alta un
negocio. Un socio con ocho cajeros son ocho altas, ocho verificaciones y ocho
costos.

**Consecuencia en el modelo de datos:** una cuenta de canal necesita dueño. No
alcanza con `tenant_id`: hace falta apuntar al usuario-panel propietario, o
marcarla como central.

---

### D2 · Atiende la bandeja dueña del número

**Un mensaje entrante se atiende en la bandeja del canal por el que entró**,
incluso si viene de un número desconocido que no está en la base.

Si alguien escribe al WhatsApp del socio Litoral, lo atiende Litoral — sepamos o
no quién es.

**Por qué.** Es la única regla sin ambigüedad. El canal por el que alguien elige
entrar *es* la información de a quién buscaba.

**Se descartó:**

- *Todo lo desconocido a la bandeja central.* Daría más control, pero el staff
  central terminaría viendo conversaciones que no le corresponden y transfiriendo
  a mano lo que el propio número ya definía.
- *Una bandeja de "sin asignar".* Flexible, pero necesita que alguien la mire.
  Lo que es de todos no es de nadie, y un jugador esperando en esa bandeja es un
  jugador sin responder.

---

### D3 · El staff central atiende a jugadores de otras redes, sin ver su plata

> **Matizada por D8.** El punto de "derivar" NO es mover la conversación:
> es mandar un aviso sin contenido. El resto de D3 sigue en pie.

Cuando un jugador de una **red independiente** escribe a un canal **central**, el
staff central:

- **puede** responderle, ver la conversación y su identidad;
- **no ve** su saldo, sus depósitos, sus retiros ni sus movimientos;
- **ve un cartel visible** diciendo de qué red es ("este jugador es de la red de
  Litoral");
- puede **derivar** la conversación a la bandeja que corresponde.

**Por qué.** Respeta la **LEY R6** —*el admin ve de la red independiente sólo
agregados, no el detalle interno*— sin dejar a una persona sin respuesta porque
escribió al número equivocado.

**Se descartó:**

- *Atenderlo con todo el contexto.* Era la opción elegida en primera instancia y
  se revisó al precisar qué ley tocaba. Habría requerido **autorizar una
  excepción a R6**, y lo que se estaría autorizando es que un *empleado* de la
  red central vea el saldo y los movimientos de los clientes de un socio
  independiente — un socio que no se entera y no lo consintió. Existía
  precedente (la excepción de sólo lectura del 2026-08-13 para la auditoría de
  pagos), pero acá el argumento a favor era débil: **el staff central no puede
  resolver un problema de plata de otra red** —no puede cargar ni mover fichas,
  eso sigue prohibido por E8/P3— así que ver el saldo no le habría servido para
  nada más que mirar.
- *Transferir directo, sin atender.* Aislamiento total, pero la persona espera
  sin respuesta hasta que el socio lea. Peor experiencia por una diferencia de
  criterio que el cartel ya resuelve.

**Leyes que aplican:** R6 (visibilidad), P1 (permiso + scope, nunca cruzar
redes). **No** toca E8 ni P3: el CRM no mueve fichas.

---

## Bloque 2 — Identidad: quién es quién, y quién lo ve

**Decidido el 2026-09-08** con el dueño.

El bloque 1 definió **de quién es cada canal**. Este define **de quién es cada
persona que escribe por esos canales** — que no es lo mismo, y es donde el
diseño original se había equivocado.

> **⚠️ Este bloque anula el diseño original.** El comentario de `crm_contacts`
> en `packages/db/src/tenant/crm.ts` dice: *"el `phone` (E.164) es la llave de
> auto-merge (lead web + WhatsApp + jugador = 1)"*. **Eso ya no aplica.** Se
> verificó que nunca llegó a implementarse —no hay ninguna búsqueda por teléfono
> en `apps/api/src/chat/`, y el índice sobre `phone` es común, no único—, así que
> no hay nada que desarmar. El comentario hay que corregirlo cuando se toque la
> tabla.

---

### D4 · El teléfono identifica al jugador solo, sin preguntar

Cuando entra un mensaje de un número que no está en la base, el sistema **busca
ese teléfono entre los jugadores y lo vincula automáticamente** si lo encuentra.
Nadie confirma nada a mano.

**Por qué.** El operador atiende con el contexto puesto desde el primer mensaje.
La alternativa —sugerir y esperar confirmación— agrega un clic a cada
conversación nueva para protegerse de un caso raro.

**Se descartó:**

- *Sugerir y que el operador confirme.* Más seguro, pero convierte un acierto
  del sistema en una tarea del humano, cientos de veces por semana.
- *Sólo vincular a mano.* Descartado de entrada: es hacer el trabajo del sistema.

**⚠️ Lo que se está aceptando a cambio.** `users.phone` es **texto libre, sin
índice único**: hoy nada impide que dos jugadores tengan el mismo número. Un
teléfono mal cargado, o compartido de verdad —una pareja, un locutorio, un
familiar que anota a otro— **une a dos personas distintas en una sola ficha**, y
el operador ve el nombre equivocado sin ninguna señal de que algo pasó.

Consecuencias que hay que resolver al construirlo:

1. **Normalizar a E.164 antes de comparar.** `3415551234`, `+543415551234` y
   `0341 15 555-1234` son el mismo número. Sin normalizar, el vínculo automático
   falla justo cuando más sirve.
2. **Si el teléfono matchea con más de un jugador, no vincular ninguno.** Ante la
   duda, lead sin vincular: mostrar el nombre equivocado es peor que no mostrar
   ninguno.
3. **El vínculo tiene que poder deshacerse** desde la ficha, y quedar registrado
   quién lo deshizo.

---

### D5 · Un lead es del dueño del canal por el que entró

Alguien que escribe y **no es jugador de nadie** queda como lead **del panel
dueño del canal**: si escribió al WhatsApp del cajero Pérez, es un lead de Pérez.

**Por qué.** Es la misma lógica de D2 —atiende la bandeja dueña del número—
llevada a quién se queda con el contacto. El canal por el que alguien entra ya
dice a quién buscaba, y quien puso el número es quien hizo el esfuerzo de
conseguir ese contacto.

**Se descartó:**

- *Todos los leads al casino.* Le daría al admin una cartera de prospectos
  central, pero desalienta exactamente lo que D1 habilita: que un operador
  invierta en su propio canal. Si los contactos que consigue terminan siendo de
  otro, no tiene por qué usarlo.
- *Una bolsa común de leads.* Mismo problema que la bandeja "sin asignar" de D2:
  lo que es de todos no es de nadie.

**Consecuencia:** cuando un lead se convierte en jugador, el alta **cuelga del
dueño del canal**. Un lead de Pérez que se registra es jugador de Pérez. Esto
se cruza con el bloque de "crear usuarios desde el CRM" (`07-crear-usuarios.md`)
y con las comisiones: el árbol comercial se define acá, no después.

---

### D6 · El contacto es de una bandeja, no del casino

**Cada dueño de canal tiene su propia ficha de una misma persona.** Si Juan le
escribe al WhatsApp de su cajero Pérez y también al WhatsApp del casino, hay
**dos contactos**: el Juan de Pérez y el Juan del casino. El sistema no los une
aunque el teléfono sea idéntico.

Lo que **sí** se comparte es el vínculo al jugador: las dos fichas pueden
apuntar al mismo `user_id` por D4. Lo que no se comparte es la conversación.

**Matiz importante — se separa por dueño, no por canal.** Dentro de una misma
bandeja la persona es **una sola**: Pérez ve un único Juan, con su hilo de
WhatsApp y su hilo del widget web juntos. Partirlo también ahí no protegería
nada —mismo operador, misma red, mismo jugador— y sólo duplicaría fichas.

```
Bandeja de Pérez      →  Juan  ·  hilo WhatsApp  +  hilo web
Bandeja del casino    →  Juan  ·  hilo WhatsApp central
                         (dos fichas distintas, mismo user_id)
```

**Por qué.** Es la lectura más estricta de **R6**. Con una ficha compartida, todo
lo que se le cuelgue —notas internas, etiquetas, historial— es una superficie por
la que se filtra la operación de una red independiente hacia el staff central. Un
solo campo mal expuesto en una pantalla alcanza. Con fichas separadas no hay nada
que filtrar: el dato no está del otro lado.

**Se descartó:**

- *Una ficha con un hilo por canal.* Era la opción intermedia y la más parecida a
  cómo funciona hoy el livechat. Se descartó porque la ficha compartida sigue
  siendo compartida: cada campo que se le agregue en el futuro hay que auditarlo
  contra R6 de nuevo.
- *Una ficha y un solo hilo con todo mezclado.* El staff central leería lo que
  Juan le escribió a su cajero. Choca de frente con R6.

**Lo que cuesta:** el mismo jugador puede tener dos fichas con notas distintas y
nadie las concilia. Es el precio elegido a cambio de que no haya forma de que una
red vea la operación de otra.

**Consecuencia en el modelo de datos:** `crm_contacts` necesita **dueño**
—apuntar al panel propietario, o marcarse como central— igual que las cuentas de
canal en D1. Y la unicidad, si algún día se agrega, es **por (dueño, teléfono)**,
nunca por teléfono solo.

---

### D7 · Al staff central no se le menciona que existen otras conversaciones

Cuando el staff central abre el hilo de un jugador de una red independiente, ve
**su propio hilo y nada más**. No hay un renglón de "tiene 3 conversaciones con
su cajero", ni un contador, ni una pestaña vacía.

Sigue viendo, por **D3**: quién es, de qué red es —el cartel *"este jugador es de
la red de Litoral"*— y el botón para **derivar**. Eso no sale del historial: sale
del vínculo al jugador (D4), que dice a qué red pertenece sin contar nada de lo
que se habló.

**Por qué.** Un contador de conversaciones **es** información: dice si el jugador
habla seguido con su cajero, si lo tiene abandonado, si viene reclamando. R6 dice
agregados, no detalle interno, y un contador de esa clase es detalle interno
disfrazado de número.

**Se descartó:**

- *Avisar que existen sin dejar leerlas.* Parece inocuo y ayudaría a derivar
  mejor, pero el volumen y la frecuencia de las conversaciones de otra red son
  precisamente lo que R6 protege. Y la derivación ya funciona sin ese dato.

**Leyes que aplican:** R6 (visibilidad), P1 (permiso + scope).
---

## Bloque 3 — La operación: derivar, dar de alta, supervisar, cerrar

**Decidido el 2026-09-08** con el dueño.

Los bloques 1 y 2 definieron de quién es cada canal y de quién es cada persona.
Este define **qué se puede hacer** con eso.

> **Estado del código al decidir esto.** Se leyó `apps/api/src/chat/` antes de
> preguntar. Lo que existe: notas, etiquetas, plantillas y la ficha de contexto.
> Lo que **no** existe: transferencia (ningún endpoint, ningún campo), y ningún
> cambio de estado de la conversación — `status` está en la tabla y nada lo
> escribe.

---

### D8 · Derivar es avisar, no mandar la conversación

Cuando el staff central atiende a un jugador de una red independiente y lo manda
a su red, lo único que llega a la otra bandeja es **un aviso**: quién escribió y
cuándo. **Ni una palabra del contenido.**

```
BANDEJA DEL CAJERO
── Aviso ────────────────────────────────
Juan Pérez escribió al casino hoy 14:32.
Se le pidió que te contacte.
(sin contenido)
```

**Por qué.** Es lo que **D6 ya implicaba**: si el contacto del casino y el
contacto del cajero son dos fichas distintas, nunca hubo una conversación que
mover. "Derivar" era, en realidad, *copiar* — y copiar es la decisión que se
está tomando acá, en su forma más restringida.

**Se descartó:**

- *Un resumen escrito a mano por el staff central.* Da control fino sobre qué se
  comparte, pero depende de que alguien lo redacte bien **cada vez**, y un
  resumen mal escrito filtra igual.
- *La conversación entera.* Cero pérdida de contexto, pero el cajero leería la
  queja que el jugador hizo **sobre él**. Un jugador que sabe que su cajero va a
  leer lo que dijo deja de escribir al central — y ahí se pierde la única señal
  que el casino tiene sobre cómo se atiende en las redes independientes.

**⚠️ Corrección a D3.** D3 dice que el staff central *puede derivar la
conversación a la bandeja que corresponde*. **La palabra estaba mal elegida:** no
se deriva una conversación, se avisa. La decisión de D3 no cambia —el staff sigue
atendiendo, viendo la identidad y el cartel de red, y sigue pudiendo señalar el
caso— pero el mecanismo es un aviso.

**A quién le llega el aviso:** al **operador directo** del jugador (su cajero),
que es a quien el ruteo ya le asigna todo lo suyo. No al socio de esa red — ver
D10.

---

### D9 · El alta cuelga del dueño del canal, y no se elige

Un jugador creado desde una conversación **cuelga del panel dueño del canal por
el que entró**. El campo es fijo: no hay desplegable, no se puede elegir otro.

Escribió al WhatsApp del cajero Pérez → jugador de Pérez. Punto.

**Por qué.** Es D5 llevado hasta el final: el canal por el que alguien entra
define de quién es. Y sin desplegable **no hay forma de colgarse un jugador que
no corresponde** — ni por error ni a propósito. En un sistema donde de quién
cuelga un jugador determina comisiones, un campo editable es una tentación
permanente.

**Se descartó:**

- *Editable dentro de la propia bajada.* Le permitiría a un socio repartir
  jugadores entre sus cajeros desde el chat. Cómodo, pero abre exactamente la
  puerta que la opción elegida cierra: un alta puede terminar colgada de quien
  convenga, no de quien atendió. Si algún día hace falta, que sea una acción
  aparte, explícita y auditada — no un desplegable en el formulario de alta.
- *No crear nada, mandar un link de registro.* Menos código y cero riesgo, pero
  es justo la fricción que este CRM viene a sacar.

**⚠️ Consecuencia comercial.** Alguien que escribe **primero al número central**
—aunque se lo haya recomendado un amigo que juega con Pérez— se da de alta como
jugador **de la red central**. No hay error: por D5 el lead es del casino. Pero
es un efecto real sobre el árbol de comisiones y conviene que los operadores lo
sepan: **el que quiere el jugador tiene que hacer que le escriba a su número.**

Si el caso se vuelve frecuente, la salida NO es abrir el desplegable: es que el
staff central le pida que escriba al número de su cajero **antes** de crear nada.

---

### D10 · Un socio no ve las conversaciones de sus cajeros

Cada operador ve **lo suyo y nada más**. Un socio independiente no lee las
conversaciones de sus distribuidores ni de sus cajeros.

**Por qué.** Es lo que el código ya hace —`resolveInboxOwner` le devuelve su
propio id— y se confirma como decisión, no como accidente. La conversación entre
un cajero y su jugador es la relación comercial del cajero.

**Se descartó:**

- *Que vea todo lo de su bajada.* Defendible por P2 (regla del techo) y no
  violaría R6 —que protege a la red independiente del admin, no al cajero de su
  propio socio—. Se descartó igual: es una capacidad de vigilancia que nadie
  pidió.
- *Que vea la lista sin el contenido* (quién habló, cuánto tardaron en
  responder, cuántos quedaron sin contestar). Era el intermedio: supervisar la
  atención sin leer nada. **Queda anotado como candidato para `10-metricas.md`**
  — si algún día hace falta supervisión, esta es la forma que no lee
  conversaciones privadas.

**⚠️ El hueco que dejan D8 + D10 juntos.** Un cajero que atiende mal queda
**invisible para todos**:

- el jugador se queja al central, pero por D8 esa queja no viaja;
- el socio podría notarlo, pero por D10 no ve nada de su cajero;
- el cajero recibe un aviso que puede ignorar igual que ignoró al jugador.

El único que se entera es el staff central, y sólo si presta atención a que el
mismo jugador vuelve. **No es un error en las decisiones** —cada una es correcta
por separado— pero el efecto combinado hay que tenerlo presente. La salida, si
aparece el problema, es la opción descartada de arriba: métricas de atención
para el socio, sin contenido.

---

### D11 · Un solo hilo por contacto y canal, para siempre

Una conversación cerrada **se reabre** si la persona vuelve a escribir. No se
crea un hilo nuevo.

**Por qué.** Es exactamente lo que el schema ya describe —*hilo CONTINUO por
contacto y canal*—, así que no hay nada que migrar. Y el operador ve todo lo que
esa persona habló con él de un vistazo, sin abrir nada.

**Se descartó:**

- *Un hilo nuevo por vuelta, con los anteriores listados.* Más prolijo para medir
  y para saber qué está realmente pendiente. Se descartó por no agregar una capa
  de navegación a algo que hoy funciona.

**⚠️ Dos cosas que esto rompe, y hay que resolver en su momento:**

1. **Las métricas pierden sentido.** Con un hilo eterno, "conversaciones
   abiertas" y "tiempo de respuesta" no significan nada: el hilo de Juan lleva
   ocho meses abierto. Cualquier métrica va a tener que calcularse sobre
   **tramos** —del primer mensaje entrante hasta que se marca resuelto—, no sobre
   la conversación. Va a `10-metricas.md`.
2. **La ventana de 24 horas de WhatsApp no se reabre con el hilo.** Reabrir una
   conversación de hace tres semanas no habilita a escribir libremente: si el
   último mensaje del cliente pasó las 24 h, sólo sale una **plantilla aprobada**.
   La pantalla tiene que mostrarlo **antes** de que el operador escriba, no
   después de que el mensaje falle.

**Falta construir:** nada cambia el `status` hoy. Cerrar, marcar pendiente y
reabrir son tres acciones que no existen.

---

## Deuda técnica detectada, no resuelta

Salió de leer el código al decidir el bloque 3. No son decisiones: son cosas que
ya están escritas y hay que arreglar.

### 🔴 `getContext` devuelve la plata sin mirar de qué red es

`apps/api/src/chat/chat-crm.service.ts` arma la ficha del contacto con **saldo,
últimos 5 depósitos y últimos 5 retiros**, sin ninguna comprobación de red.

**Hoy no filtra nada** porque el ruteo lo hace inalcanzable: el único canal es el
widget web y las conversaciones de un jugador independiente van siempre a su
operador directo, nunca a la bandeja central.

**Pero D3 abre esa puerta a propósito.** El día que exista un número de WhatsApp
central, el staff central va a poder abrir la ficha de un jugador de otra red — y
con el código actual va a ver su saldo y sus movimientos. Eso es **R6**.

Arreglarlo es requisito para el primer canal externo, no algo para después.
---

## Bloque 4 — Los canales externos de verdad: archivos, altas, bajas y retención

**Decidido el 2026-09-08** con el dueño.

Los bloques anteriores definieron quién atiende a quién. Este define **qué pasa
con las cosas**: los archivos que manda la gente, los números de teléfono, y qué
queda cuando alguien se va.

---

### D12 · Los adjuntos del chat se firman, igual que los comprobantes

Las fotos y PDFs que se mandan por chat pasan a servirse con **URL firmada de 15
minutos** y caché privada, como ya se hace con los comprobantes de depósito.

**El hallazgo que lo motivó.** Tanto la API como el Worker deciden qué es privado
con la misma regla: que la ruta contenga `/proofs/`.

| Carpeta | Hoy |
|---|---|
| `bank-transactions/proofs/…` | firmado, `private, max-age=300` |
| `deposits/proofs/…` | firmado, `private, max-age=300` |
| `chat/attachments/…` | **público, `max-age=31536000, immutable`** |

Los adjuntos del chat **no** contienen `/proofs/`. Consecuencia: cuando se
termine el runbook `docs/runbooks/firmar-comprobantes.md`, **los adjuntos del
chat van a seguir siendo públicos**, porque la regla no mira esa carpeta.

Y el livechat ya está prendido en producción. Un jugador que manda por el widget
una foto del DNI o un comprobante de transferencia deja esa imagen en una URL
pública permanente. No es enumerable —la clave es un UUID— pero es el mismo
problema que se decidió arreglar en los comprobantes, en una carpeta que la regla
no cubre.

**Con WhatsApp esto se multiplica**: mandar fotos por WhatsApp es lo normal, no
la excepción.

> **Corrección (2026-09-08, al implementarlo).** Al decidir esto se dijo que
> `crm_messages.attachments` guardaba la URL dentro del mensaje y que había que
> cambiar cómo se persiste el adjunto. **Es falso.** Se leyó el código al
> implementar: `chat.types.ts` documenta que la `url` **no se persiste**,
> `sanitizeAttachments` la descarta al guardar, y `hydrateMessage` la regenera
> con `storage.getUrl(storageKey)` en cada lectura. O sea que el livechat ya
> estaba preparado para URLs que vencen desde que se construyó.
>
> **El arreglo era, efectivamente, cambiar una constante en cada lado**, más los
> tests. Sin migración, sin cambio de datos y sin tocar el flujo de mensajes.

**Se descartó:**

- *Sacarles sólo la caché eterna.* Cambio chico y sin tocar el modelo de datos,
  y al menos borrar un archivo tendría efecto. Pero el link seguiría abriendo la
  foto para siempre y sin forma de revocarlo.
- *Dejarlo como está.* La clave es un UUID imposible de adivinar, así que nadie
  llega por casualidad. El problema no es que lo adivinen: es que el link, una
  vez que sale de la plataforma —reenviado, pegado en un chat, en una captura—,
  sirve para siempre.

**Cómo se implementa, sin repetir el error del runbook:** el orden es el mismo
que en `firmar-comprobantes.md` — **primero el Worker** (que acepte firma y deje
de mandar `immutable` para esa carpeta), **después** la API. Al revés, cada URL
firmada crearía una entrada de caché pública de un año.

---

### D13 · Cada socio da de alta su propio número, con sus papeles

Un socio independiente que quiera WhatsApp **abre su propia cuenta de Meta
Business y hace su propia verificación**. El casino sólo conecta el número al
CRM. No lo paga y no responde por él.

**Por qué.** Es coherente con que una red independiente sea un negocio aparte
(R4). Y evita el riesgo real de la alternativa: con todos los números bajo la
empresa del casino, **una denuncia contra el número de un socio cae sobre la
cuenta del casino** y complica a todos los demás — incluido el central.

**Se descartó:**

- *Todos los números bajo la empresa del casino.* Arranca mucho más rápido y le
  saca el trámite de encima al socio. Se descartó por el riesgo compartido: una
  sola cuenta de Meta para todos significa que el peor operador define el
  destino del canal de todos.

**⚠️ Lo que esto cuesta, y hay que decirlo de entrada.** El socio **no tiene
canal hasta que Meta lo verifique**. Eso es un trámite con documentación de
empresa y tiempos que no controlamos. Un socio chico, o uno que no tiene la
empresa a su nombre, simplemente **no va a poder usar WhatsApp**.

**Consecuencia de producto:** para esos casos, **Telegram es la puerta de
entrada** — un bot es gratis, se crea en cinco minutos y no pide papeles. Vale la
pena que el CRM lo trate como un canal de primera y no como el hermano menor de
WhatsApp: para buena parte de los operadores va a ser el único que puedan usar.

**Consecuencia al construir:** el alta de un canal es un flujo del **socio**, no
del admin. La pantalla tiene que poder explicarle el trámite y mostrarle en qué
paso está, porque el casino no puede resolvérselo.

---

### D14 · Cuando una red se cierra, sus conversaciones pasan al staff central

⚠️ **Esto es una excepción autorizada a la LEY R6.** Está anotada también en
`docs/LEYES.md` y en `docs/DEVLOG.md` 2026-09-08.

Cuando un socio independiente deja de operar, sus contactos y conversaciones
**pasan a la bandeja central como chats normales**, con una etiqueta que marca la
red de origen. El staff central —**incluidos los empleados**— lee el historial
completo.

**Por qué.** Los jugadores se quedan y hay que seguir atendiéndolos. Sin el
historial, el staff arranca de cero con gente que viene con problemas abiertos, y
la etiqueta de origen alcanza para saber de dónde vienen.

**Lo que se está autorizando, dicho sin vueltas.** El staff central pasa a leer
**todo lo que ese socio y sus cajeros hablaron con sus jugadores**, durante todos
los años que operó. Y una salida no siempre es en buenos términos: un socio que
se va peleado descubre que el casino ahora lee todo.

**Se descartó** (las dos alternativas se plantearon explícitamente y el dueño
mantuvo su elección):

- *Archivo aparte, de sólo lectura y auditado.* Era la vía que **R6 ya
  contempla** —*"puede intervenir en todo, pero por un mecanismo separado y
  auditado, nunca por los botones normales de operación"*— y no habría requerido
  ninguna excepción: sección separada, visible sólo para el admin, con registro
  de cada apertura. Se descartó por ser más pantalla y más código para algo que
  pasa pocas veces.
- *Sólo los contactos, sin los mensajes.* Era D8 aplicado acá —avisar quién es,
  no copiar lo que se habló— y lo más consistente con el resto del bloque 3. Se
  descartó porque deja al staff atendiendo a gente sin saber qué le pasó.

**Los límites de la excepción** (fuera de esto, R6 sigue entero):

1. Alcanza **sólo a redes cerradas**. Mientras el socio opera, valen D6 y D7 sin
   matices: el staff central no ve ni que esas conversaciones existen.
2. Es **sólo visibilidad del CRM**. **E8 y P3 quedan intactos**: el CRM no mueve
   fichas, y cerrar una red no habilita a nadie a tocar su plata.
3. El disparador es el **cierre de la red**, no una decisión discrecional. No hay
   un botón de "ver las conversaciones de Litoral" mientras Litoral opera.

**Consecuencia en el modelo de datos:** cerrar una red tiene que ser un evento
explícito y auditado —quién la cerró y cuándo—, porque **ese evento es lo único
que separa lo permitido de lo prohibido**. Si el cierre se puede hacer y deshacer
sin registro, la excepción se convierte en un interruptor para leer la red de
cualquiera.

**Nota sobre D13:** el socio **se lleva su número** (la cuenta de Meta es suya).
Se va el canal, queda el historial.

---

### D15 · El texto se guarda para siempre; los adjuntos, seis meses

Los mensajes escritos no se borran nunca. Las fotos y PDFs se eliminan a los
**6 meses**, y el mensaje conserva la marca de que había un archivo.

```
[12-mar] Juan: "te mando el comprobante"
         📎 (archivo eliminado · retención)
```

**Por qué.** El riesgo no está en el texto: está en las imágenes. Ahí es donde
viajan el DNI, el CBU y la cara de la gente. El texto pesa poco y sirve para
reclamos; la foto pesa, no se busca, y es lo único que hace daño si se filtra.

**Se descartó:**

- *Todo para siempre.* Cada foto de DNI que entró alguna vez sigue guardada, y
  R2 crece sin techo.
- *Todo se borra al año.* Más prolijo y más barato, pero un reclamo por algo
  hablado hace 14 meses se queda sin respaldo escrito.

**⚠️ Lo que NO borra esta regla.** El comprobante oficial de un depósito
(`deposits/proofs/…`) es **otro archivo, con su propio ciclo de vida**. Que se
borre la foto que el jugador mandó por chat no toca el comprobante con el que se
aprobó el depósito. Son dos cosas distintas y conviene no confundirlas al
implementar el borrado.

**Falta construir:** un proceso que borre los adjuntos vencidos **de R2 y de la
base**. El borrado en R2 recién funciona desde el 2026-09-06 —antes sólo
escribía un warning y los archivos se acumulaban—, así que este proceso se apoya
en algo que es nuevo y conviene verificar de verdad, no dar por hecho.
---

## Bloque 5 — Avisos, automatismos y por dónde se empieza

**Decidido el 2026-09-08** con el dueño. **Último bloque de decisiones
estructurales.**

> **Estado del código al decidir esto.** Se leyó `apps/api/src/notifications/` y
> `chat.gateway.ts` antes de preguntar:
>
> - **El email no manda nada.** `ConsoleEmailProvider` está fijo por código
>   (`useClass`, sin factory): sólo escribe en el log. Las notificaciones por
>   mail son decorativas hoy.
> - **El SMS sale sólo si las tres variables de Twilio están puestas**; si no,
>   `ConsoleSmsProvider`. Y se paga por mensaje.
> - **El panel sí avisa en vivo**: el gateway emite `message:new` por WebSocket.
> - **Hay un bot de Telegram funcionando** (el de alertas, verificado el
>   2026-09-08).

---

### D16 · El aviso vive en el panel, y no sale de ahí

Un mensaje nuevo se ve como **badge de no leídos** en el panel del operador. No
se manda nada al celular: ni Telegram, ni SMS, ni mail.

**Por qué.** Es lo que el sistema ya hace, y para un cajero que trabaja de día
alcanza: entra a la mañana y ve lo que llegó.

**Se descartó:**

- *Avisar por Telegram con el bot que ya anda.* Era la recomendación: gratis, sin
  límite de volumen, llega al celular, y la infraestructura ya está probada. La
  única traba es que por regla de Telegram el operador tiene que escribirle al
  bot una vez para vincularse. **Queda como la primera mejora a agregar si el
  problema aparece** — no requiere nada nuevo, sólo vincular al operador.
- *SMS.* Llega siempre y sin vincular nada, pero se paga por mensaje y con varios
  cajeros recibiendo chats todo el día la cuenta sube rápido.

---

### D17 · No hay respuestas automáticas: contesta un humano o nadie

El sistema **no manda ningún mensaje escrito solo**. Ni aviso de horario, ni
menú de opciones, ni confirmación de recibido.

**Por qué.** Cero código y ningún riesgo de que un mensaje automático diga algo
confuso sobre plata — que es de lo único que se habla en este chat.

**Se descartó:**

- *Un aviso de horario* ("te respondemos de 9 a 22"). Le habría dicho a la
  persona que su mensaje llegó y cuándo esperar respuesta.
- *Un menú de opciones al primer contacto.* Habría dejado la conversación
  etiquetada antes de que la lea un humano. Se descartó también por lo que
  molesta a parte de la gente que le conteste una máquina.

---

### ⚠️ El cruce de D16 y D17: el silencio de las dos puntas

Estas dos decisiones son razonables por separado y **juntas dejan un hueco que
conviene ver ahora**:

```
03:14  Juan escribe.
       → Juan no recibe nada           (D17: sin automáticos)
       → Pérez no se entera            (D16: sólo el panel, y está cerrado)
09:20  Pérez abre el panel y recién ahí existe el mensaje.
```

Durante seis horas **ninguna de las dos partes tiene señal de nada**. Y si Pérez
no abre el panel en dos días, nadie en el sistema lo sabe: no hay alerta, no hay
badge que alguien mire, y por **D10** el socio tampoco lo ve.

**No hay que cambiar ninguna decisión para tapar esto.** Hay una salida que no
contradice nada y no construye nada nuevo:

> **Sumar "conversaciones sin responder" al parte diario.**
> `HealthReportCron` ya manda todas las mañanas un bloque *ESPERANDO RESPUESTA*
> con los depósitos y retiros pendientes, y ya marca lo que lleva más de 24 h.
> Agregar un renglón con los chats sin contestar es una consulta más en un cron
> que ya existe y ya llega. **Candidato claro cuando se implemente el CRM.**

Queda anotado como propuesta, no como decisión.

---

### D18 · Primero la base, después los canales

El orden de construcción:

1. **La base** — dueño del contacto (D6), alta desde el chat (D9) y **firmar los
   adjuntos (D12)**.
2. **Telegram.**
3. **WhatsApp.**

El livechat web sigue funcionando durante todo el proceso.

**Por qué.** D6 cambia cómo se guardan los contactos y D12 cambia cómo se guardan
los adjuntos: las dos tocan tablas que el livechat actual **ya usa en
producción**. Migrar eso con un solo canal andando es mucho más barato que con
tres. Y el paso 1 incluye un arreglo que ya corre en producción, no una función
nueva.

**Se descartó:**

- *Telegram primero.* Meter un canal externo ya, para ver el mecanismo andando
  con operadores reales. Se descartó porque se construiría sobre un modelo de
  contactos que después hay que cambiar, con dos canales en vivo en vez de uno.
- *WhatsApp primero.* Es el canal que la gente realmente usa, pero por **D13**
  arrancar depende de que Meta verifique a cada socio: el comienzo no estaría en
  nuestras manos.

**Nota sobre el orden dentro del paso 1:** firmar los adjuntos tiene su propio
orden interno, heredado del runbook de comprobantes — **primero el Worker,
después la API**. Está en D12.

---

### D19 · Fuera de la versión 1: campañas y mensajes masivos

> 🔄 **REVERTIDA el 2026-09-09 por D21.** Las campañas entran. Los motivos de
> abajo siguen siendo ciertos: dejaron de ser argumentos para excluirlas y
> pasaron a ser **requisitos de cómo construirlas**. Ver D21 en el bloque 7.

Escribirle a todos los jugadores que no vuelven hace un mes **no va en la v1**.

**Por qué.** Necesita plantillas aprobadas por Meta una por una (ver las
restricciones de plataforma al final de este documento), y es donde más fácil se
gana una denuncia que tumba el número — que con **D13** es el número del socio,
no el nuestro.

**Lo que NO se excluyó, y hay que decidir al armar el roadmap.** Se ofrecieron
otras tres exclusiones y no se marcaron, así que **siguen como candidatas a la
v1**:

| | Qué implica dejarlo adentro |
|---|---|
| Métricas de atención | Por **D11** (hilo eterno) hay que medir por tramos: no es sumar una consulta, es definir el modelo de medición primero. |
| Varios agentes en la misma bandeja | Bloqueos, "quién agarra qué", presencia. Necesario si el staff crece; evitable si atiende una persona por vez. |
| Búsqueda global de mensajes | Por **D6** hay que acotarla por bandeja, o se vuelve la forma más fácil de leer lo que no corresponde. |

Con las tres adentro, la v1 es grande. **`13-roadmap.md` es el lugar para
recortar**, ya con el peso de cada una a la vista.

---
---

## Bloque 6 — Una decisión que quedó abierta

**Decidida el 2026-09-09**, al desbloquear la etapa 2.

---

### D20 · Los secretos de canal van cifrados en la base

Los tokens de canal —el bot de Telegram, el acceso de WhatsApp— se guardan
**cifrados con AES-256-GCM**. La clave vive en el entorno
(`CHANNEL_SECRET_KEY`), como el resto de los secretos de la plataforma.

**Por qué pesa más que las otras credenciales.** Por **D13** esos tokens **son de
los socios, no nuestros**: una filtración expone credenciales de terceros que
confiaron en la plataforma. Las credenciales de proveedor que hoy están en texto
plano son nuestras y el riesgo es nuestro; éstas no.

**Y hay un camino de salida concreto:** el backup de producción **sale del VPS
todos los días** (`0 6 * * *` → R2, ver `../24-entornos-deploy.md`). Un token en
texto plano en la base es un token en texto plano **en otro sistema, con otros
accesos**, cada mañana.

**Qué protege y qué no.** Protege contra que alguien **lea** la base: un dump, un
backup, un `SELECT` de más. **No** protege contra alguien que comprometa la
aplicación corriendo — ahí tiene la clave. No es una caja fuerte: es la
diferencia entre *"se filtró la base"* y *"se filtró la base **y** las
credenciales de mis socios"*.

**Se descartó:**

- *Texto plano, como los proveedores.* Cero trabajo y consistente con lo que ya
  existe. Se descartó por lo de arriba: el riesgo no es nuestro y el backup se
  va del servidor todos los días.
- *El secreto en el gestor de Dokploy, con una referencia en la base.* Sin
  cifrado propio que mantener — pero **por D13 el alta de un canal la hace el
  socio**, así que cada bot vinculado obligaría al dueño del casino a cargar una
  variable a mano y redesplegar. Deja de ser autoservicio, que es justo lo que
  D1 y D13 vinieron a habilitar.

**Las tres decisiones que quedaron dentro de la implementación**
(`apps/api/src/common/secreto-cifrado.ts`):

1. **Sin clave configurada, `cifrar()` tira.** No hay fallback a texto plano. Un
   fallback silencioso es peor que un error: nadie se entera hasta que se filtra
   la base, y para entonces ya está en un backup.
2. **GCM, no cifrado a secas.** Autentica además de cifrar: si alguien edita la
   fila, descifrar **falla** en vez de devolver bytes cualquiera que el sistema
   intentaría usar como token.
3. **`CHANNEL_SECRET_KEY_PREVIOUS`** para descifrar durante una rotación. Sin
   ese segundo intento, rotar la clave significa dejar ilegible todo lo
   guardado — o sea, rotar no sería posible en la práctica.

**Lo que NO se hizo, a propósito:** migrar las credenciales de proveedor que hoy
están en texto plano. Es un flujo de plata que se usa todos los días y merece su
propio cambio. El mecanismo queda listo para cubrirlas.

**Lo que falta para usarlo:** la pantalla de vincular un canal (etapa 2.1). El
cifrado está construido y probado —19 tests— pero todavía no tiene quien lo
llame. Cuando exista, `crm_channels.config` guarda el token ya cifrado.

**⚠️ Antes del primer canal en producción:** generar la clave
(`openssl rand -hex 32`) y cargarla en Dokploy. Sin ella no se puede vincular
ningún canal — que es el comportamiento buscado, pero conviene no descubrirlo en
el momento.

---

## Restricciones técnicas que acotan lo que se puede prometer

No son decisiones nuestras — son de las plataformas. Se anotan acá porque
cambian qué es realista ofrecerle a un operador.

### Telegram: sólo bots, y sólo responden

Se puede usar **un bot**, no una cuenta personal. Y un bot **sólo puede hablar
con quien primero le escribió a él**: no se puede iniciar una conversación con
alguien que no contactó al bot.

Automatizar una cuenta personal (userbot) viola los términos de Telegram y puede
terminar en la cuenta cerrada.

**Traducción para el producto:** Telegram sirve para *atender*, no para
*prospectar*.

### WhatsApp: la ventana de 24 horas

Fuera de las 24 horas desde el último mensaje del cliente, sólo se le puede
escribir con **plantillas aprobadas** por Meta. Una respuesta libre a las 25
horas no sale.

**Traducción para el producto:** cualquier función de "escribirle al jugador que
no vuelve" necesita plantillas aprobadas de antemano, y eso es un trámite con
tiempos propios.

---
---

## Bloque 7 — Lo que trajo el diseño

**Decidido el 2026-09-09**, al recibir el handoff de diseño del CRM
(`docs/design_handoff_crm/`).

El diseño llegó con tres cosas que **contradecían decisiones ya tomadas**. No se
construye nada que revierta una decisión sin que la reversión quede escrita: si
sólo se implementara lo nuevo, dentro de seis meses el documento diría una cosa
y el producto haría otra, y nadie sabría cuál de las dos fue a propósito.

---

### D21 · Las campañas entran: D19 queda revertida

**D19 dejaba fuera de la v1 las campañas y los mensajes masivos.** El diseño los
trae —armador de difusión en cuatro pasos y carga de bases CSV de hasta 50.000
filas—, y **se decidió que entran**.

**Lo que NO cambia: por qué D19 los había excluido.** Los motivos siguen siendo
ciertos y ahora son requisitos de implementación, no argumentos en contra:

- **Las plantillas las aprueba Meta una por una.** El diseño ya lo refleja
  separando las aprobadas de las que están en revisión. Sin esa distinción a la
  vista, el operador arma una difusión con una plantilla que Meta todavía no
  aceptó y no se entera hasta que falla.
- **Es donde más fácil se gana una denuncia que tumba el número** — y por
  **D13** ese número es del socio, no nuestro. Por eso el ritmo de envío por
  minuto y el semáforo de riesgo de bloqueo **no son adorno**: son la defensa
  de un activo ajeno.
- **"Pidieron no recibir" no se puede desmarcar.** El diseño lo fija así y
  queda como regla, no como default.

**Lo que hay que resolver al construirlo, y no está en el diseño:** de qué
bandeja sale una difusión. Por **D1** un canal es de un panel concreto, así que
una difusión **no puede ser del casino en general**: sale del canal de alguien,
y le llega a los jugadores de esa red. Un socio no puede difundir a la red de
otro. Eso hay que fijarlo con un test antes de que exista el botón.

---

### D17 sigue en pie · la IA no contesta sola

El diseño trae una sección entera de **IA y bots**, con reglas que responden
solas y burbujas firmadas *"IA · respondió sola"*. **Se ratificó D17**: no hay
respuestas automáticas, contesta un humano o nadie.

**Por qué se sostuvo.** Un casino donde un bot le contesta a alguien que
pregunta por su plata es un riesgo distinto a uno donde siempre hay una persona.
El propio diseño lo admite con su regla dura —la IA nunca mueve fichas ni
promete montos—, pero eso acota el daño, no lo elimina: entre "no toco fichas" y
"no digo nada que comprometa" hay bastante lugar para un problema.

**Consecuencia sobre el diseño:** la sección *IA y bots* no se construye. Queda
como candidata para más adelante, y si algún día entra, la forma con menos
riesgo es la que se ofreció y no se eligió — **que la IA redacte y el operador
decida si lo manda**. Ahí nada sale sin una persona y D17 se respeta igual.

---

### La caja desde el chat · diferida, no decidida

El diseño mete la caja adentro de la conversación: cargar fichas, retirar, bonos
y correcciones desde la ficha del contacto. Los documentos del CRM dicen lo
contrario —**el CRM no toca fichas**— y sobre eso se apoyaba todo el argumento
de que **E8/P3 no le aplican**.

**No se decidió.** Se construye primero todo lo demás, que es la mayor parte del
diseño y no toca plata, y la caja queda como un hueco marcado en la ficha.

**Lo que hay que rederivar el día que se decida**, y conviene tenerlo escrito
antes de que la urgencia lo apure:

1. **E8/P3 dejan de no aplicar.** Hoy el argumento es "el CRM no mueve plata,
   así que la ley económica no lo toca". Si mueve, hay que responder qué puede
   hacer un operador sobre un jugador de **otra** red desde una conversación que
   sí ve.
2. **El techo del empleado (P2)** y su cupo mensual de corrección tienen que
   valer igual desde el chat que desde el panel. Dos caminos a la misma
   operación son dos lugares donde se puede olvidar el límite.
3. **La auditoría.** El diseño ya propone registrar cada operación con su
   `conversation_id`, que es lo correcto: es lo que permite reconstruir por qué
   se movió esa plata.
4. Es trabajo sobre `packages/db/wallet/*`, marcado en `CLAUDE.md` como **plata
   real**: errores ahí son pérdidas.

---

### D22 · La etapa del circuito se calcula al mirar, no se guarda

**Decidido el 2026-09-10**, al construir la sección **Circuitos**.

El diseño la dibujaba como un kanban: seis columnas y tarjetas que el operador
arrastra. Había dos formas de sostener eso, y se eligió la segunda:

1. **Una columna `etapa`** en `crm_contacts`, avanzada por eventos desde los
   flujos de alta y de depósito.
2. **Derivarla en la consulta**, de hechos que ya existen.

**Se derivan.** Las tres señales ya están en la base: `crm_contacts.user_id`
dice si tiene cuenta, un `deposits` en `approved` dice si depositó, y
`game_sessions.started_at` dice cuándo jugó por última vez.

**Por qué.** Una columna hay que mantenerla: tocar los flujos de depósito y de
alta para que emitan, hacer backfill de todo lo viejo, y a partir de ahí convivir
con que la etapa mienta sin que nadie lo note. Un depósito cargado por la caja
del panel un domingo a la madrugada no pasa por el CRM: con columna, ese jugador
se queda en "cuenta creada" para siempre. **Derivada no se puede
desincronizar**, porque no hay dos copias del hecho.

**Lo que se paga, y es real: no hay historia.** Se ve dónde está cada uno hoy,
no cuándo pasó de una etapa a otra ni cuánto tardó. Eso deja afuera "tiempo
hasta el primer depósito" y cualquier medición de conversión — que es
justamente lo que **Métricas de atención** va a necesitar. El día que haga falta
medir tramos, la respuesta no es agregar la columna: es registrar las
transiciones (`crm_timeline_events` ya existe para eso) **sin dejar de derivar
la etapa actual**.

**Consecuencia sobre el diseño: no hay tarjetas para arrastrar.** Mover una a
mano sería mentirle a la próxima consulta, que la devuelve a donde estaba. La
pantalla lo dice de frente en vez de ofrecer un gesto que no puede cumplir.

**Los dos números que se fijaron acá:**

- **14 días sin abrir un juego** separan "Jugando" de "Reactivación". Corto como
  para llegar a tiempo, largo como para no marcar a quien se tomó un fin de
  semana.
- **Jugando le gana a Depositó.** El `CASE` se evalúa en orden y las etapas son
  excluyentes: el que está jugando está jugando, aunque haya depositado ayer.

**"Alta pedida" no se construyó.** El diseño la pedía entre Lead y Cuenta
creada. **Nada en el sistema registra que alguien pidió el alta y todavía no la
tiene** — no hay señal, ni cerca. Se omitió y se dice en la pantalla, como se
hizo con la columna Etapa de Contactos, los seis grupos de Configuración y la
pestaña de plantillas de WhatsApp. Va a entrar el día que el pedido deje una
marca.

**Una fila en `game_sessions` es abrir un juego, no apostar.** Alguien que entró,
miró y cerró cuenta como jugando. Es la señal más cercana que hay: contar rondas
dejaría afuera al que está jugando ahora mismo y todavía no apostó.
