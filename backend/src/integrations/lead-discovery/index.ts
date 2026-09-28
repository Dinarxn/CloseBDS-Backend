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
  additionalEmails?: string[];
  domain?: string;
  websiteUrl?: string;
  additionalWebsites?: string[];
  category?: string;
  sourceProvider: string;
  sourceExternalId: string;
  placeId?: string;
  latitude?: number;
  longitude?: number;
  mapsUrl?: string;
  mapsMatchStatus?: import('./lead-normalization.js').MapsMatchStatus;
  dataQuality?: import('./lead-normalization.js').LeadDataQuality;
  placeDetailsEnriched?: boolean;
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
  type NormalizedEmailsResult,
  type NormalizedWebsiteResult,
  type ValidatedCoordinates,
  type MapsMatchStatus,
  type TargetedMapsUrlInput,
  type TargetedMapsUrlResult,
  type DataQualityClassificationInput,
  type PlaceDetailsRawProperties,
  type SafeEnrichmentMergeInput,
  type SafeEnrichmentMergeResult,
  validateCoordinates,
  normalizeStructuredAddress,
  normalizePhones,
  normalizeEmails,
  normalizeWebsiteAndDomain,
  buildTargetedMapsDetails,
  buildTargetedMapsUrl,
  classifyDataQuality,
  safeMergePlaceDetails,
} from './lead-normalization.js';


