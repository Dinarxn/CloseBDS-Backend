import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import { config } from '../config/index.js';
import { fastifyErrorHandler } from '../core/errors/error-handler.js';
import { getLoggerConfig } from '../core/logging/logger.js';
import { getCorsConfig, getHelmetConfig, getRateLimitConfig } from '../core/security/security.js';
import { registerAppHooks } from '../api/hooks/index.js';
import { apiRouter } from '../api/index.js';

export interface AppBuildOptions {
  serverOptions?: FastifyServerOptions;
}

/**
 * Builds and configures the Fastify application instance.
 * Decoupled from network socket listening to enable clean testing.
 */
export async function buildApp(options: AppBuildOptions = {}): Promise<FastifyInstance> {
  const isProduction = config.NODE_ENV === 'production';

  const fastify = Fastify({
    logger: getLoggerConfig(config.LOG_LEVEL, isProduction),
    bodyLimit: config.BODY_LIMIT_BYTES,
    trustProxy: true,
    ...options.serverOptions,
  });

  // 1. Centralized Error & 404 Handlers
  fastify.setErrorHandler(fastifyErrorHandler);
  fastify.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${request.method}:${request.url} not found`,
        requestId: request.id,
      },
    });
  });

  // 2. Security Plugins (Helmet, CORS, Rate Limiting, Cookie)
  await fastify.register(helmet, getHelmetConfig());
  await fastify.register(cors, getCorsConfig(config.CORS_ORIGIN));
  await fastify.register(
    rateLimit,
    getRateLimitConfig(config.RATE_LIMIT_MAX, config.RATE_LIMIT_TIME_WINDOW_MS)
  );
  await fastify.register(cookie, {
    secret: config.COOKIE_SECRET,
    hook: 'onRequest',
  });

  // 3. Lifecycle Hooks
  await registerAppHooks(fastify);

  // 4. API Routes (Global health + versioned /api/v1)
  await fastify.register(apiRouter);

  return fastify;
}
