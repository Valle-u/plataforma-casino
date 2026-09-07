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

console.log(fallas === 0 ? '\nTodo bien.' : `\n${fallas} fallas`);
process.exit(fallas === 0 ? 0 : 1);
