/**
 * Cifrado de secretos que se guardan en la base (**D20**).
 *
 * ## Qué protege, y qué no
 *
 * Protege contra que alguien **lea** la base: un dump, un backup, un `SELECT`
 * de más. Y eso importa acá por algo concreto: **el backup de producción sale
 * del VPS todos los días** (`0 6 * * *` → R2, ver `docs/24-entornos-deploy.md`).
 * Un token en texto plano en la base es un token en texto plano en otro sistema,
 * con otros accesos, todas las mañanas.
 *
 * **No** protege contra alguien que comprometa la aplicación corriendo: ahí
 * tiene la clave y puede descifrar. No es una caja fuerte, es la diferencia
 * entre "se filtró la base" y "se filtró la base **y** las credenciales".
 *
 * ## Por qué existe
 *
 * Por **D13**, los tokens de canal —el bot de Telegram, el número de WhatsApp—
 * **son de los socios, no nuestros**. Una filtración expone credenciales de
 * terceros que confiaron en la plataforma. Es lo que hace que este caso pese más
 * que las credenciales de proveedor que hoy sí están en texto plano.
 *
 * ## El formato
 *
 * ```
 * v1:<iv en base64>:<tag en base64>:<cifrado en base64>
 * ```
 *
 * - **`v1`** es la versión del formato. Existe para poder cambiar de algoritmo
 *   sin adivinar qué es cada fila: un `v2` convive con los `v1` viejos.
 * - **AES-256-GCM**, que además de cifrar **autentica**: si alguien edita el
 *   texto en la base, descifrar **falla** en vez de devolver basura silenciosa.
 * - El **IV es aleatorio en cada cifrado**, así que el mismo token cifrado dos
 *   veces da dos textos distintos. Sin eso, mirar la columna diría qué canales
 *   comparten credencial.
 *
 * ## La clave
 *
 * `CHANNEL_SECRET_KEY`: 32 bytes en hexadecimal (64 caracteres). Se genera con
 * `openssl rand -hex 32` y vive en Dokploy, como el resto de los secretos.
 *
 * `CHANNEL_SECRET_KEY_PREVIOUS` es opcional y sólo se usa para **descifrar**.
 * Es lo que hace que rotar la clave sea posible de verdad: se pone la nueva en
 * `CHANNEL_SECRET_KEY`, la vieja en `_PREVIOUS`, y las filas se van
 * re-cifrando a medida que se tocan. Sin ese segundo intento, rotar significa
 * dejar ilegible todo lo guardado.
 *
 * ## Sin clave NO se guarda nada
 *
 * `cifrar()` **tira** si no hay clave, en vez de guardar el texto plano. Es la
 * decisión importante de este archivo: un fallback silencioso a texto plano es
 * peor que un error, porque nadie se entera hasta que se filtra la base.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** Versión del formato. Un `v2` con otro algoritmo convive con los `v1`. */
const VERSION = 'v1';

/** AES-256-GCM: 32 bytes de clave, 12 de IV (el recomendado para GCM). */
const LARGO_CLAVE = 32;
const LARGO_IV = 12;

export class SecretoSinClaveError extends Error {
  constructor() {
    super(
      'Falta CHANNEL_SECRET_KEY: no se puede guardar un secreto de canal. ' +
        'Generá una con `openssl rand -hex 32` y cargala en el entorno.',
    );
    this.name = 'SecretoSinClaveError';
  }
}

export class SecretoIlegibleError extends Error {
  constructor(motivo: string) {
    super(`No se pudo descifrar el secreto: ${motivo}`);
    this.name = 'SecretoIlegibleError';
  }
}

/**
 * Lee una clave del entorno y valida que sirva.
 *
 * Valida el largo **acá y no al usarla**: una clave de 31 bytes falla recién al
 * cifrar, con un error de `node:crypto` que no dice qué está mal.
 */
function leerClave(nombre: string): Buffer | null {
  const hex = process.env[nombre];
  if (!hex) return null;
  const limpio = hex.trim();
  if (!/^[0-9a-fA-F]+$/.test(limpio) || limpio.length !== LARGO_CLAVE * 2) {
    throw new Error(
      `${nombre} tiene que ser ${LARGO_CLAVE} bytes en hexadecimal ` +
        `(${LARGO_CLAVE * 2} caracteres). Vino ${limpio.length}.`,
    );
  }
  return Buffer.from(limpio, 'hex');
}

/** ¿Está configurado el cifrado? Para avisar temprano, no para decidir guardar. */
export function hayClaveDeSecretos(): boolean {
  return leerClave('CHANNEL_SECRET_KEY') !== null;
}

/**
 * Cifra un secreto para guardarlo en la base.
 *
 * Tira `SecretoSinClaveError` si no hay clave. **No hay fallback a texto
 * plano**: ver el encabezado del archivo.
 */
export function cifrar(textoPlano: string): string {
  const clave = leerClave('CHANNEL_SECRET_KEY');
  if (!clave) throw new SecretoSinClaveError();

  const iv = randomBytes(LARGO_IV);
  const cipher = createCipheriv('aes-256-gcm', clave, iv);
  const cifrado = Buffer.concat([
    cipher.update(textoPlano, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    cifrado.toString('base64'),
  ].join(':');
}

/**
 * Descifra un secreto guardado.
 *
 * Prueba con la clave actual y, si falla, con `CHANNEL_SECRET_KEY_PREVIOUS`.
 * Ese segundo intento es lo que permite rotar sin dejar ilegible lo viejo.
 */
export function descifrar(guardado: string): string {
  const partes = guardado.split(':');
  if (partes.length !== 4) {
    throw new SecretoIlegibleError('el formato no es v1:iv:tag:cifrado');
  }
  const [version, ivB64, tagB64, cifradoB64] = partes as [
    string,
    string,
    string,
    string,
  ];
  if (version !== VERSION) {
    throw new SecretoIlegibleError(`versión desconocida "${version}"`);
  }

  const claves = [
    leerClave('CHANNEL_SECRET_KEY'),
    leerClave('CHANNEL_SECRET_KEY_PREVIOUS'),
  ].filter((c): c is Buffer => c !== null);

  if (claves.length === 0) throw new SecretoSinClaveError();

  for (const clave of claves) {
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        clave,
        Buffer.from(ivB64, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(cifradoB64, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // Clave equivocada o texto manipulado. Se prueba la siguiente; si no
      // queda ninguna, se tira abajo. No se distingue un caso del otro a
      // propósito: el mensaje no tiene por qué decir cuál de las dos falló.
      continue;
    }
  }

  throw new SecretoIlegibleError(
    'ninguna clave configurada lo abre, o el texto fue modificado',
  );
}

/**
 * ¿Este valor ya está cifrado?
 *
 * Sirve para no cifrar dos veces al guardar un canal que no cambió su token, y
 * para migrar filas viejas si alguna vez quedó texto plano.
 */
export function estaCifrado(valor: string): boolean {
  return valor.startsWith(`${VERSION}:`) && valor.split(':').length === 4;
}

/**
 * Compara dos secretos en tiempo constante.
 *
 * No lo usa el cifrado; está acá porque es el error de al lado: verificar un
 * token entrante con `===` filtra información por el tiempo que tarda. Lo va a
 * necesitar el webhook de Telegram, que compara un secreto de la URL.
 */
export function igualEnTiempoConstante(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // `timingSafeEqual` tira si los largos difieren, así que eso se chequea
  // antes — y ahí sí se filtra el largo, que no es un dato sensible.
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
