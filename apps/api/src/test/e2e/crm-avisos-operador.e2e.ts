/**
 * E2E: avisarle al operador por Telegram (**4.5**, **D25**).
 *
 * ## Qué se prueba y qué no
 *
 * **No se le pega a Telegram.** El envío se corta por env: sin
 * `TELEGRAM_BOT_TOKEN` el servicio no intenta nada. Lo que se prueba es todo lo
 * demás, que es donde están las decisiones: el código, el vínculo, quién queda
 * vinculado y el silencio entre avisos.
 *
 * ## Lo que se fija
 *
 * | | |
 * |---|---|
 * | **El código vence** | Uno eterno tirado en una captura sirve para desviar los avisos de ese operador a otro Telegram |
 * | **Se quema al usarlo** | Un código vivo después de vincular es una segunda llave a la misma puerta |
 * | **No dice por qué falla** | Distinguir "venció" de "no existe" le confirma a un desconocido que existió |
 * | **Es por persona** | Cada uno vincula su Telegram, no la bandeja |
 * | **El slug resuelve el casino** | El bot es uno solo para toda la plataforma |
 */

import { sql, eq } from 'drizzle-orm';
import { crmOperatorAlerts } from '@casino/db';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { AvisosAlOperadorService } from '../../chat/avisos-al-operador.service';

const SECRETO = 'secreto-de-avisos-jest';
const SUITE = `avisos-${Date.now().toString(36)}`;

let ctx: TestApp;
let adminToken = '';
let adminId = '';
let avisos: AvisosAlOperadorService;

async function una<T>(res: unknown): Promise<T> {
  return (res as unknown as T[])[0]!;
}

function api(metodo: 'get' | 'post' | 'delete', path: string) {
  return ctx.request[metodo](path)
    .set('Host', TEST_TENANT.host)
    .set('Authorization', adminToken);
}

/** Un `/start` como el que manda Telegram. */
function start(texto: string, chatId = 987654, secreto = SECRETO) {
  return ctx.request
    .post('/api/v1/crm/avisos/webhook')
    .set('Host', TEST_TENANT.host)
    .set('X-Telegram-Bot-Api-Secret-Token', secreto)
    .send({ message: { text: texto, chat: { id: chatId } } });
}

async function filaDe(userId: string) {
  return (
    await ctx.tenantDb
      .select()
      .from(crmOperatorAlerts)
      .where(eq(crmOperatorAlerts.userId, userId))
      .limit(1)
  )[0];
}

describe('CRM · avisos al operador (4.5)', () => {
  beforeAll(async () => {
    process.env.TELEGRAM_ALERT_WEBHOOK_SECRET = SECRETO;
    // Sin token, el servicio no le pega a Telegram: los tests no dependen de
    // una red externa y tampoco mandan mensajes de verdad a nadie.
    delete process.env.TELEGRAM_BOT_TOKEN;

    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    avisos = ctx.app.get(AvisosAlOperadorService);

    adminId = (
      await una<{ id: string }>(
        await ctx.tenantDb.execute(
          sql`SELECT id FROM users WHERE username = ${TEST_TENANT.admin.username}`,
        ),
      )
    ).id;
  }, 60_000);

  afterAll(async () => {
    await ctx.close();
  });

  describe('el código', () => {
    it('lleva el slug del casino adentro', async () => {
      const res = await api('post', '/tenant/chat/avisos/codigo');

      expect(res.status).toBe(200);
      // El bot es uno solo para toda la plataforma: sin el slug no habría forma
      // de saber de qué casino es el `/start` antes de abrir su base.
      expect(res.body.codigo.startsWith(`${TEST_TENANT.slug}-`)).toBe(true);
      expect(new Date(res.body.venceEn).getTime()).toBeGreaterThan(Date.now());
    });

    it('pedirlo de nuevo lo renueva, no falla', async () => {
      const primero = (await api('post', '/tenant/chat/avisos/codigo')).body.codigo;
      const segundo = (await api('post', '/tenant/chat/avisos/codigo')).body.codigo;

      expect(segundo).not.toBe(primero);
      // Y el viejo deja de servir.
      await start(`/start ${primero}`);
      expect((await filaDe(adminId))?.chatId).toBeNull();
    });

    it('antes de vincular, el estado dice que no', async () => {
      const res = await api('get', '/tenant/chat/avisos');
      expect(res.body).toEqual({ vinculado: false, activo: false });
    });
  });

  describe('el vínculo', () => {
    it('un /start con el código lo vincula y quema el código', async () => {
      const codigo = (await api('post', '/tenant/chat/avisos/codigo')).body.codigo;

      const res = await start(`/start ${codigo}`, 111222);
      expect(res.status).toBe(200);

      const fila = await filaDe(adminId);
      expect(fila?.chatId).toBe('111222');
      expect(fila?.linkedAt).not.toBeNull();
      // Quemado: un código vivo después de vincular es una segunda llave.
      expect(fila?.linkCode).toBeNull();

      const estado = await api('get', '/tenant/chat/avisos');
      expect(estado.body).toEqual({ vinculado: true, activo: true });
    });

    it('el mismo código no sirve dos veces', async () => {
      const codigo = (await api('post', '/tenant/chat/avisos/codigo')).body.codigo;
      await start(`/start ${codigo}`, 333444);
      await start(`/start ${codigo}`, 555666);

      // Se quedó con el primero: el segundo intento no pisó nada.
      expect((await filaDe(adminId))?.chatId).toBe('333444');
    });

    /**
     * ⚠️ Un código eterno tirado en un chat o en una captura sigue sirviendo
     * para desviar los avisos de ese operador a otro Telegram.
     */
    it('un código vencido no vincula', async () => {
      const codigo = (await api('post', '/tenant/chat/avisos/codigo')).body.codigo;
      await ctx.tenantDb
        .update(crmOperatorAlerts)
        .set({ chatId: null, linkCodeExpiresAt: new Date(Date.now() - 1000) })
        .where(eq(crmOperatorAlerts.userId, adminId));

      await start(`/start ${codigo}`, 777888);

      expect((await filaDe(adminId))?.chatId).toBeNull();
    });

    it('un código de un casino que no existe no rompe nada', async () => {
      const res = await start('/start casino-que-no-existe-ABCD1234');
      expect(res.status).toBe(200);
    });

    it('sin el secreto del webhook no se procesa', async () => {
      const codigo = (await api('post', '/tenant/chat/avisos/codigo')).body.codigo;
      await ctx.tenantDb
        .update(crmOperatorAlerts)
        .set({ chatId: null })
        .where(eq(crmOperatorAlerts.userId, adminId));

      const res = await start(`/start ${codigo}`, 999000, 'otro-secreto');

      // 200 igual —Telegram reintentaría si no— pero sin vincular.
      expect(res.status).toBe(200);
      expect((await filaDe(adminId))?.chatId).toBeNull();
    });

    it('un /start pelado o cualquier mensaje no rompe', async () => {
      expect((await start('/start')).status).toBe(200);
      expect((await start('hola')).status).toBe(200);
    });
  });

  describe('apagar', () => {
    it('corta los avisos sin desvincular', async () => {
      const codigo = (await api('post', '/tenant/chat/avisos/codigo')).body.codigo;
      await start(`/start ${codigo}`, 121212);

      await api('delete', '/tenant/chat/avisos');

      const estado = await api('get', '/tenant/chat/avisos');
      // Sigue vinculado —el Telegram es el mismo— pero no avisa.
      expect(estado.body).toEqual({ vinculado: true, activo: false });
    });
  });

  /**
   * ⚠️ **El silencio es lo que hace que el aviso sirva.** Uno por mensaje
   * convierte el Telegram del operador en ruido, y un canal que molesta se
   * silencia — y ahí el aviso deja de existir.
   */
  describe('el silencio entre avisos', () => {
    it('una conversación no avisa dos veces seguidas', async () => {
      // El vínculo se arma ANTES de espiar: el `/start` contesta con su propia
      // confirmación, y contarla acá haría parecer que el silencio no anda.
      const codigo = (await api('post', '/tenant/chat/avisos/codigo')).body.codigo;
      await start(`/start ${codigo}`, 424242);
      await ctx.tenantDb
        .update(crmOperatorAlerts)
        .set({ enabled: true })
        .where(eq(crmOperatorAlerts.userId, adminId));

      const mandados: string[] = [];
      const original = avisos.postear.bind(avisos);
      avisos.postear = async (chatId: string) => {
        mandados.push(chatId);
        return true;
      };
      process.env.TELEGRAM_BOT_TOKEN = 'token-de-jest';
      avisos.olvidarSilencio();

      try {
        const conv = `${SUITE}-conv`;
        for (let i = 0; i < 3; i++) {
          await avisos.avisar(ctx.tenantDb, {
            operadorId: adminId,
            conversationId: conv,
            deQuien: 'Juan',
            canal: 'Telegram',
          });
        }

        expect(mandados).toHaveLength(1);
      } finally {
        avisos.postear = original;
        delete process.env.TELEGRAM_BOT_TOKEN;
        avisos.olvidarSilencio();
      }
    });

    it('dos conversaciones distintas avisan las dos', async () => {
      const mandados: string[] = [];
      const original = avisos.postear.bind(avisos);
      avisos.postear = async (chatId: string) => {
        mandados.push(chatId);
        return true;
      };
      process.env.TELEGRAM_BOT_TOKEN = 'token-de-jest';
      avisos.olvidarSilencio();

      try {
        await avisos.avisar(ctx.tenantDb, {
          operadorId: adminId, conversationId: `${SUITE}-a`,
          deQuien: 'Juan', canal: 'Telegram',
        });
        await avisos.avisar(ctx.tenantDb, {
          operadorId: adminId, conversationId: `${SUITE}-b`,
          deQuien: 'Ana', canal: 'WhatsApp',
        });

        expect(mandados).toHaveLength(2);
      } finally {
        avisos.postear = original;
        delete process.env.TELEGRAM_BOT_TOKEN;
        avisos.olvidarSilencio();
      }
    });

    it('un operador sin vínculo no recibe nada', async () => {
      const mandados: string[] = [];
      const original = avisos.postear.bind(avisos);
      avisos.postear = async (chatId: string) => {
        mandados.push(chatId);
        return true;
      };
      process.env.TELEGRAM_BOT_TOKEN = 'token-de-jest';
      avisos.olvidarSilencio();

      try {
        await avisos.avisar(ctx.tenantDb, {
          operadorId: '00000000-0000-4000-8000-000000000001',
          conversationId: `${SUITE}-nadie`,
          deQuien: 'Juan', canal: 'Telegram',
        });
        expect(mandados).toHaveLength(0);
      } finally {
        avisos.postear = original;
        delete process.env.TELEGRAM_BOT_TOKEN;
        avisos.olvidarSilencio();
      }
    });
  });
});
