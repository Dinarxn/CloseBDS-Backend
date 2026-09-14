import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { healthRouter } from './health/health.router.js';
import { v1Router } from './v1/router.js';

/**
 * Top-level API router registering global health and versioned routes.
 */
export const apiRouter: FastifyPluginAsync = async (fastify: FastifyInstance): Promise<void> => {
  // Global infrastructure health route: /health
  await fastify.register(healthRouter);

  // Version 1 API routes: /api/v1/*
  await fastify.register(v1Router, { prefix: '/api/v1' });
};
