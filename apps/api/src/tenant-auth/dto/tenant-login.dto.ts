import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Audience del login. Determina si el endpoint acepta o rechaza users
 * según su set de roles:
 *   - 'panel'  → exige rol con panel access. Players (solo usuario_final)
 *                son rechazados con 403 NOT_PANEL_USER. El frontend admin
 *                (/login) DEBE pasar este valor explícito.
 *   - 'player' → no rechaza por rol (admin puede jugar). El frontend
 *                player (/play/login) lo pasa. Es también el DEFAULT
 *                backend si el cliente no manda nada — modo permisivo
 *                para no romper integraciones server-to-server o tests
 *                que asumen el comportamiento legacy. La protección de
 *                "player no puede entrar al panel" depende de que el
 *                cliente admin pase 'panel' explícito (verificado por
 *                el test de regresión panel-access.e2e.ts).
 *
 * Defense-in-depth si alguien olvida pasar 'panel' desde el admin:
 *   - Frontend: `AdminLayout` redirige a /play si me.canAccessPanel=false.
 *   - Backend: controllers admin con @PanelOnly() rechazan players en
 *     CADA request al pasar por TenantJwtGuard, sin importar cómo se
 *     emitió el JWT.
 */
export type TenantLoginAudience = 'panel' | 'player';

/**
 * Login del tenant: aceptamos username (no email obligatorio porque algunos
 * jugadores pueden no tener email).
 */
export class TenantLoginDto {
  @IsString()
  @MinLength(3)
  username!: string;

  @IsString()
  @MinLength(8, { message: 'La password debe tener al menos 8 caracteres.' })
  password!: string;

  /**
   * Audience del login. Ver `TenantLoginAudience`. Default 'panel'.
   * El frontend admin (`/login`) debe pasar 'panel' explícito; el
   * frontend player (`/play/login`) debe pasar 'player'.
   */
  @IsOptional()
  @IsIn(['panel', 'player'])
  audience?: TenantLoginAudience;

  /**
   * Código TOTP opcional. Si el user tiene 2FA enabled, ESTE campo es
   * obligatorio — el service lo valida después de password. Si el user
   * NO tiene 2FA, este campo se ignora.
   */
  @IsOptional()
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'twoFaCode debe ser 6 dígitos.' })
  twoFaCode?: string;

  /**
   * Recovery code one-time, alternativa a `twoFaCode` cuando el user perdió
   * su app TOTP. Formato `xxxx-xxxx-xx` (10 hex chars, opcional con guiones).
   * Si el code matchea uno vigente, queda invalidado tras este login.
   *
   * Validación laxa de shape (3-32 chars) — el service hace la
   * normalización fina (strip guiones, lowercase) y rechaza si la forma
   * normalizada no es exactamente 10 hex chars.
   */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  recoveryCode?: string;
}
