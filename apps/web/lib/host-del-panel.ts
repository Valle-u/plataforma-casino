/**
 * ¿El panel de operadores existe en este host?
 *
 * Hay **un solo build** sirviendo tres caras (jugador, panel, CRM) y el
 * middleware decide cuál se ve según el host. En el host del jugador,
 * `/dashboard` no es una ruta válida: el middleware la devuelve a `/play`.
 *
 * Por eso esta pregunta no es cosmética. Cualquier código de cliente que
 * mande a alguien a `/dashboard` sin hacérsela primero puede armar un
 * **bucle de recargas**:
 *
 *   `/play` → (efecto) `router.replace('/dashboard')` → middleware 307
 *   → `/play` → (efecto) … y otra vez, para siempre.
 *
 * Y recarga entera, no navegación suave: el 307 del middleware llega sin los
 * headers de redirección de Next, así que el router cae a `window.location`.
 *
 * ⚠️ **Pasó en producción el 2026-09-09.** Un operador con sesión de jugador
 * abría un link de referido y la página se recargaba sola sin parar: el
 * formulario de registro aparecía un instante y desaparecía.
 *
 * El middleware usa esta misma función para decidir lo contrario —qué host
 * SÍ sirve el panel—, así que las dos mitades no pueden divergir. Que
 * divergieran es justamente lo que causó el bucle.
 */
export function elPanelViveEnEsteHost(host: string): boolean {
  const h = host.toLowerCase();

  // Dev: no hay subdominios, todo se sirve por path desde el mismo host.
  if (h.includes('localhost') || h.startsWith('127.') || h.includes('0.0.0.0')) {
    return true;
  }

  // `admin.` en producción, `admin-` en staging: el certificado universal de
  // Cloudflare cubre un solo nivel de subdominio (ver middleware.ts).
  //
  // El host del CRM queda afuera a propósito: ahí adentro sólo existe Soporte
  // y el middleware manda todo lo demás a `/support`.
  return h.startsWith('admin.') || h.startsWith('admin-');
}
