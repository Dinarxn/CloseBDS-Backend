import {
  LeadRepository,
  CRMActivityRepository,
  AuditRepository,
  AppointmentRepository,
  leadRepository as defaultLeadRepo,
  crmActivityRepository as defaultCRMRepo,
  auditRepository as defaultAuditRepo,
  appointmentRepository as defaultAppointmentRepo,
  type CreateAppointmentInput,
  type UpdateAppointmentInput,
  type AppointmentQueryFilter,
  type PaginationResult,
} from '../../database/repository.js';
import { databaseClient, type DatabaseClient } from '../../database/client.js';
import { NotFoundError, BadRequestError } from '../../core/errors/api-error.js';
import type { RecordCRMActivityBody, UpdateLeadStageBody } from './crm.schema.js';
import type { LeadCRMProfile, CRMActivity } from './crm.types.js';
import type { Lead, Appointment, AppointmentStatus } from '@prisma/client';
import type { CanonicalLeadStatus } from '../voice/voice.types.js';

/**
 * Authoritative Lead Stage Transition Matrix.
 * Enforces business lifecycle constraints:
 * - OPT_OUT is a terminal regulatory compliance state; cold stage mutations are blocked.
 * - Same-state transitions are deduplicated.
 */
export const ALLOWED_STAGE_TRANSITIONS: Record<CanonicalLeadStatus, CanonicalLeadStatus[]> = {
  // Discovery & Ingestion
  DISCOVERED: ['IMPORTED', 'RESEARCH_PENDING', 'DISQUALIFIED', 'OPT_OUT'],
  IMPORTED: ['RESEARCH_PENDING', 'RESEARCHED', 'DISQUALIFIED', 'OPT_OUT'],
  NEW: ['DISCOVERED', 'IMPORTED', 'RESEARCH_PENDING', 'QUALIFIED', 'DISQUALIFIED', 'CONTACTED', 'OPT_OUT'],

  // Research
  RESEARCH_PENDING: ['RESEARCHED', 'QUALIFICATION_PENDING', 'DISQUALIFIED', 'OPT_OUT'],
  RESEARCHED: ['QUALIFICATION_PENDING', 'QUALIFIED', 'DISQUALIFIED', 'OPT_OUT'],

  // Qualification
  QUALIFICATION_PENDING: ['QUALIFIED', 'DISQUALIFIED', 'CALL_READY', 'OPT_OUT'],
  QUALIFIED: ['CALL_READY', 'CONTACTED', 'DISQUALIFIED', 'OPT_OUT'],
  DISQUALIFIED: ['QUALIFIED', 'RESEARCH_PENDING', 'OPT_OUT'],

  // Calling & Outreach
  CALL_READY: ['CONTACTED', 'QUALIFIED', 'DISQUALIFIED', 'OPT_OUT'],
  CONTACTED: ['INTERESTED', 'REPLIED', 'MEETING', 'LOST', 'QUALIFIED', 'DISQUALIFIED', 'OPT_OUT'],
  REPLIED: ['INTERESTED', 'MEETING', 'LOST', 'QUALIFIED', 'DISQUALIFIED', 'OPT_OUT', 'CONTACTED'],

  // Conversion
  INTERESTED: ['MEETING', 'WON', 'LOST', 'DISQUALIFIED', 'OPT_OUT'],
  MEETING: ['WON', 'LOST', 'INTERESTED', 'DISQUALIFIED', 'OPT_OUT'],
  WON: ['LOST', 'OPT_OUT'],
  LOST: ['INTERESTED', 'QUALIFIED', 'DISQUALIFIED', 'OPT_OUT'],

  // Regulatory suppression boundary
  OPT_OUT: [],
};

export class CRMService {
  private leadRepo: LeadRepository;
  private crmRepo: CRMActivityRepository;
  private auditLogger: AuditRepository;
  private appointmentRepo: AppointmentRepository;
  private db: DatabaseClient;

  constructor(
    leadRepo: LeadRepository = defaultLeadRepo,
    crmRepo: CRMActivityRepository = defaultCRMRepo,
    auditLogger: AuditRepository = defaultAuditRepo,
    appointmentRepoOrDb?: AppointmentRepository | DatabaseClient,
    dbClient?: DatabaseClient
  ) {
    this.leadRepo = leadRepo;
    this.crmRepo = crmRepo;
    this.auditLogger = auditLogger;
    if (appointmentRepoOrDb && 'getPrismaClient' in appointmentRepoOrDb) {
      this.db = appointmentRepoOrDb;
      this.appointmentRepo = new AppointmentRepository(appointmentRepoOrDb);
    } else {
      this.appointmentRepo = (appointmentRepoOrDb as AppointmentRepository) || defaultAppointmentRepo;
      this.db = dbClient || databaseClient;
    }
  }

  /**
   * Retrieves complete CRM profile for a lead including timeline activities.
   */
  async getLeadCRMProfile(leadId: string, workspaceId: string): Promise<LeadCRMProfile & { appointments: Appointment[] }> {
    const lead = await this.leadRepo.findById(leadId, workspaceId);
    if (!lead) {
      throw new NotFoundError('Lead not found or access denied for this workspace');
    }

    const [activities, appointments] = await Promise.all([
      this.crmRepo.findManyByLeadId(leadId, workspaceId),
      this.appointmentRepo.findManyByLeadId(leadId, workspaceId),
    ]);

    return {
      lead,
      activities,
      appointments,
    };
  }

  /**
   * Retrieves timeline activities for a lead.
   */
  async getLeadActivities(
    leadId: string,
    workspaceId: string,
    options?: { page?: number; limit?: number }
  ): Promise<CRMActivity[]> {
    return this.crmRepo.findManyByLeadId(leadId, workspaceId, options);
  }

  /**
   * Records a manual or system CRM activity (note, call log, email sent/replied).
   */
  async recordActivity(
    leadId: string,
    workspaceId: string,
    userId: string | undefined,
    body: RecordCRMActivityBody
  ): Promise<CRMActivity> {
    const trimmedDesc = body.description.trim();
    if (!trimmedDesc) {
      throw new BadRequestError('Activity description cannot be empty');
    }

    const activity = await this.crmRepo.create(workspaceId, {
      leadId,
      userId,
      type: body.type,
      description: trimmedDesc,
      metadata: body.metadata,
    });

    try {
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'crm:activity_recorded',
        entityType: 'CRMActivity',
        entityId: activity.id,
        metadata: {
          leadId,
          type: activity.type,
        },
      });
    } catch {
      // Non-blocking audit failure
    }

    return activity;
  }

  /**
   * Updates lead CRM stage atomically and records a STAGE_CHANGE activity entry.
   */
  async updateLeadStage(
    leadId: string,
    workspaceId: string,
    userId: string | undefined,
    body: UpdateLeadStageBody
  ): Promise<{ lead: Lead; activity: CRMActivity }> {
    const existing = await this.leadRepo.findById(leadId, workspaceId);
    if (!existing) {
      throw new NotFoundError('Lead not found or access denied for this workspace');
    }

    const previousStatus = existing.status;
    const newStatus = body.status;

    // 1. Same-stage check: do not create redundant STAGE_CHANGE activity
    if (previousStatus === newStatus) {
      // Fetch latest activity or return existing lead with last recorded activity
      const activities = await this.crmRepo.findManyByLeadId(leadId, workspaceId);
      const latestActivity = activities[0] || {
        id: `synthetic_${Date.now()}`,
        leadId,
        userId: userId || null,
        type: 'STAGE_CHANGE',
        description: `Lead status remained ${newStatus}`,
        metadata: null,
        createdAt: new Date(),
      };

      return {
        lead: existing,
        activity: latestActivity,
      };
    }

    // 2. Regulatory & Lifecycle Transition Validation
    if (previousStatus === 'OPT_OUT') {
      throw new BadRequestError(
        'Cannot transition lead stage from OPT_OUT. Regulatory suppression boundary is active.'
      );
    }

    const allowedNext = ALLOWED_STAGE_TRANSITIONS[previousStatus as CanonicalLeadStatus] || [];
    if (!allowedNext.includes(newStatus as CanonicalLeadStatus)) {
      throw new BadRequestError(
        `Invalid stage transition from ${previousStatus} to ${newStatus}. Allowed next stages: ${allowedNext.join(', ')}`
      );
    }

    const description = body.note
      ? `Stage transitioned from ${previousStatus} to ${newStatus}. Note: ${body.note}`
      : `Stage transitioned from ${previousStatus} to ${newStatus}`;

    // 3. Atomic Multi-Operation Execution (Transaction)
    const result = await this.db.transaction(async () => {
      // a. Update lead status
      const updatedLead = await this.leadRepo.update(leadId, workspaceId, {
        status: newStatus as any,
      });

      // b. Record STAGE_CHANGE activity
      const activity = await this.crmRepo.create(workspaceId, {
        leadId,
        userId,
        type: 'STAGE_CHANGE',
        description,
        metadata: {
          previousStatus,
          newStatus,
          note: body.note,
        },
      });

      // c. Log audit event
      try {
        await this.auditLogger.create({
          workspaceId,
          userId,
          eventType: 'crm:stage_changed',
          entityType: 'Lead',
          entityId: leadId,
          metadata: {
            previousStatus,
            newStatus,
            note: body.note,
          },
        });
      } catch {
        // Non-blocking audit
      }

      return {
        lead: updatedLead,
        activity,
      };
    });

    return result;
  }

  // --- Dedicated Appointment Operations ---

  /**
   * Creates a scheduled appointment for a lead in the workspace.
   */
  async createAppointment(
    workspaceId: string,
    userId: string | undefined,
    data: CreateAppointmentInput
  ): Promise<Appointment> {
    const lead = await this.leadRepo.findById(data.leadId, workspaceId);
    if (!lead) {
      throw new NotFoundError('Lead not found or access denied for this workspace');
    }

    const appointment = await this.appointmentRepo.create(workspaceId, {
      leadId: data.leadId,
      contactId: data.contactId,
      userId: data.userId || userId,
      title: data.title || 'Meeting',
      scheduledStartTime: new Date(data.scheduledStartTime),
      scheduledEndTime: new Date(data.scheduledEndTime),
      meetingLink: data.meetingLink,
      notes: data.notes,
      status: data.status,
    });

    try {
      await this.crmRepo.create(workspaceId, {
        leadId: data.leadId,
        userId,
        type: 'NOTE',
        description: `Booked appointment: ${appointment.title} on ${new Date(data.scheduledStartTime).toISOString()}`,
        metadata: {
          appointmentId: appointment.id,
          scheduledStartTime: data.scheduledStartTime,
          scheduledEndTime: data.scheduledEndTime,
        },
      });
    } catch {
      // Non-blocking activity log
    }

    try {
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'crm:appointment_created',
        entityType: 'Appointment',
        entityId: appointment.id,
        metadata: {
          leadId: data.leadId,
          title: appointment.title,
          scheduledStartTime: appointment.scheduledStartTime,
        },
      });
    } catch {
      // Non-blocking audit
    }

    return appointment;
  }

  /**
   * Retrieves single appointment scoped to workspace.
   */
  async getAppointment(id: string, workspaceId: string): Promise<Appointment> {
    const appointment = await this.appointmentRepo.findById(id, workspaceId);
    if (!appointment) {
      throw new NotFoundError('Appointment not found or access denied for this workspace');
    }
    return appointment;
  }

  /**
   * Lists all appointments for a specific lead scoped to workspace.
   */
  async listAppointmentsForLead(leadId: string, workspaceId: string): Promise<Appointment[]> {
    const lead = await this.leadRepo.findById(leadId, workspaceId);
    if (!lead) {
      throw new NotFoundError('Lead not found or access denied for this workspace');
    }
    return this.appointmentRepo.findManyByLeadId(leadId, workspaceId);
  }

  /**
   * Lists paginated appointments across workspace with optional filters.
   */
  async listAppointments(
    workspaceId: string,
    query: AppointmentQueryFilter = {}
  ): Promise<PaginationResult<Appointment>> {
    return this.appointmentRepo.findManyPaginated(workspaceId, query);
  }

  /**
   * Updates an existing appointment.
   */
  async updateAppointment(
    id: string,
    workspaceId: string,
    userId: string | undefined,
    data: UpdateAppointmentInput
  ): Promise<Appointment> {
    const existing = await this.appointmentRepo.findById(id, workspaceId);
    if (!existing) {
      throw new NotFoundError('Appointment not found or access denied for this workspace');
    }

    const updated = await this.appointmentRepo.update(id, workspaceId, {
      contactId: data.contactId,
      userId: data.userId,
      title: data.title,
      scheduledStartTime: data.scheduledStartTime ? new Date(data.scheduledStartTime) : undefined,
      scheduledEndTime: data.scheduledEndTime ? new Date(data.scheduledEndTime) : undefined,
      meetingLink: data.meetingLink,
      status: data.status,
      notes: data.notes,
    });

    if (data.status && data.status !== existing.status) {
      try {
        await this.crmRepo.create(workspaceId, {
          leadId: existing.leadId,
          userId,
          type: 'NOTE',
          description: `Appointment status updated from ${existing.status} to ${data.status}${data.notes ? `: ${data.notes}` : ''}`,
          metadata: {
            appointmentId: id,
            previousStatus: existing.status,
            newStatus: data.status,
          },
        });
      } catch {
        // Non-blocking activity log
      }
    }

    try {
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'crm:appointment_updated',
        entityType: 'Appointment',
        entityId: id,
        metadata: {
          previousStatus: existing.status,
          newStatus: data.status,
          updatedFields: Object.keys(data),
        },
      });
    } catch {
      // Non-blocking audit
    }

    return updated;
  }

  /**
   * Convenience helper to update appointment status.
   */
  async updateAppointmentStatus(
    id: string,
    workspaceId: string,
    userId: string | undefined,
    status: AppointmentStatus,
    notes?: string
  ): Promise<Appointment> {
    return this.updateAppointment(id, workspaceId, userId, { status, notes });
  }

  /**
   * Deletes an appointment scoped to workspace.
   */
  async deleteAppointment(
    id: string,
    workspaceId: string,
    userId: string | undefined
  ): Promise<boolean> {
    const existing = await this.appointmentRepo.findById(id, workspaceId);
    if (!existing) {
      throw new NotFoundError('Appointment not found or access denied for this workspace');
    }

    await this.appointmentRepo.delete(id, workspaceId);

    try {
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'crm:appointment_deleted',
        entityType: 'Appointment',
        entityId: id,
      });
    } catch {
      // Non-blocking audit
    }

    return true;
  }
}

export const crmService = new CRMService();
