# 17 · Modelo del operador independiente — FINAL v3 (la ficha = crédito de juego)

> ⚠️ Alineado con docs/LEYES.md (2026-07-07). Ante duda, mandan las LEYES + docs/20-modelo-operativo.

> **Estado: DISEÑO FINAL (2026-06-30), iterado tras 2 críticas adversariales. Pendiente
> de construir.** La ficha es un **crédito de juego, NO dinero**. Modelo de **cadena
> completa**: cada nivel revendedor (socio, distribuidor, cajero) es un **operador** que
> **banca a sus clientes directos**.
>
> **ALCANCE:** SOLO redes de socios **independientes** (la raíz lleva `is_independent_branch=true`).
> Socios **dependientes** + la Casa del tenant = otra conversación, **fuera de scope**.

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

## 12. Migración (I-0, ANTES de I-4)

- Definir qué pasa con el **saldo de banca acumulado** de operadores bajo `97dedeb` (probable:
  dejarlo como stock de fichas revendible, documentado).
- **Versionar el round** (columna/source) para que el validador separe rounds viejos
  (par conservado) de nuevos (burn/mint). `houseRollback` solo aplica a rounds viejos (detectados
  por la `idempotencyKey house_bet:*`).
- Backfill/corte: congelar el juego/retiro de independientes durante la migración.

## 13. Fuera de scope (por ahora)

- Socios **dependientes** + la Casa bancándolos.
- **AML/KYC** global; conciliación bancaria automática (deseable para I-Sec-1).
