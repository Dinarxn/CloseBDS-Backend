import assert from 'node:assert/strict';
import { buildApp } from '../src/server/app.js';
import { signAuthToken } from '../src/modules/auth/token.js';
import { SettingsService } from '../src/modules/settings/settings.service.js';
import { NotificationService } from '../src/modules/notifications/notification.service.js';
import {
  WorkspaceRepository,
  SuppressionRepository,
  NotificationRepository,
  AuditRepository,
} from '../src/database/repository.js';
import { databaseClient, type DatabaseClient } from '../src/database/client.js';
import { NotFoundError } from '../src/core/errors/api-error.js';
import type {
  PrismaClient,
  Workspace,
  Suppression,
  Notification,
  AuditLog,
  NotificationType,
} from '@prisma/client';

async function runSettingsNotificationsTests() {
  console.log('\n--- Starting closeVDS Settings & Notifications Tests ---');

  // In-memory test stores
  const workspacesStore: Map<string, Workspace> = new Map();
  const suppressionsStore: Map<string, Suppression> = new Map();
  const notificationsStore: Map<string, Notification> = new Map();
  const auditLogsStore: AuditLog[] = [];

  const mockPrisma = {
    workspace: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        return workspacesStore.get(where.id) || null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Workspace> }) => {
        const existing = workspacesStore.get(where.id);
        if (!existing) throw new Error('Not found');
        const updated: Workspace = { ...existing, ...data, updatedAt: new Date() };
        workspacesStore.set(where.id, updated);
        return updated;
      },
    },
    suppression: {
      findFirst: async ({ where }: { where: { id?: string; workspaceId?: string } }) => {
        for (const s of suppressionsStore.values()) {
          const matchId = !where.id || s.id === where.id;
          const matchWs = !where.workspaceId || s.workspaceId === where.workspaceId;
          if (matchId && matchWs) return s;
        }
        return null;
      },
      findMany: async ({ where, skip, take }: { where: { workspaceId: string; type?: string }; skip?: number; take?: number }) => {
        const results = Array.from(suppressionsStore.values()).filter(
          (s) => s.workspaceId === where.workspaceId && (!where.type || s.type === where.type)
        );
        if (skip !== undefined && take !== undefined) {
          return results.slice(skip, skip + take);
        }
        return results;
      },
      count: async ({ where }: { where: { workspaceId: string } }) => {
        return Array.from(suppressionsStore.values()).filter((s) => s.workspaceId === where.workspaceId).length;
      },
      upsert: async ({ create }: { create: { workspaceId: string; type: 'EMAIL' | 'DOMAIN'; value: string; reason: 'OPT_OUT' | 'HARD_BOUNCE' | 'MANUAL_SUPPRESSION' } }) => {
        const id = `sup_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const entry: Suppression = {
          id,
          workspaceId: create.workspaceId,
          type: create.type,
          value: create.value,
          reason: create.reason,
          createdAt: new Date(),
        };
        suppressionsStore.set(id, entry);
        return entry;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        suppressionsStore.delete(where.id);
        return true;
      },
    },
    notification: {
      findFirst: async ({ where }: { where: { id?: string; userId?: string; workspaceId?: string } }) => {
        for (const n of notificationsStore.values()) {
          const matchId = !where.id || n.id === where.id;
          const matchUser = !where.userId || n.userId === where.userId;
          const matchWs = !where.workspaceId || n.workspaceId === where.workspaceId;
          if (matchId && matchUser && matchWs) return n;
        }
        return null;
      },
      findMany: async ({ where, skip, take }: { where: { userId: string; workspaceId: string; isRead?: boolean; type?: NotificationType }; skip?: number; take?: number }) => {
        const results = Array.from(notificationsStore.values()).filter(
          (n) =>
            n.userId === where.userId &&
            n.workspaceId === where.workspaceId &&
            (where.isRead === undefined || n.isRead === where.isRead) &&
            (!where.type || n.type === where.type)
        );
        if (skip !== undefined && take !== undefined) {
          return results.slice(skip, skip + take);
        }
        return results;
      },
      count: async ({ where }: { where: { userId: string; workspaceId: string; isRead?: boolean } }) => {
        return Array.from(notificationsStore.values()).filter(
          (n) =>
            n.userId === where.userId &&
            n.workspaceId === where.workspaceId &&
            (where.isRead === undefined || n.isRead === where.isRead)
        ).length;
      },
      create: async ({ data }: { data: { workspaceId: string; userId: string; title: string; message: string; type: NotificationType } }) => {
        const id = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const entry: Notification = {
          id,
          workspaceId: data.workspaceId,
          userId: data.userId,
          title: data.title,
          message: data.message,
          type: data.type,
          isRead: false,
          createdAt: new Date(),
        };
        notificationsStore.set(id, entry);
        return entry;
      },
      update: async ({ where, data }: { where: { id: string }; data: { isRead: boolean } }) => {
        const existing = notificationsStore.get(where.id);
        if (!existing) throw new Error('Not found');
        const updated: Notification = { ...existing, ...data };
        notificationsStore.set(where.id, updated);
        return updated;
      },
      updateMany: async ({ where, data }: { where: { userId: string; workspaceId: string; isRead?: boolean }; data: { isRead: boolean } }) => {
        let count = 0;
        for (const [id, n] of notificationsStore.entries()) {
          if (n.userId === where.userId && n.workspaceId === where.workspaceId && (where.isRead === undefined || n.isRead === where.isRead)) {
            notificationsStore.set(id, { ...n, ...data });
            count++;
          }
        }
        return { count };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        notificationsStore.delete(where.id);
        return true;
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const entry = { id: `audit_${Date.now()}`, ...data, createdAt: new Date() } as unknown as AuditLog;
        auditLogsStore.push(entry);
        return entry;
      },
    },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(mockPrisma),
  } as unknown as PrismaClient;

  databaseClient.setPrismaClient(mockPrisma);

  const mockDbClient: DatabaseClient = {
    connect: async () => {},
    disconnect: async () => {},
    isConnected: () => true,
    healthCheck: async () => ({ ready: true, status: 'connected', message: 'OK' }),
    transaction: async (cb) => cb(mockPrisma),
    getPrismaClient: () => mockPrisma,
  };

  const testWorkspaceRepo = new WorkspaceRepository(mockDbClient);
  const testSuppressionRepo = new SuppressionRepository(mockDbClient);
  const testNotificationRepo = new NotificationRepository(mockDbClient);
  const testAuditRepo = new AuditRepository(mockDbClient);

  const testSettingsService = new SettingsService(
    testWorkspaceRepo,
    testSuppressionRepo,
    testAuditRepo
  );

  const testNotificationService = new NotificationService(testNotificationRepo);

  const workspaceA = 'ws_alpha_111';
  const workspaceB = 'ws_beta_222';
  const userA = 'user_alpha_1';
  const userB = 'user_beta_2';

  const tokenA = signAuthToken({
    userId: userA,
    workspaceId: workspaceA,
    email: 'user_a@company.com',
    role: 'OWNER',
  });

  const tokenB = signAuthToken({
    userId: userB,
    workspaceId: workspaceB,
    email: 'user_b@other.com',
    role: 'OWNER',
  });

  // Seed workspaces
  const wsA: Workspace = {
    id: workspaceA,
    name: 'Harley Dental Group',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  workspacesStore.set(wsA.id, wsA);

  const wsB: Workspace = {
    id: workspaceB,
    name: 'Other Clinic',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  workspacesStore.set(wsB.id, wsB);

  try {
    // --------------------------------------------------------------------------
    // 1. Workspace Settings & Provider Configuration Status
    // --------------------------------------------------------------------------
    console.log('Test 1-3: Workspace settings and safe provider status check...');
    const settings = await testSettingsService.getWorkspaceSettings(workspaceA);
    assert.equal(settings.id, workspaceA);
    assert.equal(settings.name, 'Harley Dental Group');

    const updatedSettings = await testSettingsService.updateWorkspaceSettings(workspaceA, userA, {
      name: 'Harley Medical & Dental Group',
      killSwitchActive: false,
    });
    assert.equal(updatedSettings.name, 'Harley Medical & Dental Group');

    const providerStatus = await testSettingsService.getProviderStatus();
    assert.ok(Array.isArray(providerStatus));
    assert.ok(providerStatus.some((p) => p.provider === 'OpenAI'));
    assert.ok(providerStatus.some((p) => p.provider === 'Resend'));
    for (const p of providerStatus) {
      assert.ok(!('apiKey' in p));
      assert.ok(!('secret' in p));
      assert.ok(['CONFIGURED', 'NOT_CONFIGURED'].includes(p.status));
    }
    console.log('✓ Workspace settings and safe provider status passed');

    // --------------------------------------------------------------------------
    // 2. Suppression Management & Multi-Tenant Isolation
    // --------------------------------------------------------------------------
    console.log('Test 4-6: Suppression list CRUD and tenant isolation...');
    const sup1 = await testSettingsService.addSuppression(workspaceA, userA, {
      type: 'EMAIL',
      value: 'optout@patient.com',
      reason: 'OPT_OUT',
    });
    assert.ok(sup1.id);
    assert.equal(sup1.value, 'optout@patient.com');

    const supList = await testSettingsService.listSuppressions(workspaceA, { page: 1, limit: 10 });
    assert.equal(supList.total, 1);

    // Cross-tenant deletion attempt must fail
    await assert.rejects(
      async () => {
        await testSettingsService.removeSuppression(sup1.id, workspaceB, userB);
      },
      NotFoundError,
      'Cross-tenant suppression deletion must be blocked'
    );

    const deleted = await testSettingsService.removeSuppression(sup1.id, workspaceA, userA);
    assert.equal(deleted, true);
    console.log('✓ Suppression CRUD and tenant isolation passed');

    // --------------------------------------------------------------------------
    // 3. In-App Notifications: Events, Retrieval, Mark Read, Isolation
    // --------------------------------------------------------------------------
    console.log('Test 7-11: Notification creation, event generation, and single retrieval...');
    const notif1 = await testNotificationService.createEventNotification(
      workspaceA,
      userA,
      'LEAD_QUALIFIED',
      { businessName: 'Apex Dental' }
    );
    assert.ok(notif1.id);
    assert.equal(notif1.title, 'Lead Qualified');
    assert.equal(notif1.type, 'SUCCESS');
    assert.equal(notif1.isRead, false);

    // Single notification retrieval
    const retrieved = await testNotificationService.getNotification(notif1.id, userA, workspaceA);
    assert.equal(retrieved.id, notif1.id);

    // Cross-user / cross-tenant notification retrieval must fail
    await assert.rejects(
      async () => {
        await testNotificationService.getNotification(notif1.id, userB, workspaceB);
      },
      NotFoundError,
      'Cross-tenant notification access must be blocked'
    );

    const unreadCount1 = await testNotificationService.getUnreadCount(userA, workspaceA);
    assert.equal(unreadCount1, 1);

    // Mark single notification as read
    const marked = await testNotificationService.markAsRead(notif1.id, userA, workspaceA);
    assert.equal(marked.isRead, true);

    const unreadCount2 = await testNotificationService.getUnreadCount(userA, workspaceA);
    assert.equal(unreadCount2, 0);
    console.log('✓ Notification event generation, retrieval, and reading passed');

    // --------------------------------------------------------------------------
    // 4. Fastify HTTP Endpoints (/api/v1/settings/* and /api/v1/notifications/*)
    // --------------------------------------------------------------------------
    console.log('Test 12-18: Fastify Settings & Notification HTTP Routes...');
    const app = await buildApp();

    // 1. GET /settings/workspace
    const getWsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/settings/workspace',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(getWsRes.statusCode, 200);

    // 2. GET /settings/providers
    const getProvRes = await app.inject({
      method: 'GET',
      url: '/api/v1/settings/providers',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(getProvRes.statusCode, 200);

    // 3. POST /notifications - Create notification via HTTP
    const createNotifRes = await app.inject({
      method: 'POST',
      url: '/api/v1/notifications',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        title: 'Task Assigned',
        message: 'A follow-up task has been assigned to you.',
        type: 'INFO',
      },
    });
    assert.equal(createNotifRes.statusCode, 201);
    const createdNotifId = JSON.parse(createNotifRes.payload).notification.id;

    // 4. GET /notifications/:id
    const getSingleNotifRes = await app.inject({
      method: 'GET',
      url: `/api/v1/notifications/${createdNotifId}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(getSingleNotifRes.statusCode, 200);

    // 5. POST /notifications/:id/read
    const markOneRes = await app.inject({
      method: 'POST',
      url: `/api/v1/notifications/${createdNotifId}/read`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(markOneRes.statusCode, 200);

    // 6. POST /notifications/read-all
    const markAllRes = await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/read-all',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(markAllRes.statusCode, 200);

    // 7. DELETE /notifications/:id
    const deleteNotifRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/notifications/${createdNotifId}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(deleteNotifRes.statusCode, 200);

    await app.close();
    console.log('✓ Fastify Settings and Notification HTTP routes passed');
    console.log('\n--- All Settings & Notifications Tests Passed Successfully ---');
  } finally {
    databaseClient.setPrismaClient(null);
  }
}

runSettingsNotificationsTests().catch((err) => {
  console.error('Settings & Notifications Test Suite Failed:', err);
  process.exit(1);
});
