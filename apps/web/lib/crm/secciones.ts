/**
 * Las secciones del CRM y en qué orden van en el menú.
 *
 * Sale del handoff de diseño (`docs/design_handoff_crm/`), que agrupa las diez
 * secciones en cinco bloques. El orden y los nombres son del diseño y el copy
 * es final — no se traducen ni se acortan.
 *
 * ## Por qué todas cuelgan de `/support/`
 *
 * Porque es lo único que el host del CRM deja pasar: `rutaPermitidaEnCrm`
 * (ver `lib/crm-host.ts`) admite `/support` y `/support/*`, y **todo lo demás
 * redirige**. Colgando las secciones ahí, las diez existen sin tocar el
 * middleware ni abrirle al CRM una puerta que hoy no tiene.
 *
 * ## Por qué hay secciones marcadas como no construidas
 *
 * El diseño define las diez de una; construirlas lleva varias tandas. Las que
 * todavía no existen se muestran igual, **apagadas y sin link**, en vez de
 * esconderse o llevar a un 404.
 *
 * Esconderlas haría que el menú cambie de forma cada vez que se termina una, y
 * el operador aprendería un mapa que se le mueve abajo de los pies. Dejarlas
 * como link muerto es peor: promete algo que no está.
 *
 * ## Lo que NO está acá, a propósito
 *
 * **IA y bots.** El diseño la trae y **no se construye**: contradice **D17**
 * (no hay respuestas automáticas, contesta un humano o nadie), que se ratificó
 * el 2026-09-09. No figura ni apagada — no es que falte, es que no va.
 *
 * La **caja dentro del chat** tampoco es una sección: el diseño la mete en la
 * ficha del contacto, y esa decisión quedó **diferida** el 2026-09-09. Ver el
 * bloque 7 de `docs/crm/14-decisiones.md`.
 */

export interface SeccionDelCrm {
  /** Ruta completa. Siempre bajo `/support/` (ver arriba). */
  href: string;
  /** Como se llama en el menú. Copy final del handoff. */
  label: string;
  /** Nombre del ícono de lucide, tal como lo pide el diseño. */
  icono: string;
  /**
   * `false` mientras no exista la pantalla: se muestra apagada y sin link.
   * Al construirla, se cambia acá y aparece sola.
   */
  lista: boolean;
}

export interface GrupoDelCrm {
  /** Encabezado del grupo, en mayúsculas y con tracking (10px). */
  titulo: string;
  items: SeccionDelCrm[];
}

export const GRUPOS_DEL_CRM: GrupoDelCrm[] = [
  {
    titulo: 'Entrada',
    items: [
      { href: '/support', label: 'Bandeja', icono: 'messages-square', lista: true },
      { href: '/support/contactos', label: 'Contactos', icono: 'contact', lista: true },
      { href: '/support/circuitos', label: 'Circuitos', icono: 'git-branch', lista: true },
    ],
  },
  {
    titulo: 'Datos',
    items: [
      { href: '/support/base', label: 'Base de datos', icono: 'database', lista: false },
      { href: '/support/difusion', label: 'Difusión masiva', icono: 'megaphone', lista: false },
    ],
  },
  {
    titulo: 'Automatización',
    items: [
      { href: '/support/respuestas', label: 'Respuestas rápidas', icono: 'zap', lista: true },
    ],
  },
  {
    titulo: 'Medición',
    items: [
      { href: '/support/metricas', label: 'Métricas de atención', icono: 'bar-chart-3', lista: true },
    ],
  },
  {
    titulo: 'Ajustes',
    items: [
      { href: '/support/canales', label: 'Canales', icono: 'plug', lista: true },
      { href: '/support/configuracion', label: 'Configuración', icono: 'settings', lista: true },
    ],
  },
];

/**
 * Las cuatro secciones de la barra inferior en mobile, más "Más".
 *
 * En pantallas de menos de 760px el menú lateral desaparece: no hay lugar para
 * 238px de navegación al lado de una conversación.
 */
export const TABBAR_MOBILE: SeccionDelCrm[] = [
  { href: '/support', label: 'Bandeja', icono: 'messages-square', lista: true },
  { href: '/support/contactos', label: 'Contactos', icono: 'contact', lista: true },
  { href: '/support/metricas', label: 'Métricas', icono: 'bar-chart-3', lista: true },
  { href: '/support/canales', label: 'Canales', icono: 'plug', lista: true },
];

/** ¿Esta ruta es la sección activa? `/support` sólo matchea exacto. */
export function esSeccionActiva(href: string, pathname: string): boolean {
  if (href === '/support') return pathname === '/support';
  return pathname === href || pathname.startsWith(`${href}/`);
}
