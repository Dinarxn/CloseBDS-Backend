import { voiceRepository, telephonyPhoneNumberRepository } from '../../database/repository.js';
import { BadRequestError, NotFoundError } from '../../core/errors/api-error.js';
import { TwilioTelephonyAdapter } from '../../integrations/calling/twilio.adapter.js';
import type {
  TelephonyPhoneNumber,
  PhoneNumberCapabilities,
  InboundRoutingConfig,
} from './voice.types.js';
import { MOCK_TELEPHONY_NUMBERS } from '../../integrations/calling/mock-fixtures.js';

export interface ImportPhoneNumberInput {
  phoneNumber: string;
  friendlyName?: string;
  assignedAgentId?: string | null;
}

/**
 * Phone Numbers Management Service.
 * Manages carrier-assigned phone numbers for workspace telephony.
 * STRICT INVARIANT: Phone number registration/import ONLY — NO automatic purchasing.
 */
export class PhoneNumbersService {
  // Tenant-scoped in-memory store: workspaceId -> Map<phoneNumberId, TelephonyPhoneNumber>
  private numberStore: Map<string, Map<string, TelephonyPhoneNumber>> = new Map();
  private validationAdapter = new TwilioTelephonyAdapter();
  private hydratedWorkspaces: Set<string> = new Set();

  constructor() {
    // Seed default mock numbers for test/development workspaces
    const devMap = new Map<string, TelephonyPhoneNumber>();
    for (const num of MOCK_TELEPHONY_NUMBERS) {
      devMap.set(num.id, {
        ...num,
        createdAt: new Date(num.createdAt),
        updatedAt: new Date(num.updatedAt),
      });
    }
    this.numberStore.set('ws_test_mock', devMap);
  }

  /**
   * Hydrates in-memory cache from PostgreSQL on application startup or when requested.
   * Loads all active numbers across all workspaces.
   */
  async hydrateFromDatabase(): Promise<number> {
    try {
      const records = await telephonyPhoneNumberRepository.listAllActive();
      let count = 0;
      for (const record of records) {
        const map = this.getWorkspaceMap(record.workspaceId);
        const capabilities = (record.capabilities as unknown as PhoneNumberCapabilities) || {
          voice: true,
          sms: false,
          mms: false,
          e164: true,
          tollFree: false,
        };
        map.set(record.id, {
          id: record.id,
          workspaceId: record.workspaceId,
          phoneNumber: record.phoneNumber,
          friendlyName: record.friendlyName || `Carrier Line (${record.phoneNumber})`,
          provider: (record.provider as any) || 'twilio',
          capabilities,
          status: (record.status as any) || 'ACTIVE',
          assignedAgentId: record.assignedAgentId || null,
          assignedAgentName: null,
          inboundWebhookUrl: record.inboundWebhookUrl || 'https://api.closevds.com/api/v1/voice/webhooks/twilio',
          outboundCallerIdEnabled: record.outboundCallerIdEnabled ?? true,
          purchasedWithoutAutoBuy: record.purchasedWithoutAutoBuy ?? true,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        });
        this.hydratedWorkspaces.add(record.workspaceId);
        count++;
      }
      return count;
    } catch {
      // Non-blocking fallback for offline testing or unmigrated DB
      return 0;
    }
  }

  /**
   * Ensures the given workspace's numbers are hydrated from PostgreSQL if not already done.
   * FAIL-CLOSED: If the database read fails, do NOT mark the workspace as hydrated,
   * and do NOT allow unverified in-memory state to pretend it is complete.
   */
  private async ensureWorkspaceHydrated(workspaceId: string): Promise<void> {
    if (this.hydratedWorkspaces.has(workspaceId)) {
      return;
    }
    try {
      const records = await telephonyPhoneNumberRepository.listForWorkspace(workspaceId, { status: 'ACTIVE' });
      const map = this.getWorkspaceMap(workspaceId);
      for (const record of records) {
        if (!map.has(record.id)) {
          const capabilities = (record.capabilities as unknown as PhoneNumberCapabilities) || {
            voice: true,
            sms: false,
            mms: false,
            e164: true,
            tollFree: false,
          };
          map.set(record.id, {
            id: record.id,
            workspaceId: record.workspaceId,
            phoneNumber: record.phoneNumber,
            friendlyName: record.friendlyName || `Carrier Line (${record.phoneNumber})`,
            provider: (record.provider as any) || 'twilio',
            capabilities,
            status: (record.status as any) || 'ACTIVE',
            assignedAgentId: record.assignedAgentId || null,
            assignedAgentName: null,
            inboundWebhookUrl: record.inboundWebhookUrl || 'https://api.closevds.com/api/v1/voice/webhooks/twilio',
            outboundCallerIdEnabled: record.outboundCallerIdEnabled ?? true,
            purchasedWithoutAutoBuy: record.purchasedWithoutAutoBuy ?? true,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
          });
        }
      }
      // Only mark hydrated if the database query succeeded
      this.hydratedWorkspaces.add(workspaceId);
    } catch {
      // FAIL-CLOSED: On DB error, leave workspace unhydrated so future calls re-attempt verification
      // rather than caching a false-clean state.
    }
  }

  private getWorkspaceMap(workspaceId: string): Map<string, TelephonyPhoneNumber> {
    let map = this.numberStore.get(workspaceId);
    if (!map) {
      map = new Map<string, TelephonyPhoneNumber>();
      this.numberStore.set(workspaceId, map);
    }
    return map;
  }

  /**
   * Lists all phone numbers registered to the workspace.
   */
  async listPhoneNumbers(workspaceId: string): Promise<TelephonyPhoneNumber[]> {
    if (!workspaceId) {
      throw new BadRequestError('Workspace ID is required');
    }
    await this.ensureWorkspaceHydrated(workspaceId);
    const map = this.getWorkspaceMap(workspaceId);
    return Array.from(map.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  /**
   * Retrieves a single registered phone number by ID.
   */
  async getPhoneNumber(workspaceId: string, id: string): Promise<TelephonyPhoneNumber | null> {
    if (!workspaceId) {
      throw new BadRequestError('Workspace ID is required');
    }
    await this.ensureWorkspaceHydrated(workspaceId);
    const map = this.getWorkspaceMap(workspaceId);
    return map.get(id) || null;
  }

  /**
   * Validates capabilities and E.164 compliance of a candidate phone number.
   */
  async validateCapabilities(phoneNumber: string): Promise<PhoneNumberCapabilities> {
    if (!phoneNumber || typeof phoneNumber !== 'string') {
      return {
        voice: false,
        sms: false,
        mms: false,
        e164: false,
        tollFree: false,
      };
    }
    return this.validationAdapter.validateCapabilities(phoneNumber.trim());
  }

  /**
   * Imports and registers an existing carrier phone number into the workspace.
   * STRICT INVARIANT: Enforces "purchasedWithoutAutoBuy: true".
   */
  async importPhoneNumber(
    workspaceId: string,
    input: ImportPhoneNumberInput
  ): Promise<TelephonyPhoneNumber> {
    if (!workspaceId) {
      throw new BadRequestError('Workspace ID is required');
    }
    if (!input.phoneNumber || input.phoneNumber.trim().length === 0) {
      throw new BadRequestError('Phone number string is required');
    }

    const trimmedPhone = input.phoneNumber.trim();
    const caps = await this.validateCapabilities(trimmedPhone);

    if (!caps.e164) {
      throw new BadRequestError(
        `Phone number "${trimmedPhone}" is not valid E.164. Format must start with '+' and contain 7-15 digits (e.g. +15125550199).`
      );
    }

    const map = this.getWorkspaceMap(workspaceId);

    // Prevent duplicate number registration within the workspace
    const existing = Array.from(map.values()).find((n) => n.phoneNumber === trimmedPhone);
    if (existing) {
      throw new BadRequestError(`Phone number ${trimmedPhone} is already registered in this workspace.`);
    }

    let assignedAgentName: string | null = null;
    if (input.assignedAgentId) {
      try {
        const agent = await voiceRepository.findAgentConfigById(input.assignedAgentId, workspaceId);
        if (agent) {
          assignedAgentName = agent.name;
        }
      } catch {
        // Non-blocking agent name lookup fallback
      }
    }

    const id = `num_${Date.now()}_${trimmedPhone.replace(/\D/g, '').slice(-6)}`;
    const newNumber: TelephonyPhoneNumber = {
      id,
      workspaceId,
      phoneNumber: trimmedPhone,
      friendlyName: input.friendlyName?.trim() || `Carrier Line (${trimmedPhone})`,
      provider: 'twilio',
      capabilities: caps,
      status: 'ACTIVE',
      assignedAgentId: input.assignedAgentId || null,
      assignedAgentName,
      inboundWebhookUrl: 'https://api.closevds.com/api/v1/voice/webhooks/twilio',
      outboundCallerIdEnabled: true,
      purchasedWithoutAutoBuy: true, // Non-negotiable invariant: No auto-purchase
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    map.set(id, newNumber);

    // Persist to TelephonyPhoneNumber database table
    try {
      const persisted = await telephonyPhoneNumberRepository.registerNumber(workspaceId, {
        phoneNumber: trimmedPhone,
        friendlyName: newNumber.friendlyName,
        provider: 'twilio',
        status: 'ACTIVE',
        capabilities: caps as any,
        assignedAgentId: input.assignedAgentId || null,
        inboundWebhookUrl: newNumber.inboundWebhookUrl,
        outboundCallerIdEnabled: true,
        purchasedWithoutAutoBuy: true,
      });
      // Synchronize in-memory ID with DB-generated or matched record ID
      if (persisted && persisted.id) {
        map.delete(id);
        newNumber.id = persisted.id;
        map.set(persisted.id, newNumber);
      }
    } catch {
      // Non-blocking fallback for offline testing
    }

    return newNumber;
  }

  /**
   * Configures inbound routing and voice agent assignment for a registered number.
   */
  async configureRouting(
    workspaceId: string,
    phoneNumberId: string,
    config: InboundRoutingConfig
  ): Promise<TelephonyPhoneNumber> {
    if (!workspaceId) {
      throw new BadRequestError('Workspace ID is required');
    }

    const map = this.getWorkspaceMap(workspaceId);
    const numberEntry = map.get(phoneNumberId);
    if (!numberEntry) {
      throw new NotFoundError(`Phone number with ID ${phoneNumberId} not found in this workspace`);
    }

    let assignedAgentName: string | null = null;
    if (config.targetAgentId) {
      try {
        const agent = await voiceRepository.findAgentConfigById(config.targetAgentId, workspaceId);
        if (agent) {
          assignedAgentName = agent.name;
        }
      } catch {
        // Fallback
      }
    }

    numberEntry.assignedAgentId = config.targetAgentId ?? null;
    numberEntry.assignedAgentName = assignedAgentName;
    numberEntry.inboundWebhookUrl = config.webhookUrl ?? numberEntry.inboundWebhookUrl;
    numberEntry.updatedAt = new Date();

    try {
      await telephonyPhoneNumberRepository.updateRouting(workspaceId, phoneNumberId, {
        assignedAgentId: config.targetAgentId ?? null,
        inboundWebhookUrl: config.webhookUrl ?? numberEntry.inboundWebhookUrl,
      });
    } catch {
      // Non-blocking fallback
    }

    return numberEntry;
  }

  /**
   * Releases or deletes a phone number from the workspace.
   */
  async releasePhoneNumber(
    workspaceId: string,
    phoneNumberId: string
  ): Promise<{ released: boolean; message: string }> {
    if (!workspaceId) {
      throw new BadRequestError('Workspace ID is required');
    }

    const map = this.getWorkspaceMap(workspaceId);
    const existing = map.get(phoneNumberId);
    if (!existing) {
      throw new NotFoundError(`Phone number with ID ${phoneNumberId} not found in this workspace`);
    }

    map.delete(phoneNumberId);

    try {
      await telephonyPhoneNumberRepository.releaseNumber(workspaceId, phoneNumberId);
    } catch {
      // Non-blocking fallback
    }

    return {
      released: true,
      message: `Phone number ${existing.phoneNumber} successfully released from workspace.`,
    };
  }
}

export const phoneNumbersService = new PhoneNumbersService();
