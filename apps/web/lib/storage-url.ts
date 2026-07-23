const RAILWAY_ORIGIN = 'https://plataforma-casino-production.up.railway.app';
const WORKER_ORIGIN = 'https://casino-uploader.urielalejandrovalle493.workers.dev';

export function normalizeStorageUrl(url: string | null | undefined): string {
  if (!url) return '';
  // Worker URL: /files/... → /storage/files/... (for Next.js rewrite)
  if (url.startsWith(WORKER_ORIGIN + '/files/')) {
    return '/storage/files/' + url.slice(WORKER_ORIGIN.length + '/files/'.length);
  }
  // Railway URL: strip origin, keep /storage/files/...
  if (url.startsWith(RAILWAY_ORIGIN)) return url.slice(RAILWAY_ORIGIN.length);
  return url;
}
