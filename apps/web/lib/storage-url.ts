const RAILWAY_STORAGE_PREFIX = 'https://plataforma-casino-production.up.railway.app/storage/files/';

export function normalizeStorageUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (url.startsWith(RAILWAY_STORAGE_PREFIX)) return url.slice(RAILWAY_STORAGE_PREFIX.length - 1);
  return url;
}
