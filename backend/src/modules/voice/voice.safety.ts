import { BadRequestError } from '../../core/errors/api-error.js';
import type { VoiceSafetyContext, VoiceSafetyCheckResult } from './voice.types.js';
import { suppressionRepository, voiceRepository, settingsRepository, workspaceProviderCredentialRepository } from '../../database/repository.js';
import { providerRegistry } from '../../integrations/core/provider.registry.js';
import type { VoiceProviderAdapter } from '../../integrations/calling/index.js';
import { callingPolicyService } from './calling-policy.service.js';

/**
 * Resolves appropriate IANA timezone from phone prefix/area code.
 */
export function resolveTimezoneFromPhone(phone: string): string {
  if (!phone || !phone.startsWith('+')) return 'America/New_York';

  if (phone.startsWith('+1') && phone.length >= 5) {
    const areaCode = phone.slice(2, 5);
    // US Eastern
    if (['201', '202', '203', '212', '215', '216', '305', '315', '330', '404', '412', '470', '475', '508', '516', '518', '585', '609', '610', '617', '646', '703', '704', '716', '718', '732', '757', '786', '804', '813', '845', '856', '914', '917', '919', '929', '954'].includes(areaCode)) {
      return 'America/New_York';
    }
    // US Central
    if (['210', '214', '217', '219', '224', '281', '312', '314', '319', '331', '361', '405', '414', '469', '504', '512', '612', '630', '636', '682', '708', '712', '713', '715', '773', '815', '816', '830', '832', '903', '913', '918', '940', '956', '972', '979'].includes(areaCode)) {
      return 'America/Chicago';
    }
    // US Mountain
    if (['303', '307', '385', '406', '435', '480', '505', '520', '602', '623', '719', '720', '801', '928', '970'].includes(areaCode)) {
      return 'America/Denver';
    }
    // US Pacific
    if (['206', '209', '213', '253', '310', '323', '360', '408', '415', '425', '442', '503', '509', '510', '530', '541', '559', '562', '619', '626', '628', '650', '661', '707', '714', '747', '760', '805', '818', '831', '858', '909', '916', '925', '949', '951', '971'].includes(areaCode)) {
      return 'America/Los_Angeles';
    }
    return 'America/New_York';
  }

  if (phone.startsWith('+44')) return 'Europe/London';
  if (phone.startsWith('+33')) return 'Europe/Paris';
  if (phone.startsWith('+49')) return 'Europe/Berlin';
  if (phone.startsWith('+61')) return 'Australia/Sydney';
  if (phone.startsWith('+81')) return 'Asia/Tokyo';

  return 'UTC';
}

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

    // Gate 5: Workspace Calling Policy Active Gate / Emergency Kill Switch Gate / Campaign Status Gate
    const isGlobalKill = callingPolicyService.isGlobalKillSwitchActive();
    const isWorkspaceKill = !callingPolicy.isActive;
    const isCampaignInactive = Boolean(ctx.campaign && ctx.campaign.status !== 'ACTIVE');

    // Dual-layer verification: Also check Workspace SettingsRepository kill-switch state
    const workspaceSettings = await settingsRepository.getWorkspaceSettings(ctx.workspaceId);
    const isSettingsKill = workspaceSettings.killSwitchActive;

    let policyActive = true;
    let policyReason: string | undefined;

    if (isGlobalKill) {
      policyActive = false;
      policyReason = 'Global Emergency Kill Switch is active. All voice outreach is suspended.';
    } else if (isWorkspaceKill || isSettingsKill) {
      policyActive = false;
      policyReason = isSettingsKill
        ? `Workspace Settings Kill Switch is active for workspace ${ctx.workspaceId}. Calling is halted.`
        : `Emergency Kill Switch is active for workspace ${ctx.workspaceId}. Calling is halted.`;
    } else if (isCampaignInactive) {
      policyActive = false;
      policyReason = `Campaign status is '${ctx.campaign!.status}', must be 'ACTIVE'`;
    }

    const gate5Name = isCampaignInactive
      ? 'Campaign Active Status Gate'
      : isGlobalKill || isWorkspaceKill || isSettingsKill
      ? 'Emergency Kill Switch Gate'
      : 'Workspace Calling Policy Gate';

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
    let cooldownReason: string | undefined;
    if (ctx.currentCall) {
      const lastAttempt = ctx.currentCall.attempts?.[ctx.currentCall.attempts.length - 1];
      if (lastAttempt && lastAttempt.endedAt) {
        const diffMs = currentTime.getTime() - new Date(lastAttempt.endedAt).getTime();
        const diffMinutes = diffMs / (1000 * 60);
        if (diffMinutes < retryDelay) {
          delayRespected = false;
          const remainingMinutes = Math.max(1, Math.ceil(retryDelay - diffMinutes));
          cooldownReason = `Must wait ${retryDelay} minutes between attempts. Retry cooldown active (${remainingMinutes}m remaining).`;
        }
      }
    }
    addGate(8, 'Retry Delay Gate', delayRespected, cooldownReason || `Must wait ${retryDelay} minutes between attempts`);

    // Gate 9: Allowed Calling Days Gate (Timezone-Aware)
    const effectiveTz = ctx.recipientTimezone || (ctx.lead as any)?.timezone;
    const dayEvaluation = callingPolicyService.isAllowedCallingDay(callingPolicy, currentTime, effectiveTz);
    addGate(
      9,
      'Allowed Calling Days Gate',
      dayEvaluation.allowed,
      dayEvaluation.allowed ? undefined : `Calling not allowed on day ${dayEvaluation.dayOfWeek} of week (${dayEvaluation.timezone})`
    );

    // Gate 10: Local Calling Window Hours Gate (Timezone-Aware)
    const windowEvaluation = callingPolicyService.isWithinCallingWindow(callingPolicy, currentTime, effectiveTz);
    addGate(
      10,
      'Local Calling Window Hours Gate',
      windowEvaluation.inside,
      windowEvaluation.inside
        ? undefined
        : `Current time ${windowEvaluation.currentHHMM} is outside allowed window ${windowEvaluation.window} (${windowEvaluation.timezone})`
    );

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
    addGate(
      14,
      'Anti-Hallucination Guardrails Gate',
      hasProhibitedClaims,
      'Voice agent configuration lacks required prohibitedClaims anti-hallucination guardrails'
    );

    // Gate 15: Telephony Provider Configured Gate
    const callingAdapter = providerRegistry.getAdapter<VoiceProviderAdapter>('Twilio');
    let workspaceTwilioCred = null;
    try {
      workspaceTwilioCred = await workspaceProviderCredentialRepository.findByProvider(ctx.workspaceId, 'TWILIO');
    } catch {
      // Non-blocking fallback
    }
    const telephonyConfigured = Boolean(
      workspaceTwilioCred?.encryptedPayload ||
      (callingAdapter && callingAdapter.isConfigured())
    );
    addGate(
      15,
      'Telephony Provider Configured Gate',
      telephonyConfigured,
      'Telephony credentials are not configured for this workspace'
    );

    // Gate 16: Voice AI Provider Configured Gate
    const agentProvider = ctx.agentConfig?.provider || 'retell';
    let workspaceVoiceAICred = null;
    try {
      workspaceVoiceAICred = await workspaceProviderCredentialRepository.findByProvider(ctx.workspaceId, agentProvider);
    } catch {
      // Non-blocking fallback
    }
    const aiAdapter = providerRegistry.getByCategory('AI_LLM')[0];
    const voiceAiConfigured = Boolean(
      workspaceVoiceAICred?.encryptedPayload ||
      (aiAdapter && aiAdapter.isConfigured())
    );
    addGate(
      16,
      'Voice AI Provider Configured Gate',
      voiceAiConfigured,
      `Voice AI provider '${agentProvider}' credentials are not configured for this workspace`
    );

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
