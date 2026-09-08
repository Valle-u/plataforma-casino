/**
 * Paleta del tenant resuelta EN EL SERVIDOR, para pintarla en el primer HTML.
 *
 * **El problema que resuelve.** Los colores se aplicaban sólo desde el
 * navegador: la página se pintaba con los del sistema de diseño, salía el
 * pedido a `/tenant/info`, y al llegar la respuesta React repintaba con los del
 * casino. Ese salto se veía en cada carga, y en los colores se nota más que en
 * cualquier otra cosa porque del acento derivan botones, bordes, brillos y
 * degradados: no parpadea un elemento, parpadea la pantalla entera.
 *
 * Resolviéndolo acá, el HTML ya sale con las variables correctas y **el primer
 * pintado es el definitivo**. El cliente sigue haciendo lo suyo y calcula los
 * mismos valores, así que al hidratar no cambia nada visible.
 *
 * Degrada solo: si el backend no responde, se devuelve `null` y todo queda como
 * antes — vuelve el parpadeo, pero nada se rompe.
 */

import { headers } from 'next/headers';
import { adminAccentVars } from './admin-accent';
import { deriveAdminVars } from './admin-appearance';
import { bloqueCssDeVariables, variablesDeColorDelTenant } from './tenant-color-vars';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

/** Sólo lo que se usa acá. El endpoint devuelve bastante más. */
interface RespuestaTenantInfo {
  branding?: { primaryColor?: string | null } | null;
  design?: { colors?: unknown } | null;
  adminAppearance?: { accent?: string; bg?: string } | null;
}

/** El host del pedido, sin puerto. `''` si no vino ninguno. */
async function hostDelPedido(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-host') ?? h.get('host') ?? '').split(':')[0] ?? '';
}

/** El panel y la interfaz de jugador viven en hosts distintos de la misma app. */
function esHostDePanel(host: string): boolean {
  return host.startsWith('admin.') || host.startsWith('admin-');
}

/**
 * Pide la configuración pública del tenant.
 *
 * ⚠️ **El host va en la URL, no sólo en la cabecera.** Next cachea los `fetch`
 * por URL, y acá la URL sería idéntica para todos los casinos — lo único que
 * los distingue es `X-Tenant-Host`, que el caché no mira. Sin el parámetro,
 * **un casino podría recibir los colores de otro**: el primero en pedir llena
 * el caché y los demás comen esa entrada. El backend ignora el query extra; su
 * única función es separar las entradas del caché.
 */
async function traerInfo(host: string): Promise<RespuestaTenantInfo | null> {
  if (!host) return null;
  try {
    const res = await fetch(
      `${API_URL}/tenant/info?host=${encodeURIComponent(host)}`,
      {
        headers: { Accept: 'application/json', 'X-Tenant-Host': host },
        // La paleta cambia cuando el operador la edita, no seguido. 60s deja
        // el costo en cero y hace que un cambio se vea en menos de un minuto.
        next: { revalidate: 60 },
      },
    );
    if (!res.ok) return null;
    return (await res.json()) as RespuestaTenantInfo;
  } catch {
    return null;
  }
}

/**
 * Bloque CSS con la paleta del tenant, listo para un `<style>` en el `<head>`.
 * `null` si no se pudo resolver.
 *
 * Se emite sobre `:root`, que es lo MENOS específico que hay: cuando el cliente
 * hidrata y aplica lo suyo —un `style` en línea en el jugador, una regla
 * `.admin-neutral` en el panel— gana sin pelear. La del servidor sólo tiene que
 * durar hasta ese momento.
 */
export async function cssDeLaPaletaDelTenant(): Promise<string | null> {
  const host = await hostDelPedido();
  const info = await traerInfo(host);
  if (!info) return null;

  const colorDeMarca = info.branding?.primaryColor ?? null;

  // El panel tiene su propia apariencia, independiente de la del jugador: la
  // configura el operador aparte (`admin.appearance`). Pintarle los colores del
  // casino sería cambiarle el panel, no arreglarle el parpadeo.
  if (esHostDePanel(host)) {
    const ap = info.adminAppearance;
    const vars =
      ap?.accent && ap?.bg
        ? deriveAdminVars({ accent: ap.accent, bg: ap.bg })
        : colorDeMarca
          ? adminAccentVars(colorDeMarca)
          : null;
    return vars ? bloqueCssDeVariables(vars) : null;
  }

  const vars = variablesDeColorDelTenant(info.design?.colors, colorDeMarca);
  return bloqueCssDeVariables(vars);
}
