import { Module } from '@nestjs/common';
import { RequestContextMiddleware } from './request-context.middleware';

/**
 * RequestContextModule — sólo provee el middleware. No tiene controllers
 * ni servicios. El middleware se registra desde `AppModule.configure`.
 */
@Module({
  providers: [RequestContextMiddleware],
  exports: [RequestContextMiddleware],
})
export class RequestContextModule {}
