// Orígenes desde los que llegan URLs de storage. Se normalizan a rutas
// relativas para que pasen por el rewrite de Next (mismo-origen). Ambos son
// configurables por env (para el VPS); si no se setean, caen a los orígenes
// actuales (API en Railway + Cloudflare Worker). Al ser NEXT_PUBLIC_* se
// hornean en el build del cliente.
const API_ORIGIN =
  process.env.NEXT_PUBLIC_API_ORIGIN ??
  'https://plataforma-casino-production.up.railway.app';
const WORKER_ORIGIN =
  process.env.NEXT_PUBLIC_WORKER_ORIGIN ??
  'https://casino-uploader.urielalejandrovalle493.workers.dev';

export function normalizeStorageUrl(url: string | null | undefined): string {
  if (!url) return '';
  // Worker URL: /files/... → /storage/files/... (for Next.js rewrite)
  if (url.startsWith(WORKER_ORIGIN + '/files/')) {
    return '/storage/files/' + url.slice(WORKER_ORIGIN.length + '/files/'.length);
  }
  // API origin URL: strip origin, keep /storage/files/...
  if (url.startsWith(API_ORIGIN)) return url.slice(API_ORIGIN.length);
  return url;
}
