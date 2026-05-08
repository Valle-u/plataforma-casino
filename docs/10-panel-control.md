# 10 · Panel de Control

> Estado: **decidido en estructura**. Detalles visuales se afinan al armar el sistema de diseño (`docs/11-personalizacion.md`).

Define la arquitectura, secciones por rol, KPIs, layout, mobile UX y funcionalidades transversales del panel administrativo y operativo (`apps/panel`).

---

## 1. Principios

| Principio | Implicación |
|---|---|
| **Una app, vistas por rol** | `apps/panel` único. El rol del usuario determina qué secciones ve y qué acciones puede ejecutar. |
| **Permisos primero** | Toda sección, botón y acción se renderiza/habilita según permisos atómicos del usuario. La UI nunca muestra algo que el backend rechazaría. |
| **Sobrio y limpio** | Densidad cómoda por default, dark mode default, paleta neutral con acentos del tenant. Sin estética "casino chillón" — eso queda para `apps/web`. |
| **Mobile-first donde importa** | Flujos de Cajero y Socio optimizados para mobile (cargar fichas, ver chats, aprobar solicitudes). Admin Tenant prioriza desktop. |
| **Tiempo real cuando aporta** | Socket.io para notificaciones, contadores, badges, chats. No abusar (no todo necesita estar live). |
| **Auditoría visible** | Todo lo sensible que se ejecuta desde el panel queda registrado en `audit_log` y es navegable desde el módulo de auditoría. |

---

## 2. Arquitectura

### 2.1 App única
`apps/panel` (Next.js 15 App Router). El árbol de rutas se sirve igual a todos los roles; los layouts y páginas chequean permisos y renderizan condicionalmente.

```
apps/panel/
├── app/
│   ├── (auth)/
│   │   ├── login/
│   │   ├── 2fa/
│   │   └── recover/
│   ├── (panel)/                  -- requiere auth
│   │   ├── layout.tsx            -- sidebar + topbar + main
│   │   ├── page.tsx              -- dashboard (varía por rol)
│   │   ├── usuarios/
│   │   ├── wallet/
│   │   ├── depositos/
│   │   ├── retiros/
│   │   ├── apuestas/
│   │   ├── promos/
│   │   ├── referidos/
│   │   ├── antifraude/
│   │   ├── livechat/
│   │   ├── reportes/
│   │   ├── auditoria/
│   │   ├── configuracion/
│   │   └── personalizacion/
│   └── api/                      -- API routes propias del panel (BFF si hace falta)
├── components/
│   ├── layout/                   -- sidebar, topbar, breadcrumbs
│   ├── data-tables/              -- listados con filtros + paginación
│   ├── widgets/                  -- KPIs del dashboard
│   ├── forms/
│   └── livechat/
└── lib/
    ├── permissions/              -- helpers de UI gating
    ├── api-client/
    └── socket/
```

### 2.2 Responsive

- **Desktop-first** para Admin Tenant y Super-Admin (data densa).
- **Mobile-optimized** para flujos críticos de Cajero y Socio:
  - "Buscar usuario y cargar fichas" (mobile-prioritario).
  - "Solicitudes de depósito" con vista de comprobante.
  - "Solicitudes de retiro" con aprobación rápida.
  - "Livechat" con UX tipo WhatsApp.
- Breakpoints Tailwind estándar: `sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1536`.
- Sidebar colapsa a drawer en `< md`. Topbar siempre visible.

### 2.3 Dark mode

- **Default oscuro** + switch a claro en preferencias del usuario.
- Persistencia en `user_preferences.theme`.
- Variables CSS via Tailwind + tokens del tenant (ver `docs/11-personalizacion.md`).

### 2.4 i18n

- Default `es-AR`.
- i18n-ready desde MVP: `next-intl` o similar. Strings en archivos por locale.
- Otros idiomas se suman en v2.

---

## 3. Layout y navegación

### 3.1 Estructura visual

```
┌─────────────────────────────────────────────────────────────────┐
│ TOPBAR                                                          │
│ [Logo Tenant]  [⌘K Search]   [🔔 Notifs]  [Tenant ▾] [User ▾]   │
├──────────────┬──────────────────────────────────────────────────┤
│              │                                                  │
│  SIDEBAR     │  BREADCRUMBS                                     │
│              │                                                  │
│  ▸ Dashboard │  PAGE CONTENT                                    │
│  ▸ Usuarios  │                                                  │
│  ▸ Wallet    │                                                  │
│  ▸ Depósitos │                                                  │
│  ▸ Retiros   │                                                  │
│  ▸ Apuestas  │                                                  │
│  ▸ Promos    │                                                  │
│  ▸ Referidos │                                                  │
│  ▸ Livechat  │                                                  │
│  ▸ Reportes  │                                                  │
│  ▸ Auditoría │                                                  │
│  ▸ Config.   │                                                  │
│              │                                                  │
└──────────────┴──────────────────────────────────────────────────┘
```

### 3.2 Sidebar

- Items renderizados según permisos del usuario.
- Items con sub-items se expanden inline.
- Estado collapse/expand persistente.
- En `< md`: drawer con backdrop.

### 3.3 Topbar

- **Logo del tenant** (clickeable → home del panel).
- **Búsqueda global** (⌘K / Ctrl+K).
- **Notificaciones** (campana con badge de no-leídas, dropdown con feed).
- **Selector de tenant** (solo super-admin si maneja varios).
- **User menu**: perfil, preferencias (tema, densidad, idioma), 2FA, logout.

### 3.4 Breadcrumbs

Camino de navegación clickeable. Ej: `Inicio / Usuarios / Juan Pérez / Wallet`.

---

## 4. Sistema de diseño y relación con `apps/web`

### 4.1 Tokens compartidos
Ambas apps consumen un paquete `packages/ui` que expone tokens de marca por tenant: colores primarios/secundarios, tipografía, radios, spacing.

### 4.2 Voz visual distinta

| Aspecto | `apps/web` (jugador) | `apps/panel` (operativo) |
|---|---|---|
| Estética | Más expresiva, "atractiva" | Sobria, neutral, clara |
| Imágenes | Hero grande, banners de promos, gráficos llamativos | Mínimo gráfico decorativo. Dato y acción. |
| Color | Saturado, con acentos | Neutro con acentos del tenant. Mucho gris. |
| Tipografía | Display + body | Solo body + UI font, tamaños chicos |
| Animaciones | Sí, micro-interacciones celebratorias | Mínimas (loading, transiciones suaves) |

### 4.3 Componentes
Base **shadcn/ui** + extensiones propias en `packages/ui`. Coherencia entre apps con variantes adaptadas (más densidad en panel).

---

## 5. Secciones por rol

### 5.1 Super-Admin (DB de control)

| Sección | Qué contiene |
|---|---|
| **Dashboard plataforma** | NGR consolidado, mint total por tenant, salud global, alertas críticas. |
| **Tenants** | Listado + alta + suspender + ver salud + métricas individuales. |
| **Comisiones** | Cierres por período, facturas, estado pago, disputas. |
| **Mint monitoring** | Total minteado por tenant + alertas de anomalías + drill-down. |
| **Métricas globales** | Tendencias, comparativas entre tenants, agregados. |
| **Auditoría plataforma** | Toda acción del super-admin + acciones críticas de tenants. |
| **Configuración plataforma** | Planes, defaults, integraciones disponibles. |
| **Salud técnica** | Estado de servicios, colas, jobs, errores. |

### 5.2 Admin Tenant (control total de su casino)

Este rol exige máximo detalle porque pediste explícitamente "ver todo, sin discriminar".

| Sección | Qué contiene |
|---|---|
| **Dashboard maestro** | Ver §6. KPIs en tiempo real, alertas, vista 360°. |
| **Usuarios** | Lista global + jerarquía + permisos + roles + impersonate + ban. **Filtro "Empleados"** para gestionar todos los empleados (los del tenant + los de cada Socio, sin discriminar) con su actividad. |
| **Jerarquía** | Vista clásica (árbol/tabla) en MVP. **Mapa interactivo editable (v2)** — ver §12. |
| **Wallet** | Mint/Burn (con 2FA), cargas, retiros, transferencias, ajustes, vista de balance global del tenant. |
| **Depósitos** | **Cola completa sin filtrar por Socio o Cajero**. Comprobantes, asignación, aprobar/rechazar, histórico. |
| **Retiros** | Cola completa, aprobaciones, marca como pagado, histórico. |
| **Apuestas** | Histórico filtrable por usuario, juego, proveedor, período. Replay si está disponible. |
| **Promos** | Bonos, sorteos, ligas, jackpots, ruletas, misiones, cofres. CRUD completo. Activar/desactivar reglas automáticas. Panel "Bonos activos" (ver `docs/15-engagement-promos.md §A5`). |
| **Referidos** | Socios + sus links + atribuciones + comisiones + payouts. Listado de Socios sospechosos. |
| **Antifraude** | Clusters de cuentas duplicadas, atribuciones flageadas, riesgo de bonos, revisión manual. |
| **Livechat / Soporte** | Cola maestra de chats (todos), métricas (TFR, resolución), asignación, escalado. |
| **Reportes** | Financieros (NGR, GGR, mint, costos), operativos (volumen por área), exports CSV/XLSX. |
| **Auditoría** | Timeline de absolutamente todo. Filtros por actor, target, acción, IP, fecha. Exportable. **Vista especial "Actividad de empleados"** y "Actividad de Socios". |
| **Configuración** | Métodos de pago, parámetros, reglas, comisión por Socio, umbrales antifraude, hold periods, KYC, etc. |
| **Personalización** | Branding del tenant (cuando esté listo `docs/11-personalizacion.md`). |
| **Integraciones** | Game providers (toggle, credenciales), CRM (Kommo/Chatwoot), antifraude. |
| **Solicitudes** | **Vista unificada "Todas las solicitudes"** — depósitos + retiros + payouts de Socios + ajustes pedidos por cajero, **sin discriminar por origen**. Filtros para drill-down. |

### 5.3 Socio

| Sección | Qué contiene |
|---|---|
| **Dashboard de mi red** | Resumen + funnel + comisión proyectada + comparativas. |
| **Mis links / códigos** | Crear, editar, archivar, generar QR, configurar bonos (con saldo propio). |
| **Mis referidos** | Listado + métricas D8 (retention, LTV, NGR, churn). |
| **Mis comisiones** | Histórico + período actual + carryover + solicitar payout a fiat. |
| **Mi saldo** | Wallet propia + cargar a sus distribuidores/cajeros + histórico. |
| **Mis distribuidores y cajeros** | Gestión de su red operativa. |
| **Mis empleados** | Crear/gestionar empleados propios + permisos (con techo). |
| **Livechat de mi red** | Chats de sus referidos. |
| **Promos** | (v2) Crear promos propias con su saldo. |

### 5.4 Distribuidor

| Sección | Qué contiene |
|---|---|
| **Dashboard de mi red** | Resumen de cajeros + jugadores. |
| **Mis cajeros** | Listado + saldos + transferir saldo + histórico. |
| **Mi saldo** | Wallet propia. |
| **Solicitudes** | Depósitos / retiros de su red para revisar / asignar. |
| **Livechat de mi red** | Chats. |

### 5.5 Cajero

| Sección | Qué contiene |
|---|---|
| **Cargar fichas** | Pantalla principal: buscar usuario + monto + nota + cargar. **Mobile-prioritario.** |
| **Mis solicitudes** | Depósitos asignados (con comprobante), retiros asignados. |
| **Mis jugadores** | Listado + drill-down a wallet/historial. |
| **Mi saldo** | Su wallet + histórico de cargas/transferencias recibidas. |
| **Livechat con mis jugadores** | Chats asignados. |

### 5.6 Empleado

UI a medida según permisos. Items del sidebar y acciones se "destraban" según los permisos atómicos del usuario. Si no tiene `wallet.load`, no ve el botón. Si no tiene `livechat.access`, no ve la sección.

> Default visual: panel "vacío" con mensaje *"Tu administrador todavía no te asignó funciones. Contactalo."* — evita confusión inicial.

---

## 6. Dashboard del Admin Tenant (detalle)

Activos en MVP, organizados en grupos. Configurables como widgets en v2.

### 6.1 Financiero (tiempo real / día actual)

- **NGR del día** con comparativa vs día anterior (delta + %).
- **GGR del día**.
- **Total apostado del día**.
- **Bonos otorgados (costo) del día**, breakdown por funder (Tenant vs Socios).
- **Mint del día** (cuánto creó el Admin Tenant) + alerta si supera umbral configurable.
- **Comprometido en holds** (retiros pendientes + fund reservations + bonos en wagering).

### 6.2 Operativo

- **Depósitos pendientes** (cantidad + monto). Click → cola.
- **Retiros pendientes** (cantidad + monto). Click → cola.
- **Solicitudes de payout de Socios pendientes**.
- **Chats abiertos sin atender** + tiempo de espera máximo.
- **Adjustments del día** (señal de problema; en rojo si > 0).
- **Atribuciones flageadas pendientes de revisar**.

### 6.3 Usuarios

- **Activos ahora** (jugando o navegando).
- **Registros nuevos del día**.
- **FTDs del día** (cantidad + monto promedio).
- **Top 10 jugadores del día** por bet.
- **Cuentas suspendidas hoy**.

### 6.4 Sistema

- **Salud de proveedores de juego** (semáforo verde/amarillo/rojo).
- **Salud de CRM** (Kommo/Chatwoot conectado y respondiendo).
- **Errores en logs** (últimos 60 min) con drill-down.
- **Cola de jobs** (BullMQ): pending, active, failed.

### 6.5 Layout

Grid responsivo. En desktop: 4 columnas. En tablet: 2. En mobile: 1.
Cada widget tiene:
- Título.
- Métrica principal grande.
- Comparativa secundaria pequeña.
- Click → sección correspondiente.

---

## 7. Funcionalidades transversales

### 7.1 Búsqueda global (⌘K / Ctrl+K)

Modal flotante. Busca en:
- Usuarios (por username, email, teléfono, ID).
- Transacciones (por ID, monto, fecha aproximada).
- Comprobantes (por ID o referencia externa).
- Chats (por contenido si está indexado).
- Páginas del panel (atajos de navegación).

Implementación: índice de búsqueda en Postgres FTS para MVP. Meilisearch si crece.

### 7.2 Notificaciones en tiempo real

Vía Socket.io. Configurable por usuario en preferencias.

**Tipos**:
- Nuevo chat sin atender / asignado a vos.
- Depósito a aprobar (en tu scope).
- Retiro a aprobar.
- Solicitud de payout pendiente.
- Alerta antifraude (cluster nuevo).
- Mint inusual (al super-admin).
- Pool agotado (creador de promo).
- Errores críticos.

**UI**: badge en topbar (campana). Dropdown con feed. Toasts efímeros para urgentes. Página `notificaciones/` para histórico.

### 7.3 Exports

**CSV / XLSX** en MVP. PDF en v2.

Listados exportables (con filtros aplicados):
- Usuarios, transacciones, depósitos, retiros, apuestas, comisiones, eventos de auditoría, etc.

Implementación: job BullMQ que genera el archivo y lo deja en S3 con link descargable + notificación cuando esté listo. Evita timeouts en exports grandes.

### 7.4 Acciones bulk

**MVP**:
- Asignación masiva de solicitudes a cajero/empleado.
- Etiquetado masivo de usuarios.

**v2**:
- Aprobación/rechazo masivo (riesgoso, requiere doble confirmación + 2FA).
- Operaciones de wallet masivas.

### 7.5 Filtros y vistas

**MVP**: Filtros avanzados en cada listado (multi-criterio + rangos de fecha + búsqueda textual). Filtros componibles.

**v2**: Vistas guardadas ("Mis depósitos pendientes > 10k del último día"), compartibles con el equipo, default por rol.

### 7.6 Auditoría visual

Todo lo sensible deja rastro en `audit_log`. Cada item del panel sensible tiene:
- Botón "ver historial" → muestra timeline relativo a esa entidad.
- Tooltips de "última modificación por X hace Y".

---

## 8. Mobile UX (flujos prioritarios)

### 8.1 Cajero — "Cargar fichas" (mobile-first)

```
┌───────────────────────────┐
│ [≡]  Casino Pampa  [🔔 3] │
├───────────────────────────┤
│  Saldo: 12.500 fichas     │
│                           │
│  Cargar a un usuario      │
│  ┌─────────────────────┐  │
│  │ 🔍 username/tel/id  │  │
│  └─────────────────────┘  │
│                           │
│  [Resultado del search]   │
│                           │
│  ┌─────────────────────┐  │
│  │  Monto              │  │
│  │  [    100   ]       │  │
│  └─────────────────────┘  │
│                           │
│  ┌─────────────────────┐  │
│  │  Nota (opcional)    │  │
│  └─────────────────────┘  │
│                           │
│  [   CARGAR FICHAS   ]    │
└───────────────────────────┘
```

Flujo de 2 taps: buscar → cargar. Confirmación inline. Feedback claro (✓ con monto + balance restante).

### 8.2 Cajero — "Aprobar depósito" (mobile)

Cards verticales de cada solicitud con:
- Foto del comprobante (zoom con tap).
- Datos: usuario, monto, método.
- Acciones: [Aprobar] [Rechazar] [Pedir más info].

### 8.3 Socio — "Mi red" (mobile)

Lista cards de referidos con métricas resumidas. Tap → drill-down completo.

### 8.4 Livechat (mobile)

UX estilo WhatsApp/Telegram. Lista de threads + chat individual. Notificación push (PWA o email cuando no esté abierto).

### 8.5 Lo que NO se optimiza para mobile

- Reportes complejos (data densa).
- Configuración del tenant (formularios largos).
- Auditoría profunda.
- Editor de roles/permisos (matriz).

Para esos: el mobile muestra layout simplificado con CTA "Mejor desde computadora para esta acción".

---

## 9. Performance, paginación, densidad, atajos

### 9.1 Paginación
**Cursor-based** en todos los listados grandes. Default 50 por página. Selector 25 / 50 / 100.

### 9.2 Densidad

- **Cómoda** (default): rows altas, mucha respiración.
- **Compacta**: rows bajas, más data en pantalla.
- Switch en preferencias del usuario (`user_preferences.density`).

### 9.3 Atajos de teclado

Estilo Linear / Notion:
- `⌘K` / `Ctrl+K`: búsqueda global.
- `g d`: ir a Dashboard.
- `g u`: Usuarios.
- `g w`: Wallet.
- `g c`: Livechat.
- `J` / `K`: navegar abajo / arriba en listados.
- `E`: editar item seleccionado.
- `?`: mostrar todos los atajos.

Render condicional según permisos: si no tenés acceso a la sección, el atajo no funciona.

### 9.4 Loading states

- Skeleton screens en listados.
- Optimistic updates en acciones simples (toggle, edit inline).
- Toasts de error si falla.

### 9.5 Error boundaries

Cada sección con error boundary propio. Si una falla, el resto sigue funcionando. Mensaje claro + botón "Reintentar" + link "Reportar bug".

---

## 10. Permisos en la UI

Helper `<Can permission="wallet.load">{children}</Can>` para gating declarativo.

```tsx
<Can permission="wallet.load">
  <Button onClick={loadChips}>Cargar fichas</Button>
</Can>
```

Reglas:
- **Si no tenés el permiso → el componente no se renderiza** (no se muestra disabled).
- Para items del sidebar: filtrado según permisos.
- Para acciones contextuales: misma lógica.
- Para scope (ej: cargar solo a usuarios de mi red): el helper acepta `scope="user_in_own_network"` y valida en runtime.

> El backend siempre valida igual, como red de seguridad. La UI gate es UX, no security.

---

## 11. Preferencias del usuario

Tabla `user_preferences` (DB de tenant):
```
user_id PK
theme         enum('dark','light','system')
density       enum('comfortable','compact')
locale        text
notifications jsonb        -- qué tipos quiere recibir
shortcuts_enabled bool
sidebar_collapsed bool
created_at, updated_at
```

Editables desde el menú de usuario.

---

## 12. Vista Jerarquía Interactiva (v2 · Admin Tenant)

Sección dedicada del panel del Admin Tenant que visualiza **toda la lógica del negocio como un mapa conceptual editable**. No es un nice-to-have decorativo: es la forma natural de entender, auditar y reorganizar la red.

### 12.1 Vistas

La sección "Jerarquía" tiene dos modos seleccionables con un toggle:

| Modo | Cuándo conviene | Disponibilidad |
|---|---|---|
| **Tabla / Árbol** | Búsquedas rápidas, filtros densos, exports | MVP |
| **Mapa interactivo** | Visión global, reorganización drag-drop, presentaciones | v2 |

Ambas comparten la misma fuente de verdad (`user_hierarchy`).

### 12.2 Tecnología propuesta

- **React Flow** (`reactflow`) — librería madura para grafos interactivos en React. Maneja zoom, pan, mini-mapa, custom nodes y edges out of the box.
- **dagre** o **elk-js** — algoritmos de layout automático (top-down, izquierda-derecha, radial).
- Layout calculado en **Web Worker** para no bloquear UI con grafos grandes.
- Virtualization de nodos fuera del viewport para performance.

### 12.3 Modelo visual

#### Nodos ("nubes")

Cada usuario es un nodo con:
- **Avatar** (foto o iniciales con color por rol).
- **Nombre + username**.
- **Badge de rol** (Socio / Distribuidor / Cajero / Empleado / Jugador).
- **Indicador de estado** (activo / suspendido / banneado).
- **Métrica visible** seleccionable desde dropdown del header:
  - Apostado lifetime
  - NGR generado
  - Comisión generada (Socios)
  - Referidos directos (count)
  - Saldo actual
  - Última actividad
- **Color/borde** por rol; **tamaño** opcionalmente proporcional a la métrica seleccionada.

#### Aristas (líneas de conexión)

- **Jerárquica directa**: línea sólida + flecha (de superior a subordinado).
- **Referido por**: línea punteada (de Socio a su referido).
- **Atendido por** (cajero asignado): línea fina secundaria, opcional.
- Cada arista lleva etiqueta del tipo de relación al hover.

### 12.4 Interactividad

| Acción | Efecto |
|---|---|
| Click sobre nodo | Drawer lateral con detalle del usuario (datos + métricas + acciones rápidas). |
| Doble click sobre nodo | Drill-down: ese nodo se vuelve raíz y se ve solo su subárbol. Botón "volver" arriba. |
| Drag-drop nodo a otro padre | Diálogo de confirmación con preview: "Reasignar a Distribuidor X. Esto afectará a N permisos delegados, las cascadas se ejecutarán según `docs/03-jerarquia-roles.md §7.3`. ¿Confirmar?". 2FA si aplica. |
| Hover sobre arista | Tooltip con tipo de relación + fecha desde cuando. |
| Right-click nodo | Menú contextual (impersonate, ver wallet, ver chats, suspender, etc., según permisos). |
| Selección múltiple (lazo o shift+click) | Operaciones bulk: reasignar varios, exportar subset, etc. |

### 12.5 Filtros y vistas

Panel lateral colapsable:

- Por **rol** (mostrar solo Socios + Distribuidores, etc.).
- Por **estado** (activos / inactivos / suspendidos).
- Por **período de actividad** (jugaron en últimos N días).
- Por **rango de métrica** (ej: Socios con > 50 referidos).
- **Search**: buscar usuario y enfocar el grafo en él (con highlight de toda su cadena de subordinados y de su superior).

### 12.6 Layouts

Selector de layout:
- **Top-down jerárquico** (default): Admin Tenant arriba, Socios abajo, etc.
- **Radial**: Admin Tenant en centro, expandiendo hacia afuera.
- **Force-directed**: distribución orgánica por relaciones (mejor para grafos densos).
- **Por sub-red de Socio**: agrupa visualmente cada red.

### 12.7 Time slider (auditoría histórica)

Slider en la parte inferior. **Permite ver el árbol como era en una fecha pasada**.

- Posible porque `user_hierarchy` guarda histórico con `since`/`until`.
- Útil para entender por qué algo está como está, o investigar cambios sospechosos.
- Comparación lado a lado: split view "antes / después" entre dos fechas.

### 12.8 Performance

- Layout en Web Worker (no bloquea UI).
- Virtualization: solo se renderizan nodos en viewport + buffer.
- Para tenants con > 5.000 nodos: vista "agrupada por Socio" (cada Socio + su red colapsa en un super-nodo expandible).
- Caching del layout en cliente (recálculo solo si cambia la estructura).

### 12.9 Export

- **PNG / SVG** del grafo visible (para presentaciones).
- **PDF** con leyenda + métricas (v2.1).
- **JSON** de la estructura (para análisis externos).

### 12.10 Auditoría

Toda reorganización drag-drop:
- Genera entrada en `audit_log` con before/after del nodo afectado.
- Dispara cascada de permisos según reglas (`docs/03-jerarquia-roles.md §7.3`).
- Notifica a los afectados (subordinados que cambian de superior).
- Reversible con un solo click en los siguientes 60 segundos (excepto si ya hubo actividad nueva).

### 12.11 Permisos para usar la vista

- `hierarchy.view` — ver el mapa (Admin Tenant + Socios para su sub-red).
- `hierarchy.edit_drag` — reasignar drag-drop (Admin Tenant + Socios con `is_delegatable` para reasignar dentro de su red).
- `hierarchy.history_view` — usar time slider (Admin Tenant + auditores).

### 12.12 Pendientes específicos del módulo

- Decidir si los Socios tienen una versión reducida del mapa (su sub-red).
- Animaciones suaves entre transiciones (entrada/salida de nodos).
- Modo presentación (full screen sin sidebar).
- Integración con búsqueda global ⌘K → "ver en mapa" como acción.

---

## 13. Pendientes / a definir al implementar

- **Rate limit de exports** por usuario (para evitar abuso).
- **Plantillas de dashboards por rol** (configurables por Admin Tenant en v2).
- **Sistema de pinear / favoritos**: el usuario marca pantallas que más usa, aparecen arriba en el sidebar.
- **Multi-cuenta** (un usuario logueado en 2+ tenants simultáneamente con switcher en topbar).
- **Modo "presentación"** para reportes en pantalla grande.
- **Onboarding tour** para roles nuevos (Cajero recién creado ve un walkthrough).
- **Help center embebido** con docs y FAQs (link a Notion / Outline).
- **Comandos avanzados** desde la barra ⌘K (ej: "cargar 100 fichas a juan123" → ejecuta acción directo).
- Decidir librería concreta de tablas (TanStack Table vs Mantine / shadcn DataTable).
- Decidir librería de gráficos (Recharts / Tremor / visx).
