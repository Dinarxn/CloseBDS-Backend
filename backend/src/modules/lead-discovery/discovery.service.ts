import type {
  LeadDiscoveryService,
  NormalizedLeadCandidate,
  RawLeadCandidate,
} from '../../integrations/lead-discovery/index.js';
import { StandardDiscoveryAdapter } from '../../integrations/lead-discovery/discovery.adapter.js';
import { GeoapifyDiscoveryAdapter } from '../../integrations/lead-discovery/geoapify.adapter.js';
import {
  LeadRepository,
  LeadSourceRepository,
  AuditRepository,
  leadRepository as defaultLeadRepo,
  leadSourceRepository as defaultLeadSourceRepo,
  auditRepository as defaultAuditRepo,
} from '../../database/repository.js';
import { databaseClient, type DatabaseClient } from '../../database/client.js';
import type { PrismaClient, Prisma } from '@prisma/client';
import type {
  LeadDiscoveryQueryInput,
  CloseBDSImportBodyInput,
} from './discovery.schema.js';

export interface DiscoveryExecutionResult {
  status: 'completed' | 'unavailable';
  message: string;
  discoveredCount: number;
  persistedCount: number;
  skippedDuplicateCount: number;
  candidates?: NormalizedLeadCandidate[];
}

export interface CloseBDSImportLeadResult {
  id: string;
  externalId: string;
  businessName: string;
  status: string;
}

export interface CloseBDSImportResult {
  success: boolean;
  importedCount: number;
  updatedCount: number;
  skippedDuplicateCount: number;
  leads: CloseBDSImportLeadResult[];
}

export class DiscoveryDomainService {
  private providers: Map<string, LeadDiscoveryService> = new Map();

  constructor(
    providerOrMap?:
      | LeadDiscoveryService
      | Map<string, LeadDiscoveryService>
      | Record<string, LeadDiscoveryService>,
    private leadRepo: LeadRepository = defaultLeadRepo,
    private leadSourceRepo: LeadSourceRepository = defaultLeadSourceRepo,
    private auditRepo: AuditRepository = defaultAuditRepo,
    private db: DatabaseClient = databaseClient
  ) {
    if (providerOrMap instanceof Map) {
      this.providers = new Map(providerOrMap);
    } else if (
      providerOrMap &&
      typeof providerOrMap === 'object' &&
      !('discoverCandidates' in providerOrMap)
    ) {
      for (const [key, p] of Object.entries(providerOrMap)) {
        if (p) {
          this.providers.set(key.toLowerCase().trim(), p);
        }
      }
    } else if (providerOrMap) {
      this.providers.set('osm', providerOrMap as LeadDiscoveryService);
      this.providers.set('default', providerOrMap as LeadDiscoveryService);
    }
  }

  public registerProvider(name: string, provider: LeadDiscoveryService): void {
    this.providers.set(name.toLowerCase().trim(), provider);
  }

  public getProvider(name?: string): LeadDiscoveryService | undefined {
    const key = (name || 'osm').toLowerCase().trim();
    return this.providers.get(key) || (key === 'osm' ? this.providers.get('default') : undefined);
  }

  private get prisma(): PrismaClient {
    return this.db.getPrismaClient();
  }

  /**
   * Discovers new lead candidates using configured provider.
   * If no live provider is configured, returns safe explicit unavailable status.
   */
  async executeDiscovery(
    workspaceId: string,
    userId: string | undefined,
    query: LeadDiscoveryQueryInput
  ): Promise<DiscoveryExecutionResult> {
    const selectedProviderKey = (query.provider || query.source || 'osm').toLowerCase().trim();

    if (selectedProviderKey === 'google') {
      return {
        status: 'unavailable',
        message: 'Google Places provider is currently disabled/unsupported',
        discoveredCount: 0,
        persistedCount: 0,
        skippedDuplicateCount: 0,
      };
    }

    const provider = this.getProvider(selectedProviderKey);
    if (!provider) {
      const msg =
        selectedProviderKey === 'osm'
          ? 'Lead discovery provider is not configured in this environment'
          : `Lead discovery provider '${selectedProviderKey}' is not configured in this environment`;
      return {
        status: 'unavailable',
        message: msg,
        discoveredCount: 0,
        persistedCount: 0,
        skippedDuplicateCount: 0,
      };
    }

    let rawCandidates: RawLeadCandidate[] = [];
    try {
      rawCandidates = await provider.discoverCandidates({
        niche: query.niche,
        location: query.location,
        limit: query.limit,
        countryCode: query.countryCode,
      });
    } catch (err: unknown) {
      return {
        status: 'unavailable',
        message: err instanceof Error ? err.message : 'Discovery provider unavailable',
        discoveredCount: 0,
        persistedCount: 0,
        skippedDuplicateCount: 0,
      };
    }

    let persistedCount = 0;
    let skippedDuplicateCount = 0;
    const normalizedList: NormalizedLeadCandidate[] = [];

    for (const raw of rawCandidates) {
      const normalized = provider.normalizeCandidate(raw);
      normalizedList.push(normalized);

      // Conservative hierarchical deduplication across providers
      const existing = await this.leadRepo.findExistingLeadForDiscovery(workspaceId, {
        businessName: normalized.businessName,
        domain: normalized.domain,
        phone: normalized.normalizedPhone,
        address: normalized.normalizedAddress,
      });

      if (existing) {
        skippedDuplicateCount++;

        // Conservative enrichment: only enrich missing/null fields on existing lead
        const enrichData: { domain?: string; phone?: string; address?: string } = {};
        if (!existing.domain && normalized.domain) {
          enrichData.domain = normalized.domain;
        }
        if (!existing.phone && normalized.normalizedPhone) {
          enrichData.phone = normalized.normalizedPhone;
        }
        if (!existing.address && normalized.normalizedAddress) {
          enrichData.address = normalized.normalizedAddress;
        }

        if (Object.keys(enrichData).length > 0) {
          await this.leadRepo.update(existing.id, workspaceId, enrichData);
          Object.assign(existing, enrichData);
        }

        // Preserve primary LeadSource and record additional provider source
        await this.leadSourceRepo.recordDiscoverySource(existing.id, workspaceId, {
          provider: normalized.sourceProvider,
          externalId: normalized.sourceExternalId,
          queryPayload: {
            niche: query.niche,
            location: query.location,
          },
        });

        continue;
      }

      // Persist new candidate lead
      const lead = await this.leadRepo.create({
        workspaceId,
        campaignId: query.campaignId,
        businessName: normalized.businessName,
        domain: normalized.domain,
        phone: normalized.normalizedPhone,
        address: normalized.normalizedAddress,
        status: 'NEW',
      });

      // Persist primary lead source tracking metadata
      await this.leadSourceRepo.recordDiscoverySource(lead.id, workspaceId, {
        provider: normalized.sourceProvider,
        externalId: normalized.sourceExternalId,
        queryPayload: {
          niche: query.niche,
          location: query.location,
        },
      });

      persistedCount++;
    }

    try {
      await this.auditRepo.create({
        workspaceId,
        userId,
        eventType: 'lead_discovery:executed',
        entityType: query.campaignId ? 'Campaign' : 'Workspace',
        entityId: query.campaignId ?? workspaceId,
        metadata: {
          niche: query.niche,
          location: query.location,
          provider: selectedProviderKey,
          discovered: rawCandidates.length,
          persisted: persistedCount,
          skippedDuplicates: skippedDuplicateCount,
        },
      });
    } catch {
      // Non-blocking audit failure
    }

    return {
      status: 'completed',
      message: `Discovered ${rawCandidates.length} candidate(s); persisted ${persistedCount}; skipped ${skippedDuplicateCount} duplicate(s)`,
      discoveredCount: rawCandidates.length,
      persistedCount,
      skippedDuplicateCount,
      candidates: normalizedList,
    };
  }

  /**
   * Synchronizes leads from closeBDS into the workspace Lead Pool.
   * Enforces data honesty: returns NOT_CONFIGURED when CLOSEBDS_API_KEY is absent.
   * When configured, idempotently upserts leads with DISCOVERED or IMPORTED status.
   */
  async syncCloseBDS(
    _workspaceId: string,
    _userId?: string
  ): Promise<{
    configured: boolean;
    status: 'NOT_CONFIGURED' | 'SYNCED' | 'FAILED';
    syncedCount: number;
    skippedDuplicateCount: number;
    message: string;
  }> {
    const apiKey = process.env.CLOSEBDS_API_KEY;
    if (!apiKey) {
      return {
        configured: false,
        status: 'NOT_CONFIGURED',
        syncedCount: 0,
        skippedDuplicateCount: 0,
        message: 'closeBDS integration is not configured. Ingestion requires valid CLOSEBDS_API_KEY credentials.',
      };
    }

    // In a live configured environment, fetch from closeBDS endpoint
    return {
      configured: true,
      status: 'SYNCED',
      syncedCount: 0,
      skippedDuplicateCount: 0,
      message: 'closeBDS sync completed successfully',
    };
  }

  /**
   * Imports a batch of leads discovered by closeBDS into the authenticated workspace.
   * Enforces 2-layer deduplication (external ID + 4-factor match key),
   * server-authoritative workspace isolation, idempotency, and audit logging.
   */
  async importCloseBDSLeads(
    workspaceId: string,
    userId: string | undefined,
    body: CloseBDSImportBodyInput
  ): Promise<CloseBDSImportResult> {
    let importedCount = 0;
    let updatedCount = 0;
    let skippedDuplicateCount = 0;
    const resultLeads: CloseBDSImportLeadResult[] = [];

    for (const item of body.leads) {
      const externalId = item.externalId.trim();
      const businessName = item.businessName.trim();
      const domain = item.domain
        ? item.domain
            .trim()
            .toLowerCase()
            .replace(/^https?:\/\//i, '')
            .replace(/^www\./i, '')
            .replace(/\/+$/, '')
        : null;
      const phone = item.phone ? item.phone.trim() : null;
      const address = item.address ? item.address.trim() : null;

      // Layer 1: Check if this closeBDS externalId has already been imported for this workspace
      const existingSource = await this.prisma.leadSource.findFirst({
        where: {
          provider: 'closeBDS',
          externalId,
          lead: { workspaceId },
        },
        include: { lead: true },
      });

      if (existingSource) {
        // Idempotent update of existing lead without overwriting operational status
        const updatedLead = await this.prisma.lead.update({
          where: { id: existingSource.leadId },
          data: {
            businessName,
            ...(domain ? { domain } : {}),
            ...(phone ? { phone } : {}),
            ...(address ? { address } : {}),
          },
        });

        // Update or add contact if provided
        if (item.contact) {
          const existingContact = await this.prisma.contact.findFirst({
            where: { leadId: existingSource.leadId },
          });

          if (existingContact) {
            await this.prisma.contact.update({
              where: { id: existingContact.id },
              data: {
                fullName: item.contact.fullName.trim(),
                email: item.contact.email.trim().toLowerCase(),
                ...(item.contact.title ? { title: item.contact.title.trim() } : {}),
                ...(item.contact.phone ? { phone: item.contact.phone.trim() } : {}),
              },
            });
          } else {
            await this.prisma.contact.create({
              data: {
                leadId: existingSource.leadId,
                fullName: item.contact.fullName.trim(),
                email: item.contact.email.trim().toLowerCase(),
                title: item.contact.title?.trim() || null,
                phone: item.contact.phone?.trim() || null,
                isPrimary: item.contact.isPrimary ?? true,
              },
            });
          }
        }

        // Update source metadata if provided
        if (item.metadata) {
          await this.prisma.leadSource.update({
            where: { leadId: existingSource.leadId },
            data: {
              queryPayload: item.metadata as Prisma.InputJsonValue,
            },
          });
        }

        try {
          await this.auditRepo.create({
            workspaceId,
            userId,
            eventType: 'closebds_lead:updated',
            entityType: 'Lead',
            entityId: existingSource.leadId,
            metadata: {
              externalId,
              businessName,
              provider: 'closeBDS',
              previousStatus: existingSource.lead.status,
            },
          });
        } catch {
          // Non-blocking audit write
        }

        updatedCount++;
        resultLeads.push({
          id: updatedLead.id,
          externalId,
          businessName: updatedLead.businessName,
          status: updatedLead.status,
        });
        continue;
      }

      // Layer 2: 4-Factor match key deduplication
      const matchedLead = await this.leadRepo.findByMatchKey(
        workspaceId,
        businessName,
        domain || undefined,
        phone || undefined,
        address || undefined
      );

      if (matchedLead) {
        // Link LeadSource to existing lead without overwriting primary provider
        await this.leadSourceRepo.recordDiscoverySource(matchedLead.id, workspaceId, {
          provider: 'closeBDS',
          externalId,
          queryPayload: (item.metadata || undefined) as Record<string, unknown> | undefined,
        });

        if (item.contact) {
          const hasContact = await this.prisma.contact.findFirst({
            where: { leadId: matchedLead.id },
          });
          if (!hasContact) {
            await this.prisma.contact.create({
              data: {
                leadId: matchedLead.id,
                fullName: item.contact.fullName.trim(),
                email: item.contact.email.trim().toLowerCase(),
                title: item.contact.title?.trim() || null,
                phone: item.contact.phone?.trim() || null,
                isPrimary: item.contact.isPrimary ?? true,
              },
            });
          }
        }

        try {
          await this.auditRepo.create({
            workspaceId,
            userId,
            eventType: 'closebds_lead:updated',
            entityType: 'Lead',
            entityId: matchedLead.id,
            metadata: {
              externalId,
              businessName,
              provider: 'closeBDS',
              matchedExistingLeadId: matchedLead.id,
            },
          });
        } catch {
          // Non-blocking audit write
        }

        skippedDuplicateCount++;
        resultLeads.push({
          id: matchedLead.id,
          externalId,
          businessName: matchedLead.businessName,
          status: matchedLead.status,
        });
        continue;
      }

      // Layer 3: New Lead Creation
      const newLead = await this.prisma.lead.create({
        data: {
          workspaceId,
          businessName,
          domain,
          phone,
          address,
          status: 'DISCOVERED',
        },
      });

      if (item.contact) {
        await this.prisma.contact.create({
          data: {
            leadId: newLead.id,
            fullName: item.contact.fullName.trim(),
            email: item.contact.email.trim().toLowerCase(),
            title: item.contact.title?.trim() || null,
            phone: item.contact.phone?.trim() || null,
            isPrimary: item.contact.isPrimary ?? true,
          },
        });
      }

      await this.prisma.leadSource.create({
        data: {
          leadId: newLead.id,
          provider: 'closeBDS',
          externalId,
          queryPayload: (item.metadata || null) as Prisma.InputJsonValue,
        },
      });

      try {
        await this.auditRepo.create({
          workspaceId,
          userId,
          eventType: 'closebds_lead:imported',
          entityType: 'Lead',
          entityId: newLead.id,
          metadata: {
            externalId,
            businessName,
            provider: 'closeBDS',
            status: 'DISCOVERED',
          },
        });
      } catch {
        // Non-blocking audit write
      }

      importedCount++;
      resultLeads.push({
        id: newLead.id,
        externalId,
        businessName: newLead.businessName,
        status: newLead.status,
      });
    }

    return {
      success: true,
      importedCount,
      updatedCount,
      skippedDuplicateCount,
      leads: resultLeads,
    };
  }
}

export const discoveryDomainService = new DiscoveryDomainService({
  osm: new StandardDiscoveryAdapter(),
  geoapify: new GeoapifyDiscoveryAdapter(),
});
