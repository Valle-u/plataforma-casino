/**
 * El host del CRM: `crm.miamihub.vip` (y `crm-staging.` en staging).
 *
 * ## Qué es
 *
 * El **mismo build** que el panel, servido por otro dominio y recortado: entrando
 * por ahí sólo existe Soporte. Para el operador es una aplicación aparte; para el
 * deploy es la misma imagen y el mismo contenedor.
 *
 * No hace falta una app nueva ni tocar la resolución del tenant: el backend
 * resuelve el casino por `X-Tenant-Host`, que sale de una variable del build
 * (`NEXT_PUBLIC_TENANT_HOST`), **no del host del navegador**.
 *
 * ## Por qué esto vive en su propio archivo
 *
 * Lo usan el **middleware** (que corre en el edge) y `app/layout.tsx` (que corre
 * en Node). Si la constante viviera en el middleware, importarla desde el layout
 * arrastraría todo el árbol de módulos del middleware al bundle del layout.
 *
 * ## El guion
 *
 * `crm-staging.` y no `crm.staging.` por lo mismo que `admin-staging`: el
 * certificado universal de Cloudflare (plan free) cubre **un solo nivel** de
 * subdominio. Dos niveles quedan sin cert y el proxy no levanta.
 */

/**
 * Header con el que el middleware le avisa al layout del servidor que el request
 * entró por el host del CRM.
 *
 * El layout lo baja a `data-crm-only` en el `<html>`, y el menú se recorta con
 * CSS a partir de esa marca — sin JS y **sin parpadeo**. Resolverlo en el
 * cliente con `window.location` pintaría el menú completo y lo recortaría
 * después: el mismo parpadeo que costó arreglar en la interfaz del jugador.
 */
export const HOST_CRM = 'x-crm-only';

/** ¿Este host es el del CRM? */
export function esHostDeCrm(host: string): boolean {
  const h = host.toLowerCase();
  return h.startsWith('crm.') || h.startsWith('crm-');
}

/**
 * Las únicas rutas que existen entrando por el host del CRM.
 *
 * Todo lo demás redirige a `/support`, así que un operador no llega a Caja ni a
 * Usuarios desde acá **aunque escriba la URL a mano**. No reemplaza a los
 * permisos del backend: es una puerta menos, no la cerradura.
 */
export function rutaPermitidaEnCrm(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname === '/support' ||
    pathname.startsWith('/support/')
  );
}
