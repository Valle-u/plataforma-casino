/**
 * ChatCrmService — datos "CRM" del contacto para la bandeja del operador:
 * contexto del jugador (identidad + saldo + upline + últimos depósitos/retiros),
 * notas internas y tags. Todo READ-ONLY sobre los flujos existentes (solo lee
 * wallet/deposits/withdrawals) + CRUD sobre las tablas `crm_*`. Ver docs/22 §4.2.
 *
 * Autorización: el operador solo accede a un contacto si es su operador directo
 * (jerarquía) o si tiene una conversación asignada con ese contacto.
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  crmContactTags,
  crmContacts,
  crmConversations,
  crmNotes,
  crmTags,
  crmTemplates,
  deposits,
  roles,
  userRoles,
  users,
  wallets,
  withdrawals,
  type CrmContact,
  type CrmNote,
  type CrmTag,
  type CrmTemplate,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import { ChatService } from './chat.service';
import { CrmNetworkService } from './crm-network.service';
import { textoDelAviso } from './aviso-derivacion';
import { generarPassword } from './password-temporal';
import { TenantUsersService } from '../tenant-users/tenant-users.service';

export interface ContactContext {
  contact: {
    id: string;
    userId: string | null;
    displayName: string | null;
    phone: string | null;
    email: string | null;
    isLead: boolean;
  };
  identity: {
    username: string;
    displayName: string | null;
    email: string | null;
    phone: string | null;
    status: string;
    createdAt: Date | null;
  } | null;
  wallet: {
    balance: string;
    bonusBalance: string;
    lockedBalance: string;
    currency: string;
  } | null;
  upline: { operatorId: string; username: string } | null;
  /**
   * De qué red es el jugador, respecto de quien pregunta.
   *
   * `same: false` significa que **no se devolvió la plata**: ni `wallet`, ni
   * los movimientos, ni el `upline`. La pantalla usa `label` para el cartel
   * que pide `D3` ("este jugador es de la red de Litoral").
   *
   * `null` en un lead que todavía no está vinculado a ningún jugador.
   */
  network: { same: boolean; label: string | null } | null;
  recentDeposits: MovementRow[];
  recentWithdrawals: MovementRow[];
}

/** Una fila de la seccion Contactos. */
export interface ContactoDeBandeja {
  id: string;
  displayName: string | null;
  userId: string | null;
  isLead: boolean;
  phone: string | null;
  username: string | null;
  userDisplayName: string | null;
  lastMessageAt: string | null;
  /** Sin leer sumando TODAS sus conversaciones en esta bandeja. */
  sinLeer: number;
  /** La conversacion mas reciente: es la que abre el boton "Abrir". */
  conversationId: string;
  channelType: string;
  tags: Array<{ id: string; label: string; color: string | null }>;
}

interface MovementRow {
  id: string;
  amountChips: string;
  amountFiat: string;
  status: string;
  createdAt: Date | null;
}

@Injectable()
export class ChatCrmService {
  constructor(
    private readonly hierarchy: UserHierarchyService,
    private readonly chat: ChatService,
    private readonly net: CrmNetworkService,
    private readonly tenantUsers: TenantUsersService,
  ) {}

  /**
   * Avisarle al operador de un jugador que escribió a otra bandeja (**D8**).
   *
   * ## Derivar es avisar, no mandar la conversación
   *
   * A la otra bandeja llega **quién escribió y cuándo**. Ni una palabra del
   * contenido. Y no es una restricción arbitraria: por **D6** el contacto de
   * esta bandeja y el de la otra son **dos fichas distintas**, así que nunca
   * hubo una conversación que mover. Lo que se llamaba "derivar" era, en los
   * hechos, *copiar*.
   *
   * Hay además una razón de producto: si el cajero leyera la queja que el
   * jugador hizo **sobre él**, el jugador dejaría de escribirle al casino. Y
   * ahí se pierde la única señal que el casino tiene sobre cómo se atiende en
   * las redes independientes.
   *
   * El texto lo arma `textoDelAviso`, que **no recibe el mensaje** — su firma es
   * lo que garantiza que no se pueda filtrar.
   *
   * ## A quién le llega
   *
   * Al **operador directo** del jugador, que es a quien el ruteo ya le asigna
   * todo lo suyo. No al socio de esa red: por **D10** un socio no ve las
   * conversaciones de sus cajeros, y un aviso no es la excepción.
   */
  async notifyDirectOperator(
    db: TenantDb,
    params: {
      contact: CrmContact;
      /** La bandeja desde la que se avisa (`crmInboxOwnerId`). */
      inboxOwnerId: string;
    },
  ): Promise<{ operatorId: string; conversationId: string }> {
    const { contact, inboxOwnerId } = params;

    if (!contact.userId) {
      throw new BadRequestException({
        message: 'Este contacto todavía no está vinculado a ningún jugador.',
        error: 'CONTACT_NOT_LINKED',
      });
    }

    const parent = await this.hierarchy.getActiveParent(db, contact.userId);
    if (!parent?.parentUserId) {
      throw new BadRequestException({
        message: 'Este jugador no cuelga de ningún operador.',
        error: 'PLAYER_HAS_NO_OPERATOR',
      });
    }

    // La BANDEJA del operador directo, que no siempre es él mismo: los
    // operadores de la red dependiente no tienen acceso al CRM, así que a sus
    // jugadores los atiende el staff central. Sin esta traducción el aviso
    // caería en una bandeja que nadie puede abrir.
    const bandejaDestino = await this.net.resolveInboxOwner(
      db,
      parent.parentUserId,
    );
    if (!bandejaDestino) {
      throw new BadRequestException({
        message: 'El operador de este jugador no tiene bandeja de soporte.',
        error: 'OPERATOR_HAS_NO_INBOX',
      });
    }

    if (bandejaDestino === inboxOwnerId) {
      throw new BadRequestException({
        message: 'Este jugador ya lo atendés vos: no hay a quién avisarle.',
        error: 'SAME_INBOX',
      });
    }

    const [ownerDestino, origen] = await Promise.all([
      this.net.resolveContactOwner(db, bandejaDestino),
      this.etiquetaDeBandeja(db, inboxOwnerId),
    ]);

    const canalId = await this.chat.getOrCreateWebChannel(db);
    const contactoDestino = await this.chat.getOrCreateContactForUser(
      db,
      contact.userId,
      ownerDestino,
    );
    const conv = await this.chat.getOrCreateOpenConversation(db, {
      contactId: contactoDestino,
      channelId: canalId,
      operatorId: bandejaDestino,
    });

    await this.chat.postMessage(db, {
      conversationId: conv.id,
      direction: 'system',
      senderUserId: null,
      body: textoDelAviso({
        nombre: await this.nombreDelContacto(db, contact),
        cuando: new Date(),
        origen,
      }),
    });
    // `postMessage` no toca contadores para los `system`, y sin badge el aviso
    // no lo ve nadie — que es justo lo que viene a evitar.
    await this.chat.bumpUnreadForOperator(db, conv.id);

    return { operatorId: bandejaDestino, conversationId: conv.id };
  }

  /**
   * Da de alta un jugador desde una conversación (**D9**).
   *
   * ## El jugador cuelga del dueño de la bandeja, y no se elige
   *
   * No hay parámetro para el operador padre: sale de `contact.owner_user_id`,
   * o sea de la bandeja por la que esa persona escribió. **Sin desplegable no
   * hay forma de colgarse un jugador que no corresponde** — ni por error ni a
   * propósito. En un sistema donde de quién cuelga un jugador determina las
   * comisiones, un campo editable es una tentación permanente.
   *
   * ## Por qué NO se reusa la inferencia de `POST /tenant/users`
   *
   * Ese endpoint deduce el padre **del rol del que crea**, y tiene un caso mal
   * resuelto: un `empleado` de un socio **independiente** matchea el mismo
   * chequeo que el staff central, así que el jugador que crea termina colgado
   * del **admin principal** — o sea, **fuera de la red independiente**. Eso
   * cambia de red al jugador y de quién cobra por él.
   *
   * Acá el padre es explícito, así que ese camino no existe. El bug del otro
   * endpoint queda reportado aparte: no se toca desde el CRM.
   *
   * ## La contraseña
   *
   * Si no se manda una, se genera y **se devuelve una sola vez** en la
   * respuesta, para que el operador la copie. **No se manda por el chat**: en
   * WhatsApp quedaría escrita en el teléfono del jugador y en el del operador,
   * para siempre.
   *
   * ⚠️ La plataforma **no sabe forzar el cambio al primer ingreso** — no existe
   * ninguna columna para eso. Mientras no exista, una contraseña temporal es
   * temporal sólo por convención.
   */
  /**
   * Los contactos de una bandeja, paginados (sección **Contactos**).
   *
   * ## Qué cuenta como "de esta bandeja"
   *
   * Los que tienen **al menos una conversación asignada acá**. Es exactamente
   * el mismo universo que deja pasar `assertAccess`, y eso no es casualidad:
   * si esta lista mostrara un contacto más, sería una pantalla que enumera
   * gente que después no se puede abrir — o peor, una filtración.
   *
   * Por **D6** un mismo jugador tiene **una ficha por bandeja**, así que acá no
   * hace falta ningún filtro extra por red: las fichas de otras bandejas
   * simplemente no tienen conversaciones asignadas a ésta.
   *
   * ## Una fila por contacto, no por conversación
   *
   * Un contacto puede tener varias conversaciones —una por canal—. Se agrupa y
   * se toma la **más reciente** para saber cuál abrir y de qué canal mostrarlo.
   * Sin agrupar, la misma persona aparecería dos veces y el paginado contaría
   * mal.
   */
  async listInboxContacts(
    db: TenantDb,
    operatorId: string,
    opciones: { search?: string; limit?: number; offset?: number } = {},
  ): Promise<{ items: ContactoDeBandeja[]; total: number }> {
    const limit = Math.min(opciones.limit ?? 50, 100);
    const offset = Math.max(opciones.offset ?? 0, 0);
    const q = opciones.search?.trim().toLowerCase();
    // El patrón se arma acá y se pasa como parámetro: interpolarlo adentro del
    // `LIKE` sería concatenar entrada del usuario en la consulta.
    const patron = q ? `%${q}%` : null;

    const filtro = sql`
      conv.assigned_operator_id = ${operatorId}
      AND (
        ${patron}::text IS NULL
        OR lower(coalesce(u.display_name, '')) LIKE ${patron}
        OR lower(coalesce(u.username, '')) LIKE ${patron}
        OR lower(coalesce(c.display_name, '')) LIKE ${patron}
        OR lower(coalesce(c.phone, '')) LIKE ${patron}
      )
    `;

    const filas = (await db.execute(sql`
      SELECT c.id,
             c.display_name           AS "displayName",
             c.user_id                AS "userId",
             c.is_lead                AS "isLead",
             c.phone,
             u.username,
             u.display_name           AS "userDisplayName",
             max(conv.last_message_at) AS "lastMessageAt",
             sum(conv.unread_for_operator)::int AS "sinLeer",
             (array_agg(conv.id ORDER BY conv.last_message_at DESC NULLS LAST))[1] AS "conversationId",
             (array_agg(ch.type ORDER BY conv.last_message_at DESC NULLS LAST))[1] AS "channelType"
        FROM crm_contacts c
        JOIN crm_conversations conv ON conv.contact_id = c.id
        JOIN crm_channels ch ON ch.id = conv.channel_id
        LEFT JOIN users u ON u.id = c.user_id
       WHERE ${filtro}
       GROUP BY c.id, u.username, u.display_name
       ORDER BY max(conv.last_message_at) DESC NULLS LAST
       LIMIT ${limit} OFFSET ${offset}
    `)) as unknown as ContactoDeBandeja[];

    // El total va aparte y cuenta CONTACTOS, no filas de la unión: con el
    // `DISTINCT` afuera, un contacto con tres canales contaría tres veces y el
    // paginado mostraría páginas vacías al final.
    const totalRows = (await db.execute(sql`
      SELECT count(DISTINCT c.id)::int AS total
        FROM crm_contacts c
        JOIN crm_conversations conv ON conv.contact_id = c.id
        LEFT JOIN users u ON u.id = c.user_id
       WHERE ${filtro}
    `)) as unknown as Array<{ total: number }>;

    const items = await this.etiquetasDeContactos(db, filas);
    return { items, total: totalRows[0]?.total ?? 0 };
  }

  /** Le pega las etiquetas a una lista de contactos, en una sola consulta. */
  private async etiquetasDeContactos(
    db: TenantDb,
    filas: ContactoDeBandeja[],
  ): Promise<ContactoDeBandeja[]> {
    if (filas.length === 0) return [];
    const ids = filas.map((f) => f.id);
    const asignadas = await db
      .select({
        contactId: crmContactTags.contactId,
        id: crmTags.id,
        label: crmTags.label,
        color: crmTags.color,
      })
      .from(crmContactTags)
      .innerJoin(crmTags, eq(crmTags.id, crmContactTags.tagId))
      .where(inArray(crmContactTags.contactId, ids));

    const porContacto = new Map<string, ContactoDeBandeja['tags']>();
    for (const t of asignadas) {
      const lista = porContacto.get(t.contactId) ?? [];
      lista.push({ id: t.id, label: t.label, color: t.color });
      porContacto.set(t.contactId, lista);
    }
    return filas.map((f) => ({ ...f, tags: porContacto.get(f.id) ?? [] }));
  }

  /**
   * ¿Ya hay un jugador con este teléfono? (**el freno del alta**)
   *
   * ## Por qué esto existe
   *
   * **`users.phone` NO es único.** O sea que dar de alta desde el chat a
   * alguien que ya tiene cuenta crea una **segunda cuenta con el mismo
   * teléfono**, y las cuentas **no se fusionan** (ver `04-identidad-y-fusion`).
   * El resultado es una persona con el saldo partido en dos y nadie que las
   * junte.
   *
   * El operador no tiene cómo saberlo: está mirando una conversación, no el
   * padrón. Por eso lo mira el servidor antes de dejar crear.
   *
   * ## Acotado por red (R6)
   *
   * Sólo se devuelven los jugadores que el que pregunta **ya podría ver**, con
   * el mismo criterio que `getContext`: misma rama independiente, o los dos sin
   * rama. Sin esto, "buscá por teléfono" sería la forma más fácil de averiguar
   * quién juega en la red de otro socio.
   *
   * Lo que se devuelve es lo mínimo para reconocerlo: usuario, nombre y estado.
   * **Ni saldo ni movimientos** — para decidir si es la misma persona no hace
   * falta su plata.
   */
  async jugadoresConEseTelefono(
    db: TenantDb,
    params: { telefono: string | null; solicitanteId: string },
  ): Promise<
    Array<{ id: string; username: string; displayName: string | null; status: string }>
  > {
    const telefono = params.telefono?.trim();
    if (!telefono) return [];

    const candidatos = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        status: users.status,
      })
      .from(users)
      .where(eq(users.phone, telefono))
      .limit(20);

    if (candidatos.length === 0) return [];

    // El filtro de red va DESPUÉS de la consulta y no adentro: la pertenencia a
    // una rama independiente se resuelve subiendo la jerarquía, no con un join.
    const visibles = await Promise.all(
      candidatos.map(async (c) => {
        const red = await this.redDelJugador(db, c.id, params.solicitanteId);
        return red.same ? c : null;
      }),
    );
    return visibles.filter((c): c is NonNullable<typeof c> => c !== null);
  }

  async createPlayerFromChat(
    db: TenantDb,
    params: {
      contact: CrmContact;
      actorId: string;
      username: string;
      displayName?: string;
      password?: string;
    },
  ): Promise<{ userId: string; username: string; generatedPassword?: string }> {
    const { contact, actorId } = params;

    if (contact.userId) {
      throw new BadRequestException({
        message: 'Este contacto ya está vinculado a un jugador.',
        error: 'CONTACT_ALREADY_LINKED',
      });
    }

    // El dueño de la ficha ES la bandeja por la que escribió (D6), así que ya
    // es la respuesta a "de quién cuelga". `null` = central → el admin
    // principal, que es la raíz de esa red.
    const padre =
      contact.ownerUserId ?? (await this.hierarchy.getPrimaryAdminUserId(db));
    if (!padre) {
      throw new BadRequestException({
        message: 'No se pudo resolver de qué operador cuelga el jugador.',
        error: 'OWNER_NOT_RESOLVED',
      });
    }

    const relationType = await this.relacionDeJugadorCon(db, padre);
    const generada = params.password ? undefined : generarPassword();

    const creado = await db.transaction(async (tx) => {
      const txDb = tx as unknown as TenantDb;
      const nuevo = await this.tenantUsers.create(txDb, {
        username: params.username,
        password: params.password ?? generada!,
        displayName: params.displayName ?? params.username,
        // El teléfono viene del contacto y no se edita: es la llave con la que
        // D4 va a reconocerlo la próxima vez que escriba.
        phone: contact.phone ?? undefined,
        roleCode: 'usuario_final',
        createdBy: actorId,
      });

      await this.hierarchy.setParent(txDb, {
        userId: nuevo.id,
        parentUserId: padre,
        relationType,
        actorUserId: actorId,
      });

      // El contacto deja de ser lead. La bandeja NO cambia: ya era del dueño
      // del canal por D5, y darlo de alta no lo mueve a ningún lado.
      await txDb
        .update(crmContacts)
        .set({ userId: nuevo.id, isLead: false, updatedAt: new Date() })
        .where(eq(crmContacts.id, contact.id));

      return nuevo;
    });

    return {
      userId: creado.id,
      username: creado.username,
      ...(generada ? { generatedPassword: generada } : {}),
    };
  }

  /**
   * `jugador_de_<rol>` según el rol del **operador padre**, no del que crea.
   *
   * Es la diferencia que importa: en `POST /tenant/users` la etiqueta sale del
   * rol del actor, y acá el actor puede ser un empleado que atiende la bandeja
   * de otro.
   */
  private async relacionDeJugadorCon(
    db: TenantDb,
    padreId: string,
  ): Promise<string> {
    const codigos = (
      await db
        .select({ code: roles.code })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(eq(userRoles.userId, padreId))
    ).map((r) => r.code);

    if (codigos.includes('admin_tenant')) return 'jugador_de_admin';
    if (codigos.includes('socio')) return 'jugador_de_socio';
    if (codigos.includes('distribuidor')) return 'jugador_de_distribuidor';
    if (codigos.includes('cajero')) return 'jugador_de_cajero';
    // `relation_type` es una etiqueta libre y no puede ser NULL. Si el padre
    // tuviera un rol inesperado, es mejor una etiqueta genérica que romper el
    // alta: el vínculo —que es lo que define comisiones— queda igual.
    return 'jugador_de_operador';
  }

  /** Cómo nombrar la bandeja de origen en el aviso. Nunca su contenido. */
  private async etiquetaDeBandeja(
    db: TenantDb,
    inboxOwnerId: string,
  ): Promise<string> {
    const owner = await this.net.resolveContactOwner(db, inboxOwnerId);
    if (owner === null) return 'el casino';
    const fila = (
      await db
        .select({ username: users.username, displayName: users.displayName })
        .from(users)
        .where(eq(users.id, owner))
        .limit(1)
    )[0];
    return fila?.displayName ?? fila?.username ?? 'otra bandeja';
  }

  /** El nombre para mostrar del contacto, cayendo al del jugador. */
  private async nombreDelContacto(
    db: TenantDb,
    contact: CrmContact,
  ): Promise<string> {
    if (contact.displayName) return contact.displayName;
    if (!contact.userId) return 'Un contacto';
    const fila = (
      await db
        .select({ username: users.username, displayName: users.displayName })
        .from(users)
        .where(eq(users.id, contact.userId))
        .limit(1)
    )[0];
    return fila?.displayName ?? fila?.username ?? 'Un contacto';
  }

  /**
   * Verifica que el operador pueda ver el contacto (operador directo del jugador
   * o dueño de una conversación asignada). Devuelve el contacto o tira 403/404.
   */
  async assertAccess(
    db: TenantDb,
    contactId: string,
    operatorId: string,
  ): Promise<CrmContact> {
    const contact = (
      await db
        .select()
        .from(crmContacts)
        .where(eq(crmContacts.id, contactId))
        .limit(1)
    )[0];
    if (!contact) throw new NotFoundException('Contacto no encontrado.');

    if (contact.userId) {
      const parent = await this.hierarchy.getActiveParent(db, contact.userId);
      if (parent?.parentUserId === operatorId) return contact;
    }
    const conv = (
      await db
        .select({ id: crmConversations.id })
        .from(crmConversations)
        .where(
          and(
            eq(crmConversations.contactId, contactId),
            eq(crmConversations.assignedOperatorId, operatorId),
          ),
        )
        .limit(1)
    )[0];
    if (conv) return contact;
    throw new ForbiddenException('No tenés acceso a este contacto.');
  }

  /**
   * Contexto del jugador para la ficha del contacto.
   *
   * ## ⚠️ Lo que este método NO puede devolver
   *
   * **La plata de un jugador de otra red.** La **LEY R6** dice que de una red
   * independiente se ven agregados, no el detalle interno — y el saldo, los
   * depósitos y los retiros de una persona son el detalle más interno que hay.
   * **P1** lo completa: permiso *y* scope, nunca cruzando redes.
   *
   * Hasta el 2026-09-08 esto devolvía todo eso **sin mirar de qué red era el
   * jugador**. En la práctica no filtraba nada porque el ruteo lo hacía
   * inalcanzable: el único canal era el widget web y las conversaciones de un
   * jugador independiente van siempre a su operador directo, nunca a la bandeja
   * central.
   *
   * **Pero `D3` abre esa puerta a propósito** — el staff central atiende a
   * quien le escriba al número del casino, sea de la red que sea. Por eso esto
   * es **requisito del primer canal externo**, no una mejora para después.
   *
   * ## Lo que SÍ se devuelve de otra red
   *
   * Quién es y de qué red viene (`D3`), para poder responderle y avisarle a su
   * operador (`D8`). El `upline` tampoco viaja: el cartel ya dice la red, y
   * *qué operador concreto* lo tiene es detalle interno.
   */
  async getContext(
    db: TenantDb,
    contact: CrmContact,
    solicitanteId: string,
  ): Promise<ContactContext> {
    const base: ContactContext = {
      contact: {
        id: contact.id,
        userId: contact.userId,
        displayName: contact.displayName,
        phone: contact.phone,
        email: contact.email,
        isLead: contact.isLead,
      },
      identity: null,
      wallet: null,
      upline: null,
      recentDeposits: [],
      recentWithdrawals: [],
      network: null,
    };
    if (!contact.userId) return base; // lead anónimo: solo lo del contacto

    const userId = contact.userId;
    const [identity, parent, red] = await Promise.all([
      db
        .select({
          username: users.username,
          displayName: users.displayName,
          email: users.email,
          phone: users.phone,
          status: users.status,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),
      this.hierarchy.getActiveParent(db, userId),
      this.redDelJugador(db, userId, solicitanteId),
    ]);

    base.identity = identity[0] ?? null;
    base.network = red;

    // Otra red: hasta acá llega. Las consultas de plata NI SE CORREN — no
    // alcanza con no devolver el dato si igual se trajo: lo que no se lee no se
    // puede filtrar por descuido en un log o en un campo nuevo.
    if (!red.same) return base;

    const [wallet, dep, wd] = await Promise.all([
      db
        .select({
          balance: wallets.balance,
          bonusBalance: wallets.bonusBalance,
          lockedBalance: wallets.lockedBalance,
          currency: wallets.currency,
        })
        .from(wallets)
        .where(eq(wallets.userId, userId))
        .limit(1),
      db
        .select({
          id: deposits.id,
          amountChips: deposits.amountChips,
          amountFiat: deposits.amountFiat,
          status: deposits.status,
          createdAt: deposits.createdAt,
        })
        .from(deposits)
        .where(eq(deposits.userId, userId))
        .orderBy(desc(deposits.createdAt))
        .limit(5),
      db
        .select({
          id: withdrawals.id,
          amountChips: withdrawals.amountChips,
          amountFiat: withdrawals.amountFiat,
          status: withdrawals.status,
          createdAt: withdrawals.createdAt,
        })
        .from(withdrawals)
        .where(eq(withdrawals.userId, userId))
        .orderBy(desc(withdrawals.createdAt))
        .limit(5),
    ]);

    base.wallet = wallet[0] ?? null;
    base.recentDeposits = dep;
    base.recentWithdrawals = wd;

    if (parent?.parentUserId) {
      const op = (
        await db
          .select({ username: users.username })
          .from(users)
          .where(eq(users.id, parent.parentUserId))
          .limit(1)
      )[0];
      base.upline = op
        ? { operatorId: parent.parentUserId, username: op.username }
        : null;
    }
    return base;
  }

  /**
   * ¿Están el jugador y quien pregunta en la misma red?
   *
   * Se compara la **rama independiente** de cada uno —`null` para la red
   * central y la dependiente— con la misma función que usa el ruteo
   * (`CrmNetworkService.classify`), para que visibilidad y ruteo no puedan
   * discrepar.
   *
   * Los tres casos:
   *
   * | jugador | quien pregunta | ¿ve la plata? |
   * |---|---|---|
   * | misma rama (o los dos centrales) | — | sí |
   * | rama independiente A | rama B, o staff central | **no** — R6 |
   * | red central | rama independiente | **no** — P1, cruza igual |
   *
   * El tercero no está en `D3` pero se protege igual: si un jugador de la red
   * central le escribe al WhatsApp de un socio independiente, ese socio lo va a
   * atender (`D2`) y **no tiene por qué ver su saldo**.
   *
   * ⚠️ Con redes independientes **anidadas**, esta función hereda el criterio de
   * `getIndependentBranchAncestor`, que no ordena por cercanía. Es a propósito:
   * el mismo criterio que ya usa el ruteo. Si algún día se cambia uno, cambiar
   * los dos.
   */
  private async redDelJugador(
    db: TenantDb,
    jugadorId: string,
    solicitanteId: string,
  ): Promise<{ same: boolean; label: string | null }> {
    const [ramaJugador, ramaSolicitante] = await Promise.all([
      this.hierarchy.getIndependentBranchAncestor(db, jugadorId),
      this.hierarchy.getIndependentBranchAncestor(db, solicitanteId),
    ]);

    // Cubre los dos casos de "misma red": la misma rama independiente, o los
    // dos sin rama (central/dependiente, que para la plata es una sola).
    if (ramaJugador === ramaSolicitante) return { same: true, label: null };

    // El jugador es de la red central y pregunta alguien de una independiente.
    // No se nombra la red del casino: no hay nada que aclararle.
    if (!ramaJugador) return { same: false, label: null };

    const socio = (
      await db
        .select({ username: users.username, displayName: users.displayName })
        .from(users)
        .where(eq(users.id, ramaJugador))
        .limit(1)
    )[0];
    return {
      same: false,
      label: socio?.displayName ?? socio?.username ?? null,
    };
  }

  // ── Notas ───────────────────────────────────────────────────────────────
  async listNotes(db: TenantDb, contactId: string): Promise<CrmNote[]> {
    return db
      .select()
      .from(crmNotes)
      .where(eq(crmNotes.contactId, contactId))
      .orderBy(desc(crmNotes.createdAt))
      .limit(100);
  }

  async addNote(
    db: TenantDb,
    contactId: string,
    authorUserId: string,
    body: string,
  ): Promise<CrmNote> {
    const inserted = await db
      .insert(crmNotes)
      .values({ contactId, authorUserId, body })
      .returning();
    return inserted[0]!;
  }

  // ── Tags ────────────────────────────────────────────────────────────────
  /** Catálogo de tags del tenant (predefinidos). */
  async listTagCatalog(db: TenantDb): Promise<CrmTag[]> {
    return db.select().from(crmTags).orderBy(crmTags.label).limit(200);
  }

  async createTag(
    db: TenantDb,
    label: string,
    color: string | null,
  ): Promise<CrmTag> {
    const inserted = await db
      .insert(crmTags)
      .values({ label, color })
      .returning();
    return inserted[0]!;
  }

  /** Tags asignados a un contacto. */
  async listContactTags(db: TenantDb, contactId: string): Promise<CrmTag[]> {
    return db
      .select({
        id: crmTags.id,
        label: crmTags.label,
        color: crmTags.color,
        createdAt: crmTags.createdAt,
      })
      .from(crmContactTags)
      .innerJoin(crmTags, eq(crmTags.id, crmContactTags.tagId))
      .where(eq(crmContactTags.contactId, contactId))
      .orderBy(crmTags.label);
  }

  /** Asigna un tag al contacto (idempotente por el unique contact+tag). */
  async assignTag(
    db: TenantDb,
    contactId: string,
    tagId: string,
    assignedBy: string,
  ): Promise<void> {
    await db
      .insert(crmContactTags)
      .values({ contactId, tagId, assignedBy })
      .onConflictDoNothing();
  }

  async unassignTag(
    db: TenantDb,
    contactId: string,
    tagId: string,
  ): Promise<void> {
    await db
      .delete(crmContactTags)
      .where(
        and(
          eq(crmContactTags.contactId, contactId),
          eq(crmContactTags.tagId, tagId),
        ),
      );
  }

  // ── Plantillas (respuestas rápidas por tenant) ────────────────────────────
  /** Catálogo de plantillas del tenant (predefinidas por el operador/admin). */
  async listTemplates(db: TenantDb): Promise<CrmTemplate[]> {
    return db
      .select()
      .from(crmTemplates)
      .orderBy(crmTemplates.title)
      .limit(200);
  }

  async createTemplate(
    db: TenantDb,
    title: string,
    body: string,
    shortcut: string | null,
  ): Promise<CrmTemplate> {
    const inserted = await db
      .insert(crmTemplates)
      .values({ title, body, shortcut })
      .returning();
    return inserted[0]!;
  }

  async deleteTemplate(db: TenantDb, templateId: string): Promise<void> {
    await db.delete(crmTemplates).where(eq(crmTemplates.id, templateId));
  }
}
