import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAuthToken, type AuthTokenPayload } from '../../modules/auth/token.js';
import { UnauthorizedError, ForbiddenError } from '../errors/api-error.js';
import type { UserRole } from '@prisma/client';
import type { Permission } from './permission-gates.js';

declare module 'fastify' {
  interface FastifyRequest {
    authenticatedUser?: AuthTokenPayload;
  }
}

/**
 * Extracts session token from HttpOnly cookie or Authorization Bearer header.
 */
export function extractAuthToken(request: FastifyRequest): string | undefined {
  // 1. Check HttpOnly cookie
  const cookieToken = request.cookies?.session_token;
  if (cookieToken) {
    return cookieToken;
  }

  // 2. Check Authorization header: Bearer <token>
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }

  return undefined;
}

/**
 * Fastify preHandler hook requiring a valid authenticated user session.
 */
export async function requireAuthenticatedUser(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const token = extractAuthToken(request);
  if (!token) {
    throw new UnauthorizedError('Authentication required');
  }

  const payload = verifyAuthToken(token);
  request.authenticatedUser = payload;

  // Set workspace context automatically from authenticated token
  request.workspaceContext = {
    workspaceId: payload.workspaceId,
    userId: payload.userId,
    userRole: payload.role.toLowerCase() as 'owner' | 'admin' | 'member',
    requestId: request.id,
  };
}

/**
 * Fastify preHandler hook verifying that the authenticated user belongs to the requested workspace.
 */
export async function requireWorkspaceContext(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  if (!request.authenticatedUser || !request.workspaceContext?.workspaceId) {
    throw new UnauthorizedError('Valid workspace context is required');
  }

  // If a client specifies an explicit X-Workspace-Id header, verify it matches token
  const clientWorkspaceHeader = request.headers['x-workspace-id'];
  if (
    typeof clientWorkspaceHeader === 'string' &&
    clientWorkspaceHeader !== request.authenticatedUser.workspaceId
  ) {
    throw new ForbiddenError('Cross-workspace access is prohibited');
  }
}

/**
 * Fastify preHandler hook checking role authorization (e.g. ['OWNER', 'ADMIN']).
 */
export function requireRole(allowedRoles: UserRole[]) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    await requireAuthenticatedUser(request, _reply);

    const userRole = request.authenticatedUser?.role;
    if (!userRole || !allowedRoles.includes(userRole)) {
      throw new ForbiddenError(
        `Access denied. Requires one of roles: ${allowedRoles.join(', ')}`
      );
    }
  };
}

/**
 * Role-to-Permission mapping matrix
 */
const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  OWNER: [
    'campaigns:read',
    'campaigns:write',
    'leads:read',
    'leads:write',
    'outreach:draft',
    'outreach:approve',
    'outreach:dispatch',
    'settings:read',
    'settings:write',
    'audit:read',
  ],
  ADMIN: [
    'campaigns:read',
    'campaigns:write',
    'leads:read',
    'leads:write',
    'outreach:draft',
    'outreach:approve',
    'outreach:dispatch',
    'settings:read',
    'audit:read',
  ],
  MEMBER: [
    'campaigns:read',
    'leads:read',
    'leads:write',
    'outreach:draft',
  ],
};

/**
 * Fastify preHandler hook checking granular permission authorization.
 */
export function requirePermission(permission: Permission) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    await requireAuthenticatedUser(request, _reply);

    const userRole = request.authenticatedUser?.role;
    if (!userRole) {
      throw new ForbiddenError('No role assigned to authenticated user');
    }

    const permissions = ROLE_PERMISSIONS[userRole] || [];
    if (!permissions.includes(permission)) {
      throw new ForbiddenError(
        `Forbidden: Missing required permission '${permission}'`
      );
    }
  };
}
