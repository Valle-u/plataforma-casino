/**
 * BankAccountsModule — cuentas bancarias PROPIAS del tenant.
 *
 * Exporta el service porque el alta de transferencias lo va a usar para copiar
 * titular y banco de la cuenta elegida, en vez de aceptarlos como texto libre.
 */

import { Module } from '@nestjs/common';
import { BankAccountsController } from './bank-accounts.controller';
import { BankAccountsService } from './bank-accounts.service';

@Module({
  controllers: [BankAccountsController],
  providers: [BankAccountsService],
  exports: [BankAccountsService],
})
export class BankAccountsModule {}
