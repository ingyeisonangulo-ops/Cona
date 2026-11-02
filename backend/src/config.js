import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_ORIGIN: z.url(),
  APP_DATABASE_URL: z.string().trim().min(1),
  DB_SSL: z.enum(['disable', 'require', 'verify-full']).default('verify-full'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET debe tener al menos 32 caracteres'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  REFRESH_FAMILY_MAX_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  COOKIE_SECURE: bool.default(true),
  LOCKOUT_MAX_ATTEMPTS_ACCOUNT: z.coerce.number().int().min(1).max(20).default(5),
  LOCKOUT_MAX_ATTEMPTS_IP: z.coerce.number().int().min(1).max(200).default(5),
  LOCKOUT_WINDOW_MINUTES: z.coerce.number().int().min(1).default(15),
  LOCKOUT_DURATION_MINUTES: z.coerce.number().int().min(1).default(15),
  FRONTEND_DIST: z.string().default('../frontend/dist'),
});

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida:\n${issues}`);
  }
  const env = parsed.data;
  const isProd = env.NODE_ENV === 'production';

  if (isProd && !env.COOKIE_SECURE) {
    throw new Error('COOKIE_SECURE=false no está permitido en producción');
  }
  if (isProd && !env.APP_ORIGIN.startsWith('https://')) {
    throw new Error('APP_ORIGIN debe usar https en producción');
  }

  return Object.freeze({
    env: env.NODE_ENV,
    isProd,
    port: env.PORT,
    appOrigin: new URL(env.APP_ORIGIN).origin,
    db: {
      url: env.APP_DATABASE_URL,
      ssl: env.DB_SSL,
      poolMax: env.DB_POOL_MAX,
    },
    jwt: {
      accessSecret: env.JWT_ACCESS_SECRET,
      accessTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
      issuer: 'nuevo-amanecer-crm',
      audience: 'nuevo-amanecer-crm-web',
    },
    refresh: {
      ttlDays: env.REFRESH_TOKEN_TTL_DAYS,
      familyMaxDays: env.REFRESH_FAMILY_MAX_DAYS,
    },
    cookies: { secure: env.COOKIE_SECURE },
    lockout: {
      maxAccount: env.LOCKOUT_MAX_ATTEMPTS_ACCOUNT,
      maxIp: env.LOCKOUT_MAX_ATTEMPTS_IP,
      windowMinutes: env.LOCKOUT_WINDOW_MINUTES,
      durationMinutes: env.LOCKOUT_DURATION_MINUTES,
    },
    frontendDist: env.FRONTEND_DIST,
  });
}

export const config = load();
