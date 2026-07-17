/**
 * Tests unitarios para PalaceCallbackService.
 *
 * Tests los 6 commands del callback: authenticate, balance, bet, win, cancel, status.
 * Mockea WalletService y DB para aislar la lógica del service.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { PalaceCallbackService } from './palace-callback.service';
import { WalletService } from '../../../wallet/wallet.service';
import { PALACE_RESULT } from './palace.types';
import type { PalaceCallbackData } from './palace.types';

describe('PalaceCallbackService', () => {
  let service: PalaceCallbackService;
  let walletService: jest.Mocked<WalletService>;

  const mockWallet = {
    id: 'wallet-123',
    userId: 'user-123',
    balance: '1000.00',
    bonusBalance: '0.00',
    lockedBalance: '0.00',
    currency: 'ARS',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUser = {
    id: 'user-123',
    username: 'jugador_carlos',
    palaceAccount: 'jugador_carlos',
    palaceUserCode: 408527320,
    status: 'active',
  };

  // Helper para crear mock de DB que retorna valores en cadena
  function createMockDb(selectResults: any[]) {
    let selectCallCount = 0;
    return {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockImplementation(() => {
              const result = selectResults[selectCallCount] ?? [];
              selectCallCount++;
              return Promise.resolve(Array.isArray(result) ? result : [result]);
            }),
          }),
        }),
      }),
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockResolvedValue({}),
      }),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue({}),
        }),
      }),
    };
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PalaceCallbackService,
        {
          provide: WalletService,
          useValue: {
            getOrCreateWalletForUser: jest.fn().mockResolvedValue(mockWallet),
            getByUserId: jest.fn().mockResolvedValue(mockWallet),
            placeBetExternal: jest.fn().mockResolvedValue({}),
            settleWinExternal: jest.fn().mockResolvedValue({}),
            cancelExternal: jest.fn().mockResolvedValue({}),
          },
        },
      ],
    }).compile();

    service = module.get<PalaceCallbackService>(PalaceCallbackService);
    walletService = module.get(WalletService);
    jest.clearAllMocks();
  });

  describe('authenticate', () => {
    it('debería retornar OK con balance del usuario', async () => {
      const data: PalaceCallbackData = { account: 'jugador_carlos' };
      const db = createMockDb([mockUser, mockUser]);

      const result = await service.handle(db as any, 'authenticate', data, [21]);

      expect(result.result).toBe(PALACE_RESULT.OK);
      expect(result.status).toBe('OK');
      expect(result.data).toEqual({ account: 'jugador_carlos', balance: 1000 });
    });

    it('debería retornar error 21 si usuario no existe', async () => {
      const data: PalaceCallbackData = { account: 'inexistente' };
      const db = createMockDb([[]]);

      const result = await service.handle(db as any, 'authenticate', data, [21]);

      expect(result.result).toBe(PALACE_RESULT.CHECK_USER_NOT_FOUND);
      expect(result.status).toBe('ERROR');
    });
  });

  describe('balance', () => {
    it('debería retornar OK con balance', async () => {
      const data: PalaceCallbackData = { account: 'jugador_carlos' };
      const db = createMockDb([mockUser, mockUser]);

      const result = await service.handle(db as any, 'balance', data, [21, 22]);

      expect(result.result).toBe(PALACE_RESULT.OK);
      expect(result.data).toEqual({ balance: 1000 });
    });

    it('debería retornar error 22 si inactivo', async () => {
      const data: PalaceCallbackData = { account: 'jugador_carlos' };
      const db = createMockDb([{ ...mockUser, status: 'inactive' }]);

      const result = await service.handle(db as any, 'balance', data, [21, 22]);

      expect(result.result).toBe(PALACE_RESULT.CHECK_USER_NOT_ACTIVE);
    });
  });

  describe('bet', () => {
    it('OK con monto válido', async () => {
      const data: PalaceCallbackData = {
        account: 'jugador_carlos',
        trans_guid: 'bet-1',
        amount: '100',
        game_code: 'vswaysdogs',
        game_type: 'Slots',
        round_id: 'round-1',
        provider_id: 1,
        type: 1,
      };
      // user, idempotency (no existe), wallet balance check
      const db = createMockDb([mockUser, [], mockUser]);
      walletService.getByUserId.mockResolvedValue({ ...mockWallet, balance: '900.00' });

      const result = await service.handle(db as any, 'bet', data, [21, 22, 41, 31]);

      expect(result.result).toBe(PALACE_RESULT.OK);
      expect(result.data).toEqual({ balance: 900 });
      expect(walletService.placeBetExternal).toHaveBeenCalled();
    });

    it('error 31 saldo insuficiente', async () => {
      const data: PalaceCallbackData = {
        account: 'jugador_carlos',
        trans_guid: 'bet-2',
        amount: '2000',
      };
      const db = createMockDb([mockUser, [], mockUser]);
      walletService.getOrCreateWalletForUser.mockResolvedValue({ ...mockWallet, balance: '1000.00' });

      const result = await service.handle(db as any, 'bet', data, [21, 22, 41, 31]);

      expect(result.result).toBe(PALACE_RESULT.CHECK_INSUFFICIENT_BALANCE);
    });

    it('error 41 ya procesado', async () => {
      const data: PalaceCallbackData = {
        account: 'jugador_carlos',
        trans_guid: 'bet-dup',
        amount: '100',
      };
      const db = createMockDb([mockUser, { id: 'existing' }]);

      const result = await service.handle(db as any, 'bet', data, [21, 22, 41, 31]);

      expect(result.result).toBe(PALACE_RESULT.CHECK_ALREADY_PROCESSED);
    });

    it('amount=0 permitido (test proveedor)', async () => {
      const data: PalaceCallbackData = {
        account: 'jugador_carlos',
        trans_guid: 'bet-zero',
        amount: 0,
      };
      const db = createMockDb([mockUser, [], mockUser]);
      walletService.getByUserId.mockResolvedValue(mockWallet);

      const result = await service.handle(db as any, 'bet', data, [21, 22, 41, 31]);

      expect(result.result).toBe(PALACE_RESULT.OK);
      expect(walletService.placeBetExternal).not.toHaveBeenCalled();
    });
  });

  describe('win', () => {
    it('OK con monto válido', async () => {
      const data: PalaceCallbackData = {
        account: 'jugador_carlos',
        trans_guid: 'win-1',
        amount: '500',
        game_code: 'vswaysdogs',
        game_type: 'Slots',
        round_id: 'round-2',
        provider_id: 1,
        type: 2,
      };
      // check21=user, check41=idempotency, handler=user
      const db = createMockDb([mockUser, [], mockUser]);
      walletService.getOrCreateWalletForUser.mockResolvedValue({ ...mockWallet, balance: '1500.00' });
      walletService.getByUserId.mockResolvedValue({ ...mockWallet, balance: '1500.00' });

      const result = await service.handle(db as any, 'win', data, [21, 22, 41]);

      expect(result.result).toBe(PALACE_RESULT.OK);
      expect(result.data).toEqual({ balance: 1500 });
      expect(walletService.settleWinExternal).toHaveBeenCalled();
    });

    it('amount=0 (loss) no modifica wallet', async () => {
      const data: PalaceCallbackData = {
        account: 'jugador_carlos',
        trans_guid: 'win-zero',
        amount: 0,
      };
      // check21=user, check41=idempotency, handler=user
      const db = createMockDb([mockUser, [], mockUser]);
      walletService.getOrCreateWalletForUser.mockResolvedValue(mockWallet);

      const result = await service.handle(db as any, 'win', data, [21, 22, 41]);

      expect(result.result).toBe(PALACE_RESULT.OK);
      expect(walletService.settleWinExternal).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('OK al cancelar apuesta', async () => {
      const data: PalaceCallbackData = {
        account: 'jugador_carlos',
        trans_guid: 'cancel-1',
        cancel_trans_guid: 'bet-1',
      };
      const originalTx = {
        id: 'tx-1',
        transGuid: 'bet-1',
        sort: 'BET',
        amount: '100',
        status: 'OK',
        gameCode: 'vswaysdogs',
        gameType: 'Slots',
        roundId: 'round-1',
        providerId: 1,
        userCode: 408527320,
      };
      // check 21: user, check 41: idempotency, check 43: cancel_trans_guid
      // handler: getUserByAccount (user), select original tx
      const db = createMockDb([mockUser, [], originalTx, mockUser, originalTx]);
      walletService.getByUserId.mockResolvedValue({ ...mockWallet, balance: '1100.00' });

      const result = await service.handle(db as any, 'cancel', data, [21, 22, 41, 43]);

      expect(result.result).toBe(PALACE_RESULT.OK);
      expect(result.data).toEqual({ balance: 1100 });
      expect(walletService.cancelExternal).toHaveBeenCalled();
    });

    it('error 43 transacción no existe', async () => {
      const data: PalaceCallbackData = {
        account: 'jugador_carlos',
        trans_guid: 'cancel-2',
        cancel_trans_guid: 'non-existent',
      };
      // check 21: user, check 41: idempotency, check 43: cancel_trans_guid (no existe)
      // handler: getUserByAccount (user), select original tx (no existe)
      const db = createMockDb([mockUser, [], [], mockUser, []]);

      const result = await service.handle(db as any, 'cancel', data, [21, 22, 41, 43]);

      expect(result.result).toBe(PALACE_RESULT.CHECK_CANCEL_TX_NOT_FOUND);
    });
  });

  describe('status', () => {
    it('OK con transacción existente', async () => {
      const data: PalaceCallbackData = {
        account: 'jugador_carlos',
        trans_guid: 'status-1',
      };
      const existingTx = {
        id: 'tx-1',
        transGuid: 'status-1',
        account: 'jugador_carlos',
        status: 'OK',
      };
      // user (check 21), tx (check 42), tx again (handler)
      const db = createMockDb([mockUser, existingTx, existingTx]);

      const result = await service.handle(db as any, 'status', data, [21, 42]);

      expect(result.result).toBe(PALACE_RESULT.OK);
      expect(result.data).toEqual({
        account: 'jugador_carlos',
        trans_guid: 'status-1',
        trans_status: 'OK',
      });
    });

    it('error 42 transacción no existe', async () => {
      const data: PalaceCallbackData = {
        account: 'jugador_carlos',
        trans_guid: 'non-existent',
      };
      // user (check 21), tx not found (check 42)
      const db = createMockDb([mockUser, []]);

      const result = await service.handle(db as any, 'status', data, [21, 42]);

      expect(result.result).toBe(PALACE_RESULT.CHECK_TX_NOT_FOUND);
    });

    it('OK con transacción cancelada', async () => {
      const data: PalaceCallbackData = {
        account: 'jugador_carlos',
        trans_guid: 'canceled-tx',
      };
      const canceledTx = {
        id: 'tx-1',
        transGuid: 'canceled-tx',
        account: 'jugador_carlos',
        status: 'CANCELED',
      };
      // user (check 21), tx (check 42), tx again (handler)
      const db = createMockDb([mockUser, canceledTx, canceledTx]);

      const result = await service.handle(db as any, 'status', data, [21, 42]);

      expect(result.result).toBe(PALACE_RESULT.OK);
      expect(result.data).toEqual({
        account: 'jugador_carlos',
        trans_guid: 'canceled-tx',
        trans_status: 'CANCELED',
      });
    });
  });
});
