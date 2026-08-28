/**
 * Registry de schemas Zod por key de `tenant_settings`.
 *
 * Cada key conocida del sistema declara su shape esperada. El endpoint
 * `PATCH /tenant/settings/:key` valida el `value` contra el schema antes
 * de persistir. Keys NO registradas se aceptan tal cual (forward-compat
 * — permite que el admin setee custom settings sin code change).
 *
 * Convención: keys hardcoded acá (no importadas de cada módulo) para
 * evitar dependencias circulares — `fraud-detection.service.ts` ya
 * importa de `tenant-settings`, y un import inverso crearía un ciclo.
 * El costo es duplicar el string literal — si se cambia hay que tocar
 * ambos lados. Mitigación: tests que prueban el flow real garantizan
 * que el key del registry y el del service estén alineados.
 *
 * Cuando crezca el catálogo de keys, considerar:
 *   - Per-módulo registry contribuido via DI.
 *   - Constantes compartidas en `@casino/shared` package.
 */

import { z, type ZodSchema } from 'zod';

/**
 * Map de key → schema Zod. Comentarios documentan a qué módulo pertenece.
 */
export const SETTING_SCHEMAS: Record<string, ZodSchema> = {
  // ── fraud (apps/api/src/fraud/fraud-detection.service.ts) ───────────
  // Threshold para que un par de cuentas pase a `status='suspected'`
  // en el scan. Default 70.
  'fraud.suspected_threshold': z
    .number()
    .min(0, { message: 'fraud.suspected_threshold debe ser >= 0' })
    .max(100, { message: 'fraud.suspected_threshold debe ser <= 100' }),

  // Threshold para bloqueo automático de welcome bonus + warning en
  // grant manual. Default 90.
  'fraud.welcome_block_threshold': z
    .number()
    .min(0, { message: 'fraud.welcome_block_threshold debe ser >= 0' })
    .max(100, { message: 'fraud.welcome_block_threshold debe ser <= 100' }),

  // ── tenant_settings (self) ──────────────────────────────────────────
  // Retención del history en días. Cron diario purga entries con
  // changed_at < NOW() - N days. Min 7 (no perder visibility de la
  // última semana). Max 3650 (~10 años).
  'tenant_settings.history_retention_days': z
    .number()
    .int({ message: 'tenant_settings.history_retention_days debe ser entero.' })
    .min(7, { message: 'mínimo 7 días.' })
    .max(3650, { message: 'máximo 3650 días (~10 años).' }),

  // ── notifications (apps/api/src/notifications) ──────────────────────
  // Master switches por channel. Si false, el dispatcher salta las
  // notifs de ese channel (quedan en pending forever — útil para
  // pausar envíos temporalmente sin perder el queue).
  'notifications.email_enabled': z.boolean(),
  'notifications.in_app_enabled': z.boolean(),
  'notifications.sms_enabled': z.boolean(),
  'notifications.push_enabled': z.boolean(),

  // Retención de notifs leídas/enviadas en días. El dispatcher purga
  // entries viejas para evitar crecimiento ilimitado. Default 180d.
  'notifications.retention_days': z
    .number()
    .int({ message: 'notifications.retention_days debe ser entero.' })
    .min(7, { message: 'mínimo 7 días.' })
    .max(3650, { message: 'máximo 3650 días.' }),

  // ── branding (Sprint 29: aplicado al player vía /tenant/info) ───────
  // Color primario del tenant — pisa `--color-accent` en el CSS del
  // player. Formato hex #RRGGBB (con #, 6 dígitos hex). Si no se setea,
  // el player usa el accent default del DS.
  'branding.primary_color': z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, {
      message: 'Debe ser hex #RRGGBB (6 dígitos hex con #).',
    }),

  // URL HTTPS del logo del tenant — se renderiza en `PlayerHeader` y
  // como favicon dinámico. Si no se setea, el player usa el BrandMark
  // SVG default. Sin upload propio en MVP: el admin sube su imagen a
  // un host externo (S3, imgur, propio CDN) y pega la URL acá.
  // Acepta una URL HTTPS externa O una ruta del PROPIO sitio (`/storage/...`,
  // que sirve el rewrite de Next sobre HTTPS) — desde que hay upload propio, el
  // admin sube su imagen y se guarda normalizada como `/storage/...` (relativa,
  // mismo origen, segura). También `''` para poder limpiarla.
  'branding.logo_url': z
    .string()
    .max(500, { message: 'URL muy larga (máx 500 chars).' })
    .refine(
      (v) => v === '' || v.startsWith('https://') || v.startsWith('/'),
      { message: 'Debe ser una URL HTTPS o una ruta del sitio (/storage/…).' },
    ),

  // Ícono de la pestaña del tenant. Mismo criterio que logo_url.
  'branding.favicon_url': z
    .string()
    .max(500, { message: 'URL muy larga (máx 500 chars).' })
    .refine(
      (v) => v === '' || v.startsWith('https://') || v.startsWith('/'),
      { message: 'Debe ser una URL HTTPS o una ruta del sitio (/storage/…).' },
    ),

  // ── commissions (apps/api/src/commissions/network-commissions.service.ts) ─
  // F1 · Deducciones operativas del socio DEPENDIENTE.
  //
  // Al liquidar la comisión mensual, el motor descuenta 3 items:
  //   sueldos + bank_cost + platform_cost. Estos dos settings controlan los
  //   últimos dos (los sueldos vienen de employee_salaries).
  //
  // Los socios INDEPENDIENTES NO sufren estas deducciones (compraron fichas
  // al por mayor, la comisión no aplica) — el motor los saltea.
  //
  // Costo bancario proporcional: fracción de la NetWin de la sub-red del
  // socio que se le imputa como costo bancario / transaccional. Se resta
  // ANTES del cap final. Rango [0, 1]; default 0.01 (1%).
  //
  // Ejemplo: NetWin sub-red = 1.000.000, pct = 0.01 → costo bancario = 10.000.
  'commissions.bank_cost_pct_of_netwin': z
    .number()
    .min(0, { message: 'commissions.bank_cost_pct_of_netwin debe ser >= 0.' })
    .max(1, {
      message:
        'commissions.bank_cost_pct_of_netwin debe ser <= 1 (fracción, no porcentaje: 0.01 = 1%).',
    }),

  // Costo de plataforma FLAT mensual del socio dep — monto fijo que la
  // plataforma cobra por proveerle el panel. Se resta como línea única del
  // gross. Default 0 (deshabilitado). Debe ser monto en la moneda del tenant.
  'commissions.platform_cost_flat': z
    .number()
    .min(0, { message: 'commissions.platform_cost_flat debe ser >= 0.' }),

  // ── treasury (apps/api/src/house/house.service.ts) ──────────────────
  // TOPE MENSUAL de creación de fichas (mint). El único minteo hoy es
  // `injectBudget`; este setting lo capa por mes calendario UTC. La suma
  // de `house_capital_injections.amount` WHERE type='budget' del mes en
  // curso no puede superar este tope (salvo el modo `fondeo`, que lo
  // bypasea a propósito y queda auditado). Default alto (1e12 = "sin
  // límite práctico") hasta que el admin lo configure. Debe ser >= 0.
  'treasury.monthly_mint_budget': z
    .number()
    .min(0, { message: 'treasury.monthly_mint_budget debe ser >= 0.' }),

  // Tope de sanidad del premio (win) del proveedor de juego. Un win por encima
  // se RECHAZA (no se mintea) y alerta — defensa contra un callback comprometido
  // que mintea "infinito". Default alto (50M) para no bloquear jackpots reales.
  // 0 = sin tope. Ver palace-callback.service.handleWin.
  'game_provider.palace.win_max_amount': z
    .number()
    .min(0, { message: 'game_provider.palace.win_max_amount debe ser >= 0.' }),

  // Allowlist de IPs del callback del proveedor + modo. 'observe' (default)
  // solo registra la IP en logs; 'enforce' bloquea las que no estén en la
  // allowlist (un token filtrado no sirve desde otra IP). Ver palace-callback.controller.
  'game_provider.palace.callback_ip_mode': z.enum(['observe', 'enforce']),
  'game_provider.palace.callback_ip_allowlist': z.array(z.string()),

  // ── games / Palace Casino (apps/api/src/games/providers/palace) ───────
  // URL base de la Main API de Palace. Default del cliente:
  // https://agent.goldslotpalase.com
  'palace.api_url': z
    .string()
    .url({ message: 'palace.api_url debe ser una URL válida.' })
    .startsWith('https://', { message: 'palace.api_url debe usar HTTPS.' })
    .max(500, { message: 'palace.api_url muy larga (máx 500 chars).' }),

  // Token Bearer para autenticar contra la Main API de Palace.
  'palace.api_token': z.string().min(1, { message: 'palace.api_token no puede estar vacío.' }),

  // Idioma default para requests a Palace (default 4 en el cliente).
  'palace.default_lang': z
    .number()
    .int({ message: 'palace.default_lang debe ser entero.' })
    .min(0, { message: 'palace.default_lang debe ser >= 0.' }),

  // ── games / Forever (apps/api/src/games/providers/forever) ────────────
  // 2º proveedor de juegos (seamless, Ed25519). Ver docs/forever/*. Namespacing
  // provider-agnóstico `game_provider.forever.*` (a diferencia de las de Palace,
  // que quedaron con prefijo plano `palace.*` por retrocompat).
  // Main API base URL (Profile → API Endpoint). Ej: https://api.aicvgdbi.win/api/casinoapi
  'game_provider.forever.api_url': z
    .string()
    .url({ message: 'game_provider.forever.api_url debe ser una URL válida.' })
    .startsWith('https://', { message: 'game_provider.forever.api_url debe usar HTTPS.' })
    .max(500, { message: 'game_provider.forever.api_url muy larga (máx 500).' }),

  // Código de agente (Profile → Agent code). Va en el body + en la firma.
  'game_provider.forever.agent_code': z
    .string()
    .min(1, { message: 'game_provider.forever.agent_code no puede estar vacío.' })
    .max(100),

  // API token (Profile → API token). Va en el body (`token`). SECRETO.
  'game_provider.forever.api_token': z
    .string()
    .min(1, { message: 'game_provider.forever.api_token no puede estar vacío.' }),

  // Clave privada Ed25519 (base64, 32B seed) para FIRMAR requests salientes. SECRETO.
  'game_provider.forever.request_sign_private_key': z
    .string()
    .min(1, { message: 'game_provider.forever.request_sign_private_key no puede estar vacío.' }),

  // Clave pública Ed25519 (base64, 32B) para VERIFICAR los callbacks entrantes.
  'game_provider.forever.callback_verify_public_key': z
    .string()
    .min(1, { message: 'game_provider.forever.callback_verify_public_key no puede estar vacío.' }),

  // Tope de sanidad del premio (mint) de Forever. Un win por encima se rechaza y
  // alerta (defensa contra callback comprometido). 0 = sin tope. Default 50M.
  'game_provider.forever.win_max_amount': z
    .number()
    .min(0, { message: 'game_provider.forever.win_max_amount debe ser >= 0.' }),

  // Moneda con la que se lanzan los juegos (GetGameUrl currencyCode). DEBE
  // coincidir con la moneda de la cuenta de Forever (ej. ARS). Si no se setea,
  // el launch usa ARS por default. Una moneda que no matchea → 404 al abrir.
  'game_provider.forever.currency': z
    .string()
    .min(1, { message: 'game_provider.forever.currency no puede estar vacío.' })
    .max(10, { message: 'game_provider.forever.currency muy larga (máx 10).' }),

  // ── games / Gregmorn (apps/api/src/games/providers/gregmorn) ───────────
  // 3er proveedor de juegos (seamless, HMAC-SHA256). Ver docs/gregmorn/*.
  // Convive con Palace y Forever. Mismo namespacing provider-agnóstico que
  // Forever: `game_provider.gregmorn.*`.
  //
  // OJO: usa DOS hosts distintos según la operación. No es un error tener dos
  // URLs — Stage y Prod difieren en ambas.

  // Host de auth (`/auth/login`) y catálogo (`getUserGames`).
  // Stage: https://office-api-dev.gregmorn.org
  'game_provider.gregmorn.api_url_office': z
    .string()
    .url({ message: 'game_provider.gregmorn.api_url_office debe ser una URL válida.' })
    .startsWith('https://', {
      message: 'game_provider.gregmorn.api_url_office debe usar HTTPS.',
    })
    .max(500, { message: 'game_provider.gregmorn.api_url_office muy larga (máx 500).' }),

  // Host de `openGame` (abrir juego). Stage: https://client-api-dev.gregmorn.org
  'game_provider.gregmorn.api_url_client': z
    .string()
    .url({ message: 'game_provider.gregmorn.api_url_client debe ser una URL válida.' })
    .startsWith('https://', {
      message: 'game_provider.gregmorn.api_url_client debe usar HTTPS.',
    })
    .max(500, { message: 'game_provider.gregmorn.api_url_client muy larga (máx 500).' }),

  // Usuario de la API de Gregmorn (`/auth/login`).
  'game_provider.gregmorn.login': z
    .string()
    .min(1, { message: 'game_provider.gregmorn.login no puede estar vacío.' })
    .max(100),

  // Password del usuario de la API. SECRETO.
  'game_provider.gregmorn.password': z
    .string()
    .min(1, { message: 'game_provider.gregmorn.password no puede estar vacío.' }),

  // Clave del HMAC-SHA256 del header `X-Signature`, en los dos sentidos
  // (firmamos `openGame`, verificamos los callbacks). SECRETO. Stage y Prod
  // tienen claves distintas.
  'game_provider.gregmorn.secret_api_key': z
    .string()
    .min(1, { message: 'game_provider.gregmorn.secret_api_key no puede estar vacío.' }),

  // Id del usuario de API. Obligatorio en `openGame` y en `getUserGames`; ellos
  // lo usan para resolver qué secret key valida la firma. NO es el id del
  // jugador. Podría ser el `user.id` que devuelve `/auth/login`, sin confirmar.
  'game_provider.gregmorn.user_id': z
    .string()
    .min(1, { message: 'game_provider.gregmorn.user_id no puede estar vacío.' })
    .max(100),

  // Moneda de las sesiones de juego (`openGame.currency` + el `currencyISO` del
  // catálogo). Ellos confirmaron soporte de ARS. Si no se setea, se usa ARS.
  'game_provider.gregmorn.currency': z
    .string()
    .min(1, { message: 'game_provider.gregmorn.currency no puede estar vacío.' })
    .max(10, { message: 'game_provider.gregmorn.currency muy larga (máx 10).' }),

  // Tope de sanidad del premio (mint) de Gregmorn — LEY E7. Un win por encima se
  // rechaza y alerta (defensa contra callback comprometido). 0 = sin tope.
  // Espeja el de Palace y Forever.
  'game_provider.gregmorn.win_max_amount': z
    .number()
    .min(0, { message: 'game_provider.gregmorn.win_max_amount debe ser >= 0.' }),

  // ── site (apps/api/src/tenant-info + player web) ──────────────────────
  // Master switch de mantenimiento: si true, el player web muestra una
  // pantalla de mantenimiento y no renderiza el sitio. El panel admin
  // NO se ve afectado. Default false (sitio operativo).
  'site.maintenance_enabled': z.boolean(),

  // Abre/cierra el registro de nuevos jugadores. Si false, el endpoint
  // POST /tenant/auth/register responde 403 con mensaje claro y el player
  // muestra "Registros cerrados" en el modal. Default true.
  'site.registration_enabled': z.boolean(),

  // Banner de aviso global que se muestra arriba de la home del player.
  // Texto libre corto. Vacío/ausente = sin banner.
  'site.announcement_text': z
    .string()
    .max(500, { message: 'site.announcement_text muy largo (máx 500 chars).' }),

  // Días de inactividad tras los cuales un JUGADOR (usuario_final) que no
  // inicia sesión se marca como 'inactive' automáticamente (cron diario). El
  // login le pide contactar a soporte para reactivarlo. 0 = desactivado (no
  // se marca nadie). Solo aplica a jugadores; nunca a staff/operadores.
  'users.inactivity_days': z
    .number()
    .int({ message: 'users.inactivity_days debe ser entero.' })
    .min(0, { message: 'users.inactivity_days debe ser >= 0.' }),

  // ── registro (self-service del jugador) ───────────────────────────────
  // Si true (default), el teléfono es OBLIGATORIO al registrarse; el
  // endpoint POST /tenant/auth/register rechaza sin teléfono y el modal lo
  // marca requerido. Si false, el campo es opcional. Toggle en Config →
  // Sistema. Ausente = obligatorio (default seguro).
  'registration.phone_required': z.boolean(),

  // ── limits (player deposits / withdrawals) ────────────────────────────
  // Monto FIAT mínimo (en la moneda del tenant) para solicitar un depósito.
  // Si no se setea, no hay mínimo (default 0). La validación vive en
  // DepositsService.create.
  'deposits.min_amount': z
    .number()
    .min(0, { message: 'deposits.min_amount debe ser >= 0.' }),

  // Monto FIAT mínimo para solicitar un retiro. Validado en
  // WithdrawalsService.create sobre el fiat calculado del método. Default 0.
  'withdrawals.min_amount': z
    .number()
    .min(0, { message: 'withdrawals.min_amount debe ser >= 0.' }),

  // ── branding (tagline / slogan) ───────────────────────────────────────
  // Frase corta bajo el nombre comercial del tenant (hero, auth, footer).
  'branding.tagline': z
    .string()
    .max(200, { message: 'branding.tagline muy largo (máx 200 chars).' }),
};

/**
 * Helper para los tests / docs: lista de keys con schema declarado.
 */
export const REGISTERED_SETTING_KEYS = Object.keys(SETTING_SCHEMAS);
