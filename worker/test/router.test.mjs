/**
 * Router del Worker, con un R2 simulado.
 *
 * Correr con:  node worker/test/router.test.mjs
 *
 * Sin framework a propósito: es el único test del Worker y no vale la pena
 * traerle un runner. Sale 0 si pasa todo.
 *
 * **Por qué existe.** El Worker sirve TODOS los archivos del casino —imágenes de
 * marca y comprobantes— y no tenía ninguna prueba. El 2026-09-07 se descubrió
 * que no manejaba HEAD: caía al 404 genérico. Un `curl -I` sobre el logo
 * devolvió 404 y se llegó a dar por perdidas las imágenes de marca, que estaban
 * intactas.
 *
 * Lo que se fija acá es que **HEAD conteste lo mismo que GET pero sin cuerpo**,
 * en el 200 y en el 404, conservando `Content-Length` y `Cache-Control` — que
 * es lo que hace que un HEAD sirva para preguntar si algo existe y cuánto pesa.
 */
import worker from '../src/index.js';

const CONTENIDO = new TextEncoder().encode('x'.repeat(1234));
const ARCHIVOS = new Map([
  ['tenants/t/hero/logo.png', { size: 1234, tipo: 'image/png' }],
  ['tenants/t/deposits/proofs/x.pdf', { size: 99, tipo: 'application/pdf' }],
  ['tenants/t/chat/attachments/y.jpg', { size: 77, tipo: 'image/jpeg' }],
  // Un tenant cuyo nombre contiene "chat": la carpeta privada es
  // `/chat/attachments/`, no la palabra suelta.
  ['tenants/chat-royale/hero/logo.png', { size: 5, tipo: 'image/png' }],
]);

function objeto(meta, conCuerpo) {
  return {
    size: meta.size,
    writeHttpMetadata: (h) => h.set('Content-Type', meta.tipo),
    ...(conCuerpo ? { body: new Blob([CONTENIDO]).stream() } : {}),
  };
}

const env = {
  REQUIRE_SIGNED_PROOFS: '0',
  CF_WORKER_UPLOAD_TOKEN: 'tok',
  R2_BUCKET: {
    get: async (k) => (ARCHIVOS.has(k) ? objeto(ARCHIVOS.get(k), true) : null),
    head: async (k) => (ARCHIVOS.has(k) ? objeto(ARCHIVOS.get(k), false) : null),
  },
};

const pedir = (metodo, ruta) =>
  worker.fetch(new Request('https://x.test' + ruta, { method: metodo }), env);

let fallas = 0;
const check = (nombre, ok, extra = '') => {
  if (!ok) fallas++;
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre}${extra ? '  ' + extra : ''}`);
};

const g200 = await pedir('GET', '/files/tenants/t/hero/logo.png');
const h200 = await pedir('HEAD', '/files/tenants/t/hero/logo.png');
check('GET existente -> 200', g200.status === 200, `(${g200.status})`);
check('HEAD existente -> 200', h200.status === 200, `(${h200.status})`);
check('HEAD sin cuerpo', (await h200.clone().text()) === '');
check('GET con cuerpo', (await g200.clone().text()).length === 1234);
check(
  'HEAD conserva Content-Length',
  h200.headers.get('Content-Length') === g200.headers.get('Content-Length'),
  `(${h200.headers.get('Content-Length')})`,
);
check(
  'HEAD conserva Cache-Control',
  h200.headers.get('Cache-Control') === g200.headers.get('Cache-Control'),
  `(${h200.headers.get('Cache-Control')})`,
);

const g404 = await pedir('GET', '/files/tenants/t/no-existe.png');
const h404 = await pedir('HEAD', '/files/tenants/t/no-existe.png');
check('GET inexistente -> 404', g404.status === 404, `(${g404.status})`);
check('HEAD inexistente -> 404', h404.status === 404, `(${h404.status})`);
check('HEAD 404 sin cuerpo', (await h404.text()) === '');

const proof = await pedir('HEAD', '/files/tenants/t/deposits/proofs/x.pdf');
check(
  'HEAD de comprobante usa Cache-Control privado',
  proof.headers.get('Cache-Control') === 'private, max-age=300',
  `(${proof.headers.get('Cache-Control')})`,
);

const sinAuth = await pedir('DELETE', '/files/tenants/t/hero/logo.png');
check('DELETE sin token -> 401', sinAuth.status === 401, `(${sinAuth.status})`);

const otro = await pedir('PUT', '/files/x');
check('metodo no soportado -> 404', otro.status === 404, `(${otro.status})`);

// ── Adjuntos del chat ───────────────────────────────────────────────────────
//
// Entraron a la carpeta privada el 2026-09-08. Antes la regla miraba sólo
// `/proofs/`, así que las fotos que la gente manda por el livechat —DNI,
// capturas de transferencias— se servían públicas y con caché de un año.

const adj = await pedir('GET', '/files/tenants/t/chat/attachments/y.jpg');
check(
  'adjunto del chat usa Cache-Control privado',
  adj.headers.get('Cache-Control') === 'private, max-age=300',
  `(${adj.headers.get('Cache-Control')})`,
);

const falsoPositivo = await pedir('GET', '/files/tenants/chat-royale/hero/logo.png');
check(
  'un tenant llamado "chat" NO vuelve privado su logo',
  falsoPositivo.headers.get('Cache-Control') === 'public, max-age=31536000, immutable',
  `(${falsoPositivo.headers.get('Cache-Control')})`,
);

// ── Con la firma exigida ────────────────────────────────────────────────────

const SECRETO = 'secreto-de-prueba';
const envFirmado = { ...env, REQUIRE_SIGNED_PROOFS: '1', CF_WORKER_SIGNING_SECRET: SECRETO };

async function firmar(key, exp) {
  const llave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRETO),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    llave,
    new TextEncoder().encode(`${key}:${exp}`),
  );
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const pedirFirmado = (ruta) =>
  worker.fetch(new Request('https://x.test' + ruta, { method: 'GET' }), envFirmado);

const KEY_CHAT = 'tenants/t/chat/attachments/y.jpg';
const sinFirma = await pedirFirmado('/files/' + KEY_CHAT);
check('adjunto del chat sin firma -> 403', sinFirma.status === 403, `(${sinFirma.status})`);

const exp = Math.floor(Date.now() / 1000) + 900;
const sig = await firmar(KEY_CHAT, exp);
const conFirma = await pedirFirmado(`/files/${KEY_CHAT}?exp=${exp}&sig=${sig}`);
check('adjunto del chat con firma -> 200', conFirma.status === 200, `(${conFirma.status})`);

// La firma de un archivo NO sirve para otro, aunque el vencimiento sea el mismo.
const cruzada = await pedirFirmado(
  `/files/tenants/t/deposits/proofs/x.pdf?exp=${exp}&sig=${sig}`,
);
check('firma de un archivo no abre otro -> 403', cruzada.status === 403, `(${cruzada.status})`);

// Una URL vencida no abre, aunque la firma sea correcta para ese vencimiento.
const expViejo = Math.floor(Date.now() / 1000) - 10;
const sigViejo = await firmar(KEY_CHAT, expViejo);
const vencida = await pedirFirmado(`/files/${KEY_CHAT}?exp=${expViejo}&sig=${sigViejo}`);
check('adjunto con firma vencida -> 403', vencida.status === 403, `(${vencida.status})`);

// La marca sigue abierta aunque la firma esté exigida: es pública a propósito.
const marcaFirmado = await pedirFirmado('/files/tenants/t/hero/logo.png');
check('la marca sigue abierta con la firma exigida -> 200', marcaFirmado.status === 200, `(${marcaFirmado.status})`);

console.log(fallas === 0 ? '\nTodo bien.' : `\n${fallas} fallas`);
process.exit(fallas === 0 ? 0 : 1);
