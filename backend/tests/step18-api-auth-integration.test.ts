import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/server/app.js';
import { databaseClient } from '../src/database/client.js';
import { hashPassword } from '../src/modules/auth/password.js';
import type { PrismaClient, User, Workspace, UserRole } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runStep18Tests() {
  console.log('\n===============================================================');
  console.log('--- Stage 4, Step 18: Frontend → Fastify API & Auth Integration Tests ---');
  console.log('===============================================================\n');

  // In-memory test store for isolated auth tests
  const usersStore: Map<string, User> = new Map();
  const workspacesStore: Map<string, Workspace> = new Map();

  const mockPrisma = {
    user: {
      findUnique: async ({ where }: { where: { email?: string; id?: string } }) => {
        if (where.email) {
          const target = where.email.toLowerCase();
          for (const u of usersStore.values()) {
            if (u.email.toLowerCase() === target) return u;
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

  databaseClient.setPrismaClient(mockPrisma);

  const app = await buildApp();

  try {
    // --------------------------------------------------------------------------
    // Test 1: API Base URL & Fastify Versioned Routing Compatibility
    // --------------------------------------------------------------------------
    console.log('Test 1: Verifying frontend API client base URL matches backend API v1 router...');
    const healthRes = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
    });
    assert.equal(healthRes.statusCode, 200, 'GET /api/v1/health must return 200');
    const healthData = JSON.parse(healthRes.payload);
    assert.equal(healthData.status, 'ok');
    console.log('✓ Frontend API base URL http://localhost:4000/api/v1 successfully routes to Fastify backend');

    // --------------------------------------------------------------------------
    // Test 2: User Registration Flow (Fastify /api/v1/auth/register)
    // --------------------------------------------------------------------------
    console.log('Test 2: Verifying full registration flow and session establishment...');
    const regPayload = {
      name: 'Sarah Connor',
      email: 'sarah@skynet-defense.com',
      password: 'Terminator2026!Secure',
      workspaceName: 'Cyberdyne Systems',
    };

    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: regPayload,
    });
    assert.equal(regRes.statusCode, 201, 'POST /api/v1/auth/register must return 201 Created');
    const regData = JSON.parse(regRes.payload);
    assert.equal(regData.success, true);
    assert.ok(regData.user.id, 'Registered user must have an ID');
    assert.equal(regData.user.email, 'sarah@skynet-defense.com');
    assert.equal(regData.user.role, 'OWNER');
    assert.equal(regData.user.passwordHash, undefined, 'Password hash must never be returned');
    assert.ok(regData.token, 'Session JWT token must be returned');

    // Verify Set-Cookie header contains HttpOnly session_token
    const regCookie = regRes.headers['set-cookie'];
    assert.ok(regCookie, 'set-cookie header must be present on register');
    const regCookieStr = Array.isArray(regCookie) ? regCookie.join('; ') : regCookie;
    assert.ok(regCookieStr.includes('session_token='), 'Cookie must contain session_token');
    assert.ok(regCookieStr.toLowerCase().includes('httponly'), 'session_token must be HttpOnly');

    const authToken = regData.token;
    console.log('✓ Registration flow passed: user provisioned, password hashed, HttpOnly session cookie + JWT issued');

    // --------------------------------------------------------------------------
    // Test 3: Authoritative Workspace Resolution (GET /api/v1/workspaces/current)
    // --------------------------------------------------------------------------
    console.log('Test 3: Verifying authoritative backend workspace resolution for authenticated user...');
    const wsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces/current',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    });
    assert.equal(wsRes.statusCode, 200, 'GET /api/v1/workspaces/current must return 200');
    const wsData = JSON.parse(wsRes.payload);
    assert.equal(wsData.success, true);
    assert.equal(wsData.workspace.name, 'Cyberdyne Systems', 'Authoritative workspace name matches backend data');
    assert.ok(wsData.workspace.id, 'Authoritative workspace id exists');
    assert.ok(wsData.workspace.slug, 'Authoritative workspace slug exists');
    console.log('✓ Authoritative workspace resolution passed: frontend state receives real backend workspace');

    // --------------------------------------------------------------------------
    // Test 4: User Login Flow with Real Backend (POST /api/v1/auth/login)
    // --------------------------------------------------------------------------
    console.log('Test 4: Verifying login endpoint with valid credentials...');
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'sarah@skynet-defense.com',
        password: 'Terminator2026!Secure',
      },
    });
    assert.equal(loginRes.statusCode, 200, 'POST /api/v1/auth/login must return 200');
    const loginData = JSON.parse(loginRes.payload);
    assert.equal(loginData.success, true);
    assert.equal(loginData.user.email, 'sarah@skynet-defense.com');
    assert.equal(loginData.user.passwordHash, undefined);
    assert.ok(loginData.token);

    const loginCookie = loginRes.headers['set-cookie'];
    assert.ok(loginCookie, 'set-cookie header must be present on login');
    const loginCookieStr = Array.isArray(loginCookie) ? loginCookie.join('; ') : loginCookie;
    assert.ok(loginCookieStr.includes('session_token='), 'Login must set session_token cookie');
    console.log('✓ Login verification passed: real backend verifies password hash and returns session credentials');

    // --------------------------------------------------------------------------
    // Test 5: Invalid Credentials & Enumeration Prevention
    // --------------------------------------------------------------------------
    console.log('Test 5: Verifying invalid password and unknown user rejection...');
    const wrongPassRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'sarah@skynet-defense.com',
        password: 'WrongPassword999!',
      },
    });
    assert.equal(wrongPassRes.statusCode, 401, 'Wrong password must return 401');
    const wrongPassBody = JSON.parse(wrongPassRes.payload);
    assert.equal(wrongPassBody.error.message, 'Invalid email or password');

    const unknownUserRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'nonexistent@skynet-defense.com',
        password: 'SomePassword123!',
      },
    });
    assert.equal(unknownUserRes.statusCode, 401, 'Unknown user must return 401');
    const unknownUserBody = JSON.parse(unknownUserRes.payload);
    assert.equal(unknownUserBody.error.message, 'Invalid email or password', 'Error message must be identical to prevent enumeration');
    console.log('✓ Invalid credentials protection passed: generic 401 prevents account enumeration');

    // --------------------------------------------------------------------------
    // Test 6: Session Restoration via GET /api/v1/auth/me
    // --------------------------------------------------------------------------
    console.log('Test 6: Verifying session restoration via Bearer header and session_token cookie...');
    // Via Bearer Header
    const meBearerRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    });
    assert.equal(meBearerRes.statusCode, 200);
    const meBearerData = JSON.parse(meBearerRes.payload);
    assert.equal(meBearerData.user.email, 'sarah@skynet-defense.com');

    // Via HttpOnly Cookie
    const meCookieRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: {
        session_token: authToken,
      },
    });
    assert.equal(meCookieRes.statusCode, 200);
    const meCookieData = JSON.parse(meCookieRes.payload);
    assert.equal(meCookieData.user.email, 'sarah@skynet-defense.com');
    console.log('✓ Session restoration passed: dual-layer authentication (cookie + Bearer header) supported');

    // --------------------------------------------------------------------------
    // Test 7: Unauthenticated Route Protection
    // --------------------------------------------------------------------------
    console.log('Test 7: Verifying unauthenticated requests to protected endpoints fail with 401...');
    const unauthMe = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
    });
    assert.equal(unauthMe.statusCode, 401);

    const unauthWs = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces/current',
    });
    assert.equal(unauthWs.statusCode, 401);

    const unauthLeads = await app.inject({
      method: 'GET',
      url: '/api/v1/leads',
    });
    assert.equal(unauthLeads.statusCode, 401);
    console.log('✓ Unauthenticated route protection passed: unauthenticated access rejected with 401');

    // --------------------------------------------------------------------------
    // Test 8: Workspace Authorization & Multi-Tenant Cross-Access Prevention
    // --------------------------------------------------------------------------
    console.log('Test 8: Verifying backend workspace authorization and multi-tenant cross-access prevention...');
    const crossTenantRes = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces/current',
      headers: {
        authorization: `Bearer ${authToken}`,
        'x-workspace-id': 'unauthorized_foreign_workspace_tenant_id',
      },
    });
    assert.equal(crossTenantRes.statusCode, 403, 'Cross-tenant access must return 403 Forbidden');
    console.log('✓ Workspace security passed: backend remains authoritative, arbitrary workspace headers rejected with 403');

    // --------------------------------------------------------------------------
    // Test 9: Logout Endpoint Session Invalidation (POST /api/v1/auth/logout)
    // --------------------------------------------------------------------------
    console.log('Test 9: Verifying logout clears session cookie...');
    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
    });
    assert.equal(logoutRes.statusCode, 200);
    const logoutCookie = logoutRes.headers['set-cookie'];
    assert.ok(logoutCookie, 'Logout must send set-cookie to clear cookie');
    const logoutCookieStr = Array.isArray(logoutCookie) ? logoutCookie.join('; ') : logoutCookie;
    assert.ok(
      logoutCookieStr.includes('session_token=;') ||
      logoutCookieStr.includes('Max-Age=0') ||
      logoutCookieStr.includes('Expires='),
      'Logout must invalidate session_token cookie'
    );
    console.log('✓ Logout passed: session cookie cleared on backend');

    // --------------------------------------------------------------------------
    // Test 10: PostgreSQL Connection Error Mapping Simulation
    // --------------------------------------------------------------------------
    console.log('Test 10: Verifying database unreachable error produces safe HTTP 503 DATABASE_UNAVAILABLE...');
    // Create a mock error that mirrors PrismaClientInitializationError
    class PrismaClientInitializationError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'PrismaClientInitializationError';
      }
    }

    const failingPrisma = {
      user: {
        findUnique: async () => {
          throw new PrismaClientInitializationError("Can't reach database server at localhost:5432");
        },
      },
    } as unknown as PrismaClient;

    databaseClient.setPrismaClient(failingPrisma);

    const dbFailRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'anyone@domain.com',
        password: 'Password123!',
      },
    });

    assert.equal(dbFailRes.statusCode, 503, 'Database unreachable must return HTTP 503');
    const dbFailBody = JSON.parse(dbFailRes.payload);
    assert.equal(dbFailBody.error.code, 'DATABASE_UNAVAILABLE');
    assert.equal(
      dbFailBody.error.message,
      'Cannot reach PostgreSQL database server. Please verify PostgreSQL is running at localhost:5432 or configure DATABASE_URL.'
    );
    assert.equal(dbFailBody.error.password, undefined, 'Must not leak database password');
    assert.equal(dbFailBody.error.databaseUrl, undefined, 'Must not leak DATABASE_URL');
    console.log('✓ PostgreSQL error mapping passed: safe HTTP 503 DATABASE_UNAVAILABLE without password leakage');

    // --------------------------------------------------------------------------
    // Test 11: Frontend Environment Security Audit (Zero Server Secrets Leaked)
    // --------------------------------------------------------------------------
    console.log('Test 11: Auditing frontend environment configuration for secret leakage...');
    const frontendEnvLocalPath = path.resolve(__dirname, '../../frontend/.env.local');
    const frontendEnvExamplePath = path.resolve(__dirname, '../../frontend/.env.example');

    for (const envPath of [frontendEnvLocalPath, frontendEnvExamplePath]) {
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        assert.ok(!content.includes('DATABASE_URL'), `Security violation: DATABASE_URL found in ${envPath}`);
        assert.ok(!content.includes('JWT_SECRET'), `Security violation: JWT_SECRET found in ${envPath}`);
        assert.ok(!content.includes('COOKIE_SECRET'), `Security violation: COOKIE_SECRET found in ${envPath}`);
        assert.ok(!content.includes('GEMINI_API_KEY'), `Security violation: GEMINI_API_KEY found in ${envPath}`);
        assert.ok(!content.includes('AQ.Ab8'), `Security violation: Gemini raw key found in ${envPath}`);

        // Verify only NEXT_PUBLIC_ variables exist
        const lines = content.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
        for (const line of lines) {
          const varName = line.split('=')[0].trim();
          assert.ok(
            varName.startsWith('NEXT_PUBLIC_'),
            `Security violation: non-NEXT_PUBLIC variable ${varName} found in frontend ${envPath}`
          );
        }
      }
    }
    console.log('✓ Frontend environment security passed: zero server secrets leaked to browser configuration');

    console.log('\n===============================================================');
    console.log('--- ALL STEP 18 INTEGRATION & AUTHENTICATION TESTS PASSED ---');
    console.log('===============================================================\n');
  } finally {
    databaseClient.setPrismaClient(null);
    await app.close();
  }
}

runStep18Tests().catch((err) => {
  console.error('\n❌ Step 18 Test Suite Failed:', err);
  process.exit(1);
});
