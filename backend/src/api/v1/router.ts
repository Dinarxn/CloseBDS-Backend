import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { healthRouter } from '../health/health.router.js';
import { authRouter } from '../../modules/auth/auth.router.js';
import { workspaceRouter } from '../../modules/workspaces/workspace.router.js';
import { campaignRouter } from '../../modules/campaigns/campaign.router.js';
import { leadRouter } from '../../modules/leads/lead.router.js';
import { discoveryRouter } from '../../modules/lead-discovery/discovery.router.js';
import { researchRouter } from '../../modules/lead-research/research.router.js';
import { qualificationRouter } from '../../modules/qualification/qualification.router.js';
import { personalizationRouter } from '../../modules/personalization/personalization.router.js';
import { outreachRouter } from '../../modules/outreach/outreach.router.js';
import { crmRouter } from '../../modules/crm/crm.router.js';
import { followUpRouter } from '../../modules/follow-ups/follow-up.router.js';
import { analyticsRouter } from '../../modules/analytics/analytics.router.js';
import { settingsRouter } from '../../modules/settings/settings.router.js';
import { notificationRouter } from '../../modules/notifications/notification.router.js';
import { integrationRouter } from '../../modules/integrations/integration.router.js';
import { jobRouter } from '../../modules/jobs/job.router.js';
import { voiceRouter } from '../../modules/voice/voice.router.js';
import { n8nRouter } from '../../modules/integrations/n8n/n8n.router.js';
import { operationsRouter } from '../../modules/operations/operations.router.js';

/**
 * API v1 Router.
 * Mounts all v1 endpoints and domain route groups.
 */
export const v1Router: FastifyPluginAsync = async (fastify: FastifyInstance): Promise<void> => {
  // 1. Mount v1 infrastructure health check: /api/v1/health
  await fastify.register(healthRouter);

  // 2. Authentication & Identity: /api/v1/auth/*
  await fastify.register(authRouter, { prefix: '/auth' });

  // 3. Workspaces & Membership: /api/v1/workspaces/*
  await fastify.register(workspaceRouter, { prefix: '/workspaces' });

  // 4. Campaigns Management: /api/v1/campaigns/*
  await fastify.register(campaignRouter, { prefix: '/campaigns' });

  // 5. Leads & Contacts Management: /api/v1/leads/*
  await fastify.register(leadRouter, { prefix: '/leads' });

  // 6. Lead Discovery: /api/v1/lead-discovery/*
  await fastify.register(discoveryRouter, { prefix: '/lead-discovery' });

  // 7. Lead Research & Website Audit: /api/v1/lead-research/*
  await fastify.register(researchRouter, { prefix: '/lead-research' });

  // 8. AI Qualification & Scoring: /api/v1/qualification/*
  await fastify.register(qualificationRouter, { prefix: '/qualification' });

  // 9. AI Personalization: /api/v1/personalization/*
  await fastify.register(personalizationRouter, { prefix: '/personalization' });

  // 10. Outreach Workflow & Human Approval: /api/v1/outreach/*
  await fastify.register(outreachRouter, { prefix: '/outreach' });

  // 11. CRM Activities & Pipeline Stages: /api/v1/crm/*
  await fastify.register(crmRouter, { prefix: '/crm' });

  // 12. Follow-Up Tasks & Actionable Items: /api/v1/follow-ups/*
  await fastify.register(followUpRouter, { prefix: '/follow-ups' });

  // 13. Analytics & Reporting Domain: /api/v1/analytics/*
  await fastify.register(analyticsRouter, { prefix: '/analytics' });

  // 14. Settings, Providers & Suppression: /api/v1/settings/*
  await fastify.register(settingsRouter, { prefix: '/settings' });

  // 15. In-App Notifications: /api/v1/notifications/*
  await fastify.register(notificationRouter, { prefix: '/notifications' });

  // 16. System Events & Webhooks Integration: /api/v1/integrations/*
  await fastify.register(integrationRouter, { prefix: '/integrations' });

  // 17. Background Jobs & Workflow Engine: /api/v1/jobs/*
  await fastify.register(jobRouter, { prefix: '/jobs' });

  // 18. AI Voice Outreach & Calling Agent: /api/v1/voice/*
  await fastify.register(voiceRouter, { prefix: '/voice' });

  // 19. n8n Automation Gateway: /api/v1/integrations/n8n/*
  await fastify.register(n8nRouter, { prefix: '/integrations/n8n' });

  // 20. Operations Workspace Domain: /api/v1/operations/*
  await fastify.register(operationsRouter, { prefix: '/operations' });
};
