# 18 · Modelo de negocio — el mapa (los 3 setups)

> ⚠️ Alineado con docs/LEYES.md (2026-07-07). Ante cualquier duda, mandan las LEYES + docs/20-modelo-operativo.

> **Norte del producto (2026-07-07).** La plataforma **DISEÑA** 3 setups y el ALCANCE
> ACTIVO es **red propia + socio DEPENDIENTE + socio INDEPENDIENTE** (los tres en
> paralelo, ver `docs/20-modelo-operativo`). El socio DEPENDIENTE está **VIVO**: se
> reactivó como **franquicia comercial pura** (R3) y es el sujeto de **todo** el modelo
> de comisiones (C1–C6). Detalle técnico del independiente en
> `docs/17-modelo-independiente.md`; comisiones por red (base del dependiente) en
> `docs/16-tesoreria.md §11`.

## Estado por setup (foco actual)

| Setup | Estado | Nota |
|---|---|---|
| **Tu red propia** (socio madre) | 🟢 **ACTIVO** | Foco de construcción |
| **Socio INDEPENDIENTE** | 🟢 **ACTIVO** | Foco de construcción — spec en `docs/17` |
| **Socio DEPENDIENTE** | 🟢 **ACTIVO** | Franquicia comercial pura (R3): no toca plata; solo publicidad + equipo + comisión %. Sujeto del modelo de comisiones diferencial (C1–C6) |

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

### 3. Socio DEPENDIENTE — franquiciado / llave en mano  🟢 ACTIVO

> **VIVO como franquicia comercial pura (R3).** El socio dependiente no toca plata: solo
> publicidad, gestión de su equipo y cobro de comisión %. Es el sujeto de todo el modelo
> de comisiones diferencial (C1–C6). La **capa de costos/deducciones es un módulo futuro**
> (C4): hoy la comisión es NetWin limpio.

- Un socio externo que **paga el producto** (el precio del panel + la posibilidad de tener su
  plataforma) y **trae la gente**. **Vos operás todo.**
- **Vos ponés (y le cobrás):** los **empleados** que atienden a sus clientes, la **cuenta
  bancaria**, y el **costo de las fichas** que pagás a los proveedores.
- **Quién banca:** tu **Casa** (el "capital inicial" del socio es el **precio del producto**,
  NO un bankroll → **el riesgo de juego es TUYO**).
- **El socio cobra:** mensualmente (C4) su **comisión** = **NetWin (GGR) × tasa diferencial
  por nivel** (C1). Hoy es **NetWin limpio, sin deducciones** (C4); los costos flexibles
  (empleados + banco + fichas) son un **módulo futuro**, no netean la comisión todavía.
- **Tus ingresos:** (a) **precio del producto** (upfront); (b) el **GGR de su red menos su
  comisión**; (c) el recupero de costos operativos queda para el módulo de costos futuro.

## Resumen: ingresos del tenant por setup

| Fuente de ingreso | Tu red | Independiente | Dependiente |
|---|---|---|---|
| GGR del juego | ✅ (tuyo) | — (del socio) | ✅ (menos su comisión) |
| Venta de fichas | — | ✅ margen mayorista | — (fichas al costo, provistas por vos) |
| Precio del panel / producto | — | ✅ | ✅ (upfront) |
| Recupero de costos operativos (staff/banco/fichas) | — | — | 🔜 módulo futuro (hoy NO netea la comisión, C4) |

## Quién arriesga el juego

| | Tu red | Independiente | Dependiente |
|---|---|---|---|
| Riesgo de juego | **Vos** | **El socio** | **Vos** |
| Capital que pone el socio | — | Bankroll (banca lo suyo) | Precio del producto (no es bankroll) |

## Estado de construcción

> Nota: los hitos **B1–B4** de abajo son **fases de build** del sistema de comisiones, no
> los códigos de ley **C1–C6** (esos son las reglas del modelo diferencial). No confundir.

- **Independiente (🟢 activo):** diseñado (`docs/17` v3), a construir (I-0..I-6).
- **Tu red propia (🟢 activo):** el modelo dependiente aplicado a **vos** (tu Casa banca tu red).
  Ya funciona a nivel juego; usa la capa de comisiones según corresponda.
- **Dependiente (🟢 activo):** comisiones por red (hitos de build **B1–B4**) + la Casa banca →
  **construidos y operativos**. El modelo vigente es el **diferencial mensual limpio** (C1–C6).
  La capa de costos/deducciones es un **módulo futuro** (C4).
- **Transversal nuevo (🟢 activo):** el **cobro del panel/producto** a socios (independientes y
  dependientes).

## Pendiente de definir (billing)

- Precio del panel al socio **independiente**: ¿upfront, mensual, o ambos?
- Dependiente: el "capital inicial" es upfront; falta si hay además un abono. El **módulo de
  costos futuro** definirá si (y cómo) los costos operativos netean la comisión (hoy no lo
  hacen, C4).
