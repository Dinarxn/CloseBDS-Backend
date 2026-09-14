import type { Suppression } from '@prisma/client';

export type { Suppression };

export interface WorkspaceSettings {
  id: string;
  name: string;
  slug?: string;
  killSwitchActive: boolean;
  defaultDailyCap: number;
  safetyThreshold: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserPreferences {
  userId: string;
  workspaceId: string;
  emailNotifications: boolean;
  qualificationAlerts: boolean;
  outreachApprovalAlerts: boolean;
  taskDueAlerts: boolean;
  theme: 'dark' | 'light' | 'system';
  language: string;
  updatedAt: Date;
}

export interface ProviderConfigStatus {
  provider: string;
  category: 'AI_LLM' | 'EMAIL_DISPATCH' | 'LEAD_SCRAPING' | 'SEARCH' | 'CALLING';
  isConfigured: boolean;
  status: 'CONFIGURED' | 'NOT_CONFIGURED';
  features: string[];
}
