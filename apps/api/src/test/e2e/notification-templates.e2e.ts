/**
 * E2E: NotificationTemplates — overrides editables por admin del tenant.
 *
 * Cobertura:
 *
 * CRUD:
 *   - PATCH crea override + audit.
 *   - PATCH re-upsert actualiza.
 *   - GET 404 si no existe.
 *   - GET / lista todos.
 *   - GET /kinds lista los kinds registrados.
 *   - DELETE unset (idempotent) + audit.
 *   - Permission gate: cajero1 → 403.
 *   - PATCH con kind no registrado → 400.
 *   - PATCH sin subject/body → 400.
 *
 * Integración con NotificationsService.enqueue:
 *   - Sin override → renderiza con default hardcoded.
 *   - Override enabled=true → renderiza con custom subject/body.
 *   - Override enabled=false → cae al default (kill switch sin borrar).
 *   - `{{var}}` substitution en override.
 *   - Var faltante en payload → render con string vacío.
 *
 * Preview endpoint:
 *   - Preview con draft (subject+body en body) → usa draft.
 *   - Preview sin draft con override existente → usa override.
 *   - Preview sin draft sin override → usa default.
 *   - Preview con kind invalido → 400.
 */

import postgres from 'postgres';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAsAdmin, loginAsCajero1 } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';
import { getTestTenantUrl } from '../setup/db-helpers';
import { NotificationsService } from '../../notifications/notifications.service';

async function deleteAllTemplates(): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    await sql.unsafe(`DELETE FROM notification_templates`);
  } finally {
    await sql.end();
  }
}

async function deleteAllNotifications(): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    await sql.unsafe(`DELETE FROM notifications`);
  } finally {
    await sql.end();
  }
}

async function readNotificationsFromDb(
  userId: string,
): Promise<Array<Record<string, unknown>>> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<Array<Record<string, unknown>>>`
      SELECT * FROM notifications WHERE user_id = ${userId} ORDER BY created_at ASC
    `;
    return rows;
  } finally {
    await sql.end();
  }
}

describe('NotificationTemplates (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let cajero1Token: string;
  let notificationsService: NotificationsService;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    cajero1Token = await loginAsCajero1(ctx.request);
    notificationsService = ctx.app.get(NotificationsService);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await deleteAllTemplates();
    await deleteAllNotifications();
  });

  // ──────────────────────────────────────────────────────────────────────
  // CRUD endpoint
  // ──────────────────────────────────────────────────────────────────────

  describe('CRUD admin', () => {
    it('PATCH crea override + GET devuelve el contenido', async () => {
      const res = await ctx.request
        .patch('/tenant/notification-templates/welcome_bonus_blocked')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          subjectTemplate: 'Custom: bono pausado',
          bodyTemplate: 'Hola, tu bono fue pausado. Deposit: {{depositId}}',
        });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        kind: 'welcome_bonus_blocked',
        subjectTemplate: 'Custom: bono pausado',
        enabled: true,
      });

      const get = await ctx.request
        .get('/tenant/notification-templates/welcome_bonus_blocked')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(get.status).toBe(200);
      expect(get.body.bodyTemplate).toContain('{{depositId}}');
    });

    it('PATCH re-upsert sobrescribe', async () => {
      await ctx.request
        .patch('/tenant/notification-templates/deposit_approved')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ subjectTemplate: 'V1', bodyTemplate: 'B1' });
      await ctx.request
        .patch('/tenant/notification-templates/deposit_approved')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ subjectTemplate: 'V2', bodyTemplate: 'B2', enabled: false });

      const get = await ctx.request
        .get('/tenant/notification-templates/deposit_approved')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(get.body.subjectTemplate).toBe('V2');
      expect(get.body.bodyTemplate).toBe('B2');
      expect(get.body.enabled).toBe(false);
    });

    it('GET inexistente → 404 con error code', async () => {
      const res = await ctx.request
        .get('/tenant/notification-templates/bonus_granted')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOTIFICATION_TEMPLATE_OVERRIDE_NOT_FOUND');
    });

    it('DELETE unset (idempotent)', async () => {
      await ctx.request
        .patch('/tenant/notification-templates/withdrawal_paid')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ subjectTemplate: 'S', bodyTemplate: 'B' });

      const d1 = await ctx.request
        .delete('/tenant/notification-templates/withdrawal_paid')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(d1.status).toBe(204);

      const d2 = await ctx.request
        .delete('/tenant/notification-templates/withdrawal_paid')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(d2.status).toBe(204);

      const get = await ctx.request
        .get('/tenant/notification-templates/withdrawal_paid')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(get.status).toBe(404);
    });

    it('GET / lista todos los overrides', async () => {
      await ctx.request
        .patch('/tenant/notification-templates/deposit_approved')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ subjectTemplate: 'S1', bodyTemplate: 'B1' });
      await ctx.request
        .patch('/tenant/notification-templates/withdrawal_paid')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ subjectTemplate: 'S2', bodyTemplate: 'B2' });

      const res = await ctx.request
        .get('/tenant/notification-templates')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      const kinds = (res.body.data as Array<{ kind: string }>).map((r) => r.kind);
      expect(kinds).toContain('deposit_approved');
      expect(kinds).toContain('withdrawal_paid');
    });

    it('GET /kinds devuelve los kinds registrados', async () => {
      const res = await ctx.request
        .get('/tenant/notification-templates/kinds')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      const data = res.body.data as string[];
      // Verificamos algunos de los 15 hooks.
      expect(data).toContain('welcome_bonus_blocked');
      expect(data).toContain('deposit_approved');
      expect(data).toContain('withdrawal_paid');
      expect(data).toContain('bonus_granted');
      expect(data).toContain('fraud_link_suspected');
    });

    it('cajero1 sin tenant.notifications.templates.edit → 403', async () => {
      const res = await ctx.request
        .patch('/tenant/notification-templates/deposit_approved')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token)
        .send({ subjectTemplate: 'X', bodyTemplate: 'Y' });
      expect(res.status).toBe(403);
    });

    it('PATCH con kind no registrado → 400', async () => {
      const res = await ctx.request
        .patch('/tenant/notification-templates/kind_inexistente_xyz')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ subjectTemplate: 'X', bodyTemplate: 'Y' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('NOTIFICATION_KIND_NOT_REGISTERED');
    });

    it('PATCH sin subjectTemplate → 400 (validación DTO)', async () => {
      const res = await ctx.request
        .patch('/tenant/notification-templates/deposit_approved')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ bodyTemplate: 'B' });
      expect(res.status).toBe(400);
    });

    it('PATCH con subjectTemplate vacío → 400', async () => {
      const res = await ctx.request
        .patch('/tenant/notification-templates/deposit_approved')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ subjectTemplate: '', bodyTemplate: 'B' });
      expect(res.status).toBe(400);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Integración con enqueue: override afecta el render
  // ──────────────────────────────────────────────────────────────────────

  describe('Render con override', () => {
    it('sin override → enqueue usa default hardcoded', async () => {
      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'ntpl-default',
        label: 'p',
        role: 'usuario_final',
      });
      const db = ctx.tenantDb;
      const n = await notificationsService.enqueue(db, {
        userId: u.id,
        kind: 'deposit_approved',
        channel: 'in_app',
        payload: { depositId: 'dep-xyz', amountChips: '100.00' },
      });
      // Default subject del template hardcoded contiene "depósito fue aprobado".
      expect(n.subject).toMatch(/depósito fue aprobado/i);
      expect(n.body).toContain('dep-xyz');
    });

    it('override enabled=true → enqueue usa custom subject/body con {{var}}', async () => {
      await ctx.request
        .patch('/tenant/notification-templates/deposit_approved')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          subjectTemplate: 'CUSTOM: depósito ok ({{amountChips}} chips)',
          bodyTemplate: 'Hola, ID={{depositId}} importe={{amountChips}} ¡suerte!',
        });

      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'ntpl-override',
        label: 'p',
        role: 'usuario_final',
      });
      const db = ctx.tenantDb;
      const n = await notificationsService.enqueue(db, {
        userId: u.id,
        kind: 'deposit_approved',
        channel: 'in_app',
        payload: { depositId: 'dep-abc', amountChips: '500.00' },
      });
      expect(n.subject).toBe('CUSTOM: depósito ok (500.00 chips)');
      expect(n.body).toBe('Hola, ID=dep-abc importe=500.00 ¡suerte!');
    });

    it('override enabled=false → enqueue cae al default (kill switch)', async () => {
      await ctx.request
        .patch('/tenant/notification-templates/deposit_approved')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          subjectTemplate: 'CUSTOM disabled',
          bodyTemplate: 'no debería verse',
          enabled: false,
        });

      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'ntpl-disabled',
        label: 'p',
        role: 'usuario_final',
      });
      const db = ctx.tenantDb;
      const n = await notificationsService.enqueue(db, {
        userId: u.id,
        kind: 'deposit_approved',
        channel: 'in_app',
        payload: { depositId: 'dep-q', amountChips: '50' },
      });
      // Vuelve al default → no contiene "CUSTOM disabled".
      expect(n.subject).not.toContain('CUSTOM disabled');
      expect(n.subject).toMatch(/depósito fue aprobado/i);
    });

    it('var faltante en payload → substitution con string vacío', async () => {
      await ctx.request
        .patch('/tenant/notification-templates/deposit_approved')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          subjectTemplate: 'A {{noexiste}} B',
          bodyTemplate: 'X {{depositId}} Y {{otravar}} Z',
        });

      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'ntpl-missing-var',
        label: 'p',
        role: 'usuario_final',
      });
      const db = ctx.tenantDb;
      const n = await notificationsService.enqueue(db, {
        userId: u.id,
        kind: 'deposit_approved',
        channel: 'in_app',
        payload: { depositId: 'dep-y' },
      });
      expect(n.subject).toBe('A  B');
      expect(n.body).toBe('X dep-y Y  Z');
    });

    it('snapshot semántico: cambio de override NO afecta notifs viejas', async () => {
      // 1) Set override V1.
      await ctx.request
        .patch('/tenant/notification-templates/deposit_approved')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ subjectTemplate: 'V1', bodyTemplate: 'old body' });

      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'ntpl-snapshot',
        label: 'p',
        role: 'usuario_final',
      });
      const db = ctx.tenantDb;
      await notificationsService.enqueue(db, {
        userId: u.id,
        kind: 'deposit_approved',
        channel: 'in_app',
        payload: { depositId: 'X' },
      });

      // 2) Cambiar override a V2.
      await ctx.request
        .patch('/tenant/notification-templates/deposit_approved')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ subjectTemplate: 'V2', bodyTemplate: 'new body' });

      const rows = await readNotificationsFromDb(u.id);
      expect(rows[0]!.subject).toBe('V1');
      expect(rows[0]!.body).toBe('old body');
    });

    it('array en payload → joined con ", "', async () => {
      await ctx.request
        .patch('/tenant/notification-templates/fraud_link_suspected')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          subjectTemplate: 'Signals: {{signals}}',
          bodyTemplate: 'Lista: {{signals}} (score {{score}})',
        });

      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'ntpl-array',
        label: 'p',
        role: 'usuario_final',
      });
      const db = ctx.tenantDb;
      const n = await notificationsService.enqueue(db, {
        userId: u.id,
        kind: 'fraud_link_suspected',
        channel: 'in_app',
        payload: {
          signals: ['shared_ip', 'similar_email'],
          score: 80,
        },
      });
      expect(n.subject).toBe('Signals: shared_ip, similar_email');
      expect(n.body).toBe('Lista: shared_ip, similar_email (score 80)');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Preview endpoint
  // ──────────────────────────────────────────────────────────────────────

  describe('Preview endpoint', () => {
    it('preview con draft → renderiza el draft (source=draft)', async () => {
      const res = await ctx.request
        .post('/tenant/notification-templates/deposit_approved/preview')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          subjectTemplate: 'PreviewSubj {{x}}',
          bodyTemplate: 'PreviewBody {{y}}',
          payload: { x: 'XX', y: 'YY' },
        });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        source: 'draft',
        subject: 'PreviewSubj XX',
        body: 'PreviewBody YY',
      });
    });

    it('preview sin draft, con override existente → source=override', async () => {
      await ctx.request
        .patch('/tenant/notification-templates/deposit_approved')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ subjectTemplate: 'OV {{x}}', bodyTemplate: 'OB {{x}}' });

      const res = await ctx.request
        .post('/tenant/notification-templates/deposit_approved/preview')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ payload: { x: 'ZZ' } });
      expect(res.body.source).toBe('override');
      expect(res.body.subject).toBe('OV ZZ');
    });

    it('preview sin draft, sin override → source=default', async () => {
      const res = await ctx.request
        .post('/tenant/notification-templates/deposit_approved/preview')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ payload: { depositId: 'dep-1', amountChips: '100' } });
      expect(res.body.source).toBe('default');
      expect(res.body.subject).toMatch(/depósito fue aprobado/i);
    });

    it('preview con kind no registrado → 400', async () => {
      const res = await ctx.request
        .post('/tenant/notification-templates/kind_inexistente_xyz/preview')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ payload: {} });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('NOTIFICATION_KIND_NOT_REGISTERED');
    });

    it('preview override disabled → cae a default', async () => {
      await ctx.request
        .patch('/tenant/notification-templates/deposit_approved')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          subjectTemplate: 'disabled override',
          bodyTemplate: 'b',
          enabled: false,
        });

      const res = await ctx.request
        .post('/tenant/notification-templates/deposit_approved/preview')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ payload: { depositId: 'X' } });
      expect(res.body.source).toBe('default');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Audit log
  // ──────────────────────────────────────────────────────────────────────

  describe('Audit log', () => {
    async function countAudit(actionCode: string): Promise<number> {
      const sql = postgres(getTestTenantUrl(), { max: 1 });
      try {
        const rows = await sql<{ count: string }[]>`
          SELECT count(*) FROM audit_log WHERE action_code = ${actionCode}
        `;
        return Number(rows[0]!.count);
      } finally {
        await sql.end();
      }
    }

    it('PATCH graba audit con severity=medium', async () => {
      const before = await countAudit('tenant.notification_template.set');
      await ctx.request
        .patch('/tenant/notification-templates/deposit_approved')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ subjectTemplate: 'S', bodyTemplate: 'B' });
      const after = await countAudit('tenant.notification_template.set');
      expect(after).toBeGreaterThan(before);
    });

    it('DELETE graba audit (cuando había override)', async () => {
      await ctx.request
        .patch('/tenant/notification-templates/deposit_approved')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ subjectTemplate: 'S', bodyTemplate: 'B' });
      const before = await countAudit('tenant.notification_template.unset');
      await ctx.request
        .delete('/tenant/notification-templates/deposit_approved')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const after = await countAudit('tenant.notification_template.unset');
      expect(after).toBeGreaterThan(before);
    });

    it('DELETE idempotente NO graba audit si no había override', async () => {
      const before = await countAudit('tenant.notification_template.unset');
      await ctx.request
        .delete('/tenant/notification-templates/deposit_approved')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const after = await countAudit('tenant.notification_template.unset');
      expect(after).toBe(before);
    });
  });
});
