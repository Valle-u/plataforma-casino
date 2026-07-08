# 00 · Visión del Producto

> ⚠️ Alineado con docs/LEYES.md (2026-07-07). Ante cualquier duda, mandan las LEYES + docs/20-modelo-operativo.

> Estado: **decidido**. No modificar sin autorización del dueño del proyecto.

---

## 1. Qué es

Plataforma de **casino virtual multi-tenant white-label**. Un único producto que se vende a múltiples operadores ("clientes" / "tenants"). Cada operador recibe:

- Su propia base de datos (aislamiento total).
- Su propio dominio y branding (logo, colores, copys).
- Su propia jerarquía de usuarios (socios, distribuidores, cajeros, empleados).
- Sus propios reportes financieros.
- Acceso al catálogo de juegos integrado vía agregador (cuando esté contratado).

---

## 2. Para quién

### Cliente final del dueño de la plataforma
**Operadores de casino virtual** que quieran lanzar su negocio sin construir la tecnología desde cero. Perfil típico (Argentina, fase inicial):
- Operadores informales con clientela existente que hoy operan por WhatsApp y planillas.
- Operadores chicos/medianos que quieren profesionalizar la operación.
- Eventualmente, operadores más grandes que busquen white-label.

### Usuarios de la plataforma desplegada
- **Jugadores** (usuarios finales): apuestan con fichas.
- **Cajeros**: cargan/retiran fichas a jugadores **solo en el modelo INDEPENDIENTE** (bancan
  su propio stock, R4). En el modelo **centralizado** el cajero es comercial puro y **no toca
  plata**: la carga/retiro la manejan solo el admin + sus empleados (R3).
- **Distribuidores**: gestionan grupos de cajeros (dependiente = comercial puro sin plata, R3;
  independiente = revende stock propio en cadena, R4).
- **Socios**: manejan su red y publicidad. **Dependiente** = cobra **comisión %** (C1/C5);
  **Independiente** = gana por **margen de reventa** de fichas (no comisión, R4/C5).
- **Empleados**: soporte, marketing, finanzas (permisos a la carta). Los tiene el admin
  (red central) y los socios independientes (su sub-red); se pagan por fuera (R7).
- **Admin Tenant**: dueño del operador, ve y controla todo lo suyo.
- **Super-Admin**: dueño de la plataforma (vos), ve todos los tenants.

---

## 3. Modelo de negocio

El dueño de la plataforma cobra a cada tenant un **% sobre el netwin** (ganancia neta del casino: apostado − pagado − bonificaciones). Esto es el **billing plataforma → tenant** (super-admin), distinto de la comisión que un socio dependiente cobra dentro de un tenant.

Implicaciones técnicas directas:
- La trazabilidad financiera por tenant debe ser **impecable y auditable**.
- El cálculo de netwin se computa en tiempo real. El **billing plataforma → tenant** puede cerrarse por períodos (diario / semanal / mensual configurable). **Ojo, no confundir:** la **comisión del socio dependiente** dentro del tenant se liquida **mensual** (C4) y su base es NetWin = GGR bruto (C1).
- Reportes accesibles tanto al super-admin como al admin del tenant, con cifras consistentes entre ambas vistas.
- Sistema de facturación interna: el super-admin debe poder emitir/cobrar comisiones automáticamente.

---

## 4. Jurisdicción y consideraciones legales

- **Mercado inicial**: Argentina.
- **Moneda**: ARS y criptomonedas (USDT principalmente).
- **Estado regulatorio**: el operador puede o no estar licenciado. La plataforma **no asume responsabilidad regulatoria** del tenant; cada tenant define su propio cumplimiento.
- KYC/AML configurable **por tenant**: cada cliente decide qué nivel de verificación pedir.

---

## 5. Diferenciadores buscados

Lo que tiene que separar este producto del resto del mercado:

1. **Trazabilidad granular** de fichas y usuarios, navegable visualmente desde el panel.
2. **Sistema de permisos atómicos** (no solo roles): cada acción se puede activar/desactivar por usuario.
3. **Integración nativa con Kommo** como livechat + CRM de marketing.
4. **Sistema de publicidad / referidos** robusto: links por socio, códigos, atribución multi-touch, dashboard de campañas.
5. **Personalización profunda** del look & feel desde el panel (sin tocar código).
6. **Doble flujo de carga**: manual (cajero busca usuario y carga) + autoservicio (usuario sube comprobante, operador aprueba).
7. **Multi-método de pago**: transferencias bancarias + criptomonedas, con extensibilidad a otros.
8. **Diseño limpio, estético, sobrio**: contraste deliberado con la estética cargada del mercado.

---

## 6. Principios de diseño del producto

| Principio | Implicación |
|---|---|
| **Trazabilidad ante todo** | Toda operación financiera deja registro inmutable en `audit_log`. |
| **Configurable por tenant** | Si dos clientes pueden querer comportamientos distintos, va a configuración. |
| **Extensible por adapter** | Proveedores de juegos, métodos de pago, CRMs: contratos abstractos + adapters. |
| **Permisos primero** | Toda acción del backend valida permisos antes de ejecutar. |
| **Aislamiento entre tenants** | DB por tenant + revisión defensiva en cada query. |
| **Preparado para volumen** | Decisiones tempranas que faciliten caching, colas y particionado. |

---

## 7. Lo que **no** somos

Para evitar scope creep:

- **No somos un sportsbook**. Solo casino (slots, live, mesa). El día que se sume sportsbook se evalúa aparte.
- **No somos una pasarela de pagos**. Integramos pasarelas; no las construimos.
- **No somos un proveedor de juegos** (al menos en MVP). Integramos agregadores. Juegos propios queda como roadmap futuro.
- **No somos un CRM completo**. Usamos Kommo para esa capa.

---

## 8. Visión a 12-18 meses

- MVP funcional con 1-2 tenants reales operando.
- Catálogo de juegos vía agregador real integrado.
- Kommo integrado como livechat y CRM de campañas.
- Sistema de afiliados/referidos maduro.
- Panel admin con reportería avanzada y exportes.
- Onboarding de tenant nuevo automatizable en menos de 1 hora.
- Roadmap abierto a juegos propios.
