# 18 · Modelo de negocio — el mapa (los 3 setups)

> **Norte del producto (2026-06-30).** La plataforma **DISEÑA** 3 setups pero el ALCANCE
> ACTIVO (2026-06-30) es **red propia + socio INDEPENDIENTE**. El socio DEPENDIENTE
> queda **CLAUSURADO / DORMIDO** por decisión del dueño (complica el foco actual); la
> lógica y el código se **mantienen intactos** para reactivarlo en el futuro.
> Detalle técnico del independiente en `docs/17-modelo-independiente.md`; comisiones por
> red (base del dependiente) en `docs/16-tesoreria.md §11`.

## Estado por setup (foco actual)

| Setup | Estado | Nota |
|---|---|---|
| **Tu red propia** (socio madre) | 🟢 **ACTIVO** | Foco de construcción |
| **Socio INDEPENDIENTE** | 🟢 **ACTIVO** | Foco de construcción — spec en `docs/17` |
| **Socio DEPENDIENTE** | 🟡 **DORMIDO** (clausurado 2026-06-30) | Lógica preservada (comisiones C1–C4 + Casa banca); no se ofrece ni construyen las piezas nuevas del dependiente hasta reactivarlo |

## Los 3 setups

### 1. Tu red propia — vos = "socio madre"
- Vos operás **tu propio casino**: tu red de distribuidores / cajeros / usuarios. Quien entra
  al **dominio base** y se registra cae **bajo tu red** (admin / socio madre).
- **Quién banca:** tu **Casa**. Vos sos la casa.
- **Tu riesgo:** sí (es tu casino). **Tu ganancia:** el **GGR** de tu red.

### 2. Socio INDEPENDIENTE
- Un socio externo que **compra su panel** + **compra fichas mayoristas** y **banca su propia red**.
- **Quién banca:** el **socio** (con su capital / stock de fichas). Riesgo de juego: **del socio**.
  **Cero riesgo de juego para vos.**
- **Tus ingresos:** (a) **precio del panel**; (b) **margen de la venta mayorista de fichas**.
- Detalle técnico completo: `docs/17`.

### 3. Socio DEPENDIENTE — franquiciado / llave en mano  🟡 CLAUSURADO (2026-06-30)

> **DORMIDO por decisión del dueño.** La lógica queda documentada y el código
> existente se mantiene (comisiones C1–C4 + Casa banca). No se ofrece ni se
> construyen las piezas nuevas (capa de costos/deducciones, liquidación mensual)
> hasta que se reactive.

- Un socio externo que **paga el producto** (el precio del panel + la posibilidad de tener su
  plataforma) y **trae la gente**. **Vos operás todo.**
- **Vos ponés (y le cobrás):** los **empleados** que atienden a sus clientes, la **cuenta
  bancaria**, y el **costo de las fichas** que pagás a los proveedores.
- **Quién banca:** tu **Casa** (el "capital inicial" del socio es el **precio del producto**,
  NO un bankroll → **el riesgo de juego es TUYO**).
- **El socio cobra:** mensualmente su **comisión** (% de la **NetWin** de su red) **NETO** de
  esos costos (empleados + banco + fichas).
- **Tus ingresos:** (a) **precio del producto** (upfront); (b) el **GGR de su red menos su
  comisión neta**; (c) **recuperás tus costos operativos** vía las deducciones.

## Resumen: ingresos del tenant por setup

| Fuente de ingreso | Tu red | Independiente | Dependiente |
|---|---|---|---|
| GGR del juego | ✅ (tuyo) | — (del socio) | ✅ (menos su comisión) |
| Venta de fichas | — | ✅ margen mayorista | — (fichas al costo, provistas por vos) |
| Precio del panel / producto | — | ✅ | ✅ (upfront) |
| Recupero de costos operativos (staff/banco/fichas) | — | — | ✅ (deducidos de la comisión) |

## Quién arriesga el juego

| | Tu red | Independiente | Dependiente |
|---|---|---|---|
| Riesgo de juego | **Vos** | **El socio** | **Vos** |
| Capital que pone el socio | — | Bankroll (banca lo suyo) | Precio del producto (no es bankroll) |

## Estado de construcción

- **Independiente (🟢 activo):** diseñado (`docs/17` v3), a construir (I-0..I-6).
- **Tu red propia (🟢 activo):** el modelo dependiente aplicado a **vos** (tu Casa banca tu red).
  Ya funciona a nivel juego; usa la capa de comisiones/costos según corresponda.
- **Dependiente (🟡 dormido):** comisiones por red (C1–C4) + la Casa banca → **construidos y
  operativos** (se preservan). **En pausa** la capa de costos/deducciones + liquidación mensual
  hasta que se reactive el setup.
- **Transversal nuevo (🟢 activo):** el **cobro del panel/producto** a socios independientes
  (para dependientes queda dormido con el resto).

## Pendiente de definir (billing)

- Precio del panel al socio **independiente**: ¿upfront, mensual, o ambos?
- (Dependiente, cuando se reactive: el "capital inicial" es upfront; falta si hay además un
  abono; y cómo se calculan los costos operativos que netean su comisión.)
