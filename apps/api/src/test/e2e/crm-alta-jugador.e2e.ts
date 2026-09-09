/**
 * E2E: alta de jugador desde el chat (D9).
 *
 * ## El caso que justifica todo el endpoint
 *
 * **El jugador tiene que colgar del dueño de la bandeja, no del que lo crea.**
 *
 * Casi siempre son el mismo —el cajero atiende su canal y crea su jugador— pero
 * no cuando atiende un **empleado**. Y los socios independientes pueden tener
 * empleados (**R7**).
 *
 * Que quede mal no rompe nada visible: el jugador se crea, entra, juega. Lo que
 * cambia es **de quién es** y, con eso, **quién cobra por él**. Se descubre
 * cuando alguien mira una liquidación de comisiones y no cierra.
 *
 * Por eso el endpoint no recibe el operador padre: lo saca de
 * `crm_contacts.owner_user_id`. Este test fija que sea así.
 */

import { sql } from 'drizzle-orm';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser, type TestUser } from '../helpers/test-users';

const SUITE = `crm-alta-${Date.now().toString(36)}`;

let ctx: TestApp;
let adminToken: string;
let adminId = '';
let canalId = '';
let litoral: TestUser;
let litoralToken = '';

async function una<T>(res: unknown): Promise<T> {
  return (res as unknown as T[])[0]!;
}

/** Un lead (sin jugador vinculado) en la bandeja de `owner`. */
async function leadEnBandeja(
  owner: string | null,
  atiende: string,
  telefono: string | null = '+5493415550000',
): Promise<string> {
  const c = await una<{ id: string }>(
    await ctx.tenantDb.execute(
      sql`INSERT INTO crm_contacts (owner_user_id, display_name, phone, is_lead)
          VALUES (${owner}, 'Alguien', ${telefono}, true) RETURNING id`,
    ),
  );
  await ctx.tenantDb.execute(
    sql`INSERT INTO crm_conversations (contact_id, channel_id, assigned_operator_id)
        VALUES (${c.id}, ${canalId}, ${atiende})`,
  );
  return c.id;
}

function crearJugador(contactId: string, bearer: string, cuerpo: object) {
  return ctx.request
    .post(`/tenant/chat/contacts/${contactId}/create-player`)
    .set('Host', TEST_TENANT.host)
    .set('Authorization', bearer)
    .send(cuerpo);
}

/** De quién cuelga un usuario, según la jerarquía activa. */
async function padreDe(userId: string): Promise<string | null> {
  const filas = (await ctx.tenantDb.execute(
    sql`SELECT parent_user_id FROM user_hierarchy
         WHERE user_id = ${userId} AND until IS NULL`,
  )) as unknown as Array<{ parent_user_id: string | null }>;
  return filas[0]?.parent_user_id ?? null;
}

let n = 0;
const usuario = () => `alta${Date.now().toString(36)}${n++}`;

describe('CRM · alta de jugador desde el chat (D9)', () => {
  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);

    adminId = (
      await una<{ id: string }>(
        await ctx.tenantDb.execute(
          sql`SELECT id FROM users WHERE username = ${TEST_TENANT.admin.username}`,
        ),
      )
    ).id;
    canalId = (
      await una<{ id: string }>(
        await ctx.tenantDb.execute(
          sql`INSERT INTO crm_channels (type) VALUES ('web-livechat') RETURNING id`,
        ),
      )
    ).id;

    litoral = await createTestUser(ctx.request, adminToken, {
      suite: SUITE, label: 'litoral', role: 'socio',
    });
    await ctx.tenantDb.execute(
      sql`UPDATE users SET is_independent_branch = true WHERE id = ${litoral.id}`,
    );
    litoralToken = await loginAs(ctx.request, litoral.username, litoral.password);
  }, 60_000);

  afterAll(async () => {
    await ctx.close();
  });

  it('el jugador cuelga del dueño de la bandeja', async () => {
    const contactId = await leadEnBandeja(litoral.id, litoral.id);

    const res = await crearJugador(contactId, litoralToken, {
      username: usuario(),
      displayName: 'Juan Nuevo',
    });

    expect(res.status).toBe(201);
    expect(await padreDe(res.body.userId as string)).toBe(litoral.id);
  });

  /**
   * ⚠️ **El test que justifica el endpoint.**
   *
   * El alta la hace el ADMIN sobre un lead de la bandeja de Litoral. Si el
   * padre saliera de quién crea —como hace `POST /tenant/users`— el jugador
   * colgaría del admin y **se iría de la red independiente**. Tiene que colgar
   * de Litoral.
   */
  it('cuelga del dueño de la bandeja aunque lo cree otro', async () => {
    const contactId = await leadEnBandeja(litoral.id, adminId);

    const res = await crearJugador(contactId, adminToken, {
      username: usuario(),
    });

    expect(res.status).toBe(201);
    expect(await padreDe(res.body.userId as string)).toBe(litoral.id);
    expect(await padreDe(res.body.userId as string)).not.toBe(adminId);
  });

  it('un lead de la bandeja central cuelga del admin', async () => {
    const contactId = await leadEnBandeja(null, adminId);

    const res = await crearJugador(contactId, adminToken, {
      username: usuario(),
    });

    expect(res.status).toBe(201);
    expect(await padreDe(res.body.userId as string)).toBe(adminId);
  });

  it('el teléfono del contacto viaja al jugador: es la llave de D4', async () => {
    const tel = `+54934155${Math.floor(Math.random() * 90000 + 10000)}`;
    const contactId = await leadEnBandeja(litoral.id, litoral.id, tel);

    const res = await crearJugador(contactId, litoralToken, {
      username: usuario(),
    });

    const fila = await una<{ phone: string | null }>(
      await ctx.tenantDb.execute(
        sql`SELECT phone FROM users WHERE id = ${res.body.userId as string}`,
      ),
    );
    expect(fila.phone).toBe(tel);
  });

  it('el contacto deja de ser lead y queda vinculado, sin cambiar de bandeja', async () => {
    const contactId = await leadEnBandeja(litoral.id, litoral.id);

    const res = await crearJugador(contactId, litoralToken, {
      username: usuario(),
    });

    const c = await una<{
      user_id: string;
      is_lead: boolean;
      owner_user_id: string | null;
    }>(
      await ctx.tenantDb.execute(
        sql`SELECT user_id, is_lead, owner_user_id FROM crm_contacts
             WHERE id = ${contactId}`,
      ),
    );
    expect(c.user_id).toBe(res.body.userId);
    expect(c.is_lead).toBe(false);
    // Darlo de alta NO lo mueve de bandeja: ya era de Litoral por D5.
    expect(c.owner_user_id).toBe(litoral.id);
  });

  it('sin contraseña, devuelve una generada UNA vez', async () => {
    const contactId = await leadEnBandeja(litoral.id, litoral.id);

    const res = await crearJugador(contactId, litoralToken, {
      username: usuario(),
    });

    expect(typeof res.body.generatedPassword).toBe('string');
    expect((res.body.generatedPassword as string).length).toBeGreaterThanOrEqual(8);
    // Sin caracteres que se confundan al dictarlos.
    expect(res.body.generatedPassword).not.toMatch(/[0O1lI]/);
  });

  it('con contraseña propia, no devuelve ninguna', async () => {
    const contactId = await leadEnBandeja(litoral.id, litoral.id);

    const res = await crearJugador(contactId, litoralToken, {
      username: usuario(),
      password: 'la-que-eligio-el-operador-2026',
    });

    expect(res.status).toBe(201);
    expect(res.body.generatedPassword).toBeUndefined();
  });

  it('un contacto que ya es jugador no se puede volver a dar de alta', async () => {
    const contactId = await leadEnBandeja(litoral.id, litoral.id);
    await crearJugador(contactId, litoralToken, { username: usuario() });

    const res = await crearJugador(contactId, litoralToken, {
      username: usuario(),
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CONTACT_ALREADY_LINKED');
  });

  it('un usuario inválido se rechaza antes de tocar nada', async () => {
    const contactId = await leadEnBandeja(litoral.id, litoral.id);

    const res = await crearJugador(contactId, litoralToken, { username: 'a' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_USERNAME');

    const c = await una<{ is_lead: boolean }>(
      await ctx.tenantDb.execute(
        sql`SELECT is_lead FROM crm_contacts WHERE id = ${contactId}`,
      ),
    );
    expect(c.is_lead).toBe(true); // el lead quedó intacto
  });

  it('no se puede dar de alta desde un contacto de otra bandeja', async () => {
    const contactId = await leadEnBandeja(null, adminId);

    const res = await crearJugador(contactId, litoralToken, {
      username: usuario(),
    });

    expect(res.status).toBe(403);
  });
});
