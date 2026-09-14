import {
  CampaignRepository,
  AuditRepository,
  campaignRepository as defaultCampaignRepo,
  auditRepository as defaultAuditRepo,
  type PaginationResult,
} from '../../database/repository.js';
import { NotFoundError } from '../../core/errors/api-error.js';
import type {
  CreateCampaignInput,
  UpdateCampaignInput,
  CampaignQueryInput,
} from './campaign.schema.js';
import type { Campaign } from '@prisma/client';

export class CampaignService {
  constructor(
    private campaignRepo: CampaignRepository = defaultCampaignRepo,
    private auditRepo: AuditRepository = defaultAuditRepo
  ) {}

  /**
   * Retrieves paginated campaigns scoped strictly to the workspace.
   */
  async listCampaigns(
    workspaceId: string,
    query: CampaignQueryInput
  ): Promise<PaginationResult<Campaign & { _count?: { leads: number } }>> {
    return this.campaignRepo.findManyPaginated(workspaceId, {
      status: query.status,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
  }

  /**
   * Retrieves single campaign by ID scoped to workspace.
   */
  async getCampaign(id: string, workspaceId: string): Promise<Campaign & { _count?: { leads: number } }> {
    const campaign = await this.campaignRepo.findById(id, workspaceId);
    if (!campaign) {
      throw new NotFoundError('Campaign not found or access denied for this workspace');
    }
    return campaign;
  }

  /**
   * Creates a new campaign and records an audit log entry.
   */
  async createCampaign(
    workspaceId: string,
    userId: string | undefined,
    data: CreateCampaignInput
  ): Promise<Campaign> {
    const campaign = await this.campaignRepo.create({
      workspaceId,
      name: data.name,
      niche: data.niche,
      location: data.location,
      targetOffer: data.targetOffer,
      dailyCap: data.dailyCap,
    });

    try {
      await this.auditRepo.create({
        workspaceId,
        userId,
        eventType: 'campaign:created',
        entityType: 'Campaign',
        entityId: campaign.id,
        metadata: {
          name: campaign.name,
          niche: campaign.niche,
          location: campaign.location,
        },
      });
    } catch {
      // Non-blocking audit failure
    }

    return campaign;
  }

  /**
   * Updates an existing campaign scoped to workspace.
   */
  async updateCampaign(
    id: string,
    workspaceId: string,
    userId: string | undefined,
    data: UpdateCampaignInput
  ): Promise<Campaign> {
    const updated = await this.campaignRepo.update(id, workspaceId, data);

    try {
      await this.auditRepo.create({
        workspaceId,
        userId,
        eventType: 'campaign:updated',
        entityType: 'Campaign',
        entityId: id,
        metadata: data as Record<string, unknown>,
      });
    } catch {
      // Non-blocking audit failure
    }

    return updated;
  }

  /**
   * Deletes a campaign scoped to workspace.
   */
  async deleteCampaign(
    id: string,
    workspaceId: string,
    userId: string | undefined
  ): Promise<boolean> {
    const deleted = await this.campaignRepo.delete(id, workspaceId);
    if (!deleted) {
      throw new NotFoundError('Campaign not found or access denied for this workspace');
    }

    try {
      await this.auditRepo.create({
        workspaceId,
        userId,
        eventType: 'campaign:deleted',
        entityType: 'Campaign',
        entityId: id,
      });
    } catch {
      // Non-blocking audit failure
    }

    return true;
  }
}

export const campaignService = new CampaignService();
