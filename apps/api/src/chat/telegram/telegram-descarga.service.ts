/**
 * Bajar un archivo de Telegram y guardarlo en nuestro storage (**2.4**).
 *
 * ## ⚠️ Por qué esto no se puede posponer
 *
 * Telegram **no manda el archivo**: manda un `file_id`. Para bajarlo hay que
 * pedirle una ruta temporal con `getFile`, y **esa ruta vence — alrededor de
 * una hora**. Pasado ese rato el archivo es irrecuperable: el `file_id` sigue
 * existiendo pero ya no resuelve a nada que se pueda descargar.
 *
 * O sea que "lo bajamos después, cuando haya cola" **no es una opción**: el
 * comprobante que un jugador mandó a las 3 AM tiene que estar guardado antes de
 * que amanezca. Por eso se baja en el mismo camino del webhook, con un timeout
 * corto, y si falla se anota en el mensaje en vez de reintentar más tarde.
 *
 * ## Dónde termina
 *
 * En `chat/attachments`, el mismo lugar que los adjuntos del widget — que desde
 * el 2026-09-09 se sirven **privados y firmados** (**D12**). Un comprobante que
 * llega por Telegram tiene exactamente los mismos datos que uno que llega por
 * la web: nombre, CBU, monto.
 *
 * Y pasa por la **misma validación de contenido** que la subida del widget:
 * redibuja las imágenes y rechaza PDFs con contenido activo. El archivo viene
 * del teléfono de un desconocido — que Telegram lo haya intermediado no lo
 * vuelve confiable.
 */

import { Injectable, Logger } from '@nestjs/common';
import { FileValidationService } from '../../storage/file-validation.service';
import { StorageService } from '../../storage/storage.service';
import { CHAT_ATTACHMENT_MAX_BYTES, type ChatAttachment } from '../chat.types';
import { TelegramApiService } from './telegram-api.service';
import { taparToken } from './telegram-token';

const BASE_ARCHIVOS = 'https://api.telegram.org/file';

/** Un archivo puede tardar más que una llamada a la API, pero no mucho más. */
const TIMEOUT_MS = 30_000;

@Injectable()
export class TelegramDescargaService {
  private readonly logger = new Logger(TelegramDescargaService.name);

  constructor(
    private readonly telegram: TelegramApiService,
    private readonly storage: StorageService,
    private readonly validacion: FileValidationService,
  ) {}

  /**
   * Baja un archivo y lo deja guardado. `null` si no se pudo.
   *
   * **Nunca tira.** El que llama ya respondió 200 a Telegram, y un adjunto que
   * no se pudo traer no puede hacer que se pierda el texto del mensaje.
   */
  async bajarYGuardar(params: {
    token: string;
    fileId: string;
    nombre: string;
    tenantSlug: string;
  }): Promise<ChatAttachment | null> {
    try {
      const ruta = await this.telegram.getFilePath(params.token, params.fileId);
      if (!ruta) return null;

      const bytes = await this.descargar(params.token, ruta);
      if (!bytes) return null;

      // La misma validación que la subida del widget: redibuja imágenes y
      // rechaza PDFs con contenido activo. Que Telegram lo haya intermediado no
      // vuelve confiable un archivo que salió del teléfono de un desconocido.
      const limpio = await this.validacion.validate(bytes, {
        allow: ['image', 'pdf'],
        maxBytes: CHAT_ATTACHMENT_MAX_BYTES,
      });

      const subido = await this.storage.upload({
        buffer: limpio.buffer,
        originalName: `adjunto${limpio.extension}`,
        mimeType: limpio.mimeType,
        // Privado y firmado desde D12: un comprobante que llega por Telegram
        // tiene los mismos datos que uno que llega por la web.
        keyPrefix: 'chat/attachments',
        tenantSlug: params.tenantSlug,
      });

      return {
        storageKey: subido.storageKey,
        mime: limpio.mimeType,
        sizeBytes: subido.sizeBytes,
        name: params.nombre,
        kind: limpio.mimeType === 'application/pdf' ? 'pdf' : 'image',
      };
    } catch (err) {
      this.logger.warn(
        `No se pudo traer el adjunto ${params.fileId} de ` +
          `${taparToken(params.token)}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /** El contenido del archivo. `null` si Telegram no lo dio. */
  private async descargar(token: string, ruta: string): Promise<Buffer | null> {
    // ⚠️ El token va en la URL de descarga igual que en la API, así que
    // ningún error puede incluir esta URL cruda.
    const res = await fetch(`${BASE_ARCHIVOS}/bot${token}/${ruta}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      this.logger.warn(
        `Telegram no entregó el archivo (${taparToken(token)}): HTTP ${res.status}`,
      );
      return null;
    }

    // Se corta por tamaño ANTES de tener todo en memoria: el `file_size` que
    // Telegram declaró puede no coincidir, y un archivo enorme no puede tumbar
    // el proceso.
    const declarado = Number(res.headers.get('content-length') ?? 0);
    if (declarado > CHAT_ATTACHMENT_MAX_BYTES) {
      this.logger.warn(`Adjunto de Telegram descartado por tamaño: ${declarado}`);
      return null;
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > CHAT_ATTACHMENT_MAX_BYTES) return null;
    return bytes;
  }
}
