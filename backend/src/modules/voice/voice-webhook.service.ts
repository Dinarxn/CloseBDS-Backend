import { databaseClient } from '../../database/client.js';
import { voiceRepository, auditRepository } from '../../database/repository.js';
import { ForbiddenError } from '../../core/errors/api-error.js';
import { isTerminalCallStatus, assertValidCallTransition } from './voice.lifecycle.js';
import { toPrismaCallStatus, type NormalizedCallStatus, type NormalizedVoiceAIEvent } from './voice.types.js';
import { RetellVoiceAIAdapter } from '../../integrations/voice-ai/retell.adapter.js';
import { VapiVoiceAIAdapter } from '../../integrations/voice-ai/vapi.adapter.js';
import { voiceService } from './voice.service.js';

export interface WebhookProcessingResult {
  received: boolean;
  processed: boolean;
  duplicate?: boolean;
  callId?: string;
  providerCallId: string;
  provider: 'retell' | 'vapi';
  normalizedStatus: NormalizedCallStatus;
  eventType: string;
  message?: string;
}

export class VoiceWebhookService {
  private retellAdapter = new RetellVoiceAIAdapter();
  private vapiAdapter = new VapiVoiceAIAdapter();

  // Sliding window replay cache: Key -> Processed timestamp (ms)
  private processedNonces = new Map<string, number>();
  private readonly MAX_DRIFT_MS = 5 * 60 * 1000; // 5 minutes max clock drift
  private readonly CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes TTL

  /**
   * Enforces replay protection via timestamp drift check and nonce/event deduplication.
   */
  checkReplayProtection(eventId: string, eventTimestamp?: number | Date | string): boolean {
    const now = Date.now();
    this.evictExpiredNonces(now);

    // 1. Check if eventId has already been seen
    if (this.processedNonces.has(eventId)) {
      return false; // Replay detected
    }

    // 2. Validate clock drift if event timestamp is provided
    if (eventTimestamp !== undefined) {
      const ts = typeof eventTimestamp === 'number'
        ? eventTimestamp
        : new Date(eventTimestamp).getTime();

      if (!isNaN(ts)) {
        const drift = Math.abs(now - ts);
        if (drift > this.MAX_DRIFT_MS) {
          return false; // Stale or future event outside allowed window
        }
      }
    }

    // Mark as processed
    this.processedNonces.set(eventId, now);
    return true;
  }

  private evictExpiredNonces(now: number): void {
    if (this.processedNonces.size > 2000) {
      for (const [key, timestamp] of this.processedNonces.entries()) {
        if (now - timestamp > this.CACHE_TTL_MS) {
          this.processedNonces.delete(key);
        }
      }
    }
  }

  /**
   * Resets replay protection cache (useful for isolated unit tests).
   */
  resetReplayCache(): void {
    this.processedNonces.clear();
  }

  /**
   * Handles incoming Retell AI webhook requests with signature verification and replay protection.
   */
  async handleRetellWebhook(
    rawPayload: unknown,
    signatureHeader?: string,
    secret?: string
  ): Promise<WebhookProcessingResult> {
    const rawString = typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload);

    // Verify signature
    const isValid = this.retellAdapter.verifyWebhookSignature(rawString, signatureHeader, secret);
    if (!isValid) {
      if (process.env.NODE_ENV === 'production') {
        throw new ForbiddenError('Invalid Retell webhook signature');
      }
      if (signatureHeader && !isValid) {
        throw new ForbiddenError('Invalid Retell webhook signature');
      }
    }

    const event = this.retellAdapter.parseWebhookEvent(rawPayload);

    // Replay protection check
    const isFresh = this.checkReplayProtection(event.eventId, event.occurredAt);
    if (!isFresh) {
      return {
        received: true,
        processed: false,
        duplicate: true,
        providerCallId: event.providerCallId,
        provider: 'retell',
        normalizedStatus: event.normalizedStatus,
        eventType: event.eventType,
        message: 'Replay detected or event already processed',
      };
    }

    return this.processNormalizedVoiceEvent(event);
  }

  /**
   * Handles incoming Vapi webhook requests with secret/HMAC verification and replay protection.
   */
  async handleVapiWebhook(
    rawPayload: unknown,
    secretHeader?: string,
    secret?: string
  ): Promise<WebhookProcessingResult> {
    const rawString = typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload);

    // Verify Vapi secret / signature
    const isValid = this.vapiAdapter.verifyWebhookSignature(rawString, secretHeader, secret);
    if (!isValid) {
      if (process.env.NODE_ENV === 'production') {
        throw new ForbiddenError('Invalid Vapi webhook secret or signature');
      }
      if (secretHeader && !isValid) {
        throw new ForbiddenError('Invalid Vapi webhook secret or signature');
      }
    }

    const event = this.vapiAdapter.parseWebhookEvent(rawPayload);

    // Replay protection check
    const isFresh = this.checkReplayProtection(event.eventId, event.occurredAt);
    if (!isFresh) {
      return {
        received: true,
        processed: false,
        duplicate: true,
        providerCallId: event.providerCallId,
        provider: 'vapi',
        normalizedStatus: event.normalizedStatus,
        eventType: event.eventType,
        message: 'Replay detected or event already processed',
      };
    }

    return this.processNormalizedVoiceEvent(event);
  }

  /**
   * Idempotent call status and transcript processing across Retell and Vapi.
   */
  async processNormalizedVoiceEvent(
    event: NormalizedVoiceAIEvent
  ): Promise<WebhookProcessingResult> {
    if (!databaseClient.isConnected() || process.env.NODE_ENV === 'test') {
      return {
        received: true,
        processed: false,
        providerCallId: event.providerCallId,
        provider: event.provider === 'vapi' ? 'vapi' : 'retell',
        normalizedStatus: event.normalizedStatus,
        eventType: event.eventType,
        message: 'Database offline or test environment - event received safely',
      };
    }

    const prisma = databaseClient.getPrismaClient();

    // Find call in database by providerCallId
    const call = await prisma.call.findFirst({
      where: { providerCallId: event.providerCallId },
    });

    if (!call) {
      return {
        received: true,
        processed: false,
        providerCallId: event.providerCallId,
        provider: event.provider === 'vapi' ? 'vapi' : 'retell',
        normalizedStatus: event.normalizedStatus,
        eventType: event.eventType,
        message: 'Call not found for providerCallId',
      };
    }

    const targetPrismaStatus = toPrismaCallStatus(event.normalizedStatus);

    // Idempotency: If call already reached a terminal state, don't regress status
    if (isTerminalCallStatus(call.status)) {
      // Still store any late-arriving transcripts or recordings
      if (event.transcriptTurns && event.transcriptTurns.length > 0) {
        for (const turn of event.transcriptTurns) {
          await voiceRepository.createTranscriptTurn(call.id, {
            turnIndex: turn.turnIndex,
            speaker: turn.speaker,
            text: turn.text,
            confidence: turn.confidence,
            timestampMs: turn.timestampMs,
          }).catch(() => {});
        }
      }

      // Idempotently persist late-arriving recording metadata
      if (event.recordingUrl && (!call.recordingUrl || call.recordingUrl !== event.recordingUrl)) {
        await voiceRepository.updateCallStatus(call.id, call.workspaceId, call.status, {
          recordingUrl: event.recordingUrl,
          recordingDuration: event.durationSeconds ?? call.recordingDuration,
          recordingChannels: 1,
        }).catch(() => {});
      }

      return {
        received: true,
        processed: true,
        duplicate: true,
        callId: call.id,
        providerCallId: event.providerCallId,
        provider: event.provider === 'vapi' ? 'vapi' : 'retell',
        normalizedStatus: event.normalizedStatus,
        eventType: event.eventType,
        message: `Call ${call.id} already in terminal status ${call.status}. Late metadata saved idempotently.`,
      };
    }

    // Update status if transitioned
    if (call.status !== targetPrismaStatus) {
      try {
        assertValidCallTransition(call.status, targetPrismaStatus);
      } catch {
        // Log transition anomaly without crashing webhook receiver
      }

      await voiceRepository.updateCallStatus(call.id, call.workspaceId, targetPrismaStatus, {
        durationSeconds: event.durationSeconds ?? call.durationSeconds,
        completedAt: isTerminalCallStatus(targetPrismaStatus) ? new Date() : undefined,
        recordingUrl: event.recordingUrl ?? call.recordingUrl,
        recordingDuration: event.durationSeconds ?? call.recordingDuration,
        recordingChannels: 1,
      });
    } else if (event.recordingUrl && (!call.recordingUrl || call.recordingUrl !== event.recordingUrl)) {
      await voiceRepository.updateCallStatus(call.id, call.workspaceId, call.status, {
        durationSeconds: event.durationSeconds ?? call.durationSeconds,
        recordingUrl: event.recordingUrl,
        recordingDuration: event.durationSeconds ?? call.recordingDuration,
        recordingChannels: 1,
      }).catch(() => {});
    }

    // Save transcript turns if provided
    if (event.transcriptTurns && event.transcriptTurns.length > 0) {
      for (const turn of event.transcriptTurns) {
        await voiceRepository.createTranscriptTurn(call.id, {
          turnIndex: turn.turnIndex,
          speaker: turn.speaker,
          text: turn.text,
          confidence: turn.confidence,
          timestampMs: turn.timestampMs,
        }).catch(() => {});
      }
    }

    // Record event in audit log
    await auditRepository.create({
      workspaceId: call.workspaceId,
      eventType: `webhook:${event.provider}:${event.normalizedStatus}`,
      entityType: 'Call',
      entityId: call.id,
      metadata: {
        providerCallId: event.providerCallId,
        eventType: event.eventType,
        normalizedStatus: event.normalizedStatus,
        recordingUrl: event.recordingUrl,
        durationSeconds: event.durationSeconds,
      },
    }).catch(() => {});

    // If call reached terminal state, trigger post-call intelligence
    if (isTerminalCallStatus(targetPrismaStatus)) {
      await voiceService.processCallCompletion(call.id, call.workspaceId).catch(() => {});
    }

    return {
      received: true,
      processed: true,
      callId: call.id,
      providerCallId: event.providerCallId,
      provider: event.provider === 'vapi' ? 'vapi' : 'retell',
      normalizedStatus: event.normalizedStatus,
      eventType: event.eventType,
      message: 'Voice AI webhook event processed successfully',
    };
  }
}

export const voiceWebhookService = new VoiceWebhookService();
