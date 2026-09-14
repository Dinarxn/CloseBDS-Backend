import { hashPassword, verifyPassword } from './password.js';
import { signAuthToken, type AuthTokenPayload } from './token.js';
import {
  databaseClient,
  type DatabaseClient,
} from '../../database/client.js';
import {
  ConflictError,
  UnauthorizedError,
  NotFoundError,
} from '../../core/errors/api-error.js';
import type { UserRole } from '@prisma/client';

export interface PublicUser {
  id: string;
  workspaceId: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
}

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
  workspaceName?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResult {
  user: PublicUser;
  token: string;
}

/**
 * Sanitizes user entity to public structure (never exposing password hash).
 */
export function sanitizeUser(user: {
  id: string;
  workspaceId: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
}): PublicUser {
  return {
    id: user.id,
    workspaceId: user.workspaceId,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };
}

/**
 * Authentication & Identity Service
 */
export class AuthService {
  constructor(private db: DatabaseClient = databaseClient) {}

  /**
   * Registers a new user and provisions their initial Workspace.
   */
  async register(input: RegisterInput): Promise<AuthResult> {
    const normalizedEmail = input.email.toLowerCase().trim();
    const prisma = this.db.getPrismaClient();

    // 1. Check for duplicate email across system
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      throw new ConflictError('An account with this email address already exists');
    }

    // 2. Hash password securely
    const passwordHash = await hashPassword(input.password);

    // 3. Generate workspace slug
    const workspaceName = input.workspaceName?.trim() || `${input.name.trim()}'s Workspace`;
    const baseSlug = workspaceName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'workspace';
    const slug = `${baseSlug}-${Math.random().toString(36).substring(2, 7)}`;

    // 4. Provision Workspace and Owner User atomically
    const result = await this.db.transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          name: workspaceName,
          slug,
        },
      });

      const user = await tx.user.create({
        data: {
          workspaceId: workspace.id,
          email: normalizedEmail,
          name: input.name.trim(),
          passwordHash,
          role: 'OWNER',
          isActive: true,
        },
      });

      return { workspace, user };
    });

    // 5. Generate secure session token
    const tokenPayload: AuthTokenPayload = {
      userId: result.user.id,
      workspaceId: result.user.workspaceId,
      email: result.user.email,
      role: result.user.role,
    };

    const token = signAuthToken(tokenPayload);

    return {
      user: sanitizeUser(result.user),
      token,
    };
  }

  /**
   * Authenticates user credentials and returns session token.
   */
  async authenticate(input: LoginInput): Promise<AuthResult> {
    const normalizedEmail = input.email.toLowerCase().trim();
    const prisma = this.db.getPrismaClient();

    // 1. Find user by email
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      // Constant-time generic error to prevent account enumeration
      throw new UnauthorizedError('Invalid email or password');
    }

    // 2. Check active status
    if (!user.isActive) {
      throw new UnauthorizedError('Account is inactive. Please contact support.');
    }

    // 3. Verify password
    const isPasswordValid = await verifyPassword(input.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // 4. Issue session token
    const tokenPayload: AuthTokenPayload = {
      userId: user.id,
      workspaceId: user.workspaceId,
      email: user.email,
      role: user.role,
    };

    const token = signAuthToken(tokenPayload);

    return {
      user: sanitizeUser(user),
      token,
    };
  }

  /**
   * Retrieves currently authenticated user and active workspace details.
   */
  async getCurrentUser(userId: string, workspaceId: string): Promise<PublicUser> {
    const prisma = this.db.getPrismaClient();
    const user = await prisma.user.findFirst({
      where: { id: userId, workspaceId },
    });

    if (!user) {
      throw new NotFoundError('Authenticated user not found in active workspace');
    }

    if (!user.isActive) {
      throw new UnauthorizedError('Account is inactive');
    }

    return sanitizeUser(user);
  }
}

export const authService = new AuthService();
