/**
 * De un `change` de Meta a los mensajes que entraron (**3.2**, procesamiento).
 *
 * Sin red y sin base: acá se decide **qué llegó**, separado de guardarlo. Es la
 * misma división que en Telegram (`telegram-media.ts`), y por la misma razón —
 * las reglas se prueban mejor solas.
 *
 * ## Lo que WhatsApp tiene y Telegram no: el teléfono
 *
 * Es **la** diferencia entre los dos canales. Telegram casi nunca da el número,
 * así que ahí un contacto nace como lead y **D4 no se ejecuta nunca**. Acá el
 * `from` viene siempre, así que **D4 funciona de lleno** y con él sus tres
 * defensas. Este módulo se encarga de la primera —normalizar antes de comparar—
 * dejando el número tal como lo manda Meta para que lo normalice `telefono.ts`.
 *
 * ## Un `change` puede traer varios mensajes
 *
 * Meta agrupa: `messages[]` es un array. Y en el mismo sobre pueden venir
 * también `statuses[]` (acuses de entrega), que **no son mensajes de nadie** y
 * no tienen que crear ninguna conversación.
 */

/** Un mensaje entrante, ya normalizado a lo que el CRM necesita. */
export interface MensajeDeWhatsapp {
  /** El `wamid`. **Único global**, a diferencia del `message_id` de Telegram. */
  id: string;
  /** El número de quien escribe, como lo manda Meta (sólo dígitos). */
  telefono: string;
  /** El nombre del perfil, si Meta lo mandó. */
  nombre: string | null;
  /** El texto, ya sea del mensaje o del `caption` de un adjunto. */
  texto: string;
  /**
   * Qué llegó además del texto, si no es un mensaje de texto a secas.
   *
   * `null` para un texto normal. Para todo lo demás —una foto, un audio, una
   * ubicación— trae **cómo nombrarlo**, porque el adjunto todavía no se puede
   * bajar y un mensaje vacío haría pensar al operador que se rompió algo.
   */
  adjunto: { tipo: string; comoSeLlama: string } | null;
}

/**
 * Cómo se nombra cada tipo que no es texto.
 *
 * Se nombran **todos**, incluso los que nunca vamos a soportar: el operador
 * tiene que poder entender qué pasó. Un mensaje en blanco es peor que uno que
 * dice "mandó una ubicación".
 */
const COMO_SE_LLAMA: Record<string, string> = {
  image: 'una foto',
  audio: 'un audio',
  voice: 'una nota de voz',
  video: 'un video',
  document: 'un archivo',
  sticker: 'una figurita',
  location: 'una ubicación',
  contacts: 'un contacto',
  reaction: 'una reacción',
  order: 'un pedido',
  interactive: 'una respuesta a un botón',
  button: 'una respuesta a un botón',
  unsupported: 'algo que WhatsApp no pudo entregar',
};

/**
 * Los mensajes de un `change`, ignorando lo que no es un mensaje.
 *
 * Devuelve `[]` para un cambio que sólo trae acuses de entrega, o para
 * cualquier payload con otra forma. **No tira nunca**: todo esto es texto de
 * afuera, y una excepción acá haría que el crudo quede sin procesar por un
 * campo raro.
 */
export function mensajesDelCambio(cambio: unknown): MensajeDeWhatsapp[] {
  const valor = comoObjeto(comoObjeto(cambio)?.value);
  if (!valor) return [];

  // El nombre del perfil viene aparte de los mensajes, en `contacts[]`, y se
  // cruza por `wa_id`. Meta lo manda una vez aunque haya varios mensajes.
  const nombres = new Map<string, string>();
  for (const c of comoArray(valor.contacts)) {
    const contacto = comoObjeto(c);
    const waId = texto(contacto?.wa_id);
    const nombre = texto(comoObjeto(contacto?.profile)?.name);
    if (waId && nombre) nombres.set(waId, nombre);
  }

  const salida: MensajeDeWhatsapp[] = [];

  for (const m of comoArray(valor.messages)) {
    const mensaje = comoObjeto(m);
    if (!mensaje) continue;

    const id = texto(mensaje.id);
    const telefono = texto(mensaje.from);
    // Sin `wamid` no hay clave de idempotencia, y sin `from` no se sabe de
    // quién es. Cualquiera de las dos faltando hace que el mensaje no se pueda
    // guardar bien, así que se descarta acá en vez de crear algo a medias.
    if (!id || !telefono) continue;

    const tipo = texto(mensaje.type) ?? 'unsupported';
    const cuerpo = texto(comoObjeto(mensaje.text)?.body) ?? '';

    salida.push({
      id,
      telefono,
      nombre: nombres.get(telefono) ?? null,
      // El `caption` de una foto o un archivo es texto del mensaje, no del
      // adjunto: si se perdiera, el operador vería "mandó una foto" sin lo que
      // la persona escribió al lado.
      texto: (cuerpo || captionDe(mensaje, tipo)).trim(),
      adjunto:
        tipo === 'text'
          ? null
          : { tipo, comoSeLlama: COMO_SE_LLAMA[tipo] ?? 'algo que no sabemos leer' },
    });
  }

  return salida;
}

/**
 * El texto que ve el operador cuando llegó algo que no es texto.
 *
 * Mismo criterio que el aviso de Telegram: dice **qué pasó**, no "error". Un
 * operador que lee *"mandó una nota de voz"* sabe qué hacer; uno que ve un
 * mensaje vacío piensa que se rompió algo.
 *
 * ⚠️ Dice **"no se puede ver acá todavía"** y no "no se soporta", porque es
 * cierto: bajar un adjunto de WhatsApp necesita el token del WABA contra la API
 * de Meta, y eso **no existe hasta que la cuenta salga del trámite**. El día que
 * exista, esto se reemplaza por la descarga.
 */
export function textoConAdjunto(msg: MensajeDeWhatsapp): string {
  if (!msg.adjunto) return msg.texto;
  const aviso = `⚠️ Mandó ${msg.adjunto.comoSeLlama}, y por ahora no se puede ver acá.`;
  return msg.texto ? `${msg.texto}\n\n${aviso}` : aviso;
}

/** El `caption` vive adentro del objeto del tipo (`image.caption`, etc.). */
function captionDe(mensaje: Record<string, unknown>, tipo: string): string {
  return texto(comoObjeto(mensaje[tipo])?.caption) ?? '';
}

function comoObjeto(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function comoArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}
