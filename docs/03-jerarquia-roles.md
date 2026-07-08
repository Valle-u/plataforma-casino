# 03 · Jerarquía y Sistema de Roles / Permisos

> ⚠️ Alineado con docs/LEYES.md (2026-07-07). Ante duda, mandan las LEYES + docs/20-modelo-operativo.

> Estado: **decidido en estructura**. Permisos atómicos concretos pueden ampliarse durante la implementación, pero las reglas del sistema no se cambian sin acuerdo.

---

## 1. Principios

1. **RBAC + permisos atómicos por usuario** (híbrido). Cada rol trae permisos por defecto; cada usuario individual puede tener overrides (`grant` o `revoke`).
2. **Multi-rol**: un mismo humano puede tener varios roles simultáneos (ej: `socio` + `empleado`).
3. **Jerarquía implica scope**, no implica privilegios automáticos. Un socio ve a sus distribuidores y cajeros, pero no puede hacer todo lo que ellos hacen sin tener el permiso atómico.
4. **Granularidad fina**: cada acción significativa tiene su propio permiso. Activable/desactivable desde el panel.
5. **Auditoría**: cambios en roles y permisos siempre dejan registro en `audit_log`.

---

## 2. Árbol de roles

```
Super-Admin                 (vive solo en DB de control)
└── Admin Tenant            (uno o varios por tenant)
    ├── Socio
    │   └── Distribuidor    (subtipo de Socio; cuelga de un Socio)
    │       └── Cajero
    ├── Empleado            (rol de bajo default; permisos a la carta)
    └── Usuario final       (jugador; sin acceso al panel)
```

### Dos sabores de cada rol operativo: DEPENDIENTE vs INDEPENDIENTE

Antes de mirar "quién ve a quién" hay que fijar una distinción que atraviesa todo el modelo (ver `docs/20-modelo-operativo` y las leyes E8/R3/R4):

- **DEPENDIENTE** (comercial puro, **R3**): el socio / distribuidor / cajero **no toca fichas**. No aprueba depósitos/retiros, no carga ni quita fichas, no corrige saldos. Su rol es 100% comercial: publicidad, traer y gestionar su equipo, y cobrar **comisión %**. **Toda la plata central la mueven solo el admin + sus empleados** (R3).
- **INDEPENDIENTE** (descentralizado, **R4**): cada nivel **compra fichas al de arriba** (paga primero, sin crédito), **fija su precio de reventa**, **banca lo suyo** y **aprueba a sus hijos directos** (R1). Su ingreso es el **margen de reventa**, no comisión (C5).

Los permisos de plata que aparecen más abajo en §5 aplican **solo a las versiones INDEPENDIENTES**. Un socio/distribuidor/cajero dependiente arranca **sin ningún permiso de plata**.

### Aislamiento de la sub-red independiente (E8 / P3 / R6)

La sub-red que cuelga de un socio independiente es un **"casino aparte"**:

- Ningún actor externo (admin, empleados, ancestros) la **fondea ni le mueve fichas** en el flujo normal (E8).
- El **admin del tenant NO ve el detalle interno** de esa sub-red: solo **agregados / estadísticas + historial de ventas de fichas** (R6).
- Ningún bypass de permisos (`admin_tenant`, `admin_network`, descendants) alcanza esa sub-red para mover fichas (P3).
- **Único cruce permitido**: el **mecanismo de intervención super-admin**, dedicado y auditado — nunca por los botones normales de operación (R6/E8).

### Quién ve a quién

| Rol | Ve a |
|---|---|
| Super-Admin | Todos los tenants y todos sus usuarios |
| Admin Tenant | La **red central completa** (todos los roles de su tenant en la red propia + dependientes). De cada **sub-red independiente** ve solo **agregados / estadísticas + historial de ventas**, **no el detalle interno** (R6 / E8 / P3) |
| Socio | Sus distribuidores, sus cajeros, sus referidos directos (toda su sub-red, R2) |
| Distribuidor | Sus cajeros, sus referidos directos (toda su sub-red, R2) |
| Cajero | Sus jugadores asignados / referidos (toda su sub-red, R2) |
| Empleado | Lo que el admin del tenant (o el socio independiente que lo emplea) le permita ver explícitamente |
| Usuario final | A sí mismo |

> **Importante**: "ver" significa que aparecen en sus listados. Para **operar** sobre ellos necesita además el permiso atómico correspondiente. Un **operador VE toda su sub-red** (R2), pero la **cola de pedidos self-service la maneja el padre directo** de cada solicitante (R1): ver ≠ aprobar.

---

## 3. Modelo de datos (resumen)

Tablas clave (detalle en `docs/04-modelo-datos.md` cuando se cree):

```sql
-- Roles disponibles en un tenant (seed inicial; admin puede crear customs)
roles (
  id, code, name, description, is_system, created_at
)

-- Permisos atómicos disponibles (catálogo global, igual en todos los tenants)
permissions (
  code             -- ej: 'wallet.load', 'deposits.approve'
  category         -- ej: 'wallet', 'deposits', 'reports'
  description
  audit_required   -- bool, si la acción debe loggearse en audit_log
  is_delegatable   -- bool, si un usuario que lo tiene puede otorgarlo a un subordinado
)

-- Permisos por defecto de cada rol
role_permissions (
  role_id, permission_code
)

-- Asignación de roles a usuarios (multi-rol)
user_roles (
  user_id, role_id, granted_by, granted_at
)

-- Overrides individuales (suman o restan permisos al usuario)
user_permission_overrides (
  user_id, permission_code,
  effect              -- 'grant' | 'revoke'
  granted_by         -- usuario que otorgó/revocó directamente
  granted_by_chain   -- uuid[] cadena de delegación (para cascada al revocar)
  granted_at, reason
)

-- Jerarquía operativa (quién cuelga de quién)
user_hierarchy (
  user_id, parent_user_id, relation_type  -- ej: 'distribuidor_de_socio', 'cajero_de_distribuidor'
)
```

### Cálculo del set efectivo de permisos de un usuario

```
permisos_efectivos(user) =
    UNIÓN de role_permissions de todos sus user_roles
  + user_permission_overrides donde effect = 'grant'
  − user_permission_overrides donde effect = 'revoke'
```

Esta función vive en `packages/permissions` y es la **única** fuente de verdad. Toda validación del backend la usa.

---

## 4. Permisos atómicos (catálogo inicial)

Catálogo base. Se amplía cuando aparecen features. Naming: `<dominio>.<acción>[.<modificador>]`.

> **Nota (pendiente de ampliación)**: este catálogo todavía **no cubre el modelo independiente ni las comisiones**. Faltan, y se agregarán al implementarlos:
> - **Reventa de fichas (independiente, R4)**: comprar fichas al de arriba, revender hacia abajo, fijar/editar el precio de reventa. Son la mecánica de plata del modelo descentralizado (ver `docs/17-modelo-independiente.md`).
> - **Comisiones (dependiente, C1–C6)**: configurar tasa diferencial por nivel (con techo ≤ tasa del padre), ver/liquidar comisión, ver carryover de deuda (ver `docs/16-tesoreria.md`).
> - **Intervención super-admin (R6/E8)**: el permiso dedicado y auditado que es el **único** cruce hacia una sub-red independiente.

### Wallet (fichas)
- `wallet.load` — cargar fichas a un usuario.
- `wallet.unload` — retirar fichas de un usuario (descarga manual).
- `wallet.transfer` — transferir entre usuarios bajo su jerarquía.
- `wallet.view_any` — ver el saldo de cualquier usuario del tenant.
- `wallet.view_own_network` — ver saldos solo de su red.
- `wallet.adjust` — ajustar saldo manualmente con motivo (reservado a admin / soporte senior).

### Depósitos (autoservicio del jugador)
- `deposits.view` — ver solicitudes de depósito.
- `deposits.approve` — aprobar y cargar fichas.
- `deposits.reject` — rechazar con motivo.
- `deposits.assign` — reasignar solicitud entre cajeros/empleados.

### Retiros
- `withdrawals.view`
- `withdrawals.approve`
- `withdrawals.reject`
- `withdrawals.process` — marcar como pagado tras transferir externamente.

### Usuarios
- `users.create`
- `users.edit`
- `users.ban` / `users.unban`
- `users.change_role`
- `users.view_any`
- `users.view_own_network`
- `users.impersonate` — login como otro usuario para soporte (loggeado fuerte).

### Roles y permisos (meta-permisos)
- `roles.create` / `roles.edit` / `roles.delete`
- `permissions.grant` — otorgar override a un usuario.
- `permissions.revoke`

### Reportes
- `reports.netwin.view`
- `reports.financial.view`
- `reports.operations.view`
- `reports.export`

### Marketing / Referidos
- `referrals.create_link`
- `referrals.view_any`
- `referrals.view_own`
- `campaigns.create` / `campaigns.edit` / `campaigns.view`

### Branding y configuración (por tenant)
- `branding.edit` — colores, logos, copys.
- `tenant.settings.edit` — métodos de pago, parámetros generales.
- `tenant.payments.edit` — alta/baja de cuentas bancarias / wallets cripto.

### Livechat / Soporte (Kommo)
- `livechat.access`
- `livechat.assign`
- `livechat.close`
- `livechat.view_metrics`

### Auditoría
- `audit.view` — leer audit_log.
- `audit.export`

### Super-Admin (solo DB de control)
- `platform.tenants.create`
- `platform.tenants.suspend`
- `platform.tenants.delete`
- `platform.commission.view`
- `platform.commission.adjust`
- `platform.global_metrics.view`

---

## 5. Roles y sus permisos por defecto

Estos son los **defaults**. Cada admin de tenant puede crear roles custom o ajustar los existentes (excepto los marcados `is_system = true`).

### Super-Admin (`super_admin`) — DB de control
Todos los `platform.*`. No tiene acceso operativo a las DBs de tenants salvo modo "sombra" auditado (ver §7).

### Admin Tenant (`admin_tenant`)
Todo dentro de su tenant. Por defecto: todos los permisos del catálogo excepto los `platform.*`. Puede crear y gestionar el resto de roles.

> **Regla general (R3/R4)**: socio, distribuidor y cajero tienen **dos juegos de defaults** según su modelo. El **DEPENDIENTE** arranca **SIN ningún permiso de plata** (comercial puro). El **INDEPENDIENTE** sí banca su red. Nunca mezclar: un rol comercial no obtiene permisos de plata "por herencia".

### Socio (`socio`)

**Base (común a ambos modelos)**:
- `users.view_own_network`
- `wallet.view_own_network`
- `referrals.create_link`, `referrals.view_own`
- `reports.netwin.view` (filtrado a su red)
- `campaigns.view` (sobre las suyas)

**Socio DEPENDIENTE (R3, comercial puro)** — agrega **nada de plata**. Solo lo comercial de arriba + su **comisión %** (C1–C6). No aprueba dep/retiros, no carga/quita fichas, no corrige. Toda la plata central la maneja el admin + sus empleados.

**Socio INDEPENDIENTE (R4, banca su red)** — agrega los permisos de banca sobre su sub-red:
- `wallet.load` / `wallet.unload` (a cualquiera de su sub-red, según su stock)
- `wallet.transfer` (dentro de su red)
- `deposits.approve` / `deposits.reject` (de sus **hijos directos**, R1)
- `withdrawals.approve` / `withdrawals.process` (de sus **hijos directos**, R1)
- `users.create` (en su red)
- (futuro) permisos de **reventa de fichas** y **fijar precio** (§4, R4)

### Distribuidor (`distribuidor`)

**Base**: como el Socio (`users.view_own_network`, `wallet.view_own_network`, referidos, reportes de su red).

**Distribuidor DEPENDIENTE (R3)** — **sin permisos de plata**. Comercial puro + comisión %.

**Distribuidor INDEPENDIENTE (R4)** — banca su tramo de la cadena:
- `wallet.load` / `wallet.unload` (a cajeros y jugadores de su red, según su stock)
- `deposits.approve` / `deposits.reject`, `withdrawals.approve` / `withdrawals.process` (de sus **hijos directos**, R1)
- `users.create` (cajeros y jugadores en su red)

### Cajero (`cajero`)

**Base**:
- `users.view_own_network`
- `users.create` (jugadores)
- `users.ban` / `users.unban` (**sobre sus jugadores** — gestión completa de su cartera)
- `livechat.access`

**Cajero DEPENDIENTE (R3)** — **sin permisos de plata**. No aprueba dep/retiros ni carga/quita fichas: la cola central la maneja el admin + empleados. Su rol es traer y gestionar jugadores + comisión %.

**Cajero INDEPENDIENTE (R4, banca propia)** — agrega:
- `wallet.load` (a jugadores, desde su stock)
- `wallet.unload` (de jugadores)
- `deposits.view`, `deposits.approve`, `deposits.reject` (de sus jugadores — hijos directos, R1)
- `withdrawals.view`, `withdrawals.approve`, `withdrawals.process` (de sus jugadores, R1)

### Empleado (`empleado`)
**Sin permisos por defecto**. El admin del tenant le configura permisos a la carta según función (soporte, marketing, finanzas).

### Usuario final (`usuario_final`)
Sin permisos del panel. Acceso solo al sitio de juego con sus propias operaciones.

---

## 6. Reglas operativas

### Multi-rol
Un humano con `socio` + `empleado` tiene la **unión** de permisos por defecto de ambos roles, más sus overrides individuales.

### Scope vs permiso
Tener `wallet.load` no implica poder cargar a cualquier usuario. La validación es:
1. ¿Tiene el permiso atómico? Sí/No.
2. ¿El usuario destino está dentro de su scope (jerarquía)? Sí/No.

Ambos deben dar Sí. La capa de scope se calcula vía `user_hierarchy`.

### Saldo de cajero (solo cajero INDEPENDIENTE, R4)
> Esto aplica **solo al cajero INDEPENDIENTE**, que banca con su propio stock. El **cajero DEPENDIENTE no tiene saldo operativo**: no mueve fichas (R3), la plata la maneja el admin + empleados.

- El cajero **independiente** opera contra un **stock propio** (fichas que compró al de arriba, R4), no una caja ilimitada.
- Cada `wallet.load` a un jugador descuenta de su stock.
- Cuando su stock queda bajo, **compra más fichas** a su padre directo (paga primero, sin crédito, R4).
- Toda asignación / compra de fichas es una transacción wallet auditada.

### Cambios de rol y permisos
- Loggeados en `audit_log` con: actor, target, antes, después, timestamp, motivo opcional.
- Cambios sobre `admin_tenant` o `super_admin` requieren 2FA del actor.

### Roles de sistema vs custom
- Los 7 roles base son `is_system = true`. No se pueden eliminar; sus permisos por defecto sí se editan dentro de límites razonables.
- Custom roles: el admin del tenant puede crear cuantos quiera.

---

## 7. Delegación de permisos (Socios y otros niveles)

Un Socio (o cualquier usuario con scope sobre subordinados) puede gestionar permisos de los que cuelgan de él. Reglas:

### 7.1 Regla de techo
**Nadie puede otorgar lo que no tiene.** Si un Socio no tiene `wallet.load`, no puede dárselo a su Cajero. Validación en el backend antes de cada `grant`. El backend calcula el set efectivo del actor en runtime y valida que el permiso a otorgar esté incluido.

### 7.2 Permisos no-delegables
Cada permiso del catálogo lleva flag `is_delegatable`. Si es `false`, **el usuario puede ejecutarlo él mismo pero no puede regalarlo a un subordinado**. Reservados al Admin Tenant:

- `wallet.adjust` (ajuste manual de saldo "ex nihilo")
- `permissions.grant` / `permissions.revoke` (delegar la facultad de delegar)
- `users.impersonate`
- `branding.edit`
- `tenant.settings.edit`
- `tenant.payments.edit`
- `roles.create` / `roles.edit` / `roles.delete`
- `audit.export`
- Todos los `platform.*` (solo super-admin)

El Admin Tenant puede marcar más permisos como no-delegables desde el panel si lo necesita.

### 7.3 Cascada al revocar
Cuando se revoca un permiso a un usuario, **se cascadea automáticamente a todos los subordinados que lo recibieron por delegación a través de él**.

- Cada fila de `user_permission_overrides` lleva `granted_by_chain` (uuid[]): la cadena completa desde el origen hasta el otorgante directo.
- Al revocar a un usuario X: job sincrónico encuentra todos los overrides cuya `granted_by_chain` contiene X y los revoca también.
- La cascada queda registrada en `audit_log` como un evento `cascada_revoke` con la lista de usuarios afectados.
- El usuario que dispara el revoke ve un **preview** ("esto afectará a N usuarios") antes de confirmar.

### 7.4 Empleados del Socio (solo INDEPENDIENTE)
Solo el socio **INDEPENDIENTE** puede tener empleados propios (**R7**): como maneja su propia plata, delega en un staff dentro de su sub-red (rol `empleado` con scope limitado a su red). Les configura permisos a la carta **capados a su propio techo** (P2/regla del techo). **No son** empleados del tenant entero, son empleados de ese socio. El socio **DEPENDIENTE** (comercial puro, R3) **no** tiene empleados de plata: su equipo son sus distribuidores/cajeros, y la plata central la maneja el admin + sus empleados.

### 7.5 Roles custom (v2)
**MVP**: solo roles base. Asignación de permisos individuales (overrides) sí permitida.
**v2**: el Socio podrá crear roles custom dentro de su red, siempre con techo en sus propios permisos. La arquitectura `roles` + `role_permissions` + scope ya lo soporta; falta UI y guards adicionales.

### 7.6 Auditoría de delegaciones (ultra-fina)
**Toda** acción de delegación queda en `audit_log` con:
- Actor (quién delega) + rol vigente al momento
- Target (a quién)
- Permiso afectado
- Effect (`grant` / `revoke` / `cascada_revoke`)
- Antes / después del set efectivo del target (snapshots completos)
- IP + user agent + `request_id` (correlación de toda la cadena de llamadas)
- Timestamp con precisión de ms
- Motivo (obligatorio para `revoke`)

El Admin Tenant ve un **timeline completo** de "qué hicieron mis Socios con los permisos" desde su panel. Filtros por actor, target, permiso, fecha, IP. Exportable.

> Esta granularidad de auditoría aplica a **todo el sistema**, no solo a delegaciones. Ver `docs/04-modelo-datos.md §3 audit_log` y `docs/12-seguridad-compliance.md` (pendiente).

---

## 8. Modo "Impersonate" / "Sombra"

Para soporte y debug:
- `users.impersonate` permite a un usuario operar **como** otro.
- Toda acción durante la impersonación queda doblemente loggeada: actor real + actor aparente.
- Sesiones impersonadas tienen TTL corto (15 min, renovable).
- El impersonado puede ver en su historial que su cuenta fue accedida (transparencia).

---

## 9. UI de gestión (panel)

Pantallas mínimas previstas:

1. **Listado de usuarios** con filtro por rol, jerarquía, estado, fecha.
2. **Detalle de usuario** con:
   - Roles asignados (toggleables si tenés `users.change_role`).
   - Tabla de permisos efectivos con indicación de origen (rol X / override grant / override revoke).
   - Botones para agregar override `grant` o `revoke`.
3. **Editor de roles**:
   - Matriz de permisos por categoría con switches.
   - Vista previa de "qué puede hacer este rol".
4. **Árbol de jerarquía** navegable con drag-and-drop para reasignaciones (con auditoría).

---

## 10. Validación en el backend

En NestJS, dos guards encadenados en cada endpoint sensible:

```ts
@UseGuards(AuthGuard, PermissionGuard)
@RequirePermissions('wallet.load')
@RequireScope('user_in_own_network')
@Post('wallet/load')
loadChips(...) { ... }
```

- `PermissionGuard` consulta el set efectivo del usuario.
- `RequireScope` valida la relación jerárquica con el target.
- Falla → 403 + entrada en `audit_log` (intento bloqueado).

---

## 11. Casos a tener en cuenta

- **Usuario eliminado / suspendido**: invalidación inmediata de tokens. Sus subordinados quedan reasignados al superior siguiente automáticamente (o a un fallback configurable por tenant).
- **Cambio de jerarquía**: implica reasignación de wallet y referidos. Job de BullMQ para hacerlo de forma transaccional.
- **Bajada de rol** (ej: distribuidor → cajero): los permisos se recalculan. Posibles `revoke` automáticos auditados.
- **Conflicto de overrides**: si un usuario tiene `grant X` y `revoke X`, gana el más reciente (con auditoría visible).
