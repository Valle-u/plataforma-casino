# 08 · Integración con Kommo (CRM / Livechat)

> Estado: **decidido en estructura**. Detalles del adapter pueden afinarse al implementar contra el plan real.

Define cómo integramos Kommo como **CRM + livechat** del lado del operador, manteniendo branding propio del tenant y soportando una jerarquía donde Cajeros, Socios y el Admin Tenant ven solo lo que les corresponde.

---

## 1. Principios

1. **Adapter Pattern (`ICRM`)**. Kommo es el primary, pero el contrato es genérico. **Chatwoot** queda como adapter alternativo para tenants que no quieran pagar Kommo Advanced.
2. **Cada tenant trae su propia cuenta** (Kommo o Chatwoot). Nosotros nos conectamos vía OAuth/API key.
3. **Widget nativo nuestro**. El chat embebido en `apps/web` es código nuestro. Sincronizamos con el CRM vía API + webhooks. El branding queda 100% del tenant.
4. **Scope obligatorio**. Cajero ve solo chats de sus jugadores. Socio ve solo su red. Admin Tenant ve todo. Verificado en backend, no solo en UI.
5. **Datos sensibles fuera del CRM**. Solo PII de contacto y stats agregadas. Nada de CBU, balance en tiempo real, comprobantes ni passwords.
6. **MVP = livechat + atención**. CRM de marketing (segmentos, salesbot, atribución) → v2.

---

## 2. Contrato `ICRM`

Vive en `packages/adapters/crm/`.

```ts
interface ICRM {
  readonly code: string;                     // 'kommo' | 'chatwoot'
  readonly name: string;

  // OAuth / conexión
  startOAuth(redirectUri: string): Promise<{ authUrl: string; state: string }>;
  completeOAuth(code: string, state: string): Promise<CRMCredentials>;
  testConnection(creds: CRMCredentials): Promise<{ ok: boolean; details?: string }>;

  // Leads / contactos
  upsertLead(input: UpsertLeadInput): Promise<{ externalLeadId: string }>;
  addNote(externalLeadId: string, note: string, meta?: Record<string, unknown>): Promise<void>;
  addTask(externalLeadId: string, task: TaskInput): Promise<void>;
  setTags(externalLeadId: string, tags: string[]): Promise<void>;
  setCustomFields(externalLeadId: string, fields: Record<string, unknown>): Promise<void>;

  // Conversaciones
  sendMessage(input: SendMessageInput): Promise<{ externalMessageId: string }>;
  markAsRead(externalConversationId: string): Promise<void>;

  // Pipelines
  listPipelines(): Promise<Pipeline[]>;
  createPipeline?(name: string, stages: string[]): Promise<Pipeline>;
  movePipelineStage(externalLeadId: string, stageId: string): Promise<void>;

  // Webhooks (handler genérico que el adapter parsea)
  parseWebhookEvent(payload: unknown, signature: string): CRMEvent | null;
}
```

Errores tipados (`CRMError` con `code`, `retryable`, `cause`).

---

## 3. Configuración por tenant

Cada tenant elige qué CRM usa y conecta credenciales desde el panel del Admin Tenant.

```sql
-- DB de tenant
crm_configs
  id, tenant_scope_id nullable,    -- nullable = config del tenant; si tiene valor = config de un Socio
  adapter_code text,               -- 'kommo' | 'chatwoot'
  credentials jsonb encrypted,     -- access_token, refresh_token, account_id, base_url
  is_active bool,
  default_pipeline_id text,
  default_responsible_user_id text,
  field_mapping jsonb,             -- mapeo de custom fields nuestros → Kommo
  last_health_check timestamptz,
  created_by, created_at, updated_at
```

Encriptación con clave del KMS / Vault definido en `docs/12-seguridad-compliance.md` (pendiente).

---

## 4. Jerarquía y "entorno propio del Socio"

### 4.1 Default — pipeline propio dentro del Kommo del tenant

- El Admin Tenant conecta **un Kommo** para todo el tenant.
- Cada Socio recibe un **pipeline propio** dentro de ese Kommo (nombrado tipo `Socio - Juan Pérez`).
- Los leads de los referidos del Socio entran a su pipeline.
- En el panel, el Socio ve solo su pipeline filtrado.
- En Kommo, el responsable por defecto se setea al Socio (o sus empleados de soporte).

Tabla auxiliar:
```sql
crm_socio_pipelines
  socio_user_id, pipeline_id, default_responsible_id, created_at
```

### 4.2 Opcional — Socio con su propio Kommo

Un Socio con permiso `crm.connect_own` puede conectar **su propia cuenta de Kommo** desde su panel. Implicaciones:

- Sus leads / conversaciones van **solo a su Kommo**, NO al del tenant.
- El Admin Tenant **pierde visibilidad** sobre esos chats (advertencia clara en la UI al activar).
- Si después desconecta su Kommo propio, los leads existentes no se migran automáticamente al del tenant (decisión: queda como histórico en Kommo del Socio).
- Para soporte cruzado, el Admin Tenant puede pedir permiso al Socio para acceder.

**CRM Resolver** decide qué CRM usar para cada lead nuevo:
1. ¿El usuario tiene Socio referente con CRM propio activo? → usar ese.
2. Si no → usar el del tenant.
3. Si el tenant no tiene CRM configurado → no se sincroniza con CRM (modo manual).

### 4.3 Permisos relevantes (a agregar al catálogo de `03-jerarquia-roles.md`)

- `crm.connect` — conectar/desconectar el CRM principal del tenant (Admin Tenant).
- `crm.connect_own` — conectar tu propio CRM (Socio con privilegio especial).
- `crm.config_edit` — editar mappings, pipelines, responsables.
- `crm.view_pipeline` — ver pipeline (con scope automático por jerarquía).
- `crm.send_message` — enviar mensajes (con scope).

---

## 5. Widget nativo de livechat

Vive en `apps/web/components/livechat/`. **No es un iframe de Kommo**, es código nuestro.

### Funcionalidades MVP
- Botón flotante en sitio público y panel del jugador.
- Chat en tiempo real (Socket.io).
- Indicador de "operador escribiendo".
- Notificación de mensaje nuevo con badge.
- Persiste historial entre sesiones del jugador.
- Soporte de imágenes (subida a S3, no al CRM).
- Templates de respuesta rápida (lado operador).
- Estado: online / fuera de horario (configurable por tenant).

### Sincronización con Kommo
```
Mensaje del jugador (web)
   │
   ▼
Backend recibe → guarda en livechat_messages (DB tenant) → Socket.io al operador
   │
   ▼
Cola BullMQ → ICRM.sendMessage al Kommo (postea en el lead)
                                                  │
                                                  ▼
Operador en Kommo responde (alternativa al panel) │
                                                  ▼
Webhook de Kommo → backend → guarda en livechat_messages → Socket.io al jugador
```

> **Bidireccional**: el operador puede responder desde el panel nuestro **o** desde Kommo. Igual llega al jugador.

### Tablas (extiende lo definido en `docs/04-modelo-datos.md`)
```sql
livechat_threads
  id, user_id, kommo_lead_id (o chatwoot_conversation_id),
  status enum('open','closed','snoozed'),
  assigned_to uuid FK users,
  scope_owner_id uuid FK users,    -- a qué Socio/Cajero pertenece este chat
  opened_at, closed_at, last_message_at

livechat_messages
  id, thread_id, sender_type enum('player','operator','system','bot'),
  sender_id, body, attachments jsonb,
  external_message_id text,        -- id en el CRM
  source enum('web','crm','api'),  -- por dónde entró
  sent_at
```

---

## 6. Eventos auto que generan notas/tasks en el CRM

Confirmado: todos menos balance en tiempo real.

### Eventos sincronizados

| Evento (interno) | Acción en CRM |
|---|---|
| Usuario registrado | `upsertLead` con datos básicos + tag `nuevo` |
| Primer depósito (FTD) | `addNote` "FTD: $X" + tag `ftd` + mover stage a "Depositó" |
| Depósito recurrente | `addNote` "Depósito: $X" |
| Retiro solicitado | `addNote` + `addTask` ("Procesar retiro") al responsable |
| Retiro pagado | `addNote` "Retiro pagado: $X, ref: ..." |
| Bono otorgado | `addNote` "Bono: <tipo> $X" |
| Wagering cumplido | `addNote` "Bono <id> liberado" |
| Inactividad > 7 días | `addTask` ("Reactivar") al responsable |
| Inactividad > 30 días | tag `inactivo` |
| Ban / suspensión | `addNote` "Suspendido: <razón>" + mover stage |
| Reclamo abierto | `addTask` urgente + tag `reclamo` |

### Tags automáticos por comportamiento

| Tag | Trigger |
|---|---|
| `vip` | Lifetime deposits > umbral configurable |
| `high_roller` | Promedio de bet > umbral |
| `nuevo` | Registro hace < 7 días |
| `inactivo` | Sin login > 30 días |
| `riesgo_fraude` | Score antifraude > umbral (ver `15-engagement-promos.md §D`) |
| `referido_de_<socio>` | Atribución por link de referido |
| `metodo_<X>` | Método de pago preferido |

### Custom fields del lead

Sincronizamos como custom fields en el lead de Kommo:
- `username_plataforma`
- `socio_referente`
- `lifetime_deposits`
- `lifetime_withdrawals`
- `total_apostado_lifetime`
- `ultima_sesion_juego`
- `metodo_pago_preferido`
- `idioma`

> **NO sincronizamos**: balance actual, CBU/wallet cripto, DNI, password hash, comprobantes, IPs históricas, datos de antifraude detallados.

Refresco: stats lifetime se actualizan vía job nocturno (no en tiempo real). Eventos puntuales (depósito, retiro) sí en el momento.

---

## 7. Frontera de datos compartidos con CRM externo

Reglas (Kommo es externo, por más oficial que sea):

| Categoría | ¿Va al CRM? |
|---|---|
| Nombre, username, email, teléfono | Sí |
| Idioma, timezone | Sí |
| Tags de comportamiento | Sí |
| Lifetime stats agregadas | Sí (con TTL diario) |
| Notas de eventos puntuales | Sí |
| Mensajes de chat | Sí (es el feature) |
| Balance actual | **No** |
| CBU / wallet cripto | **No** |
| Comprobantes de pago | **No** |
| DNI / KYC docs | **No** |
| Hash de password / 2FA secret | **No** (obvio) |
| IPs / device fingerprints | **No** |
| Datos de antifraude / cluster duplicados | **No** |
| Detalle de rounds individuales | **No** (son millones, no aporta) |

Si soporte necesita uno de los datos "No", entra al panel nuestro (con auditoría). Kommo nunca lo tiene.

---

## 8. Scope: quién ve y responde qué

| Rol | Chats visibles | Puede responder |
|---|---|---|
| Admin Tenant | Todos los del tenant | Sí, todos |
| Socio | Solo de su red (referidos directos + indirectos vía sus distribuidores/cajeros) | Sí |
| Distribuidor | Solo de jugadores de su red | Sí |
| Cajero | Solo de jugadores asignados o referidos directos | Sí |
| Empleado | Lo que el Admin Tenant configure (puede ser todo o un subset por tag) | Sí, con permiso `crm.send_message` |
| Usuario | Su propio chat | Sí (es jugador) |

### Implementación
- En el panel: filtro automático aplicado en backend según el actor.
- Kommo no enforce este scope (no sabe de nuestra jerarquía). El operador podría ver más en Kommo si tiene acceso directo. **Por eso recomendamos que los operadores usen el panel nuestro**, no Kommo directo.
- Para Socios con su propio Kommo: ya está aislado a nivel de cuenta.

### Asignación automática
Cuando llega un mensaje de un jugador:
1. Sistema busca: ¿este jugador tiene cajero asignado activo? → asignar.
2. Si no, ¿tiene Socio referente con `livechat.access`? → asignar.
3. Si no, queda en pool del Admin Tenant.
4. Escalado: si el asignado no responde en X minutos (configurable) → escalar al superior. Notifica.

---

## 9. Métricas y analytics

### En el panel propio (sobre nuestra DB)
- Tiempo medio de respuesta primer mensaje (TFR).
- Tiempo medio de resolución.
- Chats abiertos por operador.
- Volumen por canal (web, WhatsApp si está integrado en Kommo).
- Conversiones: % de chats que terminaron en depósito posterior.
- Sentiment básico (v2): clasificación auto de chat positivo/negativo.

### Linkeo a Kommo
Botón "Ver en Kommo" en cada thread → abre directo el lead en Kommo para el operador que prefiera esa interfaz.

> Ver `docs/10-panel-control.md` (pendiente) para layout del dashboard de soporte.

---

## 10. CRM de marketing (v2)

Roadmap, no MVP. A documentar más a fondo cuando llegue su turno.

- **Segmentos exportados**: queries sobre nuestra DB → leads en Kommo con tag específico ("usuarios que depositaron > $X y no juegan hace 7 días").
- **Salesbot de Kommo** dispara mensajes (WhatsApp / email / SMS) a esos segmentos.
- **Atribución**: cada campaña en Kommo lleva un `campaign_code` que se cruza con sesiones de juego y depósitos posteriores → reporte de "ROI de campaña X".
- **A/B testing** de copy/timing/canal.
- **Auto-replies inteligentes** con LLM para preguntas frecuentes.

Ver también `docs/09-publicidad-referidos.md` (pendiente).

---

## 11. Plan de Kommo recomendado

**Mínimo: Advanced**.

Necesario para:
- API rate limits razonables (10 req/s por subdomain en Advanced+).
- Salesbot.
- Pipelines múltiples sin restricción.
- Integraciones avanzadas (WhatsApp Business oficial).
- Webhooks completos.

**Comunicación al cliente**: durante el onboarding del tenant, el panel del Admin Tenant le avisa: *"Para usar el módulo de atención al cliente necesitás Kommo Advanced o superior. Si no, podés activar Chatwoot (gratuito, self-hosted)."*

---

## 12. Alternativa: Chatwoot (adapter swappable)

[Chatwoot](https://www.chatwoot.com/) es un CRM/livechat **open source self-hosted** gratuito. Cumple bien para arrancar.

### Cuándo conviene Chatwoot
- Tenants que no quieren pagar Kommo.
- Plataforma de prueba / demo.
- Operadores chicos.

### Implementación
- `ChatwootAdapter` cumple la misma interfaz `ICRM` con sus métodos.
- El Admin Tenant elige al conectar: "Conectar Kommo" o "Conectar Chatwoot".
- Misma UX en el panel; lo único que cambia es el destino de las llamadas API.

### Limitaciones vs Kommo
- Sin Salesbot equivalente potente (tiene automatización pero más simple).
- Pipelines menos flexibles (Chatwoot no tiene "deals" como Kommo).
- Requiere hosting propio (un VPS chico alcanza).

### Hosting
Para tenants que no pueden hostear: ofrecemos un Chatwoot multi-tenant **administrado por el super-admin** como servicio extra (cobro adicional, instancia de Chatwoot por tenant en infra del super-admin).

> Esto se documenta en detalle si avanzamos por este camino.

---

## 13. Errores y resiliencia

| Caso | Mitigación |
|---|---|
| Kommo down / API caída | Cola BullMQ con retry exponencial. El livechat **interno sigue funcionando** (DB local). Sincroniza cuando vuelve. |
| Webhook duplicado | Idempotencia por `external_message_id`. |
| Webhook con firma inválida | Rechazo + alerta (intento de fraude). |
| Rate limit excedido | Backoff + buffering en cola. |
| Token OAuth expirado | Refresh automático. Si falla → notificar al Admin Tenant a re-autorizar. |
| Discrepancia de mensajes | Job de reconciliación nocturno por thread (compara últimos N mensajes). |
| CRM desconectado | Modo "solo interno": livechat funciona pero no postea a CRM. Banner en panel "CRM desconectado, reconectar". |

---

## 14. Webhooks que escuchamos de Kommo

Endpoint: `POST /webhooks/crm/kommo` (autenticado con secret + IP whitelist).

Eventos relevantes:
- `lead.created`, `lead.updated`, `lead.status_changed`
- `chat.message_received`
- `chat.conversation_assigned`
- `chat.conversation_closed`
- `note.created` (si el operador agrega nota desde Kommo)

Cada uno → handler que actualiza DB local + emite Socket.io a paneles abiertos.

---

## 15. Pendientes / a definir

- Cómo manejar **WhatsApp Business** específicamente: lo gestiona Kommo, pero requiere número verificado por tenant. Documentar el onboarding aparte.
- Plantillas de pipelines pre-armadas para tenants nuevos (ahorra el setup inicial en Kommo).
- Estrategia frente a ban de número de WhatsApp (común en el rubro casino): números múltiples por tenant + balanceo.
- Soporte multi-idioma de templates de respuesta rápida.
- Bot de FAQ con LLM (puede ser MVP+1, no es urgente).
- Migración entre adapters (un tenant que arranca en Chatwoot y migra a Kommo): exportar/importar histórico de conversaciones.
- Permisos `crm.*` deben sumarse al catálogo de `docs/03-jerarquia-roles.md` cuando se implemente el módulo.
