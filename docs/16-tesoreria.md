# 16 · Tesorería / House-wallet (Blindaje del núcleo económico, Parte B)

> ⚠️ Alineado con docs/LEYES.md (2026-07-07). Ante duda, mandan las LEYES + docs/20-modelo-operativo.
>
> **Nota de vigencia:** el fondeo de la Casa vigente es el **presupuesto mensual + fondeo auditado** (E3, ver `§12`). El "aporte de capital atado a `bank_tx`" que aparece en `§1` (B6) y `§5.5` quedó **superado** — se conserva solo como opción más estricta, no como diseño por defecto. El modelo de comisiones vigente es el **diferencial/override multinivel** (C1–C6 de las LEYES, ver `§11`), no el "solo se le paga al socio".

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
| B6 | Fondeo de la Casa | **VIGENTE (E3):** presupuesto mensual (tope configurable) + fondeo deliberado y auditado hacia la Casa. *(La variante estricta "atado a `bank_tx`" quedó como opción, no default — ver `§12`.)* |

**Consecuencia central:** la **única** operación que crea fichas nuevas es el
**fondeo de la Casa** por el admin, **acotado por un presupuesto mensual** (tope
configurable) y auditado (E3). **Todo lo demás son transferencias de fichas que ya
existen** (depósito = transfer Casa→jugador; venta de fichas = transfer desde la
Casa). El saldo de la Casa es el **techo vivo** del sistema. *(El "aporte de capital
atado a `bank_tx`" original quedó superado por el presupuesto controlado — ver `§12`.)*

## 2. La cuenta "Casa"

- Un **usuario de sistema** (`is_system = true`, username reservado p.ej. `__casa__`),
  no logueable, con su propia wallet. Una por tenant.
- Es la **contraparte** de: emisión de depósitos, pago de retiros, bets/wins,
  comisiones, bonos, promos.
- Su `balance` = fichas que la Casa tiene disponibles para pagar. Su evolución =
  **GGR + fondeo de la Casa − premiaciones**. Puede acercarse a 0: si no le
  alcanza para pagar, el admin **fondea la Casa** dentro del presupuesto mensual
  (no se mintea libre, E3).
- La opera el admin vía endpoints dedicados (fondeo/presupuesto de la Casa, ver
  estado), con permiso de fondear (predefinido en `admin_tenant`, delegable) +
  `house.view`. Auditada siempre.

## 3. Reglas duras del supply

1. **Solo se mintea hacia la Casa**, y solo vía *fondeo de la Casa* dentro del
   presupuesto mensual, auditado (E3). Se elimina/cierra todo otro `mint` (admin
   libre, commissions.settle, vip, branches.sellChips, promos que minteaban).
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

### 5.5 Fondeo de la Casa (único minteo) — *flujo nuevo*
> **VIGENTE (E3, ver `§12`):** el fondeo es por **presupuesto mensual** (tope
> configurable) + fondeo deliberado y auditado. El "atado a `bank_tx`" de abajo
> quedó como **opción más estricta**, no como default.
- El admin **fondea la Casa**: monto + motivo obligatorio, dentro del **presupuesto
  mensual** (tope configurable), auditado (severity high).
- Con eso se **mintea** ese monto en fichas **a la Casa** (E3). Es la única vía de
  creación de fichas; el saldo de la Casa queda como techo vivo del sistema.
- *(Variante estricta opcional: atar cada fondeo a un `bank_tx` matcheado — mayor
  respaldo por-ficha, ya no es el mecanismo por defecto. Ver `§12`.)*

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
                        (depósitos + fondeo de la Casa) − (retiros pagados)
```

- Se suma como un chequeo más a `ledger_reconciliation_runs` (campo nuevo en el
  snapshot de supply: `backing`, `circulatingExCasa`, `backingGap`).
- **Política:** igual que Parte A → **solo alerta** si `circulación > respaldo`
  (señal de fuga o de que falta fondeo de la Casa). No bloquea.
- La wallet de la Casa puede ser negativa en "GGR" conceptual pero su `balance`
  nunca baja de 0 (constraint); si no puede pagar, el admin fondea la Casa.

## 7. Migración del estado actual (propuesta — a confirmar)

El sistema ya tiene fichas en circulación minteadas dispersas (el demo: ~10M).
Propuesta para introducir la Casa sin romper:

1. **Crear la Casa** (system user + wallet) en cada tenant (migration + seed).
2. **Baseline de fondeo:** sembrar la Casa con un *fondeo inicial*
   igual al supply legítimo actual, de modo que el arranque cuadre (la foto
   actual se toma como "fondeo ya aplicado"). Documentar el monto.
3. **Limpiar descuadres conocidos** primero (el +1M del admin y los de
   `test_user_3704` que detectó el validador) — son datos de testeo.
4. **Cortar el minteo disperso:** redirigir cada punto de minteo (commissions,
   vip, branches, promos, game win) a transferencias desde la Casa.
5. Cada paso, validado con el chequeo de la Parte A (que no aparezcan descuadres).

## 8. Fases de construcción (tras revisión)

- **B-build-1 · Fundaciones:** Casa (system user + wallet), permisos `house.*`,
  endpoint de estado de la Casa, baseline de fondeo, panel de tesorería.
- **B-build-2 · Ratio por método:** `chips_por_unidad` en métodos de pago + usar
  el ratio en depósito/retiro.
- **B-build-3 · Fondeo de la Casa:** flujo de fondeo por presupuesto mensual (E3); opción estricta atada a `bank_tx`.
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
3. ✅ **Baseline de migración: sembrar la Casa con el supply actual como fondeo
   inicial** (no destructivo). La foto actual de fichas en circulación se registra
   como "fondeo ya aplicado por el dueño". Los descuadres conocidos (+1M del
   admin, `test_user_3704`) se limpian ANTES de tomar la foto.
4. ✅ **Sucursales: la sucursal le compra fichas a la Casa** (transferencia desde
   la Casa; deja de mintear). El pago real se registra.

## 10. Control de exposición / topes de apuesta (provider externo)

**Contexto (plan del dueño):** a futuro se integrará un **proveedor externo de
iGaming** (agregador de juegos por API) que cobra una **comisión sobre el GGR**.
Riesgo: un bug o fraude que dispare el volumen apostado (ej. apostar 100M de
fichas) genera GGR real en el proveedor → **factura real**, aunque las fichas
fueran "de aire" (una fuga). Con provider externo, **el volumen apostado se
convierte en deuda real.**

**Mecanismo (la Casa como punto de control — B2):** como toda apuesta pasa por la
Casa, ahí se chequea un **tope de volumen apostado (turnover) por período
(mensual)** ANTES de aceptar la apuesta / mandarla al proveedor.

**Decisiones (2026-06-29):**
- **Dos niveles de tope:** por **jugador** (que ninguno solo dispare la exposición)
  y **global del tenant** (techo total del mes). Configurables por el dueño.
- **Al superarse: BLOQUEA** la apuesta (a diferencia del validador de fichas, que
  solo alerta) — porque cada apuesta de más es deuda real con el proveedor.
- Métrica: **turnover** (Σ apuestas del período). Acota el GGR ⇒ acota la comisión.
- Sirve YA con el mock (acota el daño de un leak en fichas) y queda listo para el
  proveedor real.

**No confundir con juego responsable:** los límites de responsible-gaming protegen
al JUGADOR (que no se funda); estos topes protegen al NEGOCIO (que un bug no
genere deuda con el proveedor). Mecanismo similar, propósito opuesto.

**Build:** junto con **B-build-4** (juego con la Casa), donde se toca el camino de
la apuesta. Contador de turnover por período + config de topes (jugador / global)
+ enforcement bloqueante en `placeBet`.

## 11. Comisiones por red (modelo operativo) — DISEÑO ACORDADO (2026-06-29)

> **Estado: DISEÑADO, pendiente de construir.** Es el "diseño operativo de
> comisiones" que estaba congelado; se descongeló y se cerró con el dueño.
> REEMPLAZA el modelo actual (reglas globales por rol, comisión sobre el
> depósito). Build grande (tamaño de un B-build entero) — hacer con foco
> dedicado.

### Modelo (decidido con el dueño)
- **Estructura en cascada:** cada operador le paga a su **hijo directo**.
  admin→socios, socio→distribuidores, distribuidor→cajeros. Cada nivel banca lo
  de su nivel de abajo, de lo suyo.
- **Base: NetWin (GGR del juego = Σ apostado − Σ ganado)** de cada red, por
  período (mensual). NO sobre depósitos (el modelo actual). Es lo más justo y el
  estándar de iGaming; calculable gracias a **B-build-4a** (el juego pasa por la
  Casa; `game_rounds` tiene bet/win por user). Se descartó "entrada" (paga aunque
  la Casa pierda) y "entrada−salida" (se distorsiona con saldos sin retirar).
- **Markup:** cada operador fija el **% (de la NetWin de la sub-red del hijo)**
  que le paga a cada hijo, y **se queda la diferencia** entre lo que cobra de su
  padre y lo que reparte. El admin fija el % del socio (top); el resto de la
  NetWin queda para la Casa.
- **Por hijo individual:** % distinto por cada hijo (no uno por rol).
- **Tope (BLOQUEO):** `child% ≤ parent%` siempre — no se puede pagar a un hijo más
  de lo que uno cobra. Markup sano (socio% ≥ distribuidor% ≥ cajero%); nadie opera
  a pérdida sin querer.
- **NetWin negativo → carryover:** si una red da NetWin negativo en un período, se
  arrastra al siguiente (el operador recupera la pérdida antes de volver a cobrar).
  Estándar iGaming; el operador comparte el riesgo de su red.
- **Pago al liquidar, dos formas (se elige por pago):**
  - **Fichas:** transfer interno operador→hijo. Las fichas siguen en la plataforma.
  - **Plata real (transferencia):** el hijo recibe plata por fuera; se **QUEMAN**
    las fichas equivalentes (salió plata del respaldo → salen fichas, para mantener
    1 ficha = 1 peso). Es, en el fondo, **un retiro de la comisión**.
- **Independientes excluidos:** no generan comisión (ya pagaron comprando fichas
  al por mayor).

### Qué hay que construir
- Cómputo de NetWin agregado **por sub-red por período** (jerarquía downstream)
  desde `game_rounds`.
- **Config por-red:** cada operador configura en su panel el % por hijo individual,
  con validación `child% ≤ parent%`. Permiso **delegable** nuevo (ej.
  `commissions.configure_network`) scopeado al downstream del actor.
- Acumulación por período + **saldo de carryover** por red.
- **Liquidación con pago dual** (fichas / plata real); el de plata real **quema
  fichas** (atado a la tesorería + el invariante de respaldo de B-build-6).
- Definir migración / convivencia con el modelo actual (reglas globales sobre
  depósito) — y con la pieza ya hecha de **B-build-5 (comisiones desde la Casa)**,
  que paga las comisiones *actuales* desde la Casa.

### Relación con el blindaje
- El pago en plata real (quema de fichas) es la misma mecánica que un retiro →
  encaja con el **invariante de respaldo (B-build-6)**.
- La base NetWin sale de **B-build-4a** (juego con la Casa).

### ⚠️ MODELO VIGENTE (LEYES C1–C6): DIFERENCIAL / OVERRIDE multinivel

> El modelo "la plataforma SOLO le paga al socio (monto completo, lo de abajo es
> off-platform)" que estaba acá **quedó superado**. La ley vigente es el **modelo
> diferencial / override multinivel** (C1–C6), que se computa y liquida
> **on-platform** en TODOS los niveles dependientes.

- **C1 — Diferencial (override).** Comisión = **NetWin (GGR) × tasa diferencial por
  nivel**. Cada nivel cobra la **diferencia entre su tasa y la del de abajo**. El
  total que paga la Casa queda **capado a la tasa del nivel más alto** de la cadena
  (la del socio). No es "todo al socio y que reparta afuera": cada nivel recibe su
  fila on-platform.
- **C2 — Tasas acotadas.** Cada tasa ≤ la del padre (override nunca negativo). El
  admin fija la del socio; el socio reparte hacia abajo (regla del techo).
- **C3 — Deuda arrastrada.** NetWin negativo genera deuda que se descuenta del
  próximo cobro; el operador **no paga de su bolsillo** (carryover).
- **C4 — Limpia, mensual, cash.** Sin deducciones por ahora (solo NetWin →
  comisión). Se liquida **mensual**, en efectivo por fuera (el settle quema fichas
  contables).
- **C5 — Solo dependientes.** Los independientes no cobran comisión (ganan por
  margen de reventa).
- **C6 — Configurar sin errores.** La pantalla de config debe explicar el modelo,
  mostrar ejemplos y tener un **simulador en vivo** con validación (cada tasa ≤ la
  del padre).

Esto coincide con la sección **"Modelo (decidido con el dueño)"** de arriba
(cascada con markup diferencial). *(Nota de build: el motor ya construido computa
la variante superada "solo al socio, monto completo" — ver hitos abajo; queda
pendiente realinearlo al diferencial multinivel C1–C6.)*

### Estado de construcción (incrementos B1→B4)

> ⚠️ Estos son **hitos de BUILD (B1–B4)**, renombrados desde el viejo "C1–C4" para
> **no chocar** con los códigos de LEY **C1–C6** (comisiones). No los confundas.

- **B1 · Config — HECHO** (`33c04c1`): `users.commission_rate` (mig 0036) + `PATCH
  /tenant/commissions/network-rate/:childUserId`. (El admin fija el % de cada socio;
  la config de niveles de abajo se sacará del panel — B4.)
- **B2 · Motor NetWin — HECHO** (`45ada5b`, reworked `99eb45e`, hardened
  `f752a61`): tabla `commission_network_periods` (mig 0037) +
  `NetworkCommissionsService.computePeriod` + `POST /network/compute` (admin) y
  `GET /network/periods` (scopeado). Decisiones (cerradas con doble verificación
  adversarial):
  - **gross(socio) = R_socio × subNetWin(toda su red)** (monto completo, NO el
    neto). Solo se emiten filas de **socios**.
  - Base = `Σ(bet)−Σ(win)` de `game_rounds` **`status='settled'`** por
    **`settled_at`** en período **half-open `[start,end)` UTC**.
  - `subNetWin` por subtree: solo **jugadores** (no-operadores) aportan; un
    operador que juega NO infla la red. Poda independientes por **flag** (cualquier
    rol).
  - Aritmética en **centavos BigInt**, un solo redondeo. **Idempotente**: advisory
    lock + DELETE no-`paid` + insert (saltea socios `paid` → settle parcial no
    congela el recompute).
  - **Carryover** encadenado (excl. `void`); negativo → payable 0 + arrastre. La
    **deuda de un ex-socio se sigue arrastrando** aunque deje de ser socio.
  - **Invariante estructural** (fail-closed): ningún socio puede colgar de otro
    socio (anidamiento → doble conteo) → aborta.
  - Limitaciones MVP: estructura/tasas ACTUALES (sin snapshot histórico);
    recompute de un mes viejo no recalcula en cascada (warning).
- **B3 · Liquidación — HECHO** (`99eb45e`, hardened `f752a61`):
  `NetworkCommissionsService.settlePeriods` + `POST /network/settle` (admin).
  Paga el `payable` de cada socio (status accrued→paid), atómico por fila
  (savepoint), idempotente:
  - **`chips`**: transfer Casa → socio (`WalletService.housePayCommission`).
  - **`cash`**: la Casa **QUEMA** el equivalente en fichas
    (`WalletService.houseBurn`, type `burn`) = retiro; el socio cobra plata real
    por fuera; guarda `settlement_reference`. Mantiene 1 ficha = 1 peso.
  - Columnas `settlement_method`/`reference`/`paid_at`/`settled_by` (mig 0038).
- **B4 · UI — HECHO** (`25d9131`): página `/network-commissions` (sidebar
  "Comisiones por red", gated `commissions.configure`): (1) tabla editable de %
  por socio, (2) computar período (selector de mes), (3) tabla de resultados +
  `SettleNetworkModal` para liquidar en fichas o plata real (con referencia).
  Endpoint `GET /network/socios` + hook `use-network-commissions`. Typecheck
  API=0/WEB=0. **Hitos de build B1–B4 COMPLETOS.** Pendiente: realinear el motor al
  modelo diferencial/override multinivel (C1–C6 de las LEYES) — hoy computa la
  variante superada "solo al socio, monto completo"; y sacar del panel la config de
  niveles de abajo del modelo viejo.

## 12 · REVISIÓN (2026-06-30): la Casa = PRESUPUESTO controlado (relaja §5.5)

> Tras diseñar el modelo de negocio completo (ver `docs/18` y `docs/17`), el dueño
> **relajó** el fondeo estricto de la Casa (§5.5, aporte de capital atado a bank_tx)
> por un modelo de **presupuesto controlado**, más flexible, cuyo objetivo es
> **limitar las fichas "ilimitadas" que habilitan los proveedores de juego** a un
> techo que el dueño controla.

**El modelo (banco central):**
- La Casa se fondea con un **PRESUPUESTO que crea el admin** (ej. 1M de fichas a
  inicio de mes). **NO** exige atar cada fondeo a una transferencia bancaria.
- **Cada fondeo lleva MOTIVO obligatorio + queda REGISTRADO** en el audit log
  (severity high).
- **Permiso de fondear:** predefinido **solo en `admin_tenant`**, pero **DELEGABLE**
  (el admin puede otorgarlo a un empleado de confianza; por default, solo el admin).
- **Todo lo demás DRENA de la Casa** (ventas a socios, cupos/floats de empleados,
  emisión a jugadores por depósito). **Nadie más crea fichas** → el **saldo de la
  Casa es el techo vivo**. Un empleado/socio/cajero NUNCA puede liberar más de lo
  que la Casa tiene.

**Empleado vs cajero:**
- **Cajero:** DUEÑO de su stock (lo compró; lo respalda su pago). Carga de su stock.
- **Empleado:** AGENTE de la Casa (no dueño). Se le da un **cupo LIMITADO** para
  mover fichas de la Casa; su carga drena la Casa. El cupo es control operativo
  (cuánto puede mover), no un respaldo propio.

**Trade-off aceptado (honesto):** NO garantiza "1 ficha = 1 peso verificado en banco"
por-ficha; eso lo cuidan los **controles internos** (depósitos **matcheados contra el
banco** + **separación de funciones**: el que registra la plata ≠ el que carga +
**doble firma** en cargas manuales). Lo que SÍ garantiza: el **total** de fichas nunca
supera el presupuesto, y **solo el admin emite** → la **pérdida máxima está acotada**.
Es "estricto donde conviene + techo global flexible".

**Alcance del 1:1 (importante):** la tesorería 1:1 aplica SOLO a **TU entorno** (red
propia + socios **dependientes**, donde la Casa banca). Las fichas **vendidas a socios
INDEPENDIENTES** salen de tu backing (las respalda el socio; vos cobraste el mayorista)
y se cuentan **aparte** (ver `docs/17` I-Sec-4). No se mezclan.

**Estado:** decidido, pendiente de construir. Reemplaza el §5.5 estricto como mecanismo
de fondeo por defecto (el aporte atado a bank_tx queda como opción más estricta si se
quiere).
