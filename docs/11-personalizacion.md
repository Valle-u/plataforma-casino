# 11 · Personalización (Branding por Tenant)

> Estado: **decidido en estructura**. Tokens concretos del tema base se afinan al implementar el sistema de diseño en `packages/ui`.

Define qué puede personalizar cada tenant (Admin Tenant) de su sitio jugador y panel, y qué queda fijo en la identidad de plataforma.

---

## 1. Principios

| Principio | Implicación |
|---|---|
| **Identidad visual compartida** | La paleta, tipografía, espaciados, radios y voz visual son **iguales en todos los tenants** en MVP. Resultado: todos los casinos se ven coherentes y profesionales sin que el cliente tenga que diseñar nada. |
| **Tenant personaliza contenido, no estética** | Logo, banners, copys, imágenes, dominio, lobby, emails: customizable. Colores, fuentes, layout: fijos. |
| **Sobrio y limpio** | Voz visual deliberadamente neutral. El "casino chillón" lo aporta el contenido (banners, juegos, promos), no el chasis. |
| **Live preview + publicación atómica** | Admin Tenant edita con preview, todo va a borrador y se publica con un botón. Snapshots versionados con rollback. |
| **Coherencia `apps/web` ↔ `apps/panel`** | Mismos tokens, distinta intensidad. Sitio jugador más expresivo; panel más sobrio (ver `docs/10-panel-control.md §4`). |
| **v2 abre la puerta** | Si en el futuro un cliente grande pide paleta/fuente propia, la arquitectura de tokens lo permite sin refactor. |

---

## 2. Tema base (modelo único de la plataforma en MVP)

### 2.1 Paleta

Inspirada en tus referencias (Mega Mooney Maker) pero con **rojo como acento** en lugar del dorado.

| Token | Hex (referencial) | Uso |
|---|---|---|
| `bg.base` | `#0A0A0A` | Fondo principal del sitio jugador |
| `bg.elevated` | `#141414` | Cards, modales, panels superpuestos |
| `bg.muted` | `#1C1C1C` | Estados hover suaves, secciones secundarias |
| `border.subtle` | `#2A2A2A` | Bordes finos entre cards y secciones |
| `border.strong` | `#3A3A3A` | Bordes destacados, separadores |
| `text.primary` | `#FFFFFF` | Títulos, contenido principal |
| `text.secondary` | `#A1A1A1` | Subtítulos, metadata |
| `text.muted` | `#6B6B6B` | Hints, placeholders, deshabilitados |
| `accent.base` | `#DC2626` | CTAs principales, indicadores activos, branding |
| `accent.hover` | `#B91C1C` | Hover de CTAs |
| `accent.subtle` | `#7F1D1D` | Backgrounds de tags / chips con acento |
| `success` | `#16A34A` | Confirmaciones, deltas positivos |
| `warning` | `#EAB308` | Avisos, holds, estados neutros |
| `danger` | `#EF4444` | Errores, acciones destructivas |
| `info` | `#3B82F6` | Tooltips informativos, links |

> Los hex son referenciales. La paleta final se ajusta al implementar tras pruebas de contraste WCAG AA mínimo (AAA donde sea posible).

### 2.2 Modo claro

Default oscuro. Cada tenant decide si habilita modo claro vía switch del usuario (configurable en `tenant_settings.theme_modes_enabled`).

Tokens claros se derivan del oscuro respetando contrastes. Tabla equivalente vive en `packages/ui`.

### 2.3 Tipografía

**Set fijo en MVP**, una sola familia para body + UI:
- **Inter** (recomendada) o **Geist Sans** — neutral, alta legibilidad, buenos pesos.
- Pesos: 400 (regular), 500 (medium), 600 (semibold), 700 (bold).
- Fallback: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.

Para display (números grandes en KPIs, headlines del hero):
- Misma familia, peso 700-800. Sin fuente display separada.

> Decisión cerrada: el tenant **no elige** tipografía en MVP.

### 2.4 Espaciados y radios

Sistema base 4px:
- Espaciado: `4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96`.
- Radios: `0 / 4 / 8 / 12 / 16 / full`.
- Sombras: 3 niveles (`sm`, `md`, `lg`) sutiles, casi imperceptibles en dark mode.

### 2.5 Componentes base

Todos derivados de **shadcn/ui** + extensiones propias en `packages/ui`. Cobertura mínima:
- Botón (variantes: primary, secondary, ghost, destructive, link).
- Input, Select, Combobox, Switch, Checkbox, Radio, Textarea.
- Card, Modal, Drawer, Sheet, Dialog.
- Toast, Tooltip, Popover.
- Tabs, Accordion, Breadcrumb.
- DataTable, Badge, Avatar, Skeleton.
- Empty states, Error states.

---

## 3. Qué personaliza cada tenant (MVP)

### 3.1 Identidad
- ☑ **Logo** (versión clara y oscura) — PNG/SVG, dimensiones recomendadas.
- ☑ **Favicon** — varias resoluciones generadas automáticamente.
- ☑ **Nombre comercial** (ej: "Mega Mooney Maker") — usado en title, footer, emails.
- ☑ **Tagline / slogan** — opcional, en hero o footer.

### 3.2 Contenido del sitio jugador
- ☑ **Hero rotativo** — banners con imagen + título + subtítulo + CTA. Hasta N slides.
- ☑ **Banners de promos** — sección dedicada en home y entre categorías del lobby.
- ☑ **Copys de UI** — overrides puntuales sobre strings clave (ej: "Cargar fichas", "Registrate", "Bienvenido"). Set acotado, no edición libre de toda la UI.
- ☑ **Imágenes de promo** — assets para sorteos, ligas, bonos.
- ☑ **Sponsors / partners** (footer, opcional).

### 3.3 Estructura del lobby
- ☑ **Orden de categorías** (Inicio, Novedades, Casino en vivo, Tragamonedas, Mesa, Crash, etc.).
- ☑ **Categorías visibles / ocultas**.
- ☑ **Secciones del home** (qué bloques aparecen y en qué orden: destacados, más jugados, novedades, jackpots calientes, banners).
- ☑ **Juegos destacados** (curado manual desde el panel).
- ☑ **Tags personalizados** para armar secciones propias ("Favoritos del finde").

### 3.4 Comunicación
- ☑ **Email templates** — header (logo + colores acento del tenant), footer (datos del tenant, redes), no edición libre de cuerpo.
- ☑ **Mensajes del sistema** — textos puntuales (notificación de depósito aprobado, retiro pagado, bienvenida, etc.).
- ☑ **Idioma default** — *configurable cuando se agreguen más idiomas (v2)*. En MVP, todos los tenants en `es-AR`.

### 3.5 Dominio
- ☑ **Custom domain** — el tenant configura su DNS apuntando a la plataforma; nosotros emitimos cert SSL automático (Let's Encrypt vía Coolify / Caddy).
- ☑ Múltiples dominios por tenant (alias del sitio jugador + alias del panel + dominios viejos redirigiendo).

### 3.6 Lo que **no** personaliza (MVP)
- ✗ Paleta de colores.
- ✗ Tipografía.
- ✗ Layout / estructura visual general.
- ✗ CSS custom.
- ✗ Cuerpo libre de emails / textos largos.
- ✗ Componentes UI custom.

> Si un cliente grande necesita personalización profunda, pasa a v2 (ver §10).

---

## 4. Editor de personalización (panel del Admin Tenant)

### 4.1 Sección "Personalización"

Subsecciones:
- **Identidad** — logo, favicon, nombre, tagline.
- **Hero & Banners** — gestión de banners con drag-drop de orden.
- **Lobby** — estructura del home y categorías, drag-drop, toggles.
- **Copys** — listado de strings overrideable con valores actuales y default.
- **Email templates** — preview del header/footer + assets.
- **Dominios** — alta, verificación DNS, certificado SSL, redirección.
- **Histórico** — snapshots con preview y rollback.

### 4.2 Live preview

- Layout de dos paneles: editor a la izquierda + preview en vivo a la derecha (iframe del sitio jugador con las modificaciones aplicadas).
- Toggle device: desktop / tablet / mobile.
- Cambios **se ven al instante** en el preview pero quedan en **borrador** (`branding_settings_draft`).
- Botón "Publicar cambios" aplica el draft a producción atómicamente.
- Botón "Descartar" vuelve al estado publicado.

### 4.3 Publicación atómica + colas

Al publicar:
1. Se valida la config (assets accesibles, dominios verificados, etc.).
2. Se hace snapshot de la versión vigente en `branding_settings_history`.
3. Se aplica el draft a `branding_settings`.
4. Cache de assets / config en CDN se invalida.
5. Notificación in-panel "Cambios publicados".

### 4.4 Versionado y rollback

```sql
branding_settings_history
  id, tenant_id, version int, snapshot jsonb,
  published_by uuid FK users(id),
  published_at timestamptz,
  changelog text nullable,        -- texto libre opcional
  reverted_from_id uuid nullable  -- si fue resultado de un rollback
```

- Cada publicación crea una versión.
- Listado de versiones en panel con preview de cada una.
- Rollback con un click → crea una nueva publicación (la N+1) que es copia exacta de la versión X.
- Sin límite de retención en MVP. v2: política de retención configurable.

---

## 5. Sistema de diseño (`packages/ui`)

### 5.1 Estructura
```
packages/ui/
├── tokens/
│   ├── base.ts          -- tokens fijos del tema plataforma
│   └── tenant.ts        -- helper para inyectar nombre/logo del tenant
├── components/
│   ├── button/
│   ├── card/
│   ├── data-table/
│   └── ...
├── primitives/          -- wrappers de Radix
└── styles/
    ├── globals.css
    └── tailwind.preset.ts
```

### 5.2 Tokens en código
- **CSS variables** generadas desde tokens TS.
- **Tailwind preset** que mapea variables a clases (`bg-bg-base`, `text-text-primary`, etc.).
- **Tema** vía data attribute (`data-theme="dark"` / `"light"`).

### 5.3 Coherencia panel ↔ web
Mismos tokens. Diferencias:
- **Sitio jugador**: usa la paleta plena, hero grande, animaciones, imágenes de juegos prominentes.
- **Panel**: usa la paleta atenuada (más grises, menos rojo), densidad mayor, sin imágenes decorativas.

Misma fuente, mismas clases, distinta densidad y atrevimiento visual.

---

## 6. Lobby personalizable (sitio jugador)

### 6.1 Estructura del home

Define qué bloques aparecen y en qué orden. Configurado por el Admin Tenant desde "Personalización → Lobby":

```jsonc
{
  "home_layout": [
    { "type": "hero_carousel", "config": { "slides": [...] } },
    { "type": "category_tabs", "config": { "show": ["inicio","novedades","casino_vivo","slots","mesa","crash"] } },
    { "type": "featured_games", "config": { "title": "Destacados", "game_ids": [...] } },
    { "type": "promo_banner_strip", "config": { "banners": [...] } },
    { "type": "most_played", "config": { "title": "Más jugados", "period_days": 7 } },
    { "type": "hot_jackpots", "config": { "title": "Jackpots calientes" } },
    { "type": "providers_strip", "config": { "title": "Nuestros proveedores" } }
  ]
}
```

Bloques disponibles (catálogo cerrado en MVP):
- `hero_carousel`
- `category_tabs`
- `featured_games`
- `promo_banner_strip`
- `most_played`
- `recently_added`
- `hot_jackpots`
- `live_casino_strip`
- `providers_strip`
- `text_block` (FAQ corto, T&C)
- `cta_block` (banner full-width con CTA)

### 6.2 Categorías

Cada categoría también es un layout configurable:
- Filtros visibles / ocultos.
- Agrupación por proveedor (default) o por tipo.
- Orden default (más jugados / más nuevos / alfabético).

### 6.3 Drag-drop en panel

UI tipo "constructor de página": el Admin Tenant arrastra bloques desde una sidebar, los reordena, edita cada uno con un drawer lateral.

---

## 7. Email templates

### 7.1 Estructura fija

Layout de email es fijo: header con logo del tenant + cuerpo + footer con datos del tenant.

### 7.2 Personalizable
- Logo en el header.
- Color del header (deriva del tema base; en v2 podría customizarse).
- Footer: dirección comercial, redes sociales, link a ayuda, opt-out.

### 7.3 Templates incluidos en MVP

- Bienvenida al registrarse.
- Verificación de email (si KYC level lo requiere).
- Depósito aprobado / rechazado.
- Retiro aprobado / pagado / rechazado.
- Bono otorgado.
- Wagering cumplido.
- Reset de password.
- 2FA configurado.
- Notificación crítica (cambio de contraseña, login desde dispositivo nuevo).

### 7.4 Mensajes de cuerpo

El cuerpo del email es **fijo en estructura y copy** salvo overrides puntuales del Admin Tenant (mismo sistema que copys de UI, set acotado).

---

## 8. Custom domain

### 8.1 Flujo

1. Admin Tenant ingresa el dominio que quiere conectar (`micasino.com`).
2. Sistema genera registros DNS a configurar (CNAME / A según infra).
3. Admin configura su DNS y vuelve al panel.
4. Sistema verifica vía DNS lookup.
5. Una vez verificado, emite certificado SSL automático (Let's Encrypt vía Coolify/Caddy en producción).
6. Dominio queda activo. Aparece en `tenant_domains.is_primary = true`.

### 8.2 Múltiples dominios por tenant

- Sitio jugador (`micasino.com`).
- Panel (`panel.micasino.com` o `panel.micasino-app.com`).
- Aliases viejos (redirección 301 al primario).

### 8.3 Sin custom domain

Si el tenant no configura uno, usa subdominio default de la plataforma (`<slug>.<plataforma>.com`).

---

## 9. Modelo de datos

### `branding_settings` (singleton por DB de tenant — versión publicada vigente)
```
id, tenant_scope text default 'tenant',
logo_light_url, logo_dark_url, favicon_url,
commercial_name, tagline,
hero_slides jsonb,
home_layout jsonb,
copy_overrides jsonb,
email_settings jsonb,
theme_mode enum('dark','light','both') default 'dark',
updated_by, updated_at,
current_version int
```

### `branding_settings_draft`
Misma estructura. Working copy del Admin Tenant antes de publicar.

### `branding_settings_history`
Versiones publicadas (snapshots). Ya descripto en §4.4.

### `branding_assets`
```
id, tenant_id, kind enum('logo_light','logo_dark','favicon','hero_slide','promo_banner','footer_logo','sponsor_logo'),
file_url, file_size, mime_type,
width, height, alt_text,
uploaded_by, uploaded_at, archived bool default false
```

Los assets viven en S3-compatible. Servidos vía CDN.

---

## 10. Pendientes / a abrir en v2

- **Paleta personalizable por tenant** — abrir tokens de color a override por tenant. Implica auditoría de contraste automática para evitar tenants con UI inaccesible.
- **Tipografía personalizable** — set ampliado o upload propio (con validación de licencia).
- **CSS custom avanzado** — para clientes en plan top, sandboxed y revisado.
- **Modo claro pulido** — refinar el tema light en todos los componentes (en MVP existe pero no es prioridad de QA).
- **Editor visual de hero/banners** con composición tipo Figma simplificado.
- **Templates de lobby pre-armados** ("Casino agresivo", "Casino sobrio", "Casino retro") que el Admin Tenant aplica con un click.
- **Preview multi-device más rico** (más resoluciones, simulación de velocidad de red).
- **A/B testing del lobby** — variantes y rotación entre usuarios para ver cuál convierte más.
- **Multilenguaje del sitio jugador** — selector por usuario + traducciones por tenant.
- **Editor WYSIWYG para textos largos** (T&C, ayuda, FAQ).
- **Theming del panel** — mismo nivel de personalización que el sitio jugador (hoy panel queda más rígido).

---

## 11. Resumen visual (tu referencia)

Lo que documento como **inspiración estructural** del sitio jugador, traducido a nuestra paleta:

```
╔══════════════════════════════════════════════════════════════════╗
║ [LOGO]  Casino  Tragamonedas  En Vivo  Promos     [⚪Ofertas] [🔴Regístrate] [Acceder] ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║   🔍  Buscar...                                                  ║
║                                                                  ║
║   🏠 Inicio   ✨ Novedades   🎰 Slots   🎲 Mesa   ⚡ Crash       ║
║   ─────────                                                      ║
║                                                                  ║
║   ┌────────────────────────────────────────────────────────┐     ║
║   │                                                        │     ║
║   │              [HERO BANNER ROTATIVO]                    │     ║
║   │                                                        │     ║
║   │                                          ● ○ ○ ○       │     ║
║   └────────────────────────────────────────────────────────┘     ║
║                                                                  ║
║   DESCUBRA LAS NOVEDADES                              Ver más → ║
║   ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐         ║
║   │ Game │ │ Game │ │ Game │ │ Game │ │ Game │ │ Game │         ║
║   └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘         ║
║                                                                  ║
║                                                       ┌──────┐   ║
║                                                       │ 💬 1 │   ║
║                                                       └──────┘   ║
╚══════════════════════════════════════════════════════════════════╝
```

Donde la referencia usa **dorado**, nosotros usamos **rojo `#DC2626`**. El resto de la estructura (grid, tabs, hero, chat flotante, layout del registro) se replica.

El **panel** (`apps/panel`) sigue el layout de sidebar a la izquierda definido en `docs/10-panel-control.md §3`, con la **misma paleta atenuada**: más gris, menos rojo, foco en data y acción.
