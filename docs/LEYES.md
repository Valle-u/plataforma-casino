# ⚖️ LEYES INQUEBRANTABLES

> Estas son las **leyes de dominio** del producto: decisiones del dueño que rigen **todo** cambio o implementación de acá en adelante.
>
> **Son inquebrantables salvo que el dueño lo pida EXPLÍCITAMENTE** para un caso concreto.
>
> **Obligación del agente (Claude Code u otro):**
> 1. Antes de tocar economía, roles, permisos o comisiones, **releé estas leyes**.
> 2. En cada cambio o propuesta, **avisá qué leyes aplican** (citándolas por código, ej. "esto toca R1 y P3") y confirmá que se respetan.
> 3. Si una tarea parece requerir **romper** una ley, **detenete y avisá** — no la rompas por tu cuenta. Solo el dueño autoriza excepciones, caso por caso.
> 4. Si cambiás una ley (con autorización explícita), actualizá este archivo + `docs/DEVLOG.md`.
>
> Definidas con el dueño el **2026-07-07** (sesión de auditoría económica + mapeo de jerarquías rol por rol). El detalle del modelo vive en `docs/03-jerarquia-roles.md`, `docs/17-modelo-independiente.md`, `docs/16-tesoreria.md` y `docs/DEVLOG.md`. Algunas leyes describen el estado **objetivo** y el código todavía tiene gaps en camino de cerrarse (no son excepciones a la ley: son bugs a arreglar).

---

## A · Economía de fichas (E)

- **E1 — Ficha = 1 peso, mint/burn puro.** Una ficha equivale a 1 unidad de moneda. El sistema crea (mint) y destruye (burn) fichas; no hay pool externo.
- **E2 — Invariante del ledger.** `balance == Σ(wallet_transactions)` SIEMPRE. Ninguna operación mueve un balance sin su `wallet_transaction`. Toda operación de plata es transaccional (FOR UPDATE), auditada (`audit_log`) e idempotente (`idempotency_key` UNIQUE en DB).
- **E3 — La Casa es la única fuente de minteo.** El usuario de sistema `__casa__` es la tesorería. El minteo está acotado por un **presupuesto mensual** (tope configurable) + fondeo deliberado y auditado. Ningún otro camino crea fichas sin control: la venta de fichas es **transferencia desde la Casa**, no mint.
- **E4 — La ganancia del jugador no tiene tope.** Se crean las fichas del premio; del riesgo se hace cargo el **operador al aceptar el retiro**, no un maxWin.
- **E5 — Depósito respaldado.** Acreditar fichas requiere respaldo real (bank_tx matcheada / pago verificado). No se acredita sin plata, y el monto acreditado se ata a la plata recibida.
- **E6 — Retiro = burn puro con hold.** Al pedir retiro se coloca un hold; al pagar se quema (burn); al rechazar/fallar se libera. **No se libera un hold si ya hay bank_tx de salida matcheada** (no devolver fichas que ya se cobraron afuera).
- **E7 — Juego con proveedor externo.** `rtp ∈ (0, 1]`. El `winAmount` del proveedor pasa por un techo de sanidad configurable. El premio se cubre al retiro (E4).
- **E8 — Aislamiento económico de la red independiente.** La sub-red de un socio independiente es un "casino aparte": ningún actor externo (admin, empleados, ancestros) la fondea ni le mueve fichas en el flujo normal. Único cruce permitido: el **mecanismo de intervención super-admin** dedicado y auditado (ver R6/P3).

## B · Roles y jerarquías (R)

- **R1 — El padre directo manda la cola.** Las solicitudes self-service (depósito/retiro) las **ve y acepta SOLO el padre directo** del solicitante. Lo de más abajo lo maneja el operador directo de cada jugador (el socio no aprueba a los jugadores de sus cajeros/distribuidores).
- **R2 — Ver y mover ≠ aprobar.** Un operador VE toda su sub-red y puede CARGAR/QUITAR fichas a cualquiera abajo suyo (según su modelo), pero la **cola de pedidos self-service se delega al padre directo** (R1).
- **R3 — Dependientes = comerciales con reventa.** Los SOCIOS dependientes **carguen fichas de su wallet a los jugadores de su red** (canal de reventa, `wallet.load`) — cambio autorizado por el dueño 2026-07-31. NO aprueban dep/retiros, NO corrigen (`wallet.correct`), NO retiran (`wallet.unload`) — esos siguen solo para admin + empleados. Distribuidores y cajeros DEPENDIENTES siguen sin tocar plata (comerciales puros). **Toda la plata de la Casa central la manejan solo el admin + sus empleados.**
- **R4 — Independientes = descentralizados.** Cada nivel independiente **compra fichas al de arriba** (paga primero, sin línea de crédito), **fija su propio precio de reventa**, banca lo suyo y aprueba a sus hijos directos. Ingreso = margen de reventa (no comisión).
- **R5 — Jugador.** No transfiere fichas a otro jugador (**sin P2P**). Ve solo lo suyo. Deposita a su operador directo (indep) o a la Casa (dep). Puede autoservicio o que el operador le cargue.
- **R6 — Admin.** Opera la red central; de la independiente ve solo **agregados + historial de ventas** (no el detalle interno). Puede intervenir en todo, pero **por un mecanismo separado y auditado** — nunca por los botones normales de operación.
- **R7 — Empleados.** Los tiene el admin (red central) **y** los socios independientes (su sub-red). Se pagan **por fuera** del sistema. Permisos por planillas ajustables: Caja, Banco, Soporte, General/Supervisor, Solo-lectura. **Ajuste 2026-08 (dueño): los empleados cargan fichas SOLO por corrección contra su cupo mensual** (`wallet.correct`, docs/19). El rol `empleado` está bloqueado de `wallet.load` en backend (`403 EMPLOYEE_LOAD_BLOCKED`) — un load desde su wallet propia no consume cupo y abriría un bypass del techo. Retirar fichas (`wallet.unload`) sigue siendo un canal válido para empleados (flujo aparte, no consume cupo). **Cupo compartido (2026-08): el cupo mensual del empleado lo consumen las correcciones Y los bonos que otorga** — un único techo sobre la tesorería de la Casa (corrección `wallet.correct` + grant de bonos con funder Casa y actor empleado). El **monto total del bono** consume cupo (no solo lo convertido a saldo real). `bonuses.remove` (débito manual del jugador) **no consume ni devuelve** cupo.
- **R8 — La wallet de bonos es EXCLUSIVA de usuarios finales.** El `bonus_balance` (y el `locked_balance` por bonos) existe **solo** en wallets de jugadores (rol `usuario_final`). Ningún operador (socio/distribuidor/cajero/admin/empleado) recibe bonos: el backend rechaza el grant con `BONUS_TARGET_NOT_PLAYER` antes de tocar wallets, y el UI no ofrece la acción. Definido con el dueño 2026-07-31.

## C · Comisiones — red dependiente (C)

- **C1 — Modelo Diferencial (override).** Comisión = **base × tasa diferencial por nivel**, donde `base = NetWin (GGR) − costo del proveedor` (ver C4b). Cada nivel cobra la diferencia entre su tasa y la del de abajo. El total que paga la Casa queda **capado a la tasa del nivel más alto** de la cadena.
- **C2 — Tasas acotadas.** Cada tasa ≤ la del padre (el override nunca es negativo). El admin fija la del socio; cada operador reparte hacia abajo (regla del techo, P2). **Fase 4 (implementado 2026-08):** delegación nivel por nivel — cada operador (socio/distri) fija la tasa de sus **hijos directos** operadores desde "Mi sucursal" (`GET /network/my-children` + `PATCH /network-rate/:childId`, gate `commissions.configure_network`; el distri lo recibió por migración 0089). Topes por hijo: `rate ≤ tasa propia del actor` (techo) y `rate ≥ mayor tasa de los nietos` (piso, override no-negativo). El backend valida hijo-directo + ambos topes; el admin fija a socios con tope 100.
- **C3 — Deuda arrastrada.** Un período con base negativa genera deuda que se descuenta del próximo cobro; el operador **no paga de su bolsillo**.
- **C4 — Mensual, cash, per-operador.** Se liquida **mensual**, en efectivo por fuera (el settle QUEMA el equivalente en fichas del wallet de la Casa `__casa__`). La Casa liquida a **CADA operador dependiente** su override propio (socio, distribuidor y cajero cobran directo de la Casa — el diferencial hace que la suma quede capada a la tasa del socio). La liquidación es **sincrónica** (acción manual del admin, idempotente por fila con FOR UPDATE). Salvo el costo del proveedor (C4b), el resto de costos flexibles (sueldos, banco) siguen **dormidos** (módulo futuro).
- **C4b — Costo del proveedor (implementado 2026-08).** El proveedor de juegos nos cobra un **fee % sobre el NetWin** (ej. Palace 7%, configurable por proveedor en `game_providers.commission_fee_pct`). Ese fee se **descuenta de la base ANTES** de aplicar las tasas → los operadores cobran sobre `NetWin × (1 − fee)`. Solo aplica a bases **positivas** (el proveedor no reduce la deuda de una red que perdió). Se registra por operador (`commission_network_periods.provider_fee`) para transparencia. Sobre el NetWin **independiente** la Casa igual paga el fee al proveedor pero lo **absorbe** (lo cubre el margen de reventa, R4) — se muestra informativo.
- **C5 — Solo dependientes.** Los independientes **no** cobran comisión: ganan por margen de reventa (R4).
- **C6 — Configurar sin errores.** La pantalla de configuración de comisiones debe explicar el modelo, mostrar ejemplos y tener un **simulador en vivo** con validación (cada tasa ≤ la del padre).

## D · Permisos y scope (P)

- **P1 — Permiso + scope, siempre.** Toda ruta valida el permiso atómico **Y el scope del target** (no solo que tenga el permiso). Nunca cruzar entre redes.
- **P2 — Regla del techo.** Nadie otorga/delega un permiso que no tenga, ni por encima de lo suyo. Los empleados de un operador quedan **capados al techo de ese operador**.
- **P3 — Aislamiento independiente en permisos.** Ningún bypass (`admin_tenant`, `admin_network`, descendants) alcanza la sub-red independiente para **mover fichas**. El admin llega solo por el mecanismo de intervención dedicado (R6).
- **P4 — Multi-tenant.** Cada operación en el contexto de un tenant. Nunca una conexión "global" a la DB de un tenant (la DB de control es la única excepción).

---

**Cómo citarlas:** referí las leyes por código (ej. "esto toca R1 y P3"). Si una tarea las contradice, se detiene y se pregunta.
