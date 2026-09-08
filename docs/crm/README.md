# CRM del casino — índice de la sección

> Sistema de atención omnicanal anclado a la plataforma: livechat propio,
> WhatsApp y Telegram, con la misma jerarquía de redes que el resto del casino.
>
> **Estado: en planificación.** Se planifica por bloques; cada bloque se decide
> con el dueño antes de escribirse. Empezado el 2026-09-08.

---

## Antes de leer nada: esto ya está funcionando

No se parte de cero. Hay un livechat **en producción** desde antes de esta
planificación:

| | |
|---|---|
| Tablas en la base del tenant | 9 (`crm_contacts`, `crm_conversations`, `crm_messages`, …) |
| Backend | ~1.650 líneas en `apps/api/src/chat/` |
| Bandeja del operador | `/support` en el panel |
| Widget del jugador | montado en `/play` |
| Interruptores | `CRM_ENABLED` y `NEXT_PUBLIC_CRM_ENABLED`, **encendidos** |

Y el ruteo por red **ya está implementado** en `crm-network.service.ts`: la red
dependiente la atiende el staff central, y en la red independiente cada operador
atiende lo suyo.

Lo que se planifica acá es lo que **falta**: los canales externos (WhatsApp,
Telegram), la creación de usuarios desde el CRM, y todo lo que hace que esto sea
un CRM y no un chat.

> El diseño original vive en [`../22-crm-livechat.md`](../22-crm-livechat.md).
> Queda como histórico: lo que contradiga a esta sección, pierde.

---

## Los archivos

| # | Archivo | Qué contesta | Estado |
|---|---|---|---|
| 00 | `00-vision-y-alcance.md` | Qué es y, sobre todo, qué **no** es | pendiente |
| 01 | `01-glosario.md` | Contacto, canal, cuenta, conversación, bandeja | pendiente |
| 02 | `02-modelo-de-datos.md` | Tablas, marcando lo que ya existe | pendiente |
| 03 | `03-canales.md` | Web, WhatsApp y Telegram, uno por uno | **decidido** (bloque 1), falta escribir |
| 04 | `04-identidad-y-fusion.md` | Quién es quién, y por qué NO se fusiona | **decidido** (bloque 2), falta escribir |
| 05 | `05-ruteo-y-bandejas.md` | Quién atiende qué — el corazón | **decidido** (bloque 1), falta escribir |
| 06 | `06-operacion-diaria.md` | Estados, transferencias, no leídos | **decidido** (bloque 3), falta escribir |
| 07 | `07-crear-usuarios.md` | Alta de jugador desde una conversación | **decidido** (bloque 3), falta escribir |
| 08 | `08-permisos.md` | Qué ve y qué puede hacer cada rol | **decidido** (bloques 2 y 3), falta escribir |
| 09 | `09-plantillas-y-bots.md` | Respuestas rápidas y automatismos | pendiente |
| 10 | `10-metricas.md` | Tiempos de respuesta, volumen, por agente | pendiente |
| 11 | `11-cumplimiento.md` | Reglas de WhatsApp, retención, privacidad | pendiente |
| 12 | `12-infraestructura.md` | Webhooks, colas, límites, medios | pendiente |
| 13 | `13-roadmap.md` | En qué orden se construye | pendiente |
| 14 | [`14-decisiones.md`](14-decisiones.md) | **Bitácora de decisiones y por qué** | vivo |

> **Ojo con el nombre de `04-identidad-y-fusion.md`.** El bloque 2 decidió que
> los contactos **no se fusionan** entre bandejas (D6). El archivo se llama así
> por el diseño viejo; cuando se escriba, conviene renombrarlo.

---

## Cómo se planifica

**Por bloques de decisiones.** Cada bloque son tres o cuatro preguntas cuya
respuesta condiciona lo que sigue. Con las respuestas se escribe el documento
correspondiente y se pasa al siguiente bloque.

El motivo de hacerlo así y no de una: **las decisiones estructurales se
contradicen entre sí si no se toman en orden.** De quién son los canales
determina el ruteo; el ruteo determina los permisos; los permisos determinan qué
puede hacer la pantalla. Definir la pantalla primero garantiza rehacerla.

Cada decisión queda en [`14-decisiones.md`](14-decisiones.md) **con las
alternativas que se descartaron y por qué**. Sin eso, dentro de seis meses nadie
sabe si algo se decidió o simplemente salió así.

---

## Las leyes que rozan a este sistema

El CRM toca la jerarquía de redes, así que le aplican
[`../LEYES.md`](../LEYES.md). Las relevantes:

- **R6** — el admin ve de la red independiente sólo agregados, no el detalle
  interno. Es la que más condiciona qué muestra la ficha de un contacto.
- **P1** — permiso **y** scope del target; nunca cruzar entre redes.
- **P2** — regla del techo: los empleados quedan capados al techo de su operador.
- **E8 / P3** — aislamiento económico: nadie de afuera mueve fichas de una red
  independiente. **El CRM no mueve plata**, así que no las toca — pero si algún
  día se agrega "cargar fichas desde el chat", vuelven a aplicar.

Cualquier decisión que las roce se marca en la bitácora citándolas por código.
