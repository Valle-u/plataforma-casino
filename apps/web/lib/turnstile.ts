/**
 * Cloudflare Turnstile (anti-bot) — config del cliente.
 *
 * La SITE KEY es pública (va en el HTML del widget), por eso es NEXT_PUBLIC_*
 * y se hornea en el build (ver apps/web/Dockerfile). El widget se auto-activa
 * SOLO si hay sitekey configurada: sin ella, `<TurnstileWidget>` no renderiza
 * y los forms mandan sin token (el backend, si TURNSTILE_ENABLED=false,
 * tampoco lo exige). Así el rollout es gradual y sin ventana de bloqueo.
 *
 * El SECRET nunca vive acá — se valida server-side (TurnstileService en la API).
 */
export const TURNSTILE_SITEKEY = process.env.NEXT_PUBLIC_TURNSTILE_SITEKEY ?? '';
export const TURNSTILE_ENABLED = TURNSTILE_SITEKEY.length > 0;
