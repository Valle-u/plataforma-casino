/**
 * E2E: Sistema de Notifications.
 *
 * Cobertura:
 *
 * Service via dispatcher:
 *   - enqueue('in_app') → status='sent' inmediato + visible en list.
 *   - enqueue('email') → status='pending' → dispatcher → status='sent'.
 *   - enqueue('email') con user sin email → dispatcher marca 'failed'.
 *   - enqueue('sms') con user con phone → dispatcher llama provider → sent.
 *   - enqueue('sms') con user sin phone → dispatcher marca 'failed'.
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
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationsDispatcherCron } from '../../notifications/notifications-dispatcher.cron';

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

    // Mint para fondear bonos en los tests que graban bonos manuales
    // (bonus_expired, bonus_cancelled). El admin actúa como funder.
    await ctx.request
      .post('/tenant/wallet/mint')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .set('Idempotency-Key', freshKey('mint-notifs'))
      .send({ amount: '500000', reason: 'mint inicial para tests de notifications' });
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

    it('sms con user con phone → sent (ConsoleSmsProvider en tests)', async () => {
      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-disp-sms-ok',
        label: 'p',
        role: 'usuario_final',
      });
      // Setear phone al user.
      const sqlConn = postgres(getTestTenantUrl(), { max: 1 });
      try {
        await sqlConn.unsafe(`UPDATE users SET phone = $1 WHERE id = $2`, [
          '+5491133334444',
          u.id,
        ]);
      } finally {
        await sqlConn.end();
      }

      const db = ctx.tenantDb;
      await service.enqueue(db, {
        userId: u.id,
        kind: 'test_event',
        channel: 'sms',
        payload: { title: 'x', message: 'y' },
      });
      const result = await service.dispatch(db, TEST_TENANT.slug);
      expect(result.sent).toBeGreaterThanOrEqual(1);

      const rows = await readNotificationsFromDb(u.id);
      const sms = rows.find((r) => r.channel === 'sms');
      expect(sms!.status).toBe('sent');
      expect(sms!.sent_at).toBeTruthy();
    });

    it('sms con user SIN phone → failed con user_has_no_phone', async () => {
      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-disp-sms-nop',
        label: 'p',
        role: 'usuario_final',
      });
      // El user de createTestUser viene sin phone — no seteamos nada.
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
      expect(sms!.error).toBe('user_has_no_phone');
    });

    it('skipChannels=[sms] → SMS NO se procesa, email sí', async () => {
      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-skip-sms',
        label: 'p',
        role: 'usuario_final',
      });
      const sqlConn = postgres(getTestTenantUrl(), { max: 1 });
      try {
        await sqlConn.unsafe(
          `UPDATE users SET phone = $1, email = $2 WHERE id = $3`,
          ['+5491133334444', `${u.username}@test.local`, u.id],
        );
      } finally {
        await sqlConn.end();
      }

      const db = ctx.tenantDb;
      await service.enqueue(db, {
        userId: u.id,
        kind: 'test_event',
        channel: 'sms',
        payload: { title: 'a', message: 'b' },
      });
      await service.enqueue(db, {
        userId: u.id,
        kind: 'test_event',
        channel: 'email',
        payload: { title: 'c', message: 'd' },
      });

      const result = await service.dispatch(db, TEST_TENANT.slug, 100, {
        skipChannels: ['sms'],
      });
      // Email sí se procesa (sent o failed). SMS queda pending.
      expect(result.processed).toBe(1);

      const rows = await readNotificationsFromDb(u.id);
      const sms = rows.find((r) => r.channel === 'sms');
      const email = rows.find((r) => r.channel === 'email');
      expect(sms!.status).toBe('pending');
      expect(email!.status).toBe('sent');
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

    it('sms_enabled=false → no procesa SMS (queda pending para retry)', async () => {
      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-disp-kill-sms',
        label: 'p',
        role: 'usuario_final',
      });
      const sqlConn = postgres(getTestTenantUrl(), { max: 1 });
      try {
        await sqlConn.unsafe(
          `UPDATE users SET phone = $1 WHERE id = $2`,
          ['+5491133334444', u.id],
        );
      } finally {
        await sqlConn.end();
      }

      await ctx.request
        .patch('/tenant/settings/notifications.sms_enabled')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: false });

      const db = ctx.tenantDb;
      await service.enqueue(db, {
        userId: u.id,
        kind: 'test_event',
        channel: 'sms',
        payload: { title: 't', message: 'm' },
      });

      const result = await dispatcher.runForTenant(db, TEST_TENANT.slug);
      expect(result.processed).toBe(0);

      const rows = await readNotificationsFromDb(u.id);
      const sms = rows.find((r) => r.channel === 'sms');
      expect(sms!.status).toBe('pending');
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

    it('notifications.sms_enabled acepta boolean', async () => {
      const res = await ctx.request
        .patch('/tenant/settings/notifications.sms_enabled')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: false });
      expect(res.status).toBe(200);
    });

    it('notifications.sms_enabled rechaza string → 400', async () => {
      const res = await ctx.request
        .patch('/tenant/settings/notifications.sms_enabled')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 'yes' });
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

      // Verificar notifs creadas. Filtramos por kind porque el deposit
      // approve también dispara `deposit_approved` (hooks adicionales).
      const rows = await readNotificationsFromDb(player.id);
      const blocked = rows.filter((r) => r.kind === 'welcome_bonus_blocked');
      expect(blocked).toHaveLength(2);
      const channels = blocked.map((r) => r.channel).sort();
      expect(channels).toEqual(['email', 'in_app']);

      // In-app inmediatamente sent, email pending.
      const inApp = blocked.find((r) => r.channel === 'in_app');
      const email = blocked.find((r) => r.channel === 'email');
      expect(inApp!.status).toBe('sent');
      expect(email!.status).toBe('pending');

      // Subject incluye depositId.
      expect(inApp!.body).toContain(dep.body.deposit.id);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Hooks adicionales: deposit_approved, withdrawal_paid, fraud_cluster_confirmed
  // ──────────────────────────────────────────────────────────────────────

  describe('Hook deposit_approved en DepositsController.approve', () => {
    it('approve deposit sin antifraude → user recibe in_app + email', async () => {
      // Archive welcome para que el flow no se confunda con welcome_blocked.
      const sqlConn = postgres(getTestTenantUrl(), { max: 1 });
      try {
        await sqlConn.unsafe(
          `UPDATE bonus_definitions SET status = 'archived' WHERE type = 'welcome'`,
        );
      } finally {
        await sqlConn.end();
      }

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-deposit-approved',
        label: 'p',
        role: 'usuario_final',
      });
      // Payment method.
      const ms = postgres(getTestTenantUrl(), { max: 1 });
      let methodId: string;
      try {
        const rows = await ms<{ id: string }[]>`
          INSERT INTO payment_methods (id, code, name, type, config, is_active)
          VALUES (gen_random_uuid(), ${`m-${Date.now()}`}, 'm', 'bank_transfer',
                  '{"cbu":"0000"}'::jsonb, true)
          RETURNING id
        `;
        methodId = rows[0]!.id;
      } finally {
        await ms.end();
      }

      const pToken = await loginAs(ctx.request, player.username, player.password);
      const dep = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', pToken)
        .send({
          methodId,
          amountChips: '750.50',
          amountFiat: '750.50',
          currencyFiat: 'ARS',
        });
      expect(dep.status).toBe(201);

      const approve = await ctx.request
        .post(`/tenant/deposits/${dep.body.deposit.id}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(approve.status).toBe(200);

      const rows = await readNotificationsFromDb(player.id);
      const approvedNotifs = rows.filter((r) => r.kind === 'deposit_approved');
      expect(approvedNotifs).toHaveLength(2);
      const channels = approvedNotifs.map((r) => r.channel).sort();
      expect(channels).toEqual(['email', 'in_app']);

      // Subject incluye el deposit id y monto.
      const inApp = approvedNotifs.find((r) => r.channel === 'in_app');
      expect(inApp!.body).toContain(dep.body.deposit.id);
      expect(inApp!.body).toContain('750.50');
      expect(inApp!.status).toBe('sent');
    });

    it('approve idempotente (re-approve) NO duplica notifs', async () => {
      const sqlConn = postgres(getTestTenantUrl(), { max: 1 });
      try {
        await sqlConn.unsafe(
          `UPDATE bonus_definitions SET status = 'archived' WHERE type = 'welcome'`,
        );
      } finally {
        await sqlConn.end();
      }

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-deposit-idem',
        label: 'p',
        role: 'usuario_final',
      });
      const ms = postgres(getTestTenantUrl(), { max: 1 });
      let methodId: string;
      try {
        const rows = await ms<{ id: string }[]>`
          INSERT INTO payment_methods (id, code, name, type, config, is_active)
          VALUES (gen_random_uuid(), ${`m-${Date.now()}-idem`}, 'm', 'bank_transfer',
                  '{"cbu":"0000"}'::jsonb, true)
          RETURNING id
        `;
        methodId = rows[0]!.id;
      } finally {
        await ms.end();
      }
      const pToken = await loginAs(ctx.request, player.username, player.password);
      const dep = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', pToken)
        .send({
          methodId,
          amountChips: '100',
          amountFiat: '100',
          currencyFiat: 'ARS',
        });
      const depositId = dep.body.deposit.id;

      // Primer approve.
      await ctx.request
        .post(`/tenant/deposits/${depositId}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      // Segundo approve (idempotent — status ya cambió).
      await ctx.request
        .post(`/tenant/deposits/${depositId}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      const rows = await readNotificationsFromDb(player.id);
      const approved = rows.filter((r) => r.kind === 'deposit_approved');
      // Solo 2 (un par in_app/email del primer approve).
      expect(approved).toHaveLength(2);
    });
  });

  describe('Hook withdrawal_paid en WithdrawalsController.markPaid', () => {
    it('mark-paid → user recibe in_app + email con monto + externalRef', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-withd-paid',
        label: 'p',
        role: 'usuario_final',
      });

      // Mint para el wallet del player para que tenga saldo.
      const ms = postgres(getTestTenantUrl(), { max: 1 });
      let methodId: string;
      try {
        const rows = await ms<{ id: string }[]>`
          INSERT INTO payment_methods (id, code, name, type, config, is_active)
          VALUES (gen_random_uuid(), ${`m-${Date.now()}-w`}, 'm', 'bank_transfer',
                  '{"cbu":"0000"}'::jsonb, true)
          RETURNING id
        `;
        methodId = rows[0]!.id;
      } finally {
        await ms.end();
      }

      // Player necesita saldo. Hacemos un deposit + approve para fondear.
      const pToken = await loginAs(ctx.request, player.username, player.password);
      const dep = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', pToken)
        .send({ methodId, amountChips: '500', amountFiat: '500', currencyFiat: 'ARS' });
      await ctx.request
        .post(`/tenant/deposits/${dep.body.deposit.id}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      // Limpiar notifs del deposit approve para asertos limpios.
      const cleanSql = postgres(getTestTenantUrl(), { max: 1 });
      try {
        await cleanSql.unsafe(`DELETE FROM notifications WHERE user_id = $1`, [player.id]);
      } finally {
        await cleanSql.end();
      }

      // Withdrawal request + approve + markPaid.
      const wd = await ctx.request
        .post('/tenant/withdrawals')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', pToken)
        .send({
          methodId,
          amountChips: '200',
          amountFiat: '200',
          currencyFiat: 'ARS',
          targetAccount: { cbu: '0000000000000000000000' },
        });
      expect(wd.status).toBe(201);
      const wdId = wd.body.withdrawal.id;

      await ctx.request
        .post(`/tenant/withdrawals/${wdId}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      const paid = await ctx.request
        .post(`/tenant/withdrawals/${wdId}/mark-paid`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ externalRef: 'BANK-REF-ABC123' });
      expect(paid.status).toBe(200);

      const rows = await readNotificationsFromDb(player.id);
      const paidNotifs = rows.filter((r) => r.kind === 'withdrawal_paid');
      expect(paidNotifs).toHaveLength(2);
      const inApp = paidNotifs.find((r) => r.channel === 'in_app');
      expect(inApp!.body).toContain(wdId);
      expect(inApp!.body).toContain('200');
      expect(inApp!.body).toContain('BANK-REF-ABC123');
    });
  });

  describe('Hook fraud_cluster_confirmed en FraudController.confirm', () => {
    it('confirm link → admins (excluyendo actor) reciben in_app + email', async () => {
      // Crear un segundo admin para verificar que reciba la notif.
      const otherAdmin = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-fraud-admin2',
        label: 'a',
        role: 'admin_tenant',
      });

      // Crear 2 players y un link entre ellos.
      const pA = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-fraud-pA',
        label: 'p',
        role: 'usuario_final',
      });
      const pB = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-fraud-pB',
        label: 'p',
        role: 'usuario_final',
      });

      const sqlConn = postgres(getTestTenantUrl(), { max: 1 });
      const [a, b] = pA.id < pB.id ? [pA.id, pB.id] : [pB.id, pA.id];
      let linkId: string;
      try {
        const rows = await sqlConn<{ id: string }[]>`
          INSERT INTO fraud_account_links
            (id, user_a_id, user_b_id, score, signals, status)
          VALUES (gen_random_uuid(), ${a}, ${b}, 85, '[]'::jsonb, 'suspected')
          RETURNING id
        `;
        linkId = rows[0]!.id;
      } finally {
        await sqlConn.end();
      }

      // Admin actor confirma el link.
      const res = await ctx.request
        .post(`/tenant/fraud/links/${linkId}/confirm`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);

      // otherAdmin recibe 2 notifs (in_app + email).
      const otherRows = await readNotificationsFromDb(otherAdmin.id);
      const confirmed = otherRows.filter((r) => r.kind === 'fraud_cluster_confirmed');
      expect(confirmed).toHaveLength(2);

      const inApp = confirmed.find((r) => r.channel === 'in_app');
      // Body incluye usernames y score.
      expect(inApp!.body).toContain(pA.username);
      expect(inApp!.body).toContain(pB.username);
      expect(inApp!.body).toContain('85');

      // El actor (admin_tenant que confirmó) NO recibe la notif (excluded).
      // Buscar al admin_tenant del seed (jest_admin) y verificar 0 notifs.
      const seedAdminSql = postgres(getTestTenantUrl(), { max: 1 });
      let seedAdminId: string;
      try {
        const rows = await seedAdminSql<{ id: string }[]>`
          SELECT id FROM users WHERE username = ${TEST_TENANT.admin.username}
        `;
        seedAdminId = rows[0]!.id;
      } finally {
        await seedAdminSql.end();
      }
      const actorRows = await readNotificationsFromDb(seedAdminId);
      const actorConfirmed = actorRows.filter(
        (r) => r.kind === 'fraud_cluster_confirmed',
      );
      expect(actorConfirmed).toHaveLength(0);
    });

    it('confirm sin otros admins distintos al actor → 200 sin notif (excluyendo al actor)', async () => {
      // Solo el admin del seed existe (jest_admin). Confirmar un link
      // debería NO crear notifs para nadie (excluido por excludeUserId),
      // pero el endpoint debe responder 200.
      const pA = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-fraud-solo-a',
        label: 'p',
        role: 'usuario_final',
      });
      const pB = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-fraud-solo-b',
        label: 'p',
        role: 'usuario_final',
      });

      const sqlConn = postgres(getTestTenantUrl(), { max: 1 });
      const [a, b] = pA.id < pB.id ? [pA.id, pB.id] : [pB.id, pA.id];
      let linkId: string;
      try {
        const rows = await sqlConn<{ id: string }[]>`
          INSERT INTO fraud_account_links
            (id, user_a_id, user_b_id, score, signals, status)
          VALUES (gen_random_uuid(), ${a}, ${b}, 75, '[]'::jsonb, 'suspected')
          RETURNING id
        `;
        linkId = rows[0]!.id;
      } finally {
        await sqlConn.end();
      }

      const res = await ctx.request
        .post(`/tenant/fraud/links/${linkId}/confirm`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      // Sin admins distintos al actor → ningún row de notification para
      // los players ni el actor.
      const aRows = await readNotificationsFromDb(pA.id);
      const bRows = await readNotificationsFromDb(pB.id);
      expect(aRows.filter((r) => r.kind === 'fraud_cluster_confirmed')).toHaveLength(0);
      expect(bRows.filter((r) => r.kind === 'fraud_cluster_confirmed')).toHaveLength(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Hooks de rechazo / falla / expiración / cancelación
  // ──────────────────────────────────────────────────────────────────────

  describe('Hook deposit_rejected en DepositsController.reject', () => {
    it('reject deposit → user recibe in_app + email con motivo', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-dep-rej',
        label: 'p',
        role: 'usuario_final',
      });
      const ms = postgres(getTestTenantUrl(), { max: 1 });
      let methodId: string;
      try {
        const rows = await ms<{ id: string }[]>`
          INSERT INTO payment_methods (id, code, name, type, config, is_active)
          VALUES (gen_random_uuid(), ${`m-${Date.now()}-dr`}, 'm', 'bank_transfer',
                  '{"cbu":"0000"}'::jsonb, true)
          RETURNING id
        `;
        methodId = rows[0]!.id;
      } finally {
        await ms.end();
      }
      const pToken = await loginAs(ctx.request, player.username, player.password);
      const dep = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', pToken)
        .send({ methodId, amountChips: '300', amountFiat: '300', currencyFiat: 'ARS' });

      const reason = 'Comprobante ilegible — reenviá foto clara.';
      const rej = await ctx.request
        .post(`/tenant/deposits/${dep.body.deposit.id}/reject`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ reason });
      expect(rej.status).toBe(200);

      const rows = await readNotificationsFromDb(player.id);
      const rejected = rows.filter((r) => r.kind === 'deposit_rejected');
      expect(rejected).toHaveLength(2);
      const inApp = rejected.find((r) => r.channel === 'in_app');
      expect(inApp!.body).toContain(dep.body.deposit.id);
      expect(inApp!.body).toContain(reason);
    });
  });

  describe('Hook withdrawal_rejected en WithdrawalsController.reject', () => {
    it('reject withdrawal → user recibe in_app + email + motivo', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-wd-rej',
        label: 'p',
        role: 'usuario_final',
      });
      const ms = postgres(getTestTenantUrl(), { max: 1 });
      let methodId: string;
      try {
        const rows = await ms<{ id: string }[]>`
          INSERT INTO payment_methods (id, code, name, type, config, is_active)
          VALUES (gen_random_uuid(), ${`m-${Date.now()}-wr`}, 'm', 'bank_transfer',
                  '{"cbu":"0000"}'::jsonb, true)
          RETURNING id
        `;
        methodId = rows[0]!.id;
      } finally {
        await ms.end();
      }

      // Fondear via deposit + approve.
      const pToken = await loginAs(ctx.request, player.username, player.password);
      const dep = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', pToken)
        .send({ methodId, amountChips: '500', amountFiat: '500', currencyFiat: 'ARS' });
      await ctx.request
        .post(`/tenant/deposits/${dep.body.deposit.id}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      // Limpiar notifs del deposit approve.
      const cleanSql = postgres(getTestTenantUrl(), { max: 1 });
      try {
        await cleanSql.unsafe(`DELETE FROM notifications WHERE user_id = $1`, [player.id]);
      } finally {
        await cleanSql.end();
      }

      const wd = await ctx.request
        .post('/tenant/withdrawals')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', pToken)
        .send({
          methodId,
          amountChips: '150',
          amountFiat: '150',
          currencyFiat: 'ARS',
          targetAccount: { cbu: '0000000000000000000000' },
        });
      const wdId = wd.body.withdrawal.id;

      const reason = 'CBU no coincide con el titular del depósito.';
      const rej = await ctx.request
        .post(`/tenant/withdrawals/${wdId}/reject`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ reason });
      expect(rej.status).toBe(200);

      const rows = await readNotificationsFromDb(player.id);
      const rejected = rows.filter((r) => r.kind === 'withdrawal_rejected');
      expect(rejected).toHaveLength(2);
      const inApp = rejected.find((r) => r.channel === 'in_app');
      expect(inApp!.body).toContain(wdId);
      expect(inApp!.body).toContain(reason);
    });
  });

  describe('Hook withdrawal_failed en WithdrawalsController.markFailed', () => {
    it('mark-failed después de approve → user recibe in_app + email', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-wd-fail',
        label: 'p',
        role: 'usuario_final',
      });
      const ms = postgres(getTestTenantUrl(), { max: 1 });
      let methodId: string;
      try {
        const rows = await ms<{ id: string }[]>`
          INSERT INTO payment_methods (id, code, name, type, config, is_active)
          VALUES (gen_random_uuid(), ${`m-${Date.now()}-wf`}, 'm', 'bank_transfer',
                  '{"cbu":"0000"}'::jsonb, true)
          RETURNING id
        `;
        methodId = rows[0]!.id;
      } finally {
        await ms.end();
      }
      const pToken = await loginAs(ctx.request, player.username, player.password);
      const dep = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', pToken)
        .send({ methodId, amountChips: '500', amountFiat: '500', currencyFiat: 'ARS' });
      await ctx.request
        .post(`/tenant/deposits/${dep.body.deposit.id}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const cleanSql = postgres(getTestTenantUrl(), { max: 1 });
      try {
        await cleanSql.unsafe(`DELETE FROM notifications WHERE user_id = $1`, [player.id]);
      } finally {
        await cleanSql.end();
      }

      const wd = await ctx.request
        .post('/tenant/withdrawals')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', pToken)
        .send({
          methodId,
          amountChips: '100',
          amountFiat: '100',
          currencyFiat: 'ARS',
          targetAccount: { cbu: '0000000000000000000000' },
        });
      const wdId = wd.body.withdrawal.id;

      await ctx.request
        .post(`/tenant/withdrawals/${wdId}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      const reason = 'Error del banco intermediario — código E-503.';
      const failed = await ctx.request
        .post(`/tenant/withdrawals/${wdId}/mark-failed`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ reason });
      expect(failed.status).toBe(200);

      const rows = await readNotificationsFromDb(player.id);
      const failedNotifs = rows.filter((r) => r.kind === 'withdrawal_failed');
      expect(failedNotifs).toHaveLength(2);
      const inApp = failedNotifs.find((r) => r.channel === 'in_app');
      expect(inApp!.body).toContain(wdId);
      expect(inApp!.body).toContain(reason);
    });
  });

  describe('Hook bonus_expired en BonusesExpirationService', () => {
    it('expire job procesa bono vencido → user recibe in_app + email', async () => {
      // Crear definition + bono activo + forzar expires_at en el pasado +
      // disparar /tenant/bonuses/jobs/expire.
      const sqlConn = postgres(getTestTenantUrl(), { max: 1 });
      try {
        await sqlConn.unsafe(
          `UPDATE bonus_definitions SET status = 'archived' WHERE type = 'reload'`,
        );
      } finally {
        await sqlConn.end();
      }
      const defRes = await ctx.request
        .post('/tenant/bonus-definitions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code: `reload_exp_${Date.now()}`,
          name: 'Reload Exp Test',
          type: 'reload',
          status: 'active',
          config: { matchPct: 100, maxAmount: 50000, minDeposit: 0 },
        });
      expect(defRes.status).toBe(201);
      const definitionId = defRes.body.id;

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-bonus-exp',
        label: 'p',
        role: 'usuario_final',
      });

      // Grant manual.
      const grant = await ctx.request
        .post('/tenant/bonuses/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', `grant-exp-${Date.now()}`)
        .send({
          userId: player.id,
          definitionId,
          amount: '50',
          reason: 'grant para test de bonus_expired notif',
        });
      expect(grant.status).toBe(201);
      const bonusId = grant.body.id;

      // Forzar expires_at en el pasado.
      const sqlConn2 = postgres(getTestTenantUrl(), { max: 1 });
      try {
        await sqlConn2.unsafe(
          `UPDATE user_bonuses SET expires_at = NOW() - INTERVAL '1 day' WHERE id = $1`,
          [bonusId],
        );
      } finally {
        await sqlConn2.end();
      }

      // Disparar job.
      const run = await ctx.request
        .post('/tenant/bonuses/jobs/expire')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(run.status).toBe(200);
      expect(run.body.succeeded).toBeGreaterThanOrEqual(1);

      const rows = await readNotificationsFromDb(player.id);
      const expired = rows.filter((r) => r.kind === 'bonus_expired');
      expect(expired).toHaveLength(2);
      const inApp = expired.find((r) => r.channel === 'in_app');
      expect(inApp!.body).toContain(bonusId);
      expect(inApp!.body).toContain('50.00');
    });
  });

  describe('Hook bonus_cancelled en UserBonusesController.cancel', () => {
    it('cancel bonus → user dueño recibe in_app + email con motivo', async () => {
      const sqlConn = postgres(getTestTenantUrl(), { max: 1 });
      try {
        await sqlConn.unsafe(
          `UPDATE bonus_definitions SET status = 'archived' WHERE type = 'reload'`,
        );
      } finally {
        await sqlConn.end();
      }
      const defRes = await ctx.request
        .post('/tenant/bonus-definitions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code: `reload_cancel_${Date.now()}`,
          name: 'Reload Cancel Test',
          type: 'reload',
          status: 'active',
          config: { matchPct: 100, maxAmount: 50000, minDeposit: 0 },
        });
      const definitionId = defRes.body.id;

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-bonus-cancel',
        label: 'p',
        role: 'usuario_final',
      });

      const grant = await ctx.request
        .post('/tenant/bonuses/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', `grant-cancel-${Date.now()}`)
        .send({
          userId: player.id,
          definitionId,
          amount: '75',
          reason: 'grant para test de cancel notif',
        });
      const bonusId = grant.body.id;

      const reason = 'Otorgado por error — usuario lo solicitó.';
      const cancelRes = await ctx.request
        .post(`/tenant/bonuses/${bonusId}/cancel`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ reason });
      expect(cancelRes.status).toBe(200);

      const rows = await readNotificationsFromDb(player.id);
      const cancelled = rows.filter((r) => r.kind === 'bonus_cancelled');
      expect(cancelled).toHaveLength(2);
      const inApp = cancelled.find((r) => r.channel === 'in_app');
      expect(inApp!.body).toContain(bonusId);
      expect(inApp!.body).toContain(reason);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Hook bonus_granted (happy path manual + auto-grant)
  // ──────────────────────────────────────────────────────────────────────

  describe('Hook bonus_granted en UserBonusesService.grantManual', () => {
    it('grant manual exitoso → user dueño recibe in_app + email con nombre+monto', async () => {
      const sqlConn = postgres(getTestTenantUrl(), { max: 1 });
      try {
        await sqlConn.unsafe(
          `UPDATE bonus_definitions SET status = 'archived' WHERE type = 'reload'`,
        );
      } finally {
        await sqlConn.end();
      }
      const defRes = await ctx.request
        .post('/tenant/bonus-definitions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code: `reload_grant_${Date.now()}`,
          name: 'Reload Test Grant',
          type: 'reload',
          status: 'active',
          config: { matchPct: 100, maxAmount: 50000, minDeposit: 0 },
        });
      const definitionId = defRes.body.id;

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-bonus-granted',
        label: 'p',
        role: 'usuario_final',
      });

      const grant = await ctx.request
        .post('/tenant/bonuses/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', `grant-bgr-${Date.now()}`)
        .send({
          userId: player.id,
          definitionId,
          amount: '250',
          reason: 'grant para test bonus_granted notif',
        });
      expect(grant.status).toBe(201);
      const bonusId = grant.body.id;

      const rows = await readNotificationsFromDb(player.id);
      const granted = rows.filter((r) => r.kind === 'bonus_granted');
      expect(granted).toHaveLength(2);
      const inApp = granted.find((r) => r.channel === 'in_app');
      // El body incluye el nombre legible y el monto.
      expect(inApp!.body).toContain('Reload Test Grant');
      expect(inApp!.body).toContain('250');
      // Subject es el happy path "Recibiste un bono".
      expect(inApp!.subject).toMatch(/Recibiste un bono/i);
      void bonusId;
    });

    it('idempotency: re-grant con misma key no duplica notifs', async () => {
      const sqlConn = postgres(getTestTenantUrl(), { max: 1 });
      try {
        await sqlConn.unsafe(
          `UPDATE bonus_definitions SET status = 'archived' WHERE type = 'reload'`,
        );
      } finally {
        await sqlConn.end();
      }
      const defRes = await ctx.request
        .post('/tenant/bonus-definitions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code: `reload_grant_idem_${Date.now()}`,
          name: 'Reload Idem',
          type: 'reload',
          status: 'active',
          config: { matchPct: 100, maxAmount: 50000, minDeposit: 0 },
        });
      const definitionId = defRes.body.id;

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-bonus-granted-idem',
        label: 'p',
        role: 'usuario_final',
      });

      const idempKey = `grant-bgr-idem-${Date.now()}`;
      const body = {
        userId: player.id,
        definitionId,
        amount: '100',
        reason: 'test idempotency notif bonus_granted',
      };
      const r1 = await ctx.request
        .post('/tenant/bonuses/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', idempKey)
        .send(body);
      const r2 = await ctx.request
        .post('/tenant/bonuses/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', idempKey)
        .send(body);
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      expect(r1.body.id).toBe(r2.body.id);

      // Solo 2 notifs (un par del primer grant), no 4.
      const rows = await readNotificationsFromDb(player.id);
      const granted = rows.filter((r) => r.kind === 'bonus_granted');
      expect(granted).toHaveLength(2);
    });

    it('auto-grant en deposit approve también dispara bonus_granted', async () => {
      // Setup welcome definition.
      const sqlConn = postgres(getTestTenantUrl(), { max: 1 });
      const code = `welcome_bgr_${Date.now()}`;
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
          name: 'Welcome Auto-Grant Test',
          type: 'welcome',
          status: 'active',
          config: { matchPct: 100, maxAmount: 50000, minDeposit: 0 },
        });

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-bgr-auto',
        label: 'p',
        role: 'usuario_final',
      });

      const ms = postgres(getTestTenantUrl(), { max: 1 });
      let methodId: string;
      try {
        const rows = await ms<{ id: string }[]>`
          INSERT INTO payment_methods (id, code, name, type, config, is_active)
          VALUES (gen_random_uuid(), ${`m-${Date.now()}-bgr`}, 'm', 'bank_transfer',
                  '{"cbu":"0000"}'::jsonb, true)
          RETURNING id
        `;
        methodId = rows[0]!.id;
      } finally {
        await ms.end();
      }

      const pToken = await loginAs(ctx.request, player.username, player.password);
      const dep = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', pToken)
        .send({
          methodId,
          amountChips: '300',
          amountFiat: '300',
          currencyFiat: 'ARS',
        });
      await ctx.request
        .post(`/tenant/deposits/${dep.body.deposit.id}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      const rows = await readNotificationsFromDb(player.id);
      // Esperamos 2 notifs de bonus_granted (in_app + email del auto-grant)
      // ADEMÁS de las 2 de deposit_approved.
      const granted = rows.filter((r) => r.kind === 'bonus_granted');
      expect(granted).toHaveLength(2);
      const inApp = granted.find((r) => r.channel === 'in_app');
      expect(inApp!.body).toContain('Welcome Auto-Grant Test');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Hook fraud_link_suspected (admin notif proactiva al crear link nuevo)
  // ──────────────────────────────────────────────────────────────────────

  describe('Hook fraud_link_suspected en FraudDetectionService.runScan', () => {
    it('scan detecta nuevo link → otros admin_tenant reciben in_app + email', async () => {
      // 2do admin del tenant para verificar destinatarios.
      const otherAdmin = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-fls-admin2',
        label: 'a',
        role: 'admin_tenant',
      });

      // 2 players con misma email local part + mismo dominio → similar_email signal.
      const pA = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-fls-pa',
        label: 'p',
        role: 'usuario_final',
      });
      const pB = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-fls-pb',
        label: 'p',
        role: 'usuario_final',
      });

      // Forzar shared_ip + similar_email para que el score sume 70 (threshold default).
      const sqlConn = postgres(getTestTenantUrl(), { max: 1 });
      try {
        const sharedIp = `9.9.${Date.now() % 250}.${Math.floor(Math.random() * 250)}`;
        for (const userId of [pA.id, pB.id]) {
          await sqlConn.unsafe(
            `INSERT INTO user_sessions (id, user_id, token_hash, ip, expires_at)
             VALUES (gen_random_uuid(), $1, $2, $3, NOW() + INTERVAL '30 days')`,
            [
              userId,
              `synth-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              sharedIp,
            ],
          );
        }
        // Emails similares (diff 1 char) → similar_email weight 40.
        await sqlConn.unsafe(`UPDATE users SET email = $1 WHERE id = $2`, [
          `fraudo${Date.now()}@example.test`,
          pA.id,
        ]);
        await sqlConn.unsafe(`UPDATE users SET email = $1 WHERE id = $2`, [
          `fraudo${Date.now()}1@example.test`,
          pB.id,
        ]);
      } finally {
        await sqlConn.end();
      }

      // Disparar scan manual.
      const scan = await ctx.request
        .post('/tenant/fraud/scans/run')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect([200, 201]).toContain(scan.status);
      expect(scan.body.newSuspectedLinks).toBeGreaterThanOrEqual(1);

      // otherAdmin recibió 2 notifs (in_app + email).
      const otherRows = await readNotificationsFromDb(otherAdmin.id);
      const suspected = otherRows.filter((r) => r.kind === 'fraud_link_suspected');
      expect(suspected.length).toBeGreaterThanOrEqual(2);
      const inApp = suspected.find((r) => r.channel === 'in_app');
      // El subject menciona link de fraude detectado.
      expect(inApp!.subject).toMatch(/fraude/i);
      // Body incluye usernames y score.
      expect(inApp!.body).toContain(pA.username);
      expect(inApp!.body).toContain(pB.username);
    });

    it('re-scan sin links nuevos → NO duplica notifs', async () => {
      // Limpiar links + notifs previos.
      const sqlConn = postgres(getTestTenantUrl(), { max: 1 });
      try {
        await sqlConn.unsafe(`DELETE FROM fraud_account_links`);
        await sqlConn.unsafe(`DELETE FROM notifications`);
      } finally {
        await sqlConn.end();
      }

      // Setup 2nd admin para receptor.
      const otherAdmin = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-fls-rescan',
        label: 'a',
        role: 'admin_tenant',
      });

      // Crear 2 players con shared IP + similar email para crear UN link.
      const pA = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-fls-rs-a',
        label: 'p',
        role: 'usuario_final',
      });
      const pB = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-fls-rs-b',
        label: 'p',
        role: 'usuario_final',
      });
      const sqlConn2 = postgres(getTestTenantUrl(), { max: 1 });
      try {
        const sharedIp = `8.8.${Date.now() % 250}.${Math.floor(Math.random() * 250)}`;
        for (const userId of [pA.id, pB.id]) {
          await sqlConn2.unsafe(
            `INSERT INTO user_sessions (id, user_id, token_hash, ip, expires_at)
             VALUES (gen_random_uuid(), $1, $2, $3, NOW() + INTERVAL '30 days')`,
            [
              userId,
              `synth-rs-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              sharedIp,
            ],
          );
        }
        const stamp = Date.now();
        await sqlConn2.unsafe(`UPDATE users SET email = $1 WHERE id = $2`, [
          `rescan${stamp}@example.test`,
          pA.id,
        ]);
        await sqlConn2.unsafe(`UPDATE users SET email = $1 WHERE id = $2`, [
          `rescan${stamp}1@example.test`,
          pB.id,
        ]);
      } finally {
        await sqlConn2.end();
      }

      // 1er scan → crea link nuevo → notif.
      await ctx.request
        .post('/tenant/fraud/scans/run')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      const afterFirst = await readNotificationsFromDb(otherAdmin.id);
      const firstCount = afterFirst.filter(
        (r) => r.kind === 'fraud_link_suspected',
      ).length;
      expect(firstCount).toBeGreaterThanOrEqual(2);

      // 2do scan → re-procesa el mismo par → UPDATE existing, NO inserta.
      await ctx.request
        .post('/tenant/fraud/scans/run')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      const afterSecond = await readNotificationsFromDb(otherAdmin.id);
      const secondCount = afterSecond.filter(
        (r) => r.kind === 'fraud_link_suspected',
      ).length;
      // Mismo count que después del 1er scan — re-scan NO duplica.
      expect(secondCount).toBe(firstCount);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Admin endpoint GET /tenant/notifications
  // ──────────────────────────────────────────────────────────────────────

  describe('GET /tenant/notifications (admin)', () => {
    it('cajero1 sin notifications.view_any → 403', async () => {
      const cajeroToken = await loginAs(
        ctx.request,
        TEST_TENANT.cajero1.username,
        TEST_TENANT.cajero1.password,
      );
      const res = await ctx.request
        .get('/tenant/notifications')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajeroToken);
      expect(res.status).toBe(403);
    });

    it('admin lista todas las notifs con enriquecimiento de user', async () => {
      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-admin-list',
        label: 'p',
        role: 'usuario_final',
      });
      const db = ctx.tenantDb;
      await service.enqueue(db, {
        userId: u.id,
        kind: 'welcome_bonus_blocked',
        channel: 'in_app',
        payload: {},
      });

      const res = await ctx.request
        .get('/tenant/notifications')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      const body = res.body as {
        data: Array<{
          userId: string;
          userUsername: string | null;
          userDisplayName: string | null;
          kind: string;
          channel: string;
          status: string;
        }>;
        total: number;
      };
      expect(body.total).toBeGreaterThanOrEqual(1);
      const ours = body.data.find((n) => n.userId === u.id);
      expect(ours).toBeDefined();
      expect(ours!.userUsername).toBe(u.username);
      // createTestUser setea displayName = `Test ${label}`.
      expect(ours!.userDisplayName).toBe('Test p');
      expect(ours!.kind).toBe('welcome_bonus_blocked');
      expect(ours!.channel).toBe('in_app');
    });

    it('filtra por ?statuses=pending,failed y ?channels=email', async () => {
      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-admin-flt',
        label: 'p',
        role: 'usuario_final',
      });
      const db = ctx.tenantDb;
      // in_app → sent inmediato.
      await service.enqueue(db, {
        userId: u.id,
        kind: 'welcome_bonus_blocked',
        channel: 'in_app',
        payload: {},
      });
      // email → pending.
      await service.enqueue(db, {
        userId: u.id,
        kind: 'welcome_bonus_blocked',
        channel: 'email',
        payload: {},
      });

      const res = await ctx.request
        .get('/tenant/notifications')
        .query({ statuses: 'pending', channels: 'email', userId: u.id })
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      const body = res.body as {
        data: Array<{ status: string; channel: string }>;
        total: number;
      };
      expect(body.total).toBeGreaterThanOrEqual(1);
      expect(body.data.every((n) => n.status === 'pending')).toBe(true);
      expect(body.data.every((n) => n.channel === 'email')).toBe(true);
    });

    it('POST /:id/retry re-encola una notification failed → status=pending', async () => {
      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-retry',
        label: 'p',
        role: 'usuario_final',
      });
      const db = ctx.tenantDb;
      // Encolamos email para user SIN email → dispatcher la marcará failed.
      const notif = await service.enqueue(db, {
        userId: u.id,
        kind: 'welcome_bonus_blocked',
        channel: 'email',
        payload: {},
      });
      await dispatcher.runForTenant(db, TEST_TENANT.slug);
      // Verifico que quedó failed.
      const afterDispatch = await readNotificationsFromDb(u.id);
      const failedNotif = afterDispatch.find((n) => n.id === notif.id);
      expect(failedNotif?.status).toBe('failed');
      expect(failedNotif?.error).toBeTruthy();

      // Retry endpoint.
      const res = await ctx.request
        .post(`/tenant/notifications/${notif.id}/retry`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      const body = res.body as { status: string; error: string | null };
      expect(body.status).toBe('pending');
      expect(body.error).toBeNull();
    });

    it('POST /:id/retry rechaza si status no es failed (404)', async () => {
      const u = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-retry-bad',
        label: 'p',
        role: 'usuario_final',
      });
      const db = ctx.tenantDb;
      // in_app se crea con status=sent → no es failed → 404.
      const notif = await service.enqueue(db, {
        userId: u.id,
        kind: 'welcome_bonus_blocked',
        channel: 'in_app',
        payload: {},
      });
      const res = await ctx.request
        .post(`/tenant/notifications/${notif.id}/retry`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(404);
    });

    it('POST /:id/retry cajero sin notifications.retry → 403', async () => {
      // Necesitamos una notif para probar — basta cualquier UUID porque el guard de perm corre antes del lookup.
      const cajeroToken = await loginAs(
        ctx.request,
        TEST_TENANT.cajero1.username,
        TEST_TENANT.cajero1.password,
      );
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await ctx.request
        .post(`/tenant/notifications/${fakeId}/retry`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajeroToken);
      expect(res.status).toBe(403);
    });

    it('?userId acota a un user específico', async () => {
      const u1 = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-admin-u1',
        label: 'p',
        role: 'usuario_final',
      });
      const u2 = await createTestUser(ctx.request, adminToken, {
        suite: 'notif-admin-u2',
        label: 'p',
        role: 'usuario_final',
      });
      const db = ctx.tenantDb;
      await service.enqueue(db, {
        userId: u1.id,
        kind: 'welcome_bonus_blocked',
        channel: 'in_app',
        payload: {},
      });
      await service.enqueue(db, {
        userId: u2.id,
        kind: 'welcome_bonus_blocked',
        channel: 'in_app',
        payload: {},
      });

      const res = await ctx.request
        .get('/tenant/notifications')
        .query({ userId: u1.id })
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      const body = res.body as { data: Array<{ userId: string }>; total: number };
      expect(body.data.every((n) => n.userId === u1.id)).toBe(true);
    });
  });
});

// Suppress unused import warning para freshKey si no se usa en este file.
void freshKey;
