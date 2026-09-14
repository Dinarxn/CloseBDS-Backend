import type { FastifyServerOptions } from 'fastify';

/**
 * Sensitive fields and headers that must NEVER be printed to logs.
 */
export const SENSITIVE_KEYS = [
  'password',
  'secret',
  'token',
  'authorization',
  'cookie',
  'set-cookie',
  'apiKey',
  'api_key',
  'access_token',
  'refresh_token',
  'jwt',
  'private_key',
  'SUPPRESSION_ENCRYPTION_KEY',
  'AI_PROVIDER_API_KEY',
  'EMAIL_PROVIDER_API_KEY',
  'LEAD_PROVIDER_API_KEY',
  'DATABASE_URL',
];

/**
 * Fastify / Pino logging configuration with security redaction.
 */
export function getLoggerConfig(
  logLevel = 'info',
  _isProduction = false
): FastifyServerOptions['logger'] {
  if (process.env.NODE_ENV === 'test') {
    return false; // Silent during unit tests
  }

  return {
    level: logLevel,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["set-cookie"]',
        'req.body.password',
        'req.body.token',
        'req.body.apiKey',
        'req.body.secret',
        'headers.authorization',
        'headers.cookie',
        '*.password',
        '*.secret',
        '*.token',
        '*.apiKey',
        '*.api_key',
      ],
      censor: '[REDACTED_SECRET]',
    },
    serializers: {
      req(req: { method?: string; url?: string; routerPath?: string; params?: unknown; headers?: Record<string, unknown> }) {
        return {
          method: req.method,
          url: req.url,
          path: req.routerPath,
          parameters: req.params,
          headers: {
            host: req.headers?.host,
            'user-agent': req.headers?.['user-agent'],
            'x-request-id': req.headers?.['x-request-id'],
          },
        };
      },
      res(res: { statusCode?: number }) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  };
}

