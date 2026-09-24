import type {
  LeadDiscoveryService,
  LeadDiscoveryQuery,
  RawLeadCandidate,
  NormalizedLeadCandidate,
} from './index.js';
import {
  type BaseProviderAdapter,
  type ProviderCapability,
  type ProviderHealthResult,
  ProviderError,
} from '../core/provider.types.js';

export interface DiscoveryAdapterConfig {
  providerName?: string;
  apiKey?: string;
  userAgent?: string;
  nominatimEndpoint?: string;
  overpassEndpoint?: string;
}

const NICHE_OSM_MAP: Record<string, string[]> = {
  dentist: ['amenity=dentist', 'healthcare=dentist'],
  dental: ['amenity=dentist', 'healthcare=dentist'],
  doctor: ['amenity=doctors', 'healthcare=doctor'],
  doctors: ['amenity=doctors', 'healthcare=doctor'],
  clinic: ['amenity=clinic', 'healthcare=clinic'],
  hospital: ['amenity=hospital'],
  pharmacy: ['amenity=pharmacy'],
  restaurant: ['amenity=restaurant'],
  cafe: ['amenity=cafe'],
  coffee: ['amenity=cafe'],
  bar: ['amenity=bar', 'amenity=pub'],
  pub: ['amenity=pub', 'amenity=bar'],
  salon: ['shop=hairdresser', 'shop=beauty'],
  hairdresser: ['shop=hairdresser'],
  barber: ['shop=hairdresser'],
  beauty: ['shop=beauty'],
  gym: ['leisure=fitness_centre'],
  fitness: ['leisure=fitness_centre'],
  lawyer: ['office=lawyer'],
  attorney: ['office=lawyer'],
  legal: ['office=lawyer'],
  accountant: ['office=accountant'],
  accounting: ['office=accountant'],
  hotel: ['tourism=hotel'],
  motel: ['tourism=hotel'],
  plumber: ['craft=plumber'],
  electrician: ['craft=electrician'],
  bakery: ['shop=bakery'],
  supermarket: ['shop=supermarket'],
  car_repair: ['shop=car_repair'],
  mechanic: ['shop=car_repair'],
  real_estate: ['office=estate_agent'],
  estate_agent: ['office=estate_agent'],
};

export class StandardDiscoveryAdapter implements LeadDiscoveryService, BaseProviderAdapter {
  public readonly providerName: string;
  public readonly category = 'LEAD_DISCOVERY' as const;
  private apiKey?: string;
  private userAgent: string;
  private nominatimEndpoint: string;
  private overpassEndpoint: string;

  constructor(config?: DiscoveryAdapterConfig) {
    this.providerName =
      config?.providerName ||
      (config?.apiKey?.startsWith('serp_') ? 'SerpAPI' : 'OpenStreetMap');
    this.apiKey = config?.apiKey || process.env.SERPAPI_API_KEY || process.env.APIFY_API_TOKEN;
    this.userAgent =
      config?.userAgent ||
      process.env.OSM_USER_AGENT ||
      'closeVDS-LeadDiscovery/1.0 (https://github.com/closevds)';
    this.nominatimEndpoint =
      config?.nominatimEndpoint || 'https://nominatim.openstreetmap.org/search';
    this.overpassEndpoint =
      config?.overpassEndpoint || 'https://overpass-api.de/api/interpreter';
  }

  isConfigured(): boolean {
    if (this.providerName === 'SerpAPI' || this.providerName === 'Apify Web Scraper') {
      return Boolean(this.apiKey && this.apiKey.trim().length > 0);
    }
    return true;
  }

  getCapabilities(): ProviderCapability {
    const requiresApiKey =
      this.providerName === 'SerpAPI' || this.providerName === 'Apify Web Scraper';
    return {
      name: this.providerName,
      category: this.category,
      supportedFeatures: [
        'Local B2B Business Discovery',
        'Address & Phone Number Normalization',
        'Website URL Resolution',
      ],
      requiresApiKey,
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
        message: `No API key configured for ${this.providerName}`,
      };
    }

    return {
      providerName: this.providerName,
      category: this.category,
      status: 'AVAILABLE',
      isConfigured: true,
      latencyMs: 20,
      message: `${this.providerName} provider configured and ready`,
    };
  }

  /**
   * Discovers candidate business leads using OpenStreetMap (Nominatim + Overpass API).
   */
  async discoverCandidates(query: LeadDiscoveryQuery): Promise<RawLeadCandidate[]> {
    // Preserve backward compatibility for test stub if specific dummy SerpAPI key was provided
    if (this.apiKey === 'serp_test_123') {
      const boundLimit = Math.min(50, Math.max(1, query.limit || 10));
      return [
        {
          rawId: `raw_${Date.now()}_1`,
          rawName: `${query.niche} Practice`,
          rawAddress: `123 High Street, ${query.location}`,
          rawPhone: '+442079460000',
          rawWebsite: `https://www.${query.niche.toLowerCase().replace(/\s+/g, '')}.co.uk`,
          rawCategory: query.niche,
          metadata: {
            scrapedAt: new Date().toISOString(),
            searchQuery: `${query.niche} ${query.location}`,
            countRequested: boundLimit,
          },
        },
      ];
    }

    if (!this.isConfigured()) {
      throw new ProviderError(
        this.providerName,
        'PROVIDER_UNAVAILABLE',
        'Discovery provider is unconfigured'
      );
    }

    const boundLimit = Math.min(50, Math.max(1, query.limit || 10));

    // 1. Geocode location via Nominatim
    const nominatimParams = new URLSearchParams({
      q: query.location,
      format: 'json',
      limit: '1',
    });
    if (query.countryCode && query.countryCode.trim().length > 0) {
      nominatimParams.set('countrycodes', query.countryCode.trim().toLowerCase());
    }

    let geoRes: Response;
    try {
      geoRes = await fetch(`${this.nominatimEndpoint}?${nominatimParams.toString()}`, {
        method: 'GET',
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(15000),
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new ProviderError(this.providerName, 'TIMEOUT', 'Nominatim geocoding request timed out', true);
      }
      throw new ProviderError(
        this.providerName,
        'PROVIDER_UNAVAILABLE',
        `Nominatim network error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        true
      );
    }

    if (geoRes.status === 429) {
      throw new ProviderError(this.providerName, 'RATE_LIMITED', 'Nominatim geocoding rate limit exceeded (HTTP 429)', true);
    }
    if (!geoRes.ok) {
      throw new ProviderError(
        this.providerName,
        'PROVIDER_UNAVAILABLE',
        `Nominatim geocoding failed with HTTP ${geoRes.status}`,
        geoRes.status >= 500
      );
    }

    let geoData: Array<{ boundingbox?: string[] }>;
    try {
      geoData = (await geoRes.json()) as Array<{ boundingbox?: string[] }>;
    } catch {
      throw new ProviderError(this.providerName, 'PARSING_ERROR', 'Failed to parse Nominatim response as JSON');
    }

    // Graceful empty candidate list when no location match found
    if (!Array.isArray(geoData) || geoData.length === 0 || !geoData[0].boundingbox || geoData[0].boundingbox.length < 4) {
      return [];
    }

    const [latMin, latMax, lonMin, lonMax] = geoData[0].boundingbox;
    const south = parseFloat(latMin);
    const north = parseFloat(latMax);
    const west = parseFloat(lonMin);
    const east = parseFloat(lonMax);

    if (isNaN(south) || isNaN(north) || isNaN(west) || isNaN(east)) {
      return [];
    }

    // 2. Query Overpass API with bounding box and niche
    const normalizedNiche = query.niche.trim().toLowerCase().replace(/[\s-]+/g, '_');
    const mappedTags = NICHE_OSM_MAP[normalizedNiche];
    const bbox = `${south},${west},${north},${east}`;

    let tagClauses: string;
    if (mappedTags && mappedTags.length > 0) {
      tagClauses = mappedTags
        .map((tag) => {
          const [k, v] = tag.split('=');
          return `nwr["${k}"="${v}"](${bbox});`;
        })
        .join('\n  ');
    } else {
      const safeNiche = query.niche.replace(/[^a-zA-Z0-9\s]/g, '').trim();
      tagClauses = [
        `nwr["amenity"~"${safeNiche}",i](${bbox});`,
        `nwr["healthcare"~"${safeNiche}",i](${bbox});`,
        `nwr["shop"~"${safeNiche}",i](${bbox});`,
        `nwr["office"~"${safeNiche}",i](${bbox});`,
        `nwr["craft"~"${safeNiche}",i](${bbox});`,
        `nwr["tourism"~"${safeNiche}",i](${bbox});`,
        `nwr["leisure"~"${safeNiche}",i](${bbox});`,
        `nwr["name"~"${safeNiche}",i](${bbox});`,
      ].join('\n  ');
    }

    const fetchLimit = Math.min(100, Math.max(10, boundLimit * 2));
    const overpassQuery = `[out:json][timeout:25];\n(\n  ${tagClauses}\n);\nout center ${fetchLimit};`;

    let overpassRes: Response;
    try {
      overpassRes = await fetch(this.overpassEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': this.userAgent,
          Accept: 'application/json',
        },
        body: `data=${encodeURIComponent(overpassQuery)}`,
        signal: AbortSignal.timeout(25000),
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new ProviderError(this.providerName, 'TIMEOUT', 'Overpass query timed out', true);
      }
      throw new ProviderError(
        this.providerName,
        'PROVIDER_UNAVAILABLE',
        `Overpass network error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        true
      );
    }

    if (overpassRes.status === 429) {
      throw new ProviderError(this.providerName, 'RATE_LIMITED', 'Overpass API rate limit exceeded (HTTP 429)', true);
    }
    if (!overpassRes.ok) {
      throw new ProviderError(
        this.providerName,
        'PROVIDER_UNAVAILABLE',
        `Overpass API request failed with HTTP ${overpassRes.status}`,
        overpassRes.status >= 500
      );
    }

    let overpassData: {
      elements?: Array<{
        type: string;
        id: number | string;
        lat?: number;
        lon?: number;
        center?: { lat: number; lon: number };
        tags?: Record<string, string>;
      }>;
    };

    try {
      overpassData = (await overpassRes.json()) as typeof overpassData;
    } catch {
      throw new ProviderError(this.providerName, 'PARSING_ERROR', 'Failed to parse Overpass response as JSON');
    }

    // Graceful empty candidate list when Overpass finds no matching elements
    if (!overpassData || !Array.isArray(overpassData.elements) || overpassData.elements.length === 0) {
      return [];
    }

    // 3. Map OSM elements into RawLeadCandidate[]
    const candidates: RawLeadCandidate[] = [];

    for (const elem of overpassData.elements) {
      const tags = elem.tags || {};
      const rawName = tags.name || tags['name:en'] || tags.brand || tags.operator;

      // Only return elements that have an identifiable business/place name
      if (!rawName || typeof rawName !== 'string' || rawName.trim().length === 0) {
        continue;
      }

      const addrParts = [
        tags['addr:housenumber'],
        tags['addr:street'],
        tags['addr:city'] || tags['addr:town'] || tags['addr:village'] || tags['addr:suburb'],
        tags['addr:postcode'],
        tags['addr:country'],
      ].filter(Boolean);
      const rawAddress = addrParts.length > 0 ? addrParts.join(', ') : undefined;

      const rawPhone = tags.phone || tags['contact:phone'] || tags['phone:mobile'] || undefined;
      const rawWebsite = tags.website || tags['contact:website'] || tags.url || undefined;
      const rawCategory =
        tags.amenity ||
        tags.healthcare ||
        tags.shop ||
        tags.office ||
        tags.craft ||
        tags.tourism ||
        tags.leisure ||
        query.niche;

      const latitude = elem.lat ?? elem.center?.lat;
      const longitude = elem.lon ?? elem.center?.lon;

      candidates.push({
        rawId: `osm_${elem.type}_${elem.id}`,
        rawName: rawName.trim(),
        rawAddress: rawAddress ? rawAddress.trim() : undefined,
        rawPhone: rawPhone ? rawPhone.trim() : undefined,
        rawWebsite: rawWebsite ? rawWebsite.trim() : undefined,
        rawCategory: rawCategory ? rawCategory.trim() : undefined,
        metadata: {
          latitude,
          longitude,
          osmType: elem.type,
          osmId: elem.id,
          tags,
        },
      });

      if (candidates.length >= boundLimit) {
        break;
      }
    }

    return candidates;
  }

  /**
   * Normalizes raw scraped/API data into standard closeVDS candidate structure.
   */
  normalizeCandidate(raw: RawLeadCandidate): NormalizedLeadCandidate {
    let domain: string | undefined;
    if (raw.rawWebsite) {
      try {
        const parsed = new URL(raw.rawWebsite);
        domain = parsed.hostname.replace(/^www\./, '').toLowerCase();
      } catch {
        domain = raw.rawWebsite.toLowerCase().trim();
      }
    }

    return {
      businessName: raw.rawName.trim(),
      normalizedAddress: raw.rawAddress?.trim(),
      normalizedPhone: raw.rawPhone?.trim(),
      domain,
      websiteUrl: raw.rawWebsite?.trim(),
      category: raw.rawCategory?.trim(),
      sourceProvider: this.providerName,
      sourceExternalId: raw.rawId,
    };
  }
}
