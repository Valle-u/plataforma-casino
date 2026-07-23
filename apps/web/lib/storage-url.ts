const RAILWAY_ORIGIN = 'https://plataforma-casino-production.up.railway.app';

export function normalizeStorageUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (url.startsWith(RAILWAY_ORIGIN)) return url.slice(RAILWAY_ORIGIN.length);
  return url;
}
