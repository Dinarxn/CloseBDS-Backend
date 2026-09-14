import type { FastifyPluginAsync } from 'fastify';
import { authService } from './auth.service.js';
import { registerSchema, loginSchema } from './auth.schema.js';
import { requireAuthenticatedUser } from '../../core/permissions/auth-guards.js';
import { config } from '../../config/index.js';

export const authRouter: FastifyPluginAsync = async (fastify): Promise<void> => {
  // 1. POST /api/v1/auth/register
  fastify.post(
    '/register',
    {
      config: {
        rateLimit: {
          max: config.AUTH_RATE_LIMIT_MAX,
          timeWindow: config.AUTH_RATE_LIMIT_WINDOW_MS,
        },
      },
    },
    async (request, reply) => {
      const parsedBody = registerSchema.parse(request.body);
      const result = await authService.register(parsedBody);

      // Set secure HttpOnly session cookie
      reply.setCookie('session_token', result.token, {
        path: '/',
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
      });

      return reply.status(201).send({
        success: true,
        user: result.user,
        token: result.token,
      });
    }
  );

  // 2. POST /api/v1/auth/login
  fastify.post(
    '/login',
    {
      config: {
        rateLimit: {
          max: config.AUTH_RATE_LIMIT_MAX,
          timeWindow: config.AUTH_RATE_LIMIT_WINDOW_MS,
        },
      },
    },
    async (request, reply) => {
      const parsedBody = loginSchema.parse(request.body);
      const result = await authService.authenticate(parsedBody);

      // Set secure HttpOnly session cookie
      reply.setCookie('session_token', result.token, {
        path: '/',
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60,
      });

      return reply.status(200).send({
        success: true,
        user: result.user,
        token: result.token,
      });
    }
  );

  // 3. POST /api/v1/auth/logout
  fastify.post(
    '/logout',
    async (_request, reply) => {
      reply.clearCookie('session_token', {
        path: '/',
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: 'lax',
      });

      return reply.status(200).send({
        success: true,
        message: 'Logged out successfully',
      });
    }
  );

  // 4. GET /api/v1/auth/me
  fastify.get(
    '/me',
    {
      preHandler: [requireAuthenticatedUser],
    },
    async (request, reply) => {
      const authUser = request.authenticatedUser!;
      const user = await authService.getCurrentUser(authUser.userId, authUser.workspaceId);

      return reply.status(200).send({
        success: true,
        user,
      });
    }
  );
};
