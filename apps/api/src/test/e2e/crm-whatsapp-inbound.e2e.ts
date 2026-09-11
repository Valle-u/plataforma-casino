/**
 * E2E: de un webhook de Meta a una conversación en la bandeja (**3.2**).
 *
 * Entra por HTTP con firma fabricada, igual que `crm-whatsapp-webhook.e2e.ts`
 * —que prueba **la puerta**— y sigue hasta el final: contacto, conversación,
 * mensaje.
 *
 * ## Lo que hace distinto a WhatsApp, y es casi todo lo que se prueba acá
 *
 * **Acá llega el teléfono**, así que **D4 corre de lleno**: el sistema busca ese
 * número entre los jugadores y lo vincula **solo**. En Telegram eso no pasa
 * nunca. Las tres defensas de D4 se fijan una por una:
 *
 * 1. **Normalizar antes de comparar** — el jugador cargado como
 *    `0341 15 555-1234` tiene que matchear con el `5493415551234` que manda
 *    Meta. Sin esto el vínculo automático falla justo cuando más sirve.
 * 2. **Más de un jugador con ese número → no se vincula ninguno.** Ante la
 *    duda, lead: mostrar el nombre equivocado es peor que no mostrar ninguno.
 * 3. Deshacerlo ya existe (3.3) y se prueba en su propia suite.
 *
 * Y lo que comparte con Telegram: **D2** (cae en la bandeja dueña del canal),
 * **D6** (un contacto por bandeja) y **D11** (el hilo se reabre, no se duplica).
 */

import { sql, eq } from 'drizzle-orm';
import { whatsappNumbers, tenants, type ControlDb } from '@casino/db';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser, type TestUser } from '../helpers/test-users';
import { CONTROL_DB } from '../../database/database.module';
import { firmarComoMeta } from '../../chat/whatsapp/firma-de-meta';

const APP_SECRET = 'app-secret-inbound';
const SUITE = `wain-${Date.now().toString(36)}`;
const NUM_CENTRAL = `num-central-${SUITE}`;
const NUM_LITORAL = `num-litoral-${SUITE}`;

let ctx: TestApp;
let controlDb: ControlDb;
let adminToken = '';
let adminId = '';
let litoral: TestUser;
let canalCentral = '';
let canalLitoral = '';

let seq = 0;
const proximoWamid = () => `wamid.${SUITE}.${seq++}`;

async function una<T>(res: unknown): Promise<T> {
  return (res as unknown as T[])[0]!;
}

async function crearCanal(owner: string | null): Promise<string> {
  const fila = await una<{ id: string }>(
    await ctx.tenantDb.execute(
      sql`INSERT INTO crm_channels (type, owner_user_id, is_active, config)
          VALUES ('whatsapp', ${owner}, true, '{}'::jsonb) RETURNING id`,
    ),
  );
  return fila.id;
}

/** Un webhook de Meta con un mensaje de texto, firmado como lo firma Meta. */
function entregar(opts: {
  phoneNumberId: string;
  de: string;
  texto?: string;
  nombre?: string;
  wamid?: string;
  tipo?: string;
}) {
  const mensaje: Record<string, unknown> = {
    from: opts.de,
    id: opts.wamid ?? proximoWamid(),
    timestamp: '1789300000',
    type: opts.tipo ?? 'text',
    ...(opts.tipo && opts.tipo !== 'text'
      ? { [opts.tipo]: { id: 'media-1' } }
      : { text: { body: opts.texto ?? 'hola' } }),
  };

  const cuerpo = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: opts.phoneNumberId },
              contacts: [
                { wa_id: opts.de, profile: { name: opts.nombre ?? 'Juan Pérez' } },
              ],
              messages: [mensaje],
            },
          },
        ],
      },
    ],
  });

  return ctx.request
    .post('/api/v1/crm/whatsapp/webhook')
    .set('Host', TEST_TENANT.host)
    .set('Content-Type', 'application/json')
    .set('X-Hub-Signature-256', firmarComoMeta(cuerpo, APP_SECRET))
    .send(cuerpo);
}

/** El contacto de ese número en esa bandeja (D6). */
async function contactoDe(waId: string, owner: string | null) {
  return (await ctx.tenantDb.execute(
    sql`SELECT id, user_id, is_lead, display_name, phone, owner_user_id
          FROM crm_contacts
         WHERE attributes -> 'whatsapp' ->> 'waId' = ${waId}
           AND (${owner}::uuid IS NULL AND owner_user_id IS NULL
                OR owner_user_id = ${owner}::uuid)`,
  )) as unknown as Array<{
    id: string;
    user_id: string | null;
    is_lead: boolean;
    display_name: string | null;
    phone: string | null;
    owner_user_id: string | null;
  }>;
}

async function mensajesDe(contactId: string) {
  return (await ctx.tenantDb.execute(
    sql`SELECT m.body, m.direction, m.channel_message_id, c.status
          FROM crm_messages m
          JOIN crm_conversations c ON c.id = m.conversation_id
         WHERE c.contact_id = ${contactId}
         ORDER BY m.created_at`,
  )) as unknown as Array<{
    body: string;
    direction: string;
    channel_message_id: string | null;
    status: string;
  }>;
}

describe('CRM · WhatsApp entrante (3.2)', () => {
  beforeAll(async () => {
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;

    ctx = await bootstrapTestApp();
    controlDb = ctx.app.get<ControlDb>(CONTROL_DB);
    adminToken = await loginAsAdmin(ctx.request);

    adminId = (
      await una<{ id: string }>(
        await ctx.tenantDb.execute(
          sql`SELECT id FROM users WHERE username = ${TEST_TENANT.admin.username}`,
        ),
      )
    ).id;

    litoral = await createTestUser(ctx.request, adminToken, {
      suite: SUITE, label: 'litoral', role: 'socio',
    });
    await ctx.tenantDb.execute(
      sql`UPDATE users SET is_independent_branch = true WHERE id = ${litoral.id}`,
    );

    canalCentral = await crearCanal(null);
    canalLitoral = await crearCanal(litoral.id);

    const tenant = (
      await controlDb
        .select()
        .from(tenants)
        .where(eq(tenants.slug, TEST_TENANT.slug))
        .limit(1)
    )[0]!;

    await controlDb.insert(whatsappNumbers).values([
      { phoneNumberId: NUM_CENTRAL, tenantId: tenant.id, channelId: canalCentral },
      { phoneNumberId: NUM_LITORAL, tenantId: tenant.id, channelId: canalLitoral },
    ]);
  }, 60_000);

  afterAll(async () => {
    for (const n of [NUM_CENTRAL, NUM_LITORAL]) {
      await controlDb
        .delete(whatsappNumbers)
        .where(eq(whatsappNumbers.phoneNumberId, n));
    }
    await ctx.close();
  });

  describe('lo básico: el mensaje llega a una bandeja', () => {
    it('un desconocido crea contacto, conversación y mensaje', async () => {
      const de = `54934155500${seq}1`;
      const res = await entregar({
        phoneNumberId: NUM_CENTRAL,
        de,
        texto: 'hola, necesito ayuda',
      });
      expect(res.status).toBe(200);

      const [c] = await contactoDe(de, null);
      expect(c).toBeDefined();
      expect(c!.display_name).toBe('Juan Pérez');
      // Nadie con ese teléfono: nace como lead. Es lo correcto.
      expect(c!.is_lead).toBe(true);
      expect(c!.user_id).toBeNull();
      // El teléfono se guarda en E.164 para mostrar.
      expect(c!.phone?.startsWith('+')).toBe(true);

      const msgs = await mensajesDe(c!.id);
      expect(msgs).toHaveLength(1);
      expect(msgs[0]!.body).toBe('hola, necesito ayuda');
      expect(msgs[0]!.direction).toBe('inbound');
    });

    /**
     * ⚠️ **D2 + D6.** El mismo humano escribiéndole al número del casino y al
     * del socio son **dos fichas distintas**, cada una en su bandeja. No se
     * unen aunque el teléfono sea idéntico.
     */
    it('el mismo número en dos canales son dos contactos (D6)', async () => {
      const de = `54934155510${seq}1`;

      await entregar({ phoneNumberId: NUM_CENTRAL, de, texto: 'al casino' });
      await entregar({ phoneNumberId: NUM_LITORAL, de, texto: 'a Litoral' });

      const central = await contactoDe(de, null);
      const deLitoral = await contactoDe(de, litoral.id);

      expect(central).toHaveLength(1);
      expect(deLitoral).toHaveLength(1);
      expect(central[0]!.id).not.toBe(deLitoral[0]!.id);

      // Y cada bandeja ve sólo lo suyo.
      expect((await mensajesDe(central[0]!.id)).map((m) => m.body)).toEqual([
        'al casino',
      ]);
      expect((await mensajesDe(deLitoral[0]!.id)).map((m) => m.body)).toEqual([
        'a Litoral',
      ]);
    });

    /** **D11**: el hilo es continuo. Dos mensajes no crean dos conversaciones. */
    it('dos mensajes del mismo número van al mismo hilo', async () => {
      const de = `54934155520${seq}1`;
      await entregar({ phoneNumberId: NUM_CENTRAL, de, texto: 'primero' });
      await entregar({ phoneNumberId: NUM_CENTRAL, de, texto: 'segundo' });

      const [c] = await contactoDe(de, null);
      expect((await mensajesDe(c!.id)).map((m) => m.body)).toEqual([
        'primero',
        'segundo',
      ]);

      const convs = (await ctx.tenantDb.execute(
        sql`SELECT count(*)::int AS n FROM crm_conversations WHERE contact_id = ${c!.id}`,
      )) as unknown as Array<{ n: number }>;
      expect(convs[0]!.n).toBe(1);
    });

    /**
     * El `wamid` es **único global**, a diferencia del `message_id` de Telegram
     * que es un contador por chat (el bug 2.6). Un reintento de Meta con el
     * mismo id no puede duplicar el mensaje.
     */
    it('un reintento con el mismo wamid no duplica nada', async () => {
      const de = `54934155530${seq}1`;
      const wamid = proximoWamid();

      await entregar({ phoneNumberId: NUM_CENTRAL, de, texto: 'una vez', wamid });
      const res = await entregar({
        phoneNumberId: NUM_CENTRAL, de, texto: 'una vez', wamid,
      });
      expect(res.status).toBe(200);

      const [c] = await contactoDe(de, null);
      expect(await mensajesDe(c!.id)).toHaveLength(1);
    });

    it('lo que no es texto se nombra en vez de quedar en blanco', async () => {
      const de = `54934155540${seq}1`;
      await entregar({ phoneNumberId: NUM_CENTRAL, de, tipo: 'voice' });

      const [c] = await contactoDe(de, null);
      const msgs = await mensajesDe(c!.id);
      expect(msgs[0]!.body).toContain('una nota de voz');
      expect(msgs[0]!.body).not.toBe('');
    });
  });

  // ── D4: el teléfono identifica al jugador, solo ──────────────────────────

  describe('D4 · el vínculo automático por teléfono', () => {
    /**
     * ⚠️ **La primera defensa.** El operador cargó al jugador como
     * `0341 15 555-1234` y Meta manda `5493415551234`. Son **el mismo número** y
     * en E.164 estricto **no matchean**: sin normalizar, el vínculo automático
     * falla justo cuando más sirve.
     */
    it('vincula solo, aunque el teléfono esté escrito distinto', async () => {
      const jugador = await createTestUser(ctx.request, adminToken, {
        suite: SUITE, label: 'd4ok', role: 'usuario_final',
      });
      await ctx.tenantDb.execute(
        sql`UPDATE users SET phone = '0341 15 555-7001' WHERE id = ${jugador.id}`,
      );

      await entregar({ phoneNumberId: NUM_CENTRAL, de: '5493415557001' });

      const [c] = await contactoDe('5493415557001', null);
      expect(c!.user_id).toBe(jugador.id);
      expect(c!.is_lead).toBe(false);
    });

    /**
     * ⚠️ **La segunda defensa, y la que más importa.** `users.phone` **no tiene
     * índice único**: dos jugadores pueden compartir número de verdad —una
     * pareja, un locutorio— o uno puede estar mal cargado. Vincular a cualquiera
     * de los dos le mostraría al operador **el nombre equivocado sin ninguna
     * señal**. Ante la duda, lead.
     */
    it('si el teléfono matchea con DOS jugadores, no vincula ninguno', async () => {
      const a = await createTestUser(ctx.request, adminToken, {
        suite: SUITE, label: 'dup-a', role: 'usuario_final',
      });
      const b = await createTestUser(ctx.request, adminToken, {
        suite: SUITE, label: 'dup-b', role: 'usuario_final',
      });
      for (const u of [a, b]) {
        await ctx.tenantDb.execute(
          sql`UPDATE users SET phone = '+5493415557002' WHERE id = ${u.id}`,
        );
      }

      await entregar({ phoneNumberId: NUM_CENTRAL, de: '5493415557002' });

      const [c] = await contactoDe('5493415557002', null);
      expect(c!.user_id).toBeNull();
      expect(c!.is_lead).toBe(true);
      // Pero el mensaje NO se perdió: quedar sin identificar no puede costar lo
      // que la persona escribió.
      expect(await mensajesDe(c!.id)).toHaveLength(1);
    });

    it('un teléfono que no es de nadie deja el contacto como lead', async () => {
      await entregar({ phoneNumberId: NUM_CENTRAL, de: '5493415557003' });

      const [c] = await contactoDe('5493415557003', null);
      expect(c!.user_id).toBeNull();
      expect(c!.is_lead).toBe(true);
    });

    /**
     * D4 se intenta **una sola vez, al crear el contacto**. Reintentarlo en cada
     * mensaje pisaría un desvínculo hecho a mano: el operador que apretó "no es
     * esta persona" (**tercera defensa**) lo vería volver solo en el mensaje
     * siguiente.
     */
    it('un desvínculo a mano no se pisa con el mensaje siguiente', async () => {
      const jugador = await createTestUser(ctx.request, adminToken, {
        suite: SUITE, label: 'd4undo', role: 'usuario_final',
      });
      await ctx.tenantDb.execute(
        sql`UPDATE users SET phone = '+5493415557004' WHERE id = ${jugador.id}`,
      );

      await entregar({ phoneNumberId: NUM_CENTRAL, de: '5493415557004' });
      const [antes] = await contactoDe('5493415557004', null);
      expect(antes!.user_id).toBe(jugador.id);

      // El operador deshace el vínculo (3.3).
      const borrado = await ctx.request
        .delete(`/tenant/chat/contacts/${antes!.id}/link`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(borrado.status).toBe(200);

      // Llega otro mensaje del mismo número.
      await entregar({ phoneNumberId: NUM_CENTRAL, de: '5493415557004' });

      const [despues] = await contactoDe('5493415557004', null);
      expect(despues!.user_id).toBeNull();
      expect(despues!.is_lead).toBe(true);
    });
  });

  // ── El crudo ─────────────────────────────────────────────────────────────

  it('el crudo queda marcado como procesado', async () => {
    const de = `54934155560${seq}1`;
    const wamid = proximoWamid();
    await entregar({ phoneNumberId: NUM_CENTRAL, de, wamid });

    const crudo = await una<{ processed_at: string | null; error: string | null }>(
      await ctx.tenantDb.execute(
        sql`SELECT processed_at, error FROM crm_raw_events WHERE external_id = ${wamid}`,
      ),
    );
    expect(crudo.processed_at).not.toBeNull();
    expect(crudo.error).toBeNull();
  });
});
