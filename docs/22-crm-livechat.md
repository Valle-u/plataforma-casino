# 22 · CRM + Livechat (propio)

> Diseño de un sistema de chat en vivo **propio** que nace como soporte reactivo
> y está estructurado para crecer a **CRM omnicanal** (WhatsApp y demás).
> Reemplaza la idea de CRM externo de [`08-integracion-kommo.md`](08-integracion-kommo.md):
> se decidió construirlo in-house por la integración profunda con jugador,
> wallet y jerarquía de roles.
>
> Estado: **diseño** (no implementado). Fecha: 2026-08-21.

---

## 0. Principio rector

**No modelamos "chat = mensajes por WebSocket". Modelamos un CONTACTO y
CONVERSACIONES agnósticas del canal.** El livechat web es el **canal #1**;
WhatsApp / SMS / Telegram / email son canales futuros que alimentan el **mismo**
inbox y el **mismo** contacto vía _adapters_. Esto es lo que convierte el chat
en CRM sin rearquitecturar.

Regla de oro: nunca hacer un livechat "chato" (solo mensajes web) que después
haya que reescribir. Contact / Channel / Conversation / Message desde el día uno.

---

## 1. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Objetivo del MVP | **Soporte reactivo** (jugador escribe, operador responde). CRM en etapas siguientes. |
| Ruteo / visibilidad | **Solo el operador directo** del jugador ve/atiende su chat (su parent inmediato en la jerarquía). El upline NO ve los chats de sus subordinados (salvo override del admin, ver §9). Redes independientes aisladas entre sí. Reusa el **ScopeGuard / user_hierarchy** existente. |
| Asignación | **Automática al operador directo**. |
| Contacto | **Jugador registrado O lead anónimo**. Un contacto puede no tener `user_id`. |
| Lead anónimo | Chatea **sin login** (lead con id de sesión); al registrarse/loguear se **fusiona** con su jugador conservando el historial. |
| Modelo de conversación | **Hilo continuo por contacto + estados** (abierta/pendiente/resuelta por tramo). Un solo timeline por persona, con métricas por estado. |
| Contexto del operador | Saldo actual · depósitos/retiros + movimientos · identidad + upline · notas + tags. |
| CRM (guardable) | **Notas internas** + **tags predefinidos por tenant** (ej. VIP, en riesgo, moroso). |
| Timeline | **Chat + eventos de plataforma mezclados** cronológicamente (registró, depositó, retiró, bono, bloqueo). |
| Adjuntos | **Imágenes + PDF** (reusa infra de uploads + `FileValidationService`). |
| Realtime | **Full**: no leídos (badge + sonido), typing, presencia (online/offline), visto (read receipts). |
| Aviso al jugador offline | **In-app al volver** (badge). Push/WhatsApp fuera del sitio → etapa futura. |
| Offline / fuera de horario | **Nada especial**: el mensaje queda guardado (store-and-forward), el operador lo ve al volver. Sin bot por ahora. |
| Plantillas | **Sí, por tenant** (respuestas rápidas que el operador inserta con un click). |
| Retención | **Limitada (~12 meses)** con auto-archivado/borrado, + borrado a pedido (privacidad). |
| Identidad por teléfono | **Auto-merge por número**: contactos con el mismo teléfono se unifican (lead web + WhatsApp + jugador = 1 contacto). Prepara WhatsApp. |
| Endpoint realtime | **Subdominio `ws.<dominio>`** apuntando hoy a la API; auth por **token efímero** (no la cookie). Separable a servicio propio sin tocar el front. |
| Config por tenant | Cada tenant define sus **tags, plantillas y horarios** desde su panel. |
| Primer canal futuro | **WhatsApp** (Business API). |
| Construir vs comprar | **Propio** (integración profunda con la plataforma). |

---

## 2. Modelo de datos (contact-centric)

Todo vive en la **DB del tenant** (aislamiento físico como el resto). Migraciones
por tenant (mismo sistema que `packages/db/migrations`).

### 2.1 Tablas

**`crm_contacts`** — el cliente unificado (jugador o lead).
- `id` uuid PK
- `user_id` uuid NULL → FK a `users` (null = lead anónimo/externo aún no registrado)
- `display_name` text NULL
- `phone` text NULL (normalizado E.164) — **llave de merge**
- `email` text NULL
- `is_lead` boolean (true hasta que se linkea a un `user_id`)
- `attributes` jsonb (datos libres/segmentación futura)
- `created_at`, `updated_at`
- Índices: `phone` (para auto-merge), `user_id`.

**`crm_channels`** — instancia de canal (por ahora una fila `web-livechat` por tenant; a futuro una por número de WhatsApp, etc.).
- `id` uuid PK · `type` text (`web-livechat` | `whatsapp` | `sms` | `telegram` | `email`) · `config` jsonb · `is_active` boolean.

**`crm_conversations`** — hilo (continuo por contacto y canal).
- `id` uuid PK
- `contact_id` uuid FK
- `channel_id` uuid FK
- `assigned_operator_id` uuid NULL → FK `users` (el operador directo)
- `status` text (`open` | `pending` | `resolved`)
- `last_message_at` timestamptz · `unread_for_operator` int · `unread_for_contact` int
- `created_at`, `updated_at`
- Regla: **una conversación abierta por (contacto, canal)**; al resolver y volver a escribir, se reabre la misma (hilo continuo).

**`crm_messages`** — mensajes normalizados (vengan de WS o de un webhook).
- `id` uuid PK
- `conversation_id` uuid FK
- `direction` text (`inbound` = del contacto | `outbound` = del operador | `system`)
- `sender_user_id` uuid NULL (operador que lo mandó; null si es del contacto/sistema)
- `body` text NULL
- `attachments` jsonb (array de `{ storageKey, url, mime, sizeBytes }`)
- `channel_message_id` text NULL (id externo, ej. de WhatsApp, para idempotencia)
- `delivered_at`, `read_at` timestamptz NULL (para "visto")
- `created_at`
- Índice: `conversation_id, created_at`.

**`crm_notes`** — notas internas privadas sobre un contacto.
- `id` · `contact_id` FK · `author_user_id` FK · `body` text · `created_at`.

**`crm_tags`** — catálogo de tags **por tenant** (predefinidos por el admin).
- `id` · `label` text · `color` text · `created_at`.

**`crm_contact_tags`** — M:N contacto ↔ tag (`contact_id`, `tag_id`, `assigned_by`, `created_at`).

**`crm_templates`** — plantillas de respuesta **por tenant**.
- `id` · `title` text · `body` text · `shortcut` text NULL · `created_at`.

**`crm_timeline_events`** — línea de tiempo del contacto (chat + eventos de plataforma).
- `id` · `contact_id` FK · `type` text (`message` | `registered` | `deposit` | `withdrawal` | `bonus` | `blocked` | …) · `ref_id` uuid NULL (id del recurso: deposit/withdrawal/message) · `summary` text · `metadata` jsonb · `occurred_at` timestamptz.
- Se llena por dos vías: (a) cada mensaje inserta su evento; (b) los flujos existentes (deposits/withdrawals/bonuses) emiten un evento al timeline (hook o listener de dominio).

> Config del tenant (horarios de atención, on/off del widget, etc.) puede ir como
> settings (`crm.*`) en `tenant_settings`, reusando el sistema de settings actual.

### 2.2 Auto-merge por teléfono
Al crear/actualizar un contacto con `phone`, si ya existe otro contacto con el
mismo número normalizado → se **fusionan** (se conserva el que tenga `user_id`;
se mueven conversaciones/notas/tags/timeline al sobreviviente). Igual al linkear
un lead a un `user_id` en el registro. Esto unifica lead web + jugador + (futuro)
WhatsApp en un solo timeline.

---

## 3. Arquitectura

```
┌─ Jugador (Next/Vercel, /play) ─┐   ┌─ Operador (Next/Vercel, panel) ─┐
│  Widget de chat flotante        │   │  Bandeja/inbox + panel contexto  │
└──────────┬──────────────────────┘   └──────────┬───────────────────────┘
           │  wss://ws.<dominio>  (token efímero) │
           └──────────────────┬───────────────────┘
                              ▼
             ┌─ Módulo Chat (Gateway socket.io) ────────┐
             │  DENTRO de la API NestJS.                 │
             │  Reusa: TenantJwt, ScopeGuard,            │
             │  user_hierarchy, uploads, notifications.  │
             │  Borde limpio → extraíble a servicio.     │
             └──────┬─────────────────────┬──────────────┘
                    ▼                     ▼
          ┌─ DB del tenant ─┐   ┌─ Redis (ya está) ────────┐
          │ crm_* (§2)      │   │ socket.io adapter (pub/sub│
          └─────────────────┘   │ multi-instancia) + presencia│
                                └────────────────────────────┘
      (Futuro) ┌─ Adapters de canal ─┐
               │ WhatsApp / SMS / …   │  webhook entrante → crm_messages
               └──────────────────────┘
```

### 3.1 Dónde vive
- **Realtime**: **módulo NestJS** dentro de la API (Railway hoy → VPS/Dokploy después). NO servicio aparte todavía; borde encapsulado para extraerlo si la carga de WS lo justifica (momento natural: la migración al VPS).
- **UI jugador**: widget **embebido en `/play`** (no página ni subdominio aparte).
- **UI operador**: sección **dentro del panel**.
- **Endpoint WS**: subdominio `ws.<dominio>` (reverse proxy/Dokploy → la API). El front SIEMPRE conecta a `wss://ws.<dominio>`, así se puede repuntar a un servicio dedicado sin tocar el front.

### 3.2 Auth del WebSocket (clave)
La cookie de sesión **no viaja** en un WS cross-site (front en Vercel, WS en otro
origen). Solución:
1. El cliente pide un **token efímero de chat** por HTTP normal (same-origin, con
   la cookie): `POST /tenant/chat/ws-token` → devuelve un JWT corto (~60s) con
   `tenantId + userId + rol`.
2. El cliente abre el socket pasando ese token en el handshake.
3. El gateway lo valida, resuelve tenant + user + rol, y une al socket a sus
   **rooms**.

Así el WS puede vivir en cualquier subdominio/servicio sin depender de cookies.

### 3.3 Rooms y scope
- Room por conversación: `t:{tenantId}:conv:{conversationId}`.
- Room por operador: `t:{tenantId}:op:{userId}` (recibe sus conversaciones asignadas + no leídos).
- El adapter de Redis namespacea todo por tenant → aislamiento multi-instancia.
- **Ruteo**: al entrar un mensaje de un jugador, se resuelve su **operador directo**
  (parent inmediato en `user_hierarchy`), se asigna la conversación y se emite a su
  room. Visibilidad = solo ese operador (+ override admin, §9). Redes independientes
  quedan naturalmente aisladas por el mismo scope.

---

## 4. Funcionalidad

### 4.1 Widget del jugador (`/play`)
- Botón flotante → panel de chat.
- **Lead anónimo**: puede escribir sin login (se crea `crm_contact` lead con id de sesión guardado en el cliente). Al registrarse/loguear → merge con su jugador.
- **Adjuntos**: imágenes + PDF (reusa uploads + validación de tipo/tamaño).
- **Realtime**: no leídos (badge + sonido), typing, presencia del operador, visto.
- **Aviso**: badge in-app al volver (reusa `NotificationsService`).
- **Offline**: el mensaje queda guardado; sin aviso especial.

### 4.2 Inbox del operador (panel)
- Lista de conversaciones asignadas (solo las suyas, por scope), con no leídos y estado.
- Panel de **contexto del jugador** al lado: saldo · depósitos/retiros + movimientos · identidad + upline · notas + tags.
- **Timeline** del contacto: chat + eventos de plataforma mezclados.
- **Plantillas** (insertar respuesta rápida), **notas** internas, **tags** (predefinidos por tenant).
- Estados: abrir/marcar pendiente/resolver (el hilo sigue siendo continuo).

### 4.3 Config por tenant (panel del admin)
- Catálogo de **tags**, **plantillas**, **horarios** de atención, on/off del widget.

---

## 5. Preparación omnicanal / WhatsApp (etapa futura)

- **Adapter pattern**: cada canal traduce inbound (webhook) → `crm_messages` y
  outbound (`crm_messages` → API del proveedor). El core (Contact/Conversation/
  Message) no cambia.
- **Teléfono = llave**: al llegar un WhatsApp, se matchea por número → mismo contacto,
  mismo timeline (auto-merge §2.2).
- **WhatsApp Business API** (a evaluar en su momento): proveedor (Meta Cloud API
  directo, o Twilio / 360dialog), aprobación de Meta, **plantillas** para mensajes
  iniciados por el negocio (regla de la ventana de 24h), y **costo por conversación**.
  Nada de esto afecta el modelo de datos, solo el adapter + la operación.

---

## 6. Seguridad, compliance y operación
- **Retención ~12 meses** (job de archivado/borrado) + borrado puntual a pedido.
- **PII**: `phone`/`email` → redactar en logs y en Sentry (ya hay `beforeSend` que
  redacta; sumar estos campos).
- **Rate-limit de mensajes** por usuario (reusa `@RateLimit` / `RateLimitGuard`).
- **Aislamiento multi-tenant**: tablas en la DB del tenant + rooms namespaceados.
- **Auth**: token efímero de WS con scope por rol/jerarquía; el gateway valida en
  cada acción que el operador tenga scope sobre esa conversación (ScopeGuard).
- **Moderación**: bloquear/reportar contacto; el operador puede cerrar/silenciar.

---

## 7. Roadmap por etapas

- **Etapa 0 — Fundaciones**: modelo de datos `crm_*` + migraciones por tenant + `POST /chat/ws-token` + gateway socket.io con Redis adapter + auth por token.
- **Etapa 1 — MVP livechat web**: widget jugador (con lead anónimo + merge), inbox operador con contexto + timeline (solo chat), realtime full, adjuntos, ruteo al operador directo, store-and-forward offline.
- **Etapa 2 — CRM**: notas + tags por tenant, plantillas, timeline con **eventos de plataforma** (hook desde deposits/withdrawals/bonuses), config por tenant, retención/borrado.
- **Etapa 3 — Omnicanal WhatsApp**: adapter WhatsApp Business API, merge por teléfono end-to-end, plantillas outbound.
- **Etapa 4 — Proactivo / campañas**: mensajes iniciados por el negocio (recordar depósito, "retiro listo", win-back), segmentación por tags, broadcasts.

---

## 8. Reutiliza (ya existe en la plataforma)
- `user_hierarchy` + `ScopeGuard` → ruteo/visibilidad del operador directo.
- Uploads (`/tenant/uploads/*`) + `FileValidationService` → adjuntos.
- `NotificationsService` → no leídos / avisos.
- **Redis** (hoy en el rate-limiter) → adapter de socket.io + presencia.
- Migraciones por tenant, `tenant_settings`, Sentry con redacción de PII.
- Deposits/withdrawals/bonuses → fuentes de eventos del timeline.

---

## 9. Decisiones abiertas (a definir antes de implementar)
1. **Override del admin**: con "solo operador directo", el admin del tenant NO vería
   los chats de su red. ¿Se le da un modo "ver todo mi tenant" para supervisión/
   escalado? (Recomendado: sí, configurable.)
2. **"Red dependiente = admin + sus empleados"**: definir cómo mapean los "empleados
   del admin" a operadores (¿comparten una bandeja del admin, o cada empleado es un
   operador directo con sus jugadores?). Relacionado con [`19-cupo-empleado.md`](19-cupo-empleado.md).
3. **Horarios/bot**: por ahora offline sin bot; ¿autorespuesta de FAQ en etapa 2?
4. **Retención exacta** (12m confirmado) + política de borrado (a pedido de quién).
5. **Proveedor de WhatsApp** (Meta Cloud vs Twilio vs 360dialog) — se evalúa en Etapa 3.
6. **Presencia del operador**: definir "online" (socket conectado) vs "disponible"
   (toggle manual del operador) para el ruteo/aviso.

---

## 10. Estrategia de desarrollo sin riesgo (beta sin afectar prod)

El CRM se construye **en paralelo al lanzamiento a producción**, sin tocar ni
arriesgar nada de lo existente. Tres disciplinas juntas lo garantizan:

**A. Regla de oro — solo AGREGAR, nunca MODIFICAR.** Todo el CRM es nuevo: tablas
`crm_*`, un módulo NestJS nuevo, endpoints nuevos (`/tenant/chat/*`), rutas y
componentes de front nuevos. **No se toca ni una tabla, endpoint o flujo actual.**
Si solo se agrega, es imposible romper lo que ya funciona.

**B. Feature flag (`CRM_ENABLED` / `NEXT_PUBLIC_CRM_ENABLED`), default OFF en prod.**
Igual que el kill-switch `SSR_AUTH` ([`deploy-infra`]). Con el flag apagado:
- El widget del jugador no se monta (lazy-load: ni baja el código).
- Las rutas/menú del CRM en el panel no aparecen.
- El **`ChatModule` no se importa** en la API (`imports: [...(CRM_ENABLED ? [ChatModule] : [])]`)
  → el gateway WebSocket no se instancia, no hay servidor WS, cero dependencia
  nueva de infra (Redis extra / subdominio) en prod.
- El `useWebSocketAdapter` en `main.ts` se setea **gateado por el flag**.

Se prende solo en dev / un entorno de beta / tu usuario, hasta que esté listo.

**C. El único acoplamiento con flujos existentes (timeline de eventos) se difiere
y se desacopla.** En el **MVP (Etapa 1) el CRM NO toca deposits/withdrawals**. La
ingesta de eventos (Etapa 2) se hace con un *listener fire-and-forget*: si el
evento al CRM falla, el depósito/retiro **sigue funcionando igual**. El camino
crítico de la plata **nunca depende** del CRM.

**Migraciones**: las tablas `crm_*` se crean con `CREATE TABLE` nuevo (aditivo, no
altera nada). Corren en el sistema de migraciones por tenant existente. ⚠️ Área
sensible (corren contra todas las DB de tenants): probar en dev/un tenant primero.

**Flujo de trabajo**: se desarrolla en `main` **detrás del flag** (integración
continua, pero inerte en prod) → cada push sigue deployando lo demás normal y el
CRM viaja apagado. (Nada de una rama gigante que se mergea al final.)

**Migración a Hostinger**: como es aditivo + apagado, la migración no lo "ve" como
problema — son unas tablas más y un módulo dormido. Recién en el VPS (donde el WS/
subdominio es más fácil que en Vercel) se prende el flag y se activa.

**Qué NO hacer**: modificar tablas/endpoints existentes "de paso"; meter el CRM en
el camino crítico de deposits/withdrawals/auth; prender el flag en prod antes de
tiempo; agregar dependencias obligatorias al boot de la API.

---

## 11. Futuro: subdominio del CRM en el VPS (decidido 2026-08-22)

Hoy el inbox del operador vive **dentro del panel** en `/support` (misma app,
detrás del flag). Cuando migremos a Hostinger/Dokploy (reverse-proxy + DNS + TLS
propios → subdominios triviales, a diferencia de Vercel) se lo mueve a un
**subdominio de soporte**. Dos decisiones tomadas con el dueño:

**Decisión 1 — subdominio POR TENANT** (no de plataforma). Cada casino tiene su
puerta de soporte: `soporte.miamihub.com`, `soporte.lucky7.com`, etc. Encaja con
la resolución de tenant por host que YA usa toda la plataforma (no hay que
resolver el tenant por el login).

**Decisión 2 — arrancar "misma app" (Paso 1), pero dejar TODO compatible para
partir a una app aparte (`apps/crm`) después.** El corte a app separada se hace
recién cuando existan **agentes de soporte dedicados** (que solo atienden chats y
nunca entran al panel del casino), o si el CRM escala mucho (webhooks WhatsApp,
reportes pesados). Hasta entonces, "habitación del panel" + subdominio alcanza.

### Paso 1 (en el VPS): subdominio, misma app — ~90% infra, cero refactor
- Reverse-proxy: `soporte.<dominio-del-tenant>` → **la misma app web**.
- Middleware de la web: si el host es `soporte.*`, renderiza la vista del CRM
  (hoy `/support`) como landing, en vez del panel general.
- Tenant: se resuelve por el **dominio base** (`soporte.miamihub.com` → tenant de
  `miamihub.com`). Registrar el subdominio en `tenant_domains`, **o** stripear el
  prefijo conocido `soporte.` antes de resolver (ver `TenantResolverMiddleware`).
- CORS/WS: agregar `soporte.*` (y `ws.*`) del tenant a la allowlist de orígenes
  del gateway cuando se endurezca el `origin: true` actual.

### Reglas para NO romper la compatibilidad con el "edificio aparte" (seguirlas ya)
Casi todas ya se cumplen porque el CRM se construyó aislado. Mantener:
1. **Toda la lógica del CRM vive en la API** (NestJS: `ChatService`/`ChatGateway`
   + endpoints). La UI es una capa fina: nunca meter reglas de negocio del CRM en
   el front. Así una app nueva reusa el mismo backend sin tocarlo.
2. **UI del CRM aislada y portable**: `apps/web/lib/chat/*`,
   `components/player/chat/*`, `components/admin/chat/*`. `OperatorInbox` es
   autocontenido (no depende de providers/layout exclusivos del panel salvo auth
   + api-client). Para moverlo a `apps/crm` se cambia solo el "shell"
   (PageShell/PageHeader) por el de la app nueva.
3. **Auth cross-origin ya lista**: el WS usa el **ws-token corto** (no la cookie),
   y las llamadas HTTP van por `apiPost` → el patrón ya funciona desde otro
   origen. No acoplar el CRM a "estar en el mismo origen que el panel".
4. **Protocolo WS estable y agnóstico de la UI**: los eventos
   (`message:send`, `conversation:me/list/open`, `message:reply`, `typing`,
   `message:new`) los hablan igual el tab del panel de hoy y una app separada de
   mañana. No forkearlos por UI.
5. **Tipos/lógica compartible → package, no `apps/web`**: cuando se parta, mover
   `lib/chat/types.ts` (y lo que aplique) a un package compartido. Hoy está bien
   en `web` mientras no importe internals del panel.

Con esto, el día que se necesite el edificio aparte es **crear `apps/crm` + su
deploy en el VPS** reusando la misma API/WS y levantando los componentes ya
aislados — no un refactor.
