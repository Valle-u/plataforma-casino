# 12 · Infraestructura: webhooks, colas, medios y límites

> Cómo entra y sale un mensaje de un canal externo, y qué pasa cuando algo falla.

---

## Lo que ya está andando

| | Estado |
|---|---|
| WebSocket del livechat (`chat.gateway.ts`) | ✅ producción |
| Subida de adjuntos con validación real del contenido | ✅ producción |
| Redis | ✅ andando |
| Cloudflare Worker + R2 para archivos | ✅ producción |
| Bot de Telegram (alertas) | ✅ **verificado el 2026-09-08** |
| Cola de trabajos (BullMQ) | ❌ **no hay** |

> El último importa: no hay ninguna cola en el repo. Los crons usan
> `CronLockService` sobre Redis para no pisarse, pero eso no es una cola de
> trabajos con reintentos.

---

## Un mensaje entrante, paso a paso

```
WhatsApp / Telegram
    │  POST al webhook
    ▼
┌──────────────────────────────────────┐
│ 1. ¿Es auténtico?  (firma / token)   │  → si no: 401, y se registra
│ 2. ¿Ya lo procesé? (id externo)      │  → si sí: 200 y listo
│ 3. Guardar crudo                     │
│ 4. Responder 200  ← RÁPIDO           │
└──────────────────────────────────────┘
    │  (a partir de acá, en segundo plano)
    ▼
┌──────────────────────────────────────┐
│ 5. ¿Por qué canal entró?             │  → crm_channels
│ 6. ¿De quién es la bandeja?          │  → owner_user_id  (D2)
│ 7. ¿Quién escribe?                   │  → teléfono → jugador (D4)
│ 8. Contacto de ESA bandeja           │  → (D6)
│ 9. Conversación: reabrir o crear     │  → (D11)
│ 10. Guardar el mensaje + adjuntos    │
│ 11. Avisar al panel por WebSocket    │
└──────────────────────────────────────┘
```

### Los cuatro puntos donde esto se rompe

#### 1. Responder rápido, procesar después

Meta y Telegram **reintentan** si tardás. Si el paso 5 al 11 se hace antes de
contestar, un pico de mensajes se convierte en una avalancha de reintentos.

**Contestar 200 apenas está guardado el crudo.** Todo lo demás va después.

> Sin cola de trabajos, "después" hoy significa **en el mismo proceso, sin
> esperar la promesa**. Funciona, pero si el proceso se reinicia en el medio, ese
> mensaje se pierde: quedó el crudo y no la conversación. Ver *Sobre la cola* más
> abajo.

#### 2. Idempotencia

Un reintento **no puede** crear el mensaje dos veces.

`crm_messages.channel_message_id` **ya existe** para esto. Lo que le falta es un
**índice único** — sin él, la protección depende de que el código se acuerde de
chequear, y en una carrera de dos reintentos simultáneos no alcanza.

```
UNIQUE (channel_message_id)  WHERE channel_message_id IS NOT NULL
```

#### 3. Autenticidad

- **WhatsApp**: firma en la cabecera, verificada con el *app secret*.
- **Telegram**: un token secreto en la URL del webhook, o el header
  `X-Telegram-Bot-Api-Secret-Token`.

**Un webhook sin verificar es un endpoint público donde cualquiera inyecta
mensajes en la bandeja de un operador.**

#### 4. El orden no está garantizado

Dos mensajes seguidos pueden llegar al revés. **Ordenar por la marca de tiempo
del canal**, no por cuándo llegaron.

---

## Un mensaje saliente

```
El operador escribe
    ▼
¿WhatsApp y pasaron 24 h?  → ⛔ avisar ANTES, no dejar escribir en vano
    ▼
Mandar a la API del canal
    ▼
┌─ ✅ ok    → guardar con el id externo
└─ ❌ error → NO perder el texto; mostrarlo como "no se envió", con reintento
```

**Lo peor que puede pasar acá** es que el operador escriba, vea el mensaje en su
pantalla, y el jugador nunca lo reciba. Un mensaje que falla tiene que **verse
que falló**.

---

## Los medios

**Lo que llega:** WhatsApp y Telegram no mandan el archivo, mandan un **id** para
descargarlo — y esos ids **vencen**. Hay que bajarlo y guardarlo en R2 al
recibirlo, no después.

**Lo que ya está resuelto:** validación real del contenido (redibuja imágenes,
rechaza PDF con contenido activo), 5 MB y 5 archivos por mensaje, y desde el
2026-09-08 **URL privada firmada** (**D12**).

**Lo que falta:**

| | |
|---|---|
| Bajar el medio antes de que venza el id | Con reintento: si falla, el archivo se pierde para siempre |
| Tipos que hoy no se aceptan | La gente manda **audios** y **videos** por WhatsApp, y hoy sólo entran imágenes y PDF |
| Borrado por retención a los 6 meses | **D15** |

> Los audios van a llegar sí o sí. Decidir si se aceptan, se rechazan con un
> aviso claro, o se guardan sin reproducir — pero decidirlo, no descubrirlo en
> producción.

---

## Los límites de las plataformas

| | Límite | Qué hacer |
|---|---|---|
| WhatsApp | Mensajes por segundo, y un tope diario según el nivel de la cuenta | Ir despacio y no mandar de a montones |
| Telegram | ~30 mensajes/segundo, 20/minuto al mismo grupo | Suficiente para atender |
| **Telegram, la trampa** | El bot **sólo habla con quien le escribió primero** | La pantalla tiene que explicarlo, o el operador cree que está roto |

---

## Sobre la cola

**No hay ninguna en el repo.** Para la v1 puede alcanzar con procesar en el mismo
proceso tras responder el 200, con dos condiciones:

1. **El crudo se guarda primero**, siempre. Si el procesamiento falla, el mensaje
   no se perdió: se puede reprocesar.
2. **Un fallo se ve.** Un contador de crudos sin procesar en el parte diario
   alcanza para no enterarse tarde.

**Cuándo deja de alcanzar:** cuando haya varios canales con volumen real, o
cuando bajar medios empiece a demorar el proceso. Ahí entra BullMQ sobre el Redis
que ya está.

> Hay un antecedente que apunta en la misma dirección: **el silencio de alertas
> vive en memoria y se borra en cada deploy**. Mudarlo a Redis está pendiente y
> **destraba además la segunda réplica** — que es la misma pregunta que se va a
> hacer el CRM cuando haya dos instancias procesando webhooks.

---

## Variables de entorno

Las que va a necesitar cada canal:

```
# Telegram (por canal, en crm_channels.config — ver 02, decisión abierta)
TELEGRAM_WEBHOOK_SECRET      verifica que el webhook es de Telegram

# WhatsApp
WHATSAPP_APP_SECRET          verifica la firma de los webhooks
WHATSAPP_VERIFY_TOKEN        para el handshake inicial de Meta
```

> ⚠️ El token de cada bot y de cada número **no** va en el entorno: es **por
> canal** y por dueño (**D1**). Dónde vive es la decisión abierta del punto 2 de
> [`02-modelo-de-datos.md`](02-modelo-de-datos.md).

---

## Antes de prender el primer canal externo

- [ ] Webhook con firma verificada
- [ ] `UNIQUE` en `channel_message_id`
- [ ] Responder 200 antes de procesar
- [ ] Crudo guardado antes de procesar
- [ ] Medios bajados con reintento
- [ ] 🔴 **`getContext` filtrado por red** — ver [`08-permisos.md`](08-permisos.md)
- [ ] 🔴 **Adjuntos firmados desplegados** — el runbook
- [ ] Decidido dónde viven los secretos de canal

Los tres marcados son los que, si faltan, **filtran datos de personas reales**.
