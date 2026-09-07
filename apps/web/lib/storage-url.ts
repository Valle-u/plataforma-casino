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
