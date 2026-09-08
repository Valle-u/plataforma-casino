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
