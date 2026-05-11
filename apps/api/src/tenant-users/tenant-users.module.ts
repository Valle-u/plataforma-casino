import { Module } from '@nestjs/common';
import { TenantUsersService } from './tenant-users.service';

@Module({
  providers: [TenantUsersService],
  exports: [TenantUsersService],
})
export class TenantUsersModule {}
