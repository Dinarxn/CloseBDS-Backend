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
  rawWebsite?: string;
  rawCategory?: string;
  metadata?: Record<string, unknown>;
}

export interface NormalizedLeadCandidate {
  businessName: string;
  normalizedAddress?: string;
  normalizedPhone?: string;
  domain?: string;
  websiteUrl?: string;
  category?: string;
  sourceProvider: string;
  sourceExternalId: string;
}

/**
 * Lead Discovery Service Provider Abstraction Contract
 * Decouples discovery from specific scraping or directory API providers.
 */
export interface LeadDiscoveryService {
  discoverCandidates(query: LeadDiscoveryQuery): Promise<RawLeadCandidate[]>;
  normalizeCandidate(raw: RawLeadCandidate): NormalizedLeadCandidate;
}
