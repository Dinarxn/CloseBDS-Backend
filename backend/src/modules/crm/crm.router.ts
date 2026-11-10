import type { FastifyPluginAsync } from 'fastify';
import { crmService } from './crm.service.js';
import {
  recordCRMActivitySchema,
  updateLeadStageSchema,
  createAppointmentSchema,
  updateAppointmentSchema,
  listAppointmentsQuerySchema,
} from './crm.schema.js';
import {
  requireAuthenticatedUser,
  requireWorkspaceContext,
} from '../../core/permissions/auth-guards.js';

export const crmRouter: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.addHook('preHandler', requireAuthenticatedUser);
  fastify.addHook('preHandler', requireWorkspaceContext);

  // 1. GET /api/v1/crm/leads/:leadId - Complete CRM profile
  fastify.get<{ Params: { leadId: string } }>('/leads/:leadId', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const profile = await crmService.getLeadCRMProfile(request.params.leadId, workspaceId);

    return reply.status(200).send({
      success: true,
      ...profile,
    });
  });

  // 2. GET /api/v1/crm/leads/:leadId/activities - Activities timeline
  fastify.get<{
    Params: { leadId: string };
    Querystring: { page?: string; limit?: string };
  }>('/leads/:leadId/activities', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const page = request.query.page ? parseInt(request.query.page, 10) : undefined;
    const limit = request.query.limit ? parseInt(request.query.limit, 10) : undefined;
    const activities = await crmService.getLeadActivities(request.params.leadId, workspaceId, {
      page: !isNaN(page as number) ? page : undefined,
      limit: !isNaN(limit as number) ? limit : undefined,
    });

    return reply.status(200).send({
      success: true,
      activities,
    });
  });

  // 3. POST /api/v1/crm/leads/:leadId/activities - Record new activity
  fastify.post<{ Params: { leadId: string } }>('/leads/:leadId/activities', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;
    const body = recordCRMActivitySchema.parse(request.body);

    const activity = await crmService.recordActivity(
      request.params.leadId,
      workspaceId,
      userId,
      body
    );

    return reply.status(201).send({
      success: true,
      activity,
    });
  });

  // 4. PATCH /api/v1/crm/leads/:leadId/stage - Update stage
  fastify.patch<{ Params: { leadId: string } }>('/leads/:leadId/stage', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;
    const body = updateLeadStageSchema.parse(request.body);

    const result = await crmService.updateLeadStage(
      request.params.leadId,
      workspaceId,
      userId,
      body
    );

    return reply.status(200).send({
      success: true,
      ...result,
    });
  });

  // 5. POST /api/v1/crm/leads/:leadId/appointments - Create appointment for lead
  fastify.post<{ Params: { leadId: string } }>(
    '/leads/:leadId/appointments',
    async (request, reply) => {
      const workspaceId = request.workspaceContext!.workspaceId;
      const userId = request.workspaceContext!.userId;
      const rawBody = (request.body || {}) as Record<string, unknown>;
      const body = createAppointmentSchema.parse({
        ...rawBody,
        leadId: request.params.leadId,
      });

      const appointment = await crmService.createAppointment(workspaceId, userId, {
        ...body,
        leadId: request.params.leadId,
        scheduledStartTime: new Date(body.scheduledStartTime),
        scheduledEndTime: new Date(body.scheduledEndTime),
      });

      return reply.status(201).send({
        success: true,
        appointment,
      });
    }
  );

  // 6. GET /api/v1/crm/leads/:leadId/appointments - List appointments for lead
  fastify.get<{ Params: { leadId: string } }>(
    '/leads/:leadId/appointments',
    async (request, reply) => {
      const workspaceId = request.workspaceContext!.workspaceId;
      const appointments = await crmService.listAppointmentsForLead(
        request.params.leadId,
        workspaceId
      );

      return reply.status(200).send({
        success: true,
        appointments,
      });
    }
  );

  // 7. GET /api/v1/crm/appointments - List workspace appointments with pagination
  fastify.get('/appointments', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const query = listAppointmentsQuerySchema.parse(request.query);
    const result = await crmService.listAppointments(workspaceId, query);

    return reply.status(200).send({
      success: true,
      ...result,
      items: result.data,
    });
  });

  // 8. GET /api/v1/crm/appointments/:id - Get single appointment
  fastify.get<{ Params: { id: string } }>('/appointments/:id', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const appointment = await crmService.getAppointment(request.params.id, workspaceId);

    return reply.status(200).send({
      success: true,
      appointment,
    });
  });

  // 9. PATCH /api/v1/crm/appointments/:id - Update appointment
  fastify.patch<{ Params: { id: string } }>('/appointments/:id', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;
    const body = updateAppointmentSchema.parse(request.body);

    const appointment = await crmService.updateAppointment(
      request.params.id,
      workspaceId,
      userId,
      {
        ...body,
        scheduledStartTime: body.scheduledStartTime ? new Date(body.scheduledStartTime) : undefined,
        scheduledEndTime: body.scheduledEndTime ? new Date(body.scheduledEndTime) : undefined,
      }
    );

    return reply.status(200).send({
      success: true,
      appointment,
    });
  });

  // 10. DELETE /api/v1/crm/appointments/:id - Delete appointment
  fastify.delete<{ Params: { id: string } }>('/appointments/:id', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;
    await crmService.deleteAppointment(request.params.id, workspaceId, userId);

    return reply.status(200).send({
      success: true,
      message: 'Appointment deleted successfully',
    });
  });
};
