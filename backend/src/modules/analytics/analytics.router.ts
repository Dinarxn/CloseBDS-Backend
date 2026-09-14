import type { FastifyPluginAsync } from 'fastify';
import { analyticsService } from './analytics.service.js';
import {
  dateRangeFilterSchema,
  campaignAnalyticsParamsSchema,
  exportAnalyticsQuerySchema,
} from './analytics.schema.js';
import {
  requireAuthenticatedUser,
  requireWorkspaceContext,
} from '../../core/permissions/auth-guards.js';

export const analyticsRouter: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.addHook('preHandler', requireAuthenticatedUser);
  fastify.addHook('preHandler', requireWorkspaceContext);

  // 1. GET /api/v1/analytics/overview - Overall KPI metrics
  fastify.get('/overview', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const filter = dateRangeFilterSchema.parse(request.query);
    const metrics = await analyticsService.getOverview(workspaceId, filter);

    return reply.status(200).send({
      success: true,
      metrics,
    });
  });

  // 2. GET /api/v1/analytics/leads - Lead funnel & scoring metrics
  fastify.get('/leads', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const filter = dateRangeFilterSchema.parse(request.query);
    const leads = await analyticsService.getLeadsAnalytics(workspaceId, filter);

    return reply.status(200).send({
      success: true,
      leads,
    });
  });

  // 3. GET /api/v1/analytics/campaigns - All campaigns performance summary
  fastify.get('/campaigns', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const filter = dateRangeFilterSchema.parse(request.query);
    const campaigns = await analyticsService.getCampaignsAnalytics(workspaceId, filter);

    return reply.status(200).send({
      success: true,
      ...campaigns,
    });
  });

  // 4. GET /api/v1/analytics/campaigns/:campaignId - Single campaign deep-dive
  fastify.get<{ Params: { campaignId: string } }>(
    '/campaigns/:campaignId',
    async (request, reply) => {
      const workspaceId = request.workspaceContext!.workspaceId;
      const params = campaignAnalyticsParamsSchema.parse(request.params);

      const analytics = await analyticsService.getCampaignAnalytics(
        params.campaignId,
        workspaceId
      );

      return reply.status(200).send({
        success: true,
        analytics,
      });
    }
  );

  // 5. GET /api/v1/analytics/outreach - Outreach workflow & approval metrics
  fastify.get('/outreach', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const filter = dateRangeFilterSchema.parse(request.query);
    const outreach = await analyticsService.getOutreachAnalytics(workspaceId, filter);

    return reply.status(200).send({
      success: true,
      outreach,
    });
  });

  // 6. GET /api/v1/analytics/activity - Activity trends & volume
  fastify.get('/activity', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const filter = dateRangeFilterSchema.parse(request.query);
    const activity = await analyticsService.getActivityTrends(workspaceId, filter);

    return reply.status(200).send({
      success: true,
      activity,
    });
  });

  // 7. GET /api/v1/analytics/voice - Voice outreach and calling metrics
  fastify.get('/voice', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const filter = dateRangeFilterSchema.parse(request.query);
    const voice = await analyticsService.getVoiceAnalytics(workspaceId, filter);

    return reply.status(200).send({
      success: true,
      voice,
    });
  });

  // 7b. GET /api/v1/analytics/acquisition-funnel - Campaign-independent canonical acquisition funnel
  fastify.get('/acquisition-funnel', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const filter = dateRangeFilterSchema.parse(request.query);
    const funnel = await analyticsService.getAcquisitionFunnel(workspaceId, filter);

    return reply.status(200).send({
      success: true,
      data: funnel,
    });
  });

  // 8. GET /api/v1/analytics/export - Export report (CSV or JSON)
  fastify.get('/export', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const query = exportAnalyticsQuerySchema.parse(request.query);

    const report = await analyticsService.exportReport(
      workspaceId,
      query.format,
      {
        campaignId: query.campaignId,
        from: query.from,
        to: query.to,
      }
    );

    if (query.format === 'csv') {
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="leads_export_${Date.now()}.csv"`)
        .send(report);
    }

    return reply.status(200).send({
      success: true,
      data: report,
    });
  });
};
