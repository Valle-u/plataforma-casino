/**
 * E2E: los chats sin responder del parte diario.
 *
 * ## Por qué existe este test
 *
 * `HealthReportCron` corre **una vez por día**. Un nombre de columna equivocado
 * no rompe nada visible: el bloque falla, el parte dice `(no se pudo leer)` —o
 * peor, `chats: ninguno`— y eso **se lee igual que un casino al día**. Nadie se
 * entera hasta que un jugador reclama que nunca le contestaron.
 *
 * Por eso la consulta se corre contra un Postgres **de verdad**, y se importa la
 * MISMA constante que usa el cron: si alguien la edita y rompe el SQL, esto
 * falla acá y no en producción a las 9 de la mañana.
 *
 * ## Qué fija
 *
 *   - Una conversación cuyo último mensaje es del contacto → cuenta.
 *   - Si el operador respondió después → NO cuenta.
 *   - Si está `resolved` → NO cuenta, aunque el último sea del contacto.
 *   - Los de más de 24 h se cuentan aparte, y se reporta el más viejo.
 *   - **Abrir la conversación no la saca de la cuenta.** Es el caso que motivó
 *     no usar `unread_for_operator`: ese contador se limpia al ABRIR, no al
 *     responder.
 *
 * ## Una sola conexión
 *
 * Misma lección que `two-fa.e2e.ts`: abrir una conexión por helper hacía que el
 * teardown se colgara 30 s (el `connect_timeout` por defecto de postgres.js
 * coincide con el timeout de hooks de Jest).
 */

import postgres from 'postgres';
import { getTestTenantUrl } from '../setup/db-helpers';
import {
  CONSULTA_CHATS_SIN_RESPONDER,
  renglonDeChats,
} from '../../health-report/health-report.cron';

let conexion: ReturnType<typeof postgres> | null = null;
function db() {
  conexion ??= postgres(getTestTenantUrl(), { max: 1, connect_timeout: 10 });
  return conexion;
}

interface Fila {
  total: string;
  viejos: string;
  horas: string;
}

async function contar(): Promise<Fila> {
  const filas = await db().unsafe(CONSULTA_CHATS_SIN_RESPONDER);
  return filas[0] as unknown as Fila;
}

/** Deja el tenant sin nada de CRM, para que cada test arranque de cero. */
async function limpiar(): Promise<void> {
  const sql = db();
  await sql`DELETE FROM crm_messages`;
  await sql`DELETE FROM crm_conversations`;
  await sql`DELETE FROM crm_contacts`;
  await sql`DELETE FROM crm_channels`;
}

let canalId = '';

/**
 * Crea una conversación con sus mensajes.
 *
 * `mensajes` es la secuencia en orden cronológico: cada uno con su dirección y
 * hace cuántas horas se mandó.
 */
async function conversacionCon(
  estado: 'open' | 'pending' | 'resolved',
  mensajes: Array<{ de: 'inbound' | 'outbound'; haceHoras: number }>,
): Promise<string> {
  const sql = db();
  const contacto = await sql<{ id: string }[]>`
    INSERT INTO crm_contacts (display_name, is_lead)
    VALUES ('Test', true)
    RETURNING id
  `;
  const conv = await sql<{ id: string }[]>`
    INSERT INTO crm_conversations (contact_id, channel_id, status)
    VALUES (${contacto[0]!.id}, ${canalId}, ${estado})
    RETURNING id
  `;
  const convId = conv[0]!.id;

  for (const m of mensajes) {
    await sql`
      INSERT INTO crm_messages (conversation_id, direction, body, created_at)
      VALUES (
        ${convId},
        ${m.de},
        'hola',
        now() - (${m.haceHoras} * interval '1 hour')
      )
    `;
  }
  return convId;
}

describe('parte diario · chats sin responder', () => {
  beforeAll(async () => {
    await limpiar();
    const canal = await db()<{ id: string }[]>`
      INSERT INTO crm_channels (type) VALUES ('web-livechat') RETURNING id
    `;
    canalId = canal[0]!.id;
  });

  afterAll(async () => {
    await limpiar();
    const c = conexion;
    conexion = null;
    if (c) await c.end({ timeout: 5 });
  });

  beforeEach(async () => {
    const sql = db();
    await sql`DELETE FROM crm_messages`;
    await sql`DELETE FROM crm_conversations`;
    await sql`DELETE FROM crm_contacts`;
  });

  it('sin conversaciones, no cuenta ninguna', async () => {
    const f = await contar();
    expect(Number(f.total)).toBe(0);
    expect(renglonDeChats(f)).toBe('  chats: ninguno');
  });

  it('cuenta la que quedó con el último mensaje del contacto', async () => {
    await conversacionCon('open', [{ de: 'inbound', haceHoras: 2 }]);

    const f = await contar();
    expect(Number(f.total)).toBe(1);
    expect(Number(f.viejos)).toBe(0);
    expect(renglonDeChats(f)).toBe('  chats: 1');
  });

  it('NO cuenta la que el operador ya respondió', async () => {
    await conversacionCon('open', [
      { de: 'inbound', haceHoras: 3 },
      { de: 'outbound', haceHoras: 2 },
    ]);

    expect(Number((await contar()).total)).toBe(0);
  });

  it('vuelve a contar si el contacto escribió después de la respuesta', async () => {
    await conversacionCon('open', [
      { de: 'inbound', haceHoras: 5 },
      { de: 'outbound', haceHoras: 4 },
      { de: 'inbound', haceHoras: 1 },
    ]);

    expect(Number((await contar()).total)).toBe(1);
  });

  it('NO cuenta las resueltas, aunque el último sea del contacto', async () => {
    await conversacionCon('resolved', [{ de: 'inbound', haceHoras: 2 }]);

    expect(Number((await contar()).total)).toBe(0);
  });

  it('cuenta las `pending`: alguien sigue esperando', async () => {
    await conversacionCon('pending', [{ de: 'inbound', haceHoras: 2 }]);

    expect(Number((await contar()).total)).toBe(1);
  });

  /**
   * El caso que motivó NO usar `unread_for_operator`: el contador se limpia
   * cuando el operador ABRE la conversación, no cuando contesta. Una
   * conversación leída y no respondida tiene que seguir contando.
   */
  it('sigue contando aunque el operador la haya abierto y leído', async () => {
    const id = await conversacionCon('open', [
      { de: 'inbound', haceHoras: 6 },
    ]);
    await db()`
      UPDATE crm_conversations SET unread_for_operator = 0 WHERE id = ${id}
    `;

    expect(Number((await contar()).total)).toBe(1);
  });

  it('separa las de más de 24 h y dice hace cuánto espera la más vieja', async () => {
    await conversacionCon('open', [{ de: 'inbound', haceHoras: 1 }]);
    await conversacionCon('open', [{ de: 'inbound', haceHoras: 30 }]);
    await conversacionCon('open', [{ de: 'inbound', haceHoras: 51 }]);

    const f = await contar();
    expect(Number(f.total)).toBe(3);
    expect(Number(f.viejos)).toBe(2);
    expect(Number(f.horas)).toBe(51);
    expect(renglonDeChats(f)).toBe(
      '  chats: 3 (2 con más de 24 h ⚠️ · el más viejo hace 51 h)',
    );
  });

  it('justo por debajo de las 24 h todavía no se marca', async () => {
    await conversacionCon('open', [{ de: 'inbound', haceHoras: 23 }]);

    const f = await contar();
    expect(Number(f.total)).toBe(1);
    expect(Number(f.viejos)).toBe(0);
  });

  it('una conversación sin ningún mensaje no rompe la consulta', async () => {
    await conversacionCon('open', []);

    // El LATERAL no encuentra fila, así que el CROSS JOIN la descarta. Si
    // alguna vez se cambiara a LEFT JOIN LATERAL, `direction` sería NULL y esta
    // conversación fantasma empezaría a contar.
    expect(Number((await contar()).total)).toBe(0);
  });
});
