import { Module } from '@nestjs/common';
import { PaymentMethodsController } from './payment-methods.controller';
import { PaymentMethodsService } from './payment-methods.service';
import { NodePaymentMethodsService } from './node-payment-methods.service';
import { NodePaymentMethodsController } from './node-payment-methods.controller';
import { PlayerPaymentMethodsController } from './player-payment-methods.controller';

@Module({
  controllers: [
    PaymentMethodsController,
    NodePaymentMethodsController,
    PlayerPaymentMethodsController,
  ],
  providers: [PaymentMethodsService, NodePaymentMethodsService],
  exports: [PaymentMethodsService, NodePaymentMethodsService],
})
export class PaymentMethodsModule {}
