# Traspaso · Etapa 3 (WhatsApp)

> Escrito el **2026-09-10**, al partir el trabajo en dos sesiones: **el CRM se
> sigue acá**, y la plataforma en sí (juego, caja, panel, comisiones) va por
> otro lado.
>
> Este documento existe para que quien tome la etapa 3 **no dependa de la
> conversación anterior**. Todo lo que hace falta saber está acá o linkeado
> desde acá.

---

## La regla que no se rompe

**El CRM vive en `staging`.** A `main` sólo van arreglos de plataforma, y por su
propia rama salida de `main`. Cada push a `main` reconstruye y reinicia el
casino en vivo.

Si las dos sesiones tocan el repo a la vez, **trabajar en worktrees separados**.
Dos agentes editando el mismo árbol se pisan.

---

## Dónde quedó parada la etapa 3

| | Qué | Estado |
|---|---|---|
| 3.1 | Acompañar al socio en el trámite de Meta | ⬜ **Diferido a propósito** (ver abajo) |
| 3.2 | Webhook con la firma de Meta | ⬜ Sin empezar |
| 3.3 | Vínculo por teléfono con las tres defensas de **D4** | 🟡 **Backend hecho, falta la UI** |
| 3.4 | El aviso de la ventana de 24 h | ⬜ Sin empezar |
| 3.5 | Qué se hace con audios y videos | ✅ **Decidido**, sin implementar |

### Lo que ya está (commit `a8256a3`)

- **`apps/api/src/chat/telefono.ts`** + su spec (26 tests). Las dos formas
  canónicas —`telefonoE164()` para mostrar, `claveDeTelefono()` para
  comparar— y `variantesDeTelefono()` para buscar contra `users.phone` sin
  normalizar la columna.
- **Migración `0116`**: índices funcionales sobre los dígitos de
  `users.phone` y `crm_contacts.phone`.
- **`jugadoresConEseTelefono`** arreglado: comparaba el string crudo, así que
  el freno del alta **no frenaba nada**.
- **`vincularContacto` / `desvincularContacto`** + endpoints
  `POST|DELETE /tenant/chat/contacts/:id/link` y `GET /tenant/chat/jugadores`.
  Queda constancia en `crm_timeline_events`.
- **18 tests e2e** en `crm-vinculo-telefono.e2e.ts` con las tres defensas y R6.

**Falta**: los botones en la ficha (`components/admin/crm/ficha.tsx`) para
vincular y deshacer. El backend está y no lo llama nadie.

---

## Las tres decisiones que ya tomó el dueño (2026-09-10)

1. **La cuenta de Meta está en trámite.** O sea: se construye lo que se puede
   verificar sin Meta —la ventana de 24 h, el vínculo por teléfono, el webhook
   con su firma (que se prueba con firmas fabricadas)— y **el envío queda
   escrito para enchufar el día que Meta verifique**. No se reporta como
   "listo" nada que no haya corrido nunca.
2. **Audio sí, video no.** Los mensajes de voz son cómo habla media Argentina
   por WhatsApp: sin eso el operador no puede oír al cliente. El video pesa
   entre 10 y 50 veces más y es raro en este contexto. Los audios entran a
   **D15** (se borran a los 6 meses) como cualquier adjunto. Hay que sumar el
   MIME a `CHAT_ATTACHMENT_MIMES` en `chat.types.ts`, que hoy sólo acepta
   imágenes y PDF.
3. **El 3.1 se difiere hasta tener un socio real haciendo el trámite.** El
   trámite de Meta cambia seguido y escribirlo de memoria produce una guía que
   no coincide con lo que el socio ve en pantalla.

---

## ⚠️ La decisión de arquitectura que hay que tomar antes del 3.2

**Meta configura UNA sola URL de callback por App.** Eso choca de frente con
cómo está hecho el webhook de Telegram, donde el discriminador viaja en la URL
(`/webhook/:tenantSlug/:channelId`).

Las dos formas de resolverlo:

| | Cómo | Costo |
|---|---|---|
| **A** | **Una App de Meta (nuestra) + N WABAs (una por socio)**. El webhook es uno solo y se resuelve por `phone_number_id` del payload. | Hace falta una tabla en `platform_control` que mapee `phone_number_id` → tenant, porque hay que saber a qué casino pertenece **antes** de poder abrir su base. Y si Meta restringe nuestra App, **se quedan sin WhatsApp todos los socios a la vez**. |
| **B** | Cada socio crea su propia App de Meta y configura el webhook | Le pedís a un cajero que sea desarrollador. No es realista. |

**Recomendación: A.** Y hay que decir por qué **no viola D13**: lo que D13
protege es que una denuncia contra el número de un socio no caiga sobre la
cuenta de todos, y eso vive en el **WABA / Business Manager**, que sigue siendo
de cada socio. La App es sólo el conector técnico.

**Pero el punto flaco de A es real y hay que escribirlo:** nuestra App pasa a ser
un punto único de falla para todos los canales de WhatsApp. Eso no estaba
contemplado en D13 y merece su propia decisión numerada.

---

## Lo que hay para copiar

Telegram ya resolvió el mismo problema y conviene mirarlo antes de escribir
nada (`apps/api/src/chat/telegram/`):

- `telegram-webhook.controller.ts` — el orden que hace que no se pierda un
  mensaje: **verificar → guardar el crudo → responder 200 → recién ahí
  procesar**. Y por qué se responde 200 incluso a lo que no se entiende.
- `telegram-inbound.service.ts` — de un payload a contacto + conversación +
  mensaje, con la clave de idempotencia. **Leer el comentario sobre
  `channelMessageId`**: el `message_id` de Telegram es por chat y no por bot, y
  eso hizo desaparecer en silencio el primer mensaje de cada persona nueva.
  WhatsApp tiene `wamid`, que sí es único global — pero conviene entender el
  caso antes de confiar.
- `telegram-outbound.service.ts` — persiste primero, manda después, y anota el
  resultado (`delivered_at` / `delivery_error`, migración `0114`).
- `telegram-channels.service.ts` — vincular/desvincular, y **D20**: el token se
  guarda cifrado y no vuelve a salir en ninguna respuesta.

Para la ventana de 24 h, el dato ya está: el último `inbound` de la
conversación. Es la misma consulta que usa `CONSULTA_CHATS_SIN_RESPONDER` en
`health-report.cron.ts`, con `crm_messages_conv_idx`.

---

## 🔴 El riesgo abierto más grande, y no es de WhatsApp

**Telegram nunca corrió con un bot real.** Están construidos y probados contra
la base: vincular el bot, el webhook, recibir, adjuntos, responder, mandar
archivos, la bandeja, la ficha, el alta, los circuitos y las métricas. Nada de
eso pasó nunca por la API de Telegram de verdad.

Sumar WhatsApp apila un segundo canal externo sobre un primero que no se probó.
**Antes de meterle más peso, conviene que el dueño pruebe Telegram con un bot
de BotFather** — son cinco minutos y no depende de nadie.

Es lo único de toda la lista que un agente no puede hacer solo.

---

## Lo demás que quedó pendiente en el CRM

- **La caja adentro del chat**: diferida, no decidida. El hueco está marcado en
  la ficha y lo que hay que rederivar el día que se decida está en **D21** y
  siguientes de `14-decisiones.md`.
- **Difusión masiva** (**D21**, las campañas entran) y **Base de datos**:
  dependen de WhatsApp.
- **`crm_timeline_events` no tiene pantalla** (roadmap 4.3). Ya se escribe: los
  vínculos y desvínculos quedan ahí y hoy sólo se leen consultando la base.
- **Supervisión para el socio** (métrica 4 de `10-metricas.md`): necesita una
  decisión que cambie **D10**. No se construyó nada.
- **CI corre `pnpm lint` antes de `pnpm build`**, así que las reglas de ESLint
  que necesitan tipos están ciegas a todo lo que viene de `@casino/db`. Hay 18
  errores en 14 archivos que CI no ve.
