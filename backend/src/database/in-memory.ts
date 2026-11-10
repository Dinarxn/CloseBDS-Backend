import type {
  PrismaClient,
  User,
  Workspace,
  Lead,
  Contact,
  EmailCampaign,
  EmailMessage,
  Call,
  N8nIntegration,
  N8nWebhookDelivery,
} from '@prisma/client';
import crypto from 'node:crypto';

/**
 * In-memory development data stores.
 * Persists across HTTP requests in dev mode when DATABASE_URL is not configured.
 */
class InMemoryDatabaseStore {
  public users = new Map<string, any>();
  public workspaces = new Map<string, any>();
  public campaigns = new Map<string, any>();
  public leads = new Map<string, any>();
  public contacts = new Map<string, any>();
  public emailCampaigns = new Map<string, any>();
  public emailMessages = new Map<string, any>();
  public websiteAudits = new Map<string, any>();
  public leadScores = new Map<string, any>();
  public crmActivities = new Map<string, any>();
  public tasks = new Map<string, any>();
  public suppressions = new Map<string, any>();
  public settings = new Map<string, any>();
  public userPreferences = new Map<string, any>();
  public auditLogs: any[] = [];
  public jobs = new Map<string, any>();
  public integrationEvents = new Map<string, any>();
  public voiceCampaigns = new Map<string, any>();
  public voiceAgentConfigs = new Map<string, any>();
  public workspaceCallingPolicies = new Map<string, any>();
  public calls = new Map<string, any>();
  public callAttempts = new Map<string, any>();
  public callEvents = new Map<string, any>();
  public callTranscripts = new Map<string, any>();
  public callOutcomes = new Map<string, any>();
  public n8nIntegrations = new Map<string, any>();
  public n8nWebhookDeliveries = new Map<string, any>();
  public workspaceProviderCredentials = new Map<string, any>();
  public telephonyPhoneNumbers = new Map<string, any>();
  public passwordResetTokens = new Map<string, any>();
  public appointments = new Map<string, any>();
}

export const inMemoryStore = new InMemoryDatabaseStore();

export function createInMemoryPrismaClient(): PrismaClient {
  const store = inMemoryStore;

  const client = {
    user: {
      findUnique: async ({ where }: { where: { email?: string; id?: string } }) => {
        if (where.email) {
          const lower = where.email.toLowerCase();
          for (const u of store.users.values()) {
            if (u.email.toLowerCase() === lower) return u;
          }
        }
        if (where.id) return store.users.get(where.id) || null;
        return null;
      },
      findFirst: async ({ where }: any) => {
        for (const u of store.users.values()) {
          if (where.id && u.id !== where.id) continue;
          if (where.workspaceId && u.workspaceId !== where.workspaceId) continue;
          if (where.email && u.email.toLowerCase() !== where.email.toLowerCase()) continue;
          return u;
        }
        return null;
      },
      findMany: async ({ where }: any = {}) => {
        return Array.from(store.users.values()).filter((u) => {
          if (where?.workspaceId && u.workspaceId !== where.workspaceId) return false;
          return true;
        });
      },
      create: async ({ data }: any) => {
        const id = crypto.randomUUID();
        const user: User = {
          id,
          workspaceId: data.workspaceId,
          email: data.email.toLowerCase(),
          name: data.name,
          passwordHash: data.passwordHash,
          role: data.role || 'OWNER',
          isActive: data.isActive ?? true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.users.set(id, user);
        return user;
      },
      update: async ({ where, data }: any) => {
        const user = store.users.get(where.id);
        if (!user) throw new Error('User not found');
        const updated = { ...user, ...data, updatedAt: new Date() };
        store.users.set(where.id, updated);
        return updated;
      },
    },

    workspace: {
      findUnique: async ({ where }: { where: { id?: string; slug?: string } }) => {
        if (where.id) return store.workspaces.get(where.id) || null;
        if (where.slug) {
          for (const w of store.workspaces.values()) {
            if (w.slug === where.slug) return w;
          }
        }
        return null;
      },
      findFirst: async ({ where }: any) => {
        for (const w of store.workspaces.values()) {
          if (where.id && w.id !== where.id) continue;
          if (where.slug && w.slug !== where.slug) continue;
          return w;
        }
        return null;
      },
      create: async ({ data }: any) => {
        const id = crypto.randomUUID();
        const ws: Workspace = {
          id,
          name: data.name,
          slug: data.slug,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.workspaces.set(id, ws);
        return ws;
      },
      update: async ({ where, data }: any) => {
        const ws = store.workspaces.get(where.id);
        if (!ws) throw new Error('Workspace not found');
        const updated = { ...ws, ...data, updatedAt: new Date() };
        store.workspaces.set(where.id, updated);
        return updated;
      },
    },

    campaign: {
      findFirst: async ({ where }: any) => {
        for (const c of store.campaigns.values()) {
          if (where.id && c.id !== where.id) continue;
          if (where.workspaceId && c.workspaceId !== where.workspaceId) continue;
          const vc = store.voiceCampaigns.get(c.id);
          const agentConfig = vc?.agentConfigId ? store.voiceAgentConfigs.get(vc.agentConfigId) || null : null;
          return {
            ...c,
            voiceCampaign: vc ? { ...vc, agentConfig } : null,
          };
        }
        return null;
      },
      findMany: async ({ where }: any = {}) => {
        return Array.from(store.campaigns.values()).filter(
          (c) => !where?.workspaceId || c.workspaceId === where.workspaceId
        );
      },
      create: async ({ data }: any) => {
        const id = crypto.randomUUID();
        const camp = {
          id,
          workspaceId: data.workspaceId,
          name: data.name,
          niche: data.niche || 'General',
          location: data.location || data.targetLocation || 'All',
          targetOffer: data.targetOffer || 'Standard Outreach',
          dailyCap: data.dailyCap || data.dailySendingLimit || 25,
          status: data.status || 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.campaigns.set(id, camp);
        return camp;
      },
      update: async ({ where, data }: any) => {
        const c = store.campaigns.get(where.id);
        if (!c) throw new Error('Campaign not found');
        const updated = { ...c, ...data, updatedAt: new Date() };
        store.campaigns.set(where.id, updated);
        return updated;
      },
    },

    lead: {
      findFirst: async ({ where }: any) => {
        for (const l of store.leads.values()) {
          if (where.id && l.id !== where.id) continue;
          if (where.workspaceId && l.workspaceId !== where.workspaceId) continue;
          if (where.businessName && l.businessName !== where.businessName) continue;
          if (where.domain !== undefined && l.domain !== where.domain) continue;
          if (where.phone !== undefined && l.phone !== where.phone) continue;
          if (where.address !== undefined && l.address !== where.address) continue;
          const contacts = Array.from(store.contacts.values()).filter((c) => c.leadId === l.id);
          return { ...l, contacts };
        }
        return null;
      },
      findMany: async ({ where }: any = {}) => {
        return Array.from(store.leads.values())
          .filter((l) => {
            if (where?.workspaceId && l.workspaceId !== where.workspaceId) return false;
            if (where?.status && l.status !== where.status) return false;
            if (where?.campaignId && l.campaignId !== where.campaignId) return false;
            if (where?.domain) {
              if (typeof where.domain === 'string' && l.domain !== where.domain) return false;
              if (where.domain.equals && l.domain?.toLowerCase() !== where.domain.equals.toLowerCase()) return false;
            }
            if (where?.phone) {
              if (where.phone.not === null && !l.phone) return false;
              if (typeof where.phone === 'string' && l.phone !== where.phone) return false;
            }
            if (where?.address) {
              if (where.address.not === null && !l.address) return false;
              if (typeof where.address === 'string' && l.address !== where.address) return false;
            }
            return true;
          })
          .map((l) => ({
            ...l,
            contacts: Array.from(store.contacts.values()).filter((c) => c.leadId === l.id),
          }));
      },
      count: async ({ where }: any = {}) => {
        return Array.from(store.leads.values()).filter(
          (l) => !where?.workspaceId || l.workspaceId === where.workspaceId
        ).length;
      },
      create: async ({ data }: any) => {
        const id = crypto.randomUUID();
        const lead: Lead = {
          id,
          workspaceId: data.workspaceId,
          campaignId: data.campaignId || null,
          businessName: data.businessName,
          domain: data.domain || null,
          phone: data.phone || null,
          address: data.address || null,
          status: data.status || 'NEW',
          practiceType: data.practiceType || null,
          chairCount: data.chairCount ?? null,
          doctorCount: data.doctorCount ?? null,
          googleRating: data.googleRating != null ? data.googleRating : null,
          googleReviewCount: data.googleReviewCount ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.leads.set(id, lead);
        return { ...lead, contacts: [] };
      },
      update: async ({ where, data }: any) => {
        const lead = store.leads.get(where.id);
        if (!lead) throw new Error('Lead not found');
        const updated = {
          ...lead,
          ...data,
          practiceType: data.practiceType !== undefined ? data.practiceType : lead.practiceType,
          chairCount: data.chairCount !== undefined ? data.chairCount : lead.chairCount,
          doctorCount: data.doctorCount !== undefined ? data.doctorCount : lead.doctorCount,
          googleRating: data.googleRating !== undefined ? data.googleRating : lead.googleRating,
          googleReviewCount: data.googleReviewCount !== undefined ? data.googleReviewCount : lead.googleReviewCount,
          updatedAt: new Date(),
        };
        store.leads.set(where.id, updated);
        const contacts = Array.from(store.contacts.values()).filter((c) => c.leadId === updated.id);
        return { ...updated, contacts };
      },
    },

    contact: {
      findFirst: async ({ where }: any) => {
        for (const c of store.contacts.values()) {
          if (where.id && c.id !== where.id) continue;
          if (where.email && c.email.toLowerCase() !== where.email.toLowerCase()) continue;
          const lead = store.leads.get(c.leadId);
          if (!lead) continue;
          if (where.lead?.workspaceId && lead.workspaceId !== where.lead.workspaceId) continue;
          return { ...c, lead };
        }
        return null;
      },
      findMany: async ({ where }: any = {}) => {
        return Array.from(store.contacts.values()).filter(
          (c) => !where?.leadId || c.leadId === where.leadId
        );
      },
      create: async ({ data }: any) => {
        const id = crypto.randomUUID();
        const contact: Contact = {
          id,
          leadId: data.leadId,
          fullName: data.fullName,
          email: data.email.toLowerCase(),
          title: data.title || null,
          phone: data.phone || null,
          isPrimary: data.isPrimary ?? false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.contacts.set(id, contact);
        return contact;
      },
      update: async ({ where, data }: any) => {
        const c = store.contacts.get(where.id);
        if (!c) throw new Error('Contact not found');
        const updated = { ...c, ...data, updatedAt: new Date() };
        store.contacts.set(where.id, updated);
        return updated;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const c of store.contacts.values()) {
          if (c.leadId === where.leadId) {
            store.contacts.set(c.id, { ...c, ...data });
            count++;
          }
        }
        return { count };
      },
    },

    emailCampaign: {
      findUnique: async ({ where }: { where: { campaignId: string } }) => {
        return store.emailCampaigns.get(where.campaignId) || null;
      },
      create: async ({ data }: any) => {
        const id = `ecamp_${Date.now()}`;
        const ec: EmailCampaign = {
          id,
          campaignId: data.campaignId,
          fromEmail: data.fromEmail,
          fromName: data.fromName,
          dailyCap: data.dailyCap,
          scheduleConfig: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.emailCampaigns.set(data.campaignId, ec);
        return ec;
      },
    },

    emailMessage: {
      findFirst: async ({ where }: any) => {
        const msg = where.id ? store.emailMessages.get(where.id) : null;
        if (!msg) return null;
        const ec = store.emailCampaigns.get(msg.emailCampaignId);
        const campaign = ec ? store.campaigns.get(ec.campaignId) : null;
        const contact = store.contacts.get(msg.contactId);
        const lead = contact ? store.leads.get(contact.leadId) : null;
        return {
          ...msg,
          emailCampaign: ec ? { ...ec, campaign } : null,
          contact: contact ? { ...contact, lead } : null,
        };
      },
      findMany: async () => [],
      count: async () => 0,
      create: async ({ data }: any) => {
        const id = crypto.randomUUID();
        const msg: EmailMessage = {
          id,
          emailCampaignId: data.emailCampaignId,
          contactId: data.contactId,
          subject: data.subject,
          bodyText: data.bodyText,
          status: data.status || 'DRAFT',
          humanApprovalRequired: data.humanApprovalRequired ?? true,
          isApproved: data.isApproved ?? false,
          approvedByUserId: data.approvedByUserId || null,
          approvedAt: data.approvedAt || null,
          sentAt: data.sentAt || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.emailMessages.set(id, msg);
        const ec = store.emailCampaigns.get(data.emailCampaignId);
        const campaign = ec ? store.campaigns.get(ec.campaignId) : null;
        const contact = store.contacts.get(data.contactId);
        const lead = contact ? store.leads.get(contact.leadId) : null;
        return {
          ...msg,
          emailCampaign: ec ? { ...ec, campaign } : null,
          contact: contact ? { ...contact, lead } : null,
        };
      },
      update: async ({ where, data }: any) => {
        const msg = store.emailMessages.get(where.id);
        if (!msg) throw new Error('Email not found');
        const updated = { ...msg, ...data, updatedAt: new Date() };
        store.emailMessages.set(where.id, updated);
        const ec = store.emailCampaigns.get(updated.emailCampaignId);
        const campaign = ec ? store.campaigns.get(ec.campaignId) : null;
        const contact = store.contacts.get(updated.contactId);
        const lead = contact ? store.leads.get(contact.leadId) : null;
        return {
          ...updated,
          emailCampaign: ec ? { ...ec, campaign } : null,
          contact: contact ? { ...contact, lead } : null,
        };
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const [id, msg] of store.emailMessages.entries()) {
          const matchId = !where?.id || msg.id === where.id;
          const matchStatus = !where?.status || msg.status === where.status;
          const matchApproved = where?.isApproved === undefined || msg.isApproved === where.isApproved;
          if (matchId && matchStatus && matchApproved) {
            store.emailMessages.set(id, { ...msg, ...data, updatedAt: new Date() });
            count++;
          }
        }
        return { count };
      },
    },

    websiteAudit: {
      findFirst: async ({ where }: any) => {
        for (const a of store.websiteAudits.values()) {
          if (where.leadId && a.leadId === where.leadId) return a;
        }
        return null;
      },
      upsert: async ({ create, where }: any) => {
        const existing = where?.leadId ? store.websiteAudits.get(where.leadId) : null;
        const id = existing ? existing.id : crypto.randomUUID();
        const audit = {
          id,
          leadId: create.leadId,
          domain: create.domain,
          mobileOptimized: create.mobileOptimized,
          bookingCtaVisible: create.bookingCtaVisible,
          auditGaps: create.auditGaps || [],
          rawAuditData: create.rawAuditData || {},
          auditedAt: new Date(),
        };
        store.websiteAudits.set(create.leadId, audit);
        return audit;
      },
    },

    leadScore: {
      findFirst: async ({ where }: any) => {
        for (const s of store.leadScores.values()) {
          if (where.leadId && s.leadId === where.leadId) return s;
        }
        return null;
      },
      create: async ({ data }: any) => {
        const id = crypto.randomUUID();
        const score = {
          id,
          leadId: data.leadId,
          relevanceScore: data.relevanceScore,
          opportunityScore: data.opportunityScore,
          totalScore: data.totalScore,
          rationale: data.rationale || data.reasoningRationale || '',
          scoredAt: new Date(),
        };
        store.leadScores.set(id, score);
        return score;
      },
    },

    suppression: {
      findFirst: async ({ where }: any) => {
        for (const s of store.suppressions.values()) {
          if (where.workspaceId && s.workspaceId !== where.workspaceId) continue;
          if (where.value && s.value === where.value) return s;
          if (where.email && s.value === where.email) return s;
          if (where.phone && s.value === where.phone) return s;
        }
        return null;
      },
      findMany: async ({ where }: any = {}) => {
        return Array.from(store.suppressions.values()).filter(
          (s) => !where?.workspaceId || s.workspaceId === where.workspaceId
        );
      },
      create: async ({ data }: any) => {
        const id = crypto.randomUUID();
        const supp = {
          id,
          workspaceId: data.workspaceId,
          type: data.type || 'EMAIL',
          value: data.value || data.email || data.phone || '',
          reason: data.reason || 'OPT_OUT',
          createdAt: new Date(),
        };
        store.suppressions.set(id, supp);
        return supp;
      },
    },

    setting: {
      findFirst: async ({ where }: any) => {
        for (const s of store.settings.values()) {
          if (where.workspaceId && s.workspaceId === where.workspaceId) return s;
        }
        return null;
      },
      upsert: async ({ create, update }: any) => {
        const id = crypto.randomUUID();
        const existing = store.settings.get(create.workspaceId);
        const setting = {
          id: existing ? existing.id : id,
          workspaceId: create.workspaceId,
          dailyEmailCap: update?.dailyEmailCap ?? create.dailyEmailCap ?? 50,
          killSwitchActive: update?.killSwitchActive ?? create.killSwitchActive ?? false,
          defaultDailyCap: update?.defaultDailyCap ?? update?.dailyEmailCap ?? create.defaultDailyCap ?? create.dailyEmailCap ?? 50,
          safetyThreshold: update?.safetyThreshold ?? create.safetyThreshold ?? 70,
          requireHumanApproval: update?.requireHumanApproval ?? create.requireHumanApproval ?? true,
          antiHallucinationEnforced: update?.antiHallucinationEnforced ?? create.antiHallucinationEnforced ?? true,
          autoSuppressionOnOptOut: update?.autoSuppressionOnOptOut ?? create.autoSuppressionOnOptOut ?? true,
          autoSuppressionOnHardBounce: update?.autoSuppressionOnHardBounce ?? create.autoSuppressionOnHardBounce ?? true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.settings.set(create.workspaceId, setting);
        return setting;
      },
    },

    workspaceSetting: {
      findFirst: async ({ where }: any) => {
        for (const s of store.settings.values()) {
          if (where.workspaceId && s.workspaceId === where.workspaceId) return s;
        }
        return null;
      },
      findUnique: async ({ where }: any) => {
        for (const s of store.settings.values()) {
          if (where.workspaceId && s.workspaceId === where.workspaceId) return s;
        }
        return null;
      },
      upsert: async ({ create, update, where }: any) => {
        const workspaceId = where?.workspaceId || create?.workspaceId;
        const id = crypto.randomUUID();
        const existing = store.settings.get(workspaceId);
        const setting = {
          id: existing ? existing.id : id,
          workspaceId,
          dailyEmailCap: update?.dailyEmailCap ?? create?.dailyEmailCap ?? 50,
          killSwitchActive: update?.killSwitchActive ?? create?.killSwitchActive ?? false,
          defaultDailyCap: update?.defaultDailyCap ?? update?.dailyEmailCap ?? create?.defaultDailyCap ?? create?.dailyEmailCap ?? 50,
          safetyThreshold: update?.safetyThreshold ?? create?.safetyThreshold ?? 70,
          requireHumanApproval: update?.requireHumanApproval ?? create?.requireHumanApproval ?? true,
          antiHallucinationEnforced: update?.antiHallucinationEnforced ?? create?.antiHallucinationEnforced ?? true,
          autoSuppressionOnOptOut: update?.autoSuppressionOnOptOut ?? create?.autoSuppressionOnOptOut ?? true,
          autoSuppressionOnHardBounce: update?.autoSuppressionOnHardBounce ?? create?.autoSuppressionOnHardBounce ?? true,
          createdAt: existing ? existing.createdAt : new Date(),
          updatedAt: new Date(),
        };
        store.settings.set(workspaceId, setting);
        return setting;
      },
    },

    userPreference: {
      findFirst: async ({ where }: any) => {
        const workspaceId = where?.workspaceId || where?.workspaceId_userId?.workspaceId;
        const userId = where?.userId || where?.workspaceId_userId?.userId;
        const key = `${workspaceId}:${userId}`;
        return store.userPreferences.get(key) || null;
      },
      findUnique: async ({ where }: any) => {
        const workspaceId = where?.workspaceId || where?.workspaceId_userId?.workspaceId;
        const userId = where?.userId || where?.workspaceId_userId?.userId;
        const key = `${workspaceId}:${userId}`;
        return store.userPreferences.get(key) || null;
      },
      upsert: async ({ create, update, where }: any) => {
        const workspaceId = where?.workspaceId_userId?.workspaceId || where?.workspaceId || create?.workspaceId;
        const userId = where?.workspaceId_userId?.userId || where?.userId || create?.userId;
        const key = `${workspaceId}:${userId}`;
        const existing = store.userPreferences.get(key);
        const id = existing ? existing.id : crypto.randomUUID();
        const pref = {
          id,
          userId,
          workspaceId,
          emailNotifications: update?.emailNotifications ?? create?.emailNotifications ?? true,
          qualificationAlerts: update?.qualificationAlerts ?? create?.qualificationAlerts ?? true,
          outreachApprovalAlerts: update?.outreachApprovalAlerts ?? create?.outreachApprovalAlerts ?? true,
          taskDueAlerts: update?.taskDueAlerts ?? create?.taskDueAlerts ?? true,
          theme: update?.theme ?? create?.theme ?? 'system',
          language: update?.language ?? create?.language ?? 'en',
          createdAt: existing ? existing.createdAt : new Date(),
          updatedAt: new Date(),
        };
        store.userPreferences.set(key, pref);
        return pref;
      },
    },

    cRMActivity: {
      findMany: async () => [],
      create: async ({ data }: any) => ({
        id: crypto.randomUUID(),
        ...data,
        createdAt: new Date(),
      }),
    },

    task: {
      findMany: async () => [],
      create: async ({ data }: any) => ({
        id: crypto.randomUUID(),
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    },

    auditLog: {
      count: async ({ where }: any = {}) => {
        return store.auditLogs.filter((log: any) => {
          if (where?.workspaceId && log.workspaceId !== where.workspaceId) return false;
          if (where?.eventType && log.eventType !== where.eventType) return false;
          if (where?.entityType && log.entityType !== where.entityType) return false;
          if (where?.entityId && log.entityId !== where.entityId) return false;
          if (where?.userId && log.userId !== where.userId) return false;
          if (where?.createdAt?.gte && new Date(log.createdAt) < new Date(where.createdAt.gte)) return false;
          if (where?.createdAt?.lte && new Date(log.createdAt) > new Date(where.createdAt.lte)) return false;
          return true;
        }).length;
      },
      findMany: async ({ where, orderBy, skip, take }: any = {}) => {
        let results = store.auditLogs.filter((log: any) => {
          if (where?.workspaceId && log.workspaceId !== where.workspaceId) return false;
          if (where?.eventType && log.eventType !== where.eventType) return false;
          if (where?.entityType && log.entityType !== where.entityType) return false;
          if (where?.entityId && log.entityId !== where.entityId) return false;
          if (where?.userId && log.userId !== where.userId) return false;
          if (where?.createdAt?.gte && new Date(log.createdAt) < new Date(where.createdAt.gte)) return false;
          if (where?.createdAt?.lte && new Date(log.createdAt) > new Date(where.createdAt.lte)) return false;
          return true;
        });
        if (orderBy?.createdAt === 'desc') {
          results = results.slice().sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        } else if (orderBy?.createdAt === 'asc') {
          results = results.slice().sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        }
        if (skip !== undefined && take !== undefined) {
          results = results.slice(skip, skip + take);
        } else if (take !== undefined) {
          results = results.slice(0, take);
        }
        return results;
      },
      create: async ({ data }: any) => {
        const log = {
          id: crypto.randomUUID(),
          workspaceId: data.workspaceId,
          userId: data.userId || null,
          eventType: data.eventType,
          entityType: data.entityType,
          entityId: data.entityId || null,
          metadata: data.metadata || null,
          ipAddress: null,
          userAgent: null,
          createdAt: new Date(),
        };
        store.auditLogs.push(log);
        return log;
      },
    },

    voiceCampaign: {
      upsert: async ({ create, update, where }: any) => {
        const existing = store.voiceCampaigns.get(where.campaignId);
        const data = existing ? { ...existing, ...update } : { id: `vc_${Date.now()}`, ...create };
        store.voiceCampaigns.set(where.campaignId, data);
        return data;
      },
      findFirst: async ({ where }: any) => {
        return Array.from(store.voiceCampaigns.values()).find(
          (vc) => !where?.campaignId || vc.campaignId === where.campaignId
        ) || null;
      },
    },

    voiceAgentConfig: {
      create: async ({ data }: any) => {
        const id = crypto.randomUUID();
        const record = {
          id,
          workspaceId: data.workspaceId,
          name: data.name,
          callObjective: data.callObjective,
          openingScript: data.openingScript,
          qualificationQuestions: data.qualificationQuestions || [],
          approvedTalkingPoints: data.approvedTalkingPoints || [],
          objectionHandling: data.objectionHandling || null,
          prohibitedClaims: data.prohibitedClaims || [],
          escalationConditions: data.escalationConditions || [],
          fallbackBehavior: data.fallbackBehavior || 'Politely offer human callback',
          maxDurationSeconds: data.maxDurationSeconds ?? 300,

          // First-class columns
          provider: data.provider || 'mock',
          status: data.status || 'DRAFT',
          modelId: data.modelId || null,
          voiceId: data.voiceId || null,
          voiceProvider: data.voiceProvider || null,
          temperature: data.temperature ?? null,
          maxTokens: data.maxTokens ?? null,
          voiceSpeed: data.voiceSpeed ?? null,
          voicePitch: data.voicePitch ?? null,
          voiceStability: data.voiceStability ?? null,
          agentPersona: data.agentPersona || null,
          speakingStyle: data.speakingStyle || null,
          knowledgePoints: data.knowledgePoints || [],
          objectionRules: data.objectionRules || null,
          structuredQuestions: data.structuredQuestions || null,
          assignedPhoneNumberId: data.assignedPhoneNumberId || null,
          safetyGuardrails: data.safetyGuardrails || null,
          inboundEnabled: data.inboundEnabled ?? false,
          outboundEnabled: data.outboundEnabled ?? true,

          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.voiceAgentConfigs.set(id, record);
        return record;
      },
      findFirst: async ({ where }: any) => {
        return Array.from(store.voiceAgentConfigs.values()).find(
          (ac) => (!where?.id || ac.id === where.id) && (!where?.workspaceId || ac.workspaceId === where.workspaceId)
        ) || null;
      },
      findMany: async ({ where }: any = {}) => {
        return Array.from(store.voiceAgentConfigs.values()).filter(
          (ac) => !where?.workspaceId || ac.workspaceId === where.workspaceId
        );
      },
      update: async ({ where, data }: any) => {
        const existing = store.voiceAgentConfigs.get(where.id);
        if (!existing) throw new Error('VoiceAgentConfig not found');
        const updated = { ...existing, ...data, updatedAt: new Date() };
        store.voiceAgentConfigs.set(where.id, updated);
        return updated;
      },
      delete: async ({ where }: any) => {
        const id = where.id;
        if (id && store.voiceAgentConfigs.has(id)) {
          const record = store.voiceAgentConfigs.get(id);
          store.voiceAgentConfigs.delete(id);
          return record;
        }
        return null;
      },
    },

    workspaceCallingPolicy: {
      upsert: async ({ create, update, where }: any) => {
        const existing = store.workspaceCallingPolicies.get(where.workspaceId);
        const data = existing
          ? { ...existing, ...update, updatedAt: new Date() }
          : { id: crypto.randomUUID(), ...create, createdAt: new Date(), updatedAt: new Date() };
        store.workspaceCallingPolicies.set(where.workspaceId, data);
        return data;
      },
      findUnique: async ({ where }: any) => {
        return store.workspaceCallingPolicies.get(where.workspaceId) || null;
      },
      findFirst: async ({ where }: any) => {
        if (where?.workspaceId) {
          return store.workspaceCallingPolicies.get(where.workspaceId) || null;
        }
        return Array.from(store.workspaceCallingPolicies.values())[0] || null;
      },
      update: async ({ where, data }: any) => {
        const existing = store.workspaceCallingPolicies.get(where.workspaceId);
        if (!existing) throw new Error('Calling policy not found');
        const updated = { ...existing, ...data, updatedAt: new Date() };
        store.workspaceCallingPolicies.set(where.workspaceId, updated);
        return updated;
      },
    },

    call: {
      create: async ({ data }: any) => {
        const record: Call = {
          id: crypto.randomUUID(),
          ...data,
          campaignId: data.campaignId || null,
          voiceCampaignId: data.voiceCampaignId || null,
          agentConfigId: data.agentConfigId || null,
          status: data.status || 'APPROVAL_REQUIRED',
          isApproved: data.isApproved ?? false,
          approvedByUserId: data.approvedByUserId || null,
          approvedAt: data.approvedAt || null,
          recordingUrl: data.recordingUrl || null,
          recordingDuration: data.recordingDuration || null,
          recordingChannels: data.recordingChannels || null,
          dispatchedAt: null,
          startedAt: null,
          endedAt: null,
          durationSeconds: null,
          telephonyCallId: null,
          providerStatus: null,
          metadata: data.metadata || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.calls.set(record.id, record);
        return record;
      },
      findFirst: async ({ where }: any) => {
        for (const c of store.calls.values()) {
          if (where.id && c.id !== where.id) continue;
          if (where.workspaceId && c.workspaceId !== where.workspaceId) continue;
          if (where.idempotencyKey && c.idempotencyKey !== where.idempotencyKey) continue;
          const lead = store.leads.get(c.leadId) || null;
          const contact = store.contacts.get(c.contactId) || null;
          const agentConfig = c.agentConfigId ? store.voiceAgentConfigs.get(c.agentConfigId) : null;
          const campaign = c.campaignId ? store.campaigns.get(c.campaignId) : null;
          const voiceCampaign = c.voiceCampaignId ? store.voiceCampaigns.get(c.voiceCampaignId) : null;
          const attempts = Array.from(store.callAttempts.values()).filter((a) => a.callId === c.id);
          const events = Array.from(store.callEvents.values()).filter((e) => e.callId === c.id);
          const transcripts = Array.from(store.callTranscripts.values()).filter((t) => t.callId === c.id);
          const outcome = store.callOutcomes.get(c.id) || null;
          return {
            ...c,
            lead,
            contact,
            agentConfig,
            campaign,
            voiceCampaign,
            attempts,
            events,
            transcripts,
            outcome,
          };
        }
        return null;
      },
      findMany: async ({ where }: any = {}) => {
        return Array.from(store.calls.values())
          .filter((c) => {
            if (where?.workspaceId && c.workspaceId !== where.workspaceId) return false;
            if (where?.campaignId && c.campaignId !== where.campaignId) return false;
            if (where?.leadId && c.leadId !== where.leadId) return false;
            if (where?.contactId && c.contactId !== where.contactId) return false;
            if (where?.status) {
              if (typeof where.status === 'object' && where.status.in) {
                if (!where.status.in.includes(c.status)) return false;
              } else if (c.status !== where.status) {
                return false;
              }
            }
            if (where?.createdAt?.gte) {
              if (new Date(c.createdAt) < new Date(where.createdAt.gte)) return false;
            }
            return true;
          })
          .map((c) => {
            const lead = store.leads.get(c.leadId) || null;
            const contact = store.contacts.get(c.contactId) || null;
            const agentConfig = c.agentConfigId ? store.voiceAgentConfigs.get(c.agentConfigId) : null;
            const campaign = c.campaignId ? store.campaigns.get(c.campaignId) : null;
            const voiceCampaign = c.voiceCampaignId ? store.voiceCampaigns.get(c.voiceCampaignId) : null;
            const attempts = Array.from(store.callAttempts.values()).filter((a) => a.callId === c.id);
            const events = Array.from(store.callEvents.values()).filter((e) => e.callId === c.id);
            const transcripts = Array.from(store.callTranscripts.values()).filter((t) => t.callId === c.id);
            const outcome = store.callOutcomes.get(c.id) || null;
            return {
              ...c,
              lead,
              contact,
              agentConfig,
              campaign,
              voiceCampaign,
              attempts,
              events,
              transcripts,
              outcome,
            };
          });
      },
      count: async ({ where }: any = {}) => {
        return Array.from(store.calls.values()).filter((c) => {
          if (where?.workspaceId && c.workspaceId !== where.workspaceId) return false;
          if (where?.campaignId && c.campaignId !== where.campaignId) return false;
          if (where?.leadId && c.leadId !== where.leadId) return false;
          if (where?.contactId && c.contactId !== where.contactId) return false;
          if (where?.status) {
            if (typeof where.status === 'object' && where.status.in) {
              if (!where.status.in.includes(c.status)) return false;
            } else if (c.status !== where.status) {
              return false;
            }
          }
          if (where?.createdAt?.gte) {
            if (new Date(c.createdAt) < new Date(where.createdAt.gte)) return false;
          }
          return true;
        }).length;
      },
      update: async ({ where, data }: any) => {
        const c = store.calls.get(where.id);
        if (!c) throw new Error('Call not found');
        const updated = { ...c, ...data, updatedAt: new Date() };
        store.calls.set(where.id, updated);
        return updated;
      },
    },

    callAttempt: {
      count: async ({ where }: any = {}) => {
        let count = 0;
        for (const a of store.callAttempts.values()) {
          if (where?.call?.workspaceId) {
            const call = store.calls.get(a.callId);
            if (!call || call.workspaceId !== where.call.workspaceId) continue;
            if (where.call.leadId && call.leadId !== where.call.leadId) continue;
            if (where.call.contactId && call.contactId !== where.call.contactId) continue;
          }
          if (where?.callId && a.callId !== where.callId) continue;
          count++;
        }
        return count;
      },
      create: async ({ data }: any) => {
        const id = crypto.randomUUID();
        const record = {
          id,
          callId: data.callId,
          attemptNumber: data.attemptNumber,
          providerCallId: data.providerCallId || null,
          status: data.status || 'INITIATING',
          durationSeconds: data.durationSeconds ?? null,
          failureReason: data.failureReason || null,
          isRetryable: data.isRetryable ?? false,
          startedAt: new Date(),
          endedAt: null,
          createdAt: new Date(),
        };
        store.callAttempts.set(id, record);
        return record;
      },
      update: async ({ where, data }: any) => {
        const existing = store.callAttempts.get(where.id);
        if (!existing) throw new Error('CallAttempt not found');
        const updated = { ...existing, ...data };
        store.callAttempts.set(where.id, updated);
        return updated;
      },
    },

    callEvent: {
      create: async ({ data }: any) => {
        const id = crypto.randomUUID();
        const record = {
          id,
          callId: data.callId,
          eventType: data.eventType,
          eventPayload: data.eventPayload ?? data.payload ?? null,
          occurredAt: new Date(),
        };
        store.callEvents.set(id, record);
        return record;
      },
      findMany: async ({ where, orderBy }: any = {}) => {
        let results = Array.from(store.callEvents.values()).filter(
          (e) => !where?.callId || e.callId === where.callId
        );
        if (orderBy?.occurredAt === 'asc') {
          results.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
        } else if (orderBy?.occurredAt === 'desc') {
          results.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
        }
        return results;
      },
    },

    callTranscript: {
      create: async ({ data }: any) => {
        const id = crypto.randomUUID();
        const record = {
          id,
          callId: data.callId,
          turnIndex: data.turnIndex,
          speaker: data.speaker,
          text: data.text,
          confidence: data.confidence ?? null,
          timestampMs: data.timestampMs ?? null,
          createdAt: new Date(),
        };
        store.callTranscripts.set(id, record);
        return record;
      },
      findMany: async ({ where, orderBy }: any = {}) => {
        let results = Array.from(store.callTranscripts.values()).filter(
          (t) => !where?.callId || t.callId === where.callId
        );
        if (orderBy?.turnIndex === 'asc') {
          results.sort((a, b) => a.turnIndex - b.turnIndex);
        } else if (orderBy?.turnIndex === 'desc') {
          results.sort((a, b) => b.turnIndex - a.turnIndex);
        }
        return results;
      },
    },

    callOutcome: {
      upsert: async ({ where, create, update }: any) => {
        const existing = store.callOutcomes.get(where.callId);
        if (existing) {
          const updated = { ...existing, ...update, updatedAt: new Date() };
          store.callOutcomes.set(where.callId, updated);
          return updated;
        }
        const record = {
          id: crypto.randomUUID(),
          callId: where.callId,
          ...create,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.callOutcomes.set(where.callId, record);
        return record;
      },
      findUnique: async ({ where }: any) => {
        return store.callOutcomes.get(where.callId) || null;
      },
    },

    n8nIntegration: {
      create: async ({ data }: any) => {
        const record: N8nIntegration = {
          id: crypto.randomUUID(),
          isActive: true,
          revokedAt: null,
          lastUsedAt: null,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.n8nIntegrations.set(record.id, record);
        return record;
      },
      findFirst: async ({ where }: any) => {
        return Array.from(store.n8nIntegrations.values()).find((i) => {
          if (where.id && i.id !== where.id) return false;
          if (where.workspaceId && i.workspaceId !== where.workspaceId) return false;
          if (where.apiKeyHash && i.apiKeyHash !== where.apiKeyHash) return false;
          if (where.apiKeyPrefix && i.keyPrefix !== where.apiKeyPrefix) return false;
          if (where.isActive !== undefined && i.isActive !== where.isActive) return false;
          if (where.revokedAt === null && i.revokedAt !== null) return false;
          return true;
        }) || null;
      },
      findMany: async ({ where }: any = {}) => {
        return Array.from(store.n8nIntegrations.values()).filter(
          (i) => !where?.workspaceId || i.workspaceId === where.workspaceId
        );
      },
      update: async ({ where, data }: any) => {
        const i = store.n8nIntegrations.get(where.id);
        if (!i) throw new Error('Integration not found');
        const updated = { ...i, ...data, updatedAt: new Date() };
        store.n8nIntegrations.set(where.id, updated);
        return updated;
      },
    },

    n8nWebhookDelivery: {
      create: async ({ data }: any) => {
        const record: N8nWebhookDelivery = {
          id: crypto.randomUUID(),
          ...data,
          createdAt: new Date(),
        };
        store.n8nWebhookDeliveries.set(record.id, record);
        return record;
      },
      findMany: async ({ where }: any = {}) => {
        return Array.from(store.n8nWebhookDeliveries.values()).filter(
          (d) => !where?.workspaceId || d.workspaceId === where.workspaceId
        );
      },
    },

    workspaceProviderCredential: {
      findFirst: async ({ where }: any) => {
        for (const cred of store.workspaceProviderCredentials.values()) {
          if (where.id && cred.id !== where.id) continue;
          if (where.workspaceId && cred.workspaceId !== where.workspaceId) continue;
          if (where.provider && cred.provider.toUpperCase() !== where.provider.toUpperCase()) continue;
          return cred;
        }
        return null;
      },
      findUnique: async ({ where }: any) => {
        if (where.id) return store.workspaceProviderCredentials.get(where.id) || null;
        const compound = where.workspaceId_provider || where.unique_workspace_provider;
        if (compound) {
          const { workspaceId, provider } = compound;
          const target = `${workspaceId}:${provider.toUpperCase()}`;
          for (const cred of store.workspaceProviderCredentials.values()) {
            if (`${cred.workspaceId}:${cred.provider.toUpperCase()}` === target) return cred;
          }
        }
        return null;
      },
      findMany: async ({ where }: any = {}) => {
        return Array.from(store.workspaceProviderCredentials.values())
          .filter((c) => !where?.workspaceId || c.workspaceId === where.workspaceId)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      },
      create: async ({ data }: any) => {
        const id = crypto.randomUUID();
        const record = {
          id,
          workspaceId: data.workspaceId,
          provider: data.provider.toUpperCase(),
          encryptedPayload: data.encryptedPayload,
          maskedDisplay: data.maskedDisplay,
          connectionStatus: data.connectionStatus || 'NOT_CONFIGURED',
          accountDetails: data.accountDetails || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.workspaceProviderCredentials.set(id, record);
        return record;
      },
      update: async ({ where, data }: any) => {
        let existing = where.id ? store.workspaceProviderCredentials.get(where.id) : null;
        const compound = where.workspaceId_provider || where.unique_workspace_provider;
        if (!existing && compound) {
          const { workspaceId, provider } = compound;
          for (const c of store.workspaceProviderCredentials.values()) {
            if (c.workspaceId === workspaceId && c.provider.toUpperCase() === provider.toUpperCase()) {
              existing = c;
              break;
            }
          }
        }
        if (!existing) throw new Error('WorkspaceProviderCredential not found');
        const updated = { ...existing, ...data, updatedAt: new Date() };
        store.workspaceProviderCredentials.set(existing.id, updated);
        return updated;
      },
      upsert: async ({ where, update, create }: any) => {
        let existing = where.id ? store.workspaceProviderCredentials.get(where.id) : null;
        const compound = where.workspaceId_provider || where.unique_workspace_provider;
        if (!existing && compound) {
          const { workspaceId, provider } = compound;
          for (const c of store.workspaceProviderCredentials.values()) {
            if (c.workspaceId === workspaceId && c.provider.toUpperCase() === provider.toUpperCase()) {
              existing = c;
              break;
            }
          }
        }
        if (existing) {
          const updated = { ...existing, ...update, updatedAt: new Date() };
          store.workspaceProviderCredentials.set(existing.id, updated);
          return updated;
        } else {
          const id = crypto.randomUUID();
          const record = {
            id,
            workspaceId: create.workspaceId,
            provider: create.provider.toUpperCase(),
            encryptedPayload: create.encryptedPayload,
            maskedDisplay: create.maskedDisplay,
            connectionStatus: create.connectionStatus || 'NOT_CONFIGURED',
            accountDetails: create.accountDetails || null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          store.workspaceProviderCredentials.set(id, record);
          return record;
        }
      },
      delete: async ({ where }: any) => {
        const id = where.id;
        if (id && store.workspaceProviderCredentials.has(id)) {
          const record = store.workspaceProviderCredentials.get(id);
          store.workspaceProviderCredentials.delete(id);
          return record;
        }
        return null;
      },
    },

    telephonyPhoneNumber: {
      findFirst: async ({ where }: any) => {
        for (const num of store.telephonyPhoneNumbers.values()) {
          if (where.id && num.id !== where.id) continue;
          if (where.workspaceId && num.workspaceId !== where.workspaceId) continue;
          if (where.phoneNumber && num.phoneNumber !== where.phoneNumber) continue;
          return num;
        }
        return null;
      },
      findUnique: async ({ where }: any) => {
        if (where.id) return store.telephonyPhoneNumbers.get(where.id) || null;
        const compound = where.workspaceId_phoneNumber || where.unique_workspace_phone_number;
        if (compound) {
          const { workspaceId, phoneNumber } = compound;
          for (const num of store.telephonyPhoneNumbers.values()) {
            if (num.workspaceId === workspaceId && num.phoneNumber === phoneNumber) return num;
          }
        }
        return null;
      },
      findMany: async ({ where }: any = {}) => {
        return Array.from(store.telephonyPhoneNumbers.values())
          .filter((n) => {
            if (where?.workspaceId && n.workspaceId !== where.workspaceId) return false;
            if (where?.status && n.status !== where.status) return false;
            if (where?.provider && n.provider !== where.provider) return false;
            if (where?.assignedAgentId !== undefined && n.assignedAgentId !== where.assignedAgentId) return false;
            return true;
          })
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      },
      create: async ({ data }: any) => {
        const id = crypto.randomUUID();
        const record = {
          id,
          workspaceId: data.workspaceId,
          phoneNumber: data.phoneNumber,
          friendlyName: data.friendlyName || null,
          provider: data.provider || 'twilio',
          status: data.status || 'ACTIVE',
          capabilities: data.capabilities || {},
          assignedAgentId: data.assignedAgentId || null,
          inboundWebhookUrl: data.inboundWebhookUrl || null,
          outboundCallerIdEnabled: data.outboundCallerIdEnabled ?? true,
          purchasedWithoutAutoBuy: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.telephonyPhoneNumbers.set(id, record);
        return record;
      },
      update: async ({ where, data }: any) => {
        const num = store.telephonyPhoneNumbers.get(where.id);
        if (!num) throw new Error('TelephonyPhoneNumber not found');
        const updated = { ...num, ...data, updatedAt: new Date() };
        store.telephonyPhoneNumbers.set(where.id, updated);
        return updated;
      },
      upsert: async ({ where, update, create }: any) => {
        let existing = where.id ? store.telephonyPhoneNumbers.get(where.id) : null;
        const compound = where.workspaceId_phoneNumber || where.unique_workspace_phone_number;
        if (!existing && compound) {
          const { workspaceId, phoneNumber } = compound;
          for (const n of store.telephonyPhoneNumbers.values()) {
            if (n.workspaceId === workspaceId && n.phoneNumber === phoneNumber) {
              existing = n;
              break;
            }
          }
        }
        if (existing) {
          const updated = { ...existing, ...update, updatedAt: new Date() };
          store.telephonyPhoneNumbers.set(existing.id, updated);
          return updated;
        } else {
          const id = crypto.randomUUID();
          const record = {
            id,
            workspaceId: create.workspaceId,
            phoneNumber: create.phoneNumber,
            friendlyName: create.friendlyName || null,
            provider: create.provider || 'twilio',
            status: create.status || 'ACTIVE',
            capabilities: create.capabilities || {},
            assignedAgentId: create.assignedAgentId || null,
            inboundWebhookUrl: create.inboundWebhookUrl || null,
            outboundCallerIdEnabled: create.outboundCallerIdEnabled ?? true,
            purchasedWithoutAutoBuy: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          store.telephonyPhoneNumbers.set(id, record);
          return record;
        }
      },
      delete: async ({ where }: any) => {
        const id = where.id;
        if (id && store.telephonyPhoneNumbers.has(id)) {
          const record = store.telephonyPhoneNumbers.get(id);
          store.telephonyPhoneNumbers.delete(id);
          return record;
        }
        return null;
      },
    },

    passwordResetToken: {
      findFirst: async ({ where, include }: any) => {
        const now = new Date();
        for (const token of store.passwordResetTokens.values()) {
          if (where.tokenHash && token.tokenHash !== where.tokenHash) continue;
          if (where.userId && token.userId !== where.userId) continue;
          if (where.usedAt === null && token.usedAt !== null) continue;
          if (where.expiresAt?.gt && new Date(token.expiresAt) <= now) continue;
          const user = include?.user ? store.users.get(token.userId) || null : undefined;
          return { ...token, ...(include?.user ? { user } : {}) };
        }
        return null;
      },
      findUnique: async ({ where, include }: any) => {
        let match: any = null;
        if (where.id) match = store.passwordResetTokens.get(where.id);
        if (!match && where.tokenHash) {
          for (const token of store.passwordResetTokens.values()) {
            if (token.tokenHash === where.tokenHash) {
              match = token;
              break;
            }
          }
        }
        if (!match) return null;
        const user = include?.user ? store.users.get(match.userId) || null : undefined;
        return { ...match, ...(include?.user ? { user } : {}) };
      },
      create: async ({ data }: any) => {
        const id = crypto.randomUUID();
        const record = {
          id,
          userId: data.userId,
          tokenHash: data.tokenHash,
          expiresAt: data.expiresAt,
          usedAt: null,
          createdAt: new Date(),
        };
        store.passwordResetTokens.set(id, record);
        return record;
      },
      update: async ({ where, data }: any) => {
        const token = store.passwordResetTokens.get(where.id);
        if (!token) throw new Error('PasswordResetToken not found');
        const updated = { ...token, ...data };
        store.passwordResetTokens.set(where.id, updated);
        return updated;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const token of store.passwordResetTokens.values()) {
          if (where.userId && token.userId !== where.userId) continue;
          if (where.usedAt === null && token.usedAt !== null) continue;
          store.passwordResetTokens.set(token.id, { ...token, ...data });
          count++;
        }
        return { count };
      },
      delete: async ({ where }: any) => {
        const id = where.id;
        if (id && store.passwordResetTokens.has(id)) {
          const record = store.passwordResetTokens.get(id);
          store.passwordResetTokens.delete(id);
          return record;
        }
        return null;
      },
      deleteMany: async ({ where }: any) => {
        let count = 0;
        const now = new Date();
        for (const [id, token] of store.passwordResetTokens.entries()) {
          let shouldDelete = false;
          if (where.userId && token.userId === where.userId) shouldDelete = true;
          if (where.OR) {
            for (const cond of where.OR) {
              if (cond.expiresAt?.lt && new Date(token.expiresAt) < now) shouldDelete = true;
              if (cond.usedAt?.not !== undefined && token.usedAt !== null) shouldDelete = true;
            }
          }
          if (shouldDelete) {
            store.passwordResetTokens.delete(id);
            count++;
          }
        }
        return { count };
      },
    },

    appointment: {
      findFirst: async ({ where, include }: any = {}) => {
        for (const appt of store.appointments.values()) {
          if (where?.id && appt.id !== where.id) continue;
          if (where?.workspaceId && appt.workspaceId !== where.workspaceId) continue;
          if (where?.leadId && appt.leadId !== where.leadId) continue;
          if (where?.contactId && appt.contactId !== where.contactId) continue;
          if (where?.userId && appt.userId !== where.userId) continue;
          if (where?.status && appt.status !== where.status) continue;
          const contact = appt.contactId ? store.contacts.get(appt.contactId) || null : null;
          const lead = appt.leadId ? store.leads.get(appt.leadId) || null : null;
          return {
            ...appt,
            ...(include?.contact ? { contact } : {}),
            ...(include?.lead ? { lead } : {}),
          };
        }
        return null;
      },
      findUnique: async ({ where, include }: any = {}) => {
        const appt = store.appointments.get(where.id);
        if (!appt) return null;
        const contact = appt.contactId ? store.contacts.get(appt.contactId) || null : null;
        const lead = appt.leadId ? store.leads.get(appt.leadId) || null : null;
        return {
          ...appt,
          ...(include?.contact ? { contact } : {}),
          ...(include?.lead ? { lead } : {}),
        };
      },
      findMany: async ({ where, orderBy, skip, take, include }: any = {}) => {
        let results = Array.from(store.appointments.values()).filter((appt: any) => {
          if (where?.workspaceId && appt.workspaceId !== where.workspaceId) return false;
          if (where?.leadId && appt.leadId !== where.leadId) return false;
          if (where?.contactId && appt.contactId !== where.contactId) return false;
          if (where?.userId && appt.userId !== where.userId) return false;
          if (where?.status && appt.status !== where.status) return false;
          if (where?.scheduledStartTime?.gte && new Date(appt.scheduledStartTime) < new Date(where.scheduledStartTime.gte)) return false;
          if (where?.scheduledStartTime?.lte && new Date(appt.scheduledStartTime) > new Date(where.scheduledStartTime.lte)) return false;
          return true;
        });
        if (orderBy?.scheduledStartTime === 'asc') {
          results = results.slice().sort((a: any, b: any) => new Date(a.scheduledStartTime).getTime() - new Date(b.scheduledStartTime).getTime());
        } else if (orderBy?.scheduledStartTime === 'desc') {
          results = results.slice().sort((a: any, b: any) => new Date(b.scheduledStartTime).getTime() - new Date(a.scheduledStartTime).getTime());
        }
        if (skip !== undefined && take !== undefined) {
          results = results.slice(skip, skip + take);
        } else if (take !== undefined) {
          results = results.slice(0, take);
        }
        return results.map((appt: any) => {
          const contact = appt.contactId ? store.contacts.get(appt.contactId) || null : null;
          const lead = appt.leadId ? store.leads.get(appt.leadId) || null : null;
          return {
            ...appt,
            ...(include?.contact ? { contact } : {}),
            ...(include?.lead ? { lead } : {}),
          };
        });
      },
      count: async ({ where }: any = {}) => {
        return Array.from(store.appointments.values()).filter((appt: any) => {
          if (where?.workspaceId && appt.workspaceId !== where.workspaceId) return false;
          if (where?.leadId && appt.leadId !== where.leadId) return false;
          if (where?.contactId && appt.contactId !== where.contactId) return false;
          if (where?.userId && appt.userId !== where.userId) return false;
          if (where?.status && appt.status !== where.status) return false;
          if (where?.scheduledStartTime?.gte && new Date(appt.scheduledStartTime) < new Date(where.scheduledStartTime.gte)) return false;
          if (where?.scheduledStartTime?.lte && new Date(appt.scheduledStartTime) > new Date(where.scheduledStartTime.lte)) return false;
          return true;
        }).length;
      },
      create: async ({ data, include }: any) => {
        const id = crypto.randomUUID();
        const appt = {
          id,
          workspaceId: data.workspaceId,
          leadId: data.leadId,
          contactId: data.contactId || null,
          userId: data.userId || null,
          title: data.title || 'Meeting',
          scheduledStartTime: new Date(data.scheduledStartTime),
          scheduledEndTime: new Date(data.scheduledEndTime),
          meetingLink: data.meetingLink || null,
          status: data.status || 'SCHEDULED',
          notes: data.notes || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.appointments.set(id, appt);
        const contact = appt.contactId ? store.contacts.get(appt.contactId) || null : null;
        const lead = appt.leadId ? store.leads.get(appt.leadId) || null : null;
        return {
          ...appt,
          ...(include?.contact ? { contact } : {}),
          ...(include?.lead ? { lead } : {}),
        };
      },
      update: async ({ where, data, include }: any) => {
        const existing = store.appointments.get(where.id);
        if (!existing) throw new Error('Appointment not found');
        const updated = {
          ...existing,
          ...data,
          scheduledStartTime: data.scheduledStartTime ? new Date(data.scheduledStartTime) : existing.scheduledStartTime,
          scheduledEndTime: data.scheduledEndTime ? new Date(data.scheduledEndTime) : existing.scheduledEndTime,
          updatedAt: new Date(),
        };
        store.appointments.set(where.id, updated);
        const contact = updated.contactId ? store.contacts.get(updated.contactId) || null : null;
        const lead = updated.leadId ? store.leads.get(updated.leadId) || null : null;
        return {
          ...updated,
          ...(include?.contact ? { contact } : {}),
          ...(include?.lead ? { lead } : {}),
        };
      },
      delete: async ({ where }: any) => {
        const existing = store.appointments.get(where.id);
        if (!existing) throw new Error('Appointment not found');
        store.appointments.delete(where.id);
        return existing;
      },
    },

    $transaction: async (cb: (tx: any) => Promise<any>) => {
      return cb(client);
    },
  } as unknown as PrismaClient;

  return client;
}
