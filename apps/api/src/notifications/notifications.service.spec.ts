/**
 * Unit tests: NotificationsService.dispatch — rama `web_push`.
 *
 * No levanta Nest ni toca DB real: se mockea el db (builder chain de
 * drizzle), el PushProvider y el PushSubscriptionsService. La cobertura
 * de la rama web_push del dispatcher necesita un provider controlable
 * (éxito / 404-410 gone / error genérico) — algo que el E2E no puede
 * garantizar porque el provider real depende del env (VAPID seteado →
 * WebPushProvider real, que haría network a un endpoint fake).
 *
 * Escenarios:
 *   - Múltiples subs: una gone (404/410) → se borra; otra ok → 'sent'.
 *   - Sin suscripciones → 'failed' con error 'user_has_no_push_subscription'.
 *   - Todas fallan con error genérico → 'failed' 'push_delivery_failed',
 *     sin borrar subs.
 */

import { NotificationsService } from './notifications.service';
import { PushSubscriptionGoneError } from './providers/web-push.provider';
import type { EmailProvider } from './providers/email-provider.interface';
import type { PushProvider } from './providers/push-provider.interface';
import type { SmsProvider } from './providers/sms-provider.interface';
import type { PushSubscriptionsService } from './push-subscriptions.service';
import type { TenantDb } from '../tenant-resolver/tenant-context';

interface FakeSub {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface PendingRow {
  id: string;
  userId: string;
  channel: 'web_push';
  kind: string;
  subject: string;
  body: string;
}

interface DbMock {
  updates: Array<Record<string, unknown>>;
  select: jest.Mock;
  from: jest.Mock;
  where: jest.Mock;
  orderBy: jest.Mock;
  limit: jest.Mock;
  update: jest.Mock;
  set: jest.Mock;
}

function createDbMock(pendingRows: PendingRow[]): DbMock {
  const updates: Array<Record<string, unknown>> = [];
  const db: DbMock = {
    updates,
    select: jest.fn(() => db),
    from: jest.fn(() => db),
    where: jest.fn(() => db),
    orderBy: jest.fn(() => db),
    limit: jest.fn(() => Promise.resolve(pendingRows)),
    update: jest.fn(() => db),
    set: jest.fn((values: Record<string, unknown>) => {
      updates.push(values);
      return db;
    }),
  };
  return db;
}

function makeSub(endpoint: string): FakeSub {
  return {
    id: `sub-${endpoint.length}`,
    endpoint,
    p256dh: 'p256dh-base64',
    auth: 'auth-base64',
  };
}

function buildService(deps: {
  pushSend?: jest.Mock;
  listForUser?: jest.Mock;
}): { service: NotificationsService; push: jest.Mock; subs: jest.Mock; db: DbMock } {
  const push: jest.Mock = deps.pushSend ?? jest.fn().mockResolvedValue(undefined);
  const subs: jest.Mock = deps.listForUser ?? jest.fn().mockResolvedValue([]);
  const pushProvider = { send: push } as unknown as PushProvider;
  const subsService = {
    listForUser: subs,
    touchLastSeen: jest.fn().mockResolvedValue(undefined),
    deleteById: jest.fn().mockResolvedValue(undefined),
  } as unknown as PushSubscriptionsService;

  const service = new NotificationsService(
    {} as EmailProvider,
    {} as SmsProvider,
    pushProvider,
    subsService,
  );
  return { service, push, subs, db: createDbMock([]) };
}

describe('NotificationsService.dispatch — web_push', () => {
  it('envía a todas las subs; 404/410 borra la sub; marca sent si al menos una llegó', async () => {
    const { service, push, subs, db } = buildService({
      pushSend: jest.fn(async (keys: { endpoint: string }) => {
        if (keys.endpoint === 'https://gone.example') {
          throw new PushSubscriptionGoneError('push_subscription_gone_404');
        }
      }),
    });
    const subOk = makeSub('https://ok.example');
    const subGone = makeSub('https://gone.example');
    subs.mockResolvedValue([subGone, subOk]);
    db.limit.mockResolvedValue([
      {
        id: 'n1',
        userId: 'u1',
        channel: 'web_push',
        kind: 'withdrawal_paid',
        subject: 'Retiro pagado',
        body: 'Tu retiro fue pagado.',
      },
    ]);

    const result = await service.dispatch(db as unknown as TenantDb, 'test');

    expect(result).toEqual({ processed: 1, sent: 1, failed: 0 });
    expect(push).toHaveBeenCalledTimes(2);
    // La sub gone se borró; la ok se marcó lastSeen.
    const subsService = (
      service as unknown as {
        pushSubscriptionsService: {
          deleteById: jest.Mock;
          touchLastSeen: jest.Mock;
        };
      }
    ).pushSubscriptionsService;
    expect(subsService.deleteById).toHaveBeenCalledWith(db, subGone.id);
    expect(subsService.deleteById).not.toHaveBeenCalledWith(db, subOk.id);
    expect(subsService.touchLastSeen).toHaveBeenCalledWith(db, subOk.id);
    // Status final = sent.
    expect(db.updates[0]!.status).toBe('sent');
  });

  it('sin suscripciones → failed user_has_no_push_subscription (sin llamar al provider)', async () => {
    const { service, push, db } = buildService({});
    db.limit.mockResolvedValue([
      {
        id: 'n1',
        userId: 'u1',
        channel: 'web_push',
        kind: 'deposit_approved',
        subject: 'Depósito aprobado',
        body: 'Ya tenés saldo.',
      },
    ]);

    const result = await service.dispatch(db as unknown as TenantDb, 'test');

    expect(result).toEqual({ processed: 1, sent: 0, failed: 1 });
    expect(push).not.toHaveBeenCalled();
    expect(db.updates[0]).toEqual(
      expect.objectContaining({
        status: 'failed',
        error: 'user_has_no_push_subscription',
      }),
    );
  });

  it('todas fallan con error genérico → failed push_delivery_failed, sin borrar subs', async () => {
    const { service, subs, db } = buildService({
      pushSend: jest.fn().mockRejectedValue(new Error('network timeout')),
    });
    subs.mockResolvedValue([makeSub('https://ok.example')]);
    db.limit.mockResolvedValue([
      {
        id: 'n1',
        userId: 'u1',
        channel: 'web_push',
        kind: 'deposit_rejected',
        subject: 'Depósito rechazado',
        body: 'Revisá el comprobante.',
      },
    ]);

    const result = await service.dispatch(db as unknown as TenantDb, 'test');

    expect(result).toEqual({ processed: 1, sent: 0, failed: 1 });
    const subsService = (
      service as unknown as {
        pushSubscriptionsService: { deleteById: jest.Mock };
      }
    ).pushSubscriptionsService;
    expect(subsService.deleteById).not.toHaveBeenCalled();
    expect(db.updates[0]).toEqual(
      expect.objectContaining({
        status: 'failed',
        error: 'push_delivery_failed',
      }),
    );
  });
});
