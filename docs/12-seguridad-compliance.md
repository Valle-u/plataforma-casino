# 12 · Seguridad y Compliance

> ⚠️ Alineado con docs/LEYES.md (2026-07-07). Ante duda, mandan las LEYES + docs/20-modelo-operativo.

> Estado: **decidido en estructura**. Detalles operativos (umbrales, retenciones específicas) se afinan al implementar y pueden ajustarse por tenant.

Define autenticación, 2FA, KYC, juego responsable, secrets, cifrado, rate limiting, antifraude transversal, backups, logging, permisos sensibles y compliance básico.

---

## 1. Principios

| Principio | Implicación |
|---|---|
| **Defensa en profundidad** | Múltiples capas: rate limit + auth + permisos + scope + audit. Una falla no compromete todo. |
| **Roles privilegiados endurecidos** | Admin Tenant y Super-Admin tienen requisitos de seguridad estrictos (2FA obligatorio, alertas de login, re-auth para acciones críticas, IP whitelist opcional). |
| **Auditoría granular** | Todo evento de seguridad queda en `audit_log`. Logs de seguridad en stream separado con retención larga. |
| **PII protegida** | Datos personales sensibles cifrados en reposo (`pgcrypto`), redacted en logs, accesibles solo con permiso explícito + auditoría. |
| **Compliance arquitectónico** | Aunque MVP opera informal en Argentina, la base soporta KYC, AML, geofencing y reportes regulatorios para activarse cuando haga falta. |
| **El usuario controla su seguridad** | Jugadores y operadores ven sus sesiones, pueden cerrarlas, configurar 2FA, ver alertas de login. |
| **Errores fail-closed** | Si una validación de seguridad falla por bug, la acción se rechaza (mejor falso negativo que falso positivo). |

---

## 2. Autenticación

### 2.1 Identificadores aceptados al login

**Jugador (`apps/web`)**:
- Username **o** email **o** teléfono — cualquiera de los tres como identificador.
- Username obligatorio al registrarse. Email y teléfono opcionales.
- Si el identificador ingresado coincide con varios usuarios (raro) → error "ingrese username".

**Operador (`apps/panel`)**:
- Mismas tres opciones.
- 2FA obligatorio para Cajero hacia arriba (ver §4).

### 2.2 Política de contraseñas

- Mínimo **8 caracteres**.
- Mezcla obligatoria de **mayúscula + minúscula + número**.
- Caracteres especiales **no requeridos** (mata UX, no mejora seguridad real).
- Validación contra lista de passwords comunes (top 10.000 leaked) → rechazo si match.
- Validación de password contra el username/email del usuario → rechazo si los contiene.
- Hashing: **Argon2id** (preferido sobre bcrypt; resistente a GPU).

### 2.3 Bloqueo por intentos fallidos

- 5 intentos fallidos en 15 min sobre el mismo identificador → cuenta bloqueada por 15 min.
- Después del bloqueo: requiere captcha en cada intento por 1h.
- Tras 10 bloqueos en 24h → bloqueo extendido + alerta a soporte.
- Desbloqueo manual disponible al admin del tenant.
- Email automático al usuario tras cada bloqueo: "Hubo intentos de login en tu cuenta".

### 2.4 Sesiones

- **JWT access token**: vida corta (15 min). Firmado con clave por tenant.
- **Refresh token**: vida larga (30 días), rotación en cada uso (un refresh consume el anterior).
- Almacenamiento: **cookies httpOnly + sameSite=Lax + secure** para web. Authorization header para API directa.
- Tabla `user_sessions` (DB de tenant) con: id, user_id, device_fingerprint, user_agent, ip, created_at, last_active_at, expires_at, revoked_at.
- Pantalla "Tus dispositivos" en panel del usuario: ve todas sus sesiones activas, puede cerrar individuales o todas.
- "Cerrar sesión en todos los dispositivos" disponible (revoca todos los refresh tokens).

### 2.5 Recuperación de contraseña

- Link de reset enviado por email (token de un solo uso, vida 1h).
- Si jugador no tiene email registrado → reset solicitado al cajero/Socio asignado.
- Reset también se puede iniciar desde el panel del operador (con permiso `users.reset_password`) — usuario afectado recibe notificación.
- Tras reset: revoca todas las sesiones activas del usuario (forzar re-login).

---

## 3. Seguridad reforzada para roles privilegiados

Aplica a **Super-Admin** y **Admin Tenant**. Configurable extender a Socios desde el panel.

### 3.1 Capas adicionales

- **2FA obligatorio**, no deshabilitable.
- **Alertas de login** por email + push en cada acceso.
- **Whitelist de IPs opcional**: el Admin Tenant configura desde su panel un set de IPs/CIDRs permitidos. Si se activa, login desde IP no listada → bloqueo + alerta.
- **Re-autenticación para acciones críticas**: aunque ya esté logueado, exige password + 2FA fresco antes de ejecutar:
  - Mint / Burn de fichas
  - Editar comisión de un Socio
  - Aprobar payout grande
  - Ver KYC docs de un usuario
  - Exportar PII / dump de datos
  - Cambiar 2FA o password de otro usuario
  - Conectar / desconectar CRM o payment provider
  - Modificar `tenant_settings` críticos
- **Session timeout** por inactividad: 15 min en panel privilegiado, 1h en panel operativo, 24h en sitio jugador.
- **Detección de impossible travel**: login en BA y 5 min después en Madrid → bloqueo + 2FA challenge + alerta.
- **Detección de device nuevo**: primer login desde un device fingerprint nunca visto → 2FA challenge obligatorio + email "Nuevo dispositivo accedió a tu cuenta".
- **Audit log enriquecido**: cada login privilegiado registra IP, geo (vía MaxMind GeoIP), device fingerprint, user agent.

### 3.2 Recovery de cuenta privilegiada

| Rol | Cómo se recupera |
|---|---|
| Jugador | Reset por email automático |
| Cajero / Distribuidor / Empleado | Reset solicitado al superior, con auditoría |
| Socio | Reset solicitado al Admin Tenant, con auditoría |
| Admin Tenant | Reset solicitado al Super-Admin (vos) por canal externo (videollamada de verificación de identidad) |
| Super-Admin | Procedimiento manual con custodia compartida (ver §17) |

---

## 4. Two-Factor Authentication (2FA)

### 4.1 Métodos soportados (MVP)

- **TOTP** — Google Authenticator, Authy, 1Password, etc. Estándar, gratis, sin dependencias externas.
- **Email codes** — código de 6 dígitos por email, vida 5 min, 1 uso.

> Sin SMS (caro, vulnerable a SIM swap). Sin recovery codes (decisión cerrada — se compensa con flujo de recovery del §3.2).

### 4.2 Roles obligatorios

| Rol | 2FA |
|---|---|
| Super-Admin | **Obligatorio** |
| Admin Tenant | **Obligatorio** |
| Socio | **Obligatorio** |
| Distribuidor | **Obligatorio** |
| Cajero | **Obligatorio** |
| Empleado | **Obligatorio** |
| Jugador | Opcional |

### 4.3 Flujo de activación

1. Usuario va a "Seguridad" en su panel.
2. Sistema genera secret + QR + URL otpauth.
3. Usuario escanea con su app TOTP.
4. Usuario ingresa primer código → si valida, 2FA queda activo.
5. `users.two_fa_secret` cifrado con `pgcrypto` en DB.
6. Audit log: "2FA activado".

### 4.4 Flujo de uso

1. Login normal con username + password.
2. Si 2FA activo → pantalla intermedia pidiendo código TOTP.
3. Validación contra el secret guardado.
4. Si fallido → 5 intentos antes de bloqueo de 5 min.
5. Si exitoso → JWT emitido.
6. Usuario puede marcar "este dispositivo es de confianza por 30 días" (skip 2FA en ese device hasta vencer).

### 4.5 Email code como fallback

Si el usuario perdió acceso a su app TOTP:
- En la pantalla de 2FA, link "No tengo acceso a mi app".
- Sistema envía código de 6 dígitos por email.
- Validación con TTL 5 min.
- Si exitoso → loguea + flag `two_fa_email_fallback_used`. Notificación a soporte si se usa frecuentemente (señal de problema).

### 4.6 Reset de 2FA

- Jugador: vía link de email automático (con verificación adicional: pregunta secreta o validación de comprobante de pago previo).
- Operador: ver §3.2.
- Audit log siempre, severidad alta.

---

## 5. KYC (configurable por tenant, default `none`)

> El Admin Tenant puede activar KYC desde `tenant_settings.kyc_level`. La arquitectura lo soporta aunque MVP default es `none`.

### 5.1 Niveles

- **`none`** (default MVP): sin verificación. El usuario se registra con username + password y juega. Solo declaración de mayoría de edad (checkbox).
- **`basic`**: verificación de email + teléfono. Sistema envía link/código que el usuario debe activar antes de poder depositar/retirar.
- **`full`**: documento (DNI/CUIT) + selfie + comprobante de domicilio. Subida desde el panel del jugador. Revisión manual por humano del tenant.

### 5.2 Cuándo se exige (configurable)

`tenant_settings.kyc_required_at`:
- `at_signup`
- `before_first_deposit`
- `before_first_withdrawal` (más común)
- `over_threshold` (configurable: ej. cuando lifetime depósitos > X o lifetime retiros > Y)

### 5.3 Modelo de datos

```sql
kyc_submissions
  id, user_id, level enum('basic','full'),
  status enum('pending','under_review','approved','rejected','expired'),
  submitted_at, reviewed_by, reviewed_at,
  rejection_reason text nullable,
  expires_at timestamptz nullable     -- KYC vence cada N años (configurable)

kyc_documents
  id, submission_id,
  doc_type enum('id_front','id_back','selfie','proof_of_address','other'),
  file_url text                       -- en S3, cifrado server-side
  file_hash text,
  uploaded_at
```

### 5.4 Storage

- Documentos en S3-compatible con cifrado server-side (SSE).
- URLs firmadas de vida corta (15 min) cuando el revisor los abre.
- Acceso solo con permiso `kyc.review` + auditoría.
- Nunca se loguea contenido del documento.

### 5.5 Revisión

- **Manual en MVP**: humano del tenant ve documentos en panel, aprueba/rechaza con motivo.
- **v2**: integración con Veriff / SumSub / Persona para verificación automática.

### 5.6 Permisos

- `kyc.submit` — usuario sube sus docs.
- `kyc.review` — operador revisa.
- `kyc.approve` / `kyc.reject`.
- `kyc.view_docs` — abrir documentos (audited).

---

## 6. Juego responsable

Aunque MVP no esté regulado, herramientas básicas implementadas. Buena reputación + cobertura legal futura.

### 6.1 Herramientas (MVP)

- **Verificación de edad**: checkbox obligatorio "Soy mayor de 18" al registrarse. **Sin verificación de DNI** (a menos que se active KYC `full`). Configurable mínimo (18/21) por tenant.
- **Auto-exclusión**:
  - Temporal: 1 día / 1 semana / 1 mes / 6 meses.
  - Permanente.
  - Una vez activada, no reversible hasta vencer (no hay "yo me arrepiento, sacame el bloqueo").
  - Bloquea login + bloquea recepción de bonos automáticos + comunicaciones de marketing.
- **Límites configurables por jugador**:
  - Depósito máximo (diario / semanal / mensual).
  - Apuesta máxima por round.
  - Pérdida máxima en período (cuando se alcanza, se autoexcluye temporalmente hasta el corte siguiente).
- **Cool-off period**: el jugador se da break de N días (1, 7, 30). No puede depositar ni jugar; sí ver su cuenta y retirar.

### 6.2 Herramientas (v2)

- **Reality checks**: popup cada N minutos jugando con stats de la sesión + opción "seguir / parar".
- **Sesión máxima** auto-corte tras X horas.
- **Cuestionario de juego problema** opcional (PGSI corto).

### 6.3 Modelo de datos

```sql
responsible_gaming_settings (singleton por usuario)
  user_id PK,
  deposit_limit_daily, deposit_limit_weekly, deposit_limit_monthly,
  bet_limit_per_round, loss_limit_period numeric,
  loss_limit_period_unit enum('day','week','month'),
  age_confirmed_at, age_confirmed_min int,
  updated_at

self_exclusions
  id, user_id,
  type enum('cool_off','temporary','permanent'),
  starts_at, ends_at nullable,
  reason text nullable,
  created_at, status enum('active','expired','revoked')
```

### 6.4 Validaciones en runtime

- Antes de cada depósito: chequear `responsible_gaming_settings.deposit_limit_*` → si excede, rechazo.
- Antes de cada bet: chequear `bet_limit_per_round` → si excede, rechazo.
- Tras cada round perdido: acumular `loss_in_period`, comparar con `loss_limit_period`. Si supera → auto-exclusión temporal.
- Antes de cada login: chequear `self_exclusions.active`. Si match → rechazo.

### 6.5 Permisos

- `responsible_gaming.self_set` — usuario configura sus propios límites.
- `responsible_gaming.admin_set` — admin tenant configura mínimos del tenant.
- `responsible_gaming.review` — ver casos de auto-exclusión.

---

## 7. Secrets management

### 7.1 Decisión: **Infisical**

- Open source, self-hosted en VPS de la plataforma.
- Plan free generoso, escala.
- Integra bien con Next.js / NestJS (SDK + CLI + Docker secrets).
- Ambientes separados (dev / staging / prod).
- Audit log de accesos a secrets.

### 7.2 Qué guarda

- Database credentials (per-tenant + control plane).
- JWT signing keys (per-tenant si rotamos keys por aislamiento).
- API keys: game providers, Kommo, S3, Infisical mismo, etc.
- 2FA service keys.
- Webhook secrets (HMAC).
- Encryption keys para `pgcrypto`.

### 7.3 Acceso desde código

- Apps consumen secrets vía SDK Infisical en runtime.
- Refresh automático sin restart si se actualizan.
- Sin secrets hardcoded ni en `.env` chequeados al repo.
- Pre-commit hook + CI scan: rechazo de commits con patrones de secrets (gitleaks / trufflehog).

### 7.4 Rotación

- Política mensual de rotación de keys críticas.
- Automatizada vía script + Infisical.

---

## 8. Cifrado

### 8.1 En tránsito

- **TLS obligatorio en todos los entornos** (incluido staging).
- Let's Encrypt vía Caddy / Coolify para certificados auto-renovables.
- HTTP redirect → HTTPS forzado.
- HSTS habilitado con `max-age=31536000; includeSubDomains; preload`.

### 8.2 En reposo

#### Postgres
- **Cifrado a nivel disco** (file system / cloud provider).
- **Cifrado a nivel columna** con `pgcrypto` para datos hipersensibles:
  - `users.two_fa_secret`
  - `users.password_hash` (Argon2id ya es one-way, pero columna en tabla protegida)
  - `kyc_documents.file_url` (los archivos están cifrados en S3, igual cifra el path)
  - `withdrawals.target_account` (CBU, alias, wallet cripto)
  - `crm_configs.credentials` (tokens OAuth)
  - `tenant_provider_configs.credentials`

#### S3
- **Server-side encryption** (SSE-S3 o SSE-KMS).
- Bucket policies estrictas.
- Versionado activado.
- Lifecycle: comprobantes/KYC → glacier después de N años.

### 8.3 Backups

- Cifrados antes de salir del cluster.
- Clave de backup separada de claves de runtime.

---

## 9. Rate limiting

Implementación: middleware Redis-backed + token bucket por endpoint.

### 9.1 Tabla de límites

| Endpoint / acción | Límite |
|---|---|
| Login | 5 intentos / IP / 15 min |
| Login (post-bloqueo) | Captcha obligatorio por 1h |
| Registro | 3 / IP / hora |
| Solicitar reset password | 3 / cuenta / hora |
| Búsqueda en panel | 15 / usuario / min |
| Cargar fichas (cajero) | **Sin rate limit** — el saldo del cajero es el constraint natural |
| Solicitar depósito | **Sin rate limit por hora** — pero **máximo 2 depósitos pendientes simultáneos** por usuario (ver §10) |
| Solicitar retiro | **Sin rate limit por hora** — pero **máximo 2 retiros pendientes simultáneos** por usuario |
| API pública (provider wallet) | 100 / sesión / min — alto pero monitoreado, alerta si se aproxima |
| Webhooks entrantes | Sin límite, pero firma HMAC + IP whitelist |
| Cualquier otro endpoint autenticado | 60 / usuario / min default |

### 9.2 Respuesta al exceder

- HTTP 429 con header `Retry-After`.
- Mensaje claro al usuario sobre el motivo.
- Audit log si el endpoint es sensible.
- Alerta automática a soporte si un usuario supera límites repetidamente (puede ser ataque o bug del cliente).

---

## 10. Concurrencia operativa (max pending)

En lugar de rate limit por hora, **límites de concurrencia** para depósitos y retiros (más natural para UX y seguridad).

### 10.1 Depósitos

- Un usuario **no puede tener más de 2 solicitudes de depósito simultáneamente** en estado `pending` o `under_review`.
- Si intenta crear una 3ra → rechazo `409 TOO_MANY_PENDING_DEPOSITS` con mensaje "Cancelá o esperá la resolución de las anteriores".
- Sin tope diario (puede hacer N depósitos al día siempre que no más de 2 estén pending al mismo tiempo).
- Configurable por tenant (default 2).

### 10.2 Retiros

- Mismo principio: **máximo 2 solicitudes en estado `pending` o `approved` (no pagadas aún)** simultáneamente.
- Si intenta crear una 3ra → rechazo.
- Sin tope diario.
- Configurable por tenant (default 2).

### 10.3 Cargas del cajero (solo cajero INDEPENDIENTE, R4)

> Este mecanismo de **saldo/stock propio como constraint** aplica **solo al cajero INDEPENDIENTE**, que banca con su propio stock (R4). El **cajero DEPENDIENTE no tiene saldo operativo ni carga fichas** (R3): la plata central la mueven el admin + sus empleados. Para el dependiente esta sección **no aplica**.

- **Sin límite de cantidad ni frecuencia** — el cajero independiente opera con su **stock propio**, eso es el constraint.
- Validación: cada carga descuenta de `wallet.balance` (stock) del cajero. Si insuficiente → rechazo; para seguir cargando, **compra más fichas a su padre directo** (paga primero, sin crédito, R4).
- Auditoría exhaustiva (ver `docs/05-flujos-fichas.md §3`).

---

## 11. Anti-fraude transversal

Más allá de los específicos de promos (`docs/15-engagement-promos.md §D`) y referidos (`docs/09-publicidad-referidos.md §8`).

### 11.1 Señales en MVP

- **Nuevo dispositivo / ubicación** al login → email + 2FA challenge si aplica.
- **Imposible travel**: login desde dos ubicaciones geográficamente imposibles en el tiempo transcurrido → bloqueo + alerta.
- **Account takeover detection**: combinación sospechosa (cambio de password + cambio de método de pago + retiro grande inmediato dentro de X horas) → hold automático del retiro + alerta.
- **Bot detection en registros**: Cloudflare Turnstile o hCaptcha invisible al registrarse. Si score bajo → captcha visible.
- **Velocity checks en depósitos**: > N depósitos en X minutos desde misma IP/device → flag.
- **Mismo método de pago en múltiples cuentas**: misma CBU / wallet cripto registrada en N usuarios → flag de cluster (alimenta `fraud_account_links`).
- **Retiros sospechosos**:
  - Retiro a cuenta nunca usada antes (default: hold + verificación si > umbral).
  - Cambio de método de pago seguido de retiro grande.

### 11.2 Acciones automáticas

| Severidad | Acción |
|---|---|
| `info` | Solo log + `fraud_signals` |
| `warn` | Flag visible en panel, no bloquea |
| `block` | Hold de la operación, requiere review manual |

### 11.3 Panel "Anti-fraude"

Ya descripto en `docs/15-engagement-promos.md §D4`. Mismo panel cubre:
- Clusters de cuentas duplicadas.
- Atribuciones flageadas.
- Account takeovers detectados.
- Retiros en hold.
- Velocity alerts.
- Bots detectados.

---

## 12. Geofencing y edad

### 12.1 Geofencing

- **Configurable por tenant** desde `tenant_settings.allowed_countries` / `blocked_countries`.
- Detección vía MaxMind GeoIP del IP del request.
- Sin bloqueos default a nivel plataforma.
- Bloqueo: 403 con landing explicativa.
- VPN detection: opcional, configurable. Por default desactivado (mucho falso positivo).

### 12.2 Verificación de edad

- **Solo checkbox** al registrarse: *"Confirmo que soy mayor de 18 años"*. Obligatorio.
- Edad mínima configurable por tenant (default 18, opcionalmente 21).
- **Sin verificación con DNI** salvo que el tenant active KYC `full`.
- Declaración registrada con timestamp + IP + user agent (defensa legal).

---

## 13. Backups y disaster recovery

### 13.1 Postgres (cada tenant DB + DB de control)

- **Backups completos diarios** (3 AM hora del tenant).
- **Incrementales horarios** vía WAL archiving.
- **Retención**:
  - 30 días en hot storage (acceso rápido).
  - 1 año en cold storage (archive).
- **Off-site**: replicación a otro provider (cross-cloud) para resiliencia ante caída de provider entero.
- **Test de restore mensual**: job automático que toma backup random, lo restaura en ambiente aislado, valida queries básicas, reporta resultado.

### 13.2 S3 (storage)

- Versionado activado.
- Replicación cross-region.
- Lifecycle: comprobantes / KYC → glacier después de 2 años.

### 13.3 Redis

- Persistencia AOF + snapshots cada 5 min.
- Datos críticos no viven solo en Redis (es cache); rebuildable desde Postgres si se pierde.

### 13.4 RTO / RPO objetivo

- **RTO** (recovery time objective): 4h para incidente mayor.
- **RPO** (recovery point objective): 1h máximo de datos perdidos.

### 13.5 Runbook de recuperación

Documento separado (`docs/runbooks/disaster-recovery.md` cuando se implemente) con pasos exactos.

---

## 14. Logging y retención

### 14.1 Streams separados

| Stream | Contenido | Retención |
|---|---|---|
| **App logs** (Pino) | Logs estructurados de la app. Errors, warnings, info. | 30 días |
| **Audit log** (`audit_log` Postgres) | Acciones sensibles del usuario | 2 años (configurable por tenant) |
| **Security log** | Login attempts, 2FA, password changes, IP whitelist hits, rate limit blocks | **5 años** |
| **Access log** (HTTP) | Requests crudos al backend | 90 días |
| **Game rounds** (`wallet_transactions`) | Trazabilidad de juego | Indefinida (archivable a cold después de 2 años) |

Pino → Loki/Grafana para búsqueda.

### 14.2 Redacción de PII

Helper `sanitize()` que limpia campos sensibles antes de loggear:
- Emails: `j***@***.com`
- DNIs: `**.***.123`
- CBUs: últimos 4 dígitos
- Passwords / tokens / 2FA secrets: `[REDACTED]`
- Comprobantes / archivos: solo nombre redacted, nunca contenido

Aplicado en middleware. Lint rule: `no-console.log(req.body)` directo.

### 14.3 Logs centralizados

- Loki (logs) + Prometheus (métricas) + Grafana (dashboards).
- Alertas automáticas configuradas para:
  - Spike de errores (> X 5xx en N min).
  - Fallos de auth concentrados (> X 401 desde misma IP).
  - Caída de servicios (provider, CRM, Redis, Postgres).
  - Rate limit hits anómalos.

---

## 15. Permisos de seguridad

| Acción | Permiso atómico | Quién por default |
|---|---|---|
| Suspender / banear usuarios | `users.ban` | Admin Tenant + designados + **Cajero (sobre sus jugadores)** — gestión completa de su cartera, con scope a su sub-red (R2/P1) |
| Reset 2FA de un usuario | `users.reset_2fa` | Admin Tenant + Socio (su red) |
| Reset password de otro usuario | `users.reset_password` | Admin Tenant + Socio (su red) + Cajero (sus jugadores) |
| Ver audit log | `audit.view` | Admin Tenant + auditores |
| Exportar audit log | `audit.export` | Solo Admin Tenant + 2FA fresco |
| Exportar PII (data dump del usuario) | `users.export_pii` | Solo Admin Tenant + 2FA + razón obligatoria |
| Ver KYC docs | `kyc.view_docs` | Operadores con `kyc.review` |
| Aprobar retiros sobre umbral | `withdrawals.approve_large` | Admin Tenant |
| Configurar IP whitelist del tenant | `tenant.security.ip_whitelist` | Admin Tenant |
| Configurar reglas antifraude | `tenant.security.fraud_rules` | Admin Tenant |
| Ver / modificar `tenant_settings.kyc_*` | `tenant.settings.kyc` | Admin Tenant |

Todos los marcados como Admin Tenant **no son delegables** (`is_delegatable = false` en el catálogo).

---

## 16. Compliance básico

Aunque MVP opera informal en Argentina, la base soporta esto para cuando llegue:

### 16.1 Ley 25.326 (Protección de Datos Personales — Argentina)

Principios respetados desde MVP:

- **Consentimiento explícito**: checkbox al registrarse para tratamiento de datos.
- **Data minimization**: solo recolectamos lo que necesitamos para operar.
- **Right to access**: el jugador puede pedir y recibir su data completa (export auto desde su panel: profile + transactions + audit relevant + KYC docs).
- **Right to rectification**: el jugador puede editar sus datos personales desde su panel.
- **Right to delete**: el jugador puede pedir baja de cuenta. Implementación:
  - Anonimización de PII (nombre → "Usuario eliminado", email → null, teléfono → null).
  - Histórico financiero **no se borra** (obligación contable + AML).
  - Audit log queda; se anota baja con motivo.
- **Notificación de breach**: si hay incidente, se notifica a usuarios afectados dentro de 72h.

### 16.2 AML básico (anti-money laundering)

- Detección de patrones de lavado: depósitos → mínima actividad → retiro a cuenta distinta.
- Threshold reporting: operaciones > umbral generan reporte automático para el Admin Tenant (no se envía a regulador, queda almacenado).
- Multi-cuenta detection (ya cubierto §11 + `15-engagement-promos.md §D`).
- KYC `full` cuando se activa permite armar reportes formales.

### 16.3 Reportes regulatorios on-demand

Aunque no estés regulado, dejamos preparado:
- Reporte de operaciones > umbral por usuario / período.
- Reporte de KYC vigentes / pendientes.
- Reporte de auto-exclusiones.
- Export de audit log para auditoría externa.
- GGR / NGR / payouts por período.

Disponibles desde `Reportes → Compliance` en el panel del Admin Tenant.

---

## 17. Incident response básico

### 17.1 Severidades

| Sev | Ejemplo | Tiempo de respuesta |
|---|---|---|
| **SEV-1** | Wallet inconsistente, breach activo, downtime total | 15 min |
| **SEV-2** | Provider externo caído, login degradado | 1h |
| **SEV-3** | Bug funcional sin pérdida de datos | 24h |
| **SEV-4** | Mejoras / no urgente | sprint |

### 17.2 Runbook básico

Cuando se detecta incidente:
1. **Identificar** severidad.
2. **Contener**: dejar el sistema en estado seguro (pausa de provider, kill-switch de promo, etc.).
3. **Comunicar**: al super-admin / Admin Tenant / usuarios afectados según escala.
4. **Investigar**: usar audit log + logs de seguridad.
5. **Remediar**: fix.
6. **Postmortem**: doc con causa raíz, prevención, lecciones (en `docs/postmortems/` cuando se implemente).

### 17.3 Custodia compartida del Super-Admin

Para no quedar locked-out de la plataforma:
- 2-de-3 split de credenciales del super-admin (Shamir Secret Sharing) entre 3 personas de confianza.
- Backup en custodia física (papel sellado).
- Documentado en `docs/runbooks/super-admin-recovery.md` cuando se implemente (no acá por seguridad).

---

## 18. Pendientes / a definir al implementar

- **Provider de SMS** si se decide sumarlo en v2 (Twilio, Vonage, AWS SNS).
- **GeoIP DB**: MaxMind GeoLite2 (gratis) vs versión paga.
- **Captcha**: Cloudflare Turnstile (gratis, sin tracking) vs hCaptcha vs reCAPTCHA.
- **Provider KYC** (Veriff / SumSub / Persona) cuando se quiera v2.
- **WAF** (Cloudflare / AWS WAF) frente a la app — recomendado en producción.
- **DDOS mitigation**: Cloudflare en frente, fácil.
- **Penetration testing**: contratar pentest externo previo a primera operación con tenant real.
- **Bug bounty**: programa público en HackerOne / Intigriti cuando madure el producto.
- **SOC 2 / ISO 27001**: proceso largo, solo si un cliente top lo exige.
- **Política de password rotation** para roles privilegiados (¿obligamos rotar cada N días? Discutible).
- **MFA hardware** (YubiKey) opcional para super-admin — v2.
- **Anonymización avanzada** (k-anonymity en exports) cuando crezca el data warehouse.
