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
          .filter((l) => !where?.workspaceId || l.workspaceId === where.workspaceId)
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
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.leads.set(id, lead);
        return { ...lead, contacts: [] };
      },
      update: async ({ where, data }: any) => {
        const lead = store.leads.get(where.id);
        if (!lead) throw new Error('Lead not found');
        const updated = { ...lead, ...data, updatedAt: new Date() };
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
        const record = { id: crypto.randomUUID(), ...data, createdAt: new Date(), updatedAt: new Date() };
        store.voiceAgentConfigs.set(record.id, record);
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

    $transaction: async (cb: (tx: any) => Promise<any>) => {
      return cb(client);
    },
  } as unknown as PrismaClient;

  return client;
}
