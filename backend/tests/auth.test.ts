import assert from 'node:assert/strict';
import { buildApp } from '../src/server/app.js';
import { hashPassword, verifyPassword } from '../src/modules/auth/password.js';
import { signAuthToken, verifyAuthToken } from '../src/modules/auth/token.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { WorkspaceService } from '../src/modules/workspaces/workspace.service.js';
import { UserRepository, WorkspaceRepository } from '../src/database/repository.js';
import { databaseClient, type DatabaseClient } from '../src/database/client.js';
import { UnauthorizedError, ForbiddenError, ConflictError } from '../src/core/errors/api-error.js';
import type { PrismaClient, User, Workspace, UserRole } from '@prisma/client';

async function runAuthTests() {
  console.log('\n--- Starting closeVDS Authentication & Workspace Authorization Tests ---');

  // In-memory test store for isolated auth tests
  const usersStore: Map<string, User> = new Map();
  const workspacesStore: Map<string, Workspace> = new Map();

  const mockPrisma = {
    user: {
      findUnique: async ({ where }: { where: { email?: string; id?: string } }) => {
        if (where.email) {
          for (const u of usersStore.values()) {
            if (u.email.toLowerCase() === where.email.toLowerCase()) return u;
          }
        }
        if (where.id) return usersStore.get(where.id) || null;
        return null;
      },
      findFirst: async ({ where }: { where: { id?: string; workspaceId?: string; email?: string } }) => {
        for (const u of usersStore.values()) {
          const matchId = !where.id || u.id === where.id;
          const matchWs = !where.workspaceId || u.workspaceId === where.workspaceId;
          const matchEmail = !where.email || u.email.toLowerCase() === where.email.toLowerCase();
          if (matchId && matchWs && matchEmail) return u;
        }
        return null;
      },
      findMany: async ({ where }: { where: { workspaceId: string } }) => {
        return Array.from(usersStore.values()).filter((u) => u.workspaceId === where.workspaceId);
      },
      create: async ({ data }: { data: { workspaceId: string; email: string; name: string; passwordHash: string; role: UserRole; isActive: boolean } }) => {
        const id = `user_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const user: User = {
          id,
          workspaceId: data.workspaceId,
          email: data.email.toLowerCase(),
          name: data.name,
          passwordHash: data.passwordHash,
          role: data.role,
          isActive: data.isActive,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        usersStore.set(id, user);
        return user;
      },
    },
    workspace: {
      findUnique: async ({ where }: { where: { id?: string; slug?: string } }) => {
        if (where.id) return workspacesStore.get(where.id) || null;
        if (where.slug) {
          for (const ws of workspacesStore.values()) {
            if (ws.slug === where.slug) return ws;
          }
        }
        return null;
      },
      create: async ({ data }: { data: { name: string; slug: string } }) => {
        const id = `ws_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const ws: Workspace = {
          id,
          name: data.name,
          slug: data.slug,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        workspacesStore.set(id, ws);
        return ws;
      },
    },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      return cb(mockPrisma);
    },
  } as unknown as PrismaClient;

  // Set mock Prisma client on global databaseClient for full endpoint tests
  databaseClient.setPrismaClient(mockPrisma);

  const mockDbClient: DatabaseClient = {
    connect: async () => {},
    disconnect: async () => {},
    isConnected: () => true,
    healthCheck: async () => ({ ready: true, status: 'connected', message: 'OK' }),
    transaction: async (cb) => cb(mockPrisma),
    getPrismaClient: () => mockPrisma,
  };

  const testAuthService = new AuthService(mockDbClient);
  const testUserRepo = new UserRepository(mockDbClient);
  const testWorkspaceRepo = new WorkspaceRepository(mockDbClient);
  const testWorkspaceService = new WorkspaceService(testWorkspaceRepo, testUserRepo);

  try {
    // --------------------------------------------------------------------------
    // 1. Password Hashing & Verification
    // --------------------------------------------------------------------------
    console.log('Test 1-4: Secure password hashing, verification, no plaintext/logging...');
    const password = 'StrongPassword123!';
    const hash = await hashPassword(password);
    assert.notEqual(hash, password, 'Password must never remain in plaintext');
    assert.ok(hash.startsWith('$2'), 'Bcrypt hash signature must be present');
    assert.equal(await verifyPassword(password, hash), true, 'Valid password verification');
    assert.equal(await verifyPassword('WrongPassword', hash), false, 'Invalid password rejection');
    console.log('✓ Password hashing and verification passed');

    // --------------------------------------------------------------------------
    // 2. User Registration & Duplicate Email Protection
    // --------------------------------------------------------------------------
    console.log('Test 5-7: User registration, duplicate rejection, safe response...');
    const regResult = await testAuthService.register({
      email: 'founder@closevds.com',
      password: 'SecurePassword123!',
      name: 'Alex Mercer',
      workspaceName: 'Apex Acquisition',
    });

    assert.ok(regResult.user.id, 'User ID must be generated');
    assert.equal(regResult.user.email, 'founder@closevds.com');
    assert.equal(regResult.user.role, 'OWNER');
    assert.equal(regResult.user.isActive, true);
    assert.equal((regResult.user as unknown as Record<string, unknown>).passwordHash, undefined, 'Password hash must NOT be in public user');
    assert.ok(regResult.token, 'Session token must be issued');

    // Attempt duplicate registration
    await assert.rejects(
      async () => {
        await testAuthService.register({
          email: 'founder@closevds.com',
          password: 'AnotherPassword123!',
          name: 'Alex Imposter',
        });
      },
      ConflictError,
      'Duplicate email must throw ConflictError'
    );
    console.log('✓ Registration and duplicate prevention passed');

    // --------------------------------------------------------------------------
    // 3. User Authentication (Login) & Account Status
    // --------------------------------------------------------------------------
    console.log('Test 8-10: Login validation, invalid credentials, inactive accounts...');
    // Valid login
    const loginResult = await testAuthService.authenticate({
      email: 'founder@closevds.com',
      password: 'SecurePassword123!',
    });
    assert.equal(loginResult.user.email, 'founder@closevds.com');
    assert.equal((loginResult.user as unknown as Record<string, unknown>).passwordHash, undefined);
    assert.ok(loginResult.token);

    // Invalid password
    await assert.rejects(
      async () => {
        await testAuthService.authenticate({
          email: 'founder@closevds.com',
          password: 'IncorrectPassword',
        });
      },
      UnauthorizedError,
      'Invalid password must throw UnauthorizedError'
    );

    // Non-existent email (must throw same generic error to prevent user enumeration)
    await assert.rejects(
      async () => {
        await testAuthService.authenticate({
          email: 'unknown@closevds.com',
          password: 'SomePassword',
        });
      },
      UnauthorizedError,
      'Unknown email must throw UnauthorizedError'
    );

    // Inactive user check
    await mockPrisma.user.create({
      data: {
        workspaceId: regResult.user.workspaceId,
        email: 'inactive@closevds.com',
        name: 'Inactive Member',
        passwordHash: await hashPassword('Password123!'),
        role: 'MEMBER',
        isActive: false,
      },
    });

    await assert.rejects(
      async () => {
        await testAuthService.authenticate({
          email: 'inactive@closevds.com',
          password: 'Password123!',
        });
      },
      UnauthorizedError,
      'Inactive user must be rejected'
    );
    console.log('✓ Login verification and account status checks passed');

    // --------------------------------------------------------------------------
    // 4. Session Token Signing & Expiration Verification
    // --------------------------------------------------------------------------
    console.log('Test 11-12: JWT Session token signing, claims verification, invalid tokens...');
    const validToken = signAuthToken({
      userId: regResult.user.id,
      workspaceId: regResult.user.workspaceId,
      email: regResult.user.email,
      role: regResult.user.role,
    });

    const verified = verifyAuthToken(validToken);
    assert.equal(verified.userId, regResult.user.id);
    assert.equal(verified.workspaceId, regResult.user.workspaceId);

    assert.throws(
      () => {
        verifyAuthToken('invalid.jwt.token.string');
      },
      UnauthorizedError,
      'Malformed or invalid token must throw UnauthorizedError'
    );
    console.log('✓ JWT Session token verification passed');

    // --------------------------------------------------------------------------
    // 5. Fastify API Integration Tests (App Endpoints)
    // --------------------------------------------------------------------------
    console.log('Test 13-22: Fastify Auth & Workspace API Endpoints (/api/v1/auth/*, /api/v1/workspaces/*)...');
    const app = await buildApp();

    // Test 13: Unauthenticated /api/v1/auth/me -> 401
    const unauthMe = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
    });
    assert.equal(unauthMe.statusCode, 401);

    // Test 14: Unauthenticated /api/v1/workspaces/current -> 401
    const unauthWs = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces/current',
    });
    assert.equal(unauthWs.statusCode, 401);

    // Test 15: Malformed payload rejected by Zod -> 400
    const malformedRegister = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'not-an-email',
        password: 'short',
      },
    });
    assert.equal(malformedRegister.statusCode, 400);

    // Test 16: Successful API Registration
    const apiRegisterRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'cto@closevds.com',
        password: 'SecurePassword123!',
        name: 'CTO User',
        workspaceName: 'Tech Workspace',
      },
    });
    assert.equal(apiRegisterRes.statusCode, 201);
    const apiRegBody = JSON.parse(apiRegisterRes.payload);
    assert.equal(apiRegBody.success, true);
    assert.equal(apiRegBody.user.email, 'cto@closevds.com');
    assert.equal(apiRegBody.user.passwordHash, undefined);
    const registeredToken = apiRegBody.token;

    // Test 17: Successful API Login
    const apiLoginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'cto@closevds.com',
        password: 'SecurePassword123!',
      },
    });
    assert.equal(apiLoginRes.statusCode, 200);
    const apiLoginBody = JSON.parse(apiLoginRes.payload);
    assert.equal(apiLoginBody.success, true);

    // Test 18: Authenticated /api/v1/auth/me
    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: {
        authorization: `Bearer ${registeredToken}`,
      },
    });
    assert.equal(meRes.statusCode, 200);
    const meBody = JSON.parse(meRes.payload);
    assert.equal(meBody.success, true);
    assert.equal(meBody.user.email, 'cto@closevds.com');
    assert.equal(meBody.user.passwordHash, undefined);

    // Test 19: Authenticated /api/v1/workspaces/current
    const wsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces/current',
      headers: {
        authorization: `Bearer ${registeredToken}`,
      },
    });
    assert.equal(wsRes.statusCode, 200);
    const wsBody = JSON.parse(wsRes.payload);
    assert.equal(wsBody.success, true);
    assert.equal(wsBody.workspace.name, 'Tech Workspace');

    // Test 20: Authenticated /api/v1/workspaces/current/members
    const membersRes = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces/current/members',
      headers: {
        authorization: `Bearer ${registeredToken}`,
      },
    });
    assert.equal(membersRes.statusCode, 200);
    const membersBody = JSON.parse(membersRes.payload);
    assert.equal(membersBody.success, true);
    assert.ok(membersBody.members.length >= 1);
    assert.equal(membersBody.members[0].email, 'cto@closevds.com');
    assert.equal(membersBody.members[0].passwordHash, undefined);

    // Test 21: Logout endpoint clears cookies
    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
    });
    assert.equal(logoutRes.statusCode, 200);
    const logoutCookies = logoutRes.headers['set-cookie'];
    assert.ok(logoutCookies, 'Set-Cookie header should be present to clear session');

    // Test 22: Cross-workspace header attempt blocked -> 403 Forbidden
    const crossWsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces/current',
      headers: {
        authorization: `Bearer ${registeredToken}`,
        'x-workspace-id': 'workspace_different_tenant_999',
      },
    });
    assert.equal(crossWsRes.statusCode, 403, 'Cross-workspace tenant mismatch must return 403 Forbidden');

    // Test direct domain service assertions
    const currentWs = await testWorkspaceService.getCurrentWorkspace(regResult.user.workspaceId);
    assert.equal(currentWs.id, regResult.user.workspaceId);
    const wsMembers = await testWorkspaceService.getWorkspaceMembers(regResult.user.workspaceId);
    assert.ok(wsMembers.length >= 1);
    assert.equal(wsMembers[0].id, regResult.user.id);
    assert.equal((wsMembers[0] as unknown as Record<string, unknown>).passwordHash, undefined, 'Password hash must not be exposed');

    console.log('✓ Fastify API endpoints, workspace domain service, and security guards verified');

    await app.close();
    console.log('\n--- All Authentication & Workspace Tests Passed Successfully ---');
  } finally {
    // Reset global client mock state
    databaseClient.setPrismaClient(null);
  }
}

runAuthTests().catch((err) => {
  console.error('Auth & Authorization Test Suite Failed:', err);
  process.exit(1);
});
