# 17 · Modelo del operador independiente — FINAL v3 (la ficha = crédito de juego)

> ⚠️ Alineado con docs/LEYES.md (2026-07-07). Ante duda, mandan las LEYES + docs/20-modelo-operativo.

> **Estado: DISEÑO FINAL (2026-06-30), iterado tras 2 críticas adversariales. Pendiente
> de construir.** La ficha es un **crédito de juego, NO dinero**. Modelo de **cadena
> completa**: cada nivel revendedor (socio, distribuidor, cajero) es un **operador** que
> **banca a sus clientes directos**.
>
> **ALCANCE:** SOLO redes de socios **independientes** (la raíz lleva `is_independent_branch=true`).
> Socios **dependientes** + la Casa del tenant = otra conversación, **fuera de scope** —
> **excepto** la **transición** dependiente↔independiente (el "flip"), especificada en **§14**.

## 1. El modelo en una frase

La **ficha es un crédito de juego, NO dinero** (no canjeable contra el tenant). El tenant
**solo vende fichas** a precio **mayorista** (paga primero, sin reembolso). Se **revenden en
cadena** (cada operador a su precio libre); la reventa **mueve las mismas fichas, no crea**.
Cada jugador lo **banca su OPERADOR DIRECTO** (su parent inmediato), que cobra la carga y
paga el retiro **de su propia plata, por fuera**. Las fichas se **crean** al venderse (tenant)
o al **ganar** jugando, y se **queman** al **perder** y al **retirar**. **La plata del tenant
nunca toca el juego.**

## 2. Decisiones del dueño

| # | Decisión | Elección |
|---|---|---|
| I-A | Naturaleza de la ficha | **Crédito de juego, NO dinero.** No canjeable contra el tenant |
| I-B | Ingreso del tenant | **Venta mayorista** al socio. Sin reembolso |
| I-C | Pago de la venta | **Paga primero, recibe después** (plata verificada e irreversible) |
| I-D | Reventa | **En cadena**, cada operador a **su precio LIBRE**. NO crea fichas |
| I-E | Creación de fichas | SOLO: (a) venta del tenant, (b) **ganar jugando** (mint del premio) |
| I-F | Quema | Al **perder** una apuesta y al **retirar** |
| I-G | Quién banca | El **operador DIRECTO** (parent inmediato) del jugador. Cobra y paga de SU plata |
| I-H | Solvencia | **Problema del operador.** El tenant no cubre, nunca |
| I-I | Admin | **Solo el tenant.** Ningún operador mintea |
| I-J | Cadena | **Cada nivel (socio/distribuidor/cajero) es un OPERADOR** con su stock y su caja, que banca a sus directos |

## 3. La ficha NO es dinero

Crédito de juego (como fichas de arcade). No canjeable contra el tenant, no es deuda del
tenant. Su valor en plata lo pone el **operador** que la vende/banca. El respaldo es del
operador hacia su jugador, **no de la Casa** (coherente con E8: la Casa no banca al
independiente). Por eso este modelo **NO usa** el "muro" de dos cubetas del borrador viejo
(descartado).

> **Aclaración contable (E1/E2):** que la ficha NO sea dinero **no niega E1**. E1 rige la
> **contabilidad interna**: en el ledger **1 ficha = 1 unidad** y vale el invariante
> `balance == Σ(wallet_transactions)` (E2). Lo que **no** existe es un invariante "1 ficha = 1
> peso **respaldado por la Casa**": el **precio de reventa es VARIABLE por nivel** (R4) y esa
> conversión a fiat ocurre **fuera de la plataforma** (off-platform), entre el operador y su
> jugador. Adentro, la ficha se cuenta 1:1; afuera, la banca el operador a su precio.

## 4. Ciclo de vida de la ficha

```
CREAR:  (a) venta del tenant al socio (mayorista, PAGADA y verificada — irreversible)
        (b) ganar jugando (mint del premio al jugador)
MOVER:  reventa en cadena socio→distribuidor→cajero→jugador (transfiere las MISMAS fichas;
        cada uno a su precio; NO crea nuevas; la carga al jugador drena el stock del operador)
QUEMAR: (a) perder una apuesta (burn puro del jugador, sin pata de operador)
        (b) retiro: se queman y el operador paga plata real POR FUERA
```

## 5. La cadena de reventa

- Cada nivel **compra** al de arriba y **revende** al de abajo a **su precio (libre)**; se
  queda la **diferencia**. Bajan las **mismas** fichas; **no se crean nuevas**.
- **Precios LIBRES:** el tenant fija SOLO el suyo (mayorista). Aguas abajo es mercado — si
  un operador encarece de más, no le compran (su problema).
- El socio puede tener **clientes directos** (él = su propio cajero): se queda **todo el
  margen**. Mix directo + cadena convive (cada jugador lo banca su operador directo).

## 6. Quién banca: el OPERADOR DIRECTO (parent inmediato)

- El juego de un jugador lo banca **su parent inmediato** (el operador que le cargó las
  fichas): cobra la carga, paga el retiro, **de su plata, por fuera de la plataforma**.
- **Todo nivel revendedor es un operador** (I-J): tiene su **stock de fichas** (su wallet) y
  su **caja** (su `branchBankAccount` como referencia; la plata la mueve él, off-platform).
- **Sin fallback a la Casa:** si un jugador no tiene un operador directo válido (parent sin
  rol de operador / sin caja), la apuesta se **RECHAZA** (`NoBankingOperatorError`). **NUNCA**
  cae a la Casa del tenant.
- **Solvencia = problema del operador.** Si no puede pagar un retiro, es entre él y su cliente.
  **El tenant NO cubre.** **Cartelito legal:** el saldo del jugador lo respalda el operador.
- **Empleados propios del socio independiente (R7):** un socio independiente puede tener
  **empleados** en su sub-red (además de los del admin de la red central), pagados **por fuera**
  del sistema. Operan con planillas de permisos ajustables (Caja, Banco, Soporte,
  General/Supervisor, Solo-lectura), **capados al techo de permisos de su operador (P2):** nadie
  delega un permiso que no tiene ni por encima de lo suyo, y el aislamiento de la sub-red (E8/P3)
  igual rige para esos empleados.
- **El premio del jugador NO tiene tope por jugada (E4).** No hay `maxWin` de solvencia
  chequeado ANTES de la apuesta: por E4 la ganancia del jugador no se limita — se crean las
  fichas del premio y **del riesgo se hace cargo el operador AL ACEPTAR EL RETIRO**, no una
  validación pre-apuesta contra su stock. El `winAmount` que reporta el proveedor externo pasa
  solo por un **techo de sanidad configurable (E7)** (contra RNG/bug del proveedor), que **no**
  es un tope de solvencia por jugada. Recomendación: el operador mantiene reserva/colchón para
  bancar los retiros de su red (estructuralmente la banca a veces pierde, ver §8c).

## 7. Paneles

- Las solicitudes de **carga/retiro** aparecen en el panel del **operador directo** del jugador
  (filtradas por parent inmediato). **Visibilidad hacia abajo** para controlar la red, pero la
  **acción de pagar** es de cada operador con sus directos.
- **Cargas manuales:** cada operador carga a sus clientes desde su panel (drena su stock).

## 8. Ejemplos (cadena: Vos→Socio→Distribuidor→Cajero→Ana; precios $0,10 / $0,15 / $0,20 / $1)

**(a) Ana PIERDE 300:** Vos +$100 · Socio +$50 · Distribuidor +$50 · Cajero +$100 · Ana −$300.
Cierra `100+50+50+100−300=0`. El **cajero** bancó (cobró $1000, pagó $200 de fichas + $700 de retiro).

**(b) Directo (socio = cajero), Ana pierde 300:** Vos +$100 · Socio **+$200** · Ana −$300.

**(c) Ana GANA 500 y retira 1500:** el cajero cobró $1000, pagó $200 de fichas y paga **$1500**
de retiro → cajero **−$700**. **Esa pérdida es 100% del cajero** (es la banca; la banca a veces
pierde). El tenant ya cobró su $100 y NO reembolsa. Por eso el operador necesita **reserva/colchón**:
estructuralmente puede perder, y en cadena su margen es menor que el pasivo que banca.

## 9. La ÚNICA exposición del tenant: la venta mayorista (+ cerrar minteos)

| # | Regla |
|---|---|
| **I-Sec-1** | La venta al socio mintea SOLO contra plata **verificada e IRREVERSIBLE** (paga primero; bank_tx incoming matcheada en la misma tx, como `injectCapital`). NO mintear sobre transferencias reversibles (esperar firmeza / cap por separación de funciones). bank_tx con estado terminal `reversed`/`charged_back` |
| **I-Sec-2** | **Admin solo del tenant.** Restringir crear `admin_tenant`; 2FA + doble aprobación por monto |
| **I-Sec-3** | **Cerrar TODO otro minteo** para subárboles independientes: `achievement`, `vip_deposit_bonus`, bonos/promos/ligas cuyo funder esté del lado tenant. Gate por `getNearestIndependentBranchAncestor(jugador) != null` en CADA punto de minteo |
| **I-Sec-4** | El validador chequea **respaldo de la venta**: `Σ(mint source='branch_chip_sale') = Σ(bank_tx incoming FIRMES matcheadas a una venta)`. Exige que `sellChips` linkee la bank_tx |

## 10. Roadmap de construcción

> **Regla de bundling (de la crítica):** I-4 (juego nuevo) saca el control automático de
> solvencia. **NO se mergea a prod sin I-5 (retiro lo paga el operador, NUNCA el tenant) e
> I-Sec-3 (cerrar minteos) en el MISMO release**, o el tenant queda expuesto.

| # | Pieza | Qué hace |
|---|---|---|
| **I-0** | **Generalizar "operador" + migración** | Cada nivel revendedor = operador (stock + caja + precio); `resolveBankingOperatorForPlayer` = parent inmediato válido; migrar/versionar los rounds y saldos de `97dedeb` (que tienen pata de operador) |
| **I-1** | **Venta mayorista segura** | `sellChips`: paga-primero + bank_tx verificada/irreversible + link venta↔bank_tx + sin reembolso |
| **I-2** | **Reventa en cadena** | Cada operador transfiere fichas al de abajo a su precio (transfer conservado); registra el cobro |
| **I-3** | **Carga del operador a su jugador** | `transfer` desde el **stock del operador directo** (falla si no alcanza); reemplaza `creditFromDeposit` para independientes |
| **I-4** | **Juego = crédito** *(bundle con I-5+I-Sec-3)* | Apuesta → **burn puro** del jugador (ELIMINA `houseTakeBet`); premio → **mint puro** al jugador (ELIMINA `housePayWin`/`houseRollback`/`HouseInsufficientForWinError`/void); **sin `maxWin` de solvencia pre-apuesta** — el premio no se topa (E4) y el riesgo se absorbe al retiro (I-5); el `winAmount` del proveedor pasa solo por el **techo de sanidad configurable (E7)** |
| **I-5** | **Retiro lo paga el operador** *(bundle)* | Dos caminos en `markPaid`: independiente → quema fichas + `paidExternalRef` libre, **NUNCA** bank_tx del tenant; ruteo de la solicitud al panel del operador directo |
| **I-Sec-3** | **Cerrar minteos** *(bundle)* | Gate de logros/VIP/bonos/promos para subárboles independientes |
| **I-6** | **Validador + cartel** | I-Sec-4 (respaldo de venta); `computeSupply` cuenta bet=burn en `totalBurned` y win=mint en `totalMinted`; disclaimer al jugador |

Cada pieza: **build → revisión adversarial → tests**.

## 11. Qué cambia respecto del código actual

- **`resolveHouseWalletForPlayer` → `resolveBankingOperatorForPlayer`:** de *"nearest independent
  ancestor"* (socio raíz) a **"parent inmediato"** (operador directo), validando que sea un
  operador con caja. Sin fallback a la Casa: si no hay, **rechaza la apuesta**.
- **Generalizar el operador (I-0):** hoy el flag + precio + cuenta son **solo del socio**
  (`branches.service` valida `assertSocio`); pasan a estar disponibles en **cualquier nivel
  revendedor** (distribuidor, cajero) dentro de un subárbol independiente.
- **Juego (I-4):** **ELIMINA** las patas de la Casa (`houseTakeBet`/`housePayWin`/`houseRollback`/
  `getRoundHouseWallet`) — no las reescribe. El bet pasa a **burn** del jugador; el win a **mint**
  del jugador. Se borra `HouseInsufficientForWinError` y el void-por-insolvencia. El rollback
  revierte SOLO la pata del jugador.
- **Retiro (I-5):** `withdrawals.markPaid` hoy exige bank_tx **saliente del tenant**. Se bifurca:
  jugador independiente → **no** emite bank_tx del tenant; quema + referencia libre del operador.
- **Carga (I-3):** `creditFromDeposit` (mint single-sided) → `transfer` operador→jugador, con
  validación de stock. El **VIP deposit bonus** (acoplado en `deposits.approve`) se gatea junto.
- **Flag atómico:** el `is_independent_branch` se setea al **crear** la rama (una sola tx);
  prohibido operar (cargar/jugar) en un subárbol que debería ser independiente sin el flag.
  **Actualización (§14):** además del set al crear, el modo se puede **cambiar después** con
  la sub-red activa, pero SOLO vía la operación **reconciliada** del flip — nunca como un
  flip crudo del flag.

## 12. Migración (I-0, ANTES de I-4)

- Definir qué pasa con el **saldo de banca acumulado** de operadores bajo `97dedeb` (probable:
  dejarlo como stock de fichas revendible, documentado).
- **Versionar el round** (columna/source) para que el validador separe rounds viejos
  (par conservado) de nuevos (burn/mint). `houseRollback` solo aplica a rounds viejos (detectados
  por la `idempotencyKey house_bet:*`).
- Backfill/corte: congelar el juego/retiro de independientes durante la migración.

## 13. Fuera de scope (por ahora)

- Socios **dependientes** + la Casa bancándolos (salvo la **transición**, §14).
- **AML/KYC** global; conciliación bancaria automática (deseable para I-Sec-1).

## 14. Transición dependiente ↔ independiente (el "flip")

> **Decidido con el dueño (2026-07-08).** Actualiza la postura de §11 ("flag atómico al
> crear"): el cambio de modo es una **operación soportada, pesada y reconciliada**, incluso
> con la sub-red **activa** (con cajeros, jugadores y saldos en circulación). **No es un
> interruptor.** Toca plata, respaldo, comisiones, permisos y visibilidad de toda la sub-red.

**Marco.** El flip corre en **una sola transacción** (si algo falla, no queda a medias), con
un **registro de auditoría** dedicado (quién, cuándo, qué se cobró/reconcilió), y **valida
precondiciones antes de tocar nada**.

### 14.1 Precondiciones que BLOQUEAN
- **Ambas direcciones:** sin **depósitos/retiros pendientes** en la sub-red (quedarían
  apuntando a quién banca de forma contradictoria — depósitos resuelven el issuer al aprobar,
  retiros lo congelan al crear). Resolver (aprobar/rechazar) primero.
- **dep→indep:** `branchBankAccount` + `branchChipsPricePerUnit` cargados; y el socio con
  **fondos** para el cobro (§14.2).
- **indep→dep** (guard de degradación, ya existe en `countPendingForDegradation`): sin bank_tx
  `unmatched`, sin bonus definitions `active` propias, sin fraud links sin resolver en la
  sub-red. Bypass SOLO con `force` explícito + auditoría.

### 14.2 dep → indep — el socio COMPRA el saldo en circulación (opción 1)
Hoy la Casa banca las fichas que **ya circulan** en la sub-red. Al independizarse, las banca
él, así que **compra ese saldo a la Casa** al **precio mayorista**. El cobro tiene **dos caras**:

**(a) Fichas — SÍ lo modela la plataforma.** La Casa **transfiere stock** al socio:
- `base = Σ saldos de la sub-red del socio`, **excluyendo** las sub-redes **independientes
  anidadas** (un sub-socio independiente banca lo suyo, no este socio — mismo criterio de
  exclusión que el engine de comisiones). Incluye el stock de sus cajeros/distribuidores y los
  saldos de sus jugadores.
- `cobro_fiat = base × precio_mayorista`.
- Es un **transfer Casa→socio de `base` fichas** (consume stock de la Casa, NO mintea → no
  infla el supply). El socio queda con stock para fondear los depósitos/cargas de su red
  desde el minuto uno.
- **Paga primero** (R4, sin crédito): el `cobro_fiat` entra por una **transferencia bancaria
  verificada e irreversible** (bank_tx matcheada en la misma tx, como `sellChips`/I-Sec-1). El
  flip NO procede sin esa plata firme.
- **Edge — Casa sin stock:** si la Casa no tiene `base` fichas para transferir, el flip se
  **bloquea** (hay que fondear el presupuesto de la Casa primero). Nunca se mintea al vuelo.

**(b) La plata del "libro" viejo — off-platform.** Los retiros de las fichas que ya circulaban
los cobró la Casa (cuando el socio era dependiente) pero ahora los paga el socio. Ese arreglo
de plata **NO lo modela la plataforma** (docs/17 §3/§6: la plata del operador es off-platform);
es un acuerdo entre el socio y el admin. La plataforma solo mueve las fichas (a) y registra el
bank_tx del cobro.

### 14.3 indep → dep — la Casa absorbe, el stock propio se quema
- El **respaldo** de la sub-red lo **absorbe la Casa** (vuelve a bancar cada carga/retiro de
  esa red), con **asiento explícito** para que nada quede contablemente colgado.
- El **stock propio sin vender** del socio **se quema sin reintegro**: un dependiente no maneja
  fichas; lo que compró mayorista y no revendió, lo pierde. (Si no quiere perderlo, que venda/
  baje su stock antes del flip.)

### 14.4 Comisión (ambas direcciones)
- **Corte limpio** al instante del flip: se **cierra y liquida** el tramo del modo viejo hasta
  ese momento y arranca **período nuevo**. dep→indep deja de devengar comisión (pasa a margen,
  R4); indep→dep vuelve a devengar. **Sin doble cobro ni pérdida del mes** (hoy el compute es
  todo-o-nada por período — este corte lo reemplaza para el mes del flip).

### 14.5 Efectos automáticos (dentro de la misma tx)
- **Permisos de plata (dinámico):** el socio y sus distribuidores/cajeros **ganan** (dep→indep)
  o **pierden** (indep→dep) al instante los 7 permisos de mover plata — vía
  `EffectivePermissionsService` (gate por rol operador + sub-red independiente). Empleados
  **capados a su techo** (P2).
- **Visibilidad:** la sub-red se **aísla** del admin (dep→indep) o **reaparece** (indep→dep)
  (E8/P3). El admin solo cruza a una sub-red independiente por el mecanismo de intervención
  dedicado y auditado (R6).
- **Banco + precio:** se **limpian** al degradar; se **exigen** al independizar.

### 14.6 Detalles secundarios (DECIDIDOS 2026-07-08)
- **`commissionRate` inerte:** al independizar NO se resetea (queda guardado, inerte mientras
  es indep); al **re-degradar**, se **revalida** la tasa contra el techo (≤ tasa del padre)
  antes de reactivar el cobro. No se reactiva a ciegas.
- **bank_tx ya matcheadas (indep→dep):** el histórico de la etapa independiente se **archiva/
  marca** como "de sucursal independiente cerrada" — NO se mezcla crudo con el extracto central
  del admin al degradar (se distingue de las transferencias de la red central).
- **Bonus definitions del socio (indep→dep):** las `active` **bloquean** el flip (guard); las
  **inactivas se BORRAN** al degradar (no quedan huérfanas ni re-aplican).

### 14.7 Edge cases y garantías (revisión 2026-07-08)
- **Independencia anidada:** el `base` del cobro y la absorción de respaldo **excluyen** las
  sub-redes independientes anidadas (las banca su propio socio).
- **Congelar durante el flip:** la sub-red se **bloquea** para operar (depósitos/juego/cargas)
  mientras corre la reconciliación, para que no entre una operación a mitad de camino.
- **Sub-red vacía:** `base = 0` → cobro $0, flip limpio.
- **Retiros con issuer congelado:** cubiertos por la precondición de "sin pendientes" (no hay
  retiros en vuelo al flipear).
- **Atomicidad + paga primero:** la reconciliación corre en una tx **después** de verificar el
  bank_tx del cobro; el flip es **idempotente** (idempotency key) y **auditado**.

### 14.8 Interfaz
El operador ve una **pantalla dedicada** que explica todo esto al detalle —con las dos
direcciones, los requisitos que bloquean, las reconciliaciones automáticas y un **simulador
del cobro** (fichas × precio mayorista) en vivo— **antes de confirmar**. Mockup de diseño
publicado 2026-07-08 (patrón: explicación + ejemplos + simulador, como la config de comisiones).
