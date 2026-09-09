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
| 0.1 | **Adjuntos del chat privados y firmados** (D12) | ✅ código hecho el 2026-09-08 · ⬜ **falta desplegar** |
| 0.2 | **Chats sin responder en el parte diario** | ✅ hecho el 2026-09-08 · ⬜ falta mergear a `main` |

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
| 1.6 | Alta de jugador desde el chat (D9) | [`07`](07-crear-usuarios.md) |
| 1.7 | El cartel de red en la lista y en la ficha | [`06`](06-operacion-diaria.md) |
| 1.8 | Los seis tests de aislamiento | [`08`](08-permisos.md) |

**El 1.3 ya está hecho** (2026-09-08). `getContext` compara la rama
independiente del jugador contra la de quien pregunta y, si no coinciden, **las
consultas de plata ni se corren**: devuelve identidad y el cartel de red, nada
más.

Cubre los tres cruces —staff central → red independiente, independiente → otra
independiente, e independiente → red central— con seis tests, verificados
rompiendo el filtro a propósito para confirmar que fallan.

**Decisiones que hay que tomar en esta etapa** (ninguna está tomada):

- 🔴 **Dónde viven los secretos de canal** ([`02`](02-modelo-de-datos.md) punto
  2). No decidirlo es elegir texto plano — de credenciales que, por **D13**, son
  de los socios.
- **Cómo se le da la contraseña** a un jugador creado desde el chat
  ([`07`](07-crear-usuarios.md)).
- **El alta cuelga del dueño del canal, no del actor** — el endpoint actual hace
  lo segundo, y con empleados los dos difieren ([`07`](07-crear-usuarios.md)).

---

## Etapa 2 — Telegram

| | Qué |
|---|---|
| 2.1 | Vincular un bot a un panel (pantalla del **operador**, no del admin) |
| 2.2 | Webhook: firma verificada, `UNIQUE` en `channel_message_id`, 200 rápido, crudo primero |
| 2.3 | Ruteo por dueño de canal |
| 2.4 | Medios: bajarlos antes de que venza el id, con reintento |
| 2.5 | La pantalla explica que el jugador tiene que escribirle al bot primero |

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
