import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class SetParentDto {
  @IsUUID()
  parentUserId!: string;

  /** Convención: 'cajero_de_socio', 'jugador_de_cajero', etc. */
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  relationType!: string;
}
