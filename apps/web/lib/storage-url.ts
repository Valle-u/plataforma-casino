// Orígenes desde los que llegan URLs de storage. Se normalizan a rutas
// relativas para que pasen por el rewrite de Next (mismo-origen). Al ser
// NEXT_PUBLIC_* se hornean en el build del cliente.
//
// ⚠️ 2026-09-04: `NEXT_PUBLIC_API_ORIGIN` NO está en los buildArgs de ninguna
// app, así que en la práctica siempre se usa el fallback. Antes ese fallback
// era `plataforma-casino-production.up.railway.app` — un dominio que **dejó de
// existir** cuando se dio de baja Railway ese mismo día, y que Railway puede
// re-asignar a otra cuenta. Un dominio ajeno horneado en el bundle como
// "origen conocido de nuestro storage" no es algo que convenga dejar.
//
// Ahora cae a `NEXT_PUBLIC_API_URL`, que sí está seteada y es la misma API de
// la que vienen esas URLs. Si algún día hacen falta orígenes distintos, se
// setea `NEXT_PUBLIC_API_ORIGIN` explícito.
// OJO: usamos `||` (no `??`) a propósito. El Dockerfile del web hace
// `ENV NEXT_PUBLIC_X=$ARG`; si el build no pasa el ARG, la env queda como
// STRING VACÍO "" (no undefined), y `??` NO lo atrapa → quedaría "" y las
// URLs de storage no se normalizarían (se inyectaba la URL cruda del worker,
// que da 404 — favicon/logo/slides rotos en el VPS). Con `||` el "" cae al
// fallback correcto.
const API_ORIGIN =
  process.env.NEXT_PUBLIC_API_ORIGIN ||
  process.env.NEXT_PUBLIC_API_URL ||
  '';

/**
 * La misma imagen, pero pedida al optimizador de Next en vez de cruda.
 *
 * **Por qué hace falta.** Las imágenes que sube el operador desde el panel son
 * los archivos originales: el logo de MiamiHub es un PNG de **2,8 MB** que se
 * muestra a 100 píxeles de ancho. Un `<img src>` directo baja esos 2,8 MB en
 * cada carga, con prioridad alta, compitiendo con todo lo demás — y con mala
 * conexión eso es la diferencia entre ver el casino y ver una pantalla a medio
 * armar. Por el optimizador, la misma imagen son **16 KB** en WebP.
 *
 * Se usa donde hay un `<img>` que no se puede cambiar por `next/image` sin
 * tocar el layout: el optimizador acepta rutas relativas del mismo origen y
 * devuelve el formato que el browser soporte.
 *
 * Devuelve la URL tal cual si no es una ruta local (una imagen externa que Next
 * no tiene configurada daría 400, y es peor no mostrar nada que mostrar pesado).
 */
export function optimizedStorageUrl(
  url: string | null | undefined,
  width: number,
  quality = 75,
): string {
  const normalizada = normalizeStorageUrl(url);
  if (!normalizada.startsWith('/')) return normalizada;
  return `/_next/image?url=${encodeURIComponent(normalizada)}&w=${anchoPermitido(width)}&q=${quality}`;
}

/**
 * Anchos que `/_next/image` acepta: `imageSizes` + `deviceSizes` de Next.
 *
 * ⚠️ **Cualquier otro valor devuelve 400 y la imagen no se muestra.** No es una
 * sugerencia: es una lista blanca, y existe para que nadie pueda usar el
 * optimizador como generador de miniaturas a medida. Pasó el 2026-09-07 al
 * optimizar el logo: se pidió `w=260` (130 × 2) y el logo desapareció.
 */
const ANCHOS_DE_NEXT = [
  16, 32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840,
];

/** El permitido más chico que alcance para `deseado`. */
function anchoPermitido(deseado: number): number {
  return ANCHOS_DE_NEXT.find((a) => a >= deseado) ?? ANCHOS_DE_NEXT[ANCHOS_DE_NEXT.length - 1]!;
}

export function normalizeStorageUrl(url: string | null | undefined): string {
  if (!url) return '';

  // URL del Worker: cualquier origen cuyo path arranque en `/files/` se
  // reescribe a `/storage/files/...` para que pase por el rewrite de Next.
  //
  // Antes esto comparaba contra un origen fijo —el `*.workers.dev` de la
  // cuenta— y eso lo ataba a dos cosas malas: el subdominio lleva el NOMBRE
  // del titular de la cuenta de Cloudflare, y cualquier cambio de dominio
  // rompía la normalización en silencio, dejando salir la URL cruda. Mirar el
  // path en vez del host funciona con los dos mientras se hace el cambio, y
  // con el que venga después.
  if (/^https?:\/\//.test(url)) {
    try {
      const u = new URL(url);
      if (u.pathname.startsWith('/files/')) {
        return '/storage' + u.pathname + u.search;
      }
    } catch {
      // URL mal formada: se devuelve tal cual más abajo.
    }
  }
  // API origin URL: strip origin, keep /storage/files/...
  // El `API_ORIGIN &&` no es decorativo: si quedara vacío, `startsWith('')` es
  // SIEMPRE true y esta rama se comería todas las URLs. Hoy devolvería la misma
  // (`slice(0)`), pero es una trampa esperando a que alguien toque el slice.
  if (API_ORIGIN && url.startsWith(API_ORIGIN)) {
    return url.slice(API_ORIGIN.length);
  }
  return url;
}
