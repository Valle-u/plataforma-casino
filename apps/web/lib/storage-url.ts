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
const WORKER_ORIGIN =
  process.env.NEXT_PUBLIC_WORKER_ORIGIN ||
  'https://casino-uploader.urielalejandrovalle493.workers.dev';

export function normalizeStorageUrl(url: string | null | undefined): string {
  if (!url) return '';
  // Worker URL: /files/... → /storage/files/... (for Next.js rewrite)
  if (url.startsWith(WORKER_ORIGIN + '/files/')) {
    return '/storage/files/' + url.slice(WORKER_ORIGIN.length + '/files/'.length);
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
