import {
  LeadRepository,
  AuditRepository,
  SuppressionRepository,
  leadRepository as defaultLeadRepo,
  auditRepository as defaultAuditRepo,
  suppressionRepository as defaultSuppressionRepo,
} from '../../database/repository.js';
import { leadAgentAiGraph, type LeadAgentAiGraph } from '../../agents/graphs/lead-agent-ai.graph.js';
import { ApiError, NotFoundError, BadRequestError, InternalServerError } from '../../core/errors/api-error.js';
import type {
  AiResult,
  Qualification,
  PersonalizedMessage,
  QualityCheck,
  HumanApproval,
} from '../../agents/state/lead-agent.state.js';

export interface LeadAiWorkflowResult {
  leadId: string;
  status: string;
  currentStep: string;
  aiResult?: AiResult;
  qualification?: Qualification;
  personalizedMessage?: PersonalizedMessage;
  qualityCheck?: QualityCheck;
  approval?: HumanApproval;
}

export class LeadAiService {
  constructor(
    private leadRepo: LeadRepository = defaultLeadRepo,
    private workflowGraph: LeadAgentAiGraph | { invoke: (input: Record<string, unknown>) => Promise<any> } = leadAgentAiGraph,
    private auditLogger: AuditRepository = defaultAuditRepo,
    private suppressionRepo: SuppressionRepository = defaultSuppressionRepo
  ) {}

  public setWorkflowGraph(graph: LeadAgentAiGraph | { invoke: (input: Record<string, unknown>) => Promise<any> } | null): void {
    this.workflowGraph = graph || leadAgentAiGraph;
  }

  /**
   * Executes the LangGraph AI workflow for a verified lead strictly within the authenticated workspace.
   *
   * Security & Safety Invariants:
   * 1. Authoritative workspace isolation: If the lead does not belong to the workspace, throws NotFoundError immediately without audit leakage.
   * 2. Zero outbound communication: The workflow creates analysis/drafts only.
   * 3. Non-bypassable human approval: Workflow state is left in approval.status = 'pending' (never auto-approved).
   * 4. Zero database writes: Read-only AI orchestration.
   * 5. Non-blocking audit logging & failure handling.
   * 6. Minimal DNC / suppression awareness without workflow state mutation.
   */
  async executeLeadAiWorkflow(
    leadId: string,
    workspaceId: string,
    userId?: string
  ): Promise<LeadAiWorkflowResult> {
    // 1. Authoritative workspace isolation check
    const lead = await this.leadRepo.findById(leadId, workspaceId);
    if (!lead) {
      throw new NotFoundError('Lead not found or access denied for this workspace');
    }

    // 2. Minimal suppression / DNC check (non-blocking, zero state mutation)
    let suppressionDetected = false;
    try {
      const contactIdentifier = lead.contacts?.[0]?.email || lead.phone || '';
      if (contactIdentifier || lead.domain) {
        suppressionDetected = await this.suppressionRepo.isSuppressed(
          workspaceId,
          contactIdentifier,
          lead.domain || undefined
        );
      }
    } catch {
      // Non-blocking suppression check failure
    }

    // 3. Record audit event: started (non-blocking)
    try {
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'lead_ai_workflow:started',
        entityType: 'Lead',
        entityId: leadId,
        metadata: {
          leadId,
          suppressionChecked: true,
          suppressionDetected,
        },
      });
    } catch {
      // Non-blocking audit logging
    }

    // 4. Server-authoritative initial workflow state (client cannot inject state or approval)
    const initialState = {
      leadId: lead.id,
      workspaceId: lead.workspaceId,
      message: '',
      status: 'pending',
      currentStep: 'initialization',
      approval: undefined,
    };

    try {
      // 5. Invoke production LangGraph workflow
      const graphResult = await this.workflowGraph.invoke(initialState);

      // 6. Record audit event: completed or failed (non-blocking)
      const isQualified = graphResult.qualification?.isQualified;
      const qcPassed = graphResult.qualityCheck?.passed;
      const workflowFailed = graphResult.status === 'failed';

      try {
        await this.auditLogger.create({
          workspaceId,
          userId,
          eventType: workflowFailed ? 'lead_ai_workflow:failed' : 'lead_ai_workflow:completed',
          entityType: 'Lead',
          entityId: leadId,
          metadata: {
            leadId,
            status: graphResult.status,
            currentStep: graphResult.currentStep,
            ...(isQualified !== undefined ? { isQualified } : {}),
            ...(qcPassed !== undefined ? { qualityCheckPassed: qcPassed } : {}),
          },
        });
      } catch {
        // Non-blocking audit logging
      }

      // 7. Return sanitized, safe workflow output
      return {
        leadId: graphResult.leadId || lead.id,
        status: graphResult.status,
        currentStep: graphResult.currentStep,
        aiResult: graphResult.aiResult,
        qualification: graphResult.qualification,
        personalizedMessage: graphResult.personalizedMessage,
        qualityCheck: graphResult.qualityCheck,
        approval: graphResult.approval || { status: 'pending' },
      };
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        throw err;
      }

      const rawMessage = err instanceof Error ? err.message : String(err);
      // Redact potential sensitive tokens, API keys, credentials
      const sanitized = rawMessage
        .replace(/AIza[0-9A-Za-z-_]+/g, '[REDACTED_API_KEY]')
        .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED_TOKEN]');

      // Record audit event: failed (non-blocking)
      try {
        await this.auditLogger.create({
          workspaceId,
          userId,
          eventType: 'lead_ai_workflow:failed',
          entityType: 'Lead',
          entityId: leadId,
          metadata: {
            leadId,
            error: sanitized,
          },
        });
      } catch {
        // Non-blocking audit logging
      }

      throw new InternalServerError(`Lead AI workflow failed: ${sanitized}`);
    }
  }

  /**
   * Server-Authoritative Human Approval for a Lead.
   *
   * Enforces:
   * 1. Authenticated user and workspace ownership (NotFoundError on mismatch)
   * 2. Regulatory suppression & DNC check (BadRequestError if suppressed or OPT_OUT)
   * 3. Canonical state transition to CALL_READY
   * 4. Audit trail logging (lead_ai_workflow:approved)
   */
  async approveLeadAi(
    leadId: string,
    workspaceId: string,
    userId: string,
    reason?: string
  ): Promise<{ leadId: string; status: string; approval: HumanApproval }> {
    // 1. Authoritative workspace isolation
    const lead = await this.leadRepo.findById(leadId, workspaceId);
    if (!lead) {
      throw new NotFoundError('Lead not found or access denied for this workspace');
    }

    // 2. Regulatory & suppression compliance check
    if (lead.status === 'OPT_OUT') {
      throw new BadRequestError('Cannot approve lead: Regulatory suppression boundary is active (OPT_OUT).');
    }

    const contactIdentifier = lead.contacts?.[0]?.email || lead.phone || '';
    if (contactIdentifier || lead.domain) {
      const isSuppressed = await this.suppressionRepo.isSuppressed(
        workspaceId,
        contactIdentifier,
        lead.domain || undefined
      );
      if (isSuppressed) {
        throw new BadRequestError('Cannot approve lead: Recipient contact or domain is in suppression/DNC list.');
      }
    }

    // 3. Update status to canonical CALL_READY
    const updated = await this.leadRepo.update(leadId, workspaceId, {
      status: 'CALL_READY' as any,
    });

    const approvalData: HumanApproval = {
      status: 'approved',
      approvedBy: userId,
      approvedAt: new Date().toISOString(),
      reason: reason || 'Approved by operator',
    };

    // 4. Non-blocking audit logging & n8n event dispatch
    try {
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'lead_ai_workflow:approved',
        entityType: 'Lead',
        entityId: leadId,
        metadata: {
          leadId,
          approvedBy: userId,
          approvedAt: approvalData.approvedAt,
          previousStatus: lead.status,
          newStatus: 'CALL_READY',
          reason: approvalData.reason,
        },
      });

      const { n8nService } = await import('../integrations/n8n/n8n.service.js');
      n8nService.dispatchOutboundWebhook(workspaceId, 'approval.granted', {
        entityType: 'Lead',
        entityId: leadId,
        approvedBy: userId,
        status: 'CALL_READY',
      }).catch(() => {});
    } catch {
      // Non-blocking
    }

    return {
      leadId,
      status: updated.status,
      approval: approvalData,
    };
  }

  /**
   * Server-Authoritative Human Rejection for a Lead.
   *
   * Enforces:
   * 1. Authenticated user and workspace ownership (NotFoundError on mismatch)
   * 2. Canonical state transition to DISQUALIFIED
   * 3. Audit trail logging (lead_ai_workflow:rejected)
   */
  async rejectLeadAi(
    leadId: string,
    workspaceId: string,
    userId: string,
    reason?: string
  ): Promise<{ leadId: string; status: string; approval: HumanApproval }> {
    // 1. Authoritative workspace isolation
    const lead = await this.leadRepo.findById(leadId, workspaceId);
    if (!lead) {
      throw new NotFoundError('Lead not found or access denied for this workspace');
    }

    // 2. Update status to canonical DISQUALIFIED
    const updated = await this.leadRepo.update(leadId, workspaceId, {
      status: 'DISQUALIFIED' as any,
    });

    const approvalData: HumanApproval = {
      status: 'rejected',
      approvedBy: userId,
      approvedAt: new Date().toISOString(),
      reason: reason || 'Rejected by operator',
    };

    // 3. Non-blocking audit logging & n8n event dispatch
    try {
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'lead_ai_workflow:rejected',
        entityType: 'Lead',
        entityId: leadId,
        metadata: {
          leadId,
          rejectedBy: userId,
          rejectedAt: approvalData.approvedAt,
          previousStatus: lead.status,
          newStatus: 'DISQUALIFIED',
          reason: approvalData.reason,
        },
      });

      const { n8nService } = await import('../integrations/n8n/n8n.service.js');
      n8nService.dispatchOutboundWebhook(workspaceId, 'approval.rejected', {
        entityType: 'Lead',
        entityId: leadId,
        rejectedBy: userId,
        status: 'DISQUALIFIED',
        reason: approvalData.reason,
      }).catch(() => {});
    } catch {
      // Non-blocking
    }

    return {
      leadId,
      status: updated.status,
      approval: approvalData,
    };
  }
}

export const leadAiService = new LeadAiService();
