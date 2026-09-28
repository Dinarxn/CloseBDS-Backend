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
import {
  type LeadDataQuality,
  validateCoordinates,
  normalizeStructuredAddress,
  normalizePhones,
  normalizeWebsiteAndDomain,
  buildTargetedMapsUrl,
  classifyDataQuality,
} from './lead-normalization.js';

export interface GeoapifyAdapterConfig {
  apiKey?: string;
  endpoint?: string;
  userAgent?: string;
  nominatimEndpoint?: string;
}

/**
 * Deterministic mapping from canonical discovery niche to Geoapify hierarchical category keys.
 * Uses official Geoapify Places category hierarchy.
 */
export const NICHE_GEOAPIFY_MAP: Record<string, string> = {
  dentist: 'healthcare.dentist',
  dental: 'healthcare.dentist',
  doctor: 'healthcare.clinic_or_praxis,healthcare.hospital',
  doctors: 'healthcare.clinic_or_praxis,healthcare.hospital',
  physician: 'healthcare.clinic_or_praxis',
  clinic: 'healthcare.clinic_or_praxis',
  hospital: 'healthcare.hospital',
  pharmacy: 'healthcare.pharmacy',
  restaurant: 'catering.restaurant',
  cafe: 'catering.cafe',
  coffee: 'catering.cafe',
  bar: 'catering.bar',
  pub: 'catering.pub',
  hotel: 'accommodation.hotel',
  motel: 'accommodation.hotel',
  salon: 'service.beauty.hairdresser',
  hairdresser: 'service.beauty.hairdresser',
  barber: 'service.beauty.hairdresser',
  beauty: 'service.beauty',
  gym: 'sport.fitness',
  fitness: 'sport.fitness',
  lawyer: 'office.lawyer',
  attorney: 'office.lawyer',
  legal: 'office.lawyer',
  accountant: 'office.accountant',
  accounting: 'office.accountant',
  real_estate: 'office.estate_agent',
  realtor: 'office.estate_agent',
  estate_agent: 'office.estate_agent',
  car_repair: 'service.vehicle.repair.car,service.vehicle.repair',
  auto_repair: 'service.vehicle.repair.car,service.vehicle.repair',
  mechanic: 'service.vehicle.repair.car,service.vehicle.repair',
  veterinary: 'pet.veterinary',
  vet: 'pet.veterinary',
  plumber: 'service.plumber',
  electrician: 'service.electrician',
  bakery: 'commercial.food_and_drink.bakery',
  supermarket: 'commercial.supermarket',
};

interface GeoapifyFeature {
  type: string;
  geometry?: {
    type: string;
    coordinates?: number[]; // [longitude, latitude]
  };
  properties?: {
    place_id?: string;
    name?: string;
    formatted?: string;
    address_line1?: string;
    address_line2?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
    country_code?: string;
    lat?: number;
    lon?: number;
    phone?: string;
    email?: string;
    website?: string;
    contact?: {
      phone?: string;
      email?: string;
      website?: string;
    };
    datasource?: {
      sourcename?: string;
      raw?: {
        phone?: string;
        'contact:phone'?: string;
        email?: string;
        'contact:email'?: string;
        website?: string;
        url?: string;
        [key: string]: unknown;
      };
    };
    categories?: string[];
    [key: string]: unknown;
  };
}

interface GeoapifyPlacesResponse {
  type?: string;
  features?: GeoapifyFeature[];
  [key: string]: unknown;
}

export class GeoapifyDiscoveryAdapter implements LeadDiscoveryService, BaseProviderAdapter {
  public readonly providerName = 'Geoapify';
  public readonly category = 'LEAD_DISCOVERY' as const;
  private apiKey?: string;
  private endpoint: string;
  private userAgent: string;
  private nominatimEndpoint: string;

  constructor(config?: GeoapifyAdapterConfig) {
    this.apiKey = config?.apiKey !== undefined ? config.apiKey : process.env.GEOAPIFY_API_KEY;
    this.endpoint = config?.endpoint || 'https://api.geoapify.com/v2/places';
    this.userAgent =
      config?.userAgent ||
      process.env.GEOAPIFY_USER_AGENT ||
      'closeVDS-LeadDiscovery/1.0 (https://github.com/closevds)';
    this.nominatimEndpoint =
      config?.nominatimEndpoint || 'https://nominatim.openstreetmap.org/search';
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  getCapabilities(): ProviderCapability {
    return {
      name: this.providerName,
      category: this.category,
      supportedFeatures: [
        'Geoapify Places API v2',
        'Bounding Box Geographic Filtering',
        'Hierarchical Category Mapping',
        'Address & Contact Enrichment',
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
        message: 'No API key configured for Geoapify',
      };
    }

    return {
      providerName: this.providerName,
      category: this.category,
      status: 'AVAILABLE',
      isConfigured: true,
      latencyMs: 15,
      message: 'Geoapify provider configured and ready',
    };
  }

  /**
   * Resolves canonical niche to official Geoapify hierarchical category.
   * Throws explicit ProviderError if the niche cannot be mapped confidently.
   */
  public resolveCategory(niche: string): string {
    const normalized = niche.trim().toLowerCase().replace(/[\s-]+/g, '_');
    const mapped = NICHE_GEOAPIFY_MAP[normalized];
    if (mapped) {
      return mapped;
    }

    // Direct match check without underscore replacement
    const directNormalized = niche.trim().toLowerCase();
    const directMapped = NICHE_GEOAPIFY_MAP[directNormalized];
    if (directMapped) {
      return directMapped;
    }

    throw new ProviderError(
      this.providerName,
      'CONFIGURATION_ERROR',
      `Unsupported niche '${niche}' for Geoapify discovery`
    );
  }

  /**
   * Discovers candidate business leads using Geoapify Places API v2.
   * Reuses Nominatim geographic bounding box resolution for location scoping.
   */
  async discoverCandidates(query: LeadDiscoveryQuery): Promise<RawLeadCandidate[]> {
    if (!this.isConfigured()) {
      throw new ProviderError(
        this.providerName,
        'CONFIGURATION_ERROR',
        'Geoapify API key is not configured'
      );
    }

    // 1. Resolve and validate niche category
    const categories = this.resolveCategory(query.niche);
    const boundLimit = Math.min(50, Math.max(1, query.limit || 10));

    // 2. Resolve location into geographic bounding box via Nominatim
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
        throw new ProviderError(
          this.providerName,
          'TIMEOUT',
          'Nominatim location resolution timed out',
          true
        );
      }
      throw new ProviderError(
        this.providerName,
        'PROVIDER_UNAVAILABLE',
        `Nominatim network error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        true
      );
    }

    if (geoRes.status === 429) {
      throw new ProviderError(
        this.providerName,
        'RATE_LIMITED',
        'Nominatim location resolution rate limit exceeded (HTTP 429)',
        true
      );
    }
    if (!geoRes.ok) {
      throw new ProviderError(
        this.providerName,
        'PROVIDER_UNAVAILABLE',
        `Nominatim location resolution failed with HTTP ${geoRes.status}`,
        geoRes.status >= 500
      );
    }

    let geoData: Array<{ boundingbox?: string[] }>;
    try {
      geoData = (await geoRes.json()) as Array<{ boundingbox?: string[] }>;
    } catch {
      throw new ProviderError(
        this.providerName,
        'PARSING_ERROR',
        'Failed to parse Nominatim location response'
      );
    }

    if (
      !Array.isArray(geoData) ||
      geoData.length === 0 ||
      !geoData[0].boundingbox ||
      geoData[0].boundingbox.length < 4
    ) {
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

    // 3. Build Geoapify Places API v2 request with rectangle filter
    // Geoapify rect format: filter=rect:lon1,lat1,lon2,lat2 (west,south,east,north)
    const rectFilter = `rect:${west},${south},${east},${north}`;
    const placesParams = new URLSearchParams({
      categories,
      filter: rectFilter,
      limit: String(boundLimit),
      apiKey: this.apiKey!,
    });

    let placesRes: Response;
    try {
      placesRes = await fetch(`${this.endpoint}?${placesParams.toString()}`, {
        method: 'GET',
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(15000),
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new ProviderError(this.providerName, 'TIMEOUT', 'Geoapify request timed out', true);
      }
      throw new ProviderError(
        this.providerName,
        'PROVIDER_UNAVAILABLE',
        `Geoapify network error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        true
      );
    }

    // Handle authentication / invalid API key
    if (placesRes.status === 401 || placesRes.status === 403) {
      throw new ProviderError(
        this.providerName,
        'CONFIGURATION_ERROR',
        `Geoapify authentication failed (HTTP ${placesRes.status}): Invalid API key`,
        false
      );
    }

    // Handle rate limiting
    if (placesRes.status === 429) {
      throw new ProviderError(
        this.providerName,
        'RATE_LIMITED',
        'Geoapify API rate limit exceeded (HTTP 429)',
        true
      );
    }

    if (!placesRes.ok) {
      throw new ProviderError(
        this.providerName,
        'PROVIDER_UNAVAILABLE',
        `Geoapify API request failed with HTTP ${placesRes.status}`,
        placesRes.status >= 500
      );
    }

    let placesData: GeoapifyPlacesResponse;
    try {
      placesData = (await placesRes.json()) as GeoapifyPlacesResponse;
    } catch {
      throw new ProviderError(
        this.providerName,
        'PARSING_ERROR',
        'Failed to parse Geoapify response as JSON'
      );
    }

    if (!placesData || !Array.isArray(placesData.features) || placesData.features.length === 0) {
      return [];
    }

    // 4. Map Geoapify GeoJSON features into RawLeadCandidate[]
    const candidates: RawLeadCandidate[] = [];

    for (let i = 0; i < placesData.features.length; i++) {
      const feat = placesData.features[i];
      const props = feat.properties || {};

      // Only return entities with an identifiable business name
      const rawName = props.name;
      if (!rawName || typeof rawName !== 'string' || rawName.trim().length === 0) {
        continue;
      }

      // Canonical address construction from structured fields with fallback
      const canonicalAddress = normalizeStructuredAddress({
        housenumber: props.housenumber,
        street: props.street,
        address_line1: props.address_line1,
        address_line2: props.address_line2,
        city: props.city,
        state: props.state,
        postcode: props.postcode,
        country: props.country,
        formatted: props.formatted,
      });

      // Contact phone extraction & normalization
      const rawPhoneStr =
        props.contact?.phone?.trim() ||
        props.phone?.trim() ||
        props.datasource?.raw?.phone?.trim() ||
        props.datasource?.raw?.['contact:phone']?.trim() ||
        undefined;

      const phones = normalizePhones(rawPhoneStr);

      // Contact email extraction & normalization
      const rawEmail =
        props.contact?.email?.trim() ||
        props.email?.trim() ||
        props.datasource?.raw?.email?.trim() ||
        props.datasource?.raw?.['contact:email']?.trim() ||
        undefined;

      // Website extraction & domain normalization
      const rawWebsiteStr =
        props.website?.trim() ||
        props.contact?.website?.trim() ||
        props.datasource?.raw?.website?.trim() ||
        props.datasource?.raw?.url?.trim() ||
        undefined;

      const web = normalizeWebsiteAndDomain(rawWebsiteStr);

      // Place ID / External ID preservation
      const externalId = props.place_id ? `geoapify_${props.place_id}` : `geoapify_${Date.now()}_${i}`;

      // Coordinate extraction & validation from props.lat/lon or geometry.coordinates [lon, lat]
      const rawLat = props.lat ?? feat.geometry?.coordinates?.[1];
      const rawLon = props.lon ?? feat.geometry?.coordinates?.[0];
      const coords = validateCoordinates(rawLat, rawLon);

      // Deterministic targeted Google Maps search URL
      const mapsUrl = buildTargetedMapsUrl({
        businessName: rawName.trim(),
        address: canonicalAddress,
        latitude: coords.latitude,
        longitude: coords.longitude,
      });

      // Objective data quality classification
      const dataQuality = classifyDataQuality({
        businessName: rawName.trim(),
        address: canonicalAddress,
        latitude: coords.latitude,
        longitude: coords.longitude,
        phone: phones.primaryPhone,
        email: rawEmail,
        websiteUrl: web.websiteUrl,
        domain: web.domain,
      });

      candidates.push({
        rawId: externalId,
        rawName: rawName.trim(),
        rawAddress: canonicalAddress,
        rawPhone: phones.primaryPhone,
        rawEmail,
        rawWebsite: web.websiteUrl,
        rawCategory: props.categories?.[0] || query.niche,
        metadata: {
          placeId: props.place_id,
          categories: props.categories,
          latitude: coords.latitude,
          longitude: coords.longitude,
          country: props.country,
          countryCode: props.country_code,
          city: props.city,
          state: props.state,
          postcode: props.postcode,
          street: props.street,
          housenumber: props.housenumber,
          addressLine1: props.address_line1,
          addressLine2: props.address_line2,
          formattedAddress: props.formatted,
          canonicalAddress,
          primaryPhone: phones.primaryPhone,
          additionalPhones: phones.additionalPhones,
          email: rawEmail,
          websiteUrl: web.websiteUrl,
          domain: web.domain,
          mapsUrl,
          dataQuality,
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
    const meta = (raw.metadata || {}) as Record<string, unknown>;

    // 1. Domain & Website resolution
    let domain: string | undefined = typeof meta.domain === 'string' ? meta.domain : undefined;
    let websiteUrl: string | undefined = typeof meta.websiteUrl === 'string' ? meta.websiteUrl : undefined;

    if (!domain && (raw.rawWebsite || websiteUrl)) {
      const normWeb = normalizeWebsiteAndDomain(raw.rawWebsite || websiteUrl);
      domain = normWeb.domain;
      websiteUrl = normWeb.websiteUrl;
    }

    // 2. Address resolution
    const normalizedAddress =
      typeof meta.canonicalAddress === 'string'
        ? meta.canonicalAddress
        : raw.rawAddress?.trim() || undefined;

    // 3. Phone & Additional Phones resolution
    const metaAdditional = Array.isArray(meta.additionalPhones)
      ? (meta.additionalPhones as string[])
      : [];
    let normalizedPhone = typeof meta.primaryPhone === 'string' ? meta.primaryPhone : undefined;
    let additionalPhones = metaAdditional;

    if (!normalizedPhone && raw.rawPhone) {
      const normPhones = normalizePhones(raw.rawPhone);
      normalizedPhone = normPhones.primaryPhone;
      if (additionalPhones.length === 0) {
        additionalPhones = normPhones.additionalPhones;
      }
    }

    // 4. Coordinates validation
    const coords = validateCoordinates(
      meta.latitude ?? (meta as any).lat,
      meta.longitude ?? (meta as any).lon
    );

    // 5. Place ID preservation
    const placeId =
      typeof meta.placeId === 'string'
        ? meta.placeId
        : raw.rawId.startsWith('geoapify_')
        ? raw.rawId.replace(/^geoapify_/, '')
        : undefined;

    // 6. Email resolution
    const email =
      typeof meta.email === 'string'
        ? meta.email
        : raw.rawEmail?.trim() || undefined;

    // 7. Maps URL
    const mapsUrl =
      typeof meta.mapsUrl === 'string'
        ? meta.mapsUrl
        : buildTargetedMapsUrl({
            businessName: raw.rawName.trim(),
            address: normalizedAddress,
            latitude: coords.latitude,
            longitude: coords.longitude,
          });

    // 8. Data Quality classification
    const dataQuality: LeadDataQuality =
      typeof meta.dataQuality === 'string' &&
      (meta.dataQuality === 'COMPLETE' || meta.dataQuality === 'PARTIAL' || meta.dataQuality === 'MINIMAL')
        ? (meta.dataQuality as LeadDataQuality)
        : classifyDataQuality({
            businessName: raw.rawName.trim(),
            address: normalizedAddress,
            latitude: coords.latitude,
            longitude: coords.longitude,
            phone: normalizedPhone,
            email,
            websiteUrl,
            domain,
          });

    return {
      businessName: raw.rawName.trim(),
      normalizedAddress,
      normalizedPhone,
      additionalPhones: additionalPhones.length > 0 ? additionalPhones : undefined,
      email,
      domain,
      websiteUrl: websiteUrl || raw.rawWebsite?.trim() || undefined,
      category: raw.rawCategory?.trim() || undefined,
      sourceProvider: this.providerName,
      sourceExternalId: raw.rawId,
      placeId,
      latitude: coords.latitude,
      longitude: coords.longitude,
      mapsUrl,
      dataQuality,
    };
  }
}
