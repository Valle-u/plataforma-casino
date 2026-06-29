# 16 · Tesorería / House-wallet (Blindaje del núcleo económico, Parte B)

> **Estado: DISEÑO (2026-06-29), pendiente de revisión del dueño antes de construir.**
> Continúa el blindaje del núcleo (ver `docs/14-roadmap.md §10.6`). La Parte A
> (validador de invariante) ya está construida. Esta es la **definición del
> negocio**: cómo nacen, se respaldan y se mueven las fichas.

## 1. Decisiones tomadas (con el dueño)

| # | Decisión | Elección |
|---|---|---|
| — | Qué representan las fichas | **Respaldadas por plata real** (no créditos de valor variable) |
| B1 | La cuenta de casa | **Usuario de SISTEMA "Casa"** dedicado (no humano), con su wallet. Separada del admin |
| B2 | Juego | **bet → Casa, win ← Casa.** La Casa es la contraparte; su balance refleja el GGR |
| B3 | Fuente del supply | **La Casa es la única fuente.** Depósito = la Casa emite; retiro = la Casa reabsorbe |
| B4 | Premiaciones | **Comisiones / bonos / promos los paga la Casa** (no se mintean de la nada) |
| B5 | Ratio ficha↔plata | **Fijo por método de pago**, configurable por el dueño |
| B6 | Aporte de capital | **Atado a respaldo real (estricto):** mintear a la Casa exige registrar la plata que lo respalda |

**Consecuencia central:** después de esto, la **única** operación que crea
fichas nuevas es el *aporte de capital del dueño a la Casa* — y queda atado a un
respaldo real. **Todo lo demás son transferencias de fichas que ya existen.** El
invariante `fichas en circulación ≤ respaldo real` se cumple por construcción.

## 2. La cuenta "Casa"

- Un **usuario de sistema** (`is_system = true`, username reservado p.ej. `__casa__`),
  no logueable, con su propia wallet. Una por tenant.
- Es la **contraparte** de: emisión de depósitos, pago de retiros, bets/wins,
  comisiones, bonos, promos.
- Su `balance` = fichas que la Casa tiene disponibles para pagar. Su evolución =
  **GGR + aportes de capital − premiaciones**. Puede acercarse a 0: si no le
  alcanza para pagar, el dueño debe **aportar capital** (no se mintea libre).
- La opera el admin vía endpoints dedicados (aporte de capital, ver estado), con
  permisos nuevos (`house.view`, `house.inject_capital`). Auditada siempre.

## 3. Reglas duras del supply

1. **Solo se mintea hacia la Casa**, y solo vía *aporte de capital* con respaldo
   registrado. Se elimina/cierra todo otro `mint` (admin libre, commissions.settle,
   vip, branches.sellChips, promos que minteaban).
2. **Toda ficha en una wallet de jugador/operador salió de la Casa** (depósito,
   premio, comisión, bono, o transferencia downstream de algo que salió de la Casa).
3. **Las transferencias internas** (load/unload entre operadores, ventas a
   sucursales) **mueven** fichas existentes — no crean. Quedan permitidas.
4. **El retiro** saca fichas de circulación (vuelven a la Casa) y dispara el pago
   de plata real.

## 4. Ratio ficha ↔ plata real

- Las fichas tienen **un valor canónico interno** (p.ej. `1 ficha = 1 ARS` — la
  *moneda base* del tenant, a confirmar). Las fichas son fungibles entre sí.
- Cada **método de pago** define su conversión a fichas:
  `chips_por_unidad` (ej. ARS → 1 ; USDT → 1000 si 1 USDT ≈ 1000 ARS).
  Se guarda en `payment_methods.config` (o columna dedicada).
- En el **depósito**: `fichas = monto_fiat × chips_por_unidad(método)`.
- En el **retiro**: `monto_fiat = fichas ÷ chips_por_unidad(método elegido)`.
- El **respaldo** se mide en moneda base: `Σ(plata real neta en el banco,
  convertida a base)`. (Detalle abierto: tipo de cambio entre métodos para el
  cómputo del respaldo — ver §9.)

## 5. Flujos

### 5.1 Depósito (emisión respaldada) — *modifica el flujo actual*
1. Jugador declara depósito (monto fiat, método). Empleado sube `bank_tx`.
2. Cajero **matchea** `bank_tx` ↔ depósito (ya existe) → confirma la plata real.
3. Al aprobar: **la Casa emite** `monto_fiat × ratio` fichas **al jugador**
   (transfer Casa→jugador, type `deposit`, counterparty = Casa, respaldo = bank_tx).
   - Si la Casa no tiene saldo suficiente para emitir, igual puede: la emisión de
     depósito está respaldada por el `bank_tx` entrante → se permite que la Casa
     "emita contra el respaldo" (mint atado al bank_tx, conceptualmente la plata
     ya entró). *(Implementación: mint a la Casa atado al bank_tx + transfer, o
     emisión directa con la Casa como emisor. A definir en build.)*

### 5.2 Retiro (reabsorción + pago) — *ajusta el flujo actual*
1. Jugador pide retiro (fichas + método). Hold sobre su wallet (ya existe).
2. Al pagar: las fichas **vuelven a la Casa** (reabsorción), se libera el hold, y
   se registra el `bank_tx` saliente por `fichas ÷ ratio` plata real.

### 5.3 Juego (bet → Casa, win ← Casa) — *modifica game-rounds*
- **Bet:** debita al jugador y **acredita a la Casa** (par transfer). Hoy se
  "destruye" → pasa a ir a la Casa.
- **Win:** debita a la Casa y **acredita al jugador**. Hoy se "mintea" → pasa a
  salir de la Casa.
- El balance de la Casa sube/baja con el GGR real. Un RTP roto la drena visible.

### 5.4 Comisiones / bonos / promos (← Casa) — *modifica esos servicios*
- El **funder** pasa a ser la Casa (en vez de mint o approver).
- Comisión: cuando se liquida, la Casa transfiere al beneficiario (no mint).
- Bono/promo: la Casa fondea el grant (no mint); reverso/cancel devuelve a la Casa.

### 5.5 Aporte de capital del dueño (único minteo) — *flujo nuevo*
- El dueño registra un **aporte de capital**: monto + `bank_tx` de respaldo
  (plata real que él pone en el banco de la casa).
- Recién con el `bank_tx` matcheado, se **mintea** ese monto en fichas **a la Casa**.
- Es la única vía de creación de fichas, y queda respaldada por construcción.

### 5.6 Transferencias internas (sin cambio conceptual)
- Load/unload entre operadores y ventas a sucursales: mueven fichas existentes
  (que en su origen salieron de la Casa). Se mantienen. *(`branches.sellChips`
  deja de mintear: pasa a transferir desde la Casa o desde el socio que compra.)*

## 6. Invariante de respaldo + reconciliación (extiende Parte A)

El validador de la Parte A ya chequea consistencia interna (`balance == Σ tx`).
La Parte B agrega el **invariante económico**:

```
fichas_en_circulación (todas las wallets EXCEPTO la Casa)
        ≤  respaldo_real_en_base
respaldo_real_en_base = Σ(bank_tx incoming matched)  − Σ(bank_tx outgoing matched)
                        (depósitos + aportes de capital) − (retiros pagados)
```

- Se suma como un chequeo más a `ledger_reconciliation_runs` (campo nuevo en el
  snapshot de supply: `backing`, `circulatingExCasa`, `backingGap`).
- **Política:** igual que Parte A → **solo alerta** si `circulación > respaldo`
  (señal de fuga o de que falta aporte de capital). No bloquea.
- La wallet de la Casa puede ser negativa en "GGR" conceptual pero su `balance`
  nunca baja de 0 (constraint); si no puede pagar, el dueño aporta capital.

## 7. Migración del estado actual (propuesta — a confirmar)

El sistema ya tiene fichas en circulación minteadas dispersas (el demo: ~10M).
Propuesta para introducir la Casa sin romper:

1. **Crear la Casa** (system user + wallet) en cada tenant (migration + seed).
2. **Baseline de capital:** sembrar la Casa con un *aporte de capital inicial*
   igual al supply legítimo actual, de modo que el arranque cuadre (la foto
   actual se toma como "capital ya aportado"). Documentar el monto.
3. **Limpiar descuadres conocidos** primero (el +1M del admin y los de
   `test_user_3704` que detectó el validador) — son datos de testeo.
4. **Cortar el minteo disperso:** redirigir cada punto de minteo (commissions,
   vip, branches, promos, game win) a transferencias desde la Casa.
5. Cada paso, validado con el chequeo de la Parte A (que no aparezcan descuadres).

## 8. Fases de construcción (tras revisión)

- **B-build-1 · Fundaciones:** Casa (system user + wallet), permisos `house.*`,
  endpoint de estado de la Casa, baseline de capital, panel de tesorería.
- **B-build-2 · Ratio por método:** `chips_por_unidad` en métodos de pago + usar
  el ratio en depósito/retiro.
- **B-build-3 · Aporte de capital:** flujo de aporte atado a `bank_tx`.
- **B-build-4 · Juego con la Casa:** bet→Casa / win←Casa.
- **B-build-5 · Premiaciones desde la Casa:** comisiones, bonos, promos.
- **B-build-6 · Cortar minteo disperso + invariante de respaldo** en la reconciliación.

Cada fase: cambio acotado + tests + correr el validador de la Parte A para
confirmar que nada descuadra.

## 9. Detalles resueltos (con el dueño, 2026-06-29)

1. ✅ **Moneda base: 1 ficha = 1 peso (ARS).** Valor canónico; el respaldo se mide
   en pesos (N fichas en circulación ⇒ N pesos de respaldo).
2. ✅ **Una sola moneda por ahora** (pesos). El respaldo se mide en pesos sin
   conversiones; el tipo de cambio multi-moneda se definirá al sumar otra moneda.
3. ✅ **Baseline de migración: sembrar la Casa con el supply actual como capital
   inicial** (no destructivo). La foto actual de fichas en circulación se registra
   como "capital ya aportado por el dueño". Los descuadres conocidos (+1M del
   admin, `test_user_3704`) se limpian ANTES de tomar la foto.
4. ✅ **Sucursales: la sucursal le compra fichas a la Casa** (transferencia desde
   la Casa; deja de mintear). El pago real se registra.
