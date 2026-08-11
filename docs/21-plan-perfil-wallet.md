# 21 — Plan: unificar perfil + wallet (jugador) y acomodar perfiles

> Estado: **borrador validado con el dueño** (sesión 2026-08-10). Documenta las
> decisiones tomadas antes de escribir código. La Parte B (panel admin) queda
> abierta hasta la próxima ronda de relevamiento.
>
> Reglas del dominio que aplican: este trabajo **no toca la wallet ni el
> dinero** (no se modifican saldos, transacciones ni holds). Sí toca el modelo
> de datos de `users` (agregar columnas) y, en la Parte B, permisos.

---

## 1. Estado actual (relevado)

- Todos los roles viven en una sola tabla `packages/db/src/tenant/users.ts`
  (jugador, cajero, socio, distribuidor, empleado, casa). Campos del perfil:
  `displayName` (obligatorio, un solo campo), `phone`, `email`. No existen
  `firstName`, `lastName` ni `language`.
- El jugador **no tiene forma de editar su perfil**: solo existe
  `GET /tenant/auth/me` (lectura) y `POST /tenant/auth/me/password`
  (`apps/api/src/tenant-auth/tenant-auth.controller.ts`).
- El **admin sí** edita usuarios vía `PATCH /tenant/users/:id`
  (`displayName`, `email`, `phone`, `status`) — hook `use-users.ts`.
- La wallet es una tabla separada 1:1 con el usuario
  (`packages/db/src/tenant/wallet*`): `balance`, `bonusBalance`,
  `lockedBalance`, `version`. **No se toca** en este plan.
- Pantallas del jugador:
  - `/play/settings` → "Mi cuenta": hero (saldo/VIP), datos personales
    read-only, notificaciones push, seguridad (2FA, contraseña, sesiones).
  - `/play/wallet` → "Movimientos": 4 tarjetas (Disponible · Bono · En hold ·
    estado) + lista filtrable de transacciones.
  - `/play/deposits` y `/play/withdrawals` → flujos de carga/retiro (quedan
    como están).
- Sidebar del jugador (`apps/web/components/player/shell/player-sidebar.tsx`):
  grupo *Mi dinero* (Wallet · Depósitos · Retiros) y grupo *Cuenta*
  (Notificaciones · Configuración).

## 2. Decisiones tomadas con el dueño

1. **Alcance de la unificación: solo UI del jugador.** No se toca la base de
   datos de la wallet ni sus endpoints.
2. **Empezar por el jugador.** El panel admin se aborda después (Parte B).
3. **Página única "Mi cuenta"** con 4 pestañas:
   - **Perfil** — hero (avatar, nombre, VIP, saldo resumen) + datos editables +
     notificaciones push.
   - **Mi dinero** — tarjetas Disponible · Bono · En hold · estado + botones
     "Cargar fichas" / "Retirar" que llevan a las páginas existentes.
   - **Movimientos** — la lista filtrable que hoy vive en `/play/wallet`
     (sin las tarjetas).
   - **Seguridad** — 2FA, contraseña, sesiones, cerrar sesión (lo que hoy está
     en `/play/settings`).
4. **Menú lateral**: un solo botón "Mi cuenta" reemplaza a "Wallet" y
   "Configuración". Depósitos, Retiros y Notificaciones quedan como están.
5. **Depósitos y Retiros**: quedan como páginas aparte (formularios largos).
   Se accede con botones desde "Mi dinero".
6. **Campos editables del perfil del jugador**: nombre + apellido (separados),
   teléfono, email e idioma. **El @usuario queda fijo.**
7. **Edición**: tanto el jugador (endpoint nuevo) como el operador (ya existe
   `PATCH /tenant/users/:id`).
8. **Fuera de alcance por ahora**: país, fecha de nacimiento, DNI, avatar,
   i18n completo (el idioma se guarda como dato, no cambia la UI todavía).

## 3. Parte A — Jugador (implementar primero)

### 3.1 Modelo de datos (`packages/db/src/tenant/users.ts`)

> ⚠️ **Punto a validar con el dueño**: agregar columnas a `users` implica un
> cambio menor de schema. No es la "unificación" (que es solo UI) sino la parte
> "perfiles más ricos" que pidió el dueño. Propuesta:

- Agregar `firstName` y `lastName` (text, opcionales). Mantener `displayName`
  como derivado de cálculo (nombre + apellido) para no romper nada existente.
- Agregar `language` (text, opcionales; default `es`). Dominio cerrado a una
  lista (ej. `es`, `en`) validada en DTO.

### 3.2 Backend

- Nuevo `PATCH /tenant/auth/me` — el jugador edita su propio perfil
  (`firstName`, `lastName`, `phone`, `email`, `language`).
  - `email`: requiere verificación antes de quedar activo (revisar flujo de
    email verificado existente; si no hay, mantener email no editable por el
    jugador y solo editable por el operador — **a validar**).
  - Validar el nuevo valor contra el resto de la plataforma (ej. cambio de
    teléfono que está en `wallet_transactions`/KYC si aplica).
  - Auditar el cambio en `audit_log` (quién, cuándo, qué, por qué) — buena
    práctica aunque no sea dinero.
  - No invalidar sesiones (no es un dato sensible de sesión).
- El operador ya edita vía `PATCH /tenant/users/:id`; extender su DTO para
  incluir `firstName`, `lastName`, `language` (mismo permiso existente).

### 3.3 Frontend

- Nueva página `/play/account` con tabs `Perfil · Mi dinero · Movimientos ·
  Seguridad`. Reutilizar los componentes existentes:
  - *Movimientos*: extraer la lista + filtros de `app/play/wallet/page.tsx`.
  - *Perfil*: reutilizar `ProfileHero`, `DatosPersonales` (pasar de read-only a
    formulario editable) y `PushNotificationsToggle`.
  - *Seguridad*: mover `TwoFaFlow`, `SessionsSection`, cambio de contraseña.
- Sidebar: reemplazar "Wallet" y "Configuración" por un item "Mi cuenta"
  → `/play/account`. Actualizar `isActive` para los tabs.
- Redirecciones (no romper links existentes):
  - `/play/wallet` → `/play/account` (tab movimientos).
  - `/play/settings` → `/play/account` (tab perfil).
  - Revisar referencias a esas rutas en header / menú de usuario del jugador.
- Pestaña "Mi dinero": tarjetas de saldo (reutilizar `BalanceCard`,
  `WalletStatusCard`) + CTAs "Cargar fichas" (`/play/deposits`) y "Retirar"
  (`/play/withdrawals`).
- Formulario de perfil: `firstName`, `lastName`, `phone`, `language`; email
  según lo resuelto en 3.2; @usuario read-only.

### 3.4 Tests

- Backend: e2e de `PATCH /tenant/auth/me` (edición feliz, validaciones de
  dominio, email/idioma, audit log).
- Frontend: guardar perfil, tabs navegan bien, redirects funcionan.

## 4. Parte B — Panel admin (definido con el dueño)

> Leyes que aplican: **R3/R4/P3** (permisos de plata según rol y modelo) y
> **F1** (modelo de sueldos, hoy dormido según docs/20). No se tocan
> `docs/03-jerarquia-roles.md` ni el motor de comisiones.

> **Estado 2026-08-11 (Claude Opus 4.8)**: implementada la **unificación en
> pestañas** del perfil admin (`/users/:id` con tabs Perfil · Wallet ·
> Movimientos · Permisos; `/users/:id/wallet` ahora redirige). Hechos: **§4.1**
> (cupo solo empleados), **§4.2** (fuera Sueldo + borrado del `user-detail-drawer`
> muerto y su hook), **§4.3** (jerarquía con nombre + link), **§4.5 parte del
> detalle** (permisos agrupados por categoría + riesgo). **Pendientes**: §4.4
> (nodos de Red clickeables) y el ordenamiento de categorías en la pantalla
> `/permissions` (§4.5 segunda parte).

### 4.1 Cupo de correcciones — solo empleados

**Bug encontrado**: la tarjeta "Cupo de correcciones" se muestra en el perfil
de CUALQUIER usuario. `canEditCap` (`apps/web/app/(admin)/users/[id]/page.tsx:168`
y `.../[id]/wallet/page.tsx:85`) solo mira el permiso del actor (`users.edit`)
y **no el rol del usuario objetivo**.

- Fix: `canEditCap` debe requerir además que el **target** tenga rol `empleado`
  y no sea rama independiente (misma regla de `canCorrect`, docs/19).
- Resultado: la tarjeta y el "Configurar cupo" solo aparecen en perfiles de
  empleados de la red central.

### 4.2 Sección "Sueldo mensual" — se elimina del UI

Decisión del dueño: la sección **no debe existir**. Es un remanente del modelo
F1; docs/20 eliminó el sueldo fijo (se cobra por comisión %) y docs/16 ya sacó
la sección de tesorería.

- Quitar `SalarySection` del detalle de usuario (`user-detail-drawer.tsx`) y de
  `apps/web/app/(admin)/users/[id]/page.tsx` (y sus hooks `use-employee-salaries`
  si quedan sin uso).
- **No tocar** el motor de comisiones ni los sueldos dormidos (F1 reversible).

### 4.3 Jerarquía del perfil — mostrar nombre, no ID

**Bug encontrado**: la sección "Jerarquía" (`/users/[id]/page.tsx:1169`) muestra
al padre como `{parentUserId.slice(0,8)}…` y `relationType` técnico
(`cajero_de_socio`).

- Fix: mostrar **nombre + @usuario** del padre, la relación en lenguaje claro
  (ej. "Es cajero de María") y **link al perfil** del padre.

### 4.4 Pantalla Red — nodos clickeables

- En `apps/web/app/(admin)/red/page.tsx`, cada `NodeCard` debe llevar al perfil
  del usuario (`/users/[id]`).

### 4.5 Permisos — orden y agrupación

- **Detalle de usuario** (`/users/[id]/page.tsx:382`): la lista plana de
  permisos efectivos se agrupa por categoría (como `/permissions`) y se ordena
  por riesgo (alto primero) usando `permission-meta.ts` (`getPermissionMeta`,
  `RISK_ORDER`, `CATEGORY_LABELS`).
- **Pantalla Permisos** (`/permissions`): ordenar las categorías por riesgo
  (las de dinero/plata primero) en vez del orden del `Map`.

### 4.6 Confirmado que NO se toca

- Botón "Otorgar bono" / "Sacar bono": **ya está bien** filtrado a
  `usuario_final` (`user-detail-drawer.tsx:143`, `user-actions-cell.tsx:180`).
- `docs/03-jerarquia-roles.md`: no se modifica (decisiones cerradas).
- Motor de comisiones / sueldos dormidos: no se tocan.

## 5. Riesgos y reglas

- No tocar saldos, transacciones ni holds (regla 5 del AGENTS.md).
- No romper tokens/sesiones: los cambios de perfil no invalidan sesión.
- El @usuario queda fijo: los handlers de username no cambian.
- No renombrar entidades/columnas existentes; solo agregar.
- No tocar `docs/00-` a `docs/03-`.
- Los cambios de la Parte B son de **presentación y visibilidad** en el panel:
  el backend ya valida permisos, cupos y roles (403 si algo no corresponde).
