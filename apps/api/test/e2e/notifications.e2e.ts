/**
 * E2E: Sistema de Notifications.
 *
 * Cobertura:
 *
 * Service via dispatcher:
 *   - enqueue('in_app') → status='sent' inmediato + visible en list.
 *   - enqueue('email') → status='pending' → dispatcher → status='sent'.
 *   - enqueue('email') con user sin email → dispatcher marca 'failed'.
 *   - enqueue('sms') → dispatcher marca 'failed' con error
 *     'sms_provider_not_implemented'.
 *   - Kind sin template registrado → enqueue tira.
 *
 * Endpoints user:
 *   - GET /me lista mis notifs DESC.
 *   - GET /me?onlyUnread=true filtra read.
 *   - GET /me/unread-count.
 *   - POST /me/:id/read marca read (idempotente).
 *   - POST /me/:id/read sobre otro user → 404.
 *   - POST /me/read-all marca todas in_app del user.
 *
 * Dispatcher cron / runForTenant:
 *   - kill switch: notifications.email_enabled=false → no procesa email.
 *   - Retention: purga sent/read/failed más viejas que retention.
 *
 * Hook real (welcome_bonus_blocked):
 *   - Cuando welcome es bloqueado por antifraude, el user recibe notifs
 *     in_app + email.
 */

import postgres from 'postgres';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';
import { getTestTenantUrl } from '../setup/db-helpers';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { NotificationsDispatcherCron } from '../../src/notifications/notifications-dispatcher.cron';

function freshKey(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function deleteAllNotifications(): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    await sql.unsafe(`DELETE FROM notifications`);
  } finally {
    await sql.end();
  }
}

async function deleteAllSettings(): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    await sql.unsafe(`DELETE FROM tenant_settings`);
    await sql.unsafe(`DELETE FROM tenant_settings_history`);
  } finally {
    await sql.end();
  }
}

async function deleteAllFraudLinks(): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    await sql.unsafe(`DELETE FROM fraud_account_links`);
  } finally {
    await sql.end();
  }
}

async function insertFraudLink(
  userA: string,
  userB: string,
  score: number,
  status: 'suspected' | 'confirmed' | 'dismissed' = 'confirmed',
): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  const [a, b] = userA < userB ? [userA, userB] : [userB, userA];
  try {
    await sql.unsafe(
      `INSERT INTO fraud_account_links
        (id, user_a_id, user_b_id, score, signals, status)
       VALUES (gen_random_uuid(), $1, $2, $3, '[]'::jsonb, $4)`,
      [a, b, score, status],
    );
  } finally {
    await sql.end();
  }
}

async function unsetEmail(userId: string): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    await sql.unsafe(`UPDATE users SET email = NULL WHERE id = $1`, [userId]);
  } finally {
    await sql.end();
  }
}

async function countNotificationsFor(userId: string): Promise<number> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<{ count: string }[]>`
      SELECT count(*) FROM notifications WHERE user_id = ${userId}
    `;
    return Number(rows[0]!.count);
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

describe('Notifications (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let service: NotificationsService;
  let dispatcher: NotificationsDispatcherCron;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    // Resolvemos los services del Nest container — más confiable para
    // testear lógica interna (enqueue, dispatch) que armar requests HTTP.
    service = ctx.app.get(NotificationsService);
    dispatcher = ctx.app.get(NotificationsDispatcherCron);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await deleteAllNotifications();
    await deleteAllSettings();
    await deleteAllFraudLinks();
  });

  // ──────────────────────────────────────────────────────────────────────
  // Service: enqueue + render
  // ──────────────────────────────────────────────────────────────────────

  describe('Service.enqueue', () => {
    it('in_app: status=sent inmediato + sentAt poblado', async () => {
      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-enq-inapp',
        label: 'p',
        role: 'usuario_final',
      });
      const db = ctx.tenantDb;
      const notif = await service.enqueue(db, {
        userId: u.id,
        kind: 'test_event',
        channel: 'in_app',
        payload: { title: 'Hola', message: 'cuerpo' },
      });
      expect(notif.status).toBe('sent');
      expect(notif.sentAt).toBeTruthy();
      expect(notif.subject).toBe('Test: Hola');
      expect(notif.body).toBe('cuerpo');
    });

    it('email: status=pending + sentAt=null', async () => {
      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-enq-email',
        label: 'p',
        role: 'usuario_final',
      });
      const db = ctx.tenantDb;
      const notif = await service.enqueue(db, {
        userId: u.id,
        kind: 'test_event',
        channel: 'email',
        payload: { title: 'Bienvenido', message: 'Hola mundo' },
      });
      expect(notif.status).toBe('pending');
      expect(notif.sentAt).toBeNull();
    });

    it('kind sin template registrado → tira', async () => {
      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-no-template',
        label: 'p',
        role: 'usuario_final',
      });
      const db = ctx.tenantDb;
      await expect(
        service.enqueue(db, {
          userId: u.id,
          kind: 'kind_que_no_existe',
          channel: 'in_app',
        }),
      ).rejects.toThrow(/No template registrado/);
    });

    it('subject/body renderizados al momento (snapshot)', async () => {
      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-snapshot',
        label: 'p',
        role: 'usuario_final',
      });
      const db = ctx.tenantDb;
      const notif = await service.enqueue(db, {
        userId: u.id,
        kind: 'welcome_bonus_blocked',
        channel: 'in_app',
        payload: { depositId: 'deposit-xyz' },
      });
      expect(notif.subject).toMatch(/bono de bienvenida/i);
      expect(notif.body).toContain('deposit-xyz');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Service: listForUser + countUnread + markAsRead
  // ──────────────────────────────────────────────────────────────────────

  describe('Service.listForUser + markAsRead', () => {
    it('lista DESC + countUnread + markAsRead idempotente', async () => {
      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-list',
        label: 'p',
        role: 'usuario_final',
      });
      const db = ctx.tenantDb;

      for (const i of [1, 2, 3]) {
        await service.enqueue(db, {
          userId: u.id,
          kind: 'test_event',
          channel: 'in_app',
          payload: { title: `t${i}`, message: `m${i}` },
        });
      }

      const list = await service.listForUser(db, u.id, {});
      expect(list).toHaveLength(3);
      // DESC: t3 primero.
      expect(list[0]!.subject).toBe('Test: t3');

      expect(await service.countUnreadForUser(db, u.id)).toBe(3);

      const r1 = await service.markAsRead(db, list[0]!.id, u.id);
      expect(r1.status).toBe('read');
      expect(r1.readAt).toBeTruthy();
      expect(await service.countUnreadForUser(db, u.id)).toBe(2);

      // Idempotente: re-marcar no cambia readAt.
      const r2 = await service.markAsRead(db, list[0]!.id, u.id);
      expect(r2.status).toBe('read');
      expect(r2.readAt).toEqual(r1.readAt);
    });

    it('markAsRead sobre notif de otro user → 404', async () => {
      const userA = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-cross-a',
        label: 'p',
        role: 'usuario_final',
      });
      const userB = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-cross-b',
        label: 'p',
        role: 'usuario_final',
      });
      const db = ctx.tenantDb;
      const notif = await service.enqueue(db, {
        userId: userA.id,
        kind: 'test_event',
        channel: 'in_app',
        payload: { title: 't', message: 'm' },
      });
      await expect(service.markAsRead(db, notif.id, userB.id)).rejects.toThrow(
        /no encontrada/i,
      );
    });

    it('onlyUnread filtra status=read', async () => {
      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-unread',
        label: 'p',
        role: 'usuario_final',
      });
      const db = ctx.tenantDb;
      const n1 = await service.enqueue(db, {
        userId: u.id,
        kind: 'test_event',
        channel: 'in_app',
        payload: { title: 'a', message: 'b' },
      });
      await service.enqueue(db, {
        userId: u.id,
        kind: 'test_event',
        channel: 'in_app',
        payload: { title: 'c', message: 'd' },
      });
      await service.markAsRead(db, n1.id, u.id);

      const onlyUnread = await service.listForUser(db, u.id, { onlyUnread: true });
      expect(onlyUnread).toHaveLength(1);
      expect(onlyUnread[0]!.subject).toBe('Test: c');
    });

    it('markAllAsReadForUser solo afecta in_app status=sent', async () => {
      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-readall',
        label: 'p',
        role: 'usuario_final',
      });
      const db = ctx.tenantDb;
      await service.enqueue(db, {
        userId: u.id,
        kind: 'test_event',
        channel: 'in_app',
        payload: { title: 'a', message: 'b' },
      });
      await service.enqueue(db, {
        userId: u.id,
        kind: 'test_event',
        channel: 'in_app',
        payload: { title: 'c', message: 'd' },
      });
      await service.enqueue(db, {
        userId: u.id,
        kind: 'test_event',
        channel: 'email',
        payload: { title: 'e', message: 'f' },
      });

      const updated = await service.markAllAsReadForUser(db, u.id);
      expect(updated).toBe(2);

      const rows = await readNotificationsFromDb(u.id);
      const emails = rows.filter((r) => r.channel === 'email');
      expect(emails).toHaveLength(1);
      expect(emails[0]!.status).toBe('pending');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Service: dispatch
  // ──────────────────────────────────────────────────────────────────────

  describe('Service.dispatch', () => {
    it('email pending con user con email → sent', async () => {
      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-disp-email',
        label: 'p',
        role: 'usuario_final',
      });
      // Setear email (createTestUser puede o no setearlo — forzamos).
      const sqlConn = postgres(getTestTenantUrl(), { max: 1 });
      try {
        await sqlConn.unsafe(
          `UPDATE users SET email = $1 WHERE id = $2`,
          [`${u.username}@test.local`, u.id],
        );
      } finally {
        await sqlConn.end();
      }

      const db = ctx.tenantDb;
      await service.enqueue(db, {
        userId: u.id,
        kind: 'test_event',
        channel: 'email',
        payload: { title: 'subject', message: 'body' },
      });

      const result = await service.dispatch(db, TEST_TENANT.slug);
      expect(result.processed).toBeGreaterThanOrEqual(1);
      expect(result.sent).toBeGreaterThanOrEqual(1);

      const rows = await readNotificationsFromDb(u.id);
      const email = rows.find((r) => r.channel === 'email');
      expect(email!.status).toBe('sent');
      expect(email!.sent_at).toBeTruthy();
    });

    it('email pending con user SIN email → failed con error user_has_no_email', async () => {
      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-disp-noemail',
        label: 'p',
        role: 'usuario_final',
      });
      await unsetEmail(u.id);

      const db = ctx.tenantDb;
      await service.enqueue(db, {
        userId: u.id,
        kind: 'test_event',
        channel: 'email',
        payload: { title: 's', message: 'b' },
      });
      const result = await service.dispatch(db, TEST_TENANT.slug);
      expect(result.failed).toBeGreaterThanOrEqual(1);

      const rows = await readNotificationsFromDb(u.id);
      const email = rows.find((r) => r.channel === 'email');
      expect(email!.status).toBe('failed');
      expect(email!.error).toBe('user_has_no_email');
    });

    it('sms → failed con sms_provider_not_implemented', async () => {
      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-disp-sms',
        label: 'p',
        role: 'usuario_final',
      });
      const db = ctx.tenantDb;
      await service.enqueue(db, {
        userId: u.id,
        kind: 'test_event',
        channel: 'sms',
        payload: { title: 'x', message: 'y' },
      });
      await service.dispatch(db, TEST_TENANT.slug);
      const rows = await readNotificationsFromDb(u.id);
      const sms = rows.find((r) => r.channel === 'sms');
      expect(sms!.status).toBe('failed');
      expect(sms!.error).toBe('sms_provider_not_implemented');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Endpoints user
  // ──────────────────────────────────────────────────────────────────────

  describe('Endpoints user-facing', () => {
    it('GET /me lista y POST /me/:id/read marca', async () => {
      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-ep-list',
        label: 'p',
        role: 'usuario_final',
      });
      const db = ctx.tenantDb;
      const created = await service.enqueue(db, {
        userId: u.id,
        kind: 'test_event',
        channel: 'in_app',
        payload: { title: 'hola', message: 'mundo' },
      });
      const token = await loginAs(ctx.request, u.username, u.password);

      const list = await ctx.request
        .get('/tenant/notifications/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token);
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].id).toBe(created.id);

      const count = await ctx.request
        .get('/tenant/notifications/me/unread-count')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token);
      expect(count.body.count).toBe(1);

      const mark = await ctx.request
        .post(`/tenant/notifications/me/${created.id}/read`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token);
      expect(mark.status).toBe(200);
      expect(mark.body.status).toBe('read');

      const countAfter = await ctx.request
        .get('/tenant/notifications/me/unread-count')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token);
      expect(countAfter.body.count).toBe(0);
    });

    it('GET /me?onlyUnread=true filtra read', async () => {
      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-ep-unread',
        label: 'p',
        role: 'usuario_final',
      });
      const db = ctx.tenantDb;
      const n1 = await service.enqueue(db, {
        userId: u.id,
        kind: 'test_event',
        channel: 'in_app',
        payload: { title: 'a', message: 'b' },
      });
      await service.enqueue(db, {
        userId: u.id,
        kind: 'test_event',
        channel: 'in_app',
        payload: { title: 'c', message: 'd' },
      });
      await service.markAsRead(db, n1.id, u.id);

      const token = await loginAs(ctx.request, u.username, u.password);
      const res = await ctx.request
        .get('/tenant/notifications/me?onlyUnread=true')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].subject).toBe('Test: c');
    });

    it('POST /me/:id/read sobre otra notif → 404', async () => {
      const userA = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-ep-foreign-a',
        label: 'p',
        role: 'usuario_final',
      });
      const userB = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-ep-foreign-b',
        label: 'p',
        role: 'usuario_final',
      });
      const db = ctx.tenantDb;
      const n = await service.enqueue(db, {
        userId: userA.id,
        kind: 'test_event',
        channel: 'in_app',
        payload: { title: 'a', message: 'b' },
      });
      const tokenB = await loginAs(ctx.request, userB.username, userB.password);
      const res = await ctx.request
        .post(`/tenant/notifications/me/${n.id}/read`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', tokenB);
      expect(res.status).toBe(404);
    });

    it('POST /me/read-all marca todas', async () => {
      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-ep-readall',
        label: 'p',
        role: 'usuario_final',
      });
      const db = ctx.tenantDb;
      for (const i of [1, 2, 3]) {
        await service.enqueue(db, {
          userId: u.id,
          kind: 'test_event',
          channel: 'in_app',
          payload: { title: `t${i}`, message: 'm' },
        });
      }
      const token = await loginAs(ctx.request, u.username, u.password);
      const res = await ctx.request
        .post('/tenant/notifications/me/read-all')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token);
      expect(res.status).toBe(200);
      expect(res.body.updated).toBe(3);

      expect(await service.countUnreadForUser(db, u.id)).toBe(0);
    });

    it('sin token → 401', async () => {
      const res = await ctx.request
        .get('/tenant/notifications/me')
        .set('Host', TEST_TENANT.host);
      expect(res.status).toBe(401);
    });

    it('GET con limit/offset funciona', async () => {
      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-ep-pag',
        label: 'p',
        role: 'usuario_final',
      });
      const db = ctx.tenantDb;
      for (const i of [1, 2, 3, 4, 5]) {
        await service.enqueue(db, {
          userId: u.id,
          kind: 'test_event',
          channel: 'in_app',
          payload: { title: `t${i}`, message: 'm' },
        });
      }
      const token = await loginAs(ctx.request, u.username, u.password);
      const p1 = await ctx.request
        .get('/tenant/notifications/me?limit=2&offset=0')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token);
      expect(p1.body.data).toHaveLength(2);
      expect(p1.body.data[0].subject).toBe('Test: t5');
      const p2 = await ctx.request
        .get('/tenant/notifications/me?limit=2&offset=2')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token);
      expect(p2.body.data).toHaveLength(2);
      expect(p2.body.data[0].subject).toBe('Test: t3');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Dispatcher cron / runForTenant
  // ──────────────────────────────────────────────────────────────────────

  describe('Dispatcher runForTenant', () => {
    it('email_enabled=false → no procesa pendings', async () => {
      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-disp-kill',
        label: 'p',
        role: 'usuario_final',
      });
      const sqlConn = postgres(getTestTenantUrl(), { max: 1 });
      try {
        await sqlConn.unsafe(
          `UPDATE users SET email = $1 WHERE id = $2`,
          [`${u.username}@test.local`, u.id],
        );
      } finally {
        await sqlConn.end();
      }

      await ctx.request
        .patch('/tenant/settings/notifications.email_enabled')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: false });

      const db = ctx.tenantDb;
      await service.enqueue(db, {
        userId: u.id,
        kind: 'test_event',
        channel: 'email',
        payload: { title: 't', message: 'm' },
      });

      const result = await dispatcher.runForTenant(db, TEST_TENANT.slug);
      expect(result.processed).toBe(0);
      expect(result.sent).toBe(0);

      // Sigue pending.
      const rows = await readNotificationsFromDb(u.id);
      expect(rows[0]!.status).toBe('pending');
    });

    it('retention: purga sent viejas pero conserva recientes', async () => {
      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-retention',
        label: 'p',
        role: 'usuario_final',
      });

      const sqlConn = postgres(getTestTenantUrl(), { max: 1 });
      const oldIso = new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString();
      const recentIso = new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString();
      try {
        // Notif vieja sent.
        await sqlConn.unsafe(
          `INSERT INTO notifications
            (id, user_id, kind, channel, payload, subject, body, status, created_at, sent_at)
           VALUES (gen_random_uuid(), $1, 'test_event', 'in_app', '{}'::jsonb,
                   'old subject', 'old body', 'sent', $2, $2)`,
          [u.id, oldIso],
        );
        // Notif reciente sent.
        await sqlConn.unsafe(
          `INSERT INTO notifications
            (id, user_id, kind, channel, payload, subject, body, status, created_at, sent_at)
           VALUES (gen_random_uuid(), $1, 'test_event', 'in_app', '{}'::jsonb,
                   'recent subject', 'recent body', 'sent', $2, $2)`,
          [u.id, recentIso],
        );
      } finally {
        await sqlConn.end();
      }

      expect(await countNotificationsFor(u.id)).toBe(2);

      const db = ctx.tenantDb;
      // Default retention = 180d → la vieja (400d) se purga, la nueva no.
      const result = await dispatcher.runForTenant(db, TEST_TENANT.slug);
      expect(result.purged).toBeGreaterThanOrEqual(1);

      const remaining = await readNotificationsFromDb(u.id);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.subject).toBe('recent subject');
    });

    it('retention con setting custom 7d', async () => {
      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-retention-custom',
        label: 'p',
        role: 'usuario_final',
      });

      await ctx.request
        .patch('/tenant/settings/notifications.retention_days')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 7 });

      const sqlConn = postgres(getTestTenantUrl(), { max: 1 });
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
      try {
        await sqlConn.unsafe(
          `INSERT INTO notifications
            (id, user_id, kind, channel, payload, subject, body, status, created_at, sent_at)
           VALUES (gen_random_uuid(), $1, 'test_event', 'in_app', '{}'::jsonb,
                   'older', 'b', 'sent', $2, $2)`,
          [u.id, tenDaysAgo],
        );
        await sqlConn.unsafe(
          `INSERT INTO notifications
            (id, user_id, kind, channel, payload, subject, body, status, created_at, sent_at)
           VALUES (gen_random_uuid(), $1, 'test_event', 'in_app', '{}'::jsonb,
                   'newer', 'b', 'sent', $2, $2)`,
          [u.id, twoDaysAgo],
        );
      } finally {
        await sqlConn.end();
      }

      const db = ctx.tenantDb;
      const result = await dispatcher.runForTenant(db, TEST_TENANT.slug);
      expect(result.purged).toBeGreaterThanOrEqual(1);

      const remaining = await readNotificationsFromDb(u.id);
      const subjects = remaining.map((r) => r.subject);
      expect(subjects).toContain('newer');
      expect(subjects).not.toContain('older');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Schema validation
  // ──────────────────────────────────────────────────────────────────────

  describe('Settings schema', () => {
    it('notifications.email_enabled acepta boolean', async () => {
      const res = await ctx.request
        .patch('/tenant/settings/notifications.email_enabled')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: false });
      expect(res.status).toBe(200);
    });

    it('notifications.email_enabled rechaza string → 400', async () => {
      const res = await ctx.request
        .patch('/tenant/settings/notifications.email_enabled')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 'true' });
      expect(res.status).toBe(400);
    });

    it('notifications.retention_days rechaza <7', async () => {
      const res = await ctx.request
        .patch('/tenant/settings/notifications.retention_days')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 1 });
      expect(res.status).toBe(400);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Hook real: welcome_bonus_blocked
  // ──────────────────────────────────────────────────────────────────────

  describe('Hook welcome_bonus_blocked en BonusesAutoGrant', () => {
    it('user en cluster confirmed score 95 → recibe 2 notifs (in_app + email)', async () => {
      // Setup welcome definition con minDeposit=0.
      const sqlConn = postgres(getTestTenantUrl(), { max: 1 });
      const code = `welcome_notif_${Date.now()}`;
      try {
        await sqlConn.unsafe(
          `UPDATE bonus_definitions SET status = 'archived' WHERE type = 'welcome' AND code <> $1`,
          [code],
        );
      } finally {
        await sqlConn.end();
      }
      await ctx.request
        .post('/tenant/bonus-definitions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code,
          name: 'Welcome Notif Test',
          type: 'welcome',
          status: 'active',
          config: { matchPct: 100, maxAmount: 50000, minDeposit: 0 },
        });

      // Player con cluster confirmed score 95.
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-welcome-blocked',
        label: 'p',
        role: 'usuario_final',
      });
      const phantom = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-welcome-phantom',
        label: 'p',
        role: 'usuario_final',
      });
      await insertFraudLink(player.id, phantom.id, 95, 'confirmed');

      // Payment method.
      const methodSql = postgres(getTestTenantUrl(), { max: 1 });
      let methodId: string;
      try {
        const rows = await methodSql<{ id: string }[]>`
          INSERT INTO payment_methods (id, code, name, type, config, is_active)
          VALUES (gen_random_uuid(), ${`m-${Date.now()}`}, 'm', 'bank_transfer',
                  '{"cbu":"0000"}'::jsonb, true)
          RETURNING id
        `;
        methodId = rows[0]!.id;
      } finally {
        await methodSql.end();
      }

      // Deposit + approve.
      const pToken = await loginAs(ctx.request, player.username, player.password);
      const dep = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', pToken)
        .send({
          methodId,
          amountChips: '500',
          amountFiat: '500',
          currencyFiat: 'ARS',
        });
      expect(dep.status).toBe(201);

      const approve = await ctx.request
        .post(`/tenant/deposits/${dep.body.deposit.id}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(approve.status).toBe(200);

      // Verificar notifs creadas.
      const rows = await readNotificationsFromDb(player.id);
      const kinds = rows.map((r) => r.kind);
      expect(kinds.filter((k) => k === 'welcome_bonus_blocked')).toHaveLength(2);
      const channels = rows.map((r) => r.channel).sort();
      expect(channels).toEqual(['email', 'in_app']);

      // In-app inmediatamente sent, email pending.
      const inApp = rows.find((r) => r.channel === 'in_app');
      const email = rows.find((r) => r.channel === 'email');
      expect(inApp!.status).toBe('sent');
      expect(email!.status).toBe('pending');

      // Subject incluye depositId.
      expect(inApp!.body).toContain(dep.body.deposit.id);
    });
  });
});

// Suppress unused import warning para freshKey si no se usa en este file.
void freshKey;
