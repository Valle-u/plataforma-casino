/**
 * Vincular, listar y desvincular un bot de Telegram (**2.1**).
 *
 * Es la primera vez que un canal externo entra al CRM, así que acá se cruzan
 * casi todas las decisiones:
 *
 * - **D1** — el canal pertenece a un **panel**, no al casino. El dueño sale de
 *   la bandeja del que lo vincula, igual que un contacto (**D6**).
 * - **D13** — lo vincula el **operador**, no el admin. Por eso el permiso es el
 *   acceso al CRM y no uno de administración.
 * - **D20** — el token del bot se guarda **cifrado**. Es la credencial que deja
 *   actuar como el bot y, por D13, **es del socio, no nuestra**.
 *
 * ## El orden de las operaciones, que importa
 *
 * 1. Validar el token contra Telegram (`getMe`). Sin esto se guardaría un token
 *    muerto y el operador se enteraría cuando nadie le escriba.
 * 2. Crear la fila **inactiva**, para tener un id con el que armar la URL.
 * 3. `setWebhook`.
 * 4. Recién ahí marcarla activa.
 *
 * Si el paso 3 falla, la fila se borra. La alternativa —registrar el webhook
 * antes de tener fila— dejaría a Telegram mandando updates a una URL que no
 * resuelve nada.
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { crmChannels, type CrmChannel } from '@casino/db';
import { cifrar, descifrar, hayClaveDeSecretos } from '../../common/secreto-cifrado';
import type { TenantDb } from '../../tenant-resolver/tenant-context';
import { CrmNetworkService } from '../crm-network.service';
import { TelegramApiService, type InfoDelWebhook } from './telegram-api.service';
import {
  idDelBot,
  linkDelBot,
  taparToken,
  TokenDeBotInvalidoError,
  urlDelWebhook,
} from './telegram-token';

const TIPO = 'telegram';

/** Lo que la pantalla necesita saber de un canal. Nunca el token. */
export interface CanalVisible {
  id: string;
  type: string;
  username: string | null;
  /** El link que el operador le pasa a sus jugadores. */
  link: string | null;
  isActive: boolean;
  /** `true` si lo vinculó esta bandeja; `false` si es de la central. */
  esMio: boolean;
  createdAt: Date | null;
}

/** Lo que guardamos en `config` de un canal de Telegram. */
interface ConfigTelegram {
  /** ⚠️ Cifrado (D20). Nunca en claro. */
  token?: string;
  botId?: string;
  username?: string;
}

@Injectable()
export class TelegramChannelsService {
  private readonly logger = new Logger(TelegramChannelsService.name);

  constructor(
    private readonly telegram: TelegramApiService,
    private readonly net: CrmNetworkService,
  ) {}

  /**
   * Vincula un bot a la bandeja de `inboxOwnerId`.
   *
   * `baseApiPublica` viene del request (respetando el proxy), no de una
   * variable: es la misma forma en que se arma la callback de los proveedores
   * de juego, y evita tener una URL más que mantener en el entorno.
   */
  async vincular(
    db: TenantDb,
    params: {
      token: string;
      inboxOwnerId: string;
      tenantSlug: string;
      baseApiPublica: string;
    },
  ): Promise<CanalVisible> {
    const token = params.token.trim();

    // Antes que nada: sin clave de cifrado no se guarda un token. Se chequea
    // ACÁ y no al insertar para no gastar una llamada a Telegram —y sobre todo
    // para que el error diga qué falta configurar, no "algo salió mal".
    if (!hayClaveDeSecretos()) {
      throw new BadRequestException({
        message:
          'Falta configurar CHANNEL_SECRET_KEY en el servidor: sin eso no se ' +
          'puede guardar el token de un canal. Avisale al administrador.',
        error: 'CHANNEL_SECRET_KEY_MISSING',
      });
    }

    // `idDelBot` vive en un módulo puro, sin Nest, así que tira un error propio
    // y no una excepción HTTP. Sin esta traducción salía **500**, y el mensaje
    // que explica qué está mal —el motivo de validar la forma acá en vez de
    // dejar que Telegram conteste 401— no le llegaba nunca al operador.
    let botId: string;
    try {
      botId = idDelBot(token);
    } catch (err) {
      if (err instanceof TokenDeBotInvalidoError) {
        throw new BadRequestException({
          message: err.message,
          error: 'INVALID_BOT_TOKEN',
        });
      }
      throw err;
    }

    const owner = await this.net.resolveContactOwner(db, params.inboxOwnerId);

    // Un mismo bot no puede estar en dos bandejas: los updates irían a la
    // última que registró el webhook y la otra quedaría muda, sin ningún error.
    const yaEsta = await this.buscarPorBotId(db, botId);
    if (yaEsta) {
      throw new ConflictException({
        message: 'Ese bot ya está vinculado en este casino.',
        error: 'BOT_ALREADY_LINKED',
      });
    }

    const bot = await this.telegram.getMe(token);

    const secreto = randomBytes(32).toString('hex');
    const insertado = (
      await db
        .insert(crmChannels)
        .values({
          type: TIPO,
          ownerUserId: owner,
          webhookSecret: secreto,
          config: {
            token: cifrar(token),
            botId,
            username: bot.username,
          } satisfies ConfigTelegram,
          // Inactivo hasta que el webhook quede registrado: un canal activo sin
          // webhook es un canal que nunca va a recibir nada.
          isActive: false,
        })
        .returning()
    )[0]!;

    try {
      await this.telegram.setWebhook(
        token,
        urlDelWebhook(params.baseApiPublica, params.tenantSlug, insertado.id),
        secreto,
      );
    } catch (err) {
      // Sin fila colgada: si Telegram no aceptó la URL, el canal no existe.
      await db.delete(crmChannels).where(eq(crmChannels.id, insertado.id));
      this.logger.warn(
        `No se pudo registrar el webhook de ${taparToken(token)}: ` +
          `${(err as Error).message}`,
      );
      throw err;
    }

    const activo = (
      await db
        .update(crmChannels)
        .set({ isActive: true })
        .where(eq(crmChannels.id, insertado.id))
        .returning()
    )[0]!;

    this.logger.log(
      `Canal de Telegram vinculado: @${bot.username} → bandeja ${owner ?? 'central'}`,
    );

    return this.visible(activo, owner);
  }

  /**
   * Los canales que ve esta bandeja.
   *
   * Sólo los suyos: por **D1** los canales son de un panel, y un operador no
   * tiene por qué saber qué números tiene otro.
   */
  async listar(db: TenantDb, inboxOwnerId: string): Promise<CanalVisible[]> {
    const owner = await this.net.resolveContactOwner(db, inboxOwnerId);
    const filas = await db
      .select()
      .from(crmChannels)
      .where(
        and(
          eq(crmChannels.type, TIPO),
          owner === null
            ? isNull(crmChannels.ownerUserId)
            : eq(crmChannels.ownerUserId, owner),
        ),
      );
    return filas.map((f) => this.visible(f, owner));
  }

  /**
   * Desvincula: corta el webhook en Telegram y desactiva la fila.
   *
   * **No se borra la fila.** Las conversaciones que entraron por ese canal
   * apuntan a él (`crm_conversations.channel_id`, con `restrict`), y los
   * eventos crudos también. Borrarlo sería borrar la historia de lo que se
   * habló — o directamente fallaría por la FK.
   */
  async desvincular(
    db: TenantDb,
    params: { channelId: string; inboxOwnerId: string },
  ): Promise<void> {
    const owner = await this.net.resolveContactOwner(db, params.inboxOwnerId);
    const canal = (
      await db
        .select()
        .from(crmChannels)
        .where(
          and(
            eq(crmChannels.id, params.channelId),
            eq(crmChannels.type, TIPO),
            owner === null
              ? isNull(crmChannels.ownerUserId)
              : eq(crmChannels.ownerUserId, owner),
          ),
        )
        .limit(1)
    )[0];

    // 404 y no 403 en los dos casos —no existe, o es de otra bandeja— a
    // propósito: un 403 confirmaría que ese canal existe en otro lado.
    if (!canal) throw new NotFoundException('Canal no encontrado.');

    const cfg = (canal.config ?? {}) as ConfigTelegram;
    if (cfg.token) {
      try {
        await this.telegram.deleteWebhook(descifrar(cfg.token));
      } catch (err) {
        // Que Telegram no conteste no puede dejar el canal prendido de este
        // lado: se desactiva igual y queda el aviso. El webhook viejo apunta a
        // un canal inactivo, que el endpoint rechaza.
        this.logger.warn(
          `No se pudo borrar el webhook al desvincular ${canal.id}: ` +
            `${(err as Error).message}`,
        );
      }
    }

    await db
      .update(crmChannels)
      .set({ isActive: false })
      .where(eq(crmChannels.id, canal.id));
  }

  /**
   * Qué webhook tiene Telegram registrado para este canal.
   *
   * ## Por qué hace falta preguntárselo a Telegram
   *
   * Porque de este lado **no hay forma de saberlo**. La URL se registra al
   * vincular y no se guarda: se arma en el momento con `baseApiPublica`, que
   * sale del request. Si esa URL salió mal, acá no queda rastro — y el síntoma,
   * una bandeja vacía, es idéntico a que todavía no haya escrito nadie.
   *
   * **Y hay un motivo concreto para dudar de esa URL.** `baseApiPublica` lee
   * `x-forwarded-host`, y todas las llamadas del panel pasan por el rewrite de
   * Next, que **pisa ese header** con el host del cliente. Que llegue bien
   * depende del proxy que esté adelante de la API, no de nuestro código. Esto es
   * lo que convierte esa duda en un dato.
   *
   * ## Sólo lectura, y con el mismo alcance que desvincular
   *
   * Por **D1** un canal es de un panel: un operador no tiene por qué ver el
   * estado del bot de otro. Mismo **404 y no 403** que en `desvincular`, por la
   * misma razón: un 403 confirmaría que ese canal existe en otra bandeja.
   */
  async estadoDelWebhook(
    db: TenantDb,
    params: { channelId: string; inboxOwnerId: string },
  ): Promise<InfoDelWebhook> {
    const owner = await this.net.resolveContactOwner(db, params.inboxOwnerId);
    const canal = (
      await db
        .select()
        .from(crmChannels)
        .where(
          and(
            eq(crmChannels.id, params.channelId),
            eq(crmChannels.type, TIPO),
            owner === null
              ? isNull(crmChannels.ownerUserId)
              : eq(crmChannels.ownerUserId, owner),
          ),
        )
        .limit(1)
    )[0];
    if (!canal) throw new NotFoundException('Canal no encontrado.');

    const cfg = (canal.config ?? {}) as ConfigTelegram;
    if (!cfg.token) {
      throw new BadRequestException({
        message: 'Este canal no tiene token guardado.',
        error: 'CHANNEL_WITHOUT_TOKEN',
      });
    }

    return this.telegram.getWebhookInfo(descifrar(cfg.token));
  }

  /** Busca un canal por el id del bot, mirando el `config`. */
  private async buscarPorBotId(
    db: TenantDb,
    botId: string,
  ): Promise<CrmChannel | undefined> {
    const filas = await db
      .select()
      .from(crmChannels)
      .where(eq(crmChannels.type, TIPO));
    return filas.find((f) => (f.config as ConfigTelegram)?.botId === botId);
  }

  /** La fila, recortada a lo que la pantalla puede ver. Nunca el token. */
  private visible(canal: CrmChannel, owner: string | null): CanalVisible {
    const cfg = (canal.config ?? {}) as ConfigTelegram;
    return {
      id: canal.id,
      type: canal.type,
      username: cfg.username ?? null,
      link: cfg.username ? linkDelBot(cfg.username) : null,
      isActive: canal.isActive,
      esMio: canal.ownerUserId === owner,
      createdAt: canal.createdAt ?? null,
    };
  }
}
