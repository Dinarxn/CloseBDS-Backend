import {
  WorkspaceRepository,
  SuppressionRepository,
  AuditRepository,
  workspaceRepository as defaultWorkspaceRepo,
  suppressionRepository as defaultSuppressionRepo,
  auditRepository as defaultAuditRepo,
  type PaginationResult,
} from '../../database/repository.js';
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
  // In-memory preferences store keyed by `${workspaceId}:${userId}`
  private userPreferencesStore: Map<string, UserPreferences> = new Map();
  // In-memory workspace settings store for safety thresholds and kill switch state
  private workspaceConfigStore: Map<
    string,
    { killSwitchActive: boolean; defaultDailyCap: number; safetyThreshold: number }
  > = new Map();

  constructor(
    private workspaceRepo: WorkspaceRepository = defaultWorkspaceRepo,
    private suppressionRepo: SuppressionRepository = defaultSuppressionRepo,
    private auditLogger: AuditRepository = defaultAuditRepo
  ) {}

  /**
   * Retrieves workspace settings and safety parameters.
   */
  async getWorkspaceSettings(workspaceId: string): Promise<WorkspaceSettings> {
    const workspace = await this.workspaceRepo.findById(workspaceId);
    if (!workspace) {
      throw new NotFoundError('Workspace not found or access denied');
    }

    const config = this.workspaceConfigStore.get(workspaceId) || {
      killSwitchActive: false,
      defaultDailyCap: 50,
      safetyThreshold: 70,
    };

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

    const currentConfig = this.workspaceConfigStore.get(workspaceId) || {
      killSwitchActive: false,
      defaultDailyCap: 50,
      safetyThreshold: 70,
    };

    const newConfig = {
      killSwitchActive: body.killSwitchActive ?? currentConfig.killSwitchActive,
      defaultDailyCap: body.defaultDailyCap ?? currentConfig.defaultDailyCap,
      safetyThreshold: body.safetyThreshold ?? currentConfig.safetyThreshold,
    };
    this.workspaceConfigStore.set(workspaceId, newConfig);

    try {
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'settings:workspace_updated',
        entityType: 'Workspace',
        entityId: workspaceId,
        metadata: {
          updatedFields: Object.keys(body),
          config: newConfig,
        },
      });
    } catch {
      // Non-blocking audit
    }

    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      killSwitchActive: newConfig.killSwitchActive,
      defaultDailyCap: newConfig.defaultDailyCap,
      safetyThreshold: newConfig.safetyThreshold,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  /**
   * Retrieves preferences for the authenticated user within the workspace.
   */
  async getUserPreferences(userId: string, workspaceId: string): Promise<UserPreferences> {
    const key = `${workspaceId}:${userId}`;
    const existing = this.userPreferencesStore.get(key);

    if (existing) {
      return existing;
    }

    const defaultPrefs: UserPreferences = {
      userId,
      workspaceId,
      emailNotifications: true,
      qualificationAlerts: true,
      outreachApprovalAlerts: true,
      taskDueAlerts: true,
      theme: 'system',
      language: 'en',
      updatedAt: new Date(),
    };

    this.userPreferencesStore.set(key, defaultPrefs);
    return defaultPrefs;
  }

  /**
   * Updates user preferences with tenant scoping.
   */
  async updateUserPreferences(
    userId: string,
    workspaceId: string,
    body: UpdateUserPreferencesBody
  ): Promise<UserPreferences> {
    const current = await this.getUserPreferences(userId, workspaceId);

    const updated: UserPreferences = {
      ...current,
      emailNotifications: body.emailNotifications ?? current.emailNotifications,
      qualificationAlerts: body.qualificationAlerts ?? current.qualificationAlerts,
      outreachApprovalAlerts: body.outreachApprovalAlerts ?? current.outreachApprovalAlerts,
      taskDueAlerts: body.taskDueAlerts ?? current.taskDueAlerts,
      theme: body.theme ?? current.theme,
      language: body.language ?? current.language,
      updatedAt: new Date(),
    };

    const key = `${workspaceId}:${userId}`;
    this.userPreferencesStore.set(key, updated);

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

    return updated;
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
        provider: 'Apify Web Scraper',
        category: 'LEAD_SCRAPING',
        isConfigured: hasApify,
        status: hasApify ? 'CONFIGURED' : 'NOT_CONFIGURED',
        features: ['Website Technical Gaps Audit', 'Social Profile Discovery'],
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
}

export const settingsService = new SettingsService();
