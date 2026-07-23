/**
 * Cloudflare Worker — Casino Upload Proxy
 *
 * Receives multipart file uploads from Railway API, stores them in R2
 * via Cloudflare's internal network (bypasses the TLS issue Railway has
 * with R2's S3 API).
 *
 * Auth: Bearer token via CF_WORKER_UPLOAD_TOKEN env var.
 * R2 binding: R2_BUCKET (configured in wrangler.toml).
 * Public URL: R2_PUBLIC_BASE_URL env var.
 */

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
]);

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

export default {
  async fetch(request, env) {
    // Only accept POST
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // Auth
    const auth = request.headers.get('Authorization');
    if (auth !== `Bearer ${env.CF_WORKER_UPLOAD_TOKEN}`) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    // Parse multipart form
    const contentType = request.headers.get('Content-Type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return jsonResponse({ error: 'Expected multipart/form-data' }, 400);
    }

    let formData;
    try {
      formData = await request.formData();
    } catch {
      return jsonResponse({ error: 'Failed to parse form data' }, 400);
    }

    const file = formData.get('file');
    const keyPrefix = formData.get('keyPrefix') || 'hero';
    const tenantSlug = formData.get('tenantSlug') || 'unknown';

    if (!file || typeof file === 'string') {
      return jsonResponse({ error: 'No file provided (campo "file")' }, 400);
    }

    // Validate MIME type
    if (!ALLOWED_TYPES.has(file.type)) {
      return jsonResponse(
        { error: `Tipo no permitido (${file.type}). Permitidos: jpg, png, webp, avif.` },
        400,
      );
    }

    // Validate size
    if (file.size > MAX_SIZE) {
      return jsonResponse(
        { error: `Archivo demasiado grande (${(file.size / 1024 / 1024).toFixed(1)}MB). Máximo: 10MB.` },
        400,
      );
    }

    // Generate storage key
    const ext = getExt(file.name);
    const id = crypto.randomUUID();
    const storageKey = `tenants/${tenantSlug}/${keyPrefix}/${id}${ext}`;

    // Upload to R2 via internal binding (no TLS issues)
    try {
      await env.R2_BUCKET.put(storageKey, file.stream(), {
        httpMetadata: {
          contentType: file.type,
          cacheControl: 'public, max-age=31536000, immutable',
        },
      });
    } catch (err) {
      console.error('R2 upload failed:', err);
      return jsonResponse({ error: 'Failed to store file in R2' }, 500);
    }

    const publicBaseUrl = (env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');
    const url = `${publicBaseUrl}/${storageKey}`;

    return jsonResponse({
      url,
      storageKey,
      sizeBytes: file.size,
    });
  },
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  });
}

function getExt(filename) {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return '';
  const ext = filename.slice(dot).toLowerCase();
  if (ext.length > 8) return '';
  return ext;
}
