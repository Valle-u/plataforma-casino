/**
 * Invalidación centralizada de TODAS las queries que pintan balances en el
 * panel. Cualquier mutation que altere un balance (load/unload/burn, aprobar
 * depósito, cobrar retiro, grant/cancel bono, corrección, sell-chips,
 * inyección de capital…) debe llamar a `invalidateAllBalances` para que el
 * saldo se vea actualizado "en el momento" en el header, sidebar, tesorería,
 * lista de users, wallet del user y KPIs.
 *
 * `invalidateQueries` matchea por prefijo: invalidar `['user-wallet']` invalida
 * todas las variantes `['user-wallet', userId]` (y `['user-wallet', id, pag]`).
 * Solo refetchea queries montadas — las no cacheadas no disparan nada.
 */

import type { QueryClient } from '@tanstack/react-query';

export function invalidateAllBalances(qc: QueryClient): void {
  // Wallet del actor (header, sidebar, /wallet, /users/[id]/wallet)
  void qc.invalidateQueries({ queryKey: ['my-wallet'] });
  void qc.invalidateQueries({ queryKey: ['my-transactions'] });
  void qc.invalidateQueries({ queryKey: ['my-wallet-stats'] });

  // Wallet de OTRO user (vista de jugador, lista de users)
  void qc.invalidateQueries({ queryKey: ['user-wallet'] });
  void qc.invalidateQueries({ queryKey: ['user-transactions'] });

  // Tesorería / Casa
  void qc.invalidateQueries({ queryKey: ['house-state'] });
  void qc.invalidateQueries({ queryKey: ['house-capital-injections'] });
  void qc.invalidateQueries({ queryKey: ['house-mint-budget'] });
  void qc.invalidateQueries({ queryKey: ['house-balance-history'] });
  void qc.invalidateQueries({ queryKey: ['house-stock-alert'] });
  void qc.invalidateQueries({ queryKey: ['house-capital-needed'] });
  void qc.invalidateQueries({ queryKey: ['ledger-supply'] });

  // Listado de users (muestra walletBalance/bonusBalance por fila) + KPIs
  void qc.invalidateQueries({ queryKey: ['users-list'] });
  void qc.invalidateQueries({ queryKey: ['users-stats'] });
  void qc.invalidateQueries({ queryKey: ['users-stats-dashboard'] });

  // Correcciones (cupos y wallets)
  void qc.invalidateQueries({ queryKey: ['correction-status'] });
  void qc.invalidateQueries({ queryKey: ['correction-employees'] });
  void qc.invalidateQueries({ queryKey: ['correction-user-cap'] });

  // Sucursales independientes (sell-chips mueve la caja del socio)
  void qc.invalidateQueries({ queryKey: ['branches-list'] });
  void qc.invalidateQueries({ queryKey: ['branches-sales-history'] });
  void qc.invalidateQueries({ queryKey: ['my-branch'] });

  // Bonos (bonus_balance del jugador + KPIs)
  void qc.invalidateQueries({ queryKey: ['bonuses'] });
  void qc.invalidateQueries({ queryKey: ['bonuses-stats'] });

  // Detalle de user (contiene saldos/caps del user)
  void qc.invalidateQueries({ queryKey: ['user-detail'] });
}
