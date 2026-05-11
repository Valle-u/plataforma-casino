import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class GrantPermissionDto {
  @IsUUID()
  userId!: string;

  @IsString()
  @MaxLength(100)
  permissionCode!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}

export class RevokePermissionDto {
  @IsUUID()
  userId!: string;

  @IsString()
  @MaxLength(100)
  permissionCode!: string;

  @IsString()
  @MaxLength(500)
  reason!: string; // obligatorio para revoke
}
