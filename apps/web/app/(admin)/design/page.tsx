import { redirect } from 'next/navigation';

/**
 * /design → /settings (Configuración del tenant).
 *
 * El contenido del viejo editor de diseño se absorbió en /settings:
 * secciones Marca / Apariencia / Home del jugador. Esta ruta queda como
 * alias de compatibilidad para links viejos.
 */
export default function DesignPage() {
  redirect('/settings');
}
