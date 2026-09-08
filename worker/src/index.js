/**
 * Cloudflare Worker — Casino Upload Proxy + File Server
 *
 * Handles two operations:
 *   POST /upload — multipart file upload → R2 storage
 *   GET|HEAD /files/* — serve files from R2 with caching headers
 *   DELETE /files/* — borrar de R2 (autenticado)
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
  'application/pdf',
]);

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Qué archivos son documentos privados y no pueden cachearse en el borde.
 *
 * Los comprobantes —transferencias bancarias, depósitos— llevan nombre, CBU,
 * banco y monto de personas reales. Y los adjuntos del chat llevan lo mismo o
 * peor: la gente manda por ahí fotos del DNI y capturas de transferencias.
 *
 * Con el `immutable` de un año que había antes pasaban dos cosas malas:
 *
 *   1. Quedaba una copia en el caché de Cloudflare, servible por URL.
 *   2. **Borrar el archivo de R2 no lo sacaba de circulación**: verificado el
 *      2026-09-06 — se borró un objeto y su URL siguió devolviendo 200 con
 *      `cf-cache-status: HIT` durante un año.
 *
 * `private` le prohíbe al borde guardarlo: sólo el navegador del que lo pidió,
 * y por 5 minutos. Así borrar tiene efecto inmediato.
 *
 * ⚠️ Esto NO los vuelve privados: siguen siendo accesibles por URL sin
 * autenticación. Eso se arregla con URLs firmadas o un endpoint autenticado
 * (ver `docs/12-seguridad-compliance.md`). Este cambio sólo corta que se
 * acumulen copias imborrables en el borde.
 */
/**
 * ⚠️ **Esta lista tiene un gemelo.** `CARPETAS_PRIVADAS` en
 * `apps/api/src/storage/cloudflare-worker-driver.ts` decide qué URLs se firman;
 * ésta decide qué URLs se exigen firmadas y qué se cachea. **Si divergen, el
 * fallo es silencioso**: una carpeta que la API firma y el Worker no considera
 * privada sale igual (nadie se entera), y al revés corta el acceso.
 *
 * No se puede compartir el código: el Worker es un bundle aparte, sin acceso a
 * `apps/api`. Así que se duplica a propósito, con este aviso en los dos lados.
 *
 * `chat/attachments` se sumó el 2026-09-08: estaba fuera de la regla desde que
 * se construyó el livechat, así que sus adjuntos se venían sirviendo públicos y
 * con caché de un año. Ver `docs/crm/14-decisiones.md` D12.
 */
const CARPETAS_PRIVADAS = ['/proofs/', '/chat/attachments/'];

/** ¿Es un documento privado? (comprobantes, adjuntos del chat) */
function esPrivada(key) {
  return CARPETAS_PRIVADAS.some((c) => key.includes(c));
}

/** Cache-Control según el tipo de archivo. */
function cacheControlPara(key) {
  // Documentos: nunca en el borde, poco en el navegador.
  if (esPrivada(key)) return 'private, max-age=300';
  // Marca (logos, hero): la key es un UUID y el archivo nunca cambia.
  return 'public, max-age=31536000, immutable';
}

/**
 * Valida la firma de una URL de comprobante.
 *
 * La genera `CloudflareWorkerDriver.getUrl` en la API con el mismo secreto:
 * HMAC-SHA256 sobre `<key>:<exp>`. Se firma la key **y** el vencimiento
 * juntos — firmar sólo el vencimiento dejaría reusar una firma para cualquier
 * archivo.
 *
 * Devuelve `null` si está bien, o el motivo del rechazo.
 */
async function validarFirma(key, url, env) {
  const exp = Number(url.searchParams.get('exp'));
  const sig = url.searchParams.get('sig');
  if (!exp || !sig) return 'falta la firma';
  if (!Number.isFinite(exp)) return 'vencimiento invalido';
  if (exp * 1000 < Date.now()) return 'la URL vencio';

  const llave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.CF_WORKER_SIGNING_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    llave,
    new TextEncoder().encode(`${key}:${exp}`),
  );
  const esperado = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Comparación de tiempo constante: un `===` filtra, por el tiempo que tarda
  // en cortar, cuántos caracteres del principio acertó quien prueba firmas.
  if (esperado.length !== sig.length) return 'firma invalida';
  let dif = 0;
  for (let i = 0; i < esperado.length; i += 1) {
    dif |= esperado.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  return dif === 0 ? null : 'firma invalida';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(new Response(null, { status: 204 }));
    }

    // GET | HEAD /files/:key — serve file from R2
    //
    // HEAD tiene que contestar lo MISMO que GET pero sin cuerpo. Antes caía al
    // 404 genérico del final, y eso engaña a cualquier chequeo de existencia:
    // el 2026-09-07 un `curl -I` sobre el logo del casino devolvió 404 y se
    // llegó a dar por perdidas las imágenes de marca, que estaban intactas.
    if (
      (request.method === 'GET' || request.method === 'HEAD') &&
      url.pathname.startsWith('/files/')
    ) {
      const esHead = request.method === 'HEAD';
      const res = await this.serveFile(url, env, esHead);
      // Se reconstruye sin cuerpo en vez de devolver `res`: un HEAD no lleva
      // body en NINGÚN estado, tampoco en el 403 ni en el 404.
      return esHead
        ? new Response(null, { status: res.status, headers: res.headers })
        : res;
    }

    // POST /upload — upload file to R2
    if (request.method === 'POST' && url.pathname === '/upload') {
      return this.uploadFile(request, env);
    }

    // DELETE /files/:key — borrar de R2. Autenticado con el mismo token que
    // el upload: NO puede ser público, es la operación más destructiva del
    // Worker.
    if (request.method === 'DELETE' && url.pathname.startsWith('/files/')) {
      return this.deleteFile(url, request, env);
    }

    return jsonResponse(
      { error: 'Not found. Use POST /upload, GET|HEAD /files/:key or DELETE /files/:key' },
      404,
    );
  },

  /**
   * @param {boolean} soloCabeceras `true` para un HEAD: se pide a R2 sólo la
   *   metadata (`head`) en vez del objeto entero. Las cabeceras y el estado
   *   salen idénticos a los del GET — es la única forma de que un HEAD sirva
   *   para lo que se usa, que es preguntar si algo existe y cuánto pesa.
   */
  async serveFile(url, env, soloCabeceras = false) {
    const key = url.pathname.slice('/files/'.length);
    if (!key) return jsonResponse({ error: 'Missing file key' }, 400);

    // Comprobantes: sólo con URL firmada y vigente.
    //
    // Detrás de un flag a propósito. El despliegue va en DOS pasos: primero
    // esto con el flag apagado (la API ya firma, el Worker todavía no exige),
    // se verifica que el panel siga mostrando los comprobantes, y recién ahí se
    // prende. Si se prendiera de una y algo quedó sin firmar, el operador deja
    // de ver los comprobantes y no puede aprobar depósitos — o sea, se corta un
    // flujo de plata.
    // El nombre de la variable es histórico: nació para los comprobantes y hoy
    // gobierna todas las CARPETAS_PRIVADAS. No se renombra porque el valor vive
    // en `wrangler.toml` y un nombre nuevo leído contra el viejo daría
    // `undefined` — o sea, la validación apagada sin que nadie lo note.
    if (esPrivada(key) && env.REQUIRE_SIGNED_PROOFS === '1') {
      if (!env.CF_WORKER_SIGNING_SECRET) {
        console.error('REQUIRE_SIGNED_PROOFS=1 pero falta CF_WORKER_SIGNING_SECRET');
        return jsonResponse({ error: 'Server misconfigured' }, 500);
      }
      const motivo = await validarFirma(key, url, env);
      if (motivo) {
        // 403 y no 404: el archivo existe, lo que falta es la autorización.
        return jsonResponse({ error: 'Forbidden', reason: motivo }, 403);
      }
    }

    const object = soloCabeceras
      ? await env.R2_BUCKET.head(key)
      : await env.R2_BUCKET.get(key);
    if (!object) {
      return jsonResponse({ error: 'File not found' }, 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('Cache-Control', cacheControlPara(key));
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Content-Length', String(object.size));

    // `head()` no trae `body`. El router igual descarta el cuerpo en un HEAD,
    // pero pedirle a R2 sólo la metadata evita traer el objeto entero para
    // después tirarlo.
    return new Response(soloCabeceras ? null : object.body, { headers });
  },

  /**
   * Borra un archivo de R2.
   *
   * Existe porque el driver de la API tenía `delete()` sin implementar: al
   * rechazar un depósito se suponía que se borraba el comprobante y en realidad
   * sólo se escribía un warning. Los comprobantes de depósitos rechazados
   * quedaban en R2 para siempre.
   *
   * **Idempotente**: borrar algo que no está devuelve OK. El caller —rechazar un
   * depósito— no debería fallar porque el archivo ya no exista; lo que le
   * importa es que después de llamar, no esté.
   */
  async deleteFile(url, request, env) {
    const auth = request.headers.get('Authorization');
    if (auth !== `Bearer ${env.CF_WORKER_UPLOAD_TOKEN}`) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const key = url.pathname.slice('/files/'.length);
    if (!key) return jsonResponse({ error: 'Missing file key' }, 400);

    try {
      await env.R2_BUCKET.delete(key);
    } catch (err) {
      console.error('R2 delete failed:', err);
      return jsonResponse({ error: 'Failed to delete file from R2' }, 500);
    }

    return jsonResponse({ deleted: true, key });
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
        { error: `Tipo no permitido (${file.type}). Permitidos: jpg, png, webp, avif, pdf.` },
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
          cacheControl: cacheControlPara(storageKey),
        },
      });
    } catch (err) {
      console.error('R2 upload failed:', err);
      return jsonResponse({ error: 'Failed to store file in R2' }, 500);
    }

    // Build the serving URL — points to this Worker's GET endpoint
    const workerBase = new URL(request.url).origin;
    const url2 = `${workerBase}/files/${storageKey}`;

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
  response.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, DELETE, OPTIONS');
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
