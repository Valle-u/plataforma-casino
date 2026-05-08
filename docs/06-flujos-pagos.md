# 06 · Flujos de Pagos

> Estado: **decidido en flujos core**. Métodos específicos se amplían a medida que se contraten proveedores.

Define cómo entra y sale dinero **fiat / cripto** del sistema, cómo se cruza con el wallet de fichas y cómo se concilia.

---

## 1. Distinción importante: dinero ≠ fichas

- **Fichas** (`wallet`): unidad interna del casino. Se generan por depósito aprobado o se asignan vía cargas manuales contra saldo de cajero.
- **Dinero real** (fiat o cripto): vive fuera de la plataforma (banco, exchange, wallet cripto del operador). Lo que rastreamos son **eventos** (depósito declarado, retiro pagado) que se concilian contra los movimientos reales.

Lo nuestro: registrar la intención + comprobante + estado, y mantener consistencia con las fichas que entran/salen al wallet del jugador.

---

## 2. Métodos de pago soportados (MVP)

### Configurables por tenant (`payment_methods` en DB de tenant):

#### Transferencia bancaria (ARS)
- Tenant configura una o varias cuentas: `cbu`, `alias`, `nombre_titular`, `cuit`, `banco`.
- Usuario ve los datos al iniciar depósito.
- Usuario transfiere y sube comprobante.

#### USDT (TRC-20 prioritario, opcional ERC-20)
- Tenant configura wallet receptora.
- Usuario ve la dirección + QR.
- Usuario transfiere y sube TX hash.
- Verificación opcional automática vía:
  - **TronGrid** o **Tronscan API** para TRC-20.
  - **Etherscan / Alchemy** para ERC-20.
- Si verificación automática activada y el hash matchea (monto + destino + confirmaciones suficientes) → aprobación auto.

#### Otros (futuro, no MVP)
- MercadoPago / pasarelas.
- Otras criptos (BTC, USDC).
- Pagos en efectivo a través de cajeros físicos integrados.

> Patrón **adapter** para todos: `IPaymentProvider` con métodos `getDepositInstructions`, `verifyTransaction`, `executeWithdrawal`.

---

## 3. Flujo: depósito autoservicio (jugador → casino)

```
┌────────────────────────────────────────────────────────────────────┐
│ JUGADOR (en sitio web)                                             │
│  1. Click "Cargar"                                                 │
│  2. Elige método (los activos del tenant)                          │
│  3. Ingresa monto                                                  │
│  4. Sistema muestra instrucciones (CBU/alias o wallet+QR)          │
│  5. Crea deposit con status='pending', expires_at = now() + 1h     │
└──────────────────────────┬─────────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────────────┐
│ JUGADOR realiza la transferencia externa                           │
│  6. Sube comprobante (foto) o ingresa hash cripto                  │
│  7. status → 'under_review'                                        │
│  8. Aparece en panel de cajero/empleado asignado                   │
└──────────────────────────┬─────────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────────────┐
│ REVISIÓN (camino A: manual, camino B: auto cripto)                 │
│                                                                    │
│  A) Cajero abre la solicitud, ve comprobante:                      │
│     - Aprueba: status='approved' + crea wallet_tx tipo 'deposit'   │
│       (ver flujo en docs/05-flujos-fichas.md §6)                   │
│     - Rechaza: status='rejected' + reason                          │
│                                                                    │
│  B) Worker cripto verifica TX hash en blockchain:                  │
│     - Match (monto, destino, confirms ≥ N) → aprueba auto          │
│     - No match en X min → mantiene 'under_review' para humano      │
└──────────────────────────┬─────────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────────────┐
│ POST-APROBACIÓN                                                    │
│  - Notificación in-app + push + livechat al jugador                │
│  - Métricas actualizadas (FTD si es primer depósito, etc.)         │
│  - Atribución de referido si aplica                                │
└────────────────────────────────────────────────────────────────────┘
```

### Estados del depósito

```
pending ──> under_review ──> approved
   │             │              ▲
   │             │              │
   │             └──> rejected  │
   │                            │
   └──> expired (TTL agotado)   │
                                │
   under_review ────────────────┘ (auto verify)
```

### Reglas
- Un usuario **puede crear infinitos depósitos por hora**, pero **máximo 2 simultáneos en estado `pending` o `under_review`** (configurable por tenant, default 2). Si intenta crear un 3ro → `409 TOO_MANY_PENDING_DEPOSITS`. Ver `docs/12-seguridad-compliance.md §10`.
- Comprobante obligatorio para transferencia bancaria; opcional pero recomendado para cripto (suple con hash).
- TTL configurable por tenant (default 1h fiat, 30min cripto).
- Comprobantes guardados con clave inmutable; nombres aleatorios; metadata mínima.

---

## 4. Flujo: depósito manual (cajero → jugador, sin comprobante del jugador)

Es el camino "tradicional" del rubro:
1. El jugador transfiere/paga al cajero por fuera de la plataforma (WhatsApp, encuentro físico, etc.).
2. El cajero busca al jugador en el panel y carga las fichas.

Este flujo es simplemente la `carga manual` descrita en `docs/05-flujos-fichas.md §3`. **No genera registro en `deposits`** porque no hay solicitud autoservicio. Sí genera `wallet_transaction` y `audit_log`.

> **Trade-off**: pierde trazabilidad contra el pago real (no hay comprobante en el sistema). El admin puede **forzar** vía `tenant_settings` que toda carga del cajero exija adjuntar comprobante interno (config `require_proof_on_manual_load`).

---

## 5. Flujo: retiro (casino → jugador)

```
1. Jugador solicita retiro:
   - amount
   - target_account (CBU/alias/wallet)
   - método
   → POST /withdrawals
2. Sistema:
   - Valida balance disponible (no en hold)
   - Valida límites del tenant
   - Crea wallet_hold por el monto (las fichas quedan reservadas)
   - INSERT withdrawals.status='pending'
3. Cajero/empleado revisa:
   - Aprueba (status='approved') → entra a cola de pagos
   - Rechaza → libera hold, status='rejected'
4. Pagador (humano o auto):
   - Hace transferencia real (banco) o tx blockchain
   - Marca status='paid' con external_ref (nro op / tx hash)
   - Sistema descuenta fichas del wallet (tx tipo 'withdrawal')
   - Libera el hold
   - Notifica al jugador
5. Si la transferencia falla externamente:
   - status='failed' + reason
   - Hold se libera (las fichas vuelven al jugador)
```

### Reglas
- Un usuario **puede crear infinitos retiros por hora**, pero **máximo 2 simultáneos en estado `pending` o `approved` (no pagados aún)** (configurable por tenant, default 2). Si intenta crear un 3ro → `409 TOO_MANY_PENDING_WITHDRAWALS`. Ver `docs/12-seguridad-compliance.md §10`.
- Retiro mínimo y máximo configurables por tenant.
- KYC level configurable: si está en `full`, requiere documentos verificados antes del primer retiro.
- Plazo objetivo de pago publicado al jugador (transparencia).
- Antifraude: si el `target_account` cambia frecuentemente, alerta a soporte.

---

## 6. Conciliación

### Diaria (job nocturno)
1. Obtener todos los `deposits.status='approved'` del día → suma esperada de ingresos.
2. Comparar contra movimientos reales:
   - Bancos: importación CSV / API (a definir por banco).
   - Cripto: scraping de la wallet receptora vía explorer.
3. Diferencia > umbral → alerta + entrada en `reconciliation_reports`.
4. Igual para retiros.

### Por demanda
Admin/super-admin pueden ejecutar conciliación de un período específico desde el panel.

---

## 7. Verificación cripto automática (worker)

Worker BullMQ por cada transacción cripto pendiente:

```
loop:
  for each deposit in deposits where method.type='crypto' and status='under_review':
    consultar TX hash en explorer
    si confirma >= N (configurable, ej. 2 TRC-20):
      validar amount y destination
      si todo ok: aprobar (mismo flujo que cajero)
      si discrepancia: marcar 'mismatch_review' + alertar
    si TX no encontrada y created_at > X min: dejar para humano
```

Configuración por método:
- `min_confirmations`
- `tolerance_pct` (¿se acepta diferencia mínima por fees?)
- `auto_approve_max_amount` (sobre cierto monto, siempre humano)

---

## 8. Antifraude (capa básica MVP)

- **Comprobantes duplicados**: hash perceptual (pHash) sobre la imagen → detectar reuso entre usuarios.
- **OCR del comprobante**: extraer monto + CBU destino + fecha → validar contra lo declarado.
- **Velocity**: > N depósitos en X minutos por mismo IP/dispositivo → flag.
- **Geo**: depósito desde país inesperado → flag.
- **Same TX hash distinto usuario** (cripto) → bloqueo automático.

Resultados del antifraude no rechazan automáticamente: marcan el depósito con `risk_flags` para que el cajero lo vea.

---

## 9. UX guidelines

- Instrucciones de pago **clarísimas**: monto exacto, destino, datos copiables con un click.
- Estado del depósito siempre visible al jugador (timeline).
- Si está `under_review` por más de X min, mostrar tiempo estimado.
- Si rechaza, mostrar motivo + canal para apelar (livechat).
- Botón "ya transferí" obvio. No hacerlo enterrar tras 5 clicks.

---

## 10. Pendientes / a definir

- Integración concreta con APIs de bancos argentinos (PIX-like en BR es Argentina con Transferencias 3.0; ¿qué API usamos?).
- Decidir provider para verificación cripto (TronGrid vs nodo propio).
- Estrategia para fees de retiro (¿se descuentan al jugador? ¿absorbe el operador?).
- Soporte multi-divisa simultáneo (ARS + USDT al mismo tiempo) — diseño para que jugadores elijan en qué cargar/retirar.
