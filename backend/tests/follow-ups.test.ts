import assert from 'node:assert/strict';
import { buildApp } from '../src/server/app.js';
import { signAuthToken } from '../src/modules/auth/token.js';
import { FollowUpService } from '../src/modules/follow-ups/follow-up.service.js';
import {
  TaskRepository,
  CRMActivityRepository,
  AuditRepository,
  type TaskWithRelations,
} from '../src/database/repository.js';
import { databaseClient, type DatabaseClient } from '../src/database/client.js';
import { NotFoundError, BadRequestError } from '../src/core/errors/api-error.js';
import type {
  PrismaClient,
  Lead,
  User,
  Task,
  CRMActivity,
  AuditLog,
  TaskStatus,
  CRMActivityType,
} from '@prisma/client';

async function runFollowUpTests() {
  console.log('\n--- Starting closeVDS Follow-Up & Task Tests (Hardened) ---');

  // In-memory test stores
  const usersStore: Map<string, User> = new Map();
  const leadsStore: Map<string, Lead> = new Map();
  const tasksStore: Map<string, Task> = new Map();
  const crmActivitiesStore: Map<string, CRMActivity> = new Map();
  const auditLogsStore: AuditLog[] = [];

  const mockPrisma = {
    user: {
      findFirst: async ({ where }: { where: { id?: string; workspaceId?: string; isActive?: boolean } }) => {
        for (const u of usersStore.values()) {
          const matchId = !where.id || u.id === where.id;
          const matchWs = !where.workspaceId || u.workspaceId === where.workspaceId;
          const matchActive = where.isActive === undefined || u.isActive === where.isActive;
          if (matchId && matchWs && matchActive) return u;
        }
        return null;
      },
    },
    lead: {
      findFirst: async ({ where }: { where: { id?: string; workspaceId?: string } }) => {
        for (const lead of leadsStore.values()) {
          const matchId = !where.id || lead.id === where.id;
          const matchWs = !where.workspaceId || lead.workspaceId === where.workspaceId;
          if (matchId && matchWs) return lead;
        }
        return null;
      },
    },
    task: {
      findFirst: async ({ where }: { where: { id?: string; lead?: { workspaceId?: string } } }) => {
        const task = where.id ? tasksStore.get(where.id) : null;
        if (!task) return null;
        const lead = leadsStore.get(task.leadId);
        if (!lead) return null;
        if (where.lead?.workspaceId && lead.workspaceId !== where.lead.workspaceId) return null;
        const assignee = task.assignedToUserId ? usersStore.get(task.assignedToUserId) || null : null;
        return { ...task, lead, assignee };
      },
      findMany: async ({ where, skip, take }: { where: { lead?: { workspaceId?: string; id?: string }; assignedToUserId?: string; status?: TaskStatus }; skip?: number; take?: number }) => {
        const results: TaskWithRelations[] = [];
        for (const t of tasksStore.values()) {
          const lead = leadsStore.get(t.leadId);
          if (!lead) continue;
          if (where.lead?.workspaceId && lead.workspaceId !== where.lead.workspaceId) continue;
          if (where.lead?.id && lead.id !== where.lead.id) continue;
          if (where.assignedToUserId && t.assignedToUserId !== where.assignedToUserId) continue;
          if (where.status && t.status !== where.status) continue;

          const assignee = t.assignedToUserId ? usersStore.get(t.assignedToUserId) || null : null;
          results.push({ ...t, lead, assignee });
        }
        if (skip !== undefined && take !== undefined) {
          return results.slice(skip, skip + take);
        }
        return results;
      },
      count: async ({ where }: { where: { lead?: { workspaceId?: string; id?: string }; assignedToUserId?: string; status?: TaskStatus } }) => {
        let count = 0;
        for (const t of tasksStore.values()) {
          const lead = leadsStore.get(t.leadId);
          if (!lead) continue;
          if (where.lead?.workspaceId && lead.workspaceId !== where.lead.workspaceId) continue;
          if (where.lead?.id && lead.id !== where.lead.id) continue;
          if (where.assignedToUserId && t.assignedToUserId !== where.assignedToUserId) continue;
          if (where.status && t.status !== where.status) continue;
          count++;
        }
        return count;
      },
      create: async ({ data }: { data: { leadId: string; assignedToUserId?: string; title: string; description?: string; dueDate?: Date; status: TaskStatus } }) => {
        const id = `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const entry: Task = {
          id,
          leadId: data.leadId,
          assignedToUserId: data.assignedToUserId || null,
          title: data.title,
          description: data.description || null,
          dueDate: data.dueDate || null,
          status: data.status,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        tasksStore.set(id, entry);
        const lead = leadsStore.get(entry.leadId)!;
        const assignee = entry.assignedToUserId ? usersStore.get(entry.assignedToUserId) || null : null;
        return { ...entry, lead, assignee };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Task> }) => {
        const existing = tasksStore.get(where.id);
        if (!existing) throw new Error('Not found');
        const cleanData = Object.fromEntries(Object.entries(data).filter(([_, v]) => v !== undefined));
        const updated: Task = { ...existing, ...cleanData, updatedAt: new Date() };
        tasksStore.set(where.id, updated);
        const lead = leadsStore.get(updated.leadId)!;
        const assignee = updated.assignedToUserId ? usersStore.get(updated.assignedToUserId) || null : null;
        return { ...updated, lead, assignee };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        tasksStore.delete(where.id);
        return true;
      },
    },
    cRMActivity: {
      create: async ({ data }: { data: { leadId: string; userId?: string; type: CRMActivityType; description: string; metadata?: Record<string, unknown> } }) => {
        const id = `act_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const entry: CRMActivity = {
          id,
          leadId: data.leadId,
          userId: data.userId || null,
          type: data.type,
          description: data.description,
          metadata: data.metadata as never,
          createdAt: new Date(),
        };
        crmActivitiesStore.set(id, entry);
        return entry;
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

  const testTaskRepo = new TaskRepository(mockDbClient);
  const testCRMRepo = new CRMActivityRepository(mockDbClient);
  const testAuditRepo = new AuditRepository(mockDbClient);
  const testFollowUpService = new FollowUpService(testTaskRepo, testCRMRepo, testAuditRepo, mockDbClient);

  const workspaceA = 'ws_alpha_111';
  const workspaceB = 'ws_beta_222';

  const userA: User = {
    id: '11111111-1111-4111-8111-111111111111',
    workspaceId: workspaceA,
    email: 'user_a@company.com',
    name: 'Sarah Connor',
    passwordHash: 'hash',
    role: 'OWNER',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  usersStore.set(userA.id, userA);

  const inactiveUserA: User = {
    id: '22222222-2222-4222-8222-222222222222',
    workspaceId: workspaceA,
    email: 'inactive_a@company.com',
    name: 'Inactive John',
    passwordHash: 'hash',
    role: 'MEMBER',
    isActive: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  usersStore.set(inactiveUserA.id, inactiveUserA);

  const tokenA = signAuthToken({
    userId: userA.id,
    workspaceId: workspaceA,
    email: userA.email,
    role: userA.role,
  });

  const tokenB = signAuthToken({
    userId: '33333333-3333-4333-8333-333333333333',
    workspaceId: workspaceB,
    email: 'user_b@other.com',
    role: 'OWNER',
  });

  const leadA: Lead = {
    id: '44444444-4444-4444-8444-444444444444',
    workspaceId: workspaceA,
    campaignId: '55555555-5555-4555-8555-555555555555',
    businessName: 'West End Orthodontics',
    domain: 'westendortho.co.uk',
    phone: '+442079464444',
    address: 'London',
    status: 'CONTACTED',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  leadsStore.set(leadA.id, leadA);

  try {
    // --------------------------------------------------------------------------
    // 1. Task Creation & Due Dates
    // --------------------------------------------------------------------------
    console.log('Test 1-3: Creating follow-up tasks with assignees and due dates...');
    const dueDate = new Date(Date.now() + 86400000); // tomorrow
    const task1 = await testFollowUpService.createTask(workspaceA, userA.id, {
      leadId: leadA.id,
      assignedToUserId: userA.id,
      title: 'Call Dr. Watson to follow up on booking audit review',
      description: 'Check if they reviewed the mobile booking audit breakdown.',
      dueDate,
      status: 'PENDING',
    });

    assert.ok(task1.id);
    assert.equal(task1.title, 'Call Dr. Watson to follow up on booking audit review');
    assert.equal(task1.status, 'PENDING');
    assert.equal(task1.assignedToUserId, userA.id);
    assert.equal(task1.assignedUserName, 'Sarah Connor');
    assert.equal(task1.leadBusinessName, 'West End Orthodontics');

    // Inactive user assignment rejection
    await assert.rejects(
      async () => {
        await testFollowUpService.createTask(workspaceA, userA.id, {
          leadId: leadA.id,
          assignedToUserId: inactiveUserA.id,
          title: 'Should fail for inactive user',
        });
      },
      BadRequestError,
      'Assigning task to inactive user must be rejected'
    );
    console.log('✓ Follow-up task created with assigned user and inactive user rejection verified');

    // --------------------------------------------------------------------------
    // 2. Task Lifecycle: Update, Complete, and CRM Consistency
    // --------------------------------------------------------------------------
    console.log('Test 4-6: Updating task, completing, and checking CRM activity sync...');
    const updated = await testFollowUpService.updateTask(task1.id, workspaceA, userA.id, {
      status: 'COMPLETED',
      description: 'Completed call. Lead agreed to review proposal.',
    });

    assert.equal(updated.status, 'COMPLETED');
    assert.ok(updated.description?.includes('Completed call'));
    assert.ok(crmActivitiesStore.size >= 1, 'Task completion must sync to CRM activity timeline');
    console.log('✓ Task status transitions, CRM completion sync, and updates passed');

    // --------------------------------------------------------------------------
    // 3. Multi-Tenant Isolation
    // --------------------------------------------------------------------------
    console.log('Test 7-9: Multi-tenant cross-workspace access rejection...');
    // User from Workspace B cannot get task from Workspace A
    await assert.rejects(
      async () => {
        await testFollowUpService.getTask(task1.id, workspaceB);
      },
      NotFoundError,
      'Cross-tenant task read must be blocked'
    );

    // User from Workspace B cannot update task from Workspace A
    await assert.rejects(
      async () => {
        await testFollowUpService.updateTask(task1.id, workspaceB, 'user_b', {
          title: 'Hacked task',
        });
      },
      NotFoundError,
      'Cross-tenant task update must be blocked'
    );

    // User from Workspace B cannot delete task from Workspace A
    await assert.rejects(
      async () => {
        await testFollowUpService.deleteTask(task1.id, workspaceB, 'user_b');
      },
      NotFoundError,
      'Cross-tenant task deletion must be blocked'
    );
    console.log('✓ Multi-tenant task isolation passed');

    // --------------------------------------------------------------------------
    // 4. Fastify HTTP Endpoints (/api/v1/follow-ups/*)
    // --------------------------------------------------------------------------
    console.log('Test 10-16: Fastify Follow-Ups HTTP Routes & Validation...');
    const app = await buildApp();

    // Unauthenticated request -> 401
    const unauthRes = await app.inject({
      method: 'GET',
      url: '/api/v1/follow-ups',
    });
    assert.equal(unauthRes.statusCode, 401);

    // Authenticated list tasks
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/follow-ups',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(listRes.statusCode, 200);
    const listBody = JSON.parse(listRes.payload);
    assert.equal(listBody.success, true);
    assert.ok(listBody.data.length >= 1);

    // Authenticated get task by ID
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/follow-ups/${task1.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(getRes.statusCode, 200);
    const getBody = JSON.parse(getRes.payload);
    assert.equal(getBody.task.title, 'Call Dr. Watson to follow up on booking audit review');

    // Authenticated create task via API
    const createApiRes = await app.inject({
      method: 'POST',
      url: '/api/v1/follow-ups',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        leadId: leadA.id,
        title: 'Send meeting invite on Tuesday',
      },
    });
    assert.equal(createApiRes.statusCode, 201);
    const createBody = JSON.parse(createApiRes.payload);

    // Blank title rejection -> 400
    const blankTitleRes = await app.inject({
      method: 'POST',
      url: '/api/v1/follow-ups',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        leadId: leadA.id,
        title: '   ',
      },
    });
    assert.equal(blankTitleRes.statusCode, 400);

    // Authenticated delete task via API
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/follow-ups/${createBody.task.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(deleteRes.statusCode, 200);

    // Cross-tenant HTTP attempt -> 404
    const crossRes = await app.inject({
      method: 'GET',
      url: `/api/v1/follow-ups/${task1.id}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    assert.equal(crossRes.statusCode, 404);

    await app.close();
    console.log('✓ Fastify Follow-Up HTTP routes and security guards passed');
    console.log('\n--- All Follow-Up & Task Tests Passed Successfully ---');
  } finally {
    databaseClient.setPrismaClient(null);
  }
}

runFollowUpTests().catch((err) => {
  console.error('Follow-Up Test Suite Failed:', err);
  process.exit(1);
});
