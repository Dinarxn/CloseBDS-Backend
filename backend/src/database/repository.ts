import type {
  PrismaClient,
  User,
  Workspace,
  Campaign,
  CampaignStatus,
  Lead,
  LeadStatus,
  Contact,
  LeadSource,
  WebsiteAudit,
  AIAnalysis,
  LeadScore,
  EmailCampaign,
  EmailMessage,
  EmailMessageStatus,
  CRMActivity,
  CRMActivityType,
  Task,
  TaskStatus,
  Suppression,
  SuppressionType,
  Notification,
  NotificationType,
  AuditLog,
  VoiceCampaign,
  VoiceAgentConfig,
  Call,
  CallStatus,
  CallAttempt,
  CallEvent,
  CallEventType,
  CallTranscript,
  CallOutcome,
  CallOutcomeType,
  N8nIntegration,
  N8nWebhookDelivery,
  Prisma,
} from '@prisma/client';
import type { WorkspaceCallingPolicy } from '../modules/voice/voice.types.js';
import { databaseClient, type DatabaseClient } from './client.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../core/errors/api-error.js';

export interface PaginationResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Base generic repository interface enforcing multi-tenant isolation.
 */
export interface BaseRepository<TEntity, TId = string> {
  findById(id: TId, workspaceId: string): Promise<TEntity | null>;
  findMany(workspaceId: string, filter?: Record<string, unknown>): Promise<TEntity[]>;
  delete(id: TId, workspaceId: string): Promise<boolean>;
}

// ==============================================================================
// 1. Workspace Repository
// ==============================================================================

export interface CreateWorkspaceInput {
  name: string;
  slug: string;
}

export class WorkspaceRepository {
  constructor(private db: DatabaseClient = databaseClient) {}

  private get prisma(): PrismaClient {
    return this.db.getPrismaClient();
  }

  async findById(id: string): Promise<Workspace | null> {
    return this.prisma.workspace.findUnique({
      where: { id },
    });
  }

  async findBySlug(slug: string): Promise<Workspace | null> {
    return this.prisma.workspace.findUnique({
      where: { slug },
    });
  }

  async create(data: CreateWorkspaceInput): Promise<Workspace> {
    return this.prisma.workspace.create({
      data,
    });
  }

  async update(id: string, data: { name?: string }): Promise<Workspace> {
    return this.prisma.workspace.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
      },
    });
  }
}

// ==============================================================================
// 2. User Repository (Multi-Tenant Scoped)
// ==============================================================================

export interface CreateUserInput {
  workspaceId: string;
  email: string;
  name: string;
  passwordHash: string;
  role?: 'OWNER' | 'ADMIN' | 'MEMBER';
}

export class UserRepository implements BaseRepository<User> {
  constructor(private db: DatabaseClient = databaseClient) {}

  private get prisma(): PrismaClient {
    return this.db.getPrismaClient();
  }

  async findById(id: string, workspaceId: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { id, workspaceId },
    });
  }

  async findByEmail(email: string, workspaceId: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { email, workspaceId },
    });
  }

  async findMany(workspaceId: string): Promise<User[]> {
    return this.prisma.user.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: CreateUserInput): Promise<User> {
    return this.prisma.user.create({
      data: {
        workspaceId: data.workspaceId,
        email: data.email,
        name: data.name,
        passwordHash: data.passwordHash,
        role: data.role || 'MEMBER',
      },
    });
  }

  async delete(id: string, workspaceId: string): Promise<boolean> {
    const existing = await this.findById(id, workspaceId);
    if (!existing) {
      return false;
    }
    await this.prisma.user.delete({ where: { id } });
    return true;
  }
}

// ==============================================================================
// 3. Campaign Repository (Multi-Tenant Scoped)
// ==============================================================================

export interface CreateCampaignInput {
  workspaceId: string;
  name: string;
  niche: string;
  location: string;
  targetOffer: string;
  dailyCap?: number;
}

export interface UpdateCampaignInput {
  name?: string;
  niche?: string;
  location?: string;
  targetOffer?: string;
  dailyCap?: number;
  status?: CampaignStatus;
}

export class CampaignRepository implements BaseRepository<Campaign> {
  constructor(private db: DatabaseClient = databaseClient) {}

  private get prisma(): PrismaClient {
    return this.db.getPrismaClient();
  }

  async findById(id: string, workspaceId: string): Promise<(Campaign & { _count?: { leads: number } }) | null> {
    return this.prisma.campaign.findFirst({
      where: { id, workspaceId },
      include: {
        emailCampaign: true,
        _count: {
          select: { leads: true },
        },
      },
    });
  }

  async findMany(
    workspaceId: string,
    filter?: { status?: CampaignStatus }
  ): Promise<Campaign[]> {
    return this.prisma.campaign.findMany({
      where: {
        workspaceId,
        ...(filter?.status ? { status: filter.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findManyPaginated(
    workspaceId: string,
    filter?: { status?: CampaignStatus; search?: string; page?: number; limit?: number }
  ): Promise<PaginationResult<Campaign & { _count?: { leads: number } }>> {
    const page = Math.max(1, filter?.page || 1);
    const limit = Math.min(100, Math.max(1, filter?.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.CampaignWhereInput = {
      workspaceId,
      ...(filter?.status ? { status: filter.status } : {}),
      ...(filter?.search
        ? {
            OR: [
              { name: { contains: filter.search, mode: 'insensitive' } },
              { niche: { contains: filter.search, mode: 'insensitive' } },
              { location: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, data] = await Promise.all([
      this.prisma.campaign.count({ where }),
      this.prisma.campaign.findMany({
        where,
        include: {
          _count: {
            select: { leads: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async create(data: CreateCampaignInput): Promise<Campaign> {
    return this.prisma.campaign.create({
      data: {
        workspaceId: data.workspaceId,
        name: data.name,
        niche: data.niche,
        location: data.location,
        targetOffer: data.targetOffer,
        dailyCap: data.dailyCap ?? 50,
      },
    });
  }

  async update(id: string, workspaceId: string, data: UpdateCampaignInput): Promise<Campaign> {
    const existing = await this.findById(id, workspaceId);
    if (!existing) {
      throw new NotFoundError('Campaign not found or access denied for this workspace');
    }

    return this.prisma.campaign.update({
      where: { id },
      data: {
        name: data.name,
        niche: data.niche,
        location: data.location,
        targetOffer: data.targetOffer,
        dailyCap: data.dailyCap,
        status: data.status,
      },
    });
  }

  async updateStatus(
    id: string,
    workspaceId: string,
    status: CampaignStatus
  ): Promise<Campaign> {
    const existing = await this.findById(id, workspaceId);
    if (!existing) {
      throw new ForbiddenError('Campaign not found or access denied for this workspace');
    }
    return this.prisma.campaign.update({
      where: { id },
      data: { status },
    });
  }

  async delete(id: string, workspaceId: string): Promise<boolean> {
    const existing = await this.findById(id, workspaceId);
    if (!existing) {
      return false;
    }
    await this.prisma.campaign.delete({ where: { id } });
    return true;
  }
}

// ==============================================================================
// 4. Lead & Contact Repository (Multi-Tenant Scoped with Deduplication)
// ==============================================================================

export interface CreateLeadInput {
  workspaceId: string;
  campaignId?: string;
  businessName: string;
  domain?: string;
  phone?: string;
  address?: string;
  status?: LeadStatus;
  contacts?: Array<{
    fullName: string;
    email: string;
    title?: string;
    phone?: string;
    isPrimary?: boolean;
  }>;
}

export interface UpdateLeadInput {
  businessName?: string;
  domain?: string;
  phone?: string;
  address?: string;
  status?: LeadStatus;
}

export interface CreateContactInput {
  fullName: string;
  email: string;
  title?: string;
  phone?: string;
  isPrimary?: boolean;
}

export interface UpdateContactInput {
  fullName?: string;
  email?: string;
  title?: string;
  phone?: string;
  isPrimary?: boolean;
}

export interface DiscoveryLeadCandidateInput {
  businessName: string;
  domain?: string | null;
  phone?: string | null;
  address?: string | null;
}

const GENERIC_DISCOVERY_DOMAINS = new Set([
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'youtube.com',
  'tiktok.com',
  'linktr.ee',
  'google.com',
  'maps.google.com',
  'yelp.com',
  'tripadvisor.com',
  'wix.com',
  'squarespace.com',
  'wordpress.com',
  'github.io',
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
]);

export function normalizeDiscoveryDomain(domain?: string | null): string | null {
  if (!domain || typeof domain !== 'string') return null;
  const clean = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')
    .split('/')[0]
    .split(':')[0];
  if (clean.length < 4 || clean.includes(' ') || !clean.includes('.')) return null;
  if (GENERIC_DISCOVERY_DOMAINS.has(clean)) return null;
  return clean;
}

export function normalizeDiscoveryPhone(phone?: string | null): string | null {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.length < 7) return null;
  return digits;
}

export function normalizeDiscoveryName(name: string): string {
  if (!name || typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()'"?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeDiscoveryAddress(address?: string | null): string | null {
  if (!address || typeof address !== 'string') return null;
  const clean = address
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()'"?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length >= 3 ? clean : null;
}

export class LeadRepository implements BaseRepository<Lead> {
  constructor(private db: DatabaseClient = databaseClient) {}

  private get prisma(): PrismaClient {
    return this.db.getPrismaClient();
  }

  async findById(
    id: string,
    workspaceId: string
  ): Promise<(Lead & { contacts: Contact[]; websiteAudit: WebsiteAudit | null; leadScore: LeadScore | null; aiAnalysis: AIAnalysis | null }) | null> {
    return this.prisma.lead.findFirst({
      where: { id, workspaceId },
      include: {
        contacts: true,
        leadScore: true,
        websiteAudit: true,
        aiAnalysis: true,
      },
    });
  }

  async findByMatchKey(
    workspaceId: string,
    businessName: string,
    domain?: string,
    phone?: string,
    address?: string
  ): Promise<Lead | null> {
    return this.prisma.lead.findFirst({
      where: {
        workspaceId,
        businessName,
        domain: domain ?? null,
        phone: phone ?? null,
        address: address ?? null,
      },
    });
  }

  /**
   * Conservative hierarchical deduplication for lead discovery across multiple providers.
   * Scoped strictly to the provided workspaceId.
   *
   * Tiers:
   * 0. Fast-path: Exact 5-factor match key (businessName, domain, phone, address).
   * 1. Strong domain match with corroboration (normalized business name or phone or address).
   * 2. Phone + Business Name match (normalized phone digits + case-insensitive business name).
   * 3. Business Name + Address fallback (normalized business name + address).
   */
  async findExistingLeadForDiscovery(
    workspaceId: string,
    candidate: DiscoveryLeadCandidateInput
  ): Promise<Lead | null> {
    const rawBizName = candidate.businessName?.trim();
    if (!rawBizName) {
      return null;
    }

    // Tier 0: Exact match check
    const exactMatch = await this.findByMatchKey(
      workspaceId,
      rawBizName,
      candidate.domain || undefined,
      candidate.phone || undefined,
      candidate.address || undefined
    );
    if (exactMatch) {
      return exactMatch;
    }

    const normName = normalizeDiscoveryName(rawBizName);
    const normDomain = normalizeDiscoveryDomain(candidate.domain);
    const normPhone = normalizeDiscoveryPhone(candidate.phone);
    const normAddress = normalizeDiscoveryAddress(candidate.address);

    // Tier 1: Strong domain match with corroborating signal
    if (normDomain) {
      const candidatesByDomain = await this.prisma.lead.findMany({
        where: {
          workspaceId,
          domain: { equals: normDomain, mode: 'insensitive' },
        },
      });

      for (const existing of candidatesByDomain) {
        const existNameNorm = normalizeDiscoveryName(existing.businessName);
        const nameCorroborated =
          existNameNorm === normName ||
          existNameNorm.includes(normName) ||
          normName.includes(existNameNorm);

        // Corroboration by name similarity
        if (nameCorroborated) {
          return existing;
        }

        // Corroboration by phone
        if (normPhone && existing.phone) {
          const existPhoneNorm = normalizeDiscoveryPhone(existing.phone);
          if (
            existPhoneNorm &&
            (existPhoneNorm === normPhone ||
              existPhoneNorm.endsWith(normPhone.slice(-8)) ||
              normPhone.endsWith(existPhoneNorm.slice(-8)))
          ) {
            return existing;
          }
        }

        // Corroboration by address
        if (normAddress && existing.address) {
          const existAddrNorm = normalizeDiscoveryAddress(existing.address);
          if (
            existAddrNorm &&
            (existAddrNorm === normAddress ||
              existAddrNorm.includes(normAddress) ||
              normAddress.includes(existAddrNorm))
          ) {
            return existing;
          }
        }
      }
    }

    // Tier 2: Phone + Business Name match
    if (normPhone) {
      const candidatesWithPhone = await this.prisma.lead.findMany({
        where: {
          workspaceId,
          phone: { not: null },
        },
      });

      for (const existing of candidatesWithPhone) {
        if (!existing.phone) continue;
        const existPhoneNorm = normalizeDiscoveryPhone(existing.phone);
        const phoneMatches =
          existPhoneNorm &&
          (existPhoneNorm === normPhone ||
            existPhoneNorm.endsWith(normPhone.slice(-8)) ||
            normPhone.endsWith(existPhoneNorm.slice(-8)));

        if (phoneMatches) {
          const existNameNorm = normalizeDiscoveryName(existing.businessName);
          if (
            existNameNorm === normName ||
            existNameNorm.includes(normName) ||
            normName.includes(existNameNorm)
          ) {
            return existing;
          }
        }
      }
    }

    // Tier 3: Business Name + Address fallback
    if (normAddress && normName) {
      const candidatesWithAddress = await this.prisma.lead.findMany({
        where: {
          workspaceId,
          address: { not: null },
        },
      });

      for (const existing of candidatesWithAddress) {
        if (!existing.address) continue;
        const existNameNorm = normalizeDiscoveryName(existing.businessName);
        const nameMatches =
          existNameNorm === normName ||
          existNameNorm.includes(normName) ||
          normName.includes(existNameNorm);

        if (nameMatches) {
          const existAddrNorm = normalizeDiscoveryAddress(existing.address);
          if (
            existAddrNorm &&
            (existAddrNorm === normAddress ||
              existAddrNorm.includes(normAddress) ||
              normAddress.includes(existAddrNorm))
          ) {
            return existing;
          }
        }
      }
    }

    return null;
  }

  async findMany(
    workspaceId: string,
    filter?: { campaignId?: string; status?: LeadStatus }
  ): Promise<Lead[]> {
    return this.prisma.lead.findMany({
      where: {
        workspaceId,
        ...(filter?.campaignId ? { campaignId: filter.campaignId } : {}),
        ...(filter?.status ? { status: filter.status } : {}),
      },
      include: {
        contacts: true,
        leadScore: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findManyPaginated(
    workspaceId: string,
    filter?: { campaignId?: string; status?: LeadStatus; search?: string; page?: number; limit?: number }
  ): Promise<PaginationResult<Lead & { contacts: Contact[] }>> {
    const page = Math.max(1, filter?.page || 1);
    const limit = Math.min(100, Math.max(1, filter?.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.LeadWhereInput = {
      workspaceId,
      ...(filter?.campaignId ? { campaignId: filter.campaignId } : {}),
      ...(filter?.status ? { status: filter.status } : {}),
      ...(filter?.search
        ? {
            OR: [
              { businessName: { contains: filter.search, mode: 'insensitive' } },
              { domain: { contains: filter.search, mode: 'insensitive' } },
              { address: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, data] = await Promise.all([
      this.prisma.lead.count({ where }),
      this.prisma.lead.findMany({
        where,
        include: {
          contacts: true,
          leadScore: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async create(data: CreateLeadInput): Promise<Lead & { contacts: Contact[] }> {
    return this.prisma.lead.create({
      data: {
        workspaceId: data.workspaceId,
        campaignId: (data.campaignId ?? undefined) as any,
        businessName: data.businessName,
        domain: data.domain,
        phone: data.phone,
        address: data.address,
        status: data.status || 'NEW',
        contacts: data.contacts
          ? {
              create: data.contacts.map((c) => ({
                fullName: c.fullName,
                email: c.email,
                title: c.title,
                phone: c.phone,
                isPrimary: c.isPrimary ?? false,
              })),
            }
          : undefined,
      },
      include: {
        contacts: true,
      },
    }) as unknown as Promise<Lead & { contacts: Contact[] }>;
  }

  async update(id: string, workspaceId: string, data: UpdateLeadInput): Promise<Lead> {
    const existing = await this.findById(id, workspaceId);
    if (!existing) {
      throw new NotFoundError('Lead not found or access denied for this workspace');
    }

    return this.prisma.lead.update({
      where: { id },
      data: {
        businessName: data.businessName,
        domain: data.domain,
        phone: data.phone,
        address: data.address,
        status: data.status,
      },
    });
  }

  async delete(id: string, workspaceId: string): Promise<boolean> {
    const existing = await this.findById(id, workspaceId);
    if (!existing) {
      return false;
    }
    await this.prisma.lead.delete({ where: { id } });
    return true;
  }

  // --- Contact Operations (Scoped to Lead + Workspace) ---

  async findContacts(leadId: string, workspaceId: string): Promise<Contact[]> {
    const lead = await this.findById(leadId, workspaceId);
    if (!lead) {
      throw new NotFoundError('Lead not found or access denied for this workspace');
    }
    return this.prisma.contact.findMany({
      where: { leadId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findContactById(contactId: string, leadId: string, workspaceId: string): Promise<Contact | null> {
    const lead = await this.findById(leadId, workspaceId);
    if (!lead) {
      throw new NotFoundError('Lead not found or access denied for this workspace');
    }
    return this.prisma.contact.findFirst({
      where: { id: contactId, leadId },
    });
  }

  async createContact(leadId: string, workspaceId: string, data: CreateContactInput): Promise<Contact> {
    const lead = await this.findById(leadId, workspaceId);
    if (!lead) {
      throw new NotFoundError('Lead not found or access denied for this workspace');
    }

    return this.prisma.contact.create({
      data: {
        leadId,
        fullName: data.fullName,
        email: data.email,
        title: data.title,
        phone: data.phone,
        isPrimary: data.isPrimary ?? false,
      },
    });
  }

  async updateContact(
    contactId: string,
    leadId: string,
    workspaceId: string,
    data: UpdateContactInput
  ): Promise<Contact> {
    const contact = await this.findContactById(contactId, leadId, workspaceId);
    if (!contact) {
      throw new NotFoundError('Contact not found or access denied');
    }

    return this.prisma.contact.update({
      where: { id: contactId },
      data: {
        fullName: data.fullName,
        email: data.email,
        title: data.title,
        phone: data.phone,
        isPrimary: data.isPrimary,
      },
    });
  }

  async deleteContact(contactId: string, leadId: string, workspaceId: string): Promise<boolean> {
    const contact = await this.findContactById(contactId, leadId, workspaceId);
    if (!contact) {
      return false;
    }
    await this.prisma.contact.delete({ where: { id: contactId } });
    return true;
  }
}

// ==============================================================================
// 5. Suppression Repository (Multi-Tenant Scoped)
// ==============================================================================

export interface CreateSuppressionInput {
  workspaceId: string;
  type: 'EMAIL' | 'DOMAIN' | 'PHONE' | SuppressionType;
  value: string;
  reason: 'OPT_OUT' | 'HARD_BOUNCE' | 'MANUAL_SUPPRESSION';
}

export class SuppressionRepository implements BaseRepository<Suppression> {
  constructor(private db: DatabaseClient = databaseClient) {}

  private get prisma(): PrismaClient {
    return this.db.getPrismaClient();
  }

  async findById(id: string, workspaceId: string): Promise<Suppression | null> {
    return this.prisma.suppression.findFirst({
      where: { id, workspaceId },
    });
  }

  async isSuppressed(workspaceId: string, emailOrPhone: string, domain?: string): Promise<boolean> {
    const valuesToCheck = [emailOrPhone.toLowerCase().trim()];
    if (domain) {
      valuesToCheck.push(domain.toLowerCase().trim());
    }

    const match = await this.prisma.suppression.findFirst({
      where: {
        workspaceId,
        value: { in: valuesToCheck },
      },
    });

    return match !== null;
  }

  async isPhoneSuppressed(workspaceId: string, normalizedPhone: string): Promise<boolean> {
    const cleanPhone = normalizedPhone.trim();
    const match = await this.prisma.suppression.findFirst({
      where: {
        workspaceId,
        type: 'PHONE',
        value: cleanPhone,
      },
    });

    return match !== null;
  }

  async findMany(workspaceId: string): Promise<Suppression[]> {
    return this.prisma.suppression.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findManyPaginated(
    workspaceId: string,
    filter?: {
      type?: 'EMAIL' | 'DOMAIN' | 'PHONE' | SuppressionType;
      search?: string;
      page?: number;
      limit?: number;
    }
  ): Promise<PaginationResult<Suppression>> {
    const page = Math.max(1, filter?.page || 1);
    const limit = Math.min(100, Math.max(1, filter?.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.SuppressionWhereInput = {
      workspaceId,
      ...(filter?.type ? { type: filter.type } : {}),
      ...(filter?.search
        ? {
            value: { contains: filter.search, mode: 'insensitive' },
          }
        : {}),
    };

    const [total, data] = await Promise.all([
      this.prisma.suppression.count({ where }),
      this.prisma.suppression.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async create(data: CreateSuppressionInput): Promise<Suppression> {
    return this.prisma.suppression.upsert({
      where: {
        unique_workspace_suppression: {
          workspaceId: data.workspaceId,
          type: data.type,
          value: data.value.toLowerCase().trim(),
        },
      },
      update: {
        reason: data.reason,
      },
      create: {
        workspaceId: data.workspaceId,
        type: data.type,
        value: data.value.toLowerCase().trim(),
        reason: data.reason,
      },
    });
  }

  async delete(id: string, workspaceId: string): Promise<boolean> {
    const existing = await this.findById(id, workspaceId);
    if (!existing) {
      return false;
    }
    await this.prisma.suppression.delete({ where: { id } });
    return true;
  }
}

// ==============================================================================
// 6. Audit Repository (Multi-Tenant Scoped)
// ==============================================================================

export interface CreateAuditLogInput {
  workspaceId: string;
  userId?: string;
  eventType: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export class AuditRepository implements BaseRepository<AuditLog> {
  constructor(private db: DatabaseClient = databaseClient) {}

  private get prisma(): PrismaClient {
    return this.db.getPrismaClient();
  }

  async findById(id: string, workspaceId: string): Promise<AuditLog | null> {
    return this.prisma.auditLog.findFirst({
      where: { id, workspaceId },
    });
  }

  async findMany(
    workspaceId: string,
    filter?: { eventType?: string; entityType?: string; entityId?: string }
  ): Promise<AuditLog[]> {
    return this.prisma.auditLog.findMany({
      where: {
        workspaceId,
        ...(filter?.eventType ? { eventType: filter.eventType } : {}),
        ...(filter?.entityType ? { entityType: filter.entityType } : {}),
        ...(filter?.entityId ? { entityId: filter.entityId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async create(data: CreateAuditLogInput): Promise<AuditLog> {
    return this.prisma.auditLog.create({
      data: {
        workspaceId: data.workspaceId,
        userId: data.userId,
        eventType: data.eventType,
        entityType: data.entityType,
        entityId: data.entityId,
        metadata: data.metadata as Prisma.InputJsonValue,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
      },
    });
  }

  async delete(_id: string, _workspaceId: string): Promise<boolean> {
    // Audit logs are immutable by design and cannot be deleted
    throw new ForbiddenError('Audit logs are immutable and cannot be deleted');
  }
}

// ==============================================================================
// 7. LeadSource Repository (Multi-Tenant Scoped via Lead)
// ==============================================================================

export interface CreateLeadSourceInput {
  leadId: string;
  provider: string;
  externalId: string;
  queryPayload?: Record<string, unknown>;
}

export interface AdditionalSourceEntry {
  provider: string;
  externalId: string;
  discoveredAt: string;
}

export interface RecordDiscoverySourceInput {
  provider: string;
  externalId: string;
  queryPayload?: Record<string, unknown>;
}

export class LeadSourceRepository {
  constructor(private db: DatabaseClient = databaseClient) {}

  private get prisma(): PrismaClient {
    return this.db.getPrismaClient();
  }

  async findByLeadId(leadId: string, workspaceId: string): Promise<LeadSource | null> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, workspaceId },
      include: { leadSource: true },
    });
    return lead?.leadSource ?? null;
  }

  async upsert(leadId: string, workspaceId: string, data: CreateLeadSourceInput): Promise<LeadSource> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, workspaceId },
    });
    if (!lead) {
      throw new NotFoundError('Lead not found or access denied for this workspace');
    }

    return this.prisma.leadSource.upsert({
      where: { leadId },
      update: {
        provider: data.provider,
        externalId: data.externalId,
        queryPayload: data.queryPayload as Prisma.InputJsonValue,
      },
      create: {
        leadId,
        provider: data.provider,
        externalId: data.externalId,
        queryPayload: data.queryPayload as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Records discovery source while strictly preserving the primary provider identity.
   * If lead has no LeadSource, creates the primary LeadSource.
   * If lead already has a LeadSource:
   *   - If incoming source matches primary provider and externalId, preserves existing.
   *   - Otherwise, safely merges incoming provider into queryPayload.additionalSources
   *     without overwriting existing provider, externalId, or other queryPayload properties.
   *   - Prevents duplicate additional source entries for the same provider + externalId.
   */
  async recordDiscoverySource(
    leadId: string,
    workspaceId: string,
    data: RecordDiscoverySourceInput
  ): Promise<LeadSource> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, workspaceId },
      include: { leadSource: true },
    });
    if (!lead) {
      throw new NotFoundError('Lead not found or access denied for this workspace');
    }

    if (!lead.leadSource) {
      return this.prisma.leadSource.create({
        data: {
          leadId,
          provider: data.provider,
          externalId: data.externalId,
          queryPayload: (data.queryPayload || null) as Prisma.InputJsonValue,
        },
      });
    }

    const existingSource = lead.leadSource;

    // If incoming source matches primary provider and externalId exactly, preserve without change
    if (
      existingSource.provider === data.provider &&
      existingSource.externalId === data.externalId
    ) {
      return existingSource;
    }

    // Preserve existing payload and merge into additionalSources safely
    const currentPayload: Record<string, unknown> =
      existingSource.queryPayload &&
      typeof existingSource.queryPayload === 'object' &&
      !Array.isArray(existingSource.queryPayload)
        ? { ...(existingSource.queryPayload as Record<string, unknown>) }
        : {};

    const existingAdditional: AdditionalSourceEntry[] = Array.isArray(
      currentPayload.additionalSources
    )
      ? ([...currentPayload.additionalSources] as AdditionalSourceEntry[])
      : [];

    const isDuplicate = existingAdditional.some(
      (s) => s.provider === data.provider && s.externalId === data.externalId
    );

    if (!isDuplicate) {
      existingAdditional.push({
        provider: data.provider,
        externalId: data.externalId,
        discoveredAt: new Date().toISOString(),
      });
      currentPayload.additionalSources = existingAdditional;

      return this.prisma.leadSource.update({
        where: { leadId },
        data: {
          queryPayload: currentPayload as Prisma.InputJsonValue,
        },
      });
    }

    return existingSource;
  }
}

// ==============================================================================
// 8. WebsiteAudit Repository (Multi-Tenant Scoped via Lead)
// ==============================================================================

export interface SaveWebsiteAuditInput {
  domain: string;
  mobileOptimized: boolean;
  bookingCtaVisible: boolean;
  auditGaps: string[];
  rawAuditData?: Record<string, unknown>;
}

export class WebsiteAuditRepository {
  constructor(private db: DatabaseClient = databaseClient) {}

  private get prisma(): PrismaClient {
    return this.db.getPrismaClient();
  }

  async findByLeadId(leadId: string, workspaceId: string): Promise<WebsiteAudit | null> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, workspaceId },
      include: { websiteAudit: true },
    });
    return lead?.websiteAudit ?? null;
  }

  async upsert(leadId: string, workspaceId: string, data: SaveWebsiteAuditInput): Promise<WebsiteAudit> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, workspaceId },
    });
    if (!lead) {
      throw new NotFoundError('Lead not found or access denied for this workspace');
    }

    return this.prisma.websiteAudit.upsert({
      where: { leadId },
      update: {
        domain: data.domain,
        mobileOptimized: data.mobileOptimized,
        bookingCtaVisible: data.bookingCtaVisible,
        auditGaps: data.auditGaps,
        rawAuditData: data.rawAuditData as Prisma.InputJsonValue,
        auditedAt: new Date(),
      },
      create: {
        leadId,
        domain: data.domain,
        mobileOptimized: data.mobileOptimized,
        bookingCtaVisible: data.bookingCtaVisible,
        auditGaps: data.auditGaps,
        rawAuditData: data.rawAuditData as Prisma.InputJsonValue,
      },
    });
  }
}

// ==============================================================================
// 9. AIAnalysis Repository (Multi-Tenant Scoped via Lead)
// ==============================================================================

export interface SaveAIAnalysisInput {
  summary: string;
  opportunityPoints: string[];
  riskFactors: string[];
}

export class AIAnalysisRepository {
  constructor(private db: DatabaseClient = databaseClient) {}

  private get prisma(): PrismaClient {
    return this.db.getPrismaClient();
  }

  async findByLeadId(leadId: string, workspaceId: string): Promise<AIAnalysis | null> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, workspaceId },
      include: { aiAnalysis: true },
    });
    return lead?.aiAnalysis ?? null;
  }

  async upsert(leadId: string, workspaceId: string, data: SaveAIAnalysisInput): Promise<AIAnalysis> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, workspaceId },
    });
    if (!lead) {
      throw new NotFoundError('Lead not found or access denied for this workspace');
    }

    return this.prisma.aIAnalysis.upsert({
      where: { leadId },
      update: {
        summary: data.summary,
        opportunityPoints: data.opportunityPoints,
        riskFactors: data.riskFactors,
        analyzedAt: new Date(),
      },
      create: {
        leadId,
        summary: data.summary,
        opportunityPoints: data.opportunityPoints,
        riskFactors: data.riskFactors,
      },
    });
  }
}

// ==============================================================================
// 10. LeadScore Repository (Multi-Tenant Scoped via Lead)
// ==============================================================================

export interface SaveLeadScoreInput {
  relevanceScore: number;
  opportunityScore: number;
  totalScore: number;
  rationale: string;
}

export class LeadScoreRepository {
  constructor(private db: DatabaseClient = databaseClient) {}

  private get prisma(): PrismaClient {
    return this.db.getPrismaClient();
  }

  async findByLeadId(leadId: string, workspaceId: string): Promise<LeadScore | null> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, workspaceId },
      include: { leadScore: true },
    });
    return lead?.leadScore ?? null;
  }

  async upsert(leadId: string, workspaceId: string, data: SaveLeadScoreInput): Promise<LeadScore> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, workspaceId },
    });
    if (!lead) {
      throw new NotFoundError('Lead not found or access denied for this workspace');
    }

    return this.prisma.leadScore.upsert({
      where: { leadId },
      update: {
        relevanceScore: data.relevanceScore,
        opportunityScore: data.opportunityScore,
        totalScore: data.totalScore,
        rationale: data.rationale,
        scoredAt: new Date(),
      },
      create: {
        leadId,
        relevanceScore: data.relevanceScore,
        opportunityScore: data.opportunityScore,
        totalScore: data.totalScore,
        rationale: data.rationale,
      },
    });
  }
}

// ==============================================================================
// 11. Outreach (EmailMessage) Repository (Multi-Tenant Scoped)
// ==============================================================================

export type OutreachWithRelations = EmailMessage & {
  emailCampaign: EmailCampaign & { campaign: Campaign };
  contact: Contact & { lead: Lead };
};

export interface CreateOutreachMessageInput {
  campaignId: string;
  contactId: string;
  subject: string;
  bodyText: string;
}

export interface UpdateOutreachMessageInput {
  subject?: string;
  bodyText?: string;
  status?: EmailMessageStatus;
}

export class OutreachRepository {
  constructor(private db: DatabaseClient = databaseClient) {}

  private get prisma(): PrismaClient {
    return this.db.getPrismaClient();
  }

  async findById(id: string, workspaceId: string): Promise<OutreachWithRelations | null> {
    const message = await this.prisma.emailMessage.findFirst({
      where: {
        id,
        emailCampaign: {
          campaign: {
            workspaceId,
          },
        },
      },
      include: {
        emailCampaign: {
          include: {
            campaign: true,
          },
        },
        contact: {
          include: {
            lead: true,
          },
        },
      },
    });

    return (message as OutreachWithRelations) ?? null;
  }

  async findManyPaginated(
    workspaceId: string,
    filter?: {
      campaignId?: string;
      leadId?: string;
      contactId?: string;
      status?: EmailMessageStatus;
      search?: string;
      page?: number;
      limit?: number;
    }
  ): Promise<PaginationResult<OutreachWithRelations>> {
    const page = Math.max(1, filter?.page || 1);
    const limit = Math.min(100, Math.max(1, filter?.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.EmailMessageWhereInput = {
      emailCampaign: {
        campaign: {
          workspaceId,
          ...(filter?.campaignId ? { id: filter.campaignId } : {}),
        },
      },
      ...(filter?.contactId ? { contactId: filter.contactId } : {}),
      ...(filter?.leadId ? { contact: { leadId: filter.leadId } } : {}),
      ...(filter?.status ? { status: filter.status } : {}),
      ...(filter?.search
        ? {
            OR: [
              { subject: { contains: filter.search, mode: 'insensitive' } },
              { bodyText: { contains: filter.search, mode: 'insensitive' } },
              { contact: { fullName: { contains: filter.search, mode: 'insensitive' } } },
              { contact: { email: { contains: filter.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [total, data] = await Promise.all([
      this.prisma.emailMessage.count({ where }),
      this.prisma.emailMessage.findMany({
        where,
        include: {
          emailCampaign: {
            include: {
              campaign: true,
            },
          },
          contact: {
            include: {
              lead: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: data as OutreachWithRelations[],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async create(workspaceId: string, data: CreateOutreachMessageInput): Promise<OutreachWithRelations> {
    // 1. Verify Campaign belongs to workspace
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: data.campaignId, workspaceId },
    });
    if (!campaign) {
      throw new NotFoundError('Campaign not found or access denied for this workspace');
    }

    // 2. Verify Contact belongs to workspace (via Lead)
    const contact = await this.prisma.contact.findFirst({
      where: {
        id: data.contactId,
        lead: {
          workspaceId,
        },
      },
    });
    if (!contact) {
      throw new NotFoundError('Contact not found or access denied for this workspace');
    }

    // 3. Ensure EmailCampaign exists for this Campaign
    let emailCampaign = await this.prisma.emailCampaign.findUnique({
      where: { campaignId: data.campaignId },
    });
    if (!emailCampaign) {
      emailCampaign = await this.prisma.emailCampaign.create({
        data: {
          campaignId: data.campaignId,
          fromEmail: 'outreach@closevds.local',
          fromName: 'Growth Team',
          dailyCap: campaign.dailyCap,
        },
      });
    }

    // 4. Create EmailMessage in DRAFT status with humanApprovalRequired = true, isApproved = false
    const message = await this.prisma.emailMessage.create({
      data: {
        emailCampaignId: emailCampaign.id,
        contactId: data.contactId,
        subject: data.subject,
        bodyText: data.bodyText,
        status: 'DRAFT',
        humanApprovalRequired: true,
        isApproved: false,
      },
      include: {
        emailCampaign: {
          include: {
            campaign: true,
          },
        },
        contact: {
          include: {
            lead: true,
          },
        },
      },
    });

    return message as OutreachWithRelations;
  }

  async update(
    id: string,
    workspaceId: string,
    data: UpdateOutreachMessageInput
  ): Promise<OutreachWithRelations> {
    const existing = await this.findById(id, workspaceId);
    if (!existing) {
      throw new NotFoundError('Outreach draft not found or access denied for this workspace');
    }

    // If content is edited, invalidates prior approval and resets to DRAFT
    const contentChanged =
      (data.subject !== undefined && data.subject !== existing.subject) ||
      (data.bodyText !== undefined && data.bodyText !== existing.bodyText);

    const updatePayload: Prisma.EmailMessageUpdateInput = {
      ...(data.subject !== undefined ? { subject: data.subject } : {}),
      ...(data.bodyText !== undefined ? { bodyText: data.bodyText } : {}),
      ...(contentChanged
        ? {
            isApproved: false,
            approvedByUserId: null,
            approvedAt: null,
            status: 'DRAFT',
          }
        : data.status
        ? { status: data.status }
        : {}),
    };

    const updated = await this.prisma.emailMessage.update({
      where: { id },
      data: updatePayload,
      include: {
        emailCampaign: {
          include: {
            campaign: true,
          },
        },
        contact: {
          include: {
            lead: true,
          },
        },
      },
    });

    return updated as OutreachWithRelations;
  }

  async approve(id: string, workspaceId: string, userId: string): Promise<OutreachWithRelations> {
    const existing = await this.findById(id, workspaceId);
    if (!existing) {
      throw new NotFoundError('Outreach draft not found or access denied for this workspace');
    }

    const updated = await this.prisma.emailMessage.update({
      where: { id },
      data: {
        isApproved: true,
        approvedByUserId: userId,
        approvedAt: new Date(),
        status: 'APPROVED',
      },
      include: {
        emailCampaign: {
          include: {
            campaign: true,
          },
        },
        contact: {
          include: {
            lead: true,
          },
        },
      },
    });

    return updated as OutreachWithRelations;
  }

  async reject(id: string, workspaceId: string, _userId: string): Promise<OutreachWithRelations> {
    const existing = await this.findById(id, workspaceId);
    if (!existing) {
      throw new NotFoundError('Outreach draft not found or access denied for this workspace');
    }

    const updated = await this.prisma.emailMessage.update({
      where: { id },
      data: {
        isApproved: false,
        status: 'REJECTED',
      },
      include: {
        emailCampaign: {
          include: {
            campaign: true,
          },
        },
        contact: {
          include: {
            lead: true,
          },
        },
      },
    });

    return updated as OutreachWithRelations;
  }

  async cancel(id: string, workspaceId: string, _userId: string): Promise<OutreachWithRelations> {
    const existing = await this.findById(id, workspaceId);
    if (!existing) {
      throw new NotFoundError('Outreach draft not found or access denied for this workspace');
    }

    const updated = await this.prisma.emailMessage.update({
      where: { id },
      data: {
        isApproved: false,
        status: 'FAILED', // using FAILED/REJECTED or CANCELLED lifecycle mapping
      },
      include: {
        emailCampaign: {
          include: {
            campaign: true,
          },
        },
        contact: {
          include: {
            lead: true,
          },
        },
      },
    });

    return updated as OutreachWithRelations;
  }

  async countSentToday(workspaceId: string, campaignId: string): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    return this.prisma.emailMessage.count({
      where: {
        emailCampaign: {
          campaignId,
          campaign: {
            workspaceId,
          },
        },
        status: 'SENT',
        sentAt: {
          gte: startOfDay,
        },
      },
    });
  }

  async markSent(id: string, workspaceId: string, providerMessageId?: string): Promise<OutreachWithRelations> {
    const existing = await this.findById(id, workspaceId);
    if (!existing) {
      throw new NotFoundError('Outreach draft not found or access denied for this workspace');
    }

    const updated = await this.prisma.emailMessage.update({
      where: { id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
      },
      include: {
        emailCampaign: {
          include: {
            campaign: true,
          },
        },
        contact: {
          include: {
            lead: true,
          },
        },
      },
    });

    if (providerMessageId) {
      try {
        await this.prisma.emailEvent.create({
          data: {
            emailMessageId: id,
            eventType: 'DELIVERED',
            eventPayload: { providerMessageId, dispatchedAt: new Date().toISOString() },
            occurredAt: new Date(),
          },
        });
      } catch {
        // Non-blocking event creation
      }
    }

    return updated as OutreachWithRelations;
  }

  async markFailed(id: string, workspaceId: string, _errorReason?: string): Promise<OutreachWithRelations> {
    const existing = await this.findById(id, workspaceId);
    if (!existing) {
      throw new NotFoundError('Outreach draft not found or access denied for this workspace');
    }

    const updated = await this.prisma.emailMessage.update({
      where: { id },
      data: {
        status: 'FAILED',
      },
      include: {
        emailCampaign: {
          include: {
            campaign: true,
          },
        },
        contact: {
          include: {
            lead: true,
          },
        },
      },
    });

    return updated as OutreachWithRelations;
  }
}

// ==============================================================================
// 12. CRM Activity Repository (Multi-Tenant Scoped via Lead)
// ==============================================================================

export interface CreateCRMActivityInput {
  leadId: string;
  userId?: string;
  type: CRMActivityType;
  description: string;
  metadata?: Record<string, unknown>;
}

export class CRMActivityRepository {
  constructor(private db: DatabaseClient = databaseClient) {}

  private get prisma(): PrismaClient {
    return this.db.getPrismaClient();
  }

  async findManyByLeadId(leadId: string, workspaceId: string): Promise<CRMActivity[]> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, workspaceId },
    });
    if (!lead) {
      throw new NotFoundError('Lead not found or access denied for this workspace');
    }

    return this.prisma.cRMActivity.findMany({
      where: { leadId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(workspaceId: string, data: CreateCRMActivityInput): Promise<CRMActivity> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: data.leadId, workspaceId },
    });
    if (!lead) {
      throw new NotFoundError('Lead not found or access denied for this workspace');
    }

    return this.prisma.cRMActivity.create({
      data: {
        leadId: data.leadId,
        userId: data.userId,
        type: data.type,
        description: data.description,
        metadata: data.metadata as Prisma.InputJsonValue,
      },
    });
  }
}

// ==============================================================================
// 13. Task / Follow-Up Repository (Multi-Tenant Scoped via Lead)
// ==============================================================================

export type TaskWithRelations = Task & {
  lead: Lead;
  assignee: User | null;
};

export interface CreateTaskInput {
  leadId: string;
  assignedToUserId?: string;
  title: string;
  description?: string;
  dueDate?: Date;
  status?: TaskStatus;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  dueDate?: Date | null;
  status?: TaskStatus;
  assignedToUserId?: string | null;
}

export class TaskRepository {
  constructor(private db: DatabaseClient = databaseClient) {}

  private get prisma(): PrismaClient {
    return this.db.getPrismaClient();
  }

  async findById(id: string, workspaceId: string): Promise<TaskWithRelations | null> {
    const task = await this.prisma.task.findFirst({
      where: {
        id,
        lead: {
          workspaceId,
        },
      },
      include: {
        lead: true,
        assignee: true,
      },
    });

    return (task as TaskWithRelations) ?? null;
  }

  async findManyPaginated(
    workspaceId: string,
    filter?: {
      leadId?: string;
      assignedToUserId?: string;
      status?: TaskStatus;
      search?: string;
      page?: number;
      limit?: number;
    }
  ): Promise<PaginationResult<TaskWithRelations>> {
    const page = Math.max(1, filter?.page || 1);
    const limit = Math.min(100, Math.max(1, filter?.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.TaskWhereInput = {
      lead: {
        workspaceId,
        ...(filter?.leadId ? { id: filter.leadId } : {}),
      },
      ...(filter?.assignedToUserId ? { assignedToUserId: filter.assignedToUserId } : {}),
      ...(filter?.status ? { status: filter.status } : {}),
      ...(filter?.search
        ? {
            OR: [
              { title: { contains: filter.search, mode: 'insensitive' } },
              { description: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, data] = await Promise.all([
      this.prisma.task.count({ where }),
      this.prisma.task.findMany({
        where,
        include: {
          lead: true,
          assignee: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: data as TaskWithRelations[],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async create(workspaceId: string, data: CreateTaskInput): Promise<TaskWithRelations> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: data.leadId, workspaceId },
    });
    if (!lead) {
      throw new NotFoundError('Lead not found or access denied for this workspace');
    }

    if (data.assignedToUserId) {
      const user = await this.prisma.user.findFirst({
        where: { id: data.assignedToUserId, workspaceId },
      });
      if (!user) {
        throw new NotFoundError('Assigned user not found in this workspace');
      }
      if (!user.isActive) {
        throw new BadRequestError('Assigned user is not active in this workspace');
      }
    }

    const task = await this.prisma.task.create({
      data: {
        leadId: data.leadId,
        assignedToUserId: data.assignedToUserId,
        title: data.title,
        description: data.description,
        dueDate: data.dueDate,
        status: data.status || 'PENDING',
      },
      include: {
        lead: true,
        assignee: true,
      },
    });

    return task as TaskWithRelations;
  }

  async update(
    id: string,
    workspaceId: string,
    data: UpdateTaskInput
  ): Promise<TaskWithRelations> {
    const existing = await this.findById(id, workspaceId);
    if (!existing) {
      throw new NotFoundError('Task not found or access denied for this workspace');
    }

    if (data.assignedToUserId) {
      const user = await this.prisma.user.findFirst({
        where: { id: data.assignedToUserId, workspaceId },
      });
      if (!user) {
        throw new NotFoundError('Assigned user not found in this workspace');
      }
      if (!user.isActive) {
        throw new BadRequestError('Assigned user is not active in this workspace');
      }
    }

    const updated = await this.prisma.task.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.dueDate !== undefined ? { dueDate: data.dueDate } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.assignedToUserId !== undefined ? { assignedToUserId: data.assignedToUserId } : {}),
      },
      include: {
        lead: true,
        assignee: true,
      },
    });

    return updated as TaskWithRelations;
  }

  async delete(id: string, workspaceId: string): Promise<boolean> {
    const existing = await this.findById(id, workspaceId);
    if (!existing) {
      throw new NotFoundError('Task not found or access denied for this workspace');
    }

    await this.prisma.task.delete({
      where: { id },
    });

    return true;
  }
}

// ==============================================================================
// 14. Notification Repository (Multi-Tenant Scoped per User)
// ==============================================================================

export interface CreateNotificationInput {
  workspaceId: string;
  userId: string;
  title: string;
  message: string;
  type?: NotificationType;
}

export class NotificationRepository {
  constructor(private db: DatabaseClient = databaseClient) {}

  private get prisma(): PrismaClient {
    return this.db.getPrismaClient();
  }

  async findById(id: string, userId: string, workspaceId: string): Promise<Notification | null> {
    return this.prisma.notification.findFirst({
      where: { id, userId, workspaceId },
    });
  }

  async findManyPaginated(
    userId: string,
    workspaceId: string,
    filter?: {
      isRead?: boolean;
      type?: NotificationType;
      page?: number;
      limit?: number;
    }
  ): Promise<PaginationResult<Notification>> {
    const page = Math.max(1, filter?.page || 1);
    const limit = Math.min(100, Math.max(1, filter?.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.NotificationWhereInput = {
      userId,
      workspaceId,
      ...(filter?.isRead !== undefined ? { isRead: filter.isRead } : {}),
      ...(filter?.type ? { type: filter.type } : {}),
    };

    const [total, data] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async countUnread(userId: string, workspaceId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, workspaceId, isRead: false },
    });
  }

  async create(data: CreateNotificationInput): Promise<Notification> {
    return this.prisma.notification.create({
      data: {
        workspaceId: data.workspaceId,
        userId: data.userId,
        title: data.title,
        message: data.message,
        type: data.type || 'INFO',
      },
    });
  }

  async markAsRead(id: string, userId: string, workspaceId: string): Promise<Notification> {
    const existing = await this.findById(id, userId, workspaceId);
    if (!existing) {
      throw new NotFoundError('Notification not found');
    }

    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: string, workspaceId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, workspaceId, isRead: false },
      data: { isRead: true },
    });
    return result.count;
  }

  async delete(id: string, userId: string, workspaceId: string): Promise<boolean> {
    const existing = await this.findById(id, userId, workspaceId);
    if (!existing) {
      throw new NotFoundError('Notification not found');
    }

    await this.prisma.notification.delete({
      where: { id },
    });
    return true;
  }
}

// Global Repository Singletons
export const workspaceRepository = new WorkspaceRepository();
export const userRepository = new UserRepository();
export const campaignRepository = new CampaignRepository();
export const leadRepository = new LeadRepository();
export const suppressionRepository = new SuppressionRepository();
export const auditRepository = new AuditRepository();
export const leadSourceRepository = new LeadSourceRepository();
export const websiteAuditRepository = new WebsiteAuditRepository();
export const aiAnalysisRepository = new AIAnalysisRepository();
export const leadScoreRepository = new LeadScoreRepository();
export const outreachRepository = new OutreachRepository();
export const crmActivityRepository = new CRMActivityRepository();
export const taskRepository = new TaskRepository();
export const notificationRepository = new NotificationRepository();

// ==============================================================================
// 18. Voice Repository (Multi-Tenant Scoped)
// ==============================================================================

export type CallWithRelations = Call & {
  campaign?: Campaign | null;
  voiceCampaign?: VoiceCampaign | null;
  lead: Lead;
  contact: Contact;
  agentConfig: VoiceAgentConfig | null;
  attempts: CallAttempt[];
  events: CallEvent[];
  transcripts: CallTranscript[];
  outcome: CallOutcome | null;
};

export interface CreateVoiceCampaignInput {
  campaignId: string;
  dailyCallCap?: number;
  maxAttemptsPerLead?: number;
  retryDelayMinutes?: number;
  allowedCallingDays?: number[];
  callingWindowStart?: string;
  callingWindowEnd?: string;
  recordingConsent?: boolean;
  agentConfigId?: string | null;
}

export interface CreateVoiceAgentConfigInput {
  workspaceId: string;
  name: string;
  callObjective: string;
  openingScript: string;
  qualificationQuestions?: string[];
  approvedTalkingPoints?: string[];
  objectionHandling?: Record<string, string>;
  prohibitedClaims?: string[];
  escalationConditions?: string[];
  fallbackBehavior?: string;
  maxDurationSeconds?: number;
}

export interface CreateCallInput {
  workspaceId: string;
  campaignId?: string | null;
  voiceCampaignId?: string | null;
  leadId: string;
  contactId: string;
  agentConfigId?: string | null;
  recipientPhone: string;
  normalizedPhone: string;
  idempotencyKey?: string | null;
  humanApprovalRequired?: boolean;
  isApproved?: boolean;
  status?: CallStatus;
}

export interface ListCallsFilter {
  campaignId?: string;
  leadId?: string;
  contactId?: string;
  status?: CallStatus;
  search?: string;
  page?: number;
  limit?: number;
}

export class VoiceRepository {
  constructor(private db: DatabaseClient = databaseClient) {}

  private get prisma(): PrismaClient {
    return this.db.getPrismaClient();
  }

  // --- Voice Campaigns ---
  async upsertVoiceCampaign(
    campaignId: string,
    workspaceId: string,
    data: CreateVoiceCampaignInput
  ): Promise<VoiceCampaign> {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, workspaceId },
    });
    if (!campaign) {
      throw new NotFoundError('Campaign not found or access denied for this workspace');
    }

    return this.prisma.voiceCampaign.upsert({
      where: { campaignId },
      update: {
        dailyCallCap: data.dailyCallCap,
        maxAttemptsPerLead: data.maxAttemptsPerLead,
        retryDelayMinutes: data.retryDelayMinutes,
        allowedCallingDays: data.allowedCallingDays,
        callingWindowStart: data.callingWindowStart,
        callingWindowEnd: data.callingWindowEnd,
        recordingConsent: data.recordingConsent,
        agentConfigId: data.agentConfigId,
      },
      create: {
        campaignId,
        dailyCallCap: data.dailyCallCap ?? 25,
        maxAttemptsPerLead: data.maxAttemptsPerLead ?? 3,
        retryDelayMinutes: data.retryDelayMinutes ?? 120,
        allowedCallingDays: data.allowedCallingDays ?? [1, 2, 3, 4, 5],
        callingWindowStart: data.callingWindowStart ?? '09:00',
        callingWindowEnd: data.callingWindowEnd ?? '17:00',
        recordingConsent: data.recordingConsent ?? false,
        agentConfigId: data.agentConfigId ?? null,
      },
    });
  }

  async findVoiceCampaignByCampaignId(
    campaignId: string,
    workspaceId: string
  ): Promise<(VoiceCampaign & { agentConfig: VoiceAgentConfig | null }) | null> {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, workspaceId },
      include: {
        voiceCampaign: {
          include: { agentConfig: true },
        },
      },
    });
    return campaign?.voiceCampaign ?? null;
  }

  // --- Voice Agent Configs ---
  async createAgentConfig(
    workspaceId: string,
    data: CreateVoiceAgentConfigInput
  ): Promise<VoiceAgentConfig> {
    return this.prisma.voiceAgentConfig.create({
      data: {
        workspaceId,
        name: data.name,
        callObjective: data.callObjective,
        openingScript: data.openingScript,
        qualificationQuestions: data.qualificationQuestions ?? [],
        approvedTalkingPoints: data.approvedTalkingPoints ?? [],
        objectionHandling: data.objectionHandling ? (data.objectionHandling as Prisma.InputJsonValue) : undefined,
        prohibitedClaims: data.prohibitedClaims ?? [],
        escalationConditions: data.escalationConditions ?? [],
        fallbackBehavior: (data as any).fallbackBehavior,
        maxDurationSeconds: data.maxDurationSeconds ?? 300,
      } as any,
    });
  }

  async findAgentConfigById(
    id: string,
    workspaceId: string
  ): Promise<VoiceAgentConfig | null> {
    return this.prisma.voiceAgentConfig.findFirst({
      where: { id, workspaceId },
    });
  }

  async findAgentConfigs(workspaceId: string): Promise<VoiceAgentConfig[]> {
    return this.prisma.voiceAgentConfig.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateAgentConfig(
    id: string,
    workspaceId: string,
    data: Partial<CreateVoiceAgentConfigInput>
  ): Promise<VoiceAgentConfig> {
    const existing = await this.findAgentConfigById(id, workspaceId);
    if (!existing) {
      throw new NotFoundError('Agent config not found or access denied for this workspace');
    }

    return this.prisma.voiceAgentConfig.update({
      where: { id },
      data: {
        name: data.name,
        callObjective: data.callObjective,
        openingScript: data.openingScript,
        qualificationQuestions: data.qualificationQuestions,
        approvedTalkingPoints: data.approvedTalkingPoints,
        objectionHandling: data.objectionHandling ? (data.objectionHandling as Prisma.InputJsonValue) : undefined,
        prohibitedClaims: data.prohibitedClaims,
        escalationConditions: data.escalationConditions,
        fallbackBehavior: (data as any).fallbackBehavior,
        maxDurationSeconds: data.maxDurationSeconds,
      } as any,
    });
  }

  // --- Calls ---
  async createCall(workspaceId: string, data: CreateCallInput): Promise<Call> {
    return this.prisma.call.create({
      data: {
        workspaceId,
        campaignId: (data.campaignId ?? undefined) as any,
        voiceCampaignId: (data.voiceCampaignId ?? undefined) as any,
        leadId: data.leadId,
        contactId: data.contactId,
        agentConfigId: (data.agentConfigId ?? undefined) as any,
        recipientPhone: data.recipientPhone,
        normalizedPhone: data.normalizedPhone,
        idempotencyKey: (data.idempotencyKey ?? undefined) as any,
        humanApprovalRequired: data.humanApprovalRequired ?? true,
        isApproved: data.isApproved ?? false,
        status: data.status ?? 'QUEUED',
      },
    });
  }

  async findCallById(id: string, workspaceId: string): Promise<CallWithRelations | null> {
    const call = await this.prisma.call.findFirst({
      where: { id, workspaceId },
      include: {
        campaign: true,
        voiceCampaign: true,
        lead: true,
        contact: true,
        agentConfig: true,
        attempts: { orderBy: { attemptNumber: 'asc' } },
        events: { orderBy: { occurredAt: 'asc' } },
        transcripts: { orderBy: { turnIndex: 'asc' } },
        outcome: true,
      },
    });
    return (call as CallWithRelations) ?? null;
  }

  async findCallByIdempotencyKey(workspaceId: string, idempotencyKey: string): Promise<Call | null> {
    return this.prisma.call.findUnique({
      where: {
        unique_workspace_call_idempotency: {
          workspaceId,
          idempotencyKey,
        },
      },
    });
  }

  async findManyCallsPaginated(
    workspaceId: string,
    filter: ListCallsFilter = {}
  ): Promise<PaginationResult<CallWithRelations>> {
    const page = Math.max(1, filter.page || 1);
    const limit = Math.min(100, Math.max(1, filter.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.CallWhereInput = {
      workspaceId,
      ...(filter.campaignId ? { campaignId: filter.campaignId } : {}),
      ...(filter.leadId ? { leadId: filter.leadId } : {}),
      ...(filter.contactId ? { contactId: filter.contactId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.search
        ? {
            OR: [
              { recipientPhone: { contains: filter.search, mode: 'insensitive' } },
              { normalizedPhone: { contains: filter.search, mode: 'insensitive' } },
              { lead: { businessName: { contains: filter.search, mode: 'insensitive' } } },
              { contact: { fullName: { contains: filter.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [total, data] = await Promise.all([
      this.prisma.call.count({ where }),
      this.prisma.call.findMany({
        where,
        include: {
          campaign: true,
          voiceCampaign: true,
          lead: true,
          contact: true,
          agentConfig: true,
          attempts: { orderBy: { attemptNumber: 'asc' } },
          events: { orderBy: { occurredAt: 'asc' } },
          transcripts: { orderBy: { turnIndex: 'asc' } },
          outcome: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: data as CallWithRelations[],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async updateCall(id: string, workspaceId: string, data: Partial<Call>): Promise<Call> {
    const existing = await this.findCallById(id, workspaceId);
    if (!existing) {
      throw new NotFoundError('Call not found or access denied for this workspace');
    }

    return this.prisma.call.update({
      where: { id },
      data,
    });
  }

  async updateCallStatus(
    id: string,
    workspaceId: string,
    status: CallStatus,
    extra: Partial<Call> = {}
  ): Promise<Call> {
    const existing = await this.findCallById(id, workspaceId);
    if (!existing) {
      throw new NotFoundError('Call not found or access denied for this workspace');
    }

    return this.prisma.call.update({
      where: { id },
      data: {
        status,
        ...extra,
      },
    });
  }

  async approveCall(id: string, workspaceId: string, userId: string): Promise<Call> {
    const existing = await this.findCallById(id, workspaceId);
    if (!existing) {
      throw new NotFoundError('Call not found or access denied for this workspace');
    }

    return this.prisma.call.update({
      where: { id },
      data: {
        isApproved: true,
        approvedByUserId: userId,
        approvedAt: new Date(),
        status: 'APPROVED',
      },
    });
  }

  async rejectCall(id: string, workspaceId: string, _userId: string): Promise<Call> {
    const existing = await this.findCallById(id, workspaceId);
    if (!existing) {
      throw new NotFoundError('Call not found or access denied for this workspace');
    }

    return this.prisma.call.update({
      where: { id },
      data: {
        isApproved: false,
        status: 'BLOCKED',
        blockedReason: 'Rejected by human reviewer',
      },
    });
  }

  async cancelCall(id: string, workspaceId: string, _userId: string): Promise<Call> {
    const existing = await this.findCallById(id, workspaceId);
    if (!existing) {
      throw new NotFoundError('Call not found or access denied for this workspace');
    }

    return this.prisma.call.update({
      where: { id },
      data: {
        status: 'CANCELLED',
      },
    });
  }

  async invalidateCallApproval(id: string, workspaceId: string, reason = 'Call context was materially updated'): Promise<Call> {
    const existing = await this.findCallById(id, workspaceId);
    if (!existing) {
      throw new NotFoundError('Call not found or access denied for this workspace');
    }

    return this.prisma.call.update({
      where: { id },
      data: {
        isApproved: false,
        approvedByUserId: null,
        approvedAt: null,
        status: 'APPROVAL_REQUIRED',
        blockedReason: reason,
      },
    });
  }

  async countCallsToday(workspaceId: string, campaignId?: string): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    return this.prisma.call.count({
      where: {
        workspaceId,
        ...(campaignId ? { campaignId } : {}),
        status: { in: ['INITIATING', 'RINGING', 'IN_PROGRESS', 'COMPLETED'] },
        createdAt: { gte: startOfDay },
      },
    });
  }

  async countActiveCalls(workspaceId: string): Promise<number> {
    return this.prisma.call.count({
      where: {
        workspaceId,
        status: { in: ['INITIATING', 'RINGING', 'IN_PROGRESS'] },
      },
    });
  }

  async countAttemptsForLead(workspaceId: string, leadId: string, contactId?: string): Promise<number> {
    return this.prisma.callAttempt.count({
      where: {
        call: {
          workspaceId,
          leadId,
          ...(contactId ? { contactId } : {}),
        },
      },
    });
  }

  // --- Call Attempts ---
  async createAttempt(
    callId: string,
    data: {
      attemptNumber: number;
      providerCallId?: string;
      status: CallStatus;
      failureReason?: string;
      isRetryable?: boolean;
    }
  ): Promise<CallAttempt> {
    return this.prisma.callAttempt.create({
      data: {
        callId,
        attemptNumber: data.attemptNumber,
        providerCallId: data.providerCallId,
        status: data.status,
        failureReason: data.failureReason,
        isRetryable: data.isRetryable ?? false,
      },
    });
  }

  async updateAttempt(
    id: string,
    data: Partial<CallAttempt>
  ): Promise<CallAttempt> {
    return this.prisma.callAttempt.update({
      where: { id },
      data,
    });
  }

  // --- Call Events ---
  async createEvent(
    callId: string,
    eventType: CallEventType,
    payload?: Record<string, unknown>
  ): Promise<CallEvent> {
    return this.prisma.callEvent.create({
      data: {
        callId,
        eventType,
        eventPayload: payload ? (payload as Prisma.InputJsonValue) : undefined,
      },
    });
  }

  async findEventsByCallId(callId: string): Promise<CallEvent[]> {
    return this.prisma.callEvent.findMany({
      where: { callId },
      orderBy: { occurredAt: 'asc' },
    });
  }

  // --- Call Transcripts ---
  async createTranscriptTurn(
    callId: string,
    data: {
      turnIndex: number;
      speaker: string;
      text: string;
      confidence?: number;
      timestampMs?: number;
    }
  ): Promise<CallTranscript> {
    return this.prisma.callTranscript.create({
      data: {
        callId,
        turnIndex: data.turnIndex,
        speaker: data.speaker,
        text: data.text,
        confidence: data.confidence,
        timestampMs: data.timestampMs,
      },
    });
  }

  async findTranscriptsByCallId(callId: string): Promise<CallTranscript[]> {
    return this.prisma.callTranscript.findMany({
      where: { callId },
      orderBy: { turnIndex: 'asc' },
    });
  }

  // --- Call Outcomes ---
  async upsertOutcome(
    callId: string,
    data: {
      outcome: CallOutcomeType;
      interestLevel: string;
      objections?: string[];
      requestedFollowUp?: string;
      nextAction?: string;
      sentiment?: string;
      optOutDetected?: boolean;
      summary: string;
      derivedFromActual?: boolean;
    }
  ): Promise<CallOutcome> {
    return this.prisma.callOutcome.upsert({
      where: { callId },
      update: {
        outcome: data.outcome,
        interestLevel: data.interestLevel,
        objections: data.objections ?? [],
        requestedFollowUp: data.requestedFollowUp,
        nextAction: data.nextAction,
        sentiment: data.sentiment,
        optOutDetected: data.optOutDetected ?? false,
        summary: data.summary,
        derivedFromActual: data.derivedFromActual ?? true,
        analyzedAt: new Date(),
      },
      create: {
        callId,
        outcome: data.outcome,
        interestLevel: data.interestLevel,
        objections: data.objections ?? [],
        requestedFollowUp: data.requestedFollowUp,
        nextAction: data.nextAction,
        sentiment: data.sentiment,
        optOutDetected: data.optOutDetected ?? false,
        summary: data.summary,
        derivedFromActual: data.derivedFromActual ?? true,
      },
    });
  }

  async findOutcomeByCallId(callId: string): Promise<CallOutcome | null> {
    return this.prisma.callOutcome.findUnique({
      where: { callId },
    });
  }
}

// ==============================================================================
// 19. N8n Integration Repository (Multi-Tenant Scoped)
// ==============================================================================

export interface CreateN8nIntegrationData {
  workspaceId: string;
  name: string;
  apiKeyHash: string;
  keyPrefix: string;
  scopes: string[];
  webhookUrl?: string;
}

export interface CreateN8nWebhookDeliveryData {
  workspaceId: string;
  integrationId: string;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  statusCode?: number;
  status: string;
  attempts?: number;
  lastError?: string;
  deliveredAt?: Date;
}

export class N8nIntegrationRepository {
  constructor(private db: DatabaseClient = databaseClient) {}

  private get prisma(): PrismaClient {
    return this.db.getPrismaClient();
  }

  async createIntegration(data: CreateN8nIntegrationData): Promise<N8nIntegration> {
    return this.prisma.n8nIntegration.create({
      data: {
        workspaceId: data.workspaceId,
        name: data.name,
        apiKeyHash: data.apiKeyHash,
        keyPrefix: data.keyPrefix,
        scopes: data.scopes,
        webhookUrl: data.webhookUrl,
      },
    });
  }

  async findById(id: string, workspaceId: string): Promise<N8nIntegration | null> {
    return this.prisma.n8nIntegration.findFirst({
      where: { id, workspaceId },
    });
  }

  async findByApiKeyHash(apiKeyHash: string): Promise<N8nIntegration | null> {
    return this.prisma.n8nIntegration.findFirst({
      where: { apiKeyHash, isActive: true, revokedAt: null },
    });
  }

  async findMany(workspaceId: string): Promise<N8nIntegration[]> {
    return this.prisma.n8nIntegration.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateLastUsed(id: string): Promise<void> {
    await this.prisma.n8nIntegration.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }

  async revoke(id: string, workspaceId: string): Promise<boolean> {
    const existing = await this.findById(id, workspaceId);
    if (!existing) {
      return false;
    }

    await this.prisma.n8nIntegration.update({
      where: { id },
      data: {
        isActive: false,
        revokedAt: new Date(),
      },
    });
    return true;
  }

  async createDelivery(data: CreateN8nWebhookDeliveryData): Promise<N8nWebhookDelivery> {
    return this.prisma.n8nWebhookDelivery.create({
      data: {
        workspaceId: data.workspaceId,
        integrationId: data.integrationId,
        eventId: data.eventId,
        eventType: data.eventType,
        payload: data.payload as Prisma.InputJsonValue,
        statusCode: data.statusCode,
        status: data.status,
        attempts: data.attempts ?? 1,
        lastError: data.lastError,
        deliveredAt: data.deliveredAt,
      },
    });
  }

  async updateDelivery(
    id: string,
    data: Prisma.N8nWebhookDeliveryUncheckedUpdateInput
  ): Promise<N8nWebhookDelivery> {
    return this.prisma.n8nWebhookDelivery.update({
      where: { id },
      data,
    });
  }

  async findDeliveries(
    workspaceId: string,
    filter: { limit?: number; status?: string } = {}
  ): Promise<N8nWebhookDelivery[]> {
    return this.prisma.n8nWebhookDelivery.findMany({
      where: {
        workspaceId,
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: filter.limit || 50,
    });
  }
}

export class WorkspaceCallingPolicyRepository {
  constructor(private db: DatabaseClient = databaseClient) {}

  private get prisma(): PrismaClient {
    return this.db.getPrismaClient();
  }

  async findByWorkspaceId(workspaceId: string): Promise<WorkspaceCallingPolicy | null> {
    return (this.prisma as any).workspaceCallingPolicy.findUnique({
      where: { workspaceId },
    });
  }

  async upsert(
    workspaceId: string,
    data: Partial<{
      dailyCallLimit: number;
      maxConcurrentCalls: number;
      maxAttemptsPerLead: number;
      retryDelayMinutes: number;
      allowedCallingDays: number[];
      callingWindowStart: string;
      callingWindowEnd: string;
      recordingConsent: boolean;
      humanApprovalRequired: boolean;
      providerRestrictions: string[];
      isActive: boolean;
    }>
  ): Promise<WorkspaceCallingPolicy> {
    return (this.prisma as any).workspaceCallingPolicy.upsert({
      where: { workspaceId },
      update: {
        ...data,
        updatedAt: new Date(),
      },
      create: {
        workspaceId,
        dailyCallLimit: data.dailyCallLimit ?? 25,
        maxConcurrentCalls: data.maxConcurrentCalls ?? 1,
        maxAttemptsPerLead: data.maxAttemptsPerLead ?? 3,
        retryDelayMinutes: data.retryDelayMinutes ?? 120,
        allowedCallingDays: data.allowedCallingDays ?? [1, 2, 3, 4, 5],
        callingWindowStart: data.callingWindowStart ?? '09:00',
        callingWindowEnd: data.callingWindowEnd ?? '17:00',
        recordingConsent: data.recordingConsent ?? false,
        humanApprovalRequired: data.humanApprovalRequired ?? true,
        providerRestrictions: data.providerRestrictions ?? [],
        isActive: data.isActive ?? true,
      },
    });
  }
}

export const voiceRepository = new VoiceRepository();
export const workspaceCallingPolicyRepository = new WorkspaceCallingPolicyRepository();
export const n8nIntegrationRepository = new N8nIntegrationRepository();


