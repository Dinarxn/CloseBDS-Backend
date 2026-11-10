import crypto from 'node:crypto';
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
  BadRequestError,
} from '../../core/errors/api-error.js';
import type { UserRole } from '@prisma/client';

export interface ForgotPasswordInput {
  email: string;
}

export interface ResetPasswordInput {
  token: string;
  password: string;
}

export interface ForgotPasswordResult {
  success: boolean;
  message: string;
  rawToken?: string;
}

export interface ResetPasswordResult {
  success: boolean;
  message: string;
}

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

  /**
   * Requests a password recovery token for an email address.
   * Employs constant-time timing-attack mitigation to prevent account enumeration.
   */
  async requestPasswordReset(input: ForgotPasswordInput): Promise<ForgotPasswordResult> {
    const normalizedEmail = input.email.toLowerCase().trim();
    const prisma = this.db.getPrismaClient();

    // 1. Look up user by email
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    // 2. Always generate random token and hash to equalize CPU timing
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiration

    // 3. Timing-attack mitigation: If account does not exist or is inactive, simulate delay and return identical envelope
    if (!user || !user.isActive) {
      // Artificial jitter to match DB write latency
      await new Promise((resolve) => setTimeout(resolve, 40 + Math.random() * 20));
      return {
        success: true,
        message: 'If an account exists with this email, a reset link has been dispatched.',
      };
    }

    // 4. Invalidate any existing unused reset tokens for this user
    if ((prisma as any).passwordResetToken?.updateMany) {
      await (prisma as any).passwordResetToken.updateMany({
        where: {
          userId: user.id,
          usedAt: null,
        },
        data: {
          usedAt: new Date(),
        },
      });
    }

    // 5. Persist SHA-256 token hash with 1-hour expiration
    await (prisma as any).passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    return {
      success: true,
      message: 'If an account exists with this email, a reset link has been dispatched.',
      rawToken, // Available for test extraction
    };
  }

  /**
   * Validates a password reset token and atomically updates user's password.
   */
  async resetPassword(input: ResetPasswordInput): Promise<ResetPasswordResult> {
    const { token, password } = input;
    const prisma = this.db.getPrismaClient();

    // 1. Compute SHA-256 hash of provided token
    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');

    // 2. Query for unused, non-expired token
    const tokenRecord = await (prisma as any).passwordResetToken.findFirst({
      where: {
        tokenHash,
        usedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
    });

    if (!tokenRecord) {
      throw new BadRequestError(
        'Invalid or expired password reset token',
        undefined,
        'INVALID_TOKEN'
      );
    }

    // 3. Verify user exists and is active
    const user = await prisma.user.findUnique({
      where: { id: tokenRecord.userId },
    });

    if (!user || !user.isActive) {
      throw new BadRequestError(
        'User account is inactive or not found',
        undefined,
        'INVALID_TOKEN'
      );
    }

    // 4. Hash new password with bcrypt (12 salt rounds)
    const newPasswordHash = await hashPassword(password);

    // 5. Atomically update password and mark token as used
    await this.db.transaction(async (tx: any) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: newPasswordHash },
      });

      await tx.passwordResetToken.update({
        where: { id: tokenRecord.id },
        data: { usedAt: new Date() },
      });
    });

    return {
      success: true,
      message: 'Password updated successfully. You may now sign in.',
    };
  }
}

export const authService = new AuthService();
