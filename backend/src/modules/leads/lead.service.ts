import {
  LeadRepository,
  AuditRepository,
  leadRepository as defaultLeadRepo,
  auditRepository as defaultAuditRepo,
  type PaginationResult,
} from '../../database/repository.js';
import { ConflictError, NotFoundError } from '../../core/errors/api-error.js';
import type {
  CreateLeadInput,
  UpdateLeadInput,
  CreateContactInput,
  UpdateContactInput,
  LeadQueryInput,
} from './lead.schema.js';
import type { Lead, Contact } from '@prisma/client';

export class LeadService {
  constructor(
    private leadRepo: LeadRepository = defaultLeadRepo,
    private auditRepo: AuditRepository = defaultAuditRepo
  ) {}

  /**
   * Retrieves paginated leads scoped strictly to the workspace.
   */
  async listLeads(
    workspaceId: string,
    query: LeadQueryInput
  ): Promise<PaginationResult<Lead & { contacts: Contact[] }>> {
    return this.leadRepo.findManyPaginated(workspaceId, {
      campaignId: query.campaignId,
      status: query.status,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
  }

  /**
   * Retrieves single lead by ID scoped to workspace.
   */
  async getLead(id: string, workspaceId: string): Promise<Lead & { contacts: Contact[] }> {
    const lead = await this.leadRepo.findById(id, workspaceId);
    if (!lead) {
      throw new NotFoundError('Lead not found or access denied for this workspace');
    }
    return lead;
  }

  /**
   * Creates a new lead with deduplication check and audit logging.
   */
  async createLead(
    workspaceId: string,
    userId: string | undefined,
    data: CreateLeadInput
  ): Promise<Lead & { contacts: Contact[] }> {
    // 1. Deduplication check via 4-factor match key
    const duplicate = await this.leadRepo.findByMatchKey(
      workspaceId,
      data.businessName,
      data.domain,
      data.phone,
      data.address
    );

    if (duplicate) {
      throw new ConflictError(
        'A lead with matching business name and contact details already exists in this workspace'
      );
    }

    // 2. Persist lead
    const lead = await this.leadRepo.create({
      workspaceId,
      campaignId: data.campaignId,
      businessName: data.businessName,
      domain: data.domain,
      phone: data.phone,
      address: data.address,
      status: data.status,
      contacts: data.contacts,
    });

    // 3. Audit trail
    try {
      await this.auditRepo.create({
        workspaceId,
        userId,
        eventType: 'lead:created',
        entityType: 'Lead',
        entityId: lead.id,
        metadata: {
          businessName: lead.businessName,
          campaignId: lead.campaignId,
          contactsCount: lead.contacts.length,
        },
      });
    } catch {
      // Non-blocking audit failure
    }

    // 4. Outbound n8n webhook notification
    try {
      const { n8nService } = await import('../integrations/n8n/n8n.service.js');
      n8nService.dispatchOutboundWebhook(workspaceId, 'lead.created', {
        leadId: lead.id,
        businessName: lead.businessName,
        status: lead.status,
      }).catch(() => {});
    } catch {
      // Non-blocking
    }

    return lead;
  }

  /**
   * Updates an existing lead scoped to workspace.
   */
  async updateLead(
    id: string,
    workspaceId: string,
    userId: string | undefined,
    data: UpdateLeadInput
  ): Promise<Lead> {
    const updated = await this.leadRepo.update(id, workspaceId, data);

    try {
      await this.auditRepo.create({
        workspaceId,
        userId,
        eventType: 'lead:updated',
        entityType: 'Lead',
        entityId: id,
        metadata: data as Record<string, unknown>,
      });
    } catch {
      // Non-blocking audit failure
    }

    return updated;
  }

  /**
   * Deletes a lead scoped to workspace.
   */
  async deleteLead(id: string, workspaceId: string, userId: string | undefined): Promise<boolean> {
    const deleted = await this.leadRepo.delete(id, workspaceId);
    if (!deleted) {
      throw new NotFoundError('Lead not found or access denied for this workspace');
    }

    try {
      await this.auditRepo.create({
        workspaceId,
        userId,
        eventType: 'lead:deleted',
        entityType: 'Lead',
        entityId: id,
      });
    } catch {
      // Non-blocking audit failure
    }

    return true;
  }

  // --- Contact Domain Operations ---

  async listContacts(leadId: string, workspaceId: string): Promise<Contact[]> {
    return this.leadRepo.findContacts(leadId, workspaceId);
  }

  async createContact(
    leadId: string,
    workspaceId: string,
    userId: string | undefined,
    data: CreateContactInput
  ): Promise<Contact> {
    const contact = await this.leadRepo.createContact(leadId, workspaceId, data);

    try {
      await this.auditRepo.create({
        workspaceId,
        userId,
        eventType: 'contact:created',
        entityType: 'Contact',
        entityId: contact.id,
        metadata: { leadId, email: contact.email },
      });
    } catch {
      // Non-blocking audit failure
    }

    return contact;
  }

  async updateContact(
    contactId: string,
    leadId: string,
    workspaceId: string,
    userId: string | undefined,
    data: UpdateContactInput
  ): Promise<Contact> {
    const updated = await this.leadRepo.updateContact(contactId, leadId, workspaceId, data);

    try {
      await this.auditRepo.create({
        workspaceId,
        userId,
        eventType: 'contact:updated',
        entityType: 'Contact',
        entityId: contactId,
        metadata: { leadId, ...data },
      });
    } catch {
      // Non-blocking audit failure
    }

    return updated;
  }

  async deleteContact(
    contactId: string,
    leadId: string,
    workspaceId: string,
    userId: string | undefined
  ): Promise<boolean> {
    const deleted = await this.leadRepo.deleteContact(contactId, leadId, workspaceId);
    if (!deleted) {
      throw new NotFoundError('Contact not found or access denied');
    }

    try {
      await this.auditRepo.create({
        workspaceId,
        userId,
        eventType: 'contact:deleted',
        entityType: 'Contact',
        entityId: contactId,
        metadata: { leadId },
      });
    } catch {
      // Non-blocking audit failure
    }

    return true;
  }
}

export const leadService = new LeadService();
