/**
 * E2E: CronLockService — leader-election cross-instancia vía advisory lock
 * sobre la DB de control. Valida que dos ticks concurrentes (simulando 2
 * réplicas, cada una con su conexión reservada) solo dejen correr uno.
 */

import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { CronLockService } from '../../cron-lock/cron-lock.service';

describe('CronLockService (E2E)', () => {
  let ctx: TestApp;
  let lock: CronLockService;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    lock = ctx.app.get(CronLockService);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('dos runExclusive concurrentes con el MISMO lock: corre exactamente uno', async () => {
    let ran = 0;
    const slow = () =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          ran++;
          resolve();
        }, 300);
      });

    const results = await Promise.all([
      lock.runExclusive('test-lock-x', slow),
      lock.runExclusive('test-lock-x', slow),
    ]);

    // Exactamente una instancia adquirió el lock y corrió fn.
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(ran).toBe(1);
  });

  it('locks DISTINTOS no se bloquean entre sí', async () => {
    let ran = 0;
    const fn = () =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          ran++;
          resolve();
        }, 100);
      });

    const results = await Promise.all([
      lock.runExclusive('test-lock-a', fn),
      lock.runExclusive('test-lock-b', fn),
    ]);

    expect(results).toEqual([true, true]);
    expect(ran).toBe(2);
  });

  it('el lock se libera al terminar: un run posterior vuelve a adquirir', async () => {
    let ran = 0;
    const fn = () => {
      ran++;
      return Promise.resolve();
    };

    const first = await lock.runExclusive('test-lock-seq', fn);
    const second = await lock.runExclusive('test-lock-seq', fn);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(ran).toBe(2);
  });

  it('libera el lock aunque fn tire: el siguiente run vuelve a adquirir', async () => {
    const boom = () => Promise.reject(new Error('boom'));
    await expect(lock.runExclusive('test-lock-err', boom)).rejects.toThrow('boom');

    // El lock quedó liberado (finally) → un run limpio posterior corre.
    let ran = 0;
    const ok = await lock.runExclusive('test-lock-err', () => {
      ran++;
      return Promise.resolve();
    });
    expect(ok).toBe(true);
    expect(ran).toBe(1);
  });
});
