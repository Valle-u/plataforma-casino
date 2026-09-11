/**
 * E2E: cerrar la red de un socio independiente (**D14** + **D24**, roadmap 4.2).
 *
 * # ⚠️ Esta suite prueba una excepción autorizada a la LEY R6
 *
 * No prueba "una funcionalidad": prueba que **una excepción respeta sus
 * límites**. Por eso lo que más se fija no es que cerrar funcione, sino todo lo
 * que tiene que seguir prohibido:
 *
 * | | Lo que se fija |
 * |---|---|
 * | **Antes de cerrar** | El staff central **no ve nada** de esa red. D6 y D7 sin matices. |
 * | **Quién** | Sólo el admin. El permiso es **no delegable**, así que un empleado no puede. |
 * | **El motivo** | Obligatorio. Es lo único que dentro de un año explica por qué se abrió. |
 * | **Irreversible** | Cerrar dos veces falla. Sin eso, la excepción sería un interruptor. |
 * | **La plata** | **Sigue oculta.** D14 autoriza el historial, no la billetera. |
 * | **La constancia** | Queda quién, cuándo y por qué — en la tabla y en `audit_log`. |
 *
 * Si alguna de esas se rompe, lo que queda no es un bug: es **leer
 * conversaciones privadas de terceros sin autorización**.
 */

import { sql } from 'drizzle-orm';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAsAdmin, loginAsCajero1 } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser, type TestUser } from '../helpers/test-users';

const SUITE = `cierre-${Date.now().toString(36)}`;
const MOTIVO = 'El socio dejó de operar el 2026-09-10, acordado por escrito.';

let ctx: TestApp;
let adminToken = '';
let cajeroToken = '';
let adminId = '';
let socio: TestUser;
let cajeroDelSocio: TestUser;
let canalDelSocio = '';
let contactoDelSocio = '';
let contactoDelCajero = '';

/**
 * Cuelga a `hijo` de `padre`.
 *
 * `createTestUser` no acepta un padre —todos cuelgan del admin— asi que la
 * jerarquia se arma a mano. Mismo patron que `crm-status-aviso`.
 */
async function colgarDe(hijo: string, padre: string, relacion: string): Promise<void> {
  await ctx.tenantDb.execute(
    sql`UPDATE user_hierarchy SET until = now()
         WHERE user_id = ${hijo} AND until IS NULL`,
  );
  await ctx.tenantDb.execute(
    sql`INSERT INTO user_hierarchy (id, user_id, parent_user_id, relation_type)
        VALUES (gen_random_uuid(), ${hijo}, ${padre}, ${relacion})`,
  );
}

async function una<T>(res: unknown): Promise<T> {
  return (res as unknown as T[])[0]!;
}

async function crearCanal(owner: string): Promise<string> {
  const f = await una<{ id: string }>(
    await ctx.tenantDb.execute(
      sql`INSERT INTO crm_channels (type, owner_user_id, is_active, config)
          VALUES ('web-livechat', ${owner}, true, '{}'::jsonb) RETURNING id`,
    ),
  );
  return f.id;
}

/** Un contacto con conversación y un mensaje, en la bandeja de `owner`. */
async function crearContacto(owner: string, nombre: string, texto: string) {
  const c = await una<{ id: string }>(
    await ctx.tenantDb.execute(
      sql`INSERT INTO crm_contacts (owner_user_id, display_name, is_lead)
          VALUES (${owner}, ${nombre}, true) RETURNING id`,
    ),
  );
  const conv = await una<{ id: string }>(
    await ctx.tenantDb.execute(
      sql`INSERT INTO crm_conversations (contact_id, channel_id, assigned_operator_id, status, last_message_at)
          VALUES (${c.id}, ${canalDelSocio}, ${owner}, 'open', now()) RETURNING id`,
    ),
  );
  await ctx.tenantDb.execute(
    sql`INSERT INTO crm_messages (conversation_id, direction, body)
        VALUES (${conv.id}, 'inbound', ${texto})`,
  );
  return c.id;
}

function pedir(path: string, token: string) {
  return ctx.request
    .post(path)
    .set('Host', TEST_TENANT.host)
    .set('Authorization', token);
}

function ver(path: string, token: string) {
  return ctx.request
    .get(path)
    .set('Host', TEST_TENANT.host)
    .set('Authorization', token);
}

const cerrar = (socioId: string, token = adminToken, reason = MOTIVO) =>
  pedir(`/tenant/chat/networks/${socioId}/close`, token).send({ reason });

async function fichaDe(contactId: string) {
  return una<{ owner_user_id: string | null }>(
    await ctx.tenantDb.execute(
      sql`SELECT owner_user_id FROM crm_contacts WHERE id = ${contactId}`,
    ),
  );
}

describe('CRM · cerrar una red (D14 + D24)', () => {
  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    cajeroToken = await loginAsCajero1(ctx.request);

    adminId = (
      await una<{ id: string }>(
        await ctx.tenantDb.execute(
          sql`SELECT id FROM users WHERE username = ${TEST_TENANT.admin.username}`,
        ),
      )
    ).id;

    socio = await createTestUser(ctx.request, adminToken, {
      suite: SUITE, label: 'socio', role: 'socio',
    });
    await ctx.tenantDb.execute(
      sql`UPDATE users SET is_independent_branch = true WHERE id = ${socio.id}`,
    );
    cajeroDelSocio = await createTestUser(ctx.request, adminToken, {
      suite: SUITE, label: 'cajero', role: 'cajero',
    });
    await colgarDe(cajeroDelSocio.id, socio.id, 'cajero_de_socio');

    canalDelSocio = await crearCanal(socio.id);
    contactoDelSocio = await crearContacto(socio.id, 'Cliente del socio', 'hola socio');
    contactoDelCajero = await crearContacto(
      cajeroDelSocio.id, 'Cliente del cajero', 'hola cajero',
    );
  }, 60_000);

  afterAll(async () => {
    await ctx.close();
  });

  // ── Antes de cerrar: la red está aislada ─────────────────────────────────

  describe('antes de cerrar, D6 y D7 valen sin matices', () => {
    /**
     * ⚠️ **El punto de partida.** Si el staff central ya viera estas
     * conversaciones, cerrar la red no autorizaría nada — la excepción no
     * tendría sentido porque el aislamiento ya estaría roto.
     */
    it('el staff central no puede abrir un contacto de esa red', async () => {
      const res = await ver(
        `/tenant/chat/contacts/${contactoDelSocio}/context`,
        adminToken,
      );
      expect([403, 404]).toContain(res.status);
    });

    it('tampoco su línea de tiempo', async () => {
      const res = await ver(
        `/tenant/chat/contacts/${contactoDelCajero}/timeline`,
        adminToken,
      );
      expect([403, 404]).toContain(res.status);
    });
  });

  // ── Quién puede cerrar ───────────────────────────────────────────────────

  describe('quién puede', () => {
    /**
     * ⚠️ El permiso es **no delegable**. D14 le deja al empleado **leer** lo que
     * se abrió; no le deja **abrirlo**. Un cajero, menos todavía.
     */
    it('un cajero no puede cerrar una red', async () => {
      const res = await cerrar(socio.id, cajeroToken);
      expect([401, 403]).toContain(res.status);
    });

    it('sin motivo no se cierra', async () => {
      const res = await cerrar(socio.id, adminToken, '');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('REASON_REQUIRED');
    });

    it('un motivo de dos palabras tampoco alcanza', async () => {
      const res = await cerrar(socio.id, adminToken, 'se fue');
      expect(res.status).toBe(400);
    });

    it('no se puede cerrar la red de quien no es cabeza de una independiente', async () => {
      const dependiente = await createTestUser(ctx.request, adminToken, {
        suite: SUITE, label: 'dep', role: 'socio',
      });
      const res = await cerrar(dependiente.id, adminToken);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('NOT_AN_INDEPENDENT_BRANCH');
    });
  });

  // ── El cierre ────────────────────────────────────────────────────────────

  describe('el cierre', () => {
    it('mueve los contactos del socio Y DE SUS CAJEROS a la bandeja central', async () => {
      const res = await cerrar(socio.id);

      expect(res.status).toBe(200);
      // Los dos: el del socio y el de su cajero. Dejar afuera a los cajeros
      // dejaría sus conversaciones en bandejas que ya no atiende nadie.
      expect(res.body.contactosMovidos).toBe(2);
      expect(res.body.etiqueta).toContain('Red de');

      for (const id of [contactoDelSocio, contactoDelCajero]) {
        expect((await fichaDe(id)).owner_user_id).toBeNull();
      }
    });

    it('las conversaciones quedan asignadas a la bandeja central', async () => {
      const convs = (await ctx.tenantDb.execute(
        sql`SELECT assigned_operator_id FROM crm_conversations
             WHERE contact_id IN (${contactoDelSocio}, ${contactoDelCajero})`,
      )) as unknown as Array<{ assigned_operator_id: string }>;

      expect(convs).toHaveLength(2);
      for (const c of convs) expect(c.assigned_operator_id).toBe(adminId);
    });

    /** **D14**: "con una etiqueta que marca la red de origen". */
    it('quedan etiquetados con la red de la que vienen', async () => {
      const etiquetas = (await ctx.tenantDb.execute(
        sql`SELECT t.label FROM crm_contact_tags ct
              JOIN crm_tags t ON t.id = ct.tag_id
             WHERE ct.contact_id = ${contactoDelSocio}`,
      )) as unknown as Array<{ label: string }>;

      expect(etiquetas.some((e) => e.label.startsWith('Red de'))).toBe(true);
    });

    /** Ahora sí: es lo que D14 autoriza. */
    it('ahora el staff central SÍ lee el historial', async () => {
      const res = await ver(
        `/tenant/chat/contacts/${contactoDelSocio}/context`,
        adminToken,
      );
      expect(res.status).toBe(200);
    });

    /**
     * ⚠️ **La constancia es lo único que separa lo permitido de lo prohibido.**
     * Sin esta fila, las conversaciones movidas serían conversaciones de una red
     * independiente sentadas en la bandeja central sin nada que las respalde.
     */
    it('queda registrado quién, cuándo y por qué', async () => {
      const cierre = await una<{
        socio_user_id: string;
        closed_by: string;
        reason: string;
        contacts_moved: number;
        closed_at: string;
      }>(
        await ctx.tenantDb.execute(
          sql`SELECT * FROM crm_network_closures WHERE socio_user_id = ${socio.id}`,
        ),
      );

      expect(cierre.closed_by).toBe(adminId);
      expect(cierre.reason).toBe(MOTIVO);
      expect(cierre.contacts_moved).toBe(2);
      expect(cierre.closed_at).toBeTruthy();
    });

    it('y también en audit_log, diciendo qué excepción se ejecutó', async () => {
      const fila = await una<{ action_code: string; metadata: { excepcion?: string } }>(
        await ctx.tenantDb.execute(
          sql`SELECT action_code, metadata FROM audit_log
               WHERE action_code = 'crm.network.close' AND target_id = ${socio.id}`,
        ),
      );

      expect(fila.action_code).toBe('crm.network.close');
      // No alcanza con decir qué se tocó: tiene que decir qué se autorizó.
      expect(fila.metadata.excepcion).toContain('D14');
    });
  });

  // ── Los límites que siguen en pie ────────────────────────────────────────

  describe('lo que el cierre NO habilita', () => {
    /**
     * ⚠️ **D24: no se puede deshacer.**
     *
     * Sin esto, un admin cierra la red cinco minutos, lee años de
     * conversaciones y reabre. Queda auditado — pero una auditoría sólo sirve
     * si alguien la lee, y para entonces el daño ya está hecho.
     */
    it('no se puede cerrar dos veces', async () => {
      const res = await cerrar(socio.id);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('NETWORK_ALREADY_CLOSED');
    });

    /**
     * ⚠️ **La plata sigue oculta.**
     *
     * D14 autoriza leer **el historial**, y su límite 2 insiste en que es sólo
     * visibilidad del CRM. No dice nada sobre la billetera, así que se toma la
     * lectura angosta: los jugadores siguen colgando de una rama independiente
     * y `getContext` sigue sin devolver el saldo.
     *
     * Ampliarlo sería otra decisión, del dueño. Este test existe para que no
     * pase de rebote.
     */
    it('un jugador de esa red sigue sin mostrar el saldo', async () => {
      // Se cierra **de verdad** otra red, por el endpoint. Mover el contacto a
      // mano dejaría la conversación asignada al socio y el admin no podría
      // abrirla: probaría el setup, no el producto.
      const socio2 = await createTestUser(ctx.request, adminToken, {
        suite: SUITE, label: 'socio2', role: 'socio',
      });
      await ctx.tenantDb.execute(
        sql`UPDATE users SET is_independent_branch = true WHERE id = ${socio2.id}`,
      );
      const jugador = await createTestUser(ctx.request, adminToken, {
        suite: SUITE, label: 'jug', role: 'usuario_final',
      });
      await colgarDe(jugador.id, socio2.id, 'jugador_de_socio');

      const contacto = await crearContacto(socio2.id, 'Con jugador', 'hola');
      await ctx.tenantDb.execute(
        sql`UPDATE crm_contacts SET user_id = ${jugador.id}, is_lead = false
             WHERE id = ${contacto}`,
      );

      expect((await cerrar(socio2.id)).status).toBe(200);

      const res = await ver(`/tenant/chat/contacts/${contacto}/context`, adminToken);

      // Lo lee: es lo que D14 autoriza.
      expect(res.status).toBe(200);
      // Pero la billetera NO viaja: R6 sigue entero para la plata.
      expect(res.body.network?.same).toBe(false);
      expect(res.body.wallet).toBeNull();
      expect(res.body.recentDeposits).toEqual([]);
    });

    it('otra red que NO se cerró sigue aislada', async () => {
      const otro = await createTestUser(ctx.request, adminToken, {
        suite: SUITE, label: 'otro', role: 'socio',
      });
      await ctx.tenantDb.execute(
        sql`UPDATE users SET is_independent_branch = true WHERE id = ${otro.id}`,
      );
      const suContacto = await crearContacto(otro.id, 'De la otra red', 'hola');

      const res = await ver(
        `/tenant/chat/contacts/${suContacto}/context`,
        adminToken,
      );
      // Cerrar una red no abre las demás.
      expect([403, 404]).toContain(res.status);
    });
  });

  it('las redes cerradas se pueden listar, con su motivo', async () => {
    const res = await ver('/tenant/chat/networks/closed', adminToken);

    expect(res.status).toBe(200);
    const cerradas = res.body as Array<{ socio: string; reason: string }>;
    expect(cerradas.some((c) => c.reason === MOTIVO)).toBe(true);
  });
});
