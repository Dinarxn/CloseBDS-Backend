import {
  WorkspaceRepository,
  SuppressionRepository,
  AuditRepository,
  SettingsRepository,
  workspaceRepository as defaultWorkspaceRepo,
  suppressionRepository as defaultSuppressionRepo,
  auditRepository as defaultAuditRepo,
  settingsRepository as defaultSettingsRepo,
  type PaginationResult,
  type AuditLogQueryFilter,
} from '../../database/repository.js';
import type { AuditLog } from '@prisma/client';
import { NotFoundError, BadRequestError } from '../../core/errors/api-error.js';
import type {
  UpdateWorkspaceSettingsBody,
  UpdateUserPreferencesBody,
  CreateSuppressionBody,
  ListSuppressionsQueryParams,
} from './settings.schema.js';
import type {
  WorkspaceSettings,
  UserPreferences,
  ProviderConfigStatus,
  Suppression,
} from './settings.types.js';

export class SettingsService {
  constructor(
    private workspaceRepo: WorkspaceRepository = defaultWorkspaceRepo,
    private suppressionRepo: SuppressionRepository = defaultSuppressionRepo,
    private auditLogger: AuditRepository = defaultAuditRepo,
    private settingsRepo: SettingsRepository = defaultSettingsRepo
  ) {}

  /**
   * Retrieves workspace settings and safety parameters.
   * Persisted in PostgreSQL and hydrated across container restarts.
   */
  async getWorkspaceSettings(workspaceId: string): Promise<WorkspaceSettings> {
    const workspace = await this.workspaceRepo.findById(workspaceId);
    if (!workspace) {
      throw new NotFoundError('Workspace not found or access denied');
    }

    const config = await this.settingsRepo.getWorkspaceSettings(workspaceId);

    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      killSwitchActive: config.killSwitchActive,
      defaultDailyCap: config.defaultDailyCap,
      safetyThreshold: config.safetyThreshold,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    };
  }

  /**
   * Updates workspace settings (name, kill switch, daily caps, safety thresholds).
   * Persisted directly to PostgreSQL.
   */
  async updateWorkspaceSettings(
    workspaceId: string,
    userId: string | undefined,
    body: UpdateWorkspaceSettingsBody
  ): Promise<WorkspaceSettings> {
    const workspace = await this.workspaceRepo.findById(workspaceId);
    if (!workspace) {
      throw new NotFoundError('Workspace not found or access denied');
    }

    let updated = workspace;
    if (body.name && body.name !== workspace.name) {
      updated = await this.workspaceRepo.update(workspaceId, {
        name: body.name,
      });
    }

    const updatedConfig = await this.settingsRepo.updateWorkspaceSettings(workspaceId, {
      killSwitchActive: body.killSwitchActive,
      defaultDailyCap: body.defaultDailyCap,
      safetyThreshold: body.safetyThreshold,
    });

    try {
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'settings:workspace_updated',
        entityType: 'Workspace',
        entityId: workspaceId,
        metadata: {
          updatedFields: Object.keys(body),
          config: updatedConfig,
        },
      });
    } catch {
      // Non-blocking audit
    }

    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      killSwitchActive: updatedConfig.killSwitchActive,
      defaultDailyCap: updatedConfig.defaultDailyCap,
      safetyThreshold: updatedConfig.safetyThreshold,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  /**
   * Retrieves preferences for the authenticated user within the workspace.
   * Persisted in PostgreSQL and tenant-scoped.
   */
  async getUserPreferences(userId: string, workspaceId: string): Promise<UserPreferences> {
    const record = await this.settingsRepo.getUserPreferences(userId, workspaceId);

    return {
      userId: record.userId,
      workspaceId: record.workspaceId,
      emailNotifications: record.emailNotifications,
      qualificationAlerts: record.qualificationAlerts,
      outreachApprovalAlerts: record.outreachApprovalAlerts,
      taskDueAlerts: record.taskDueAlerts,
      theme: record.theme,
      language: record.language,
      updatedAt: record.updatedAt,
    };
  }

  /**
   * Updates user preferences with tenant scoping in PostgreSQL.
   */
  async updateUserPreferences(
    userId: string,
    workspaceId: string,
    body: UpdateUserPreferencesBody
  ): Promise<UserPreferences> {
    const updated = await this.settingsRepo.updateUserPreferences(userId, workspaceId, {
      emailNotifications: body.emailNotifications,
      qualificationAlerts: body.qualificationAlerts,
      outreachApprovalAlerts: body.outreachApprovalAlerts,
      taskDueAlerts: body.taskDueAlerts,
      theme: body.theme,
      language: body.language,
    });

    try {
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'settings:preferences_updated',
        entityType: 'UserPreferences',
        entityId: userId,
        metadata: {
          updatedKeys: Object.keys(body),
        },
      });
    } catch {
      // Non-blocking audit
    }

    return {
      userId: updated.userId,
      workspaceId: updated.workspaceId,
      emailNotifications: updated.emailNotifications,
      qualificationAlerts: updated.qualificationAlerts,
      outreachApprovalAlerts: updated.outreachApprovalAlerts,
      taskDueAlerts: updated.taskDueAlerts,
      theme: updated.theme,
      language: updated.language,
      updatedAt: updated.updatedAt,
    };
  }

  /**
   * Returns configuration status for external providers WITHOUT leaking secrets, tokens, or keys.
   */
  async getProviderStatus(): Promise<ProviderConfigStatus[]> {
    const hasOpenAI = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim().length > 0);
    const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim().length > 0);
    const hasDeepSeek = Boolean(process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY.trim().length > 0);
    const hasResend = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.trim().length > 0);
    const hasSendGrid = Boolean(process.env.SENDGRID_API_KEY && process.env.SENDGRID_API_KEY.trim().length > 0);
    const hasSerpApi = Boolean(process.env.SERPAPI_API_KEY && process.env.SERPAPI_API_KEY.trim().length > 0);
    const hasApify = Boolean(process.env.APIFY_API_TOKEN && process.env.APIFY_API_TOKEN.trim().length > 0);
    const hasGeoapify = Boolean(process.env.GEOAPIFY_API_KEY && process.env.GEOAPIFY_API_KEY.trim().length > 0);
    const hasWhatsApp = Boolean(
      (process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_WHATSAPP_TOKEN) &&
      (process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.META_PHONE_NUMBER_ID)
    );
    const hasTwilio = Boolean(
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_ACCOUNT_SID.trim().length > 0 &&
      process.env.TWILIO_AUTH_TOKEN.trim().length > 0
    );

    return [
      {
        provider: 'OpenAI',
        category: 'AI_LLM',
        isConfigured: hasOpenAI,
        status: hasOpenAI ? 'CONFIGURED' : 'NOT_CONFIGURED',
        features: ['Lead Qualification', 'Draft Personalization', 'Reasoning'],
      },
      {
        provider: 'Anthropic Claude',
        category: 'AI_LLM',
        isConfigured: hasAnthropic,
        status: hasAnthropic ? 'CONFIGURED' : 'NOT_CONFIGURED',
        features: ['Technical Audit Synthesis', 'High-Touch Cold Outreach'],
      },
      {
        provider: 'DeepSeek',
        category: 'AI_LLM',
        isConfigured: hasDeepSeek,
        status: hasDeepSeek ? 'CONFIGURED' : 'NOT_CONFIGURED',
        features: ['Cost-Optimized Batch Qualification'],
      },
      {
        provider: 'Resend',
        category: 'EMAIL_DISPATCH',
        isConfigured: hasResend,
        status: hasResend ? 'CONFIGURED' : 'NOT_CONFIGURED',
        features: ['Transactional Email', 'Human-Approved Cold Email Dispatch'],
      },
      {
        provider: 'SendGrid',
        category: 'EMAIL_DISPATCH',
        isConfigured: hasSendGrid,
        status: hasSendGrid ? 'CONFIGURED' : 'NOT_CONFIGURED',
        features: ['High-Volume Outreach Gateway'],
      },
      {
        provider: 'SerpAPI / Google Maps',
        category: 'LEAD_SCRAPING',
        isConfigured: hasSerpApi,
        status: hasSerpApi ? 'CONFIGURED' : 'NOT_CONFIGURED',
        features: ['Local B2B Business Discovery', 'Google Business Profile Enrichment'],
      },
      {
        provider: 'Geoapify Places API',
        category: 'LEAD_SCRAPING',
        isConfigured: hasGeoapify,
        status: hasGeoapify ? 'CONFIGURED' : 'NOT_CONFIGURED',
        features: ['OSM-Powered Place Discovery', 'Geocoding & Place Details Enrichment'],
      },
      {
        provider: 'Apify Web Scraper',
        category: 'LEAD_SCRAPING',
        isConfigured: hasApify,
        status: hasApify ? 'CONFIGURED' : 'NOT_CONFIGURED',
        features: ['Website Technical Gaps Audit', 'Social Profile Discovery'],
      },
      {
        provider: 'Meta WhatsApp Cloud API',
        category: 'WHATSAPP',
        isConfigured: hasWhatsApp,
        status: hasWhatsApp ? 'CONFIGURED' : 'NOT_CONFIGURED',
        features: ['Template Messages', 'Opt-In Conversational Outreach'],
      },
      {
        provider: 'Twilio',
        category: 'CALLING',
        isConfigured: hasTwilio,
        status: hasTwilio ? 'CONFIGURED' : 'NOT_CONFIGURED',
        features: ['Outbound PSTN Telephony', 'Media Streams', 'Status Callbacks'],
      },
    ];
  }

  /**
   * Lists workspace suppressions with pagination and filters.
   */
  async listSuppressions(
    workspaceId: string,
    query: ListSuppressionsQueryParams
  ): Promise<PaginationResult<Suppression>> {
    return this.suppressionRepo.findManyPaginated(workspaceId, {
      type: query.type,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
  }

  /**
   * Adds an email or domain suppression entry.
   */
  async addSuppression(
    workspaceId: string,
    userId: string | undefined,
    body: CreateSuppressionBody
  ): Promise<Suppression> {
    const value = body.value.toLowerCase().trim();
    if (!value) {
      throw new BadRequestError('Suppression value cannot be blank');
    }

    const suppression = await this.suppressionRepo.create({
      workspaceId,
      type: body.type,
      value,
      reason: body.reason,
    });

    try {
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'suppression:created',
        entityType: 'Suppression',
        entityId: suppression.id,
        metadata: {
          type: suppression.type,
          value: suppression.value,
          reason: suppression.reason,
        },
      });
    } catch {
      // Non-blocking audit
    }

    return suppression;
  }

  /**
   * Removes a suppression entry by ID.
   */
  async removeSuppression(
    id: string,
    workspaceId: string,
    userId: string | undefined
  ): Promise<boolean> {
    const deleted = await this.suppressionRepo.delete(id, workspaceId);
    if (!deleted) {
      throw new NotFoundError('Suppression record not found');
    }

    try {
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'suppression:deleted',
        entityType: 'Suppression',
        entityId: id,
        metadata: {
          suppressionId: id,
        },
      });
    } catch {
      // Non-blocking audit
    }

    return true;
  }

  /**
   * Retrieves paginated back-office audit logs scoped to workspace.
   */
  async listAuditLogs(
    workspaceId: string,
    query: AuditLogQueryFilter = {}
  ): Promise<PaginationResult<AuditLog>> {
    return this.auditLogger.findManyPaginated(workspaceId, query);
  }
}

export const settingsService = new SettingsService();
