/**
 * Cloudflare Worker — Casino Upload Proxy + File Server
 *
 * Handles two operations:
 *   POST /upload — multipart file upload → R2 storage
 *   GET  /files/* — serve files from R2 with caching headers
 *
 * This bypasses the TLS issue between Railway and R2's S3 API by using
 * Cloudflare's internal network via R2 bindings.
 *
 * Auth (upload only): Bearer token via CF_WORKER_UPLOAD_TOKEN env var.
 * R2 binding: R2_BUCKET (configured in wrangler.toml).
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
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(new Response(null, { status: 204 }));
    }

    // GET /files/:key — serve file from R2
    if (request.method === 'GET' && url.pathname.startsWith('/files/')) {
      return this.serveFile(url, env);
    }

    // POST /upload — upload file to R2
    if (request.method === 'POST' && url.pathname === '/upload') {
      return this.uploadFile(request, env);
    }

    return jsonResponse({ error: 'Not found. Use POST /upload or GET /files/:key' }, 404);
  },

  async serveFile(url, env) {
    const key = url.pathname.slice('/files/'.length);
    if (!key) return jsonResponse({ error: 'Missing file key' }, 400);

    const object = await env.R2_BUCKET.get(key);
    if (!object) {
      return jsonResponse({ error: 'File not found' }, 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Content-Length', String(object.size));

    return new Response(object.body, { headers });
  },

  async uploadFile(request, env) {
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
        { error: `Archivo demasiado grande (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximo: 10MB.` },
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

    // Build the serving URL — points to this Worker's GET endpoint
    const workerBase = url || new URL(request.url).origin;
    const url2 = `${workerBase.replace(/\/$/, '')}/files/${storageKey}`;

    return jsonResponse({
      url: url2,
      storageKey,
      sizeBytes: file.size,
    });
  },
};

function jsonResponse(data, status = 200) {
  return corsResponse(new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

function corsResponse(response) {
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  return response;
}

function getExt(filename) {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return '';
  const ext = filename.slice(dot).toLowerCase();
  if (ext.length > 8) return '';
  return ext;
}
