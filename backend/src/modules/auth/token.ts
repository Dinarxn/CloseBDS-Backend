import jwt from 'jsonwebtoken';
import { config } from '../../config/index.js';
import { UnauthorizedError } from '../../core/errors/api-error.js';

export interface AuthTokenPayload {
  userId: string;
  workspaceId: string;
  email: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
}

/**
 * Signs a secure server-side JWT session token.
 */
export function signAuthToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: '7d',
    algorithm: 'HS256',
  });
}

/**
 * Verifies and decodes a JWT session token.
 * Throws UnauthorizedError if invalid or expired.
 */
export function verifyAuthToken(token: string): AuthTokenPayload {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET, {
      algorithms: ['HS256'],
    }) as AuthTokenPayload;

    if (!decoded.userId || !decoded.workspaceId) {
      throw new UnauthorizedError('Malformed session token');
    }

    return {
      userId: decoded.userId,
      workspaceId: decoded.workspaceId,
      email: decoded.email,
      role: decoded.role,
    };
  } catch {
    throw new UnauthorizedError('Invalid or expired authentication session');
  }
}
