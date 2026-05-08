# 01 · Glosario

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
Rol operativo que tiene un saldo cargado por su superior (distribuidor/socio/admin) y lo distribuye cargando fichas a jugadores. Su saldo baja cuando carga; sube cuando recibe transferencias o procesa retiros.

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

**Distribuidor**
Subtipo de Socio. Gestiona un grupo de cajeros, les carga saldo y supervisa su operación. Cuelga jerárquicamente de un Socio.

---

## E

**Empleado**
Rol con permisos a la carta. No tiene set de permisos por defecto fuerte; el admin del tenant le configura específicamente qué puede ver/hacer (soporte, marketing, finanzas, etc.).

---

## F

**Fichas**
Unidad interna de valor del casino. Equivalencia con moneda fiat configurable por tenant (ej: 1 ficha = 1 ARS, o 1 ficha = 100 ARS). Toda operación de juego se mide en fichas.

---

## G

**GGR (Gross Gaming Revenue)**
Apostado total − pagado total. Antes de descontar bonos/comisiones.

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
GGR menos bonos pagados, comisiones de proveedores y otros descuentos definidos en la configuración del tenant. **Es la base sobre la que el dueño de la plataforma cobra su comisión.**

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

**Saldo flotante / Saldo de cajero**
Reserva de fichas que un cajero administra. Se le carga desde un nivel superior. No es plata del cajero; es plata del tenant que el cajero canaliza.

**Socio**
Rol con revenue share. Tiene una red propia (cajeros vía sus distribuidores, usuarios vía sus links de referido). Cobra comisión sobre la actividad de su red.

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
