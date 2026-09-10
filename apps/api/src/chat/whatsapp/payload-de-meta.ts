/**
 * Partir una entrega de Meta en un trozo **por número** (**3.2**).
 *
 * ## Por qué hay que partirla, y por qué es una cuestión de aislamiento
 *
 * Telegram manda **un update por request**, y ese update es de un bot. Meta no:
 * manda un sobre con `entry[]`, y cada entrada con `changes[]`. Una sola entrega
 * puede traer mensajes de **varios números a la vez** — y por **D23** cada
 * número puede ser de **un casino distinto**.
 *
 * ```
 * POST /webhook
 *   entry[0] → WABA del socio Litoral   → phone_number_id A → casino 1
 *   entry[1] → WABA del casino central  → phone_number_id B → casino 2
 * ```
 *
 * `crm_raw_events` vive en la base **del tenant**. Guardar el sobre entero en
 * una sola base metería el payload de un casino adentro de la base de otro
 * —nombres, teléfonos y el texto de lo que escribieron—, y eso es **P4** roto.
 * No un ruteo mal hecho: una filtración, guardada, en reposo, en la base
 * equivocada.
 *
 * Por eso cada trozo se guarda **recortado a su número**: el sobre que se
 * persiste tiene una sola `entry` con un solo `change`.
 *
 * ## Lo que este módulo NO hace
 *
 * No interpreta los mensajes. Sólo dice **de quién es cada pedazo** y lo recorta.
 * Convertir un `change` en contacto + conversación + mensaje es la tanda que
 * sigue, igual que en Telegram el webhook (2.2) vino antes que el ruteo (2.3).
 */

/** Un pedazo de la entrega, ya atribuible a un número concreto. */
export interface TrozoDeMeta {
  /** La llave del mapeo de D23: dice de qué casino y de qué bandeja es. */
  phoneNumberId: string;
  /** La cuenta de negocio del socio (**D13**). `null` si Meta no la mandó. */
  wabaId: string | null;
  /**
   * El sobre **recortado a este número**: una `entry`, un `change`. Es lo que se
   * guarda como crudo, y por eso no puede ser el sobre entero.
   */
  payload: unknown;
  /**
   * El `wamid` del primer mensaje, para cortar duplicados antes de procesar.
   *
   * `null` cuando el cambio no trae mensajes — un acuse de entrega, por ejemplo.
   * A diferencia del `message_id` de Telegram, el `wamid` es **único global** y
   * no por chat, así que no necesita que se le agregue nada (ver el bug 2.6).
   */
  primerMensajeId: string | null;
}

export function trozosPorNumero(body: unknown): TrozoDeMeta[] {
  const sobre = comoObjeto(body);
  if (!sobre) return [];

  const entradas = comoArray(sobre.entry);
  const trozos: TrozoDeMeta[] = [];

  for (const entradaCruda of entradas) {
    const entrada = comoObjeto(entradaCruda);
    if (!entrada) continue;
    const wabaId = typeof entrada.id === 'string' ? entrada.id : null;

    for (const cambioCrudo of comoArray(entrada.changes)) {
      const cambio = comoObjeto(cambioCrudo);
      if (!cambio) continue;

      const valor = comoObjeto(cambio.value);
      const metadata = valor ? comoObjeto(valor.metadata) : null;
      const phoneNumberId =
        metadata && typeof metadata.phone_number_id === 'string'
          ? metadata.phone_number_id
          : null;

      // Sin `phone_number_id` no se sabe de quién es, y sin eso no hay base
      // donde guardarlo. Se descarta acá en vez de adivinar: adivinar sería
      // elegir un casino al azar para meterle datos de otro.
      if (!phoneNumberId) continue;

      trozos.push({
        phoneNumberId,
        wabaId,
        payload: {
          ...sobre,
          entry: [{ ...entrada, changes: [cambio] }],
        },
        primerMensajeId: primerId(valor),
      });
    }
  }

  return trozos;
}

/** El `wamid` del primer mensaje del cambio, si trae alguno. */
function primerId(valor: Record<string, unknown> | null): string | null {
  if (!valor) return null;
  for (const mensajeCrudo of comoArray(valor.messages)) {
    const mensaje = comoObjeto(mensajeCrudo);
    if (mensaje && typeof mensaje.id === 'string' && mensaje.id) {
      return mensaje.id;
    }
  }
  return null;
}

/**
 * Un objeto plano, o `null`.
 *
 * Todo lo que entra por un webhook es **texto de afuera**: puede venir con
 * cualquier forma, incluido un array donde se espera un objeto o un `null`
 * donde se espera algo. Se comprueba en vez de castear, que es lo que hace que
 * un payload raro devuelva una lista vacía en vez de tirar adentro del webhook.
 */
function comoObjeto(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function comoArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
