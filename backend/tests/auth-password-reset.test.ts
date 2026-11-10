import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server/app.js';
import { databaseClient } from '../src/database/client.js';
import { hashPassword } from '../src/modules/auth/password.js';
import type { PrismaClient, User, Workspace, UserRole } from '@prisma/client';

interface PasswordResetTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

async function runPasswordResetTestSuite() {
  console.log('\n--- Starting closeVDS Password Recovery & Reset Test Suite ---');

  // In-memory test stores
  const usersStore: Map<string, User> = new Map();
  const workspacesStore: Map<string, Workspace> = new Map();
  const tokensStore: Map<string, PasswordResetTokenRecord> = new Map();

  const mockPrisma = {
    user: {
      findUnique: async ({ where }: { where: { email?: string; id?: string } }) => {
        if (where.email) {
          const lower = where.email.toLowerCase();
          for (const u of usersStore.values()) {
            if (u.email.toLowerCase() === lower) return u;
          }
        }
        if (where.id) return usersStore.get(where.id) || null;
        return null;
      },
      update: async ({ where, data }: { where: { id: string }; data: any }) => {
        const u = usersStore.get(where.id);
        if (!u) throw new Error('User not found');
        const updated = { ...u, ...data, updatedAt: new Date() };
        usersStore.set(where.id, updated);
        return updated;
      },
    },
    passwordResetToken: {
      create: async ({ data }: { data: any }) => {
        const id = `prt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const record: PasswordResetTokenRecord = {
          id,
          userId: data.userId,
          tokenHash: data.tokenHash,
          expiresAt: data.expiresAt,
          usedAt: data.usedAt || null,
          createdAt: new Date(),
        };
        tokensStore.set(id, record);
        return record;
      },
      findFirst: async ({ where }: { where: any }) => {
        for (const t of tokensStore.values()) {
          if (where.tokenHash && t.tokenHash !== where.tokenHash) continue;
          if (where.usedAt === null && t.usedAt !== null) continue;
          if (where.expiresAt?.gt && t.expiresAt <= where.expiresAt.gt) continue;
          return t;
        }
        return null;
      },
      update: async ({ where, data }: { where: { id: string }; data: any }) => {
        const t = tokensStore.get(where.id);
        if (!t) throw new Error('Token record not found');
        const updated = { ...t, ...data };
        tokensStore.set(where.id, updated);
        return updated;
      },
      updateMany: async ({ where, data }: { where: any; data: any }) => {
        let count = 0;
        for (const [id, t] of tokensStore.entries()) {
          if (where.userId && t.userId !== where.userId) continue;
          if (where.usedAt === null && t.usedAt !== null) continue;
          tokensStore.set(id, { ...t, ...data });
          count++;
        }
        return { count };
      },
    },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      return cb(mockPrisma);
    },
  } as unknown as PrismaClient;

  // Set mock Prisma client on global databaseClient
  databaseClient.setPrismaClient(mockPrisma);

  try {
    // Seed initial workspace and user
    const wsId = 'ws_test_tenant_1';
    const userId = 'user_active_operator_1';
    const userEmail = 'operator@growthscale.com';
    const initialPasswordHash = await hashPassword('InitialSecretPassword123!');

    usersStore.set(userId, {
      id: userId,
      workspaceId: wsId,
      email: userEmail,
      name: 'Sarah Connor',
      passwordHash: initialPasswordHash,
      role: 'OWNER' as UserRole,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const app = await buildApp();

    // -------------------------------------------------------------------------
    // TEST 1: POST /api/v1/auth/forgot-password - Invalid body validation (400)
    // -------------------------------------------------------------------------
    console.log('Test 1: Forgot-password rejects malformed email with 400...');
    const invalidEmailRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'not-a-valid-email' },
    });
    assert.equal(invalidEmailRes.statusCode, 400);
    const invalidBody = JSON.parse(invalidEmailRes.payload);
    assert.equal(invalidBody.error.code, 'VALIDATION_ERROR');
    console.log('✓ Validation error returned for malformed email');

    // -------------------------------------------------------------------------
    // TEST 2: POST /api/v1/auth/forgot-password - Non-existent email timing safe (200)
    // -------------------------------------------------------------------------
    console.log('Test 2: Forgot-password with non-existent email returns 200 without leaking existence...');
    const nonExistentRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'nobody_unknown@example.com' },
    });
    assert.equal(nonExistentRes.statusCode, 200);
    const nonExistentBody = JSON.parse(nonExistentRes.payload);
    assert.equal(nonExistentBody.success, true);
    assert.match(nonExistentBody.message, /If an account exists/);
    assert.equal(tokensStore.size, 0, 'No token should be created for non-existent user');
    console.log('✓ Non-existent user returned identical 200 success envelope');

    // -------------------------------------------------------------------------
    // TEST 3: POST /api/v1/auth/forgot-password - Existing user token creation (200)
    // -------------------------------------------------------------------------
    console.log('Test 3: Forgot-password for registered user creates token hash in DB...');
    const validForgotRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: userEmail },
    });
    assert.equal(validForgotRes.statusCode, 200);
    const validForgotBody = JSON.parse(validForgotRes.payload);
    assert.equal(validForgotBody.success, true);
    assert.ok(validForgotBody.testToken, 'Test token should be provided in test environment');
    assert.equal(tokensStore.size, 1, 'One reset token record should be persisted');

    const createdToken = Array.from(tokensStore.values())[0];
    assert.equal(createdToken.userId, userId);
    assert.equal(createdToken.usedAt, null);
    assert.ok(createdToken.expiresAt.getTime() > Date.now());

    // Verify SHA-256 hash
    const expectedHash = crypto.createHash('sha256').update(validForgotBody.testToken).digest('hex');
    assert.equal(createdToken.tokenHash, expectedHash, 'Database must store SHA-256 hash, not plaintext');
    console.log('✓ Reset token created with SHA-256 hash and 1h expiration');

    // -------------------------------------------------------------------------
    // TEST 4: Subsequent forgot-password invalidates older tokens
    // -------------------------------------------------------------------------
    console.log('Test 4: Subsequent request invalidates prior token...');
    const secondForgotRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: userEmail },
    });
    assert.equal(secondForgotRes.statusCode, 200);
    const secondForgotBody = JSON.parse(secondForgotRes.payload);
    assert.equal(tokensStore.size, 2);

    const firstToken = tokensStore.get(createdToken.id)!;
    assert.ok(firstToken.usedAt !== null, 'Older token must be invalidated');
    console.log('✓ Prior reset token invalidated upon new request');

    const activeRawToken = secondForgotBody.testToken;

    // -------------------------------------------------------------------------
    // TEST 5: POST /api/v1/auth/reset-password - Validation failure (400)
    // -------------------------------------------------------------------------
    console.log('Test 5: Reset-password rejects passwords shorter than 8 chars with 400...');
    const shortPassRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: {
        token: activeRawToken,
        password: 'short',
      },
    });
    assert.equal(shortPassRes.statusCode, 400);
    const shortPassBody = JSON.parse(shortPassRes.payload);
    assert.equal(shortPassBody.error.code, 'VALIDATION_ERROR');
    console.log('✓ Validation error returned for short password');

    // -------------------------------------------------------------------------
    // TEST 6: POST /api/v1/auth/reset-password - Invalid token string (400)
    // -------------------------------------------------------------------------
    console.log('Test 6: Reset-password rejects fabricated token with 400 INVALID_TOKEN...');
    const badTokenRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: {
        token: 'fabricated_invalid_token_hex_1234567890abcdef',
        password: 'BrandNewSecurePassword456!',
      },
    });
    assert.equal(badTokenRes.statusCode, 400);
    const badTokenBody = JSON.parse(badTokenRes.payload);
    assert.equal(badTokenBody.error.code, 'INVALID_TOKEN');
    console.log('✓ Fabricated token rejected with INVALID_TOKEN');

    // -------------------------------------------------------------------------
    // TEST 7: POST /api/v1/auth/reset-password - Expired token (400)
    // -------------------------------------------------------------------------
    console.log('Test 7: Reset-password rejects expired token...');
    const expiredRawToken = crypto.randomBytes(32).toString('hex');
    const expiredHash = crypto.createHash('sha256').update(expiredRawToken).digest('hex');
    tokensStore.set('expired_tok_id', {
      id: 'expired_tok_id',
      userId,
      tokenHash: expiredHash,
      expiresAt: new Date(Date.now() - 10000), // 10s in the past
      usedAt: null,
      createdAt: new Date(Date.now() - 3600000),
    });

    const expiredRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: {
        token: expiredRawToken,
        password: 'BrandNewSecurePassword456!',
      },
    });
    assert.equal(expiredRes.statusCode, 400);
    const expiredBody = JSON.parse(expiredRes.payload);
    assert.equal(expiredBody.error.code, 'INVALID_TOKEN');
    console.log('✓ Expired token rejected with INVALID_TOKEN');

    // -------------------------------------------------------------------------
    // TEST 8: POST /api/v1/auth/reset-password - Successful password reset (200)
    // -------------------------------------------------------------------------
    console.log('Test 8: Successful reset updates password hash and marks token used...');
    const newPassword = 'BrandNewSecurePassword456!';
    const successfulResetRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: {
        token: activeRawToken,
        password: newPassword,
      },
    });
    assert.equal(successfulResetRes.statusCode, 200);
    const resetBody = JSON.parse(successfulResetRes.payload);
    assert.equal(resetBody.success, true);
    assert.match(resetBody.message, /Password updated successfully/);

    // Verify token marked used
    const activeTokenRecord = Array.from(tokensStore.values()).find(
      (t) => t.tokenHash === crypto.createHash('sha256').update(activeRawToken).digest('hex')
    )!;
    assert.ok(activeTokenRecord.usedAt !== null, 'Token must be marked as used');

    // Verify password hash updated in user store
    const updatedUser = usersStore.get(userId)!;
    assert.notEqual(updatedUser.passwordHash, initialPasswordHash, 'Password hash must change');
    console.log('✓ Password reset succeeded and token marked usedAt');

    // -------------------------------------------------------------------------
    // TEST 9: Token reuse is prohibited (400)
    // -------------------------------------------------------------------------
    console.log('Test 9: Replay attack with consumed token is rejected...');
    const replayRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: {
        token: activeRawToken,
        password: 'AnotherPassword789!',
      },
    });
    assert.equal(replayRes.statusCode, 400);
    const replayBody = JSON.parse(replayRes.payload);
    assert.equal(replayBody.error.code, 'INVALID_TOKEN');
    console.log('✓ Replay attack blocked with INVALID_TOKEN');

    // -------------------------------------------------------------------------
    // TEST 10: Old password fails login (401)
    // -------------------------------------------------------------------------
    console.log('Test 10: Login with old password fails with 401...');
    const oldLoginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: userEmail,
        password: 'InitialSecretPassword123!',
      },
    });
    assert.equal(oldLoginRes.statusCode, 401);
    console.log('✓ Old password revoked');

    // -------------------------------------------------------------------------
    // TEST 11: New password succeeds login (200)
    // -------------------------------------------------------------------------
    console.log('Test 11: Login with new password succeeds with 200...');
    const newLoginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: userEmail,
        password: newPassword,
      },
    });
    assert.equal(newLoginRes.statusCode, 200);
    const loginBody = JSON.parse(newLoginRes.payload);
    assert.equal(loginBody.success, true);
    assert.ok(loginBody.token, 'JWT session token must be issued');
    console.log('✓ Authenticated session obtained using newly set password');

    // -------------------------------------------------------------------------
    // TEST 12: Rate limit enforcement (5 req/15min)
    // -------------------------------------------------------------------------
    console.log('Test 12: Rate limiter blocks 6th request from same IP with 429...');
    const rateLimitedApp = await buildApp();
    const attackerIp = '198.51.100.42'; // Non-allowlisted external IP

    let wasRateLimited = false;
    for (let i = 1; i <= 6; i++) {
      const res = await rateLimitedApp.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        remoteAddress: attackerIp,
        payload: { email: `probe_${i}@target.com` },
      });

      if (i <= 5) {
        assert.equal(res.statusCode, 200, `Request ${i} should succeed within quota`);
      } else {
        assert.equal(res.statusCode, 429, '6th request must trigger 429 Rate Limit Exceeded');
        const resBody = JSON.parse(res.payload);
        assert.equal(resBody.error.code, 'RATE_LIMIT_EXCEEDED');
        wasRateLimited = true;
      }
    }
    assert.ok(wasRateLimited, 'Rate limiting must block excess recovery attempts');
    console.log('✓ Rate limiting strictly enforced at 5 req/15min');

    await app.close();
    await rateLimitedApp.close();
    console.log('\n--- All Password Reset & Recovery Tests Passed Successfully ---');
  } finally {
    databaseClient.setPrismaClient(null);
  }
}

runPasswordResetTestSuite().catch((err) => {
  console.error('Password Reset Test Suite Failed:', err);
  process.exit(1);
});
