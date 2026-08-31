# 01 · Glosario

> ⚠️ Alineado con docs/LEYES.md (2026-07-07). Ante cualquier duda, mandan las LEYES + docs/20-modelo-operativo.

> Estado: **vivo**. Se amplía a medida que aparecen términos. No reemplazar significados existentes sin acuerdo.

Vocabulario común a todo el proyecto. Cualquier término ambiguo en código, docs o conversación debe estar acá.

---

## A

**Adapter**
Implementación concreta de un contrato/interface (ej: `PragmaticGameProviderAdapter` cumple `IGameProvider`). El patrón nos permite enchufar proveedores nuevos sin tocar el core.

**Admin Tenant**
Rol más alto **dentro de un tenant**. Es el dueño del casino cliente. Ve todo lo de su operación pero nada de otros tenants.

**Agregador**
Proveedor externo que da acceso a un catálogo de juegos de múltiples estudios mediante una sola integración (ej: SoftSwiss, Pragmatic Aggregator, EveryMatrix).

**Audit Log**
Tabla inmutable que registra **toda acción sensible** (cargas, retiros, cambios de permisos, aprobaciones de depósitos, logins privilegiados). Nunca se borra. Es la fuente de verdad para auditorías y soporte.

**ARS**
Peso argentino. Moneda base inicial de la plataforma.

---

## B

**Bono**
Crédito otorgado a un usuario que sigue reglas de wagering (multiplicador de apuesta antes de poder retirarse). Afecta cálculo de netwin.

---

## C

**Cajero**
Rol operativo. Su significado depende del **modelo** (ver *Dependiente vs Independiente*):
- **DEPENDIENTE** (modelo centralizado): comercial puro. **No toca plata** (no carga/quita fichas, no aprueba dep/retiros); solo publicidad y gestión de su equipo, y cobra comisión % (R3). Toda la plata la manejan el admin + sus empleados.
- **INDEPENDIENTE** (modelo descentralizado): banca lo suyo. **Compra su propio stock de fichas** al de arriba (paga primero, sin crédito), fija su precio de reventa y carga a sus jugadores desde ese stock propio (R4). Su ingreso es el **margen de reventa**, no comisión.

**Casa / Tesorería (`__casa__`)**
Usuario de **sistema** dedicado (no humano) cuya wallet es la tesorería del tenant. Es la **única fuente de minteo** (E3): crea fichas acotado por un **presupuesto mensual** + fondeo auditado. La apuesta perdida entra a la Casa y el premio se paga desde la Casa; comisiones/bonos/promos salen de la Casa (no se mintean de la nada). La venta de fichas a un independiente es una **transferencia desde la Casa**, no un mint (E3). El admin la opera, pero su plata vive aparte de la wallet personal del admin.

**Comisión diferencial (override)**
Modelo de comisión de la red **dependiente** (C1). La comisión de un socio = **NetWin (GGR) × tasa diferencial por nivel**: cada nivel cobra la **diferencia** entre su tasa y la del nivel de abajo (override). Cada tasa es ≤ la del padre (nunca negativa, C2); el total que paga la Casa queda capado a la tasa del nivel más alto de la cadena. Se liquida mensual, sin deducciones por ahora (C4). Solo aplica a dependientes; los independientes ganan por margen de reventa (C5). No confundir con el billing plataforma → tenant.

**Comprobante**
Imagen/PDF que el usuario sube como prueba de transferencia bancaria o cripto al solicitar un depósito. Vive en storage S3-compatible, asociado a la solicitud.

**Conciliación**
Proceso (manual o automático) por el cual se cruzan los movimientos internos de fichas con los movimientos reales de pagos (banco, exchange) para detectar discrepancias.

---

## D

**DB de control / `platform_control`**
Base de datos central que contiene el registro de tenants, dominios, planes, super-admins. **No** contiene datos de jugadores ni operaciones financieras de tenants.

**DB de tenant**
Base de datos exclusiva de un tenant. Contiene **todos** los datos operativos de ese cliente (usuarios, fichas, transacciones, etc.).

**Dependiente vs Independiente**
Los dos modelos de banca (ver `docs/20-modelo-operativo`):
- **DEPENDIENTE (centralizado):** socios / distribuidores / cajeros son **comerciales puros**: NO tocan plata (no aprueban dep/retiros, no cargan/quitan fichas, no corrigen). Solo publicidad + equipo + comisión % (R3). **Toda la plata central la manejan solo el admin + sus empleados.** La Casa banca todo.
- **INDEPENDIENTE (descentralizado):** cada nivel **compra fichas al de arriba** (paga primero, sin línea de crédito), **fija su propio precio de reventa**, banca lo suyo y aprueba a sus hijos directos (R4). Su sub-red está **aislada económicamente**: ningún actor externo la fondea ni le mueve fichas salvo el mecanismo de intervención super-admin (E8/R6). Ingreso = margen de reventa (no comisión, C5).

**Distribuidor**
Subtipo de Socio. Su rol depende del modelo (ver *Dependiente vs Independiente*): **dependiente** = comercial puro sin tocar plata (R3); **independiente** = compra stock propio y lo revende hacia abajo en cadena, bancando lo suyo (R4). Cuelga jerárquicamente de un Socio.

---

## E

**Empleado**
Rol con permisos a la carta. No tiene set de permisos por defecto fuerte; el admin del tenant le configura específicamente qué puede ver/hacer (soporte, marketing, finanzas, etc.).

---

## F

**Fichas**

> ⚠️ **Se llaman FICHAS. Nunca "chips".** En todo texto que lea una persona —
> interfaz, mensajes de error, notificaciones, documentación, mensajes al dueño —
> la unidad es **ficha / fichas**. Es la palabra del negocio y la que usan los
> operadores; "chips" es una traducción que se cuela sola y confunde.
>
> **Excepción, en código:** los identificadores van en inglés por convención del
> proyecto (ver AGENTS.md), así que `amountChips`, `chips_por_unidad` o
> `sellChips` se quedan como están. Lo que nunca puede pasar es que "chips"
> llegue a la pantalla.
>
> **Ojo, hay un homónimo:** en la interfaz también se llaman *chips* los botones
> chiquitos tipo píldora (los filtros del lobby, los canales de notificación).
> Ésos SÍ son chips y no se tocan. Si dice "chips de proveedor" o "channel
> chips", habla de botones, no de plata.

Unidad interna de valor del casino. **1 ficha = 1 peso (ARS), FIJO** (E1). El sistema crea (mint) y destruye (burn) fichas; no hay pool externo. Lo configurable es el **ratio fiat ↔ ficha por método de pago** (ej. 1 USDT = N fichas), no la equivalencia peso-ficha, que es fija. Toda operación de juego se mide en fichas.

---

## G

**GGR (Gross Gaming Revenue) / NetWin**
`Σ(bet) − Σ(win)` = apostado total − pagado total, **bruto** (antes de descontar bonos/comisiones/costos). En este proyecto **GGR = NetWin**: es la **base de la comisión del socio dependiente** (C1), sin deducciones por ahora (C4). No confundir con **NGR** (ver *NGR*).

**NGR (Net Gaming Revenue)**
GGR **neto** de bonos/costos. **No** es la base de la comisión del socio (esa es NetWin = GGR bruto, C1). NGR aplica a otra capa: el **billing plataforma → tenant** (lo que el super-admin cobra al tenant) y el **módulo de costos futuro** de la red dependiente (C4). No confundir NGR con NetWin.

---

## I

**Idempotency Key**
Identificador único que acompaña operaciones financieras críticas para evitar que un reintento de red genere doble carga/retiro.

---

## J

**Jugador**
Sinónimo de **Usuario final**. El que apuesta.

---

## K

**Kommo**
CRM externo (ex-amoCRM). Lo integramos como livechat para soporte y, en futuro, como motor de campañas.

**KYC / AML**
*Know Your Customer* / *Anti-Money Laundering*. Procesos de verificación de identidad y prevención de lavado. Configurables por tenant.

---

## N

**Netwin**
En este proyecto, **NetWin = GGR = `Σ(bet) − Σ(win)` bruto** (C1) — ver *GGR / NetWin*. Es la **base de la comisión del socio dependiente** (intra-tenant), sin deducciones por ahora (C4). El concepto "GGR menos bonos/costos" corresponde a **NGR** (billing plataforma → tenant + módulo de costos futuro), no a NetWin — no confundir.

**Presupuesto mensual de minteo**
Tope configurable que acota cuántas fichas puede crear la **Casa** (`__casa__`) por mes (E3). El minteo legítimo = presupuesto mensual + fondeo deliberado y auditado; ningún otro camino crea fichas. Sustituye al viejo "aporte de capital" atado uno-a-uno a bank_tx.

---

## P

**Permiso atómico**
Acción individual habilitable/deshabilitable (ej: `wallet.load`, `deposits.approve`, `reports.netwin.view`). Los roles agrupan permisos por defecto, pero cada usuario puede tener overrides individuales.

---

## R

**RBAC**
*Role-Based Access Control*. Permisos asignados por rol.

**RBAC + ABAC híbrido**
Lo que usamos: RBAC como base + permisos atómicos individuales por usuario que pueden sumar (`grant`) o restar (`revoke`) sobre los del rol.

**Referido**
Usuario captado mediante un link/código de un Socio. La atribución se mantiene para revenue share del Socio.

**RGS (Remote Game Server)**
Servidor del proveedor de juegos donde corre la lógica del juego. Nuestro backend se comunica con él vía wallet API.

**RLS (Row-Level Security)**
Mecanismo de Postgres para aislar filas por reglas. **No lo usamos para tenants** (porque cada tenant tiene su propia DB), pero sí puede aplicarse intra-tenant para aislar datos por jerarquía.

**Rollback (transacción)**
En contexto financiero: revertir una operación previamente confirmada. Crea siempre una entrada nueva en `audit_log` (nunca se modifica el original).

---

## S

**Saldo flotante / Stock del independiente**
Stock de fichas **propio de un operador INDEPENDIENTE** (socio/distribuidor/cajero), que **compró y pagó** al de arriba (R4). Es **capital propio del independiente**, no "plata del tenant que canaliza": banca su operación con él. En el modelo **centralizado no existe** este saldo — el cajero/distribuidor dependiente es comercial puro y no toca fichas (R3); la plata la maneja la Casa vía admin + empleados.

**Socio**
Rol que maneja una red propia (distribuidores/cajeros/jugadores vía sus links). Su ingreso depende del modelo (ver *Dependiente vs Independiente*): **DEPENDIENTE** = cobra **comisión %** sobre la NetWin de su red, modelo diferencial mensual (C1/C4); **INDEPENDIENTE** = gana por **margen de reventa** de fichas, no comisión (R4/C5).

**Super-Admin**
Rol más alto **del sistema entero**. Es el dueño de la plataforma (vos). Ve todos los tenants. Solo existe en la DB de control.

---

## T

**Tenant**
Cliente de la plataforma. Cada tenant es un casino virtual independiente, con su propia DB, dominio y operación.

**Tenant Context**
Objeto de runtime que el backend lleva en cada request: contiene `tenant_id`, conexión a la DB del tenant y metadata (plan, branding). Se resuelve en un middleware temprano a partir del dominio.

**Trazabilidad**
Capacidad de reconstruir el camino completo de una ficha o usuario: quién la creó, quién la movió, cuándo y por qué. Implementada vía `audit_log` + tablas de transacciones inmutables.

---

## U

**USDT**
Tether sobre red TRON o ERC-20. Cripto principal soportada en MVP.

**Usuario final**
Jugador. Accede al sitio público (no al panel de control).

---

## W

**Wagering**
Requisito de apostar X veces el monto de un bono antes de poder retirar fichas asociadas a ese bono.

**Wallet**
Subsistema interno que maneja saldos de fichas de cada usuario. **Toda** operación sobre saldos pasa por wallet. Nunca se modifica un balance directamente fuera de wallet.

**White-label**
Producto que el cliente revende como propio (con su marca, dominio, etc.). Es nuestro modelo.
