# 09 · Publicidad y Referidos

> Estado: **decidido en estructura**. Detalles operativos (umbrales, comisiones default) se afinan al implementar.

Define cómo los Socios captan jugadores, cómo se atribuye cada conversión, cómo se calcula y paga la comisión, y cómo se previenen los fraudes específicos de referidos.

---

## 1. Principios

1. **Last-touch attribution**, ventana de 90 días. El último link clickeado antes del registro gana.
2. **Tráfico orgánico va al "Socio madre"** = Admin Tenant. Cualquier usuario que se registra sin código se atribuye al tenant directo.
3. **Comisión = % NGR** del referido (no CPA fijo). Configurable por Socio en su contrato.
4. **El creador paga sus bonos**. Si un Socio activa un bono en su link, las fichas salen de su saldo. Ver `docs/15-engagement-promos.md §0`.
5. **MVP: links + cupones + bono asociado + UTMs + QR**. Landing pages custom y multi-touch attribution → v2.
6. **Sin biblioteca de creativos** integrada. Cada Socio gestiona su material por fuera.
7. **Pagos solo en fichas internas**. Para cobrar en fiat el Socio usa el flujo de "Solicitud de retiro de comisiones".
8. **Antifraude reusa el sistema transversal** de `docs/15-engagement-promos.md §D` + reglas específicas (este doc §6).
9. **Sin MLM** en MVP (sin múltiples niveles de revenue share). Abierto a v2 si el negocio lo pide.

---

## 2. Estructura de links y códigos

### 2.1 Múltiples por Socio

Cada Socio puede generar la cantidad de links que quiera. Cada uno con su propio tracking:
- Distintos canales (WhatsApp, IG, FB, X, Tiktok, email).
- Distintas campañas (lanzamiento, retención, evento puntual).
- Distintas configuraciones (con o sin bono asociado, distintos UTMs).

### 2.2 Formato de URL

Decisión: **path con código + slug custom opcional**. Es lo más barato de mantener.

```
casino.com/r/JUAN123              ← código auto-generado (default)
casino.com/r/juan-vip             ← slug custom (si el Socio lo elige y está disponible)
```

**Por qué no subdominio** (`juan.casino.com`): requiere wildcard SSL + DNS por Socio + costos por dominio. Para v2 si un Socio grande lo pide.

### 2.3 Configuración de cada link

```sql
referral_codes
  id                       uuid PK
  owner_user_id            uuid FK users(id)        -- el Socio
  code                     text unique              -- 'JUAN123' o 'juan-vip'
  is_custom_slug           bool
  channel                  text nullable            -- 'whatsapp','instagram','facebook','tiktok','google_ads','offline','other'
  campaign_label           text nullable            -- nombre libre del Socio
  landing_path             text default '/'         -- a dónde redirige (default home)
  bonus_at_signup          jsonb nullable           -- bono al referido (tipo, monto, condición)
  utm_overrides            jsonb nullable           -- UTMs custom forzados sobre el click
  is_active                bool default true
  expires_at               timestamptz nullable
  total_clicks             int default 0            -- contador desnormalizado
  total_signups            int default 0
  total_ftds               int default 0
  created_at, updated_at
```

### 2.4 QR codes

Cada link expone un endpoint `/r/<code>?qr=1` que devuelve un QR PNG/SVG con el link encodeado. El Socio descarga el QR para flyers físicos / publicidad offline. **El click trackea igual** porque la URL final es la misma.

### 2.5 Cupones (códigos manuales al registrarse)

El usuario que llega sin click pero al registrarse mete *"Tengo código de referido: JUAN123"*:
- Sistema valida el código y lo atribuye igual que si hubiera clickeado.
- Pasa por las mismas defensas antifraude (D1 device/IP).
- Mismo `referral_attributions` con `attribution_method = 'manual_code'` vs `'click'`.

---

## 3. Atribución

### 3.1 Last-touch, 90 días

Cuando un usuario clickea un link de referido:
1. Sistema setea cookie `ref_attr` con `{code_id, clicked_at}` y TTL 90 días.
2. Si clickea otro link de referido después → la cookie se sobreescribe (last-touch).
3. Al registrarse: se lee la cookie → se crea fila en `referral_attributions`.
4. Si la cookie no existe pero el usuario mete un código manual → atribución por código.
5. Si nada de lo anterior → atribución a **Admin Tenant** (Socio madre).

### 3.2 Cross-device

No tracking entre dispositivos sin login. Lo asumimos: el usuario que clickea en mobile y se registra en desktop sin loguearse, se pierde la atribución. La UI recuerda al usuario en el flujo de registro: *"¿Tenés un código de referido?"*.

### 3.3 Tabla de atribución

```sql
referral_attributions
  id                        uuid PK
  user_id                   uuid FK users(id) unique  -- una atribución por usuario
  referral_code_id          uuid FK referral_codes nullable    -- nullable si va al Socio madre
  socio_id                  uuid FK users(id)                  -- denormalizado para queries rápidas
  is_socio_madre            bool                               -- true cuando va al Admin Tenant
  attribution_method        enum('click','manual_code','auto_madre')
  attributed_at             timestamptz

  -- Datos del touch
  first_touch_url           text nullable
  last_touch_url            text nullable
  utm                       jsonb nullable
  click_ip                  inet nullable
  click_device_fingerprint  text nullable
  click_user_agent          text nullable

  -- Datos del registro
  registration_ip           inet
  registration_device_fingerprint text
  registration_user_agent   text

  -- Validación
  validation_status         enum('valid','flagged','invalidated')
  validation_flags          jsonb default []
```

### 3.4 Tabla de validation flags

```sql
referral_validation_flags
  id, attribution_id FK,
  flag_type            enum('same_device','same_ip','rapid_signups',
                            'bot_signature','self_referral','cluster_match')
  severity             enum('info','warn','block')
  detected_at, payload jsonb,
  resolution           enum('pending','confirmed_fraud','dismissed') default 'pending'
  reviewed_by, reviewed_at, resolution_notes
```

---

## 4. Comisión y revenue share

### 4.1 Modelo

**% sobre el NGR** generado por los referidos del Socio. NGR calculado igual que para la comisión del super-admin (ver `docs/04-modelo-datos.md §5.bis`), pero acotado a la actividad de los referidos del Socio.

```
NGR_referidos_socio = Σ NGR de cada usuario en referral_attributions WHERE socio_id = X
                      AND (validation_status = 'valid')
                      AND período = P

Comisión_socio = NGR_referidos_socio × commission_pct_socio
```

### 4.2 Configuración del % por Socio

Cada Socio tiene un `socio_commission_settings` configurado en su contrato (override individual sobre el default del tenant):

```sql
socio_commission_settings
  socio_user_id uuid PK FK users(id)
  commission_pct numeric(5,4)         -- ej 0.3000 = 30%
  carryover_negative bool default true
  payout_period enum('daily','weekly','monthly') default 'monthly'
  payout_day_of_period int           -- ej. día 1 si monthly
  min_payout_amount numeric(20,2)    -- monto mínimo para liquidar
  active_from timestamptz, active_until timestamptz nullable
  created_by, updated_by, updated_at
```

Sin MLM: la comisión va exclusivamente al Socio referente directo. Nada de cobertura piramidal en MVP.

### 4.3 Carryover de mes negativo

Si en un período el NGR de los referidos del Socio es negativo (los referidos ganaron más que perdieron globalmente), el Socio **no cobra** y la **deuda queda registrada** en `socio_commission_balance`. Se compensa contra el próximo período positivo hasta saldarse.

```sql
socio_commission_balance
  socio_user_id uuid PK
  cumulative_owed_to_socio numeric(20,2)    -- positivo = el tenant le debe
  cumulative_owed_by_socio numeric(20,2)    -- positivo = el socio "debe" (carryover)
  last_settled_period text                   -- '2026-04'
  updated_at
```

### 4.4 Cierre de período

Job programado por tenant:
1. Para cada Socio con `socio_commission_settings.active = true`:
   - Calcula NGR del período de sus referidos válidos.
   - Aplica % de comisión.
   - Suma carryover negativo si lo hay.
   - Si resultado > `min_payout_amount` → genera entrada en `socio_commissions`.
2. Snapshot inmutable.
3. Notificación al Socio + Admin Tenant.

```sql
socio_commissions
  id, socio_user_id, period text,
  ngr_total numeric, commission_pct numeric,
  gross_amount numeric, carryover_applied numeric, net_amount numeric,
  status enum('pending_review','approved','paid','disputed','reversed')
  approved_by, approved_at,
  payout_wallet_tx_id uuid nullable,
  notes text, created_at
```

### 4.5 Pago al Socio

Al aprobarse (manual o automático según política del tenant):
1. **Tx wallet**: `commission_payout` desde Admin Tenant (mintea si hace falta) → wallet del Socio.
2. Estado de `socio_commissions` pasa a `paid`.
3. Auditoría completa.

> Importante: la comisión se paga **en fichas a la wallet del Socio**, no en fiat. Para fiat, ver §7.

### 4.6 Aprobación manual de payouts grandes (D9)

Si `gross_amount > umbral configurable`, el payout queda en `pending_review` y requiere aprobación explícita del Admin Tenant (con 2FA). Sin aprobación, no se libera.

---

## 5. Tipos de campaña (MVP)

| Tipo | Descripción | Implementación |
|---|---|---|
| **Orgánico** | Link que el Socio comparte por chat/redes. | Default. Cualquier `referral_code`. |
| **Cupón** | Código tipeado al registrarse. | Mismo `referral_code` aceptado por input manual. |
| **Bono asociado** | El link otorga bono al registrarse o al primer depósito. | `referral_codes.bonus_at_signup` configurado. Funder = Socio. |
| **Campaña paga con UTMs** | El Socio mete plata en FB/Google Ads y trackea. | `referral_codes.utm_overrides` + reportes filtrados por UTM. |
| **QR offline** | Para flyers / publicidad física. | Endpoint `/r/<code>?qr=1` genera PNG/SVG. |

Landing pages custom → v2.

---

## 6. Bonos asociados al link (regla "el creador paga")

Cuando el Socio activa un bono en su link, **las fichas salen de su propia wallet**. Reglas:

### 6.1 Bono al referido (al registrarse o al primer depósito)

Configurado en `referral_codes.bonus_at_signup`:
```jsonc
{
  "type": "no_deposit" | "match_first_deposit" | "free_spins",
  "amount_chips": 50,
  "wagering_multiplier": 20,
  "max_uses": 100,                  // tope de cuántos pueden cobrarlo (opcional)
  "expires_at": "2026-12-31",       // tope temporal (opcional)
  "max_total_funded": 5000          // tope total de fichas a gastar (opcional)
}
```

Reglas duras (defensas D3 + D6 + D5):

- **Al registrarse**: si tipo es `no_deposit`, **NO se otorga inmediatamente**. Se otorga **después de que el referido haya hecho un depósito autoservicio aprobado + apostado mínimo X fichas reales**. Esto neutraliza bonus farming.
- **Cuando se otorga**: tx en cadena: `transfer_out` desde Socio → `bonus_grant` al referido (locked balance del referido). `funded_by_user_id = socio_id`.
- **Si el Socio se queda sin saldo**: el link **se desactiva auto** y se notifica al Socio. Reactivable cuando recargue.
- **Si el bono se cancela / forfeit**: las fichas vuelven al Socio (`transfer_in` desde locked del referido).
- **Rate limiting**: máximo N bonos otorgados por hora por link (configurable). Más → cola de revisión manual.

### 6.2 Bono al referente (al Socio cuando su referido hace FTD)

Configurado a nivel tenant (Admin Tenant lo define):
```jsonc
{
  "amount_chips": 200,
  "trigger": "ftd_real",            // solo FTD vía depósito autoservicio
  "minimum_deposit_chips": 1000,
  "minimum_apostado_chips": 500     // referido debe haber apostado X antes
}
```

- **Funder = Admin Tenant** (paga el tenant, no el Socio).
- **Solo se otorga tras FTD autoservicio real** (D6) — nunca por carga manual del cajero, para evitar simulación.
- Tx: `mint` (Admin Tenant) → `bonus_grant` al Socio. Auditado.

---

## 7. Solicitud de retiro de comisiones del Socio (a fiat)

Módulo separado del retiro normal de jugador. El Socio puede pedir convertir parte de su saldo de fichas a fiat para cobrar real.

### 7.1 Flujo

```
1. Socio ingresa a "Mis comisiones" → "Solicitar retiro"
2. Ingresa: monto en fichas, método (transferencia / cripto), datos
3. Crea socio_payout_requests.status='pending'
4. Las fichas entran a wallet_holds del Socio (no las puede gastar)
5. Admin Tenant ve la solicitud en su panel "Solicitudes de payout de Socios"
6. Admin Tenant:
   a. Aprueba: status='approved', se procesa pago externo
   b. Rechaza: status='rejected', release de hold (con motivo)
7. Pagador externo (humano o auto cripto) realiza la transferencia
8. Marca 'paid' con external_ref
9. Tx wallet: 'withdrawal' sobre Socio, hold liberado
```

### 7.2 Tabla

```sql
socio_payout_requests
  id, socio_user_id, amount_chips, amount_fiat, currency_fiat,
  method_id FK payment_methods, target_account jsonb,
  status enum('pending','approved','rejected','processing','paid','failed')
  hold_id FK wallet_holds,
  reviewed_by, reviewed_at, rejection_reason,
  paid_external_ref, paid_at,
  created_at, updated_at
```

### 7.3 Reglas

- Mínimo y máximo configurables por tenant.
- Solicitud requiere que la comisión esté `paid` (en wallet del Socio), no `pending_review`.
- Auditoría completa.
- Notificación a soporte si tarda > X tiempo en aprobarse.

---

## 8. Defensas antifraude activas

### 8.1 D1 — Bloqueo por device/IP compartida

Al registrarse un usuario con atribución a Socio X:
- Sistema busca si el `device_fingerprint` o `IP` (clase /24 para IPv4) coincide con cuentas existentes vinculadas al Socio X (incluido el propio Socio).
- Match → `referral_validation_flags` con `flag_type='same_device'` o `'same_ip'`, severity=`block`.
- Atribución pasa a `validation_status='flagged'`.
- Cuenta sigue funcionando, pero **no entra al cálculo de NGR_referidos_socio**.
- Admin Tenant ve el flag en panel "Atribuciones sospechosas" y puede confirmar (`invalidated`) o descartar (`valid`).

### 8.2 D3 — Bonos al referido condicionales

Ya descrito en §6.1. Bono `no_deposit` no se otorga sino tras FTD real + apuesta mínima.

### 8.3 D5 — Rate limit de referidos nuevos

- Default: máximo 10 registros nuevos por Socio por hora (configurable).
- Excedido → registros siguientes entran a `referral_attributions.validation_status='flagged'`, queda en cola de revisión manual.
- Notificación automática al Admin Tenant: *"Socio X superó el límite de captación, revisar"*.

### 8.4 D6 — Bono al referente solo tras FTD autoservicio

Ya descrito en §6.2. El bono al Socio nunca se dispara por carga manual del cajero, solo por flujo autoservicio del jugador con comprobante.

### 8.5 D7 — Panel "Socios sospechosos"

Listado automático en panel del Admin Tenant con Socios que cumplen señales:
- Ratio click/registro fuera del rango razonable (< 1% o > 30%).
- Ratio registro/FTD muy bajo (< 5% sostenido).
- % alto de atribuciones con `validation_status='flagged'`.
- Patrón de actividad uniforme entre referidos (mismo horario, mismos juegos).
- Concentración geográfica anómala.

Cada Socio listado tiene drill-down a detalle.

### 8.6 D8 — Métricas de calidad de tráfico

Por cada Socio, dashboard con:
- **Retention 7 / 30 / 90 días** de sus referidos.
- **% de referidos activos** (último login < 30 días).
- **LTV promedio** del referido.
- **NGR generado por referido** (promedio).
- **Churn rate** (% de referidos que dejaron de jugar).
- **Comparación contra otros Socios** del mismo tenant (percentil).

Permite distinguir Socio que trae **buen tráfico** vs. el que trae **gente que no convierte**.

### 8.7 D9 — Aprobación manual de payouts grandes

`socio_commissions` con `gross_amount > umbral` queda en `pending_review`. Requiere aprobación explícita del Admin Tenant (con 2FA) antes de pasar a `approved` y liberar el pago.

### 8.8 D2 y D4 — Disponibles pero apagadas por default

- **D2 (Hold period de 30 días)**: campo configurable `socio_commission_settings.hold_days` default 0. Si el Admin Tenant lo activa, las comisiones quedan retenidas X días antes de pagarse.
- **D4 (KYC liviano sobre umbral)**: configurable `tenant_settings.referrals.kyc_required_above`. Si > 0, el Socio debe verificar identidad para cobrar payouts > umbral.

Ambas se pueden activar desde el panel sin tocar código.

---

## 9. Panel del Socio — métricas mínimas

### 9.1 Dashboard

- **Resumen del período**: clicks, registros, FTDs, NGR atribuido, comisión proyectada.
- **Funnel**: clicks → registros → FTD → activos a 30 días.
- **Top links**: comparativa de qué link convierte mejor.
- **Top referidos**: por NGR generado.
- **Histórico de comisiones**: por período, con estado (pendiente / pagada / disputada).
- **Mi saldo de marketing**: cuánto invirtió en bonos al referido (`outflow_bonos`) en el período.

### 9.2 Gestión

- Crear / editar / archivar links.
- Activar / desactivar bonos en sus links.
- Cargar saldo a su wallet (recibe transferencia del Admin Tenant; no puede mintear).
- Solicitar retiro de comisiones a fiat.

### 9.3 Espacio para más métricas

Reservamos espacio en el dashboard para sumar métricas en futuras iteraciones (Sentiment, performance por canal, A/B de copys, etc.).

---

## 10. Panel del Admin Tenant — vista global

> El panel completo está documentado en `docs/10-panel-control.md` (pendiente). Acá solo lo específico de referidos.

Secciones mínimas:

- **Top Socios por NGR atribuido** (período actual + histórico).
- **Comisión total a pagar** del período por Socio.
- **Calidad del tráfico** comparativa entre Socios (D8).
- **Socios sospechosos** (D7).
- **Atribuciones flageadas** que requieren revisión manual.
- **Configuración por Socio**: % comisión, hold period, KYC, min_payout, etc.
- **Solicitudes de payout pendientes**.

---

## 11. Permisos a sumar al catálogo de `03-jerarquia-roles.md`

Nuevos permisos atómicos (a agregar al catálogo cuando se implemente):

- `referrals.create_link` — crear/editar links propios (Socio).
- `referrals.create_link_with_bonus` — activar bonos en links propios (Socio, gastando saldo propio).
- `referrals.view_own` — ver métricas y referidos propios.
- `referrals.view_any` — ver referidos de cualquier Socio (Admin Tenant).
- `referrals.config_socio` — editar config de comisión de un Socio (Admin Tenant).
- `referrals.approve_attribution` — confirmar/descartar flags de atribución (Admin Tenant).
- `referrals.approve_payout` — aprobar payouts grandes (Admin Tenant).
- `socio.payout_request` — solicitar retiro de comisiones a fiat (Socio).
- `socio.payout_process` — procesar payouts (Admin Tenant + designados).

Todos `is_delegatable` excepto `referrals.config_socio`, `referrals.approve_payout`, `socio.payout_process` (no-delegables, reservados al Admin Tenant directo).

---

## 12. Modelo de datos — resumen de tablas nuevas

Resumido para referencia rápida:
- `referral_codes` — links de cada Socio
- `referral_attributions` — qué usuario se atribuyó a qué Socio
- `referral_validation_flags` — señales antifraude por atribución
- `referral_bonus_grants` — bonos otorgados vía link (link → user → wallet_tx)
- `socio_commission_settings` — config de % comisión por Socio
- `socio_commission_balance` — carryover acumulado por Socio
- `socio_commissions` — facturación de comisiones por período
- `socio_payout_requests` — solicitudes de cobro a fiat

Detalle de campos en cada tabla está en este doc (§3, §4, §6, §7) y se consolida en `docs/04-modelo-datos.md` cuando se implemente.

---

## 13. Pendientes / a definir

- **Multi-touch attribution** (split entre Socios que tocaron al usuario antes de registrarse): v2.
- **MLM / multi-nivel** (Socio capta Socio): v2 si el negocio lo pide. Riesgo legal/tributario, evaluar.
- **Landing pages custom** por link (con CMS interno): v2.
- **A/B testing de copys/links**: v2.
- **Atribución cross-device** vía login: cuando se implemente login social / link directo a app.
- **Detección de bot signups** (CAPTCHA, comportamiento, etc.): MVP+1.
- **Automatización de payout fiat a Socios** (no manual): v2.
- **Plantillas de campañas pre-armadas** para Socios nuevos.
- **Integración con Kommo**: cada referido ingresa al pipeline correspondiente (ya cubierto en `docs/08-integracion-kommo.md §4`).
