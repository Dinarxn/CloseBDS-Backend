import type { FastifyCorsOptions } from '@fastify/cors';
import type { FastifyHelmetOptions } from '@fastify/helmet';
import type { RateLimitOptions } from '@fastify/rate-limit';
import { KillSwitchActiveError } from '../errors/api-error.js';

export interface SecurityConfig {
  corsOrigin: string;
  bodyLimitBytes: number;
  rateLimitMax: number;
  rateLimitTimeWindowMs: number;
  killSwitchActive: boolean;
}

/**
 * Helmet security headers configuration adhering to strict security rules.
 */
export function getHelmetConfig(): FastifyHelmetOptions {
  return {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'validator.swagger.io'],
        scriptSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    originAgentCluster: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    strictTransportSecurity: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    xContentTypeOptions: true,
    xDnsPrefetchControl: { allow: false },
    xDownloadOptions: true,
    xFrameOptions: { action: 'deny' },
    xPermittedCrossDomainPolicies: { permittedPolicies: 'none' },
    xXssProtection: true,
  };
}

/**
 * CORS configuration restricting origins to configured frontend URL.
 */
export function getCorsConfig(corsOrigin: string): FastifyCorsOptions {
  return {
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin) {
        callback(null, true);
        return;
      }

      // If wildcards or exact match
      if (corsOrigin === '*' || origin === corsOrigin) {
        callback(null, true);
        return;
      }

      // Check comma-separated origins if configured
      const allowedOrigins = corsOrigin.split(',').map((o) => o.trim());
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      // In development or local testing, allow localhost and 127.0.0.1 origins
      if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Blocked by CORS policy'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Workspace-Id', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86400,
  };
}

/**
 * Rate limiting configuration for Fastify.
 */
export function getRateLimitConfig(max = 100, timeWindowMs = 60000): RateLimitOptions {
  return {
    max,
    timeWindow: timeWindowMs,
    allowList: ['127.0.0.1', 'localhost', '::1'],
    errorResponseBuilder: () => ({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit exceeded. Please slow down your requests.',
      },
    }),
  };
}

/**
 * Validates whether the global outreach kill switch is active.
 * When active, any outgoing outreach action is halted immediately.
 */
export function assertKillSwitchNotActive(isKillSwitchActive: boolean): void {
  if (isKillSwitchActive) {
    throw new KillSwitchActiveError('Global Outreach Kill Switch is active. All outreach actions are halted.');
  }
}
