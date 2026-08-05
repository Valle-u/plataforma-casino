import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * DTO de baja de suscripción web-push. Se identifica por `endpoint`
 * (la URL única del dispositivo) en vez del id interno — el cliente
 * solo conoce la endpoint; el id de la fila es interno del backend.
 */
export class DeletePushSubscriptionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  endpoint!: string;
}
