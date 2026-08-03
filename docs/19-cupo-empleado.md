# 19 · Cupo del empleado para cargas por corrección

> ⚠️ Alineado con docs/LEYES.md. Ante duda, mandan las LEYES + docs/20-modelo-operativo.

> **Estado: CONSTRUIDO.**
> Ajuste 2026-08: la corrección queda **solo para empleados de la red central**
> (rol `empleado`, rama dependiente); se **quita `bonus`** del flujo (los bonos
> viven en el módulo de bonos) y la carga exige **header `Idempotency-Key`
> obligatorio** (idempotencia real, igual que `wallet.load`/`burn`).

## 1. El problema

El empleado necesita eventualmente cargar fichas a un cliente por motivos
operativos (corregir un error del sistema, reintegrar un retiro fallido). Hoy
solo el admin podía hacerlo (`wallet.adjust`, no delegable). Se necesita
habilitar al empleado a hacerlo, pero **con un techo**: si el empleado es
deshonesto o comete un error grave, la pérdida está acotada.

## 2. Quién puede corregir

**Solo empleados de la red central** (rol `empleado`, rama dependiente) con:

- permiso efectivo `wallet.correct`, y
- cupo mensual > 0 configurado por el admin.

> **Ajuste 2026-08 (dueño): los empleados cargan fichas SOLO por corrección.**
> El rol `empleado` está bloqueado de `wallet.load` en backend
> (`403 EMPLOYEE_LOAD_BLOCKED`), aunque tenga el permiso por override — el
> cupo mensual ES el control de cuánto mueve un empleado, y un load desde su
> wallet propia no lo consumiría. Por eso la planilla "Empleado de Caja, Bonos
> y Promociones" ya NO incluye `wallet.load_admin_network`. La UI oculta el
> botón "Cargar fichas" para rol empleado.

Bloqueos explícitos (UI + backend, `403 CORRECTION_NOT_EMPLOYEE`):

- **admin_tenant**: carga con "Cargar fichas" (`wallet.load`), que sale de la
  tesorería (`__casa__`). No usa corrección.
- **socio dependiente** (aunque tenga `wallet.correct`): su canal de carga es
  `wallet.load` (R3).
- **socio independiente**: su canal es la venta de fichas (E8/R4/P3).

> Los bonos NO pasan por corrección. Se otorgan desde el módulo de bonos
> (`GrantBonusModal` / `useGrantBonus`).

## 3. Reglas del cupo

| # | Regla |
|---|---|
| 3.1 | **Cupo POR empleado**, configurable (ej. Juan $50k, Ana $30k). Default 0 (sin permiso implícito, aunque tenga el rol) |
| 3.2 | **Se resetea el 1° de cada mes.** El contador arranca en 0 al mes nuevo, sin importar cuánto quedó del mes anterior |
| 3.3 | Las fichas **salen de la Casa (`__casa__`)**, que drena su saldo. El cupo NO es un stock — es un techo de "cuánto puede mover la persona este mes" |
| 3.4 | **Siempre a un cliente específico** (`targetUserId` obligatorio). No hay "carga al aire" |
| 3.5 | **Motivo obligatorio** de dropdown: `correction` \| `refund` \| `other`. Si es `other`, texto libre obligatorio |
| 3.6 | **Bloqueos:** cupo agotado → 409 `EMPLOYEE_CAP_EXCEEDED`; Casa sin saldo → 409 `HOUSE_INSUFFICIENT`; cupo 0 → 403 `NO_CAP_CONFIGURED`; no-empleado/admin/independiente → 403 `CORRECTION_NOT_EMPLOYEE` |
| 3.7 | Todo queda auditado severity **high** con: empleado, cliente destino, monto, tipo de motivo, texto libre, `idempotencyKey`, cupo restante del mes tras la operación |

## 4. Idempotencia (obligatoria)

`POST /tenant/correction` exige header **`Idempotency-Key`** (no vacío, max 200
chars). La key se guarda en la tx fuente (`executeTransferPair`):

- misma key + mismo body → devuelve el par previo, **no duplica** el cargo.
- misma key + body distinto → **409 `IDEMPOTENCY_CONFLICT`**.

El frontend genera una key al abrir el modal y la reutiliza en reintentos
(retry por timeout o doble envío no duplica).

## 5. Configuración del cupo

- Solo el **admin_tenant** puede configurar el cupo de un empleado
  (`users.edit`, modal `AssignEmployeeCapModal`).
- Se ve en la wallet del empleado y en Tesorería.

## 6. Piezas técnicas (implementadas)

### Backend (`apps/api`)

- **Migraciones:** `0041_employee_correction_cap.sql` (columna
  `employee_correction_cap_monthly numeric(20,2) NOT NULL DEFAULT '0'`) y
  `0042_correction_cap_employee_only.sql` (cupos > 0 solo rol `empleado`).
- **Permiso:** `wallet.correct` (delegable). Existe el alias de scope
  `wallet.correct_admin_network` → `wallet.correct` para empleados de la red
  central (scope guard sobre targets de sub-redes).
- **Bloqueo `wallet.load` para empleados:** `WalletController.load` valida el
  rol del actor; si es `empleado` → `403 EMPLOYEE_LOAD_BLOCKED` (aunque tenga
  `wallet.load` por override). El empleado carga solo por corrección.
- **Service:** `apps/api/src/wallet/employee-correction.service.ts` —
  `apply` (Casa → cliente, valida rol + cupo + motivo), `getStatus`,
  `setCap`. `CorrectionReasonType = 'correction' | 'refund' | 'other'`
  (sin `bonus`).
- **Controller:** `apps/api/src/house/correction.controller.ts` —
  `POST /tenant/correction` (header `Idempotency-Key` obligatorio),
  `GET /tenant/correction/status`, `PATCH /tenant/correction/user/:id/cap`.
- **DTO:** `apps/api/src/wallet/dto/correction.dto.ts` (`@IsIn` sin bonus).

### Frontend (`apps/web`)

- **`components/admin/correction-modal.tsx`**: modal de carga (target, monto,
  motivo sin bonus, detalle, cupo restante). Key de idempotencia generada por
  apertura y reutilizada en retries.
- **Botón "Carga por corrección"** visible solo para empleados de la red
  central con `wallet.correct` (gates en `users/page.tsx`,
  `users/[id]/page.tsx`, `users/[id]/wallet/page.tsx`).
- **`lib/hooks/use-correction.ts`**: `useCorrectionStatus`, `useApplyCorrection`
  (manda la key), `useEmployeeCap`/`useSetEmployeeCap`, `newCorrectionIdempotencyKey`.
- **`components/admin/assign-employee-cap-modal.tsx`**: admin fija cupo mensual.

## 7. Fuera de scope

- **Depósitos externos** (`bank_tx.match` + `deposits.approve`): no consumen cupo.
- **Cargas por caja / venta de fichas** (`wallet.load`, canales de socios). El
  rol `empleado` NO usa `wallet.load` (bloqueado, §2).
- **Retiros de fichas** (`wallet.unload`): flujo aparte, no consume cupo.
- **Bonos:** módulo de bonos (`GrantBonusModal`).
- **Aprobación de doble firma.** El cupo mensual ES el control.
