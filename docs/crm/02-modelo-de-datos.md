# 02 · Modelo de datos

> Las tablas del CRM: **las 9 que ya existen** y qué hay que cambiarles para que
> las decisiones D1–D19 sean ciertas.
>
> Todo vive en la **base del tenant** (aislamiento físico, como el resto de la
> plataforma). Nada del CRM va a `platform_control`.
>
> Fuente: `packages/db/src/tenant/crm.ts`, leído el 2026-09-08.

---

## Lo que ya está

Nueve tablas, creadas junto con el livechat y **en producción**:

| Tabla | Qué guarda | Estado |
|---|---|---|
| `crm_contacts` | La persona vista desde una bandeja | ✅ con dueño desde `0112` |
| `crm_channels` | Cada instancia de canal | ✅ con dueño desde `0112` · ⚠️ secretos sin resolver |
| `crm_conversations` | El hilo, con su estado y no leídos | ✅ sirve como está |
| `crm_messages` | Cada mensaje, con adjuntos | ✅ sirve como está |
| `crm_notes` | Nota interna sobre un contacto | ✅ |
| `crm_tags` + `crm_contact_tags` | Catálogo de etiquetas y su asignación | ✅ |
| `crm_templates` | Respuestas rápidas con atajo | ✅ |
| `crm_timeline_events` | Eventos de plataforma mezclados con el chat | ✅ tabla lista, **nadie la llena** |

**Lo bueno:** el 70% del modelo sirve tal cual. **Lo que falta** son dos columnas
de dueño y un puñado de tablas nuevas — no una reescritura.

---

## Los cambios, uno por uno

### 1. `crm_channels` necesita dueño ← **D1**

Hoy la tabla es `{ id, type, config, is_active, created_at }`. No hay forma de
decir de quién es un canal.

```
+ owner_user_id  uuid  NULL REFERENCES users(id)
```

**`NULL` significa central** (el canal es del casino). Un valor apunta al panel
propietario dentro de una red independiente.

> **Por qué NULL y no un booleano `is_central`:** con dos columnas se pueden
> escribir estados imposibles (`is_central = true` **y** `owner_user_id` puesto).
> Con una sola columna ese estado no se puede ni escribir.

**Índice:** `(owner_user_id)` — se consulta en cada mensaje entrante para saber a
qué bandeja va.

---

### 2. `crm_channels.config` no puede guardar los secretos como están ← 🔴

Para funcionar, un canal necesita credenciales:

| Canal | Qué hace falta | Qué permite quien lo tenga |
|---|---|---|
| Telegram | El **token del bot** | Controlar el bot entero: leer y escribir como él |
| WhatsApp | Token de acceso + id del número | Mandar mensajes como ese negocio |

Hoy `config` es un `jsonb` sin nada especial, y **no hay cifrado en ninguna parte
de la API**: se verificó el 2026-09-08 y las credenciales de proveedores de
juego se guardan en texto plano, con el mismo criterio.

**Acá el criterio no alcanza, y la diferencia es D13:** esos tokens **no son
nuestros, son de los socios**. Una filtración de la base del tenant deja
expuestas las credenciales de los canales de terceros que confiaron en la
plataforma — no sólo las nuestras.

**Queda como decisión abierta**, con tres caminos:

| | Cómo | Costo |
|---|---|---|
| A | Cifrar la columna con una clave en el entorno | Cifrado nuevo en el repo; la clave hay que rotarla alguna vez |
| B | Guardar sólo una referencia; el secreto en el gestor de secretos de Dokploy | Nada de cifrado propio, pero un canal nuevo deja de ser autoservicio: alguien tiene que cargarlo |
| C | Texto plano, como los proveedores | Cero trabajo, y el riesgo descrito arriba |

**No decidirlo es elegir C.** Hay que ponerlo en la mesa antes de construir el
primer canal externo, no después.

---

### 3. `crm_contacts` necesita dueño ← **D6**

Hoy: `{ id, user_id, display_name, phone, email, is_lead, attributes, … }`, con
un índice común (no único) sobre `phone`.

```
+ owner_user_id  uuid  NULL REFERENCES users(id)     -- NULL = central
```

Mismo criterio que los canales.

**Unicidad:** hoy no hay ninguna, y **está bien así**. Si algún día hace falta,
es `UNIQUE (owner_user_id, phone)` — **nunca sobre `phone` solo**, porque el
mismo teléfono existe a propósito en varias bandejas.

> ⚠️ El comentario de la tabla decía que el teléfono era "la llave de auto-merge
> (lead web + WhatsApp + jugador = 1)". **Se corrigió el 2026-09-08**: D6 dice lo
> contrario. Nunca se había implementado —no hay ninguna búsqueda por teléfono en
> `apps/api/src/chat/`— así que no hubo nada que desarmar.

**Al migrar:** los contactos que ya existen son todos del livechat web, o sea de
la bandeja que hoy los atiende. El `owner_user_id` de cada uno sale de
`crm_conversations.assigned_operator_id` de su conversación. Los de la red
dependiente quedan en `NULL` (central), que es donde ya están.

---

### 4. Falta cómo se guarda un aviso de derivación ← **D8**

Cuando el staff central avisa a otra bandeja que alguien escribió, eso tiene que
quedar en algún lado. **No hace falta una tabla nueva**: `crm_messages` ya tiene
`direction: 'system'`.

Un aviso es un mensaje `system` en la conversación **de la bandeja que recibe**,
con el texto armado por el sistema (quién y cuándo) y **sin nada del contenido
original**.

> Si esa bandeja todavía no tiene conversación con esa persona, hay que crearla.
> Es el único caso donde una conversación nace sin que el contacto haya escrito
> por ese canal.

**Lo que hay que cuidar al implementarlo:** el aviso se arma con datos del
contacto de **origen**. Es el único punto del sistema donde un dato cruza de una
bandeja a otra, así que el armado del texto tiene que ser una función chica,
sola y con test — no un `template string` en medio de un servicio.

---

### 5. Falta el cierre de una red ← **D14**

**Esta es la más delicada de todo el modelo.** D14 autoriza una excepción a R6:
cuando una red independiente se cierra, sus conversaciones pasan a la bandeja
central.

**El cierre es lo único que separa lo permitido de lo prohibido.** Si se pudiera
cerrar y reabrir una red sin dejar rastro, la excepción se convertiría en un
interruptor para leer la red de cualquiera.

Requisitos:

1. El cierre es un **evento explícito y auditado** — quién, cuándo, por qué. Va
   a `audit_log`, como cualquier acción sensible.
2. La herencia es **consecuencia del cierre**, nunca una acción propia. No existe
   "ver las conversaciones de Litoral" como botón.
3. Reabrir una red, si se permite, **no devuelve** las conversaciones heredadas
   automáticamente: ya fueron leídas.

**Cómo se hereda:** cambiando el `owner_user_id` de los contactos de esa red a
`NULL` (central). No hay que copiar nada.

> Hoy **la baja de un socio no existe como flujo** en ninguna parte de la
> plataforma. O sea que esto no es adaptar algo: es construirlo, y con el cuidado
> que pide una excepción a una ley.

---

### 6. Falta la retención de adjuntos ← **D15**

El texto se guarda para siempre; los adjuntos se borran a los 6 meses.

```
crm_messages.attachments  →  [{ storageKey, mime, sizeBytes, name, kind }]
```

Un proceso periódico tiene que:

1. Buscar mensajes con adjuntos de más de 6 meses.
2. Borrar cada archivo de R2 (`storage.delete(storageKey)`).
3. Marcar el adjunto como eliminado **sin borrar el mensaje**, para que la
   pantalla pueda mostrar *"(archivo eliminado · retención)"*.

**El paso 3 pide un campo**: agregar `deletedAt` dentro del objeto del adjunto
alcanza, y no necesita migración porque es `jsonb`.

> ⚠️ El borrado en R2 **recién funciona desde el 2026-09-06**: antes sólo
> escribía un warning y los archivos quedaban para siempre. Este proceso se apoya
> en algo nuevo — hay que verificar que borra de verdad, no darlo por hecho.

**Lo que este proceso NO borra:** el comprobante oficial de un depósito
(`deposits/proofs/…`) es otro archivo, con su propio ciclo de vida. Que se borre
la foto que el jugador mandó por chat no toca el comprobante con el que se aprobó
el depósito.

---

### 7. `crm_timeline_events` está lista y vacía

La tabla existe con su índice `(contact_id, occurred_at)` y **ningún código la
escribe**. El plan original era llenarla con listeners *fire-and-forget* desde
los flujos existentes (registro, depósito, retiro, bono, bloqueo).

Sigue siendo buena idea, con una condición que ya está en el comentario del
schema y conviene repetir: **nunca en el camino crítico**. Que falle escribir un
evento de la línea de tiempo no puede hacer fallar un depósito.

---

## Lo que NO cambia

Vale la pena decirlo, porque es la mayor parte:

- **`crm_conversations` sirve como está.** Ya tiene `channel_id`,
  `assigned_operator_id`, `status`, `last_message_at` y los dos contadores de no
  leídos. Con D11 (hilo eterno) ni siquiera hay que agregar nada.
- **`crm_messages` sirve como está.** Y su manejo de adjuntos ya era correcto:
  guarda sólo la `storageKey` y regenera la URL en cada lectura
  (`hydrateMessage`), que es exactamente lo que hace falta para URLs firmadas
  que vencen.
- **Notas, etiquetas y plantillas sirven como están.** Al colgar del contacto, y
  ser el contacto de una bandeja (D6), quedan aisladas sin trabajo extra.

---

## Resumen para el roadmap

| # | Cambio | Tamaño | Bloquea a |
|---|---|---|---|
| 1 | ~~`owner_user_id` en `crm_channels`~~ | ✅ hecho · `0112` | — |
| 2 | Secretos de canal | **decisión abierta** | todo canal externo |
| 3 | ~~`owner_user_id` en `crm_contacts` + migración~~ | ✅ hecho · `0112` | — |
| 4 | Aviso de derivación (mensaje `system`) | chico | D8 |
| 5 | Cierre de red auditado | **grande y delicado** | D14 |
| 6 | Retención de adjuntos | mediano | D15 |
| 7 | Llenar la línea de tiempo | mediano | nada — es mejora |

Los cambios 1 y 3 son el **paso 1 de D18** ("primero la base"), junto con el alta
desde el chat (D9) y el arreglo de adjuntos (D12, **ya hecho** el 2026-09-08).
