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
