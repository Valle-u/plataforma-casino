# 00 · Visión y alcance

> Qué es este sistema, para quién, y —sobre todo— **qué no es**.
>
> Escrito el 2026-09-08 a partir de las decisiones D1–D19 de
> [`14-decisiones.md`](14-decisiones.md). Si algo de acá contradice ese
> documento, gana el otro.

---

## En una frase

**Un lugar donde cada operador del casino atiende a su gente, por el canal que
esa gente elija, sin ver la de nadie más.**

---

## El problema que resuelve

Hoy un jugador que necesita algo tiene un solo camino: el widget de chat de la
plataforma, y sólo mientras está adentro jugando. Si quiere escribir desde el
celular, sin abrir el casino, no hay por dónde.

Y del otro lado pasa lo mismo al revés: un cajero que atiende a sus jugadores por
su WhatsApp personal tiene esas conversaciones en su teléfono, mezcladas con las
de su familia, sin relación con la cuenta del jugador, sin historial que quede en
ningún lado, y sin que nadie más pueda continuarlas si él no está.

**El CRM une las dos cosas**: los canales por los que la gente ya escribe, con la
información del casino sobre esa gente.

---

## Qué es

1. **Una bandeja de entrada por operador.** Cada panel —el casino, un socio, un
   cajero— tiene la suya. Ve lo suyo y nada más.
2. **Varios canales, una sola bandeja.** El widget web, WhatsApp y Telegram
   entran al mismo lugar.
3. **Contexto al lado de la conversación.** Quién es, cuándo se registró, su
   saldo, sus últimos movimientos — con los límites que impone
   [`08-permisos.md`](08-permisos.md).
4. **Dar de alta un jugador sin salir del chat.** Alguien escribe pidiendo
   cuenta y se le crea ahí mismo (D9).

---

## Qué NO es

Esta lista importa más que la de arriba: es lo que evita que el proyecto crezca
sin control.

| No es | Por qué |
|---|---|
| **Una herramienta de marketing** | Nada de campañas ni mensajes masivos en la v1 (**D19**). Escribirle a jugadores que no vuelven necesita plantillas aprobadas por Meta una por una, y es la forma más rápida de que denuncien un número — que por **D13** es el número del socio, no el nuestro. |
| **Un chatbot** | El sistema **no manda ningún mensaje escrito solo** (**D17**). Ni aviso de horario, ni menú de opciones. Contesta una persona o no contesta nadie. |
| **Una herramienta de supervisión** | Un socio **no lee** las conversaciones de sus cajeros (**D10**). El staff central **no ve** que existan las conversaciones de otra red (**D7**). |
| **Una forma de mover plata** | El CRM **no toca fichas**. Por eso no le aplican E8 ni P3. Si algún día se agrega "cargar desde el chat", vuelven a aplicar y hay que replantear todo el modelo de permisos. |
| **Un sistema de tickets** | No hay prioridades, SLA, escalamiento ni colas. Hay conversaciones abiertas y cerradas. |
| **Un lugar donde los contactos se unifican** | Dos bandejas distintas tienen **dos fichas distintas** de la misma persona (**D6**). Es a propósito. |

---

## Para quién

| Rol | Qué hace en el CRM |
|---|---|
| **Admin del casino** | Atiende su red y la dependiente. Configura los canales centrales. |
| **Empleado** | Igual que el admin, capado a su techo (**P2**). |
| **Socio independiente** | Atiende **a sus jugadores directos**. Vincula sus propios canales (**D1**). No ve los de su bajada (**D10**). |
| **Distribuidor / cajero independiente** | Igual que el socio, en su nivel. |
| **Cajero, distribuidor o socio DEPENDIENTE** | **Nada.** No tienen acceso al CRM: a su red la atiende el staff central. Es lo que el código ya hace. |
| **Jugador** | Escribe. Por el widget o por el canal que quiera. |

---

## Lo que ya existe

No se parte de cero:

- 9 tablas en la base de cada tenant (`crm_contacts`, `crm_conversations`,
  `crm_messages`, `crm_notes`, `crm_tags`, `crm_contact_tags`,
  `crm_templates`, `crm_channels`, `crm_timeline_events`).
- ~1.650 líneas en `apps/api/src/chat/`.
- La bandeja del operador en `/support` y el widget en `/play`.
- **El ruteo por red ya implementado** en `crm-network.service.ts`.

El detalle de qué falta de cada cosa está en
[`02-modelo-de-datos.md`](02-modelo-de-datos.md) y en
[`13-roadmap.md`](13-roadmap.md).

---

## Los límites que no ponemos nosotros

Dos, y condicionan qué se puede prometer:

- **Telegram sirve para atender, no para buscar clientes.** Un bot sólo puede
  hablarle a quien le escribió primero.
- **WhatsApp tiene una ventana de 24 horas.** Pasado ese rato desde el último
  mensaje del cliente, sólo salen plantillas aprobadas por Meta.

El detalle está al final de [`14-decisiones.md`](14-decisiones.md) y en
[`11-cumplimiento.md`](11-cumplimiento.md).

---

## Cómo se mide si sirvió

Sin esto, "el CRM anda" es una opinión:

1. **Ningún jugador espera más de un día sin respuesta.** Hoy no se puede saber:
   nadie mide conversaciones sin contestar. Es lo primero que hay que poder ver
   (ver el cruce de D16 y D17 en la bitácora).
2. **Un operador nuevo puede atender sin preguntarle nada a nadie**, porque el
   contexto está en la pantalla.
3. **Ninguna conversación aparece en una bandeja que no le corresponde.** Se
   verifica con tests, no mirando.

---

## Los documentos

| Para entender | Leer |
|---|---|
| Las palabras | [`01-glosario.md`](01-glosario.md) |
| Las tablas | [`02-modelo-de-datos.md`](02-modelo-de-datos.md) |
| Cada canal | [`03-canales.md`](03-canales.md) |
| Quién es quién | [`04-identidad-y-fusion.md`](04-identidad-y-fusion.md) |
| Quién atiende qué | [`05-ruteo-y-bandejas.md`](05-ruteo-y-bandejas.md) |
| **Por qué se decidió así** | [`14-decisiones.md`](14-decisiones.md) |
