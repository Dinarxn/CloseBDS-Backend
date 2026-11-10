import {
  encryptCredential,
  decryptCredential,
  maskTwilioSid,
  maskSecret,
  maskPhoneNumber,
  type EncryptedCredentialPayload,
} from '../../security/credential-vault.js';
import { TwilioTelephonyAdapter } from '../../integrations/calling/twilio.adapter.js';
import { BadRequestError } from '../../core/errors/api-error.js';
import { workspaceProviderCredentialRepository } from '../../database/repository.js';
import type {
  MaskedTwilioCredentials,
  ProviderConnectionState,
  ProviderVerificationState,
} from './voice.types.js';

export interface StoredTelephonyCredentials {
  encryptedSid: EncryptedCredentialPayload;
  encryptedToken: EncryptedCredentialPayload;
  primaryPhoneNumber?: string;
  verificationStatus: ProviderVerificationState;
  updatedAt: Date;
}

export interface SaveTelephonyCredentialsInput {
  accountSid: string;
  authToken: string;
  primaryPhoneNumber?: string;
}

/**
 * Telephony Service.
 * Manages server-side encrypted credentials, connection verification, and adapter resolution.
 * Strictly guarantees client masking (zero raw secret disclosure).
 */
export class TelephonyService {
  // Tenant-scoped encrypted credential vault store: workspaceId -> StoredTelephonyCredentials
  private credentialVault: Map<string, StoredTelephonyCredentials> = new Map();
  // Cached active telephony adapters keyed by workspaceId
  private adapterCache: Map<string, TwilioTelephonyAdapter> = new Map();

  constructor() {}

  /**
   * Encrypts and persists Twilio credentials using AES-256-GCM.
   * Tests connection immediately and returns strictly masked credentials for client display.
   */
  async saveCredentials(
    workspaceId: string,
    input: SaveTelephonyCredentialsInput
  ): Promise<MaskedTwilioCredentials> {
    if (!workspaceId) {
      throw new BadRequestError('Workspace ID is required');
    }

    const { accountSid, authToken, primaryPhoneNumber } = input;
    if (!accountSid || accountSid.trim().length === 0) {
      throw new BadRequestError('Twilio Account SID is required');
    }
    if (!authToken || authToken.trim().length === 0) {
      throw new BadRequestError('Twilio Auth Token is required');
    }

    const trimmedSid = accountSid.trim();
    const trimmedToken = authToken.trim();
    const trimmedPhone = primaryPhoneNumber?.trim();

    if (!trimmedSid.startsWith('AC')) {
      throw new BadRequestError('Invalid Twilio Account SID format. SID must start with "AC".');
    }

    // Encrypt both secrets server-side using AES-256-GCM authenticated cipher
    const encryptedSid = encryptCredential(trimmedSid);
    const encryptedToken = encryptCredential(trimmedToken);

    // Test connection against Twilio API
    const adapter = new TwilioTelephonyAdapter({
      accountSid: trimmedSid,
      authToken: trimmedToken,
      phoneNumber: trimmedPhone,
    });

    const testResult = await adapter.testConnection();
    const verificationStatus: ProviderVerificationState = testResult.connected ? 'VERIFIED' : 'UNVERIFIED';

    const record: StoredTelephonyCredentials = {
      encryptedSid,
      encryptedToken,
      primaryPhoneNumber: trimmedPhone,
      verificationStatus,
      updatedAt: new Date(),
    };

    this.credentialVault.set(workspaceId, record);
    this.adapterCache.set(workspaceId, adapter);

    // Persist to WorkspaceProviderCredential database table with AES-256-GCM ciphertext
    try {
      await workspaceProviderCredentialRepository.upsert(workspaceId, 'TWILIO', {
        encryptedPayload: {
          accountSid: encryptedSid,
          authToken: encryptedToken,
          primaryPhoneNumber: trimmedPhone,
        } as any,
        maskedDisplay: {
          accountSid: maskTwilioSid(trimmedSid),
          authTokenMasked: maskSecret(trimmedToken),
          primaryPhoneNumber: trimmedPhone ? maskPhoneNumber(trimmedPhone) : undefined,
        },
        connectionStatus: testResult.status,
        accountDetails: testResult.accountDetails,
      });
    } catch {
      // Non-blocking fallback for offline testing environments
    }

    return {
      accountSid: maskTwilioSid(trimmedSid),
      authTokenMasked: maskSecret(trimmedToken),
      primaryPhoneNumber: trimmedPhone ? maskPhoneNumber(trimmedPhone) : undefined,
      isConfigured: true,
      verificationStatus,
    };
  }

  /**
   * Retrieves masked telephony settings and live connection state for a workspace.
   * Returns ONLY masked credentials (`maskTwilioSid`, `maskSecret`). Never exposes plaintext tokens.
   */
  async getSettings(workspaceId: string): Promise<
    MaskedTwilioCredentials & {
      connectionStatus: ProviderConnectionState;
      message: string;
      accountDetails?: Record<string, unknown>;
    }
  > {
    const stored = this.credentialVault.get(workspaceId);

    if (stored) {
      try {
        const decryptedSid = decryptCredential(stored.encryptedSid);
        const decryptedToken = decryptCredential(stored.encryptedToken);

        const adapter = this.getAdapterForWorkspace(workspaceId);
        const connTest = await adapter.testConnection();

        return {
          accountSid: maskTwilioSid(decryptedSid),
          authTokenMasked: maskSecret(decryptedToken),
          primaryPhoneNumber: stored.primaryPhoneNumber ? maskPhoneNumber(stored.primaryPhoneNumber) : undefined,
          isConfigured: true,
          verificationStatus: connTest.connected ? 'VERIFIED' : 'UNVERIFIED',
          connectionStatus: connTest.status,
          message: connTest.message,
          accountDetails: connTest.accountDetails,
        };
      } catch {
        return {
          accountSid: 'AC••••••••',
          authTokenMasked: '••••••••',
          primaryPhoneNumber: stored.primaryPhoneNumber ? maskPhoneNumber(stored.primaryPhoneNumber) : undefined,
          isConfigured: true,
          verificationStatus: 'UNVERIFIED',
          connectionStatus: 'CONNECTION_FAILED',
          message: 'Failed to decrypt workspace credentials or connection verification timed out.',
        };
      }
    }

    // Check persistent database table
    try {
      const dbCred = await workspaceProviderCredentialRepository.findByProvider(workspaceId, 'TWILIO');
      if (dbCred && dbCred.encryptedPayload) {
        const payload = dbCred.encryptedPayload as any;
        if (payload.accountSid && payload.authToken) {
          const decryptedSid = decryptCredential(payload.accountSid);
          const decryptedToken = decryptCredential(payload.authToken);
          const adapter = new TwilioTelephonyAdapter({
            accountSid: decryptedSid,
            authToken: decryptedToken,
            phoneNumber: payload.primaryPhoneNumber,
          });
          this.adapterCache.set(workspaceId, adapter);
          this.credentialVault.set(workspaceId, {
            encryptedSid: payload.accountSid,
            encryptedToken: payload.authToken,
            primaryPhoneNumber: payload.primaryPhoneNumber,
            verificationStatus: dbCred.connectionStatus === 'CONNECTED' ? 'VERIFIED' : 'UNVERIFIED',
            updatedAt: dbCred.updatedAt,
          });

          const connTest = await adapter.testConnection();
          return {
            accountSid: maskTwilioSid(decryptedSid),
            authTokenMasked: maskSecret(decryptedToken),
            primaryPhoneNumber: payload.primaryPhoneNumber ? maskPhoneNumber(payload.primaryPhoneNumber) : undefined,
            isConfigured: true,
            verificationStatus: connTest.connected ? 'VERIFIED' : 'UNVERIFIED',
            connectionStatus: connTest.status,
            message: connTest.message,
            accountDetails: connTest.accountDetails,
          };
        }
      }
    } catch {
      // Non-blocking fallback
    }

    // Fallback: Check environment variables
    const envSid = process.env.TWILIO_ACCOUNT_SID;
    const envToken = process.env.TWILIO_AUTH_TOKEN;
    const envPhone = process.env.TWILIO_PHONE_NUMBER;

    if (envSid && envToken && envSid.trim().length > 0 && !envSid.includes('placeholder')) {
      const adapter = new TwilioTelephonyAdapter({
        accountSid: envSid,
        authToken: envToken,
        phoneNumber: envPhone,
      });

      const connTest = await adapter.testConnection();

      return {
        accountSid: maskTwilioSid(envSid),
        authTokenMasked: maskSecret(envToken),
        primaryPhoneNumber: envPhone ? maskPhoneNumber(envPhone) : undefined,
        isConfigured: true,
        verificationStatus: connTest.connected ? 'VERIFIED' : 'UNVERIFIED',
        connectionStatus: connTest.status,
        message: connTest.message,
        accountDetails: connTest.accountDetails,
      };
    }

    return {
      accountSid: '',
      authTokenMasked: '',
      primaryPhoneNumber: undefined,
      isConfigured: false,
      verificationStatus: 'UNVERIFIED',
      connectionStatus: 'NOT_CONFIGURED',
      message: 'Twilio telephony credentials are not configured.',
    };
  }

  /**
   * Tests connection using stored workspace credentials or ephemeral test credentials.
   */
  async testConnection(
    workspaceId: string,
    credentialsOverride?: { accountSid?: string; authToken?: string }
  ): Promise<{
    connected: boolean;
    status: ProviderConnectionState;
    message: string;
    accountDetails?: Record<string, unknown>;
  }> {
    if (credentialsOverride?.accountSid && credentialsOverride?.authToken) {
      const tempAdapter = new TwilioTelephonyAdapter({
        accountSid: credentialsOverride.accountSid,
        authToken: credentialsOverride.authToken,
      });
      return tempAdapter.testConnection();
    }

    const stored = this.credentialVault.get(workspaceId);
    if (!stored) {
      // Check environment variables as fallback
      const envSid = process.env.TWILIO_ACCOUNT_SID;
      const envToken = process.env.TWILIO_AUTH_TOKEN;
      if (envSid && envToken && envSid.trim().length > 0) {
        const adapter = new TwilioTelephonyAdapter({ accountSid: envSid, authToken: envToken });
        return adapter.testConnection();
      }

      return {
        connected: false,
        status: 'NOT_CONFIGURED',
        message: 'No Twilio credentials configured for this workspace.',
      };
    }

    const sid = decryptCredential(stored.encryptedSid);
    const token = decryptCredential(stored.encryptedToken);

    const adapter = new TwilioTelephonyAdapter({
      accountSid: sid,
      authToken: token,
      phoneNumber: stored.primaryPhoneNumber,
    });

    return adapter.testConnection();
  }

  /**
   * Retrieves or instantiates the TwilioTelephonyAdapter with decrypted credentials for internal backend use.
   * Strictly internal — NEVER exposed over an external HTTP response.
   */
  getAdapterForWorkspace(workspaceId: string): TwilioTelephonyAdapter {
    const cached = this.adapterCache.get(workspaceId);
    if (cached) return cached;

    const stored = this.credentialVault.get(workspaceId);
    if (stored) {
      const sid = decryptCredential(stored.encryptedSid);
      const token = decryptCredential(stored.encryptedToken);
      const adapter = new TwilioTelephonyAdapter({
        accountSid: sid,
        authToken: token,
        phoneNumber: stored.primaryPhoneNumber,
      });
      this.adapterCache.set(workspaceId, adapter);
      return adapter;
    }

    // Default adapter using environment configuration
    const adapter = new TwilioTelephonyAdapter();
    this.adapterCache.set(workspaceId, adapter);
    return adapter;
  }

  /**
   * Retrieves decrypted credentials internally for backend operations (e.g. signature verification).
   * Strictly internal — NEVER exposed over an external HTTP response.
   */
  getDecryptedCredentials(workspaceId: string): { accountSid: string; authToken: string; phoneNumber?: string } | null {
    const stored = this.credentialVault.get(workspaceId);
    if (stored) {
      return {
        accountSid: decryptCredential(stored.encryptedSid),
        authToken: decryptCredential(stored.encryptedToken),
        phoneNumber: stored.primaryPhoneNumber,
      };
    }

    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      return {
        accountSid: process.env.TWILIO_ACCOUNT_SID,
        authToken: process.env.TWILIO_AUTH_TOKEN,
        phoneNumber: process.env.TWILIO_PHONE_NUMBER,
      };
    }

    return null;
  }
}

export const telephonyService = new TelephonyService();
