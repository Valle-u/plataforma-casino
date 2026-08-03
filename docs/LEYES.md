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
- **R7 — Empleados.** Los tiene el admin (red central) **y** los socios independientes (su sub-red). Se pagan **por fuera** del sistema. Permisos por planillas ajustables: Caja, Banco, Soporte, General/Supervisor, Solo-lectura. **Ajuste 2026-08 (dueño): los empleados cargan fichas SOLO por corrección contra su cupo mensual** (`wallet.correct`, docs/19). El rol `empleado` está bloqueado de `wallet.load` en backend (`403 EMPLOYEE_LOAD_BLOCKED`) — un load desde su wallet propia no consume cupo y abriría un bypass del techo. Retirar fichas (`wallet.unload`) sigue siendo un canal válido para empleados (flujo aparte, no consume cupo).
- **R8 — La wallet de bonos es EXCLUSIVA de usuarios finales.** El `bonus_balance` (y el `locked_balance` por bonos) existe **solo** en wallets de jugadores (rol `usuario_final`). Ningún operador (socio/distribuidor/cajero/admin/empleado) recibe bonos: el backend rechaza el grant con `BONUS_TARGET_NOT_PLAYER` antes de tocar wallets, y el UI no ofrece la acción. Definido con el dueño 2026-07-31.

## C · Comisiones — red dependiente (C)

- **C1 — Modelo Diferencial (override).** Comisión = **NetWin (GGR) × tasa diferencial por nivel**. Cada nivel cobra la diferencia entre su tasa y la del de abajo. El total que paga la Casa queda **capado a la tasa del nivel más alto** de la cadena.
- **C2 — Tasas acotadas.** Cada tasa ≤ la del padre (el override nunca es negativo). El admin fija la del socio; el socio reparte hacia abajo (regla del techo, P2).
- **C3 — Deuda arrastrada.** Un período con NetWin negativo genera deuda que se descuenta del próximo cobro; el socio **no paga de su bolsillo**.
- **C4 — Limpia, mensual, cash.** Sin deducciones por ahora (solo NetWin → comisión). Se liquida **mensual**, en efectivo por fuera (el settle quema fichas contables). Los costos flexibles son un módulo **futuro**.
- **C5 — Solo dependientes.** Los independientes **no** cobran comisión: ganan por margen de reventa (R4).
- **C6 — Configurar sin errores.** La pantalla de configuración de comisiones debe explicar el modelo, mostrar ejemplos y tener un **simulador en vivo** con validación (cada tasa ≤ la del padre).

## D · Permisos y scope (P)

- **P1 — Permiso + scope, siempre.** Toda ruta valida el permiso atómico **Y el scope del target** (no solo que tenga el permiso). Nunca cruzar entre redes.
- **P2 — Regla del techo.** Nadie otorga/delega un permiso que no tenga, ni por encima de lo suyo. Los empleados de un operador quedan **capados al techo de ese operador**.
- **P3 — Aislamiento independiente en permisos.** Ningún bypass (`admin_tenant`, `admin_network`, descendants) alcanza la sub-red independiente para **mover fichas**. El admin llega solo por el mecanismo de intervención dedicado (R6).
- **P4 — Multi-tenant.** Cada operación en el contexto de un tenant. Nunca una conexión "global" a la DB de un tenant (la DB de control es la única excepción).

---

**Cómo citarlas:** referí las leyes por código (ej. "esto toca R1 y P3"). Si una tarea las contradice, se detiene y se pregunta.
