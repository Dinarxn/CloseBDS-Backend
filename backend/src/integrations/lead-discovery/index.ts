/**
 * Lead Discovery Service Provider Types & Contract matching Phase 0 TECH-STACK.md
 */

export interface LeadDiscoveryQuery {
  niche: string;
  location: string;
  limit: number;
  countryCode?: string;
}

export interface RawLeadCandidate {
  rawId: string;
  rawName: string;
  rawAddress?: string;
  rawPhone?: string;
  rawEmail?: string;
  rawWebsite?: string;
  rawCategory?: string;
  metadata?: Record<string, unknown>;
}

export interface NormalizedLeadCandidate {
  businessName: string;
  normalizedAddress?: string;
  normalizedPhone?: string;
  additionalPhones?: string[];
  email?: string;
  domain?: string;
  websiteUrl?: string;
  category?: string;
  sourceProvider: string;
  sourceExternalId: string;
  placeId?: string;
  latitude?: number;
  longitude?: number;
  mapsUrl?: string;
  dataQuality?: import('./lead-normalization.js').LeadDataQuality;
}

/**
 * Lead Discovery Service Provider Abstraction Contract
 * Decouples discovery from specific scraping or directory API providers.
 */
export interface LeadDiscoveryService {
  discoverCandidates(query: LeadDiscoveryQuery): Promise<RawLeadCandidate[]>;
  normalizeCandidate(raw: RawLeadCandidate): NormalizedLeadCandidate;
}

export {
  GeoapifyDiscoveryAdapter,
  type GeoapifyAdapterConfig,
  NICHE_GEOAPIFY_MAP,
} from './geoapify.adapter.js';

export {
  type LeadDataQuality,
  type StructuredAddressInput,
  type NormalizedPhonesResult,
  type NormalizedWebsiteResult,
  type ValidatedCoordinates,
  type TargetedMapsUrlInput,
  type DataQualityClassificationInput,
  validateCoordinates,
  normalizeStructuredAddress,
  normalizePhones,
  normalizeWebsiteAndDomain,
  buildTargetedMapsUrl,
  classifyDataQuality,
} from './lead-normalization.js';

