import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * TurnstileService — verificación anti-bot de Cloudflare Turnstile.
 *
 * Se usa en puntos sensibles del jugador (login, registro, solicitud de
 * retiro). El front embebe el widget de Turnstile y manda el token; acá lo
 * validamos server-side contra `siteverify` de Cloudflare antes de procesar.
 *
 * Flags (ConfigService, mismo patrón que TwoFaPolicyService):
 *   - `TURNSTILE_ENABLED` = 'true'  → activa la verificación (default OFF).
 *   - `TURNSTILE_SECRET_KEY`        → secret del widget (NO es público).
 *
 * Filosofía de fallo:
 *   - Flag off / secret ausente → no-op (deploy del código no cambia nada).
 *   - Token ausente o inválido/expirado → 403 (bloquea).
 *   - Error de red/timeout hacia Cloudflare → fail-OPEN + warning: un blip
 *     transitorio del edge de verificación NO debe brickear login/registro.
 */
@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);
  private static readonly SITEVERIFY_URL =
    'https://challenges.cloudflare.com/turnstile/v0/siteverify';

  private readonly enabled: boolean;
  private readonly secret: string | undefined;

  constructor(config: ConfigService) {
    this.enabled = config.get<string>('TURNSTILE_ENABLED') === 'true';
    const secret = config.get<string>('TURNSTILE_SECRET_KEY');
    this.secret = secret && secret.length > 0 ? secret : undefined;
    if (this.enabled && !this.secret) {
      this.logger.error(
        'TURNSTILE_ENABLED=true pero falta TURNSTILE_SECRET_KEY → verificación DESACTIVADA (fail-open) para no bloquear el acceso. Configurá el secret.',
      );
    } else if (this.enabled) {
      this.logger.log('Turnstile anti-bot ACTIVADO.');
    }
  }

  /** Solo verifica si el flag está on Y hay secret configurado. */
  get isEnabled(): boolean {
    return this.enabled && !!this.secret;
  }

  /**
   * Verifica el token. No-op si Turnstile está desactivado. Lanza
   * ForbiddenException si el token falta o Cloudflare lo rechaza.
   *
   * @param token   `cf-turnstile-response` que mandó el widget del front.
   * @param action  etiqueta para logs (ej. 'login', 'register', 'withdrawal').
   */
  async verify(
    token: string | undefined | null,
    action = '-',
  ): Promise<void> {
    if (!this.isEnabled) return;

    if (!token || token.trim().length === 0) {
      throw new ForbiddenException({
        message:
          'Verificación anti-bot requerida. Recargá la página e intentá de nuevo.',
        error: 'TURNSTILE_TOKEN_MISSING',
      });
    }

    let success = false;
    try {
      const body = new URLSearchParams();
      body.set('secret', this.secret as string);
      body.set('response', token);
      const res = await fetch(TurnstileService.SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        // Error de infraestructura de CF → fail-open (no bloqueamos auth).
        this.logger.warn(
          `siteverify respondió HTTP ${res.status} — fail-open (${action}).`,
        );
        return;
      }
      const data = (await res.json()) as {
        success?: boolean;
        'error-codes'?: string[];
      };
      success = data.success === true;
      if (!success) {
        this.logger.warn(
          `Turnstile rechazó el token (${action}): ${
            (data['error-codes'] ?? []).join(',') || 'sin detalle'
          }.`,
        );
      }
    } catch (err) {
      // Timeout o error de red hacia CF → fail-open + warning.
      this.logger.warn(
        `siteverify inaccesible — fail-open (${action}): ${(err as Error).message}`,
      );
      return;
    }

    if (!success) {
      throw new ForbiddenException({
        message:
          'No pudimos verificar que no seas un bot. Recargá la página e intentá de nuevo.',
        error: 'TURNSTILE_FAILED',
      });
    }
  }
}
