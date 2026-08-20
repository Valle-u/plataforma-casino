import { z } from 'zod';

/**
 * Validación del entorno al bootear la API. Objetivo: fallar RÁPIDO y con un
 * mensaje claro si falta (o está mal) una variable crítica, en vez de arrancar
 * "roto" y explotar recién cuando un request la golpea en runtime.
 *
 * Filosofía conservadora: solo se EXIGEN las variables sin las cuales la app no
 * puede funcionar de ninguna forma. El resto es opcional y degrada de forma
 * conocida (Redis, VAPID, Twilio, Sentry, PALACE_CALLBACK_TOKEN, flags de cron)
 * — no se listan acá para no romper entornos que legítimamente no las setean.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  PORT: z
    .string()
    .regex(/^\d+$/, 'PORT debe ser numérico')
    .optional(),

  // Base de datos — sin esto la app no arranca ni resuelve tenants.
  DATABASE_URL_CONTROL: z
    .string()
    .min(1, 'DATABASE_URL_CONTROL es obligatoria (connection string de platform_control)'),
  DATABASE_URL_TENANT_TEMPLATE: z
    .string()
    .min(1, 'DATABASE_URL_TENANT_TEMPLATE es obligatoria')
    .refine((v) => v.includes('<tenant_db>'), {
      message: "DATABASE_URL_TENANT_TEMPLATE debe contener el placeholder '<tenant_db>'",
    }),

  // JWT de auth — el secreto debe existir y no ser el placeholder de dev.
  JWT_ACCESS_SECRET: z
    .string()
    .min(1, 'JWT_ACCESS_SECRET es obligatoria')
    .refine((v) => v !== 'change-me-soon', {
      message:
        "JWT_ACCESS_SECRET no puede ser el placeholder 'change-me-soon' (generá uno con: openssl rand -hex 64)",
    }),
});

/**
 * Pasada a `ConfigModule.forRoot({ validate })`. NO transforma el entorno:
 * valida y devuelve el `config` ORIGINAL intacto, para que ConfigService siga
 * viendo TODAS las variables (si devolviéramos solo el objeto parseado,
 * ConfigModule perdería el resto de las vars).
 */
export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  · ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `❌ Configuración de entorno inválida:\n${issues}\n` +
        `Revisá apps/api/.env.example para el contrato completo.`,
    );
  }
  return config;
}
