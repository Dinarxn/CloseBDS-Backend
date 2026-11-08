import { voiceRepository } from '../../database/repository.js';
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
    return {
      released: true,
      message: `Phone number ${existing.phoneNumber} successfully released from workspace.`,
    };
  }
}

export const phoneNumbersService = new PhoneNumbersService();
