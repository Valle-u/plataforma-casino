/**
 * E2E: las etapas del circuito se derivan bien (**Circuitos**).
 *
 * ## Por qué hace falta un test para una consulta de lectura
 *
 * Porque la etapa **no está guardada en ningún lado**: sale de un `CASE` sobre
 * tres señales —si el contacto tiene cuenta, si tiene un depósito aprobado, y
 * cuándo abrió un juego por última vez—. Si ese `CASE` se equivoca, no rompe
 * nada: la pantalla muestra números plausibles y el operador le escribe al que
 * no era. Un error acá **se lee como un dato**, y eso no se descubre mirando.
 *
 * ## Lo que se fija
 *
 *   1. Las cinco etapas, una por una, con los datos que las producen.
 *   2. **El orden del `CASE`**: jugando le gana a depositó. Es la única
 *      decisión de diseño que tiene el cálculo, y la única que se puede
 *      invertir sin que nadie lo note.
 *   3. **Qué NO cuenta como depósito**: pendiente y rechazado no mueven a
 *      nadie. Si contaran, el operador vería gente "con fichas" que no tiene.
 *   4. **El corte de los 14 días**, de los dos lados.
 *   5. **Aislamiento de bandeja**: los contactos de otro operador no entran ni
 *      en el conteo ni en la lista. Es la misma garantía que Contactos, y acá
 *      vuelve a probarse porque es otra consulta distinta.
 *
 * Cada bandeja es un socio independiente propio de esta suite, no el admin: si
 * los contactos colgaran de la bandeja del admin, cualquier otro test que deje
 * una conversación ahí correría los números y este archivo empezaría a fallar
 * por motivos ajenos.
 */

import { sql, type SQL } from 'drizzle-orm';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser, type TestUser } from '../helpers/test-users';

const SUITE = `crm-circ-${Date.now().toString(36)}`;

let ctx: TestApp;
let adminToken: string;

/** Las dos bandejas: la que se mide y la que tiene que quedar afuera. */
let bandeja: TestUser;
let otraBandeja: TestUser;
let tokenBandeja = '';

let canalId = '';
let methodId = '';
let gameId = '';

type Etapa = 'lead' | 'cuenta' | 'deposito' | 'jugando' | 'reactivacion';

async function fila<T>(consulta: SQL): Promise<T> {
  const r = await ctx.tenantDb.execute(consulta);
  return (r as unknown as T[])[0]!;
}

async function marcarIndependiente(userId: string): Promise<void> {
  await ctx.tenantDb.execute(
    sql`UPDATE users SET is_independent_branch = true WHERE id = ${userId}`,
  );
}

/**
 * Un contacto con una conversación asignada a `atiende`. Sin la conversación el
 * contacto no es de ninguna bandeja y el cálculo no lo mira.
 *
 * `jugadorId` en null es un lead: alguien que escribió y todavía no tiene
 * cuenta.
 */
async function contacto(
  atiende: string,
  jugadorId: string | null,
  nombre: string,
): Promise<string> {
  const c = await fila<{ id: string }>(
    sql`INSERT INTO crm_contacts (user_id, display_name, is_lead)
        VALUES (${jugadorId}, ${nombre}, ${jugadorId === null})
        RETURNING id`,
  );
  await ctx.tenantDb.execute(
    sql`INSERT INTO crm_conversations (contact_id, channel_id, assigned_operator_id)
        VALUES (${c.id}, ${canalId}, ${atiende})`,
  );
  return c.id;
}

/** Un depósito en el estado que se pida. Sólo `approved` mueve la etapa. */
async function deposito(userId: string, status: string): Promise<void> {
  await ctx.tenantDb.execute(
    sql`INSERT INTO deposits (id, user_id, method_id, amount_fiat, currency_fiat, amount_chips, status)
        VALUES (gen_random_uuid(), ${userId}, ${methodId}, '1000', 'ARS', '1000', ${status})`,
  );
}

/** Una sesión de juego abierta hace `hace` días. */
async function jugo(userId: string, hace: number): Promise<void> {
  await ctx.tenantDb.execute(
    sql`INSERT INTO game_sessions (id, user_id, game_id, provider_session_id, started_at)
        VALUES (gen_random_uuid(), ${userId}, ${gameId}, ${`circ-${userId}-${hace}`},
                now() - make_interval(days => ${hace}))`,
  );
}

/** Un jugador de esta suite, con su contacto ya colgado de `bandeja`. */
async function jugadorConContacto(label: string): Promise<TestUser> {
  const u = await createTestUser(ctx.request, adminToken, {
    suite: SUITE,
    label,
    role: 'usuario_final',
  });
  await contacto(bandeja.id, u.id, label);
  return u;
}

async function conteo(): Promise<Record<Etapa, number>> {
  const res = await ctx.request
    .get('/tenant/chat/circuitos')
    .set('Host', TEST_TENANT.host)
    .set('Authorization', tokenBandeja);
  if (res.status !== 200) {
    throw new Error(`circuitos devolvió ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body as Record<Etapa, number>;
}

interface PaginaDeEtapa {
  items: Array<{ id: string; userId: string | null; displayName: string | null }>;
  total: number;
}

async function listaDe(etapa: string): Promise<PaginaDeEtapa> {
  const res = await ctx.request
    .get(`/tenant/chat/circuitos/${etapa}`)
    .set('Host', TEST_TENANT.host)
    .set('Authorization', tokenBandeja);
  if (res.status !== 200) {
    throw new Error(`circuitos/${etapa} devolvió ${res.status}`);
  }
  return res.body as PaginaDeEtapa;
}

describe('CRM · las etapas del circuito', () => {
  /** Cada jugador entra a la suite con la señal que lo define. */
  let elDeCuenta: TestUser;
  let elQueDeposito: TestUser;
  let elQueJuega: TestUser;
  let elDormido: TestUser;
  let elDeLosDosHechos: TestUser;
  let elPendiente: TestUser;
  let elRechazado: TestUser;
  let leadId = '';

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);

    bandeja = await createTestUser(ctx.request, adminToken, {
      suite: SUITE,
      label: 'bandeja',
      role: 'socio',
    });
    otraBandeja = await createTestUser(ctx.request, adminToken, {
      suite: SUITE,
      label: 'otra',
      role: 'socio',
    });
    await marcarIndependiente(bandeja.id);
    await marcarIndependiente(otraBandeja.id);
    tokenBandeja = await loginAs(ctx.request, bandeja.username, bandeja.password);

    const canal = await fila<{ id: string }>(
      sql`INSERT INTO crm_channels (type) VALUES ('web-livechat') RETURNING id`,
    );
    canalId = canal.id;

    const metodo = await fila<{ id: string }>(
      sql`INSERT INTO payment_methods (id, code, name, type, config, is_active)
          VALUES (gen_random_uuid(), ${`circ_${SUITE}`}, 'Circuitos', 'bank_transfer', '{}'::jsonb, true)
          RETURNING id`,
    );
    methodId = metodo.id;

    await ctx.tenantDb.execute(
      sql`INSERT INTO games (id, code, name, category)
          VALUES (gen_random_uuid(), ${`circ_${SUITE}`}, 'Circuitos', 'slots')
          ON CONFLICT (code) DO NOTHING`,
    );
    const juego = await fila<{ id: string }>(
      sql`SELECT id FROM games WHERE code = ${`circ_${SUITE}`} LIMIT 1`,
    );
    gameId = juego.id;

    // ── La población de la bandeja ────────────────────────────────────────
    leadId = await contacto(bandeja.id, null, 'Lead');

    elDeCuenta = await jugadorConContacto('cuenta');

    elQueDeposito = await jugadorConContacto('deposito');
    await deposito(elQueDeposito.id, 'approved');

    elQueJuega = await jugadorConContacto('juega');
    await jugo(elQueJuega.id, 2);

    elDormido = await jugadorConContacto('dormido');
    await jugo(elDormido.id, 30);

    // Depositó **y** está jugando: el caso que decide el orden del `CASE`.
    elDeLosDosHechos = await jugadorConContacto('ambos');
    await deposito(elDeLosDosHechos.id, 'approved');
    await jugo(elDeLosDosHechos.id, 1);

    elPendiente = await jugadorConContacto('pendiente');
    await deposito(elPendiente.id, 'pending');

    elRechazado = await jugadorConContacto('rechazado');
    await deposito(elRechazado.id, 'rejected');

    // Y uno en la bandeja de al lado, que no tiene que aparecer en ningún
    // número de acá.
    const ajeno = await createTestUser(ctx.request, adminToken, {
      suite: SUITE,
      label: 'ajeno',
      role: 'usuario_final',
    });
    await contacto(otraBandeja.id, ajeno.id, 'Ajeno');
    await deposito(ajeno.id, 'approved');
  }, 90_000);

  afterAll(async () => {
    // Las conversaciones cuelgan de un canal con `RESTRICT`: sin limpiarlas,
    // la suite que borra canales en su `beforeEach` falla por culpa de ésta.
    await ctx.tenantDb.execute(
      sql`DELETE FROM crm_conversations WHERE channel_id = ${canalId}`,
    );
    await ctx.tenantDb.execute(sql`DELETE FROM crm_channels WHERE id = ${canalId}`);
    await ctx.close();
  });

  describe('cada etapa sale de su señal', () => {
    it('sin cuenta es un lead', async () => {
      const lista = await listaDe('lead');
      expect(lista.items.map((i) => i.id)).toContain(leadId);
      expect(lista.items.every((i) => i.userId === null)).toBe(true);
    });

    it('con cuenta y sin depósito aprobado es "cuenta creada"', async () => {
      const lista = await listaDe('cuenta');
      expect(lista.items.map((i) => i.userId)).toContain(elDeCuenta.id);
    });

    it('con depósito aprobado y sin jugar es "depositó"', async () => {
      const lista = await listaDe('deposito');
      expect(lista.items.map((i) => i.userId)).toContain(elQueDeposito.id);
    });

    it('con una sesión reciente está "jugando"', async () => {
      const lista = await listaDe('jugando');
      expect(lista.items.map((i) => i.userId)).toContain(elQueJuega.id);
    });

    it('con la última sesión hace 30 días es "reactivación"', async () => {
      const lista = await listaDe('reactivacion');
      expect(lista.items.map((i) => i.userId)).toContain(elDormido.id);
    });
  });

  describe('el orden del CASE', () => {
    it('el que depositó y además juega aparece en "jugando", no en "depositó"', async () => {
      const jugando = await listaDe('jugando');
      const depositaron = await listaDe('deposito');

      expect(jugando.items.map((i) => i.userId)).toContain(elDeLosDosHechos.id);
      expect(depositaron.items.map((i) => i.userId)).not.toContain(
        elDeLosDosHechos.id,
      );
    });

    it('nadie aparece en dos etapas: las cinco listas suman el total', async () => {
      const c = await conteo();
      const listas = await Promise.all(
        (['lead', 'cuenta', 'deposito', 'jugando', 'reactivacion'] as const).map(
          (e) => listaDe(e),
        ),
      );
      const ids = listas.flatMap((l) => l.items.map((i) => i.id));

      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBe(
        c.lead + c.cuenta + c.deposito + c.jugando + c.reactivacion,
      );
    });
  });

  describe('qué NO cuenta como depósito', () => {
    it('un depósito pendiente deja a la persona en "cuenta creada"', async () => {
      const lista = await listaDe('cuenta');
      expect(lista.items.map((i) => i.userId)).toContain(elPendiente.id);
    });

    it('un depósito rechazado tampoco la mueve', async () => {
      const lista = await listaDe('cuenta');
      expect(lista.items.map((i) => i.userId)).toContain(elRechazado.id);
    });
  });

  describe('el corte de los 14 días', () => {
    it('a los 13 días todavía está jugando', async () => {
      const u = await jugadorConContacto('trece');
      await jugo(u.id, 13);

      const lista = await listaDe('jugando');
      expect(lista.items.map((i) => i.userId)).toContain(u.id);
    });

    it('a los 15 días ya es reactivación', async () => {
      const u = await jugadorConContacto('quince');
      await jugo(u.id, 15);

      const lista = await listaDe('reactivacion');
      expect(lista.items.map((i) => i.userId)).toContain(u.id);
    });

    it('vale la sesión MÁS RECIENTE, no la primera', async () => {
      // Jugó hace meses y volvió ayer: está jugando. Si el cálculo mirara la
      // primera sesión, o cualquiera, éste caería en reactivación.
      const u = await jugadorConContacto('volvio');
      await jugo(u.id, 200);
      await jugo(u.id, 1);

      const lista = await listaDe('jugando');
      expect(lista.items.map((i) => i.userId)).toContain(u.id);
    });
  });

  describe('cada bandeja ve la suya', () => {
    it('el conteo no incluye contactos de otra bandeja', async () => {
      const c = await conteo();
      const total = c.lead + c.cuenta + c.deposito + c.jugando + c.reactivacion;
      const propios = await fila<{ total: number }>(
        sql`SELECT count(DISTINCT contact_id)::int AS total
              FROM crm_conversations
             WHERE assigned_operator_id = ${bandeja.id}`,
      );

      expect(total).toBe(propios.total);
    });

    it('la lista de una etapa tampoco', async () => {
      const lista = await listaDe('deposito');
      const ajenos = await ctx.tenantDb.execute(
        sql`SELECT c.id FROM crm_contacts c
              JOIN crm_conversations conv ON conv.contact_id = c.id
             WHERE conv.assigned_operator_id = ${otraBandeja.id}`,
      );
      const idsAjenos = (ajenos as unknown as Array<{ id: string }>).map(
        (r) => r.id,
      );

      expect(idsAjenos.length).toBeGreaterThan(0);
      for (const id of idsAjenos) {
        expect(lista.items.map((i) => i.id)).not.toContain(id);
      }
    });
  });

  describe('la forma de la respuesta', () => {
    it('el conteo trae siempre las cinco claves, aunque estén en cero', async () => {
      const c = await conteo();
      expect(Object.keys(c).sort()).toEqual([
        'cuenta',
        'deposito',
        'jugando',
        'lead',
        'reactivacion',
      ]);
    });

    it('una etapa inventada devuelve 400, no una lista vacía', async () => {
      // Vacío sería peor que un error: parecería que no hay nadie en esa etapa
      // en vez de que esa etapa no existe.
      const res = await ctx.request
        .get('/tenant/chat/circuitos/alta-pedida')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', tokenBandeja);

      expect(res.status).toBe(400);
    });
  });
});
