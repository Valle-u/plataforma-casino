# 19 · Cupo del empleado para cargas manuales

> ⚠️ Alineado con docs/LEYES.md (2026-07-07). Ante duda, mandan las LEYES + docs/20-modelo-operativo.

> **Estado: DISEÑO acordado con el dueño (2026-07-01), listo para construir.**
> Extiende la tesorería (`docs/16 §12`). Le da al empleado una manera controlada
> de hacer cargas manuales por corrección/bonificación/reintegro, con techo
> mensual configurable por empleado.

## 1. El problema

El empleado necesita eventualmente cargar fichas a un cliente por motivos
operativos (corregir un error del sistema, bonificar, reintegrar un retiro
fallido). Hoy solo el admin puede hacerlo (`wallet.adjust`, no delegable). Se
necesita habilitar al empleado a hacerlo, pero **con un techo**: si el empleado
es deshonesto o comete un error grave, la pérdida está acotada.

## 2. Los dos flujos del empleado (uno ya existe, otro es nuevo)

### Flujo A — Depósito externo (YA EXISTE)

El cliente transfiere plata → el empleado matchea la transferencia con la
solicitud del cliente → la Casa emite las fichas al cliente. Hay respaldo
bancario real. **NO consume cupo.**

- Permisos ya construidos y delegables: `bank_tx.match` + `deposits.approve`.
- **Sin código nuevo.** Solo hay que asegurar que se le puedan otorgar al rol
  empleado (ya lo son).

### Flujo B — Carga por corrección (NUEVO — este doc)

El empleado carga fichas a un cliente **sin transferencia bancaria**, contra su
cupo mensual. Motivo obligatorio de dropdown.

> **Quién tiene empleados (R7):** los tiene el admin (**red central**) **y** los
> **socios independientes** (su sub-red). El Flujo B tal como se describe acá
> —transfer **desde la Casa (`__casa__`)**— es el de la **red central**. En la
> sub-red de un socio **independiente NO hay Casa** (ver `docs/16-tesoreria-adenda.md`):
> la corrección de un empleado de un independiente sale de la **wallet de SU operador
> (el socio independiente)**, no de la Casa — así no se viola el aislamiento económico
> del independiente (**E8**). La mecánica del cupo mensual y los controles son los
> mismos; sólo cambia la **contraparte** (Casa en la central; wallet del operador en
> la independiente).

## 3. Reglas del cupo (Flujo B)

| # | Regla |
|---|---|
| 3.1 | **Cupo POR empleado**, configurable (ej. Juan $50k, Ana $30k). Default 0 (sin permiso implícito, aunque tenga el rol) |
| 3.2 | **Se resetea el 1° de cada mes.** El contador arranca en 0 al mes nuevo, sin importar cuánto quedó del mes anterior |
| 3.3 | Las fichas **salen de la Casa** (drenan su saldo) en la **red central**; en la sub-red de un socio **independiente** salen de la **wallet de su operador** (no hay Casa — E8, ver §2 Flujo B). El cupo NO es un stock — es un techo de "cuánto puede mover la persona este mes" |
| 3.4 | **Siempre a un cliente específico** (targetUserId obligatorio). No hay "carga al aire" |
| 3.5 | **Motivo obligatorio** de dropdown: `correction`, `bonus`, `refund`, `other`. Si es `other`, texto libre obligatorio |
| 3.6 | **Bloqueos:** si el empleado ya usó su cupo del mes → 409 `EMPLOYEE_CAP_EXCEEDED`; si la Casa no tiene saldo → 409 `HOUSE_INSUFFICIENT`; si el cupo es 0 → 403 `NO_CAP_CONFIGURED` |
| 3.7 | Todo queda auditado severity **high** con: empleado, cliente destino, monto, tipo de motivo, texto libre, cupo restante del mes tras la operación |

## 4. Configuración del cupo (quién lo fija)

- Solo el **admin_tenant** puede configurar el cupo de un empleado
  (permiso `users.edit` que ya existe).
- Se ve en el perfil del usuario (en la sección admin de "Gestión de usuarios")
  y en el panel de Tesorería, sección nueva "Cupos de empleados" (listado de
  empleados con cupo > 0 + su consumo del mes).

## 5. Piezas técnicas a construir

### Backend

- **Migración 0041:** columna `employee_correction_cap_monthly numeric(20,2) NOT NULL DEFAULT '0'` en `users`.
- **Nuevo permiso:** `wallet.correct` (delegable, default en `admin_tenant`, se
  puede otorgar a empleados de confianza). Distinto del `wallet.adjust` que
  queda solo para admin.
- **DTO:** `WalletCorrectDto` con `targetUserId`, `amount`, `reasonType`,
  `reasonNotes?`.
- **Service:** `WalletService.correct(actor, target, amount, reason)`.
  Atómico: (a) valida cupo del mes disponible del empleado, (b) transfiere de
  **la contraparte → cliente** en la misma tx — la contraparte es la **Casa** en la
  red central, o la **wallet del operador independiente** si el empleado pertenece a
  una sub-red independiente (E8), (c) inserta wallet_tx con
  `source='employee_correction'` para que se pueda sumar el consumo por mes,
  (d) registra audit severity high.
- **Endpoint:** `POST /tenant/wallet/correct` (permiso `wallet.correct`).
- **Reader:** `GET /tenant/wallet/correction-cap` — devuelve `{ cap, usedThisMonth, remaining }`
  para el propio empleado (para pintar el cupo restante en UI).
- **Endpoint config:** `PATCH /tenant/users/:id/correction-cap` (permiso `users.edit`).

### Frontend

- **Modal `CorrectionModal`** con:
  - Búsqueda del cliente destino.
  - Amount.
  - Dropdown motivo (correction / bonus / refund / other).
  - Texto libre (obligatorio si `other`).
  - Muestra cupo restante del mes en tiempo real.
- **Botón "Carga por corrección"** en el detalle de un usuario (solo visible
  si el actor tiene `wallet.correct` y cupo > 0).
- **Sección "Cupos de empleados"** en `/tesoreria`: lista de empleados con
  cupo configurado + consumo del mes + botón para editar el cupo.
- Hook `useCorrectionCap` + `useApplyCorrection` + `useSetEmployeeCap`.

## 6. Alcance y foco

- **NO es parte:** el flujo de aprobar depósitos (ya existe, se reusa
  `bank_tx.match` + `deposits.approve`).
- **NO es parte:** cargas por caja de cajero (ese es otro flujo, `wallet.load`,
  que también ya existe).
- **Fuera de scope:** aprobación de doble firma. El cupo mensual ES el control.
