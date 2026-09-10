/**
 * E2E: el teléfono como identidad y el vínculo con el jugador (**D4**).
 *
 * ## Las tres defensas que D4 exige, una por una
 *
 * 1. **Normalizar antes de comparar.** El caso que importa: un jugador cargado
 *    como `0341 15 555-1234` y un contacto que llega como `+5493415551234` son
 *    la misma persona. Antes de esto se comparaba el string crudo y **no
 *    matcheaban**, así que el freno del alta no frenaba nada y se creaba una
 *    segunda cuenta con el saldo partido.
 * 2. **Si matchea con más de uno, no vincular ninguno.** `users.phone` no es
 *    único: dos jugadores pueden compartirlo de verdad —una pareja, un
 *    locutorio— y mostrar el nombre equivocado es peor que no mostrar ninguno.
 * 3. **El vínculo se puede deshacer**, y queda registrado quién lo deshizo.
 *
 * ## Y la que no es de D4 pero se prueba igual: R6
 *
 * Vincular un contacto a un jugador **da acceso a su plata**: la ficha pasa a
 * mostrar saldo y movimientos. Así que el buscador y el vínculo tienen que
 * estar acotados por red, o serían la puerta de atrás a la plata de la red de
 * otro socio.
 */

import { sql, type SQL } from 'drizzle-orm';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser, type TestUser } from '../helpers/test-users';

const SUITE = `crm-tel-${Date.now().toString(36)}`;

let ctx: TestApp;
let adminToken: string;
let adminId = '';
let canalId = '';

/** El socio independiente de al lado, para los casos de R6. */
let otraRed: TestUser;
let jugadorDeOtraRed: TestUser;

async function fila<T>(consulta: SQL): Promise<T | undefined> {
  const r = await ctx.tenantDb.execute(consulta);
  return (r as unknown as T[])[0];
}

async function ponerTelefono(userId: string, telefono: string): Promise<void> {
  await ctx.tenantDb.execute(
    sql`UPDATE users SET phone = ${telefono} WHERE id = ${userId}`,
  );
}

/** Un contacto de la bandeja del admin, con su conversación (da el acceso). */
async function contacto(opciones: {
  telefono?: string | null;
  userId?: string | null;
}): Promise<string> {
  const c = await fila<{ id: string }>(sql`
    INSERT INTO crm_contacts (user_id, display_name, is_lead, phone)
    VALUES (${opciones.userId ?? null}, 'Contacto', ${!opciones.userId},
            ${opciones.telefono ?? null})
    RETURNING id
  `);
  await ctx.tenantDb.execute(sql`
    INSERT INTO crm_conversations (contact_id, channel_id, assigned_operator_id)
    VALUES (${c!.id}, ${canalId}, ${adminId})
  `);
  return c!.id;
}

interface Jugador {
  id: string;
  username: string;
  displayName: string | null;
  status: string;
}

async function homonimos(contactId: string, bearer = adminToken): Promise<Jugador[]> {
  const res = await ctx.request
    .get(`/tenant/chat/contacts/${contactId}/homonimos`)
    .set('Host', TEST_TENANT.host)
    .set('Authorization', bearer);
  if (res.status !== 200) {
    throw new Error(`homonimos devolvió ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body as Jugador[];
}

async function buscar(q: string, bearer = adminToken): Promise<Jugador[]> {
  const res = await ctx.request
    .get(`/tenant/chat/jugadores?q=${encodeURIComponent(q)}`)
    .set('Host', TEST_TENANT.host)
    .set('Authorization', bearer);
  if (res.status !== 200) {
    throw new Error(`jugadores devolvió ${res.status}`);
  }
  return res.body as Jugador[];
}

describe('CRM · el teléfono como identidad (D4)', () => {
  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);

    const admin = await fila<{ id: string }>(
      sql`SELECT id FROM users WHERE username = ${TEST_TENANT.admin.username}`,
    );
    adminId = admin!.id;

    const canal = await fila<{ id: string }>(
      sql`INSERT INTO crm_channels (type) VALUES ('whatsapp') RETURNING id`,
    );
    canalId = canal!.id;

    otraRed = await createTestUser(ctx.request, adminToken, {
      suite: SUITE,
      label: 'otrared',
      role: 'socio',
    });
    await ctx.tenantDb.execute(
      sql`UPDATE users SET is_independent_branch = true WHERE id = ${otraRed.id}`,
    );
    jugadorDeOtraRed = await createTestUser(ctx.request, adminToken, {
      suite: SUITE,
      label: 'jugotro',
      role: 'usuario_final',
    });
    await ctx.tenantDb.execute(
      sql`UPDATE user_hierarchy SET until = now()
           WHERE user_id = ${jugadorDeOtraRed.id} AND until IS NULL`,
    );
    await ctx.tenantDb.execute(sql`
      INSERT INTO user_hierarchy (id, user_id, parent_user_id, relation_type)
      VALUES (gen_random_uuid(), ${jugadorDeOtraRed.id}, ${otraRed.id}, 'jugador_de_socio')
    `);
  }, 60_000);

  afterAll(async () => {
    await ctx.tenantDb.execute(
      sql`DELETE FROM crm_conversations WHERE channel_id = ${canalId}`,
    );
    await ctx.tenantDb.execute(sql`DELETE FROM crm_channels WHERE id = ${canalId}`);
    await ctx.close();
  });

  describe('primera defensa · el mismo número escrito distinto', () => {
    /**
     * El caso que motivó todo. Cinco escrituras del mismo teléfono: el jugador
     * quedó cargado con una y el contacto llega con otra.
     */
    it.each([
      ['como lo manda WhatsApp', '5493415551234', '0341 15 555-1234'],
      ['con el 0 y el 15', '0341 15 555-1234', '+5493415551234'],
      ['nacional a secas', '341 555-1234', '+54 9 341 555-1234'],
      ['internacional sin el 9', '+543415551234', '0341155551234'],
      ['con separadores raros', '(0341) 15-555.1234', '3415551234'],
    ])(
      'lo encuentra %s',
      async (_caso, comoEstaElJugador, comoLlegaElContacto) => {
        const jugador = await createTestUser(ctx.request, adminToken, {
          suite: SUITE,
          label: `d1${Math.random().toString(36).slice(2, 7)}`,
          role: 'usuario_final',
        });
        await ponerTelefono(jugador.id, comoEstaElJugador);
        const c = await contacto({ telefono: comoLlegaElContacto });

        const encontrados = await homonimos(c);

        expect(encontrados.map((j) => j.id)).toContain(jugador.id);
      },
    );

    it('NO encuentra a otra persona con un número parecido', async () => {
      // Un dígito de diferencia es otra persona. Que el freno sea más ancho no
      // puede significar que agarre a cualquiera.
      const otro = await createTestUser(ctx.request, adminToken, {
        suite: SUITE,
        label: 'parecido',
        role: 'usuario_final',
      });
      await ponerTelefono(otro.id, '+5493415551299');
      const c = await contacto({ telefono: '+5493415551234' });

      expect((await homonimos(c)).map((j) => j.id)).not.toContain(otro.id);
    });

    it('un teléfono ilegible no frena nada, en vez de frenar todo', async () => {
      const c = await contacto({ telefono: 'preguntarle' });
      expect(await homonimos(c)).toEqual([]);
    });

    it('un contacto sin teléfono tampoco', async () => {
      const c = await contacto({ telefono: null });
      expect(await homonimos(c)).toEqual([]);
    });
  });

  describe('segunda defensa · dos jugadores con el mismo teléfono', () => {
    it('los devuelve a los dos, para que decida el operador', async () => {
      // `users.phone` no es único y esto pasa de verdad: una pareja, un
      // locutorio, un familiar que anota a otro. El sistema no elige: muestra
      // los dos y no vincula solo.
      const uno = await createTestUser(ctx.request, adminToken, {
        suite: SUITE, label: 'pareja1', role: 'usuario_final',
      });
      const dos = await createTestUser(ctx.request, adminToken, {
        suite: SUITE, label: 'pareja2', role: 'usuario_final',
      });
      await ponerTelefono(uno.id, '+5493415557777');
      await ponerTelefono(dos.id, '0341 15 555-7777');
      const c = await contacto({ telefono: '3415557777' });

      const encontrados = await homonimos(c);

      expect(encontrados.map((j) => j.id).sort()).toEqual([uno.id, dos.id].sort());
    });
  });

  describe('tercera defensa · el vínculo se deshace', () => {
    it('vincular deja el contacto apuntando al jugador', async () => {
      const jugador = await createTestUser(ctx.request, adminToken, {
        suite: SUITE, label: 'vincular', role: 'usuario_final',
      });
      const c = await contacto({ telefono: '3415551111' });

      const res = await ctx.request
        .post(`/tenant/chat/contacts/${c}/link`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ userId: jugador.id });

      expect(res.status).toBe(200);
      expect(res.body.userId).toBe(jugador.id);

      const guardado = await fila<{ user_id: string; is_lead: boolean }>(
        sql`SELECT user_id, is_lead FROM crm_contacts WHERE id = ${c}`,
      );
      expect(guardado!.user_id).toBe(jugador.id);
      // Deja de ser lead: ya se sabe quién es.
      expect(guardado!.is_lead).toBe(false);
    });

    it('deshacerlo lo devuelve a lead, y queda registrado quién fue', async () => {
      const jugador = await createTestUser(ctx.request, adminToken, {
        suite: SUITE, label: 'deshacer', role: 'usuario_final',
      });
      const c = await contacto({ userId: jugador.id });

      const res = await ctx.request
        .delete(`/tenant/chat/contacts/${c}/link`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      expect(res.status).toBe(200);
      expect(res.body.userId).toBeNull();

      const guardado = await fila<{ user_id: string | null; is_lead: boolean }>(
        sql`SELECT user_id, is_lead FROM crm_contacts WHERE id = ${c}`,
      );
      expect(guardado!.user_id).toBeNull();
      expect(guardado!.is_lead).toBe(true);

      // La constancia. Sin esto no habría forma de saber que alguien vio la
      // plata de ese jugador y después soltó la ficha.
      const evento = await fila<{ type: string; metadata: { actorId: string } }>(
        sql`SELECT type, metadata FROM crm_timeline_events
             WHERE contact_id = ${c} ORDER BY occurred_at DESC LIMIT 1`,
      );
      expect(evento!.type).toBe('unlink');
      expect(evento!.metadata.actorId).toBe(adminId);
    });

    it('vincular uno ya vinculado no lo pisa en silencio', async () => {
      const jugador = await createTestUser(ctx.request, adminToken, {
        suite: SUITE, label: 'yaesta', role: 'usuario_final',
      });
      const otro = await createTestUser(ctx.request, adminToken, {
        suite: SUITE, label: 'elotro', role: 'usuario_final',
      });
      const c = await contacto({ userId: jugador.id });

      const res = await ctx.request
        .post(`/tenant/chat/contacts/${c}/link`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ userId: otro.id });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('CONTACT_ALREADY_LINKED');
    });

    it('deshacer un vínculo que no existe avisa, no rompe', async () => {
      const c = await contacto({ telefono: '3415552222' });

      const res = await ctx.request
        .delete(`/tenant/chat/contacts/${c}/link`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('CONTACT_NOT_LINKED');
    });
  });

  describe('R6 · vincular es dar acceso a la plata', () => {
    it('no se puede vincular a un jugador de otra red', async () => {
      const c = await contacto({ telefono: '3415553333' });

      const res = await ctx.request
        .post(`/tenant/chat/contacts/${c}/link`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ userId: jugadorDeOtraRed.id });

      // 404 y no 403: un 403 confirmaría que ese jugador existe.
      expect(res.status).toBe(404);

      const guardado = await fila<{ user_id: string | null }>(
        sql`SELECT user_id FROM crm_contacts WHERE id = ${c}`,
      );
      expect(guardado!.user_id).toBeNull();
    });

    it('el buscador tampoco lo muestra', async () => {
      const bearer = await loginAs(ctx.request, otraRed.username, otraRed.password);
      // El socio de la otra red sí ve al suyo...
      expect((await buscar(jugadorDeOtraRed.username, bearer)).map((j) => j.id))
        .toContain(jugadorDeOtraRed.id);
      // ...y el staff central no.
      expect((await buscar(jugadorDeOtraRed.username)).map((j) => j.id))
        .not.toContain(jugadorDeOtraRed.id);
    });

    it('el freno del alta tampoco cruza redes', async () => {
      await ponerTelefono(jugadorDeOtraRed.id, '+5493415554444');
      const c = await contacto({ telefono: '0341 15 555-4444' });

      // El teléfono matchea, pero el jugador es de otra red: no se devuelve.
      // Si se devolviera, "buscá por teléfono" sería la forma más fácil de
      // averiguar quién juega en la red de otro socio.
      expect((await homonimos(c)).map((j) => j.id)).not.toContain(
        jugadorDeOtraRed.id,
      );
    });
  });

  describe('el buscador para vincular', () => {
    it('encuentra por usuario y por teléfono escrito de cualquier forma', async () => {
      const jugador = await createTestUser(ctx.request, adminToken, {
        suite: SUITE, label: 'buscable', role: 'usuario_final',
      });
      await ponerTelefono(jugador.id, '+5493415558888');

      expect((await buscar(jugador.username)).map((j) => j.id)).toContain(
        jugador.id,
      );
      expect((await buscar('0341 15 555-8888')).map((j) => j.id)).toContain(
        jugador.id,
      );
      expect((await buscar('3415558888')).map((j) => j.id)).toContain(jugador.id);
    });

    it('con menos de dos letras no devuelve nada', async () => {
      // Sin esto, un `%a%` trae el padrón entero de la red.
      expect(await buscar('a')).toEqual([]);
      expect(await buscar('')).toEqual([]);
    });
  });
});
