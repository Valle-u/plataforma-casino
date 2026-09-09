/**
 * E2E: la migración `0113` (canales externos) se aplicó, y hace lo que dice.
 *
 * Mismo motivo que `crm-owner-migration.e2e.ts`: el journal de tenant se edita
 * **a mano**, y si el tag queda mal drizzle saltea la migración **sin decir
 * nada**. Los tests que hoy tocan el CRM pasarían igual, porque todavía nadie
 * lee estas columnas.
 *
 * Pero acá hay algo más que verificar que la columna existe: **los dos índices
 * únicos son la idempotencia del sistema**. Chequear duplicados desde el código
 * no alcanza —dos reintentos simultáneos pasan los dos el `SELECT` antes de que
 * cualquiera inserte— así que la garantía tiene que estar en la base. Este
 * archivo la prueba **insertando de verdad** y esperando que la base rechace.
 */

import postgres from 'postgres';
import { getTestTenantUrl } from '../setup/db-helpers';

let conexion: ReturnType<typeof postgres> | null = null;
function db() {
  conexion ??= postgres(getTestTenantUrl(), { max: 1, connect_timeout: 10 });
  return conexion;
}

let canalId = '';

beforeAll(async () => {
  const canal = await db()<{ id: string }[]>`
    INSERT INTO crm_channels (type) VALUES ('telegram') RETURNING id
  `;
  canalId = canal[0]!.id;
});

afterAll(async () => {
  const sql = db();
  await sql`DELETE FROM crm_raw_events WHERE channel_id = ${canalId}`;
  await sql`DELETE FROM crm_channels WHERE id = ${canalId}`;
  conexion = null;
  await sql.end({ timeout: 5 });
});

describe('migración 0113 · canales externos', () => {
  it('la tabla de eventos crudos existe con sus columnas', async () => {
    const filas = await db()<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'crm_raw_events'
       ORDER BY column_name
    `;

    expect(filas.map((f) => f.column_name)).toEqual([
      'channel_id',
      'error',
      'external_id',
      'id',
      'payload',
      'processed_at',
      'received_at',
    ]);
  });

  it('`webhook_secret` existe en los canales', async () => {
    const filas = await db()<Array<{ is_nullable: string }>>`
      SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'crm_channels'
         AND column_name = 'webhook_secret'
    `;

    expect(filas).toHaveLength(1);
    // Nullable: el canal web no tiene webhook, y un canal recién creado
    // tampoco hasta que se registra.
    expect(filas[0]!.is_nullable).toBe('YES');
  });

  // ── La idempotencia, probada contra la base ───────────────────────────────

  describe('un reintento del proveedor no puede duplicar', () => {
    /**
     * ⚠️ **El test que justifica la migración.**
     *
     * Es lo que pasa cuando Telegram reintenta: el mismo `message_id` dos
     * veces. Sin el índice, el operador ve al jugador escribiendo duplicado.
     */
    it('dos mensajes con el mismo id externo: el segundo lo rechaza la base', async () => {
      const sql = db();
      const contacto = await sql<{ id: string }[]>`
        INSERT INTO crm_contacts (display_name, is_lead)
        VALUES ('Test 0113', true) RETURNING id
      `;
      const conv = await sql<{ id: string }[]>`
        INSERT INTO crm_conversations (contact_id, channel_id)
        VALUES (${contacto[0]!.id}, ${canalId}) RETURNING id
      `;
      const convId = conv[0]!.id;
      const idExterno = `tg-${Date.now()}`;

      await sql`
        INSERT INTO crm_messages (conversation_id, direction, body, channel_message_id)
        VALUES (${convId}, 'inbound', 'hola', ${idExterno})
      `;

      await expect(
        sql`
          INSERT INTO crm_messages (conversation_id, direction, body, channel_message_id)
          VALUES (${convId}, 'inbound', 'hola', ${idExterno})
        `,
      ).rejects.toThrow(/duplicate key|unique/i);

      await sql`DELETE FROM crm_messages WHERE conversation_id = ${convId}`;
      await sql`DELETE FROM crm_conversations WHERE id = ${convId}`;
      await sql`DELETE FROM crm_contacts WHERE id = ${contacto[0]!.id}`;
    });

    /**
     * El índice es **parcial**. Los mensajes del widget web no tienen id
     * externo: si el índice no excluyera los `NULL`, el segundo mensaje del
     * livechat fallaría — o sea, se rompería el canal que ya funciona.
     */
    it('pero varios mensajes SIN id externo conviven (el widget web)', async () => {
      const sql = db();
      const contacto = await sql<{ id: string }[]>`
        INSERT INTO crm_contacts (display_name, is_lead)
        VALUES ('Test 0113 web', true) RETURNING id
      `;
      const conv = await sql<{ id: string }[]>`
        INSERT INTO crm_conversations (contact_id, channel_id)
        VALUES (${contacto[0]!.id}, ${canalId}) RETURNING id
      `;
      const convId = conv[0]!.id;

      for (const cuerpo of ['uno', 'dos', 'tres']) {
        await sql`
          INSERT INTO crm_messages (conversation_id, direction, body)
          VALUES (${convId}, 'inbound', ${cuerpo})
        `;
      }

      const cuantos = await sql<Array<{ n: string }>>`
        SELECT count(*)::text AS n FROM crm_messages
         WHERE conversation_id = ${convId}
      `;
      expect(Number(cuantos[0]!.n)).toBe(3);

      await sql`DELETE FROM crm_messages WHERE conversation_id = ${convId}`;
      await sql`DELETE FROM crm_conversations WHERE id = ${convId}`;
      await sql`DELETE FROM crm_contacts WHERE id = ${contacto[0]!.id}`;
    });

    it('el mismo id externo en OTRO canal sí se puede: son eventos distintos', async () => {
      const sql = db();
      const idExterno = `tg-mismo-${Date.now()}`;

      const otro = await sql<{ id: string }[]>`
        INSERT INTO crm_channels (type) VALUES ('telegram') RETURNING id
      `;
      await sql`
        INSERT INTO crm_raw_events (channel_id, external_id, payload)
        VALUES (${canalId}, ${idExterno}, '{}'::jsonb)
      `;
      await sql`
        INSERT INTO crm_raw_events (channel_id, external_id, payload)
        VALUES (${otro[0]!.id}, ${idExterno}, '{}'::jsonb)
      `;

      const n = await sql<Array<{ n: string }>>`
        SELECT count(*)::text AS n FROM crm_raw_events
         WHERE external_id = ${idExterno}
      `;
      expect(Number(n[0]!.n)).toBe(2);

      await sql`DELETE FROM crm_raw_events WHERE external_id = ${idExterno}`;
      await sql`DELETE FROM crm_channels WHERE id = ${otro[0]!.id}`;
    });

    it('un crudo repetido en el MISMO canal lo rechaza la base', async () => {
      const sql = db();
      const idExterno = `tg-dup-${Date.now()}`;

      await sql`
        INSERT INTO crm_raw_events (channel_id, external_id, payload)
        VALUES (${canalId}, ${idExterno}, '{}'::jsonb)
      `;
      await expect(
        sql`
          INSERT INTO crm_raw_events (channel_id, external_id, payload)
          VALUES (${canalId}, ${idExterno}, '{}'::jsonb)
        `,
      ).rejects.toThrow(/duplicate key|unique/i);

      await sql`DELETE FROM crm_raw_events WHERE external_id = ${idExterno}`;
    });
  });

  /**
   * `restrict` y no `cascade`: borrar un canal no puede llevarse la evidencia
   * de lo que pasó por él.
   */
  it('no se puede borrar un canal que tiene eventos crudos', async () => {
    const sql = db();
    const canal = await sql<{ id: string }[]>`
      INSERT INTO crm_channels (type) VALUES ('telegram') RETURNING id
    `;
    const id = canal[0]!.id;
    await sql`
      INSERT INTO crm_raw_events (channel_id, payload)
      VALUES (${id}, '{}'::jsonb)
    `;

    await expect(
      sql`DELETE FROM crm_channels WHERE id = ${id}`,
    ).rejects.toThrow(/foreign key|violates/i);

    await sql`DELETE FROM crm_raw_events WHERE channel_id = ${id}`;
    await sql`DELETE FROM crm_channels WHERE id = ${id}`;
  });
});
