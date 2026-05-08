import { Module } from '@nestjs/common';
import { TenantInfoController } from './tenant-info.controller';

@Module({
  controllers: [TenantInfoController],
})
export class TenantInfoModule {}
