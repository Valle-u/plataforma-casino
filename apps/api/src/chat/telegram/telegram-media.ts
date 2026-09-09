/**
 * Qué archivo trae un mensaje de Telegram, y cuál bajar (**2.4**).
 *
 * Sin red y sin base: es la decisión de **qué** bajar, separada de bajarlo.
 *
 * ## Por qué esto merece su propio archivo
 *
 * Telegram no manda "un adjunto": manda seis formas distintas de mandarlo, cada
 * una con su forma. Una foto viene como **un array de tamaños**, una nota de voz
 * como `voice`, un PDF como `document`, y un sticker como algo que no queremos.
 * Elegir bien es una decisión con reglas, y las reglas se prueban mejor solas.
 */

/** Lo que Telegram manda adentro de un mensaje, recortado a lo que miramos. */
export interface MensajeConMedios {
  photo?: Array<{ file_id?: string; file_size?: number; width?: number }>;
  document?: { file_id?: string; file_size?: number; mime_type?: string; file_name?: string };
  voice?: { file_id?: string; file_size?: number; mime_type?: string };
  audio?: { file_id?: string; file_size?: number; mime_type?: string };
  video?: { file_id?: string; file_size?: number; mime_type?: string };
  video_note?: { file_id?: string; file_size?: number };
  sticker?: { file_id?: string };
  animation?: { file_id?: string; file_size?: number; mime_type?: string };
}

/** Qué hacer con lo que vino. */
export type Decision =
  | { tipo: 'nada' }
  | { tipo: 'bajar'; fileId: string; mime: string | null; nombre: string; bytes: number | null }
  /** Vino algo, pero no lo aceptamos. `motivo` se muestra en la conversación. */
  | { tipo: 'rechazar'; motivo: string };

/**
 * Elige QUÉ bajar de un mensaje.
 *
 * ## Las reglas, y por qué
 *
 * **Fotos: la más grande que entre en el límite.** Telegram manda el array
 * ordenado de menor a mayor. Agarrar siempre la última traería archivos que no
 * pasan nuestro tope de 5 MB y se perderían; agarrar la primera daría una
 * miniatura ilegible — y estas fotos suelen ser **comprobantes de
 * transferencia**, donde lo que importa es poder leer el monto.
 *
 * **Notas de voz: se rechazan, pero se avisa.** La gente las manda todo el
 * tiempo. Tragárselas en silencio dejaría al operador viendo un mensaje vacío;
 * mejor decir que llegó un audio y que no se puede escuchar acá.
 *
 * **Stickers y videos: se rechazan igual.** No aportan a una conversación de
 * soporte y pesan.
 */
export function queBajar(msg: MensajeConMedios, maxBytes: number): Decision {
  // Fotos primero: es el caso que importa (comprobantes).
  if (msg.photo && msg.photo.length > 0) {
    const candidatas = msg.photo
      .filter((p) => p.file_id)
      // Sin `file_size` no se puede descartar por tamaño; se asume que entra y
      // lo corta la validación al bajarlo.
      .filter((p) => (p.file_size ?? 0) <= maxBytes);

    const elegida = candidatas[candidatas.length - 1];
    if (!elegida?.file_id) {
      return {
        tipo: 'rechazar',
        motivo: 'mandó una foto demasiado grande',
      };
    }
    return {
      tipo: 'bajar',
      fileId: elegida.file_id,
      mime: 'image/jpeg', // Telegram siempre convierte las fotos a JPEG.
      nombre: 'foto.jpg',
      bytes: elegida.file_size ?? null,
    };
  }

  if (msg.document?.file_id) {
    const doc = msg.document;
    if ((doc.file_size ?? 0) > maxBytes) {
      return { tipo: 'rechazar', motivo: 'mandó un archivo demasiado grande' };
    }
    return {
      tipo: 'bajar',
      fileId: doc.file_id,
      mime: doc.mime_type ?? null,
      nombre: nombreLimpio(doc.file_name) ?? 'archivo',
      bytes: doc.file_size ?? null,
    };
  }

  // Lo que no aceptamos, pero conviene nombrar para que el operador entienda
  // qué pasó en vez de ver un mensaje vacío.
  if (msg.voice) return { tipo: 'rechazar', motivo: 'mandó una nota de voz' };
  if (msg.audio) return { tipo: 'rechazar', motivo: 'mandó un audio' };
  if (msg.video || msg.video_note) {
    return { tipo: 'rechazar', motivo: 'mandó un video' };
  }
  if (msg.animation) return { tipo: 'rechazar', motivo: 'mandó un GIF' };
  if (msg.sticker) return { tipo: 'rechazar', motivo: 'mandó una figurita' };

  return { tipo: 'nada' };
}

/**
 * El texto que ve el operador cuando algo no se pudo traer.
 *
 * Se arma con el mismo criterio que el aviso de derivación: dice **qué pasó**,
 * no "error". Un operador que lee *"mandó una nota de voz"* sabe que tiene que
 * pedirle que lo escriba; uno que ve un mensaje vacío piensa que se rompió algo.
 */
export function textoDeRechazo(motivo: string, texto: string): string {
  const aviso = `⚠️ ${motivo[0]!.toUpperCase()}${motivo.slice(1)}, y por ahora no se puede ver acá.`;
  return texto ? `${texto}\n\n${aviso}` : aviso;
}

/**
 * El nombre del archivo, saneado.
 *
 * Viene del teléfono de otra persona: puede traer rutas, saltos de línea o
 * doscientos caracteres. Se queda con el nombre a secas y acotado.
 */
function nombreLimpio(nombre: string | undefined): string | null {
  if (!nombre) return null;
  const base = nombre.split(/[\\/]/).pop() ?? nombre;
  const limpio = base.replace(/\s+/g, ' ').trim().slice(0, 120);
  return limpio || null;
}
