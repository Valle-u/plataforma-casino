# 01 · Glosario del CRM

> Las palabras que se usan en toda esta sección. Están acá porque varias
> significan algo **distinto** de lo que significan en el resto de la plataforma,
> y confundirlas lleva a construir mal.
>
> El glosario general del casino es [`../01-glosario.md`](../01-glosario.md).
> Éste sólo agrega lo del CRM.

---

## Las cuatro que hay que entender sí o sí

### Canal

**Por dónde entra un mensaje.** Hay tres tipos:

| Tipo | Qué es |
|---|---|
| `web-livechat` | El widget dentro de la plataforma. El único que funciona hoy. |
| `whatsapp` | Un número de WhatsApp Business. |
| `telegram` | Un bot de Telegram. |

Un canal **no es** un tipo: es **una instancia concreta** de ese tipo. El
WhatsApp del casino y el WhatsApp del cajero Pérez son **dos canales**, aunque
los dos sean WhatsApp.

### Dueño del canal

**El panel al que pertenece ese canal** (**D1**).

- En la **red central**, los canales son del casino: los atiende el staff
  central.
- En una **red independiente**, cada panel —el socio, cada distribuidor, cada
  cajero— puede tener los suyos.

El dueño del canal determina casi todo lo demás: quién atiende (**D2**), de quién
es un lead que entra por ahí (**D5**), y de quién cuelga un jugador que se da de
alta desde ahí (**D9**).

### Contacto

**Una persona, vista desde una bandeja.**

Acá está la palabra más traicionera de todo el CRM: **un contacto no es una
persona**. La misma persona, escribiéndole a dos operadores distintos, es **dos
contactos** (**D6**).

```
Juan, +54 9 341 555-1234
├── Contacto en la bandeja de Pérez   ← lo ve Pérez
└── Contacto en la bandeja del casino ← lo ve el staff central
```

Los dos pueden apuntar al **mismo jugador** (`user_id`), porque el teléfono lo
identifica solo (**D4**). Lo que no comparten es la conversación, las notas ni
las etiquetas.

> Si alguna vez leés en el código o en un doc viejo que el teléfono es "la llave
> de auto-merge", eso **quedó anulado por D6**. Nunca se implementó.

### Bandeja

**Todo lo que ve un operador cuando entra a Soporte.**

Hoy se resuelve con `resolveInboxOwner` (`crm-network.service.ts`):

| Quién sos | Tu bandeja |
|---|---|
| Admin o empleado | La bandeja **central** (la del admin principal) |
| Cualquiera de una red **independiente** | **La tuya y sólo la tuya** |
| Operador de la red **dependiente** | Ninguna — no tenés acceso al CRM |

---

## Las personas

### Lead

**Alguien que escribió y no es jugador de nadie.** Puede ser alguien que
pregunta antes de registrarse, o un número equivocado.

Un lead **pertenece al dueño del canal** por el que entró (**D5**). Cuando se
convierte en jugador, **cuelga de ese mismo dueño** (**D9**) — lo que significa
que el CRM define parte del árbol comercial, no sólo la atención.

### Jugador vinculado

Un contacto que además apunta a un `user_id`. El vínculo lo hace el sistema solo,
buscando el teléfono entre los jugadores (**D4**).

### Staff central

El **admin del casino y sus empleados**. Atienden los canales centrales y toda la
red dependiente. En el código son los roles `admin_tenant` y `empleado`.

---

## Las conversaciones

### Conversación (o hilo)

**Todo lo que una persona habló con un operador por un canal.** Una sola, para
siempre: si se cierra y la persona vuelve tres semanas después, **se reabre la
misma** (**D11**).

Tiene tres estados: `open`, `pending`, `resolved`.

> Hoy **nada cambia ese estado**: la columna existe y ningún código la escribe.
> Cerrar, marcar pendiente y reabrir son tres acciones que faltan construir.

### Tramo

**Desde que alguien escribe hasta que se marca resuelto.**

Es una palabra que todavía no existe en el código y va a hacer falta: como el
hilo es eterno (**D11**), medir "cuánto tardamos en responder" sobre la
conversación no significa nada —el hilo de Juan lleva ocho meses abierto—. Hay
que medir por tramos. Ver [`10-metricas.md`](10-metricas.md).

### Derivar

**Avisarle a otra bandeja que alguien escribió** (**D8**).

⚠️ **No** es mover la conversación, ni copiarla. Lo único que viaja es quién
escribió y cuándo. Ni una palabra del contenido.

> La palabra quedó de **D3**, que decía "derivar la conversación". Estaba mal
> elegida y D8 la corrige. Se mantiene porque es la que usa la gente, pero
> significa **avisar**.

---

## Las cosas que se le cuelgan a un contacto

| | Qué es | Quién la ve |
|---|---|---|
| **Nota** | Texto interno sobre un contacto | Sólo la bandeja dueña. El jugador nunca. |
| **Etiqueta** (tag) | Marca de un catálogo del casino (VIP, en riesgo…) | Ídem |
| **Plantilla** | Respuesta guardada con un atajo (`/deposito`) | El operador, al escribir |
| **Evento de línea de tiempo** | Algo que pasó en la plataforma (se registró, depositó, retiró) mezclado con los mensajes | La bandeja dueña |

Como todas cuelgan del **contacto**, y el contacto es de una bandeja (**D6**),
quedan aisladas solas. No hace falta un permiso aparte para cada una.

---

## Las de WhatsApp que no elegimos nosotros

### Ventana de 24 horas

Desde el último mensaje **del cliente** hay 24 horas para responderle libremente.
Pasado ese rato, sólo salen **plantillas aprobadas**.

⚠️ **Reabrir un hilo viejo no reabre la ventana.** Si la conversación de Juan se
reabre tres semanas después porque él escribió, la ventana arranca **con ese
mensaje suyo** — pero si el que quiere escribir primero es el operador, necesita
plantilla. La pantalla tiene que avisarlo **antes** de que escriba.

### Plantilla aprobada

Un texto que Meta revisó y autorizó de antemano. Es lo único que se puede mandar
fuera de la ventana. **No confundir con las plantillas del CRM**
(`crm_templates`), que son atajos internos para escribir más rápido y no tienen
nada que ver con Meta.

> Dos cosas distintas con el mismo nombre. Al implementar conviene llamarlas
> **respuesta rápida** (la nuestra) y **plantilla de WhatsApp** (la de Meta).

---

## Las redes, en una tabla

Están definidas en [`../LEYES.md`](../LEYES.md) y en
[`../03-jerarquia-roles.md`](../03-jerarquia-roles.md). Resumen para leer esta
sección:

| Red | Quién | En el CRM |
|---|---|---|
| **Central** | El casino: admin + empleados | Tiene sus canales. Atiende los suyos y toda la dependiente. |
| **Dependiente** | Socios, distribuidores y cajeros del casino | **Sin acceso al CRM.** A sus jugadores los atiende el staff central. |
| **Independiente** | Un socio con `is_independent_branch` y toda su bajada | Cada panel tiene sus canales y atiende lo suyo. |
