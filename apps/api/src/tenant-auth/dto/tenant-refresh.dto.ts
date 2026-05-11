import { IsString, MinLength } from 'class-validator';

export class TenantRefreshDto {
  @IsString()
  @MinLength(40, { message: 'Refresh token con formato inválido.' })
  refreshToken!: string;
}
