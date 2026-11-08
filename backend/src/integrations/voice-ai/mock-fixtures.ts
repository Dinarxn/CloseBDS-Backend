import type {
  VoiceAIModel,
  VoiceAIVoice,
  VoiceAIAssistantConfig,
  CallTurnInput,
  CallRecordingMetadata,
} from '../../modules/voice/voice.types.js';

export const MOCK_RETELL_MODELS: VoiceAIModel[] = [
  {
    id: 'gpt-4o',
    provider: 'retell',
    name: 'OpenAI GPT-4o (Realtime Optimized)',
    description: 'Ultra-low conversational latency with fact grounding',
    contextWindow: 128000,
    recommendedFor: 'B2B diagnostic calls',
  },
  {
    id: 'claude-3-5-sonnet',
    provider: 'retell',
    name: 'Anthropic Claude 3.5 Sonnet',
    description: 'Nuanced reasoning and strict objection handling',
    contextWindow: 200000,
    recommendedFor: 'Enterprise qualification',
  },
];

export const MOCK_VAPI_MODELS: VoiceAIModel[] = [
  {
    id: 'vapi-neural-1',
    provider: 'vapi',
    name: 'Vapi Neural Voice Engine 1.0',
    description: 'Real-time WebSocket streaming audio engine',
    contextWindow: 64000,
    recommendedFor: 'Outbound sales screening',
  },
];

export const MOCK_VOICES: VoiceAIVoice[] = [
  {
    id: 'voice_rachel_11labs',
    provider: 'retell',
    name: 'Rachel (ElevenLabs Natural)',
    gender: 'female',
    accent: 'American (Professional)',
    sampleUrl: '/audio/samples/rachel-preview.mp3',
    supportedLanguages: ['en-US', 'en-GB'],
  },
  {
    id: 'voice_marcus_azure',
    provider: 'retell',
    name: 'Marcus (Azure Neural HQ)',
    gender: 'male',
    accent: 'American (Midwestern Warm)',
    sampleUrl: '/audio/samples/marcus-preview.mp3',
    supportedLanguages: ['en-US'],
  },
  {
    id: 'voice_sophia_cartesia',
    provider: 'vapi',
    name: 'Sophia (Cartesia Sonic)',
    gender: 'female',
    accent: 'American (Enthusiastic)',
    sampleUrl: '/audio/samples/sophia-preview.mp3',
    supportedLanguages: ['en-US', 'es-ES'],
  },
];

export const MOCK_ASSISTANT_CONFIG: VoiceAIAssistantConfig = {
  assistantId: 'asst_mock_sarah_1',
  provider: 'retell',
  name: 'Dental SDR Assistant (Sarah)',
  model: 'gpt-4o',
  voice: 'voice_rachel_11labs',
  systemPrompt: 'You are Sarah, an outreach specialist for closeVDS diagnosing dental booking page latency.',
  firstMessage: 'Hi Dr. Connor, this is Sarah with closeVDS. Do you have two minutes regarding your booking page speed?',
  temperature: 0.3,
  talkingPoints: ['4.2-second mobile load time observed', 'Technical audit available in under 48 hours'],
  objections: {
    'not interested': 'Understood, I will remove your number from our list right away.',
    'too busy': 'Understood. When would be a better time for a quick 2-minute call?',
  },
  qualificationQuestions: [
    'Does the practice currently accept new patients online?',
    'Who oversees website performance decisions?',
  ],
};

export const MOCK_CALL_TRANSCRIPTS: CallTurnInput[] = [
  {
    turnIndex: 0,
    speaker: 'agent',
    text: 'Hi Dr. Connor, this is Sarah with closeVDS.',
    confidence: 0.98,
    timestampMs: 1200,
  },
  {
    turnIndex: 1,
    speaker: 'lead',
    text: 'Yes, what is this regarding?',
    confidence: 0.95,
    timestampMs: 8400,
  },
  {
    turnIndex: 2,
    speaker: 'agent',
    text: 'Our technical audit identified a 4.2-second mobile load time on your appointment booking page. Would tomorrow at 2 PM work to review?',
    confidence: 0.97,
    timestampMs: 16500,
  },
  {
    turnIndex: 3,
    speaker: 'lead',
    text: 'Tomorrow at 2 PM works. Please send the invite to sarah@austinsmiledesign.com.',
    confidence: 0.99,
    timestampMs: 28000,
  },
];

export const MOCK_RECORDING: CallRecordingMetadata = {
  callId: 'call_mock_fixture_1',
  recordingUrl: 'https://storage.closevds.com/recordings/call_mock_fixture_1.mp3',
  recordingSid: 'RE_mock_recording_sid_123',
  durationSeconds: 105,
  channels: 2,
  status: 'AVAILABLE',
  authorizedPlaybackUrl: 'https://storage.closevds.com/recordings/call_mock_fixture_1.mp3?token=auth_sample_123',
};
