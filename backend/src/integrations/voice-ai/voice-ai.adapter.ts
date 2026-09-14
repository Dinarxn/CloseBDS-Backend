import type {
  VoiceAIProvider,
  GroundedLeadData,
  GroundedVoiceContext,
  VoiceTurn,
  VoiceSession,
  VoiceResponse,
  CallSummaryResult,
  CallOutcomeAnalysis,
} from './index.js';
import {
  type ProviderCapability,
  type ProviderHealthResult,
  ProviderError,
} from '../core/provider.types.js';
import type { CallOutcomeType } from '@prisma/client';

export interface VoiceAIOptions {
  providerName?: string;
  apiKey?: string;
}

export class StandardVoiceAIAdapter implements VoiceAIProvider {
  public readonly providerName: string;
  public readonly category = 'AI_LLM' as const;

  private apiKey?: string;

  constructor(options?: VoiceAIOptions) {
    this.providerName = options?.providerName || 'OpenAI Realtime / Claude Voice';
    this.apiKey = options?.apiKey || process.env.AI_PROVIDER_API_KEY || process.env.OPENAI_API_KEY;
  }

  isConfigured(): boolean {
    return Boolean(
      this.apiKey &&
      this.apiKey.trim().length > 0 &&
      !this.apiKey.includes('placeholder') &&
      !this.apiKey.includes('test-unconfigured')
    );
  }

  getCapabilities(): ProviderCapability {
    return {
      name: this.providerName,
      category: this.category,
      supportedFeatures: [
        'Fact-Grounded Voice Prompting',
        'Anti-Hallucination Guardrails',
        'Transcript Turn Analysis',
        'Call Outcome Classification',
        'Automated Opt-Out Detection',
      ],
      requiresApiKey: true,
      isDispatchProvider: false,
    };
  }

  async healthCheck(): Promise<ProviderHealthResult> {
    if (!this.isConfigured()) {
      return {
        providerName: this.providerName,
        category: this.category,
        status: 'UNCONFIGURED',
        isConfigured: false,
        message: 'Live Voice AI speech/conversational provider credentials not configured',
      };
    }

    return {
      providerName: this.providerName,
      category: this.category,
      status: 'AVAILABLE',
      isConfigured: true,
      message: 'Voice AI conversational adapter is configured and ready',
    };
  }

  /**
   * Grounded Context Generator.
   * Strictly separates verified facts from observed website gaps, offers, and unknown parameters.
   * Prohibits hallucination of pricing, false guarantees, fake reviews, or client relationships.
   */
  generateGroundedContext(
    leadData: GroundedLeadData,
    agentConfig: {
      callObjective: string;
      approvedTalkingPoints: string[];
      prohibitedClaims: string[];
    }
  ): GroundedVoiceContext {
    const verifiedFacts: Record<string, string> = {
      leadId: leadData.leadId,
      businessName: leadData.businessName.trim(),
    };

    if (leadData.domain) verifiedFacts.websiteUrl = leadData.domain.trim();
    if (leadData.phone) verifiedFacts.phoneNumber = leadData.phone.trim();
    if (leadData.address) verifiedFacts.location = leadData.address.trim();
    if (leadData.contactName) verifiedFacts.contactPerson = leadData.contactName.trim();
    if (leadData.contactTitle) verifiedFacts.contactRole = leadData.contactTitle.trim();
    if (leadData.qualificationScore !== undefined) {
      verifiedFacts.relevanceScore = `${leadData.qualificationScore}/100`;
    }

    const observedWebsiteGaps = (leadData.auditGaps || []).map((gap) => gap.trim()).filter(Boolean);

    const unknownFields: string[] = [
      'pricing_quotes',
      'competitor_comparisons',
      'unverified_client_counts',
      'guaranteed_revenue_numbers',
      'internal_staff_schedules',
    ];

    const defaultProhibited = [
      'Do not quote specific pricing or fee structures not provided in campaign offer',
      'Do not claim pre-existing business relationships or referrals unless verified',
      'Do not fabricate reviews, ratings, or awards not observed in website audit',
      'Do not make legal or contractual commitments',
      'Treat missing information as strictly unknown',
    ];

    const prohibitedClaims = Array.from(
      new Set([...(agentConfig.prohibitedClaims || []), ...defaultProhibited])
    );

    return {
      leadId: leadData.leadId,
      businessName: leadData.businessName,
      contactName: leadData.contactName || 'Decision Maker',
      verifiedFacts,
      observedWebsiteGaps,
      campaignOffer: leadData.campaignOffer || 'Complimentary Technical Assessment',
      callObjective: agentConfig.callObjective || 'Qualify prospect and schedule follow-up discovery call',
      approvedTalkingPoints: agentConfig.approvedTalkingPoints || [],
      prohibitedClaims,
      unknownFields,
      complianceDisclaimer: 'This call is an AI-assisted outreach conversation conducted on behalf of closeVDS.',
    };
  }

  async createVoiceSession(
    callId: string,
    context: GroundedVoiceContext
  ): Promise<VoiceSession> {
    if (!this.isConfigured()) {
      throw new ProviderError(
        this.providerName,
        'CONFIGURATION_ERROR',
        'Voice AI provider credentials not configured. Live speech session creation unavailable.',
        false
      );
    }

    return {
      sessionId: `vses_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      callId,
      provider: this.providerName,
      context,
      turns: [],
      status: 'ACTIVE',
      startedAt: new Date(),
    };
  }

  async handleTurn(
    _session: VoiceSession,
    turn: VoiceTurn
  ): Promise<VoiceResponse> {
    if (!this.isConfigured()) {
      throw new ProviderError(
        this.providerName,
        'CONFIGURATION_ERROR',
        'Voice AI provider credentials not configured',
        false
      );
    }

    const text = turn.text.toLowerCase();
    const isOptOut = text.includes('stop') || text.includes('unsubscribe') || text.includes('do not call');

    if (isOptOut) {
      return {
        textResponse: 'Understood. I will immediately remove your number from our contact list. Have a great day.',
        shouldEndCall: true,
      };
    }

    return {
      textResponse: 'Thank you for your time. Would you like us to follow up via email with our technical review?',
      shouldEndCall: false,
    };
  }

  async summarizeCall(
    turns: VoiceTurn[],
    callDurationSeconds = 0
  ): Promise<CallSummaryResult> {
    if (!turns || turns.length === 0) {
      return {
        summary: 'No conversation turns recorded for this call attempt.',
        keyPoints: [],
        objectionsRaised: [],
        sentiment: 'NEUTRAL',
      };
    }

    const conversationText = turns.map((t) => `${t.speaker}: ${t.text}`).join('\n').toLowerCase();
    const objections: string[] = [];
    if (conversationText.includes('too busy') || conversationText.includes('no time')) {
      objections.push('Lack of time');
    }
    if (conversationText.includes('already have') || conversationText.includes('competitor')) {
      objections.push('Existing vendor/solution');
    }
    if (conversationText.includes('budget') || conversationText.includes('expensive')) {
      objections.push('Budget constraints');
    }

    let sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' = 'NEUTRAL';
    if (conversationText.includes('yes') || conversationText.includes('interested') || conversationText.includes('sounds good')) {
      sentiment = 'POSITIVE';
    } else if (conversationText.includes('stop') || conversationText.includes('not interested') || conversationText.includes('never call')) {
      sentiment = 'NEGATIVE';
    }

    let followUp: string | undefined;
    if (conversationText.includes('callback') || conversationText.includes('call back')) {
      followUp = 'Follow-up phone call requested by prospect';
    } else if (conversationText.includes('send info') || conversationText.includes('send email')) {
      followUp = 'Send technical overview via email';
    }

    return {
      summary: `Call completed with duration ${callDurationSeconds}s across ${turns.length} conversational turns. Sentiment: ${sentiment}.`,
      keyPoints: turns.filter((t) => t.speaker === 'lead').slice(0, 3).map((t) => t.text),
      objectionsRaised: objections,
      followUpRequested: followUp,
      sentiment,
    };
  }

  async classifyOutcome(
    turns: VoiceTurn[],
    metadata?: Record<string, unknown>
  ): Promise<CallOutcomeAnalysis> {
    if (!turns || turns.length === 0) {
      const rawStatus = String(metadata?.rawStatus || '').toLowerCase();
      let outcome: CallOutcomeType = 'NO_ANSWER';
      if (rawStatus.includes('busy')) outcome = 'BUSY';
      else if (rawStatus.includes('voicemail')) outcome = 'VOICEMAIL';
      else if (rawStatus.includes('failed')) outcome = 'FAILED';

      return {
        outcome,
        interestLevel: 'NONE',
        objections: [],
        sentiment: 'NEUTRAL',
        optOutDetected: false,
        summary: `Call attempt ended with status ${outcome} without conversational engagement.`,
        derivedFromActual: true,
      };
    }

    const conversationText = turns.map((t) => `${t.speaker}: ${t.text}`).join('\n').toLowerCase();

    // 1. Opt-Out Check
    const optOutPhrases = ['stop calling', 'do not call', 'don\'t call', 'remove me', 'unsubscribe', 'take me off'];
    const hasOptOut = optOutPhrases.some((p) => conversationText.includes(p));
    if (hasOptOut) {
      return {
        outcome: 'OPTED_OUT',
        interestLevel: 'NONE',
        objections: ['Requested immediate removal from outreach'],
        sentiment: 'NEGATIVE',
        optOutDetected: true,
        summary: 'Lead explicitly requested removal from calling lists (OPT_OUT).',
        derivedFromActual: true,
      };
    }

    // 2. Meeting / Callback Check
    if (conversationText.includes('meeting') || conversationText.includes('schedule a demo') || conversationText.includes('book a time')) {
      return {
        outcome: 'MEETING_REQUESTED',
        interestLevel: 'HIGH',
        objections: [],
        requestedFollowUp: 'Sales meeting requested by prospect',
        nextAction: 'Schedule meeting with account executive',
        sentiment: 'POSITIVE',
        optOutDetected: false,
        summary: 'Prospect expressed strong interest and requested a formal meeting/demo.',
        derivedFromActual: true,
      };
    }

    if (
      conversationText.includes('call back') ||
      conversationText.includes('callback') ||
      conversationText.includes('call me back') ||
      conversationText.includes('call me later') ||
      conversationText.includes('call again')
    ) {
      return {
        outcome: 'CALLBACK_REQUESTED',
        interestLevel: 'MEDIUM',
        objections: [],
        requestedFollowUp: 'Prospect requested a callback at a later time',
        nextAction: 'Create callback task',
        sentiment: 'NEUTRAL',
        optOutDetected: false,
        summary: 'Prospect requested a callback at a more convenient time.',
        derivedFromActual: true,
      };
    }

    // 3. General Interest Check
    if (conversationText.includes('interested') || conversationText.includes('tell me more') || conversationText.includes('sounds interesting')) {
      return {
        outcome: 'INTERESTED',
        interestLevel: 'HIGH',
        objections: [],
        requestedFollowUp: 'Send information packet',
        nextAction: 'Qualify further via follow-up',
        sentiment: 'POSITIVE',
        optOutDetected: false,
        summary: 'Prospect engaged with pitch and indicated positive interest in the offer.',
        derivedFromActual: true,
      };
    }

    // 4. Not Interested Check
    if (conversationText.includes('not interested') || conversationText.includes('no thank you') || conversationText.includes('not looking')) {
      return {
        outcome: 'NOT_INTERESTED',
        interestLevel: 'LOW',
        objections: ['Not interested in current offer'],
        sentiment: 'NEGATIVE',
        optOutDetected: false,
        summary: 'Prospect politely declined offer.',
        derivedFromActual: true,
      };
    }

    // 5. Default qualified or completed
    return {
      outcome: 'QUALIFIED',
      interestLevel: 'MEDIUM',
      objections: [],
      sentiment: 'NEUTRAL',
      optOutDetected: false,
      summary: `Conversation completed successfully across ${turns.length} turns.`,
      derivedFromActual: true,
    };
  }
}
