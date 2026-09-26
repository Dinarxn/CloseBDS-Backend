import { z } from 'zod';
import dotenv from 'dotenv';

// Load local .env file if available (server-side only)
dotenv.config();

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(4000),
    CORS_ORIGIN: z.string().default('http://localhost:3000'),
    BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(1048576), // 1MB default
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    RATE_LIMIT_TIME_WINDOW_MS: z.coerce.number().int().positive().default(60000),
    KILL_SWITCH_ACTIVE: z
      .string()
      .transform((val) => val.toLowerCase() === 'true' || val === '1')
      .default('false'),

    // Authentication & Security Secrets
    JWT_SECRET: z.string().min(16).default('development_jwt_secret_must_be_32_characters_long_min'),
    JWT_EXPIRES_IN: z.string().default('7d'),
    COOKIE_SECRET: z.string().min(16).default('development_cookie_secret_must_be_32_characters_long'),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20), // 20 attempts per window for auth routes
    AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),

    // Database Configuration
    DATABASE_URL: z.string().min(1).optional(),
    DATABASE_POOL_MIN: z.coerce.number().int().nonnegative().default(2),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

    // Telephony & Voice (Twilio)
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_PHONE_NUMBER: z.string().optional(),

    // Email Outreach (Resend)
    RESEND_API_KEY: z.string().optional(),
    RESEND_WEBHOOK_SECRET: z.string().optional(),

    // WhatsApp Business API (Meta Cloud API)
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
    WHATSAPP_APP_SECRET: z.string().optional(),

    // n8n Integration Webhook Secret
    N8N_WEBHOOK_SECRET: z.string().optional(),

    // closeBDS Integration Configuration
    CLOSEBDS_API_KEY: z.string().optional(),
    CLOSEBDS_BASE_URL: z.string().optional(),

    // Lead Discovery Provider Secrets
    GEOAPIFY_API_KEY: z.string().optional(),

    // AI & LLM Provider Configuration
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().default('gemini-3.6-flash'),
  })
  .refine(
    (data) => {
      // In production mode, DATABASE_URL must be explicitly configured
      if (data.NODE_ENV === 'production' && !data.DATABASE_URL) {
        return false;
      }
      return true;
    },
    {
      message: 'DATABASE_URL is strictly required when running in production mode',
      path: ['DATABASE_URL'],
    }
  )
  .refine(
    (data) => {
      // In production mode, JWT_SECRET and COOKIE_SECRET must not be default development keys
      if (data.NODE_ENV === 'production') {
        if (data.JWT_SECRET.includes('development') || data.COOKIE_SECRET.includes('development')) {
          return false;
        }
      }
      return true;
    },
    {
      message: 'Production secrets for JWT_SECRET and COOKIE_SECRET must be explicitly configured',
      path: ['JWT_SECRET'],
    }
  );

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Validates and returns parsed environment configuration.
 * Fails safely with descriptive error output if required configuration is invalid.
 */
export function validateEnv(rawEnv: Record<string, unknown> = process.env): EnvConfig {
  const result = envSchema.safeParse(rawEnv);

  if (!result.success) {
    const errorDetails = result.error.errors
      .map((err) => `  - ${err.path.join('.')}: ${err.message}`)
      .join('\n');

    throw new Error(
      `[closeVDS Backend] Fatal: Invalid environment configuration:\n${errorDetails}`
    );
  }

  return result.data;
}
