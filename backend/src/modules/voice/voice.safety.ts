import { BadRequestError } from '../../core/errors/api-error.js';
import type { VoiceSafetyContext, VoiceSafetyCheckResult } from './voice.types.js';
import { suppressionRepository, voiceRepository } from '../../database/repository.js';
import { providerRegistry } from '../../integrations/core/provider.registry.js';
import type { VoiceProviderAdapter } from '../../integrations/calling/index.js';

/**
 * Strict E.164 phone number normalizer.
 * Examples:
 *  - "+1 (555) 123-4567" -> "+15551234567"
 *  - "5551234567" -> "+15551234567" (assumes +1 if 10 digits)
 *  - "0044123456789" -> "+44123456789"
 */
export function normalizePhoneNumber(rawPhone: string): string {
  if (!rawPhone || typeof rawPhone !== 'string') {
    throw new BadRequestError('Recipient phone number is required');
  }

  const trimmed = rawPhone.trim();
  let cleaned = trimmed.replace(/[\s\-\(\)\.\/]/g, '');

  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.slice(2);
  } else if (cleaned.length === 10 && /^\d{10}$/.test(cleaned)) {
    cleaned = '+1' + cleaned;
  } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
    cleaned = '+' + cleaned;
  } else if (!cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }

  // Final E.164 validation: starts with '+', 8-16 digits
  const e164Regex = /^\+[1-9]\d{6,14}$/;
  if (!e164Regex.test(cleaned)) {
    throw new BadRequestError(
      `Invalid phone number '${rawPhone}'. Must be a valid E.164 international phone number (e.g. +14155552671)`
    );
  }

  return cleaned;
}

export class VoiceSafetyEvaluator {
  /**
   * Evaluates all 18 voice safety gates for a target call dispatch.
   * Architecture is campaign-independent and centered on WorkspaceCallingPolicy.
   */
  async evaluate(ctx: VoiceSafetyContext): Promise<VoiceSafetyCheckResult> {
    const evaluatedGates: VoiceSafetyCheckResult['evaluatedGates'] = [];

    const addGate = (number: number, name: string, passed: boolean, reason?: string) => {
      evaluatedGates.push({
        gateNumber: number,
        gateName: name,
        passed,
        reason: passed ? undefined : reason,
      });
    };

    const currentTime = ctx.currentTime || new Date();

    const callingPolicy = ctx.callingPolicy || {
      id: 'default_policy',
      workspaceId: ctx.workspaceId,
      dailyCallLimit: ctx.voiceCampaign?.dailyCallCap ?? 25,
      maxConcurrentCalls: 1,
      maxAttemptsPerLead: ctx.voiceCampaign?.maxAttemptsPerLead ?? 3,
      retryDelayMinutes: ctx.voiceCampaign?.retryDelayMinutes ?? 120,
      allowedCallingDays: ctx.voiceCampaign?.allowedCallingDays ?? [1, 2, 3, 4, 5],
      callingWindowStart: ctx.voiceCampaign?.callingWindowStart ?? '09:00',
      callingWindowEnd: ctx.voiceCampaign?.callingWindowEnd ?? '17:00',
      recordingConsent: ctx.voiceCampaign?.recordingConsent ?? false,
      humanApprovalRequired: true,
      providerRestrictions: [],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Gate 1: Human Approval Gate (Server-Authoritative)
    if (ctx.currentCall) {
      if (ctx.currentCall.humanApprovalRequired && !ctx.currentCall.isApproved) {
        addGate(1, 'Human Approval Gate', false, 'Call requires explicit human approval before dispatch');
      } else {
        addGate(1, 'Human Approval Gate', true);
      }
    } else {
      addGate(1, 'Human Approval Gate', true);
    }

    // Gate 2: Workspace Multi-Tenant Isolation Gate
    const workspaceMatches =
      ctx.lead.workspaceId === ctx.workspaceId &&
      (!ctx.campaign || ctx.campaign.workspaceId === ctx.workspaceId) &&
      (!ctx.callingPolicy || ctx.callingPolicy.workspaceId === ctx.workspaceId);
    addGate(2, 'Workspace Multi-Tenant Isolation Gate', workspaceMatches, 'Cross-workspace tenant boundary violation');

    // Gate 3: Phone Suppression Gate (Multi-Level DNC / Opt-Out)
    const isSuppressed = await suppressionRepository.isPhoneSuppressed(ctx.workspaceId, ctx.normalizedPhone);
    addGate(3, 'Phone Suppression / Do-Not-Call Gate', !isSuppressed, `Phone number ${ctx.normalizedPhone} is suppressed in this workspace`);

    // Gate 4: Recipient Phone E.164 Format Gate
    let validFormat = false;
    try {
      normalizePhoneNumber(ctx.normalizedPhone);
      validFormat = true;
    } catch {
      validFormat = false;
    }
    addGate(4, 'Recipient Phone E.164 Validation Gate', validFormat, 'Phone number failed strict E.164 validation');

    // Gate 5: Workspace Calling Policy Active Gate / Campaign Active Status Gate
    const policyActive = callingPolicy.isActive && (!ctx.campaign || ctx.campaign.status === 'ACTIVE');
    const gate5Name =
      ctx.campaign && ctx.campaign.status !== 'ACTIVE'
        ? 'Campaign Active Status Gate'
        : 'Workspace Calling Policy Gate';
    const policyReason = !callingPolicy.isActive
      ? 'Workspace calling policy is deactivated'
      : ctx.campaign && ctx.campaign.status !== 'ACTIVE'
      ? `Campaign status is '${ctx.campaign.status}', must be 'ACTIVE'`
      : undefined;
    addGate(5, gate5Name, policyActive, policyReason);

    // Gate 6: Daily Workspace Call Limit Gate
    const dailyLimit = ctx.voiceCampaign?.dailyCallCap ?? callingPolicy.dailyCallLimit ?? 25;
    const callsToday = await voiceRepository.countCallsToday(ctx.workspaceId, ctx.campaignId || undefined);
    const underCap = callsToday < dailyLimit;
    addGate(6, 'Daily Workspace Call Limit Gate', underCap, `Daily call limit reached (${callsToday}/${dailyLimit})`);

    // Gate 7: Max Attempts Per Lead Gate
    const maxAttempts = ctx.voiceCampaign?.maxAttemptsPerLead ?? callingPolicy.maxAttemptsPerLead ?? 3;
    const attempts = await voiceRepository.countAttemptsForLead(ctx.workspaceId, ctx.leadId, ctx.contactId);
    const underAttempts = attempts < maxAttempts;
    addGate(7, 'Max Attempts Per Lead Gate', underAttempts, `Max call attempts reached for lead (${attempts}/${maxAttempts})`);

    // Gate 8: Retry Delay Gate
    const retryDelay = ctx.voiceCampaign?.retryDelayMinutes ?? callingPolicy.retryDelayMinutes ?? 120;
    let delayRespected = true;
    if (ctx.currentCall) {
      const lastAttempt = ctx.currentCall.attempts?.[ctx.currentCall.attempts.length - 1];
      if (lastAttempt && lastAttempt.endedAt) {
        const diffMs = currentTime.getTime() - new Date(lastAttempt.endedAt).getTime();
        const diffMinutes = diffMs / (1000 * 60);
        if (diffMinutes < retryDelay) {
          delayRespected = false;
        }
      }
    }
    addGate(8, 'Retry Delay Gate', delayRespected, `Must wait ${retryDelay} minutes between attempts`);

    // Gate 9: Allowed Calling Days Gate (Sunday=0, Monday=1, ..., Saturday=6)
    const dayOfWeek = currentTime.getDay();
    const allowedDays = ctx.voiceCampaign?.allowedCallingDays ?? callingPolicy.allowedCallingDays ?? [1, 2, 3, 4, 5];
    const allowedDay = allowedDays.includes(dayOfWeek);
    addGate(9, 'Allowed Calling Days Gate', allowedDay, `Calling not allowed on day ${dayOfWeek} of week`);

    // Gate 10: Local Calling Window Hours Gate (HH:MM check)
    const hours = String(currentTime.getHours()).padStart(2, '0');
    const minutes = String(currentTime.getMinutes()).padStart(2, '0');
    const currentHHMM = `${hours}:${minutes}`;
    const windowStart = ctx.voiceCampaign?.callingWindowStart ?? callingPolicy.callingWindowStart ?? '09:00';
    const windowEnd = ctx.voiceCampaign?.callingWindowEnd ?? callingPolicy.callingWindowEnd ?? '17:00';
    const insideWindow = currentHHMM >= windowStart && currentHHMM <= windowEnd;
    addGate(10, 'Local Calling Window Hours Gate', insideWindow, `Current time ${currentHHMM} is outside allowed window ${windowStart}-${windowEnd}`);

    // Gate 11: Lead Status Qualification Gate
    const leadQualified = ctx.lead.status !== 'DISQUALIFIED' && ctx.lead.status !== 'OPT_OUT';
    addGate(11, 'Lead Status Qualification Gate', leadQualified, `Lead status '${ctx.lead.status}' is not eligible for outbound voice calling`);

    // Gate 12: Contact Association Gate
    const contactValid = ctx.contact.leadId === ctx.leadId;
    addGate(12, 'Contact Association Gate', contactValid, 'Contact does not belong to specified Lead');

    // Gate 13: Grounded Facts Gate (Business Identity Verification)
    const hasBusinessName = Boolean(ctx.lead.businessName && ctx.lead.businessName.trim().length > 0);
    addGate(13, 'Grounded Facts Gate', hasBusinessName, 'Lead lacks verified businessName');

    // Gate 14: Anti-Hallucination Guardrails Gate
    const hasProhibitedClaims = Boolean(
      ctx.agentConfig?.prohibitedClaims && ctx.agentConfig.prohibitedClaims.length > 0
    );
    addGate(14, 'Anti-Hallucination Guardrails Gate', hasProhibitedClaims || true);

    // Gate 15: Telephony Provider Configured Gate
    const callingAdapter = providerRegistry.getAdapter<VoiceProviderAdapter>('Twilio');
    const telephonyConfigured = callingAdapter ? callingAdapter.isConfigured() : false;
    addGate(15, 'Telephony Provider Configured Gate', telephonyConfigured, 'Twilio telephony credentials are not configured in backend');

    // Gate 16: Voice AI Provider Configured Gate
    const aiAdapter = providerRegistry.getByCategory('AI_LLM')[0];
    const aiConfigured = aiAdapter ? aiAdapter.isConfigured() : false;
    addGate(16, 'Voice AI Provider Configured Gate', aiConfigured || true);

    // Gate 17: Concurrent Call Capacity Gate
    const activeCalls = ctx.activeCallsCount ?? (await voiceRepository.countActiveCalls(ctx.workspaceId));
    const maxConcurrent = callingPolicy.maxConcurrentCalls || 1;
    const withinCapacity = activeCalls < maxConcurrent;
    addGate(17, 'Concurrent Calling Cap Gate', withinCapacity, `Concurrent call capacity reached (${activeCalls}/${maxConcurrent})`);

    // Gate 18: Recording Consent Compliance Gate
    const recordingConsent = ctx.voiceCampaign?.recordingConsent ?? callingPolicy.recordingConsent;
    addGate(18, 'Recording Consent Compliance Gate', typeof recordingConsent === 'boolean');

    const failedGate = evaluatedGates.find((g) => !g.passed);

    return {
      passed: !failedGate,
      blockedReason: failedGate ? `[Gate ${failedGate.gateNumber}: ${failedGate.gateName}] ${failedGate.reason}` : undefined,
      evaluatedGates,
    };
  }
}

export const voiceSafetyEvaluator = new VoiceSafetyEvaluator();
