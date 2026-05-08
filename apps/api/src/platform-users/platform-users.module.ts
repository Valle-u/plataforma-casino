import { Module } from '@nestjs/common';
import { PlatformUsersService } from './platform-users.service';

@Module({
  providers: [PlatformUsersService],
  exports: [PlatformUsersService],
})
export class PlatformUsersModule {}
